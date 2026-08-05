"""Multi-drone collaboration room and control-lease WebSockets.

Browser clients use ``/api/fleet/ws``. Drone bridge sessions publish telemetry
and receive validated commands through ``/api/fleet/publish``. The legacy
single-drone ``/api/drone/*`` routes remain untouched.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from fastapi_users.manager import BaseUserManager

from .config import CONFIG
from .drone_commands import _validate as validate_command
from .users import get_jwt_strategy, get_user_manager

logger = logging.getLogger(__name__)
router = APIRouter(tags=["fleet"])

LEASE_TTL_MS = 5_000
WEAK_AFTER_MS = 2_000
OFFLINE_AFTER_MS = 5_000
REAPER_INTERVAL_SECONDS = 0.5
ID_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{1,80}$")
DRONE_FIELDS = {
    "name", "color", "ownerId", "x", "y", "z", "lat", "lon", "alt",
    "roll", "pitch", "yaw", "battery", "streamId",
}
NUMERIC_FIELDS = {
    "x", "y", "z", "lat", "lon", "alt", "roll", "pitch", "yaw", "battery",
}


def now_ms() -> int:
    return int(time.time() * 1000)


def safe_id(value: Any, fallback: str) -> str:
    text = str(value or "")
    return text if ID_PATTERN.fullmatch(text) else fallback


@dataclass
class Lease:
    lease_id: str
    drone_id: str
    owner_client_id: str
    owner_user_id: str
    expires_at: int

    def public(self) -> dict:
        return {
            "leaseId": self.lease_id,
            "droneId": self.drone_id,
            "ownerClientId": self.owner_client_id,
            "ownerUserId": self.owner_user_id,
            "expiresAt": self.expires_at,
        }


class ControlLeaseManager:
    def __init__(self, ttl_ms: int = LEASE_TTL_MS):
        self.ttl_ms = ttl_ms
        self._leases: dict[str, Lease] = {}

    def get(self, drone_id: str, at: int | None = None) -> Lease | None:
        timestamp = at if at is not None else now_ms()
        lease = self._leases.get(drone_id)
        if lease and lease.expires_at <= timestamp:
            self._leases.pop(drone_id, None)
            return None
        return lease

    def claim(self, drone_id: str, client_id: str, user_id: str, at: int | None = None) -> tuple[bool, Lease]:
        timestamp = at if at is not None else now_ms()
        current = self.get(drone_id, timestamp)
        if current and current.owner_client_id != client_id:
            return False, current
        lease = Lease(
            lease_id=current.lease_id if current else uuid.uuid4().hex,
            drone_id=drone_id,
            owner_client_id=client_id,
            owner_user_id=user_id,
            expires_at=timestamp + self.ttl_ms,
        )
        self._leases[drone_id] = lease
        return True, lease

    def renew(self, drone_id: str, lease_id: str, client_id: str, at: int | None = None) -> Lease | None:
        timestamp = at if at is not None else now_ms()
        current = self.get(drone_id, timestamp)
        if not current or current.lease_id != lease_id or current.owner_client_id != client_id:
            return None
        current.expires_at = timestamp + self.ttl_ms
        return current

    def release(self, drone_id: str, lease_id: str, client_id: str) -> Lease | None:
        current = self._leases.get(drone_id)
        if not current or current.lease_id != lease_id or current.owner_client_id != client_id:
            return None
        return self._leases.pop(drone_id)

    def release_client(self, client_id: str) -> list[Lease]:
        released = [
            lease for lease in self._leases.values()
            if lease.owner_client_id == client_id
        ]
        for lease in released:
            self._leases.pop(lease.drone_id, None)
        return released

    def expire(self, at: int | None = None) -> list[Lease]:
        timestamp = at if at is not None else now_ms()
        expired = [
            lease for lease in self._leases.values()
            if lease.expires_at <= timestamp
        ]
        for lease in expired:
            self._leases.pop(lease.drone_id, None)
        return expired

    def snapshot(self, at: int | None = None) -> list[dict]:
        timestamp = at if at is not None else now_ms()
        self.expire(timestamp)
        return [lease.public() for lease in self._leases.values()]


@dataclass
class ClientPeer:
    websocket: WebSocket
    client_id: str
    user_id: str


@dataclass
class FleetRoom:
    room_id: str
    clients: dict[str, ClientPeer] = field(default_factory=dict)
    publishers: dict[str, WebSocket] = field(default_factory=dict)
    drones: dict[str, dict] = field(default_factory=dict)
    last_rx: dict[str, int] = field(default_factory=dict)
    leases: ControlLeaseManager = field(default_factory=ControlLeaseManager)
    shared_target: dict | None = None


class FleetHub:
    def __init__(self):
        self.rooms: dict[str, FleetRoom] = {}
        self.lock = asyncio.Lock()
        self._reaper_task: asyncio.Task | None = None

    async def start(self) -> None:
        if not self._reaper_task or self._reaper_task.done():
            self._reaper_task = asyncio.create_task(self._reaper())

    async def stop(self) -> None:
        if self._reaper_task:
            self._reaper_task.cancel()
            try:
                await self._reaper_task
            except asyncio.CancelledError:
                pass
            self._reaper_task = None

    def room(self, room_id: str) -> FleetRoom:
        if room_id not in self.rooms:
            self.rooms[room_id] = FleetRoom(room_id)
        return self.rooms[room_id]

    async def broadcast(self, room: FleetRoom, frame: dict, exclude: str = "") -> None:
        payload = json.dumps(frame)
        dead: list[str] = []
        for client_id, peer in list(room.clients.items()):
            if client_id == exclude:
                continue
            try:
                await peer.websocket.send_text(payload)
            except Exception:
                dead.append(client_id)
        for client_id in dead:
            room.clients.pop(client_id, None)

    async def publish_state(self, room: FleetRoom, drone_id: str, raw: dict) -> tuple[bool, dict]:
        current = room.drones.get(drone_id, {})
        try:
            sequence = int(raw.get("sequence", current.get("sequence", -1) + 1))
        except (TypeError, ValueError):
            return False, current
        if current and sequence <= int(current.get("sequence", -1)):
            return False, current

        state = dict(current)
        for key in DRONE_FIELDS:
            if key not in raw:
                continue
            value = raw[key]
            if key in NUMERIC_FIELDS:
                try:
                    value = float(value)
                except (TypeError, ValueError):
                    continue
            else:
                value = str(value)[:160]
            state[key] = value
        state.update({
            "droneId": drone_id,
            "roomId": room.room_id,
            "sequence": sequence,
            "timestamp": int(raw.get("timestamp") or now_ms()),
            "serverTimestamp": now_ms(),
            "online": True,
            "linkState": "online",
        })
        lease = room.leases.get(drone_id)
        state["controlOwnerId"] = lease.owner_user_id if lease else None
        room.drones[drone_id] = state
        room.last_rx[drone_id] = now_ms()
        await self.broadcast(room, {"type": "drone_update", **state})
        return True, state

    async def update_control_owner(self, room: FleetRoom, drone_id: str) -> None:
        state = room.drones.get(drone_id)
        if not state:
            return
        lease = room.leases.get(drone_id)
        state["controlOwnerId"] = lease.owner_user_id if lease else None
        state["serverTimestamp"] = now_ms()
        await self.broadcast(room, {"type": "drone_update", **state})

    async def _reaper(self) -> None:
        while True:
            await asyncio.sleep(REAPER_INTERVAL_SECONDS)
            timestamp = now_ms()
            for room in list(self.rooms.values()):
                for lease in room.leases.expire(timestamp):
                    await self.update_control_owner(room, lease.drone_id)
                    await self.broadcast(room, {
                        "type": "control_result",
                        "ok": False,
                        "reason": "lease_expired",
                        **lease.public(),
                    })
                for drone_id, last_rx in list(room.last_rx.items()):
                    state = room.drones.get(drone_id)
                    if not state:
                        continue
                    age = timestamp - last_rx
                    next_link = "offline" if age >= OFFLINE_AFTER_MS else "weak" if age >= WEAK_AFTER_MS else "online"
                    if state.get("linkState") == next_link:
                        continue
                    state["linkState"] = next_link
                    state["online"] = next_link != "offline"
                    state["serverTimestamp"] = timestamp
                    event_type = "drone_offline" if next_link == "offline" else "drone_update"
                    await self.broadcast(room, {"type": event_type, **state})


HUB = FleetHub()


def _publisher_token() -> str:
    return CONFIG.get("drone", {}).get("telemetry_token", "") or ""


async def _browser_identity(
    websocket: WebSocket,
    user_manager: BaseUserManager = Depends(get_user_manager),
) -> tuple[str, str] | None:
    token = websocket.query_params.get("token", "")
    user = await get_jwt_strategy().read_token(token, user_manager)
    if not user or not getattr(user, "is_active", False):
        return None
    client_id = safe_id(websocket.query_params.get("clientId"), f"web-{uuid.uuid4().hex[:12]}")
    return client_id, str(user.id)


async def _send_control_result(peer: ClientPeer, ok: bool, reason: str, lease: Lease | None, drone_id: str) -> None:
    frame = {"type": "control_result", "ok": ok, "reason": reason, "droneId": drone_id}
    if lease:
        frame.update(lease.public())
    await peer.websocket.send_text(json.dumps(frame))


@router.websocket("/fleet/ws")
async def fleet_browser(
    websocket: WebSocket,
    user_manager: BaseUserManager = Depends(get_user_manager),
) -> None:
    identity = await _browser_identity(websocket, user_manager)
    if not identity:
        await websocket.close(code=4401)
        return
    client_id, user_id = identity
    room_id = safe_id(websocket.query_params.get("roomId"), "default")
    await websocket.accept()
    await HUB.start()
    room = HUB.room(room_id)
    peer = ClientPeer(websocket, client_id, user_id)

    async with HUB.lock:
        previous = room.clients.get(client_id)
        if previous:
            try:
                await previous.websocket.close(code=4000)
            except Exception:
                pass
        room.clients[client_id] = peer

    await websocket.send_text(json.dumps({
        "type": "room_snapshot",
        "roomId": room_id,
        "clientId": client_id,
        "userId": user_id,
        "drones": list(room.drones.values()),
        "leases": room.leases.snapshot(),
        "sharedTarget": room.shared_target,
        "serverTimestamp": now_ms(),
    }))
    await HUB.broadcast(room, {
        "type": "client_joined",
        "roomId": room_id,
        "clientId": client_id,
    }, exclude=client_id)

    try:
        while True:
            try:
                frame = json.loads(await websocket.receive_text())
            except json.JSONDecodeError:
                await websocket.send_text(json.dumps({"type": "error", "reason": "invalid_json"}))
                continue
            message_type = frame.get("type")
            drone_id = safe_id(frame.get("droneId"), "")

            if message_type == "ping":
                await websocket.send_text(json.dumps({"type": "pong", "serverTimestamp": now_ms()}))
                continue
            if message_type == "claim_control" and drone_id:
                if drone_id not in room.drones:
                    await _send_control_result(peer, False, "unknown_drone", None, drone_id)
                    continue
                ok, lease = room.leases.claim(drone_id, client_id, user_id)
                await _send_control_result(peer, ok, "granted" if ok else "already_claimed", lease, drone_id)
                if ok:
                    await HUB.update_control_owner(room, drone_id)
                continue
            if message_type == "renew_control" and drone_id:
                lease = room.leases.renew(drone_id, str(frame.get("leaseId", "")), client_id)
                await _send_control_result(peer, bool(lease), "renewed" if lease else "not_owner", lease, drone_id)
                continue
            if message_type == "release_control" and drone_id:
                lease = room.leases.release(drone_id, str(frame.get("leaseId", "")), client_id)
                await _send_control_result(peer, bool(lease), "released" if lease else "not_owner", lease, drone_id)
                if lease:
                    await HUB.update_control_owner(room, drone_id)
                continue
            if message_type == "shared_target":
                target = frame.get("data")
                if not isinstance(target, dict):
                    await websocket.send_text(json.dumps({"type": "error", "reason": "invalid_target"}))
                    continue
                try:
                    room.shared_target = {
                        "lat": float(target.get("lat", 0)),
                        "lon": float(target.get("lon", 0)),
                        "alt": float(target.get("alt", 0)),
                        "label": str(target.get("label", "Shared target"))[:80],
                        "updatedBy": user_id,
                        "timestamp": now_ms(),
                    }
                except (TypeError, ValueError):
                    await websocket.send_text(json.dumps({"type": "error", "reason": "invalid_target"}))
                    continue
                await HUB.broadcast(room, {"type": "shared_target", "data": room.shared_target})
                continue
            if message_type == "drone_command" and drone_id:
                lease = room.leases.get(drone_id)
                if not lease or lease.owner_client_id != client_id or lease.lease_id != frame.get("leaseId"):
                    await _send_control_result(peer, False, "lease_required", lease, drone_id)
                    continue
                command = validate_command(frame.get("command", {}))
                if not command:
                    await websocket.send_text(json.dumps({"type": "error", "reason": "invalid_command", "droneId": drone_id}))
                    continue
                publisher = room.publishers.get(drone_id)
                if not publisher:
                    await websocket.send_text(json.dumps({
                        "type": "command_result",
                        "ok": False,
                        "reason": "no_drone_session",
                        "droneId": drone_id,
                    }))
                    continue
                try:
                    await publisher.send_text(json.dumps({
                        "type": "drone_command",
                        "roomId": room_id,
                        "droneId": drone_id,
                        "clientId": client_id,
                        "leaseId": lease.lease_id,
                        "command": command,
                    }))
                    await websocket.send_text(json.dumps({
                        "type": "command_result",
                        "ok": True,
                        "reason": "forwarded",
                        "droneId": drone_id,
                    }))
                except Exception:
                    await websocket.send_text(json.dumps({
                        "type": "command_result",
                        "ok": False,
                        "reason": "drone_session_send_failed",
                        "droneId": drone_id,
                    }))
                continue
            await websocket.send_text(json.dumps({"type": "error", "reason": "unsupported_message"}))
    except WebSocketDisconnect:
        pass
    finally:
        async with HUB.lock:
            if room.clients.get(client_id) is peer:
                room.clients.pop(client_id, None)
        for lease in room.leases.release_client(client_id):
            await HUB.update_control_owner(room, lease.drone_id)
            await HUB.broadcast(room, {
                "type": "control_result",
                "ok": False,
                "reason": "client_disconnected",
                **lease.public(),
            })
        await HUB.broadcast(room, {
            "type": "client_left",
            "roomId": room_id,
            "clientId": client_id,
        })


@router.websocket("/fleet/publish")
async def fleet_publish(websocket: WebSocket) -> None:
    token = _publisher_token()
    if token and websocket.query_params.get("token", "") != token:
        await websocket.close(code=4403)
        return
    room_id = safe_id(websocket.query_params.get("roomId"), "default")
    drone_id = safe_id(websocket.query_params.get("droneId"), "")
    if not drone_id:
        await websocket.close(code=4400)
        return
    await websocket.accept()
    await HUB.start()
    room = HUB.room(room_id)
    previous = room.publishers.get(drone_id)
    if previous:
        try:
            await previous.close(code=4000)
        except Exception:
            pass
    room.publishers[drone_id] = websocket
    await HUB.publish_state(room, drone_id, {
        "sequence": room.drones.get(drone_id, {}).get("sequence", -1) + 1,
        "name": websocket.query_params.get("name", drone_id),
        "streamId": websocket.query_params.get("streamId", drone_id),
    })
    try:
        while True:
            try:
                frame = json.loads(await websocket.receive_text())
            except json.JSONDecodeError:
                await websocket.send_text(json.dumps({"type": "error", "reason": "invalid_json"}))
                continue
            if frame.get("type") not in {"drone_update", "telemetry"}:
                continue
            raw = frame.get("data") if isinstance(frame.get("data"), dict) else frame
            ok, _ = await HUB.publish_state(room, drone_id, raw)
            if not ok:
                await websocket.send_text(json.dumps({"type": "error", "reason": "stale_sequence"}))
    except WebSocketDisconnect:
        pass
    finally:
        if room.publishers.get(drone_id) is websocket:
            room.publishers.pop(drone_id, None)
            state = room.drones.get(drone_id)
            if state:
                state["online"] = False
                state["linkState"] = "offline"
                state["serverTimestamp"] = now_ms()
                await HUB.broadcast(room, {"type": "drone_offline", **state})
