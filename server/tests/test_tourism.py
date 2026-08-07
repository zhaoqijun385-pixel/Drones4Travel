import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.survey_mission import router


def make_app():
    app = FastAPI()
    app.include_router(router, prefix="/api")
    return app


class TourismSearchEndpointTest(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(make_app())

    def test_suggest_without_key_returns_empty(self):
        with patch("app.survey_mission._google_key", return_value=""):
            response = self.client.get(
                "/api/survey/suggest",
                params={"query": "eiffel", "language": "zh-CN"},
            )
        self.assertEqual(200, response.status_code)
        self.assertEqual([], response.json()["suggestions"])

    def test_suggest_parses_google_predictions(self):
        fake_data = {
            "status": "OK",
            "predictions": [
                {
                    "place_id": "p1",
                    "description": "Eiffel Tower, Paris",
                    "structured_formatting": {"main_text": "Eiffel Tower", "secondary_text": "Paris"},
                }
            ],
        }
        with patch("app.survey_mission._google_key", return_value="fake-key"):
            with patch("app.survey_mission._fetch_json", return_value=(fake_data, "test")):
                response = self.client.get(
                    "/api/survey/suggest",
                    params={"query": "eiffel", "language": "zh-CN"},
                )
        self.assertEqual(200, response.status_code)
        suggestions = response.json()["suggestions"]
        self.assertEqual(1, len(suggestions))
        self.assertEqual("Eiffel Tower", suggestions[0]["name"])
        self.assertEqual("Paris", suggestions[0]["address"])

    def test_nearby_without_key_returns_empty(self):
        with patch("app.survey_mission._google_key", return_value=""):
            response = self.client.get(
                "/api/survey/places/nearby",
                params={"lat": 48.8584, "lng": 2.2945, "radius": 1000},
            )
        self.assertEqual(200, response.status_code)
        self.assertEqual([], response.json()["places"])

    def test_nearby_parses_google_results(self):
        fake_data = {
            "status": "OK",
            "results": [
                {
                    "place_id": "n1",
                    "name": "Champ de Mars",
                    "vicinity": "Paris",
                    "geometry": {"location": {"lat": 48.85, "lng": 2.29}},
                    "types": ["park"],
                    "rating": 4.6,
                }
            ],
        }
        with patch("app.survey_mission._google_key", return_value="fake-key"):
            with patch("app.survey_mission._fetch_json", return_value=(fake_data, "test")):
                response = self.client.get(
                    "/api/survey/places/nearby",
                    params={"lat": 48.8584, "lng": 2.2945, "radius": 1000},
                )
        self.assertEqual(200, response.status_code)
        places = response.json()["places"]
        self.assertEqual(1, len(places))
        self.assertEqual("Champ de Mars", places[0]["name"])
        self.assertEqual(4.6, places[0]["rating"])


if __name__ == "__main__":
    unittest.main()
