"""Unit tests for tourism survey Task1/Task2 (dry-run)."""
from __future__ import annotations

import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import app.survey_mission as sm
from app.survey_mission import (
    GeocodeError,
    MissionCreate,
    PlanRequest,
    _assign_drones,
    _build_plan,
    _geocode,
    _hint_geocode,
    _missions,
    _viewpoints,
    cancel_mission,
    create_mission,
    create_plan,
    get_mission,
    pause_mission,
    start_mission,
)
from app import drone_identity as drone_identity_mod


def _plans_path() -> Path:
    return sm.DATA_DIR / "plans.json"


def _read_plans() -> dict:
    path = _plans_path()
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def _write_plan(plan: dict) -> None:
    sm.DATA_DIR.mkdir(parents=True, exist_ok=True)
    plans = _read_plans()
    plans[plan["plan_id"]] = plan
    _plans_path().write_text(json.dumps(plans, ensure_ascii=False, indent=2), encoding="utf-8")


class ViewpointTests(unittest.TestCase):
    def test_five_points_around_center(self):
        pts = _viewpoints(30.242, 120.148, 80.0, 25.0, 5)
        self.assertEqual(5, len(pts))
        for p in pts:
            self.assertIn("lat", p)
            self.assertIn("lng", p)
            self.assertEqual(25.0, p["alt_m"])
        coords = {(p["lat"], p["lng"]) for p in pts}
        self.assertEqual(5, len(coords))

    def test_assign_drones_round_robin(self):
        vps = _viewpoints(30.0, 120.0, 50.0, 20.0, 4)
        shots = _assign_drones(vps, drone_count=2)
        self.assertEqual(["drone_1", "drone_2", "drone_1", "drone_2"], [s["drone_id"] for s in shots])
        self.assertEqual(["shot_1", "shot_2", "shot_3", "shot_4"], [s["shot_id"] for s in shots])


class GeocodeHintTests(unittest.TestCase):
    def test_alias_west_lake(self):
        g = _hint_geocode("西湖")
        self.assertIsNotNone(g)
        self.assertEqual("alias", g["provider"])
        self.assertAlmostEqual(30.242, g["lat"], places=3)

    def test_geocode_empty_raises(self):
        with self.assertRaises(GeocodeError):
            _geocode("  ")

    def test_geocode_uses_alias_without_network(self):
        g = _geocode("西湖")
        self.assertEqual("alias", g["provider"])


class PlanMissionUnitTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        root = Path(self._tmpdir.name)
        sm.DATA_DIR = root
        sm.PHOTO_DIR = root / "photos"
        sm.STORE_PATH = root / "missions.json"
        sm.PHOTO_DIR.mkdir(parents=True, exist_ok=True)
        _missions.clear()
        sm._runners.clear()

    async def asyncTearDown(self):
        for task in list(sm._runners.values()):
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass
        sm._runners.clear()
        _missions.clear()
        self._tmpdir.cleanup()

    def test_build_plan_alias(self):
        plan = _build_plan(
            PlanRequest(place="西湖", radius_m=80, min_alt_m=25, photo_count=5, drone_count=1)
        )
        self.assertEqual(5, len(plan["viewpoints"]))
        self.assertEqual(5, len(plan["shots"]))
        self.assertFalse(plan["street_view"])
        self.assertIn("drone_1", plan["routes"])

    async def test_create_plan_endpoint(self):
        plan = await create_plan(PlanRequest(place="西湖", photo_count=5))
        plans = _read_plans()
        self.assertIn(plan["plan_id"], plans)
        self.assertEqual(5, plan["photo_count"])

    async def test_dry_run_start_pause_cancel(self):
        plan = _build_plan(PlanRequest(place="西湖", photo_count=5, drone_count=1))
        _write_plan(plan)
        mission = await create_mission(MissionCreate(plan_id=plan["plan_id"], dry_run=True))
        mid = mission["mission_id"]
        self.assertEqual("ready", mission["status"])

        with patch("app.survey_mission._async_sleep", new_callable=AsyncMock):
            started = await start_mission(mid)
            self.assertIn(started["status"], ("running", "ready", "completed"))
            # Yield so the runner can take the lock and progress (may finish instantly).
            for _ in range(50):
                await asyncio.sleep(0)
                cur = await get_mission(mid)
                if cur["status"] in ("running", "completed", "cancelled", "failed", "paused"):
                    break
            cur = await get_mission(mid)
            if cur["status"] == "running":
                paused = await pause_mission(mid)
                self.assertIn(paused["status"], ("paused", "completed", "running", "cancelled"))
            else:
                self.assertIn(cur["status"], ("completed", "cancelled", "failed", "paused", "ready"))
            cancelled = await cancel_mission(mid)
            self.assertIn(cancelled["status"], ("cancelled", "completed"))

    async def test_dry_run_completes_with_photos(self):
        plan = _build_plan(PlanRequest(place="西湖", photo_count=5, drone_count=1))
        _write_plan(plan)
        mission = await create_mission(MissionCreate(plan_id=plan["plan_id"], dry_run=True))
        mid = mission["mission_id"]
        with patch("app.survey_mission._async_sleep", new_callable=AsyncMock):
            await start_mission(mid)
            for _ in range(200):
                m = await get_mission(mid)
                if m["status"] in ("completed", "failed", "cancelled"):
                    break
                await asyncio.sleep(0)
            m = await get_mission(mid)
        self.assertEqual("completed", m["status"])
        self.assertEqual(5, len(m["shots"]))
        for sh in m["shots"]:
            self.assertEqual("done", sh["status"])
            self.assertTrue(sh.get("photo_url"))
            self.assertTrue(sh.get("photo_path"))
            self.assertTrue(Path(sh["photo_path"]).exists())
            self.assertGreaterEqual(len(sh.get("telemetry_tail") or sh.get("telemetry") or []), 1)


class DroneIdentityTests(unittest.IsolatedAsyncioTestCase):
    async def test_identity_defaults(self):
        out = await drone_identity_mod.drone_identity()
        self.assertIn("radio_uri", out)
        self.assertTrue(str(out["radio_uri"]).startswith("radio://"))
        self.assertIn("telemetry_token_set", out)


class EnsureScriptTests(unittest.TestCase):
    def test_resolve_src_none_without_hardcoded_mount(self):
        import importlib.util

        path = Path(__file__).resolve().parents[2] / "scripts" / "ensure_survey_wired.py"
        spec = importlib.util.spec_from_file_location("ensure_survey_wired", path)
        mod = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        with patch.dict("os.environ", {"SURVEY_TASKS_SRC": ""}, clear=False):
            spec.loader.exec_module(mod)
            src = mod._resolve_src()
            if src is not None:
                self.assertNotEqual(str(src), "/mnt/h/cursor使用/旅游观测Tasks")
            text = path.read_text(encoding="utf-8")
            self.assertNotIn("/mnt/h/cursor", text)
            self.assertIn("SURVEY_TASKS_SRC", text)


if __name__ == "__main__":
    unittest.main()
