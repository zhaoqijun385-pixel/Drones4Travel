"""Tourism survey missions: Task1 plan/sim + Task2 execute/photos (dry-run first).

Sidelane under /api/survey/* — does not touch Crazyflie radio by default.
No Street View. Geocode via Google Geocoding or Nominatim fallback.
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
import os
import uuid
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from typing import Any
from urllib.parse import quote_plus
from urllib.request import ProxyHandler, Request, build_opener

from fastapi import APIRouter, File, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from .config import CONFIG


logger = logging.getLogger(__name__)
router = APIRouter(tags=["survey"])

DATA_DIR = Path(__file__).resolve().parent.parent / "data" / "survey"
PHOTO_DIR = DATA_DIR / "photos"
STORE_PATH = DATA_DIR / "missions.json"
DATA_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR.mkdir(parents=True, exist_ok=True)

# In-memory runtime
_missions: dict[str, dict[str, Any]] = {}
_lock = asyncio.Lock()
_ws_clients: dict[str, set[WebSocket]] = {}
_runners: dict[str, asyncio.Task] = {}

# Patchable sleep for unit tests (do not patch asyncio.sleep globally — breaks Lock).
_async_sleep = asyncio.sleep


def urlopen(req, timeout=3):
    """Local snapshot fetch — always direct to localhost MediaMTX."""
    return build_opener(ProxyHandler({})).open(req, timeout=timeout)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _load_store() -> None:
    global _missions
    if STORE_PATH.exists():
        try:
            _missions = json.loads(STORE_PATH.read_text(encoding="utf-8"))
        except Exception as exc:  # noqa: BLE001
            logger.warning("survey store load failed: %s", exc)
            _missions = {}


def _save_store() -> None:
    try:
        STORE_PATH.write_text(json.dumps(_missions, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception as exc:  # noqa: BLE001
        logger.warning("survey store save failed: %s", exc)


_load_store()


class PlanRequest(BaseModel):
    place: str = Field(..., min_length=1, max_length=200)
    radius_m: float = Field(80.0, ge=20.0, le=500.0)
    min_alt_m: float = Field(25.0, ge=5.0, le=120.0)
    photo_count: int = Field(5, ge=5, le=12)
    drone_count: int = Field(1, ge=1, le=4)


class MissionCreate(BaseModel):
    plan_id: str | None = None
    place: str | None = None
    radius_m: float = 80.0
    min_alt_m: float = 25.0
    photo_count: int = 5
    drone_count: int = 1
    dry_run: bool = True


def _google_key() -> str:
    key = (
        (CONFIG.get("google") or {}).get("api_key")
        or CONFIG.get("googleApiKey")
        or ""
    )
    if key:
        return key
    client_cfg = Path(__file__).resolve().parent.parent.parent / "client" / "config.json"
    if client_cfg.exists():
        try:
            return json.loads(client_cfg.read_text(encoding="utf-8")).get("googleApiKey") or ""
        except Exception:  # noqa: BLE001
            return ""
    return ""


def _proxy_candidates() -> list[str | None]:
    """Proxy list for geocoders. Prefer configured Clash; avoid hanging on dead ports."""
    found: list[str | None] = []
    cfg_proxy = (
        (CONFIG.get("survey") or {}).get("geocode_proxy")
        or CONFIG.get("geocode_proxy")
        or ""
    ).strip()
    env_proxy = ""
    for k in ("https_proxy", "http_proxy", "HTTPS_PROXY", "HTTP_PROXY"):
        env_proxy = (os.environ.get(k) or "").strip()
        if env_proxy:
            break
    # Default Clash HTTP port used on this machine
    for v in (cfg_proxy, env_proxy, "http://127.0.0.1:7892"):
        if v and v not in found:
            found.append(v)
    found.append(None)  # direct last (usually fails behind GFW — keep short timeout)
    return found


def _urlopen_via(proxy: str | None, req: Request, timeout: float = 12):
    if proxy:
        opener = build_opener(ProxyHandler({"http": proxy, "https": proxy}))
    else:
        opener = build_opener(ProxyHandler({}))
    return opener.open(req, timeout=timeout)


def _fetch_json(url: str, headers: dict | None = None, timeout: float = 12) -> tuple[dict | list | None, str]:
    """Try each proxy candidate; return (json, via_label) or (None, last_error)."""
    hdrs = {"User-Agent": "drone-navigation-survey/1.0", **(headers or {})}
    req = Request(url, headers=hdrs)
    errors: list[str] = []
    for proxy in _proxy_candidates():
        label = proxy or "direct"
        # Direct often hangs behind GFW — keep it short.
        to = 2.0 if proxy is None else min(timeout, 6.0)
        try:
            with _urlopen_via(proxy, req, timeout=to) as resp:
                return json.loads(resp.read().decode("utf-8")), label
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{label}: {exc}")
            logger.info("geocode fetch fail via %s: %s", label, exc)
    return None, "; ".join(errors[-3:])


# Optional quick picks for UI chips only — NOT required for geocoding.
_PLACE_HINTS = {
    "西湖": (30.242, 120.148, "West Lake, Hangzhou"),
    "west lake": (30.242, 120.148, "West Lake, Hangzhou"),
    "斯坦福": (37.4275, -122.1697, "Stanford University"),
    "stanford": (37.4275, -122.1697, "Stanford University"),
    "stanford university": (37.4275, -122.1697, "Stanford University"),
    "外滩": (31.240, 121.490, "The Bund, Shanghai"),
    "故宫": (39.916, 116.397, "Forbidden City, Beijing"),
    "金门大桥": (37.8199, -122.4783, "Golden Gate Bridge"),
    "golden gate": (37.8199, -122.4783, "Golden Gate Bridge"),
}


def _hint_geocode(place: str) -> dict | None:
    """Exact alias match only (shortcuts). Arbitrary places go through online geocoders."""
    raw = place.strip()
    key = raw.lower()
    if key in _PLACE_HINTS:
        lat, lng, label = _PLACE_HINTS[key]
        return {"lat": lat, "lng": lng, "label": label, "provider": "alias"}
    if raw in _PLACE_HINTS:
        lat, lng, label = _PLACE_HINTS[raw]
        return {"lat": lat, "lng": lng, "label": label, "provider": "alias"}
    return None


class GeocodeError(Exception):
    """Raised when no geocoder can resolve the place."""


def _geocode(place: str) -> dict[str, Any]:
    place = place.strip()
    if not place:
        raise GeocodeError("empty place")

    hint = _hint_geocode(place)
    if hint:
        return hint

    key = _google_key()
    if key:
        url = (
            "https://maps.googleapis.com/maps/api/geocode/json?"
            f"address={quote_plus(place)}&key={key}&language=zh-CN"
        )
        data, via = _fetch_json(url, timeout=12)
        if isinstance(data, dict):
            status = data.get("status")
            if status == "OK" and data.get("results"):
                r0 = data["results"][0]
                loc = r0["geometry"]["location"]
                return {
                    "lat": float(loc["lat"]),
                    "lng": float(loc["lng"]),
                    "label": r0.get("formatted_address") or place,
                    "provider": f"google/{via}",
                }
            logger.warning("google geocode status=%s via=%s err=%s", status, via, data.get("error_message"))
        else:
            logger.warning("google geocode no data: %s", via)

    # Nominatim (OpenStreetMap) — still no Street View
    url = (
        "https://nominatim.openstreetmap.org/search?"
        f"q={quote_plus(place)}&format=json&limit=1"
    )
    data, via = _fetch_json(url, timeout=12)
    if isinstance(data, list) and data:
        return {
            "lat": float(data[0]["lat"]),
            "lng": float(data[0]["lon"]),
            "label": data[0].get("display_name") or place,
            "provider": f"nominatim/{via}",
        }

    raise GeocodeError(
        f"无法解析地点「{place}」。请检查网络/代理（Clash :7892），或换更完整的地名。"
    )



def _viewpoints(lat: float, lng: float, radius_m: float, alt_m: float, n: int) -> list[dict]:
    """Evenly spaced observation angles around target (local ENU approx)."""
    m_per_deg_lat = 111_320.0
    m_per_deg_lng = 111_320.0 * math.cos(math.radians(lat))
    pts = []
    for i in range(n):
        az = (2 * math.pi * i / n) - math.pi / 2  # start northish
        east = math.cos(az) * radius_m
        north = math.sin(az) * radius_m
        plat = lat + north / m_per_deg_lat
        plng = lng + east / m_per_deg_lng
        # Look toward center: yaw degrees Cesium heading-ish
        yaw = math.degrees(math.atan2(east, north)) + 180.0
        pts.append({
            "id": f"vp_{i+1}",
            "index": i,
            "lat": round(plat, 7),
            "lng": round(plng, 7),
            "alt_m": alt_m,
            "yaw_deg": round(yaw % 360, 1),
            "azimuth_deg": round((math.degrees(az) + 360) % 360, 1),
        })
    return pts


def _assign_drones(viewpoints: list[dict], drone_count: int) -> list[dict]:
    drones = [f"drone_{i+1}" for i in range(drone_count)]
    shots = []
    for i, vp in enumerate(viewpoints):
        shots.append({
            **vp,
            "shot_id": f"shot_{i+1}",
            "drone_id": drones[i % len(drones)],
            "status": "pending",
            "photo_path": None,
            "photo_url": None,
            "telemetry": [],
            "error": None,
        })
    return shots


def _home_near(lat: float, lng: float, alt_m: float) -> dict:
    return {"lat": lat, "lng": lng, "alt_m": max(5.0, alt_m * 0.4), "yaw_deg": 0.0}


def _build_plan(req: PlanRequest) -> dict[str, Any]:
    geo = _geocode(req.place.strip())
    vps = _viewpoints(geo["lat"], geo["lng"], req.radius_m, req.min_alt_m, req.photo_count)
    shots = _assign_drones(vps, req.drone_count)
    plan_id = uuid.uuid4().hex[:10]
    home = _home_near(geo["lat"], geo["lng"], req.min_alt_m)
    # Simulated routes per drone: home → each assigned shot → home
    routes: dict[str, list[dict]] = {}
    for sh in shots:
        did = sh["drone_id"]
        routes.setdefault(did, [{"lat": home["lat"], "lng": home["lng"], "alt_m": home["alt_m"], "kind": "home"}])
        routes[did].append({
            "lat": sh["lat"], "lng": sh["lng"], "alt_m": sh["alt_m"],
            "kind": "shot", "shot_id": sh["shot_id"],
        })
    for did, path in routes.items():
        path.append({"lat": home["lat"], "lng": home["lng"], "alt_m": home["alt_m"], "kind": "home"})

    return {
        "plan_id": plan_id,
        "place": req.place.strip(),
        "geo": geo,
        "radius_m": req.radius_m,
        "min_alt_m": req.min_alt_m,
        "photo_count": req.photo_count,
        "drone_count": req.drone_count,
        "home": home,
        "viewpoints": vps,
        "shots": shots,
        "routes": routes,
        "created_at": _now(),
        "street_view": False,
    }


def _mission_from_plan(plan: dict, dry_run: bool = True) -> dict[str, Any]:
    mid = uuid.uuid4().hex[:12]
    return {
        "mission_id": mid,
        "plan_id": plan["plan_id"],
        "place": plan["place"],
        "geo": plan["geo"],
        "radius_m": plan["radius_m"],
        "min_alt_m": plan["min_alt_m"],
        "home": plan["home"],
        "routes": plan["routes"],
        "shots": [dict(s, status="pending", telemetry=[], photo_path=None, photo_url=None, error=None) for s in plan["shots"]],
        "drone_count": plan["drone_count"],
        "dry_run": dry_run,
        "status": "ready",
        "phase": "idle",
        "current_shot_id": None,
        "commands": [],
        "events": [{"ts": _now(), "kind": "created", "detail": mid}],
        "error": None,
        "created_at": _now(),
        "updated_at": _now(),
    }


async def _broadcast(mid: str) -> None:
    m = _missions.get(mid)
    if not m:
        return
    payload = json.dumps({"type": "state", **_public(m)}, ensure_ascii=False)
    dead = []
    for ws in list(_ws_clients.get(mid, set())):
        try:
            await ws.send_text(payload)
        except Exception:  # noqa: BLE001
            dead.append(ws)
    for ws in dead:
        _ws_clients.get(mid, set()).discard(ws)


def _public(m: dict) -> dict:
    out = {k: v for k, v in m.items() if k != "shots"}
    shots = []
    for s in m.get("shots", []):
        sc = {k: v for k, v in s.items() if k != "telemetry"}
        sc["telemetry_tail"] = (s.get("telemetry") or [])[-5:]
        shots.append(sc)
    out["shots"] = shots
    out["commands_tail"] = (m.get("commands") or [])[-20:]
    out["events_tail"] = (m.get("events") or [])[-30:]
    return out


def _emit(m: dict, kind: str, detail: str = "") -> None:
    m.setdefault("events", []).append({"ts": _now(), "kind": kind, "detail": detail})
    m["events"] = m["events"][-80:]
    m["updated_at"] = _now()


def _cmd(m: dict, action: str, detail: dict | None = None) -> None:
    m.setdefault("commands", []).append({
        "ts": _now(),
        "action": action,
        "detail": detail or {},
        "dry_run": m.get("dry_run", True),
    })
    m["commands"] = m["commands"][-100:]


def _record_telem(shot: dict, lat: float, lng: float, alt: float, yaw: float, phase: str) -> None:
    shot.setdefault("telemetry", []).append({
        "ts": _now(),
        "lat": lat,
        "lng": lng,
        "alt_m": alt,
        "yaw_deg": yaw,
        "phase": phase,
    })


def _xml_escape(s: str) -> str:
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _make_placeholder_image(label: str, lines: list[str] | None = None) -> tuple[bytes, str]:
    """Return (bytes, ext). Prefer Pillow JPEG; else readable SVG card."""
    lines = lines or []
    try:
        from PIL import Image, ImageDraw  # type: ignore

        img = Image.new("RGB", (960, 540), (28, 42, 50))
        dr = ImageDraw.Draw(img)
        dr.rectangle((0, 0, 960, 64), fill=(18, 90, 110))
        dr.text((28, 22), "Survey Mission · dry-run", fill=(220, 240, 245))
        y = 100
        for row in [label, *lines, _now()]:
            dr.text((28, y), str(row)[:90], fill=(210, 224, 230))
            y += 36
        dr.rectangle((28, 460, 932, 500), outline=(90, 160, 150), width=2)
        dr.text((40, 470), "No Street View · local placeholder", fill=(140, 180, 170))
        buf = BytesIO()
        img.save(buf, format="JPEG", quality=88)
        return buf.getvalue(), "jpg"
    except Exception:  # noqa: BLE001
        rows = [label, *lines, _now(), "No Street View · SVG placeholder"]
        texts = "\n".join(
            f'<text x="28" y="{100 + i * 36}" fill="#d2e0e6" font-size="20" '
            f'font-family="Segoe UI, sans-serif">{_xml_escape(str(r)[:90])}</text>'
            for i, r in enumerate(rows)
        )
        svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540">
  <rect width="100%" height="100%" fill="#1c2a32"/>
  <rect width="100%" height="64" fill="#125a6e"/>
  <text x="28" y="40" fill="#dceef2" font-size="22" font-family="Segoe UI, sans-serif">Survey Mission · dry-run</text>
  {texts}
  <rect x="28" y="460" width="904" height="40" fill="none" stroke="#5aa096" stroke-width="2"/>
</svg>"""
        return svg.encode("utf-8"), "svg"


