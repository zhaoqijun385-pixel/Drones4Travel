#!/usr/bin/env python3
"""Publish 1/5/20/50 simulated drones to the fleet room service."""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import os
import time
from urllib.parse import urlencode

import websockets


def parking_pose(index: int) -> tuple[float, float, float]:
    slot = index - 1
    return (-12 + (slot % 5) * 6, -8 - (slot // 5) * 6, 0.12)


def scenario_pose(index: int, elapsed: float, scenario: str) -> tuple[float, float, float, float]:
    home_x, home_y, home_z = parking_pose(index)
    if scenario == "parked":
        return home_x, home_y, home_z, 0.0
    target_x = (-18, 18, 18, -18)[(index - 1) % 4]
    target_y = (16, 16, -16, -16)[(index - 1) % 4]
    cycle = max(0.0, elapsed - (index - 1) * 0.65) % 24.0
    if cycle < 2:
        progress = cycle / 2
        return home_x, home_y, home_z + (0.9 - home_z) * progress, 0.0
    if cycle < 10:
        progress = (cycle - 2) / 8
        x = home_x + (target_x - home_x) * progress
        y = home_y + (target_y - home_y) * progress
        return x, y, 0.9, math.degrees(math.atan2(target_x - home_x, target_y - home_y)) % 360
    if cycle < 14:
        return target_x, target_y, 0.9, 0.0
    if cycle < 22:
        progress = (cycle - 14) / 8
        x = target_x + (home_x - target_x) * progress
        y = target_y + (home_y - target_y) * progress
        return x, y, 0.9, math.degrees(math.atan2(home_x - target_x, home_y - target_y)) % 360
    progress = (cycle - 22) / 2
    return home_x, home_y, 0.9 + (home_z - 0.9) * progress, 0.0


async def simulate_drone(
    base_url: str,
    room_id: str,
    token: str,
    index: int,
    hz: float,
    scenario: str,
) -> None:
    drone_id = f"sim-{index:02d}"
    query = {
        "roomId": room_id,
        "droneId": drone_id,
        "name": f"Simulator {index:02d}",
        "streamId": drone_id,
    }
    if token:
        query["token"] = token
    url = f"{base_url}{'&' if '?' in base_url else '?'}{urlencode(query)}"
    sequence = 0
    started = time.monotonic()

    async with websockets.connect(url) as websocket:
        async def sender() -> None:
            nonlocal sequence
            interval = 1 / hz
            while True:
                elapsed = time.monotonic() - started
                x, y, z, yaw = scenario_pose(index, elapsed, scenario)
                sequence += 1
                await websocket.send(json.dumps({
                    "type": "drone_update",
                    "sequence": sequence,
                    "timestamp": int(time.time() * 1000),
                    "data": {
                        "x": x,
                        "y": y,
                        "z": z,
                        "yaw": yaw,
                        "battery": max(25, 100 - index * 0.7),
                        "color": "#f6c453" if index % 3 == 0 else "#53b7ff",
                    },
                }))
                await asyncio.sleep(interval)

        async def receiver() -> None:
            async for raw in websocket:
                try:
                    frame = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                if frame.get("type") == "drone_command":
                    print(f"[Simulator] {drone_id} received {frame.get('command')}")

        sender_task = asyncio.create_task(sender())
        receiver_task = asyncio.create_task(receiver())
        done, pending = await asyncio.wait(
            {sender_task, receiver_task},
            return_when=asyncio.FIRST_COMPLETED,
        )
        for task in pending:
            task.cancel()
        for task in done:
            task.result()


async def run(args) -> None:
    tasks = [
        asyncio.create_task(
            simulate_drone(args.server, args.room, args.token, index, args.hz, args.scenario)
        )
        for index in range(1, args.count + 1)
    ]
    if args.duration > 0:
        try:
            await asyncio.wait_for(asyncio.gather(*tasks), timeout=args.duration)
        except asyncio.TimeoutError:
            for task in tasks:
                task.cancel()
    else:
        await asyncio.gather(*tasks)


def main() -> int:
    parser = argparse.ArgumentParser(description="Fleet room load simulator")
    parser.add_argument("--server", default="ws://127.0.0.1:8000/api/fleet/publish")
    parser.add_argument("--room", default="local-flight-room")
    parser.add_argument("--count", type=int, choices=(1, 5, 20, 50), default=20)
    parser.add_argument("--hz", type=float, default=10)
    parser.add_argument("--duration", type=float, default=0)
    parser.add_argument("--scenario", choices=("parked", "inspection"), default="parked")
    parser.add_argument("--token", default=os.environ.get("TELEMETRY_TOKEN", ""))
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if args.hz <= 0 or args.hz > 30:
        parser.error("--hz must be greater than 0 and no more than 30")
    if args.check:
        print(
            f"[Simulator] valid: {args.count} drones, {args.hz:g} Hz, "
            f"scenario={args.scenario}, room={args.room}, server={args.server}; "
            "no connection started"
        )
        return 0
    try:
        asyncio.run(run(args))
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
