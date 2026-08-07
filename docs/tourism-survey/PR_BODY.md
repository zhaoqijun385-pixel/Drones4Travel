## Summary

Adds Tourism Survey Task1/Task2 as a dry-run sidelane: place geocoding → N viewpoints/routes → Cesium preview → mission state machine (takeoff/move/hover/photo/rtl/land) with placeholder photos, pause/cancel/retry, and WebSocket updates. Default remains dry-run (no Crazyflie radio). Follow-up fixes for review: remove duplicate `urlopen`, make `ensure_survey_wired.py` use `SURVEY_TASKS_SRC` (no hard-coded `/mnt/h/...`), and add unit tests for survey planning/mission dry-run.

## Related Issue

- Partially addresses #1 (address input / geocode via Google Geocoding + Nominatim fallback; alias hints for offline)
- Addresses #2 with a generalized N-point circular viewpoint generator (`_viewpoints`) instead of a fixed 5-angle hardcode
- Partially addresses #3 (plan/mission JSON persisted under `server/data/survey/`; schema alignment with Issue #3 still iterative)
- Partially addresses #4 (takeoff/move/hover/photo/return/land command log + dry-run executor; live radio bridge not in this PR)
- Partially addresses #5 (photos linked to mission/shots; placeholder images + telemetry_tail; EXIF GPS not yet written)

## Type of Change

- [ ] Bug fix
- [x] New feature
- [ ] Refactor / code cleanup
- [x] Documentation
- [ ] Performance
- [x] CI / tooling

## Safety Impact (for drone-control changes)

- [ ] No drone-control changes — skip this section.
- [x] Sim-only tested (`CF_NO_FLY=1` or fleet_simulator)
- [ ] Bench tested (no propellers / safety rig)
- [ ] Low-altitude flight tested
- [ ] Multi-drone tested
- [x] Safety note added below:

**Safety notes (if applicable):**

Survey API defaults to `dry_run=True` and does not touch Crazyflie radio. Small bridge/script tweaks keep local video defaults safe (`CF_NO_FLY=1` in start scripts; MediaMTX local ICE skip is env-gated). No flight/bench evidence claimed for live capture in this PR.

## Test Plan

- [ ] `npm run test:fleet` passes
- [ ] `npm run build` passes
- [x] `PYTHONPATH=server python -m unittest tests.test_survey_mission -v` passes (from `server/`)
- [x] Manual API dry-run: plan → create → start → completed with placeholder photos
- [ ] Manual browser check at `http://localhost:5173/survey-mission`

## Screenshots (if UI change)

N/A in this update (API/wiring/tests + docs). UI lives at `/survey-mission`.