def _try_snapshot_bytes() -> bytes | None:
    """Prefer local MediaMTX / AI-Deck snapshot if available."""
    candidates = [
        "http://127.0.0.1:8082/snapshot",
        "http://127.0.0.1:8889/crazyflie-drone/snapshot",
    ]
    for url in candidates:
        try:
            with urlopen(Request(url, headers={"User-Agent": "survey"}), timeout=2) as resp:
                data = resp.read()
                if data and len(data) > 100:
                    return data
        except Exception:  # noqa: BLE001
            continue
    return None


async def _wait_if_paused(mid: str) -> None:
    while True:
        m = _missions.get(mid)
        if not m or m["status"] in ("cancelled", "failed", "completed"):
            return
        if m["status"] != "paused":
            return
        await _async_sleep(0.25)



async def _cancelled(mid: str) -> bool:
    m = _missions.get(mid)
    return (not m) or m["status"] == "cancelled"


async def _execute_shot(mid: str, sh: dict, home: dict) -> None:
    """move → hover → photo for one shot (dry-run or live placeholder)."""
    await _wait_if_paused(mid)
    if await _cancelled(mid):
        return
    async with _lock:
        m = _missions[mid]
        if m["status"] == "cancelled":
            return
        m["status"] = "running"
        m["phase"] = "move"
        m["current_shot_id"] = sh["shot_id"]
        # refresh shot ref
        sh = next(x for x in m["shots"] if x["shot_id"] == sh["shot_id"])
        sh["status"] = "flying"
        _cmd(m, "move", {"shot_id": sh["shot_id"], "drone_id": sh["drone_id"], "lat": sh["lat"], "lng": sh["lng"], "alt_m": sh["alt_m"]})
        _record_telem(sh, home["lat"], home["lng"], m["min_alt_m"], 0, "depart")
        _save_store()
    await _broadcast(mid)
    await _async_sleep(0.55)

    await _wait_if_paused(mid)
    if await _cancelled(mid):
        return
    async with _lock:
        m = _missions[mid]
        sh = next(x for x in m["shots"] if x["shot_id"] == sh["shot_id"])
        m["phase"] = "hover"
        sh["status"] = "hovering"
        _cmd(m, "hover", {"shot_id": sh["shot_id"], "drone_id": sh["drone_id"], "seconds": 1.0})
        _record_telem(sh, sh["lat"], sh["lng"], sh["alt_m"], sh["yaw_deg"], "hover")
        _save_store()
    await _broadcast(mid)
    await _async_sleep(0.7)

    await _wait_if_paused(mid)
    if await _cancelled(mid):
        return
    async with _lock:
        m = _missions[mid]
        sh = next(x for x in m["shots"] if x["shot_id"] == sh["shot_id"])
        m["phase"] = "photo"
        sh["status"] = "capturing"
        _cmd(m, "photo", {"shot_id": sh["shot_id"], "drone_id": sh["drone_id"]})
        place = m["place"]
        _save_store()
    await _broadcast(mid)

    label = f"{place} · {sh['shot_id']} · {sh['drone_id']}"
    ext = "jpg"
    blob = None
    m_now = _missions.get(mid) or {}
    if not m_now.get("dry_run", True):
        raw = _try_snapshot_bytes()
        if raw and (raw.startswith(bytes.fromhex("ffd8ff")) or raw.startswith(bytes.fromhex("89504e470d0a1a0a"))):
            blob = raw
    if not blob:
        blob, ext = _make_placeholder_image(
            label,
            [
                f"lat {sh['lat']}  lng {sh['lng']}  alt {sh['alt_m']}m",
                f"yaw {sh.get('yaw_deg')}°  az {sh.get('azimuth_deg')}°",
            ],
        )
    fname = f"{mid}_{sh['shot_id']}.{ext}"
    fpath = PHOTO_DIR / fname
    fpath.write_bytes(blob)

    async with _lock:
        m = _missions[mid]
        sh = next(x for x in m["shots"] if x["shot_id"] == sh["shot_id"])
        sh["photo_path"] = str(fpath)
        sh["photo_url"] = f"/api/survey/missions/{mid}/photos/{sh['shot_id']}"
        sh["status"] = "done"
        _record_telem(sh, sh["lat"], sh["lng"], sh["alt_m"], sh["yaw_deg"], "photo")
        _emit(m, "photo", sh["shot_id"])
        _save_store()
    await _broadcast(mid)
    await _async_sleep(0.2)


