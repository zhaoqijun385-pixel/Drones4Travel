#!/usr/bin/env python3
"""Launch one isolated motion/relay session per configured Crazyflie.

``--check`` validates configuration only and never opens a radio or socket.
Every configured drone gets its own motion-control process, WebSocket port,
command queue, room publisher, and MediaMTX stream identifier.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import signal
import sys
from pathlib import Path

import yaml

SCRIPT_DIR = Path(__file__).resolve().parent


def load_config(path: Path) -> tuple[str, str, list[dict]]:
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    room_id = str(data.get("roomId") or "local-flight-room")
    fleet_server = str(data.get("fleetServer") or "ws://127.0.0.1:8000/api/fleet/publish")
    drones = [item for item in data.get("drones", []) if item.get("enabled", True)]
    ids: set[str] = set()
    ports: set[int] = set()
    uris: set[str] = set()
    for index, drone in enumerate(drones, start=1):
        drone_id = str(drone.get("droneId") or "")
        uri = str(drone.get("uri") or "")
        port = int(drone.get("port") or 8764 + index)
        if not drone_id:
            raise ValueError(f"drone #{index}: droneId is required")
        if not uri.startswith("radio://"):
            raise ValueError(f"{drone_id}: uri must start with radio://")
        if drone_id in ids:
            raise ValueError(f"duplicate droneId: {drone_id}")
        if port in ports:
            raise ValueError(f"duplicate motion bridge port: {port}")
        if uri in uris:
            raise ValueError(f"duplicate radio uri: {uri}")
        ids.add(drone_id)
        ports.add(port)
        uris.add(uri)
        drone["droneId"] = drone_id
        drone["uri"] = uri
        drone["port"] = port
    return room_id, fleet_server, drones


async def terminate(processes: list[asyncio.subprocess.Process]) -> None:
    for process in processes:
        if process.returncode is None:
            process.terminate()
    if not processes:
        return
    try:
        await asyncio.wait_for(
            asyncio.gather(*(process.wait() for process in processes)),
            timeout=8,
        )
    except asyncio.TimeoutError:
        for process in processes:
            if process.returncode is None:
                process.kill()
        await asyncio.gather(*(process.wait() for process in processes))


async def run_sessions(room_id: str, fleet_server: str, drones: list[dict]) -> int:
    processes: list[asyncio.subprocess.Process] = []
    stop_event = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, stop_event.set)
        except NotImplementedError:
            pass

    try:
        for drone in drones:
            drone_id = drone["droneId"]
            port = drone["port"]
            motion = await asyncio.create_subprocess_exec(
                sys.executable,
                str(SCRIPT_DIR / "motion_control_ws.py"),
                "--cf-uri",
                drone["uri"],
                "--port",
                str(port),
            )
            processes.append(motion)

            env = os.environ.copy()
            env.update({
                "BRIDGE_WS": f"ws://127.0.0.1:{port}",
                "FLEET_ONLY": "1",
                "FLEET_SERVER": fleet_server,
                "FLEET_ROOM_ID": room_id,
                "FLEET_DRONE_ID": drone_id,
                "FLEET_DRONE_NAME": str(drone.get("name") or drone_id),
                "FLEET_STREAM_ID": str(drone.get("streamId") or drone_id),
            })
            relay = await asyncio.create_subprocess_exec(
                sys.executable,
                str(SCRIPT_DIR / "telemetry_relay.py"),
                env=env,
            )
            processes.append(relay)
            print(f"[MultiBridge] started {drone_id}: radio={drone['uri']} ws=:{port}")

        waiters = [asyncio.create_task(process.wait()) for process in processes]
        stop_waiter = asyncio.create_task(stop_event.wait())
        done, pending = await asyncio.wait(
            [*waiters, stop_waiter],
            return_when=asyncio.FIRST_COMPLETED,
        )
        for task in pending:
            task.cancel()
        failed = [
            process.returncode for process in processes
            if process.returncode not in (None, 0)
        ]
        return failed[0] if failed else 0
    finally:
        print("[MultiBridge] stopping all drone sessions")
        await terminate(processes)


def main() -> int:
    parser = argparse.ArgumentParser(description="Multi-Crazyflie session supervisor")
    parser.add_argument(
        "--config",
        type=Path,
        default=SCRIPT_DIR / "drones.yaml",
        help="YAML configuration path",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="validate only; never connect to radios or servers",
    )
    args = parser.parse_args()
    try:
        room_id, fleet_server, drones = load_config(args.config)
    except (OSError, ValueError, TypeError, yaml.YAMLError) as error:
        print(f"[MultiBridge] configuration error: {error}", file=sys.stderr)
        return 2

    print(f"[MultiBridge] room={room_id} server={fleet_server} drones={len(drones)}")
    for drone in drones:
        print(
            f"  - {drone['droneId']} port={drone['port']} "
            f"stream={drone.get('streamId') or drone['droneId']}"
        )
    if args.check:
        print("[MultiBridge] configuration valid; no processes started")
        return 0
    if not drones:
        print("[MultiBridge] no enabled drones; nothing started", file=sys.stderr)
        return 2
    return asyncio.run(run_sessions(room_id, fleet_server, drones))


if __name__ == "__main__":
    raise SystemExit(main())
