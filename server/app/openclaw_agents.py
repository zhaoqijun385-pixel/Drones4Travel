"""Per-drone OpenClaw agent lifecycle.

The browser never receives shell access or OpenClaw administrative credentials.
Authenticated API calls provision isolated agents through the locally installed
OpenClaw CLI. Removing a drone archives the mapping by default; permanent CLI
deletion is a separate, explicit operation.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
from pathlib import Path
from typing import Any, Awaitable, Callable

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from .users import current_active_user

router = APIRouter(tags=["openclaw-agents"])

DEFAULT_RUNTIME_ROOT = Path(
    os.environ.get(
        "DRONE_AGENT_ROOT",
        "/Users/quentincrane/.local/share/drone-navigation-agents",
    )
)
DEFAULT_OPENCLAW_BIN = Path(
    os.environ.get(
        "OPENCLAW_BIN",
        "/Users/quentincrane/.local/share/"
        "drone-navigation-setup-20260804/openclaw/node_modules/.bin/openclaw",
    )
)
DEFAULT_OPENCLAW_CONFIG = Path(
    os.environ.get(
        "OPENCLAW_CONFIG_PATH",
        "/Users/quentincrane/.local/share/"
        "drone-navigation-setup-20260804/openclaw/openclaw.json",
    )
)
DEFAULT_OPENCLAW_STATE = Path(
    os.environ.get(
        "OPENCLAW_STATE_DIR",
        "/Users/quentincrane/.local/share/"
        "drone-navigation-setup-20260804/openclaw/state",
    )
)


class AgentCreate(BaseModel):
    name: str = Field(default="", max_length=80)
    model: str = Field(default="", max_length=160)


def safe_fragment(value: Any, fallback: str = "drone") -> str:
    clean = re.sub(r"[^a-zA-Z0-9_-]+", "-", str(value or "")).strip("-_").lower()
    return (clean[:64] or fallback)


def parse_json_output(output: str) -> dict:
    decoder = json.JSONDecoder()
    for index, char in enumerate(output):
        if char != "{":
            continue
        try:
            value, _ = decoder.raw_decode(output[index:])
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            return value
    return {}


Runner = Callable[[list[str], dict[str, str]], Awaitable[tuple[int, str, str]]]


async def subprocess_runner(command: list[str], env: dict[str, str]) -> tuple[int, str, str]:
    process = await asyncio.create_subprocess_exec(
        *command,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=env,
    )
    stdout, stderr = await process.communicate()
    return (
        int(process.returncode or 0),
        stdout.decode("utf-8", errors="replace"),
        stderr.decode("utf-8", errors="replace"),
    )


class OpenClawAgentManager:
    def __init__(
        self,
        root: Path = DEFAULT_RUNTIME_ROOT,
        runner: Runner = subprocess_runner,
        openclaw_bin: Path = DEFAULT_OPENCLAW_BIN,
        openclaw_config: Path = DEFAULT_OPENCLAW_CONFIG,
        openclaw_state: Path = DEFAULT_OPENCLAW_STATE,
    ):
        self.root = root
        self.registry_path = root / "registry.json"
        self.runner = runner
        self.openclaw_bin = openclaw_bin
        self.openclaw_config = openclaw_config
        self.openclaw_state = openclaw_state
        self._lock = asyncio.Lock()

    def _load(self) -> dict[str, dict]:
        if not self.registry_path.exists():
            return {}
        try:
            value = json.loads(self.registry_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}
        return value if isinstance(value, dict) else {}

    def _save(self, registry: dict[str, dict]) -> None:
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        temporary = self.registry_path.with_suffix(".tmp")
        temporary.write_text(
            json.dumps(registry, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        temporary.chmod(0o600)
        temporary.replace(self.registry_path)

    @staticmethod
    def key(user_id: str, drone_id: str) -> str:
        return f"{user_id}:{drone_id}"

    def public(self, record: dict) -> dict:
        return {
            "droneId": record["droneId"],
            "agentId": record["agentId"],
            "name": record["name"],
            "status": record["status"],
            "sessionKey": record["sessionKey"],
            "workspace": record["workspace"],
        }

    async def list(self, user_id: str) -> list[dict]:
        async with self._lock:
            return [
                self.public(record)
                for record in self._load().values()
                if record.get("userId") == user_id
            ]

    async def provision(self, user_id: str, drone_id: str, data: AgentCreate) -> dict:
        async with self._lock:
            registry = self._load()
            key = self.key(user_id, drone_id)
            existing = registry.get(key)
            if existing and existing.get("status") != "deleted":
                if existing.get("status") == "archived":
                    existing["status"] = "ready"
                    self._save(registry)
                return self.public(existing)

            if not self.openclaw_bin.exists():
                raise RuntimeError(f"OpenClaw CLI is unavailable at {self.openclaw_bin}")
            if not self.openclaw_config.exists():
                raise RuntimeError(f"OpenClaw config is unavailable at {self.openclaw_config}")

            safe_user = safe_fragment(user_id, "user")
            safe_drone = safe_fragment(drone_id)
            agent_id = f"drone-{safe_user[-12:]}-{safe_drone}"[:64]
            workspace = self.root / "workspaces" / safe_user / safe_drone
            agent_dir = self.root / "state" / safe_user / safe_drone
            workspace.mkdir(parents=True, exist_ok=True, mode=0o700)
            agent_dir.mkdir(parents=True, exist_ok=True, mode=0o700)

            command = [
                str(self.openclaw_bin),
                "agents",
                "add",
                agent_id,
                "--non-interactive",
                "--workspace",
                str(workspace),
                "--agent-dir",
                str(agent_dir),
                "--json",
            ]
            if data.model:
                command.extend(["--model", data.model])
            env = os.environ.copy()
            env.update(
                {
                    "OPENCLAW_CONFIG_PATH": str(self.openclaw_config),
                    "OPENCLAW_STATE_DIR": str(self.openclaw_state),
                }
            )
            code, stdout, stderr = await self.runner(command, env)
            if code:
                message = (stderr or stdout or "OpenClaw agent creation failed").strip()
                raise RuntimeError(message[-800:])

            result = parse_json_output(stdout)
            resolved_id = str(result.get("agentId") or result.get("id") or agent_id)
            record = {
                "userId": user_id,
                "droneId": drone_id,
                "agentId": resolved_id,
                "name": data.name or drone_id,
                "status": "ready",
                "sessionKey": f"agent:{resolved_id}:{safe_drone}",
                "workspace": str(workspace),
                "agentDir": str(agent_dir),
            }
            registry[key] = record
            self._save(registry)
            return self.public(record)

    async def archive(self, user_id: str, drone_id: str) -> dict:
        async with self._lock:
            registry = self._load()
            record = registry.get(self.key(user_id, drone_id))
            if not record:
                raise KeyError(drone_id)
            record["status"] = "archived"
            self._save(registry)
            return self.public(record)

    async def delete_permanently(self, user_id: str, drone_id: str) -> dict:
        async with self._lock:
            registry = self._load()
            key = self.key(user_id, drone_id)
            record = registry.get(key)
            if not record:
                raise KeyError(drone_id)
            env = os.environ.copy()
            env.update(
                {
                    "OPENCLAW_CONFIG_PATH": str(self.openclaw_config),
                    "OPENCLAW_STATE_DIR": str(self.openclaw_state),
                }
            )
            command = [
                str(self.openclaw_bin),
                "agents",
                "delete",
                record["agentId"],
                "--force",
                "--json",
            ]
            code, stdout, stderr = await self.runner(command, env)
            if code:
                message = (stderr or stdout or "OpenClaw agent deletion failed").strip()
                raise RuntimeError(message[-800:])
            record["status"] = "deleted"
            self._save(registry)
            return self.public(record)


MANAGER = OpenClawAgentManager()


@router.get("/fleet/agents")
async def list_agents(user=Depends(current_active_user)) -> list[dict]:
    return await MANAGER.list(str(user.id))


@router.post("/fleet/agents/{drone_id}")
async def provision_agent(
    drone_id: str,
    data: AgentCreate,
    user=Depends(current_active_user),
) -> dict:
    try:
        return await MANAGER.provision(str(user.id), safe_fragment(drone_id), data)
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error


@router.delete("/fleet/agents/{drone_id}")
async def remove_agent(
    drone_id: str,
    permanent: bool = Query(default=False),
    user=Depends(current_active_user),
) -> dict:
    try:
        if permanent:
            return await MANAGER.delete_permanently(str(user.id), safe_fragment(drone_id))
        return await MANAGER.archive(str(user.id), safe_fragment(drone_id))
    except KeyError as error:
        raise HTTPException(status_code=404, detail="agent_not_found") from error
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