async def _run_drone_queue(mid: str, drone_id: str, shots: list[dict], home: dict) -> None:
    for sh in shots:
        if await _cancelled(mid):
            return
        await _execute_shot(mid, sh, home)


async def _run_mission(mid: str) -> None:
    try:
        async with _lock:
            m = _missions.get(mid)
            if not m:
                return
            m["status"] = "running"
            m["phase"] = "takeoff"
            _emit(m, "start", "dry_run" if m.get("dry_run") else "live")
            _cmd(m, "takeoff", {"height": m["min_alt_m"]})
            _save_store()
        await _broadcast(mid)
        await _async_sleep(0.45)

        shots = sorted(m["shots"], key=lambda s: s.get("index", 0))
        home = m["home"]

        by_drone: dict[str, list] = {}
        for sh in shots:
            by_drone.setdefault(sh.get("drone_id") or "drone_1", []).append(sh)

        # 1 drone: sequential. 2+ drones: parallel queues (Tasks.pdf multi after single).
        if len(by_drone) <= 1:
            for sh in shots:
                if await _cancelled(mid):
                    async with _lock:
                        m = _missions[mid]
                        _emit(m, "cancelled")
                        _save_store()
                    await _broadcast(mid)
                    return
                await _execute_shot(mid, sh, home)
        else:
            await asyncio.gather(*[
                _run_drone_queue(mid, did, lst, home) for did, lst in by_drone.items()
            ])
            if await _cancelled(mid):
                async with _lock:
                    m = _missions[mid]
                    _emit(m, "cancelled")
                    _save_store()
                await _broadcast(mid)
                return

        # Return
        async with _lock:
            m = _missions[mid]
            m["phase"] = "rtl"
            _cmd(m, "return", {"lat": home["lat"], "lng": home["lng"]})
            _save_store()
        await _broadcast(mid)
        await _async_sleep(0.55)

        async with _lock:
            m = _missions[mid]
            if m["status"] != "cancelled":
                _cmd(m, "land", {})
                m["phase"] = "done"
                m["status"] = "completed"
                m["current_shot_id"] = None
                _emit(m, "completed")
                _save_store()
        await _broadcast(mid)
    except asyncio.CancelledError:
        async with _lock:
            m = _missions.get(mid)
            if m and m["status"] not in ("completed", "cancelled"):
                m["status"] = "cancelled"
                _emit(m, "cancelled", "task_cancelled")
                _save_store()
        await _broadcast(mid)
    except Exception as exc:  # noqa: BLE001
        logger.exception("mission %s failed", mid)
        async with _lock:
            m = _missions.get(mid)
            if m:
                m["status"] = "failed"
                m["error"] = str(exc)
                _emit(m, "failed", str(exc))
                if m.get("current_shot_id"):
                    for sh in m["shots"]:
                        if sh["shot_id"] == m["current_shot_id"] and sh["status"] != "done":
                            sh["status"] = "failed"
                            sh["error"] = str(exc)
                _save_store()
        await _broadcast(mid)
    finally:
        _runners.pop(mid, None)


