"""Mission Arena v4: multi-stage faction war + observer UAV (sidelane).

Stages: contact → clash → assault → endgame
Features: dual VIP routes, relay contest, reinforcements, retreat/re-engage,
altitude tactics, extra hunter/guard units.
Does not touch Crazyflie radio / MediaMTX / Node-8 pages.
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
import random
import uuid
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)
router = APIRouter(tags=["sim-arena"])

TICK_HZ = 20
DT = 1.0 / TICK_HZ
MAP_W, MAP_H = 240.0, 170.0
TIME_LIMIT_S = 240.0
OCCUPY_NEED_S = 18.0
JAM_NEED_S = 24.0
RELAY_NEED_S = 14.0
SUPPRESS_NEED = 28.0
TRAIL_MAX = 50
TRAIL_EVERY = 3

ALT_MIN, ALT_MAX = 3.0, 85.0
BLUE_SPEED, VIP_SPEED, RED_SPEED, OBS_SPEED = 9.5, 4.1, 8.0, 14.0
ALT_RATE = 8.0
YAW_RATE = 1.8
ENGAGE_RANGE = 18.0
INTERCEPT_RANGE = 32.0
PUSH_STRENGTH = 5.8
HUNTER_RANGE = 40.0
RETREAT_HP = 28.0

AUDIT_PATH = Path(__file__).resolve().parent.parent / "logs" / "sim_arena_audit.jsonl"

# Campaign stage thresholds (seconds)
STAGE_CLASH = 22.0
STAGE_ASSAULT = 55.0
STAGE_ENDGAME = 120.0


@dataclass
class Body:
    x: float
    y: float
    yaw: float = 0.0
    alt: float = 12.0
    faction: str = "neutral"
    role: str = ""
    hp: float = 100.0
    retreat: bool = False
    cooled: float = 0.0  # seconds until can re-engage after retreat heal


@dataclass
class Zone:
    x: float
    y: float
    r: float


@dataclass
class Wall:
    x: float
    y: float
    w: float
    h: float
    height: float = 18.0


@dataclass
class ArenaState:
    mission_id: str = ""
    phase: str = "idle"
    stage: str = "contact"  # contact|clash|assault|endgame
    t: float = 0.0
    time_limit: float = TIME_LIMIT_S
    control_mode: str = "observer"
    units: dict[str, Body] = field(default_factory=dict)
    keep_zone: Zone = field(default_factory=lambda: Zone(200.0, 85.0, 12.0))
    jam_zone: Zone = field(default_factory=lambda: Zone(200.0, 85.0, 24.0))
    relay_zone: Zone = field(default_factory=lambda: Zone(118.0, 78.0, 14.0))
    walls: list[Wall] = field(default_factory=list)
    waypoints: list[tuple[float, float]] = field(default_factory=list)
    waypoints_alt: list[tuple[float, float]] = field(default_factory=list)
    route: str = "main"  # main|alt
    vip_wp: int = 0
    occupy_s: float = 0.0
    occupy_need: float = OCCUPY_NEED_S
    jam_s: float = 0.0
    jam_need: float = JAM_NEED_S
    relay_s: float = 0.0
    relay_need: float = RELAY_NEED_S
    relay_holder: str = "none"  # none|blue|red
    suppress_s: float = 0.0
    link_quality: float = 1.0
    jammed: bool = False
    red_modes: dict[str, str] = field(default_factory=dict)
    blue_modes: dict[str, str] = field(default_factory=dict)
    trails: dict[str, list[dict[str, float]]] = field(default_factory=dict)
    events: list[dict[str, Any]] = field(default_factory=list)
    skirmishes: list[dict[str, str]] = field(default_factory=list)
    flags: dict[str, bool] = field(default_factory=dict)
    brief: str = (
        "多阶段对抗：接触→交火→强攻→终局。"
        "VIP 可切换南北航线；中继站可被争夺；红方有伏击/猎杀/干扰，蓝方护航+哨戒+拦截。"
        "默认观察机巡视，按 2 指挥蓝方长机。"
    )


def _body_dict(b: Body) -> dict:
    d = asdict(b)
    return d


class ArenaEngine:
    def __init__(self) -> None:
        self.state = ArenaState()
        self._keys: dict[str, bool] = {}
        self._clients: set[WebSocket] = set()
        self._task: asyncio.Task | None = None
        self._lock = asyncio.Lock()
        self._trail_i = 0
        self._reset_keys()
        self._build_map()
        self._spawn_units()

    def _reset_keys(self) -> None:
        self._keys = {
            "w": False, "a": False, "s": False, "d": False,
            "r": False, "f": False, "q": False, "e": False,
        }

    def _build_map(self) -> None:
        self.state.walls = [
            Wall(30, 10, 24, 42, 24),
            Wall(30, 118, 24, 42, 22),
            Wall(72, 6, 28, 50, 28),
            Wall(72, 114, 28, 50, 26),
            Wall(118, 20, 22, 38, 20),
            Wall(118, 112, 22, 38, 20),
            Wall(162, 8, 26, 44, 30),
            Wall(162, 118, 26, 44, 30),
            Wall(100, 72, 16, 22, 16),  # central bunker / choke
            Wall(195, 40, 18, 28, 22),
            Wall(195, 105, 18, 28, 22),
        ]
        # Main (north-leaning) corridor
        self.state.waypoints = [
            (18, 85), (48, 85), (62, 58), (88, 48), (112, 58),
            (132, 82), (150, 105), (172, 95), (195, 88), (215, 85),
        ]
        # Alternate (south) when VIP under heavy pressure
        self.state.waypoints_alt = [
            (18, 85), (45, 100), (70, 125), (100, 130), (130, 120),
            (155, 100), (175, 75), (195, 80), (215, 85),
        ]
        self.state.keep_zone = Zone(205.0, 85.0, 12.0)
        self.state.jam_zone = Zone(205.0, 85.0, 24.0)
        self.state.relay_zone = Zone(118.0, 78.0, 14.0)

    def _spawn_units(self) -> None:
        self.state.units = {
            "blue_lead": Body(14, 85, 0.0, 15, "blue", "lead", 100),
            "blue_wing": Body(10, 94, 0.0, 13, "blue", "wing", 100),
            "blue_guard": Body(105, 70, 0.2, 16, "blue", "guard", 100),
            "vip": Body(22, 85, 0.0, 13, "vip", "vip", 100),
            "red_a": Body(155, 140, -math.pi / 2, 22, "red", "hunter", 100),
            "red_b": Body(158, 25, math.pi / 2, 18, "red", "flanker", 100),
            "red_c": Body(220, 100, math.pi, 26, "red", "jammer", 100),
            "red_d": Body(95, 20, math.pi / 2, 14, "red", "ambush", 100),
            "observer": Body(120, 45, 0.5, 58, "observer", "recon", 100),
        }
        self.state.red_modes = {
            "red_a": "stalk", "red_b": "flank", "red_c": "standby", "red_d": "hide",
        }
        self.state.blue_modes = {
            "blue_lead": "escort", "blue_wing": "form", "blue_guard": "picket",
        }
        self.state.trails = {k: [] for k in self.state.units}
        self.state.vip_wp = 0
        self.state.route = "main"
        self.state.skirmishes = []
        self.state.flags = {
            "reinforcements": False,
            "route_switched": False,
            "ambush_sprung": False,
            "endgame_push": False,
        }
        self.state.stage = "contact"
        self.state.relay_s = 0.0
        self.state.relay_holder = "none"

    def _emit(self, kind: str, detail: str = "") -> None:
        ev = {"ts": round(self.state.t, 2), "kind": kind, "detail": detail}
        self.state.events.append(ev)
        self.state.events = self.state.events[-60:]
        try:
            AUDIT_PATH.parent.mkdir(parents=True, exist_ok=True)
            with AUDIT_PATH.open("a", encoding="utf-8") as f:
                f.write(json.dumps({"mission_id": self.state.mission_id, "phase": self.state.phase, **ev}, ensure_ascii=False) + "\n")
        except Exception as exc:  # noqa: BLE001
            logger.warning("audit failed: %s", exc)

    def reset(self, briefing: bool = True) -> None:
        self._build_map()
        self._spawn_units()
        self.state.mission_id = str(uuid.uuid4())[:8]
        self.state.phase = "briefing" if briefing else "idle"
        self.state.t = 0.0
        self.state.occupy_s = 0.0
        self.state.jam_s = 0.0
        self.state.suppress_s = 0.0
        self.state.relay_s = 0.0
        self.state.link_quality = 1.0
        self.state.jammed = False
        self.state.events = []
        self.state.skirmishes = []
        self.state.control_mode = "observer"
        self._reset_keys()
        self._trail_i = 0
        self._emit("mission_reset", self.state.mission_id)

    def start(self) -> None:
        if self.state.phase not in ("idle", "briefing", "blue_win", "red_win", "draw", "aborted"):
            return
        if self.state.phase in ("blue_win", "red_win", "draw", "aborted", "idle"):
            self.reset(briefing=False)
        self.state.phase = "running"
        self.state.stage = "contact"
        self._emit("mission_start")
        self._emit("stage", "contact")

    def abort(self) -> None:
        if self.state.phase == "running":
            self.state.phase = "aborted"
            self._emit("abort")

    def set_input(self, keys: dict[str, Any], control_mode: str | None = None) -> None:
        for k in self._keys:
            if k in keys:
                self._keys[k] = bool(keys[k])
        if control_mode in ("observer", "blue"):
            self.state.control_mode = control_mode

    def _collides(self, x: float, y: float, rad: float = 0.9) -> bool:
        for w in self.state.walls:
            if x + rad > w.x and x - rad < w.x + w.w and y + rad > w.y and y - rad < w.y + w.h:
                return True
        return x < 2 or y < 2 or x > MAP_W - 2 or y > MAP_H - 2

    def _try_move(self, body: Body, dx: float, dy: float) -> None:
        nx, ny = body.x + dx, body.y + dy
        if not self._collides(nx, body.y):
            body.x = nx
        if not self._collides(body.x, ny):
            body.y = ny
        if abs(dx) + abs(dy) > 1e-6:
            body.yaw = math.atan2(dy, dx)

    def _in_zone(self, b: Body, z: Zone) -> bool:
        return (b.x - z.x) ** 2 + (b.y - z.y) ** 2 <= z.r ** 2

    def _dist(self, a: Body, b: Body) -> float:
        return math.hypot(a.x - b.x, a.y - b.y)

    def _aggression(self) -> float:
        return {
            "contact": 0.75,
            "clash": 1.0,
            "assault": 1.25,
            "endgame": 1.45,
        }.get(self.state.stage, 1.0)

    def _move_toward(self, body: Body, tx: float, ty: float, speed: float) -> None:
        dx, dy = tx - body.x, ty - body.y
        dist = math.hypot(dx, dy) or 1.0
        body.x = max(2.0, min(MAP_W - 2.0, body.x + (dx / dist) * speed * DT))
        body.y = max(2.0, min(MAP_H - 2.0, body.y + (dy / dist) * speed * DT))
        if dist > 0.15:
            body.yaw = math.atan2(dy, dx)

    def _push_away(self, body: Body, other: Body, strength: float) -> None:
        dx, dy = body.x - other.x, body.y - other.y
        dist = math.hypot(dx, dy) or 1.0
        body.x = max(2.0, min(MAP_W - 2.0, body.x + (dx / dist) * strength * DT))
        body.y = max(2.0, min(MAP_H - 2.0, body.y + (dy / dist) * strength * DT))

    def _reds(self) -> list[tuple[str, Body]]:
        return [(uid, u) for uid, u in self.state.units.items() if u.faction == "red"]

    def _blues(self) -> list[tuple[str, Body]]:
        return [(uid, u) for uid, u in self.state.units.items() if u.faction == "blue"]

    def _add_skirmish(self, a: str, b: str, kind: str) -> None:
        self.state.skirmishes.append({"a": a, "b": b, "kind": kind})

    def _active_waypoints(self) -> list[tuple[float, float]]:
        return self.state.waypoints_alt if self.state.route == "alt" else self.state.waypoints

    def _update_stage(self) -> None:
        old = self.state.stage
        t = self.state.t
        if t >= STAGE_ENDGAME:
            self.state.stage = "endgame"
        elif t >= STAGE_ASSAULT:
            self.state.stage = "assault"
        elif t >= STAGE_CLASH:
            self.state.stage = "clash"
        else:
            self.state.stage = "contact"
        if self.state.stage != old:
            self._emit("stage", self.state.stage)
            if self.state.stage == "clash" and not self.state.flags.get("ambush_sprung"):
                self.state.flags["ambush_sprung"] = True
                self.state.red_modes["red_d"] = "strike"
                self._emit("ambush", "red_d")
            if self.state.stage == "assault" and not self.state.flags.get("reinforcements"):
                self.state.flags["reinforcements"] = True
                # Heal/boost remaining units as "second wave"
                for uid in ("red_a", "red_b", "red_c"):
                    u = self.state.units.get(uid)
                    if u:
                        u.hp = min(100.0, u.hp + 35)
                        u.retreat = False
                        u.cooled = 0.0
                guard = self.state.units.get("blue_guard")
                if guard:
                    guard.hp = min(100.0, guard.hp + 25)
                self._emit("reinforcements", "assault_wave")
            if self.state.stage == "endgame":
                self.state.flags["endgame_push"] = True
                self.state.red_modes["red_c"] = "jam"
                self.state.blue_modes["blue_guard"] = "escort_help"

    def _handle_retreat(self, uid: str, body: Body, rally: tuple[float, float]) -> bool:
        """Return True if unit is busy retreating/healing."""
        if body.cooled > 0:
            body.cooled = max(0.0, body.cooled - DT)
            body.hp = min(100.0, body.hp + 12 * DT)
            self._move_toward(body, rally[0], rally[1], RED_SPEED * 0.55 if body.faction == "red" else BLUE_SPEED * 0.55)
            body.alt += (28 - body.alt) * 0.05
            if body.cooled <= 0:
                body.retreat = False
                self._emit("reengage", uid)
            return True
        if body.hp <= RETREAT_HP and not body.retreat:
            body.retreat = True
            body.cooled = 6.0 + random.uniform(0, 2)
            self._emit("retreat", uid)
            return True
        if body.retreat:
            self._move_toward(body, rally[0], rally[1], (RED_SPEED if body.faction == "red" else BLUE_SPEED) * 0.9)
            return True
        return False

    def _steer_keys(self, body: Body, speed: float, jam_slow: bool = False) -> None:
        k = self._keys
        drop = jam_slow and self.state.jammed and random.random() < 0.28
        if not drop:
            vx = (1 if k["d"] else 0) - (1 if k["a"] else 0)
            vy = (1 if k["s"] else 0) - (1 if k["w"] else 0)
            if vx or vy:
                n = math.hypot(vx, vy) or 1.0
                sp = speed * (0.5 if jam_slow and self.state.jammed else 1.0)
                # Player flies over buildings for fair combat
                body.x = max(2.0, min(MAP_W - 2.0, body.x + (vx / n) * sp * DT))
                body.y = max(2.0, min(MAP_H - 2.0, body.y + (vy / n) * sp * DT))
                body.yaw = math.atan2(vy, vx)
        if k["r"]:
            body.alt = min(ALT_MAX, body.alt + ALT_RATE * DT)
        if k["f"]:
            body.alt = max(ALT_MIN, body.alt - ALT_RATE * DT)
        if k["q"]:
            body.yaw -= YAW_RATE * DT
        if k["e"]:
            body.yaw += YAW_RATE * DT

    def _step_observer(self) -> None:
        if self.state.control_mode != "observer":
            return
        obs = self.state.units["observer"]
        k = self._keys
        forward = (1 if k["w"] else 0) - (1 if k["s"] else 0)
        strafe = (1 if k["d"] else 0) - (1 if k["a"] else 0)
        if k["q"]:
            obs.yaw -= YAW_RATE * DT
        if k["e"]:
            obs.yaw += YAW_RATE * DT
        c, s = math.cos(obs.yaw), math.sin(obs.yaw)
        dx = (forward * c - strafe * s) * OBS_SPEED * DT
        dy = (forward * s + strafe * c) * OBS_SPEED * DT
        obs.x = max(2, min(MAP_W - 2, obs.x + dx))
        obs.y = max(2, min(MAP_H - 2, obs.y + dy))
        if k["r"]:
            obs.alt = min(ALT_MAX, obs.alt + ALT_RATE * 1.4 * DT)
        if k["f"]:
            obs.alt = max(8.0, obs.alt - ALT_RATE * 1.4 * DT)

    def _step_relay(self) -> None:
        blues = sum(1 for _, u in self._blues() if self._in_zone(u, self.state.relay_zone))
        reds = sum(1 for _, u in self._reds() if self._in_zone(u, self.state.relay_zone))
        if blues > reds and blues > 0:
            self.state.relay_holder = "blue"
            self.state.relay_s = min(self.state.relay_need, self.state.relay_s + DT * (0.8 + 0.25 * blues))
            self.state.suppress_s += DT * 0.35
        elif reds > blues and reds > 0:
            self.state.relay_holder = "red"
            self.state.relay_s = min(self.state.relay_need, self.state.relay_s + DT * (0.8 + 0.25 * reds))
            self.state.jam_s += DT * 0.25
            self.state.link_quality = max(0.12, self.state.link_quality - 0.008)
        else:
            self.state.relay_holder = "none"
            self.state.relay_s = max(0.0, self.state.relay_s - DT * 0.35)

    def _step_blue(self) -> None:
        lead = self.state.units["blue_lead"]
        wing = self.state.units["blue_wing"]
        guard = self.state.units["blue_guard"]
        vip = self.state.units["vip"]
        agg = self._aggression()
        threats = sorted(
            ((self._dist(vip, r), uid, r) for uid, r in self._reds() if not r.retreat),
            key=lambda t: t[0],
        )
        nearest_d, nearest_id, nearest = (threats[0] if threats else (999.0, "", None))

        if self._handle_retreat("blue_lead", lead, (25, 90)):
            pass
        elif self.state.control_mode == "blue":
            self._steer_keys(lead, BLUE_SPEED, jam_slow=True)
            self.state.blue_modes["blue_lead"] = "player"
        else:
            if nearest and nearest_d < INTERCEPT_RANGE * (1.1 if self.state.stage != "contact" else 0.85):
                self.state.blue_modes["blue_lead"] = "intercept"
                tx = nearest.x * 0.72 + vip.x * 0.28
                ty = nearest.y * 0.72 + vip.y * 0.28
                self._move_toward(lead, tx, ty, BLUE_SPEED * agg)
                lead.alt += (nearest.alt + 2 - lead.alt) * 0.07
                if nearest_d < ENGAGE_RANGE:
                    nearest.hp = max(8, nearest.hp - 15 * DT * agg)
                    lead.hp = max(32, lead.hp - 4.5 * DT)
                    self.state.suppress_s += DT * 1.5
                    self._add_skirmish("blue_lead", nearest_id, "intercept")
                    self._push_away(nearest, lead, PUSH_STRENGTH * 1.15)
            else:
                self.state.blue_modes["blue_lead"] = "escort"
                wps = self._active_waypoints()
                if self.state.vip_wp < len(wps):
                    nx, ny = wps[self.state.vip_wp]
                    dx, dy = nx - vip.x, ny - vip.y
                    n = math.hypot(dx, dy) or 1
                    tx, ty = vip.x + dx / n * 11, vip.y + dy / n * 11
                else:
                    tx, ty = vip.x - 6, vip.y
                self._move_toward(lead, tx, ty, BLUE_SPEED * 0.88)
                lead.alt += (16 - lead.alt) * 0.04

        # Wing
        if not self._handle_retreat("blue_wing", wing, (20, 100)):
            fx, fy = math.cos(lead.yaw), math.sin(lead.yaw)
            lx, ly = -fy, fx
            form_x = lead.x - fx * 8 + lx * 6
            form_y = lead.y - fy * 8 + ly * 6
            # Prefer jammer / flanker as secondary
            pick = None
            for d, uid, r in threats:
                if uid != nearest_id and d < INTERCEPT_RANGE + 10:
                    pick = (d, uid, r)
                    break
            if not pick and threats:
                pick = threats[0]
            if pick and pick[0] < INTERCEPT_RANGE + 8 and self.state.stage != "contact":
                self.state.blue_modes["blue_wing"] = "duel"
                wd, wid, wr = pick
                self._move_toward(wing, wr.x, wr.y, BLUE_SPEED * 1.05 * agg)
                wing.alt += (wr.alt - wing.alt) * 0.08
                if wd < ENGAGE_RANGE + 2:
                    wr.hp = max(8, wr.hp - 13 * DT * agg)
                    wing.hp = max(30, wing.hp - 4 * DT)
                    self.state.suppress_s += DT * 1.2
                    self._add_skirmish("blue_wing", wid, "suppress")
                    self._push_away(wr, wing, PUSH_STRENGTH)
            else:
                self.state.blue_modes["blue_wing"] = "form"
                self._move_toward(wing, form_x, form_y, BLUE_SPEED * 0.95)
                wing.yaw = lead.yaw
                wing.alt += (lead.alt - 1.5 - wing.alt) * 0.05

        # Guard: picket mid relay, then help VIP in endgame
        if not self._handle_retreat("blue_guard", guard, (90, 75)):
            mode = self.state.blue_modes.get("blue_guard", "picket")
            if self.state.stage in ("assault", "endgame") or mode == "escort_help":
                self.state.blue_modes["blue_guard"] = "escort_help"
                # Screen VIP rear / chase nearest to VIP
                if nearest and nearest_d < 45:
                    self._move_toward(guard, nearest.x, nearest.y, BLUE_SPEED * 1.1 * agg)
                    if nearest_d < ENGAGE_RANGE + 4:
                        nearest.hp = max(10, nearest.hp - 11 * DT * agg)
                        guard.hp = max(28, guard.hp - 3.5 * DT)
                        self._add_skirmish("blue_guard", nearest_id, "suppress")
                else:
                    self._move_toward(guard, vip.x - 10, vip.y + 6, BLUE_SPEED)
            else:
                self.state.blue_modes["blue_guard"] = "picket"
                # Contest relay + choke
                rz = self.state.relay_zone
                self._move_toward(guard, rz.x + 4, rz.y - 3, BLUE_SPEED * 0.9)
                guard.alt += (18 - guard.alt) * 0.05
                for rid, red in self._reds():
                    if self._dist(guard, red) < ENGAGE_RANGE:
                        red.hp = max(12, red.hp - 9 * DT)
                        guard.hp = max(30, guard.hp - 3 * DT)
                        self._add_skirmish("blue_guard", rid, "clash")

        for rid, red in self._reds():
            d = min(self._dist(lead, red), self._dist(wing, red), self._dist(guard, red))
            if d < 12:
                red.hp = max(12, red.hp - 5 * DT)
                self.state.suppress_s += DT * 0.45

    def _step_vip(self) -> None:
        vip = self.state.units["vip"]
        wps = self._active_waypoints()
        if self.state.vip_wp >= len(wps):
            return

        # Dynamic route switch under pressure (once)
        pressure = 0.0
        for _, red in self._reds():
            d = self._dist(vip, red)
            if d < HUNTER_RANGE:
                pressure = max(pressure, 1.0 - d / HUNTER_RANGE)
                if d < ENGAGE_RANGE:
                    vip.hp = max(18, vip.hp - 5.5 * DT * self._aggression())
                    self._add_skirmish(_, "vip", "hunt")
                    self._push_away(vip, red, PUSH_STRENGTH * 0.3)

        if (
            pressure > 0.55
            and self.state.route == "main"
            and not self.state.flags.get("route_switched")
            and self.state.vip_wp < 5
            and self.state.t > 18
        ):
            self.state.route = "alt"
            self.state.flags["route_switched"] = True
            # Snap to nearest alt waypoint index
            best_i, best_d = 0, 1e9
            for i, (ax, ay) in enumerate(self.state.waypoints_alt):
                dd = math.hypot(vip.x - ax, vip.y - ay)
                if dd < best_d:
                    best_d, best_i = dd, i
            self.state.vip_wp = best_i
            wps = self._active_waypoints()
            self._emit("route_switch", "alt_south")

        tx, ty = wps[self.state.vip_wp]
        dx, dy = tx - vip.x, ty - vip.y
        dist = math.hypot(dx, dy)
        if dist < 2.2:
            self.state.vip_wp += 1
            if self.state.vip_wp >= len(wps):
                self._emit("vip_arrived")
            return

        lead = self.state.units["blue_lead"]
        escort = 1.0 if self._dist(vip, lead) < 26 else 0.38
        contested = max(0.32, 1.0 - 0.55 * pressure)
        # Relay held by blue speeds VIP slightly
        if self.state.relay_holder == "blue":
            escort *= 1.12
        factor = escort * contested
        self._try_move(vip, (dx / dist) * VIP_SPEED * factor * DT, (dy / dist) * VIP_SPEED * factor * DT)
        vip.alt += (lead.alt + 1 - vip.alt) * 0.04
        vip.yaw = math.atan2(dy, dx)

    def _step_red_one(self, uid: str) -> None:
        red = self.state.units[uid]
        vip = self.state.units["vip"]
        lead = self.state.units["blue_lead"]
        wing = self.state.units["blue_wing"]
        guard = self.state.units["blue_guard"]
        kz = self.state.keep_zone
        jz = self.state.jam_zone
        rz = self.state.relay_zone
        agg = self._aggression()
        hp_factor = 0.38 + 0.62 * (red.hp / 100.0)
        rallies = {
            "red_a": (210, 150),
            "red_b": (210, 20),
            "red_c": (230, 110),
            "red_d": (70, 15),
        }
        if self._handle_retreat(uid, red, rallies.get(uid, (220, 85))):
            self.state.red_modes[uid] = "retreat"
            return

        if uid == "red_a":
            # Hunter — stalk then dive; in endgame all-in VIP
            if self.state.stage == "contact":
                mode = "stalk"
                self._move_toward(red, vip.x + 25, vip.y + 18, RED_SPEED * 0.7 * hp_factor)
                red.alt += (30 - red.alt) * 0.06  # high recon
            elif self.state.stage == "endgame" or self._dist(red, vip) < HUNTER_RANGE:
                mode = "hunt"
                self._move_toward(red, vip.x, vip.y, RED_SPEED * 1.25 * hp_factor * agg)
                red.alt += (vip.alt + 3 - red.alt) * 0.12
                if self._dist(red, vip) < ENGAGE_RANGE:
                    vip.hp = max(12, vip.hp - 8 * DT * agg)
                    self._add_skirmish(uid, "vip", "hunt")
                if self._dist(red, lead) < 15:
                    lead.hp = max(28, lead.hp - 9 * DT * agg)
                    red.hp = max(8, red.hp - 7 * DT)
                    self._add_skirmish(uid, "blue_lead", "clash")
            else:
                mode = "infiltrate"
                self._move_toward(red, kz.x - 8, kz.y + 10, RED_SPEED * hp_factor)
            self.state.red_modes[uid] = mode

        elif uid == "red_b":
            if self._dist(red, wing) < 20 and self.state.stage != "contact":
                mode = "duel"
                self._move_toward(red, wing.x, wing.y, RED_SPEED * 1.15 * hp_factor * agg)
                if self._dist(red, wing) < ENGAGE_RANGE:
                    wing.hp = max(25, wing.hp - 12 * DT * agg)
                    red.hp = max(8, red.hp - 8 * DT)
                    self._add_skirmish(uid, "blue_wing", "clash")
            elif self._in_zone(red, kz) or self.state.stage == "endgame":
                mode = "occupy"
                self._move_toward(red, kz.x + 3, kz.y - 4, RED_SPEED * 0.7 * hp_factor)
            elif self.state.stage in ("clash", "assault") and self._dist(red, rz) < 40:
                mode = "relay_grab"
                self._move_toward(red, rz.x, rz.y + 6, RED_SPEED * hp_factor * agg)
                if self._dist(red, guard) < ENGAGE_RANGE:
                    guard.hp = max(25, guard.hp - 10 * DT)
                    red.hp = max(10, red.hp - 6 * DT)
                    self._add_skirmish(uid, "blue_guard", "clash")
            else:
                mode = "flank"
                gate = (125.0, 145.0) if red.x < 140 else (kz.x + 2, kz.y - 10)
                self._move_toward(red, gate[0], gate[1], RED_SPEED * hp_factor)
            red.alt += (17 - red.alt) * 0.05
            self.state.red_modes[uid] = mode

        elif uid == "red_c":
            if self.state.stage == "contact":
                mode = "standby"
                self._move_toward(red, 215, 100, RED_SPEED * 0.5)
                red.alt += (32 - red.alt) * 0.05
            elif self._in_zone(red, jz) or self.state.stage == "endgame":
                mode = "jam"
                self._move_toward(red, jz.x, jz.y, RED_SPEED * 0.45 * hp_factor)
                red.alt += (28 - red.alt) * 0.07
            elif self._dist(red, lead) < 18:
                mode = "harass"
                self._move_toward(red, lead.x, lead.y, RED_SPEED * 0.95 * hp_factor)
                if self._dist(red, lead) < ENGAGE_RANGE:
                    lead.hp = max(28, lead.hp - 6 * DT)
                    self.state.link_quality = max(0.12, self.state.link_quality - 0.025)
                    self._add_skirmish(uid, "blue_lead", "jam")
            else:
                mode = "jam_push"
                self._move_toward(red, jz.x, jz.y, RED_SPEED * 0.95 * hp_factor)
                red.alt += (24 - red.alt) * 0.05
            self.state.red_modes[uid] = mode

        else:  # red_d ambusher
            mode = self.state.red_modes.get(uid, "hide")
            if mode == "hide" and self.state.stage == "contact":
                # Low & masked near southern buildings
                self._move_toward(red, 100, 28, RED_SPEED * 0.4)
                red.alt += (8 - red.alt) * 0.08
            else:
                mode = "strike"
                # Spring onto VIP / lead from south
                target = vip if self._dist(red, vip) < self._dist(red, lead) else lead
                tid = "vip" if target is vip else "blue_lead"
                self._move_toward(red, target.x, target.y, RED_SPEED * 1.3 * hp_factor * agg)
                red.alt += (target.alt + 2 - red.alt) * 0.1
                if self._dist(red, target) < ENGAGE_RANGE:
                    target.hp = max(15, target.hp - 10 * DT * agg)
                    red.hp = max(8, red.hp - 5 * DT)
                    self._add_skirmish(uid, tid, "ambush")
            self.state.red_modes[uid] = mode

        red.yaw = math.atan2(vip.y - red.y, vip.x - red.x)

    def _step_reds(self) -> None:
        self._step_red_one("red_a")
        self._step_red_one("red_b")
        self._step_red_one("red_c")
        self._step_red_one("red_d")
        self.state.skirmishes = self.state.skirmishes[:14]

    def _record_trails(self) -> None:
        self._trail_i += 1
        if self._trail_i % TRAIL_EVERY:
            return
        for uid, body in self.state.units.items():
            if uid == "observer":
                continue
            trail = self.state.trails.setdefault(uid, [])
            trail.append({"x": round(body.x, 2), "y": round(body.y, 2), "alt": round(body.alt, 1)})
            if len(trail) > TRAIL_MAX:
                del trail[:-TRAIL_MAX]

    def _score(self) -> None:
        occupy_live = self.state.t >= 14.0
        reds_in = [u for _, u in self._reds() if self._in_zone(u, self.state.keep_zone) and not u.retreat]
        if occupy_live and reds_in:
            self.state.occupy_s += DT * (0.65 + 0.28 * len(reds_in))
        else:
            self.state.occupy_s = max(0.0, self.state.occupy_s - DT * 0.18)

        jammer = self.state.units["red_c"]
        jammed = (
            self.state.t >= 12.0
            and self._in_zone(jammer, self.state.jam_zone)
            and self.state.red_modes.get("red_c") == "jam"
            and not jammer.retreat
        )
        self.state.jammed = jammed
        if jammed:
            self.state.jam_s += DT * (1.15 if self.state.relay_holder == "red" else 1.0)
            self.state.link_quality = max(0.1, self.state.link_quality - 0.012)
        else:
            self.state.link_quality = min(1.0, self.state.link_quality + 0.004)

        # Red wins
        if self.state.occupy_s >= self.state.occupy_need:
            self.state.phase = "red_win"
            self._emit("red_win", "occupy")
            return
        if self.state.jam_s >= self.state.jam_need:
            self.state.phase = "red_win"
            self._emit("red_win", "jam")
            return
        if self.state.relay_s >= self.state.relay_need and self.state.relay_holder == "red" and self.state.jam_s > 8:
            self.state.phase = "red_win"
            self._emit("red_win", "relay_jam")
            return
        vip = self.state.units["vip"]
        if vip.hp <= 15:
            self.state.phase = "red_win"
            self._emit("red_win", "vip_broken")
            return

        vip_done = self.state.vip_wp >= len(self._active_waypoints())
        if vip_done and self.state.occupy_s < self.state.occupy_need * 0.4:
            self.state.phase = "blue_win"
            self._emit("blue_win", "escort")
            return
        if self.state.suppress_s >= SUPPRESS_NEED and vip_done:
            self.state.phase = "blue_win"
            self._emit("blue_win", "escort_suppress")
            return
        if self.state.relay_s >= self.state.relay_need and self.state.relay_holder == "blue" and vip_done:
            self.state.phase = "blue_win"
            self._emit("blue_win", "relay_escort")
            return

        if self.state.t >= self.state.time_limit:
            if vip_done and self.state.occupy_s < 5:
                self.state.phase = "blue_win"
                self._emit("blue_win", "timeout")
            elif self.state.occupy_s >= 5 or self.state.jam_s >= self.state.jam_need * 0.6:
                self.state.phase = "red_win"
                self._emit("red_win", "timeout")
            else:
                self.state.phase = "draw"
                self._emit("draw", "timeout")

    def tick(self) -> None:
        if self.state.phase != "running":
            if self.state.phase in ("briefing", "idle"):
                self._step_observer()
            return
        self.state.t += DT
        self.state.skirmishes = []
        self._update_stage()
        self._step_observer()
        self._step_blue()
        self._step_vip()
        self._step_reds()
        self._step_relay()
        self._record_trails()
        self._score()

    def snapshot(self) -> dict[str, Any]:
        s = self.state
        return {
            "type": "state",
            "version": 4,
            "mission_id": s.mission_id,
            "phase": s.phase,
            "stage": s.stage,
            "t": round(s.t, 2),
            "time_limit": s.time_limit,
            "brief": s.brief,
            "control_mode": s.control_mode,
            "map": {"w": MAP_W, "h": MAP_H},
            "units": {k: _body_dict(v) for k, v in s.units.items()},
            "blue": _body_dict(s.units["blue_lead"]),
            "vip": _body_dict(s.units["vip"]),
            "red": _body_dict(s.units["red_a"]),
            "observer": _body_dict(s.units["observer"]),
            "red_mode": s.red_modes.get("red_a", "stalk"),
            "red_modes": s.red_modes,
            "blue_modes": s.blue_modes,
            "skirmishes": s.skirmishes,
            "route": s.route,
            "keep_zone": asdict(s.keep_zone),
            "jam_zone": asdict(s.jam_zone),
            "relay_zone": asdict(s.relay_zone),
            "walls": [asdict(w) for w in s.walls],
            "waypoints": [{"x": x, "y": y} for x, y in self._active_waypoints()],
            "vip_wp": s.vip_wp,
            "occupy": {"current": round(s.occupy_s, 2), "need": s.occupy_need},
            "jam": {
                "current": round(s.jam_s, 2),
                "need": s.jam_need,
                "link_quality": round(s.link_quality, 2),
                "active": s.jammed,
            },
            "relay": {
                "current": round(s.relay_s, 2),
                "need": s.relay_need,
                "holder": s.relay_holder,
            },
            "suppress": {"current": round(s.suppress_s, 2), "need": SUPPRESS_NEED},
            "trails": s.trails,
            "factions": {
                "blue": ["blue_lead", "blue_wing", "blue_guard", "vip"],
                "red": ["red_a", "red_b", "red_c", "red_d"],
                "observer": ["observer"],
            },
            "events": s.events[-18:],
        }

    async def broadcast(self) -> None:
        if not self._clients:
            return
        payload = json.dumps(self.snapshot())
        dead = []
        for ws in list(self._clients):
            try:
                await ws.send_text(payload)
            except Exception:  # noqa: BLE001
                dead.append(ws)
        for ws in dead:
            self._clients.discard(ws)

    async def loop(self) -> None:
        try:
            while True:
                async with self._lock:
                    self.tick()
                await self.broadcast()
                await asyncio.sleep(DT)
        except asyncio.CancelledError:
            return


ENGINE = ArenaEngine()


@router.get("/sim/arena/health")
async def arena_health() -> dict:
    return {
        "status": "ok",
        "phase": ENGINE.state.phase,
        "stage": ENGINE.state.stage,
        "clients": len(ENGINE._clients),
        "map": {"w": MAP_W, "h": MAP_H},
        "version": 4,
    }


@router.get("/sim/arena/audit")
async def arena_audit(limit: int = 50) -> dict:
    lines = []
    if AUDIT_PATH.exists():
        for line in AUDIT_PATH.read_text(encoding="utf-8").strip().splitlines()[-max(1, min(limit, 200)):]:
            try:
                lines.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    return {"items": lines}


@router.websocket("/sim/arena")
async def arena_ws(websocket: WebSocket) -> None:
    await websocket.accept()
    ENGINE._clients.add(websocket)
    if ENGINE._task is None or ENGINE._task.done():
        ENGINE._task = asyncio.create_task(ENGINE.loop())
    if ENGINE.state.phase == "idle":
        ENGINE.reset(briefing=True)
    await websocket.send_text(json.dumps(ENGINE.snapshot()))
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            mtype = msg.get("type")
            async with ENGINE._lock:
                if mtype == "start":
                    ENGINE.start()
                elif mtype == "abort":
                    ENGINE.abort()
                elif mtype == "reset":
                    ENGINE.reset(briefing=True)
                elif mtype == "input":
                    ENGINE.set_input(msg.get("keys") or {}, msg.get("control_mode"))
                elif mtype == "set_mode":
                    mode = msg.get("control_mode")
                    if mode in ("observer", "blue"):
                        ENGINE.state.control_mode = mode
            if mtype in ("start", "reset", "abort", "set_mode"):
                await websocket.send_text(json.dumps(ENGINE.snapshot()))
    except WebSocketDisconnect:
        pass
    finally:
        ENGINE._clients.discard(websocket)
        if not ENGINE._clients and ENGINE._task and not ENGINE._task.done():
            ENGINE._task.cancel()
