import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.fleet import HUB, router
from app.users import get_user_manager


class FakeStrategy:
    async def read_token(self, token, user_manager):
        if token != "valid-browser-token":
            return None
        return SimpleNamespace(id="user-a", is_active=True)


class FleetWebSocketTest(unittest.TestCase):
    def setUp(self):
        HUB.rooms.clear()
        app = FastAPI()
        app.include_router(router, prefix="/api")
        app.dependency_overrides[get_user_manager] = lambda: object()
        self.client = TestClient(app)

    def receive_type(self, websocket, expected_type):
        for _ in range(10):
            frame = websocket.receive_json()
            if frame.get("type") == expected_type:
                return frame
        self.fail(f"did not receive websocket frame type {expected_type}")

    def test_snapshot_lease_conflict_and_command_forwarding(self):
        with (
            patch("app.fleet.get_jwt_strategy", return_value=FakeStrategy()),
            patch("app.fleet._publisher_token", return_value=""),
            self.client.websocket_connect(
                "/api/fleet/publish?roomId=room-a&droneId=cf-01&name=Alpha"
            ) as publisher,
            self.client.websocket_connect(
                "/api/fleet/ws?roomId=room-a&clientId=client-a&token=valid-browser-token"
            ) as browser_a,
        ):
            snapshot = browser_a.receive_json()
            self.assertEqual("room_snapshot", snapshot["type"])
            self.assertEqual("cf-01", snapshot["drones"][0]["droneId"])

            browser_a.send_json({"type": "claim_control", "droneId": "cf-01"})
            granted = browser_a.receive_json()
            self.assertTrue(granted["ok"])
            self.assertEqual("granted", granted["reason"])
            # Control-owner state update follows the direct lease response.
            self.assertEqual("drone_update", browser_a.receive_json()["type"])

            with self.client.websocket_connect(
                "/api/fleet/ws?roomId=room-a&clientId=client-b&token=valid-browser-token"
            ) as browser_b:
                browser_b.receive_json()  # room snapshot
                browser_b.send_json({"type": "claim_control", "droneId": "cf-01"})
                conflict = browser_b.receive_json()
                self.assertFalse(conflict["ok"])
                self.assertEqual("already_claimed", conflict["reason"])

            browser_a.send_json({
                "type": "drone_command",
                "droneId": "cf-01",
                "leaseId": granted["leaseId"],
                "command": {"action": "forward", "distance": 0.2},
            })
            forwarded = publisher.receive_json()
            self.assertEqual("drone_command", forwarded["type"])
            self.assertEqual("forward", forwarded["command"]["action"])
            result = self.receive_type(browser_a, "command_result")
            self.assertTrue(result["ok"])
            self.assertEqual("forwarded", result["reason"])


if __name__ == "__main__":
    unittest.main()
