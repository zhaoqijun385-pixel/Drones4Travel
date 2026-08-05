import unittest

from app.fleet import ControlLeaseManager, FleetHub


class ControlLeaseManagerTest(unittest.TestCase):
    def test_conflict_renew_release_and_expiry(self):
        leases = ControlLeaseManager(ttl_ms=5_000)
        ok, first = leases.claim("cf-01", "client-a", "user-a", at=1_000)
        self.assertTrue(ok)

        ok, conflict = leases.claim("cf-01", "client-b", "user-b", at=1_100)
        self.assertFalse(ok)
        self.assertEqual(first.lease_id, conflict.lease_id)

        renewed = leases.renew("cf-01", first.lease_id, "client-a", at=2_000)
        self.assertIsNotNone(renewed)
        self.assertEqual(7_000, renewed.expires_at)
        self.assertIsNone(leases.renew("cf-01", first.lease_id, "client-b", at=2_100))

        self.assertIsNone(leases.get("cf-01", at=7_000))
        ok, second = leases.claim("cf-01", "client-b", "user-b", at=7_001)
        self.assertTrue(ok)
        self.assertNotEqual(first.lease_id, second.lease_id)
        self.assertIsNotNone(leases.release("cf-01", second.lease_id, "client-b"))

    def test_disconnect_releases_only_owned_leases(self):
        leases = ControlLeaseManager()
        leases.claim("cf-01", "client-a", "user-a", at=1_000)
        leases.claim("cf-02", "client-b", "user-b", at=1_000)
        released = leases.release_client("client-a")
        self.assertEqual(["cf-01"], [lease.drone_id for lease in released])
        self.assertIsNotNone(leases.get("cf-02", at=1_100))


class FleetHubStateTest(unittest.IsolatedAsyncioTestCase):
    async def test_rejects_duplicate_and_out_of_order_state(self):
        hub = FleetHub()
        room = hub.room("room-a")
        accepted, state = await hub.publish_state(room, "cf-01", {
            "sequence": 10,
            "lat": 31.2,
            "lon": 121.5,
            "battery": 90,
        })
        self.assertTrue(accepted)
        self.assertEqual(10, state["sequence"])

        accepted, current = await hub.publish_state(room, "cf-01", {
            "sequence": 9,
            "lat": 0,
        })
        self.assertFalse(accepted)
        self.assertEqual(31.2, current["lat"])


if __name__ == "__main__":
    unittest.main()