# --- HTTP API -----------------------------------------------------------------

@router.get("/survey/health")
async def survey_health() -> dict:
    return {
        "status": "ok",
        "missions": len(_missions),
        "version": 2,
        "street_view": False,
        "places": len(_PLACE_HINTS),
    }


@router.get("/survey/places")
async def survey_places() -> dict:
    """Quick picks for offline/alias geocoding (no Street View)."""
    items = []
    seen = set()
    for key, (lat, lng, label) in _PLACE_HINTS.items():
        if label in seen:
            continue
        seen.add(label)
        items.append({"query": key, "label": label, "lat": lat, "lng": lng})
    items.sort(key=lambda x: x["label"])
    return {"places": items, "street_view": False}


@router.post("/survey/plan")
async def create_plan(req: PlanRequest) -> dict:
    try:
        # Geocode uses blocking urlopen — keep the event loop free for WS/telemetry.
        plan = await asyncio.to_thread(_build_plan, req)
    except GeocodeError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    # stash plan inside a soft cache on disk
    plans_path = DATA_DIR / "plans.json"
    plans = {}
    if plans_path.exists():
        try:
            plans = json.loads(plans_path.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            plans = {}
    plans[plan["plan_id"]] = plan
    plans_path.write_text(json.dumps(plans, ensure_ascii=False, indent=2), encoding="utf-8")
    return plan


@router.get("/survey/plans/{plan_id}")
async def get_plan(plan_id: str) -> dict:
    plans_path = DATA_DIR / "plans.json"
    if not plans_path.exists():
        raise HTTPException(404, "no plans")
    plans = json.loads(plans_path.read_text(encoding="utf-8"))
    if plan_id not in plans:
        raise HTTPException(404, "plan not found")
    return plans[plan_id]


@router.post("/survey/missions")
async def create_mission(body: MissionCreate) -> dict:
    if body.plan_id:
        plans_path = DATA_DIR / "plans.json"
        if not plans_path.exists():
            raise HTTPException(404, "no plans")
        plans = json.loads(plans_path.read_text(encoding="utf-8"))
        plan = plans.get(body.plan_id)
        if not plan:
            raise HTTPException(404, "plan not found")
    else:
        if not body.place:
            raise HTTPException(400, "place or plan_id required")
        try:
            plan = await asyncio.to_thread(
                _build_plan,
                PlanRequest(
                    place=body.place,
                    radius_m=body.radius_m,
                    min_alt_m=body.min_alt_m,
                    photo_count=body.photo_count,
                    drone_count=body.drone_count,
                ),
            )
        except GeocodeError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
    mission = _mission_from_plan(plan, dry_run=body.dry_run)
    async with _lock:
        _missions[mission["mission_id"]] = mission
        _save_store()
    return _public(mission)


@router.get("/survey/missions")
async def list_missions() -> dict:
    items = sorted(_missions.values(), key=lambda m: m.get("created_at", ""), reverse=True)
    return {"items": [_public(m) for m in items[:40]]}


@router.get("/survey/missions/{mission_id}")
async def get_mission(mission_id: str) -> dict:
    m = _missions.get(mission_id)
    if not m:
        raise HTTPException(404, "mission not found")
    return _public(m)


@router.post("/survey/missions/{mission_id}/start")
async def start_mission(mission_id: str) -> dict:
    async with _lock:
        m = _missions.get(mission_id)
        if not m:
            raise HTTPException(404, "mission not found")
        if m["status"] in ("running",):
            return _public(m)
        if m["status"] == "paused":
            m["status"] = "running"
            _emit(m, "resume")
            _save_store()
            await _broadcast(mission_id)
            return _public(m)
        if m["status"] not in ("ready", "failed", "cancelled", "completed"):
            raise HTTPException(400, f"cannot start from {m['status']}")
        # reset non-done shots on retry from failed/cancelled
        if m["status"] in ("failed", "cancelled", "completed"):
            for sh in m["shots"]:
                if sh["status"] != "done":
                    sh["status"] = "pending"
                    sh["error"] = None
            m["error"] = None
        if mission_id in _runners and not _runners[mission_id].done():
            raise HTTPException(409, "already running")
        _runners[mission_id] = asyncio.create_task(_run_mission(mission_id))
    return _public(_missions[mission_id])


@router.post("/survey/missions/{mission_id}/pause")
async def pause_mission(mission_id: str) -> dict:
    async with _lock:
        m = _missions.get(mission_id)
        if not m:
            raise HTTPException(404, "mission not found")
        if m["status"] != "running":
            raise HTTPException(400, "not running")
        m["status"] = "paused"
        _emit(m, "paused")
        _save_store()
    await _broadcast(mission_id)
    return _public(m)


@router.post("/survey/missions/{mission_id}/cancel")
async def cancel_mission(mission_id: str) -> dict:
    async with _lock:
        m = _missions.get(mission_id)
        if not m:
            raise HTTPException(404, "mission not found")
        m["status"] = "cancelled"
        _emit(m, "cancel_requested")
        _cmd(m, "return", {"reason": "cancel"})
        _save_store()
        t = _runners.get(mission_id)
        if t and not t.done():
            t.cancel()
    await _broadcast(mission_id)
    return _public(m)


@router.post("/survey/missions/{mission_id}/retry")
async def retry_mission(mission_id: str) -> dict:
    async with _lock:
        m = _missions.get(mission_id)
        if not m:
            raise HTTPException(404, "mission not found")
        if m["status"] not in ("failed", "cancelled", "completed", "ready", "paused"):
            raise HTTPException(400, f"cannot retry from {m['status']}")
        for sh in m["shots"]:
            if sh["status"] in ("failed", "pending", "flying", "hovering", "capturing"):
                sh["status"] = "pending"
                sh["error"] = None
        m["status"] = "ready"
        m["phase"] = "idle"
        m["error"] = None
        m["current_shot_id"] = None
        _emit(m, "retry_armed")
        _save_store()
    return await start_mission(mission_id)


@router.post("/survey/missions/{mission_id}/shots/{shot_id}/photo")
async def upload_photo(mission_id: str, shot_id: str, file: UploadFile = File(...)) -> dict:
    m = _missions.get(mission_id)
    if not m:
        raise HTTPException(404, "mission not found")
    sh = next((s for s in m["shots"] if s["shot_id"] == shot_id), None)
    if not sh:
        raise HTTPException(404, "shot not found")
    data = await file.read()
    if not data:
        raise HTTPException(400, "empty file")
    fname = f"{mission_id}_{shot_id}.jpg"
    fpath = PHOTO_DIR / fname
    fpath.write_bytes(data)
    async with _lock:
        sh["photo_path"] = str(fpath)
        sh["photo_url"] = f"/api/survey/missions/{mission_id}/photos/{shot_id}"
        sh["status"] = "done"
        _emit(m, "photo_uploaded", shot_id)
        _save_store()
    await _broadcast(mission_id)
    return {"ok": True, "photo_url": sh["photo_url"]}


@router.get("/survey/missions/{mission_id}/photos/{shot_id}")
async def get_photo(mission_id: str, shot_id: str):
    m = _missions.get(mission_id)
    if not m:
        raise HTTPException(404, "mission not found")
    sh = next((s for s in m["shots"] if s["shot_id"] == shot_id), None)
    if not sh or not sh.get("photo_path"):
        raise HTTPException(404, "photo not found")
    path = Path(sh["photo_path"])
    if not path.exists():
        raise HTTPException(404, "file missing")
    media = "image/svg+xml" if path.suffix.lower() == ".svg" else "image/jpeg"
    return FileResponse(path, media_type=media)


@router.websocket("/survey/missions/{mission_id}/ws")
async def mission_ws(websocket: WebSocket, mission_id: str) -> None:
    await websocket.accept()
    if mission_id not in _missions:
        await websocket.send_text(json.dumps({"type": "error", "detail": "not_found"}))
        await websocket.close()
        return
    _ws_clients.setdefault(mission_id, set()).add(websocket)
    await websocket.send_text(json.dumps({"type": "state", **_public(_missions[mission_id])}, ensure_ascii=False))
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            mtype = msg.get("type")
            if mtype == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))
            elif mtype == "start":
                await start_mission(mission_id)
            elif mtype == "pause":
                await pause_mission(mission_id)
            elif mtype == "cancel":
                await cancel_mission(mission_id)
            elif mtype == "retry":
                await retry_mission(mission_id)
    except WebSocketDisconnect:
        pass
    finally:
        _ws_clients.get(mission_id, set()).discard(websocket)
