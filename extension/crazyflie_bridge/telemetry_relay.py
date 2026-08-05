#!/usr/bin/env python3
"""Crazyflie Telemetry Relay

Bridges the LOCAL Crazyflie telemetry to the drone-navigation server so the
Real Drone -> Livestream Host HUD can show live data in any browser, exactly
like the video pipeline (desktop -> server -> browsers):

    motion_control_ws.py  (owns the Crazyflie link, ws://127.0.0.1:8765)
      -> telemetry_relay.py  (this script)
        -> WS <server>/api/drone/telemetry/publish  (FastAPI fan-out)

It also forwards FLIGHT COMMANDS in the reverse direction:

    browser useDroneCommands
      -> WS <server>/api/drone/command           (FastAPI: validate + ack)
        -> WS <server>/api/drone/command/downlink  (this script, command_forwarder)
          -> motion_control_ws.py                  (dispatches to the drone)

Run (conda env 'crazyflie', together with start_bridge.sh):
    python telemetry_relay.py                       # publish to PRODUCTION
    TELEMETRY_SERVER=ws://127.0.0.1:8000/api/drone/telemetry/publish \
        python telemetry_relay.py                   # publish to LOCAL dev server

Environment variables:
    BRIDGE_WS         Local motion bridge socket
                      (default: ws://127.0.0.1:8765)
    TELEMETRY_SERVER  Server publish endpoint
                      (default: wss://drone-navigation.com/api/drone/telemetry/publish)
    TELEMETRY_TOKEN   Shared secret, must match the server's
                      config.json -> "drone" -> "telemetry_token" when set there.
    FLEET_DRONE_ID    Enables the multi-drone room link, e.g. cf-01.
    FLEET_ROOM_ID     Collaboration room (default: local-flight-room).
    FLEET_DRONE_NAME  Display name (default: FLEET_DRONE_ID).
    FLEET_STREAM_ID   MediaMTX stream mapped to this drone.

Both sides reconnect automatically with a 3 s backoff; telemetry frames are
dropped (never queued up stale) while the server side is down.
"""

import asyncio
import json
import os
import sys

try:
    import websockets
except ImportError:
    print("Error: 'websockets' library not installed. Run: pip install websockets")
    sys.exit(1)

BRIDGE_WS = os.environ.get("BRIDGE_WS", "ws://127.0.0.1:8765")
TELEMETRY_SERVER = os.environ.get(
    "TELEMETRY_SERVER", "wss://drone-navigation.com/api/drone/telemetry/publish"
)
# Command downlink: derived from TELEMETRY_SERVER (.../telemetry/publish ->
# .../command/downlink) unless overridden explicitly.
COMMANDS_SERVER = os.environ.get("COMMANDS_SERVER") or (
    TELEMETRY_SERVER.split("/telemetry/publish")[0] + "/command/downlink"
)
TELEMETRY_TOKEN = os.environ.get("TELEMETRY_TOKEN", "")
FLEET_DRONE_ID = os.environ.get("FLEET_DRONE_ID", "")
FLEET_ROOM_ID = os.environ.get("FLEET_ROOM_ID", "local-flight-room")
FLEET_DRONE_NAME = os.environ.get("FLEET_DRONE_NAME", FLEET_DRONE_ID)
FLEET_STREAM_ID = os.environ.get("FLEET_STREAM_ID", os.environ.get("LIVESTREAM_ID", FLEET_DRONE_ID))
FLEET_SERVER = os.environ.get("FLEET_SERVER") or (
    TELEMETRY_SERVER.split("/drone/telemetry/publish")[0] + "/fleet/publish"
)
FLEET_ONLY = os.environ.get("FLEET_ONLY", "0") == "1"
RECONNECT_S = 3

# Frames arriving from the bridge while the server link is down are dropped:
# the HUD wants the LATEST state, not a backlog of stale samples.
_latest_from_bridge: str | None = None
_new_frame = asyncio.Event()
_latest_fleet_frame: str | None = None
_fleet_new_frame = asyncio.Event()
_fleet_state: dict = {}
_fleet_sequence = 0

# Current bridge socket (set by bridge_reader) so commands can be written
# into the same connection the bridge already reads from.
_bridge_ws = None


async def bridge_reader() -> None:
    """Connect to the local motion bridge and keep the newest frame only."""
    global _latest_from_bridge, _latest_fleet_frame, _fleet_sequence, _bridge_ws
    while True:
        try:
            async with websockets.connect(BRIDGE_WS) as ws:
                _bridge_ws = ws
                print(f"[Relay] Bridge connected: {BRIDGE_WS}")
                async for message in ws:
                    # Cheap sanity check: forward only telemetry frames.
                    if '"type": "telemetry"' in message or '"type":"telemetry"' in message:
                        _latest_from_bridge = message
                        _new_frame.set()
                        if FLEET_DRONE_ID:
                            try:
                                frame = json.loads(message)
                                data = frame.get("data")
                                if isinstance(data, dict):
                                    _fleet_state.update(data)
                                    voltage = _fleet_state.get("voltage")
                                    if voltage is not None:
                                        _fleet_state["battery"] = max(
                                            0.0, min(100.0, (float(voltage) - 3.2) * 100.0)
                                        )
                                    _fleet_sequence += 1
                                    _latest_fleet_frame = json.dumps({
                                        "type": "drone_update",
                                        "sequence": _fleet_sequence,
                                        "timestamp": frame.get("timestamp"),
                                        "data": dict(_fleet_state),
                                    })
                                    _fleet_new_frame.set()
                            except (TypeError, ValueError, json.JSONDecodeError):
                                pass
        except (OSError, websockets.exceptions.WebSocketException) as e:
            print(f"[Relay] Bridge link down ({e}); retry in {RECONNECT_S}s")
            _bridge_ws = None
            await asyncio.sleep(RECONNECT_S)


