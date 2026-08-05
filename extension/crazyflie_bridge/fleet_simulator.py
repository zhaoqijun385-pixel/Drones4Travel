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


async def simulate_drone(base_url: str, room_id: str, token: str, index: int, hz: float) -> None:
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
                phase = (time.monotonic() - started) * 0.35 + index * 0.47
                radius = 8 + (index % 8) * 4
                sequence += 1
                await websocket.send(json.dumps({
                    "type": "drone_update",
                    "sequence": sequence,
                    "timestamp": int(time.time() * 1000),
                    "data": {
                        "x": math.cos(phase) * radius,
                        "y": math.sin(phase) * radius,
                        "z": 2.5 + (index % 5) * 0.8 + math.sin(phase) * 0.25,
                        "yaw": math.degrees(phase + math.pi / 2) % 360,
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
            simulate_drone(args.server, args.room, args.token, index, args.hz)
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
    parser.add_argument("--token", default=os.environ.get("TELEMETRY_TOKEN", ""))
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if args.hz <= 0 or args.hz > 30:
        parser.error("--hz must be greater than 0 and no more than 30")
    if args.check:
        print(
            f"[Simulator] valid: {args.count} drones, {args.hz:g} Hz, "
            f"room={args.room}, server={args.server}; no connection started"
        )
        return 0
    try:
        asyncio.run(run(args))
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
