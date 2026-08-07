import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.tourism import _mock_places_autocomplete, _mock_places_nearby, router


def make_app():
    app = FastAPI()
    app.include_router(router, prefix="/api")
    return app


class TourismMockTest(unittest.TestCase):
    def test_mock_places_autocomplete_built_from_shared_hints(self):
        suggestions = _mock_places_autocomplete("west lake")
        self.assertTrue(any(s.name == "West Lake" for s in suggestions))
        self.assertLessEqual(len(suggestions), 8)

    def test_mock_places_nearby_sorted_by_distance(self):
        places = _mock_places_nearby(30.242, 120.148, max_count=3)
        self.assertLessEqual(len(places), 3)
        self.assertEqual("West Lake", places[0].name)


class TourismEndpointTest(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(make_app())

    def test_plan_with_coordinates_returns_five_points(self):
        response = self.client.post(
            "/api/tourism/plan",
            json={"query": "", "latitude": 31.24, "longitude": 121.49},
        )
        self.assertEqual(200, response.status_code)
        data = response.json()
        self.assertEqual(5, len(data["observation_points"]))
        top = data["observation_points"][-1]
        self.assertEqual(120, top["altitude"])
        self.assertAlmostEqual(31.24, top["latitude"], places=4)
        for point in data["observation_points"][:4]:
            self.assertEqual(60, point["altitude"])

    def test_plan_with_hint_place_uses_survey_geocoder(self):
        # "west lake" resolves through survey_mission's shared hint list, no network.
        response = self.client.post(
            "/api/tourism/plan",
            json={"query": "west lake"},
        )
        self.assertEqual(200, response.status_code)
        data = response.json()
        self.assertEqual(5, len(data["observation_points"]))
        self.assertAlmostEqual(30.242, data["place"]["latitude"], places=2)

    def test_plan_unknown_place_returns_404(self):
        with patch("app.survey_mission._fetch_json", return_value=(None, "test-offline")):
            response = self.client.post(
                "/api/tourism/plan",
                json={"query": "xyz-not-a-real-place-12345"},
            )
        self.assertEqual(404, response.status_code)

    def test_suggest_falls_back_to_hints_without_key(self):
        with patch("app.tourism._google_key", return_value=""):
            response = self.client.get(
                "/api/tourism/suggest",
                params={"query": "west lake", "language": "zh-CN"},
            )
        self.assertEqual(200, response.status_code)
        self.assertIn("suggestions", response.json())
        self.assertTrue(response.json()["suggestions"])

    def test_nearby_falls_back_to_hints_without_key(self):
        with patch("app.tourism._google_key", return_value=""):
            response = self.client.get(
                "/api/tourism/places/nearby",
                params={"lat": 30.242, "lng": 120.148, "radius": 1000},
            )
        self.assertEqual(200, response.status_code)
        self.assertIn("places", response.json())

    def test_streetview_without_key_reports_unavailable(self):
        with patch("app.tourism._google_key", return_value=""):
            response = self.client.get(
                "/api/tourism/streetview",
                params={"lat": 31.24, "lng": 121.49},
            )
        self.assertEqual(200, response.status_code)
        self.assertFalse(response.json()["available"])

    def test_batch_plan_skips_unresolvable_queries(self):
        with patch("app.survey_mission._fetch_json", return_value=(None, "test-offline")):
            response = self.client.post(
                "/api/tourism/plan/batch",
                json={"queries": ["xyz-not-a-real-place-12345"], "places": [{"latitude": 1.0, "longitude": 2.0}]},
            )
        self.assertEqual(200, response.status_code)
        results = response.json()["results"]
        self.assertEqual(1, len(results))  # only the coordinate place survives
        self.assertEqual(5, len(results[0]["observation_points"]))


if __name__ == "__main__":
    unittest.main()