async def server_writer() -> None:
    """Connect to the server publish endpoint and forward frames live."""
    url = TELEMETRY_SERVER
    if TELEMETRY_TOKEN:
        sep = "&" if "?" in url else "?"
        url = f"{url}{sep}token={TELEMETRY_TOKEN}"
    global _latest_from_bridge
    while True:
        try:
            async with websockets.connect(url) as ws:
                print(f"[Relay] Server connected: {TELEMETRY_SERVER}")
                # Flush the newest frame immediately so late joiners sync fast.
                if _latest_from_bridge is not None:
                    await ws.send(_latest_from_bridge)
                while True:
                    await _new_frame.wait()
                    _new_frame.clear()
                    msg = _latest_from_bridge
                    if msg is not None:
                        # Validate once here so the server never gets junk.
                        json.loads(msg)
                        await ws.send(msg)
        except (OSError, websockets.exceptions.WebSocketException) as e:
            print(f"[Relay] Server link down ({e}); retry in {RECONNECT_S}s")
            _new_frame.clear()
            await asyncio.sleep(RECONNECT_S)


async def command_forwarder() -> None:
    """Receive flight commands from the server and write them into the bridge.

    Commands are never queued: if the bridge link is momentarily down the
    command is dropped (a stale buffered takeoff is worse than a lost click).
    """
    url = COMMANDS_SERVER
    if TELEMETRY_TOKEN:
        sep = "&" if "?" in url else "?"
        url = f"{url}{sep}token={TELEMETRY_TOKEN}"
    while True:
        try:
            async with websockets.connect(url) as ws:
                print(f"[Relay] Command downlink connected: {COMMANDS_SERVER}")
                async for message in ws:
                    bridge = _bridge_ws
                    if bridge is None:
                        print("[Relay] Command dropped: bridge link down")
                        continue
                    try:
                        json.loads(message)  # validate once (already whitelisted server-side)
                        await bridge.send(message)
                    except Exception as e:
                        print(f"[Relay] Command forward failed: {e}")
        except (OSError, websockets.exceptions.WebSocketException) as e:
            print(f"[Relay] Command downlink down ({e}); retry in {RECONNECT_S}s")
            await asyncio.sleep(RECONNECT_S)


async def fleet_link() -> None:
    """Publish this drone into a collaboration room and receive lease-checked commands."""
    if not FLEET_DRONE_ID:
        return
    query = {
        "roomId": FLEET_ROOM_ID,
        "droneId": FLEET_DRONE_ID,
        "name": FLEET_DRONE_NAME or FLEET_DRONE_ID,
        "streamId": FLEET_STREAM_ID or FLEET_DRONE_ID,
    }
    if TELEMETRY_TOKEN:
        query["token"] = TELEMETRY_TOKEN
    from urllib.parse import urlencode
    url = f"{FLEET_SERVER}{'&' if '?' in FLEET_SERVER else '?'}{urlencode(query)}"

    async def send_updates(ws) -> None:
        global _latest_fleet_frame
        if _latest_fleet_frame is not None:
            await ws.send(_latest_fleet_frame)
        while True:
            await _fleet_new_frame.wait()
            _fleet_new_frame.clear()
            if _latest_fleet_frame is not None:
                await ws.send(_latest_fleet_frame)

    async def receive_commands(ws) -> None:
        async for message in ws:
            try:
                frame = json.loads(message)
            except json.JSONDecodeError:
                continue
            if frame.get("type") != "drone_command" or not isinstance(frame.get("command"), dict):
                continue
            bridge = _bridge_ws
            if bridge is None:
                print(f"[Fleet] Command for {FLEET_DRONE_ID} dropped: bridge link down")
                continue
            # The fleet server already applied the same strict command whitelist
            # as the legacy command route and verified the caller's lease.
            await bridge.send(json.dumps(frame["command"]))

    while True:
        try:
            async with websockets.connect(url) as ws:
                print(f"[Fleet] Room link connected: {FLEET_ROOM_ID}/{FLEET_DRONE_ID}")
                sender = asyncio.create_task(send_updates(ws))
                receiver = asyncio.create_task(receive_commands(ws))
                done, pending = await asyncio.wait(
                    {sender, receiver}, return_when=asyncio.FIRST_COMPLETED
                )
                for task in pending:
                    task.cancel()
                for task in done:
                    task.result()
        except (OSError, websockets.exceptions.WebSocketException) as e:
            print(f"[Fleet] Room link down ({e}); retry in {RECONNECT_S}s")
            _fleet_new_frame.clear()
            await asyncio.sleep(RECONNECT_S)


async def main() -> None:
    print(f"[Relay] Bridge: {BRIDGE_WS}")
    print(f"[Relay] Server: {TELEMETRY_SERVER}")
    print(f"[Relay] Commands: {COMMANDS_SERVER}")
    print(f"[Relay] Token:  {'set' if TELEMETRY_TOKEN else '(none)'}")
    if FLEET_DRONE_ID:
        print(f"[Fleet] Room:   {FLEET_ROOM_ID}")
        print(f"[Fleet] Drone:  {FLEET_DRONE_ID}")
        print(f"[Fleet] Server: {FLEET_SERVER}")
    tasks = [bridge_reader(), fleet_link()]
    if not FLEET_ONLY:
        tasks.extend([server_writer(), command_forwarder()])
    await asyncio.gather(*tasks)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n[Relay] Exited.")
