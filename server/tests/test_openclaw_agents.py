import asyncio
import json
import tempfile
import unittest
from pathlib import Path

from app.openclaw_agents import AgentCreate, OpenClawAgentManager


class OpenClawAgentManagerTest(unittest.TestCase):
    def test_provision_archive_restore_and_permanent_delete(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            binary = root / "openclaw"
            config = root / "openclaw.json"
            state = root / "openclaw-state"
            binary.write_text("#!/bin/sh\n", encoding="utf-8")
            config.write_text("{}", encoding="utf-8")
            calls = []

            async def runner(command, env):
                calls.append((command, env))
                if "add" in command:
                    return 0, 'OpenClaw\n{"agentId":"drone-test-cf-01"}\n', ""
                return 0, json.dumps({"ok": True}), ""

            manager = OpenClawAgentManager(
                root=root / "agents",
                runner=runner,
                openclaw_bin=binary,
                openclaw_config=config,
                openclaw_state=state,
            )

            created = asyncio.run(
                manager.provision("user-123", "cf-01", AgentCreate(name="Crazyflie 01"))
            )
            self.assertEqual(created["agentId"], "drone-test-cf-01")
            self.assertEqual(created["status"], "ready")
            self.assertTrue(Path(created["workspace"]).is_dir())
            self.assertEqual(len(calls), 1)

            archived = asyncio.run(manager.archive("user-123", "cf-01"))
            self.assertEqual(archived["status"], "archived")

            restored = asyncio.run(
                manager.provision("user-123", "cf-01", AgentCreate(name="Crazyflie 01"))
            )
            self.assertEqual(restored["status"], "ready")
            self.assertEqual(len(calls), 1)

            deleted = asyncio.run(manager.delete_permanently("user-123", "cf-01"))
            self.assertEqual(deleted["status"], "deleted")
            self.assertEqual(len(calls), 2)
            self.assertIn("delete", calls[-1][0])

            registry = json.loads((root / "agents" / "registry.json").read_text(encoding="utf-8"))
            self.assertEqual(registry["user-123:cf-01"]["status"], "deleted")


if __name__ == "__main__":
    unittest.main()
