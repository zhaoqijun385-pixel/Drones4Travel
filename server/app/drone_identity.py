"""Physical Crazyflie identity for the Real Drone SPA.

Reads server/config.json -> "drone" (radio_uri / channel / address).
Public endpoint: the values are not secrets and the Host/Viewer pages
must show which airframe the stack is wired to.
"""

from __future__ import annotations

from fastapi import APIRouter

from .config import CONFIG

router = APIRouter(tags=["drone-identity"])

_DEFAULT = {
    "name": "project-cf",
    "radio_uri": "radio://0/87/2M/E7E787A91D",
    "radio_channel": 87,
    "radio_datarate": "2M",
    "radio_address": "E7E787A91D",
    "min_fly_voltage": 3.9,
}


@router.get("/drone/identity")
async def drone_identity() -> dict:
    d = CONFIG.get("drone") or {}
    out = {**_DEFAULT}
    for k in _DEFAULT:
        if k in d and d[k] not in (None, ""):
            out[k] = d[k]
    # also surface telemetry token presence (not the value)
    out["telemetry_token_set"] = bool(d.get("telemetry_token"))
    return out
