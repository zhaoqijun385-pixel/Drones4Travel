import tempfile
import unittest
from pathlib import Path

from app.mission_reports import MissionReportCreate, build_report_pdf, summarize_payload


PNG_1X1 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8"
    "/x8AAwMCAO+/p9sAAAAASUVORK5CYII="
)


def capture(drone_id, lat, lon, alt=30):
    return {
        "filename": f"{drone_id}.png",
        "contentType": "image/png",
        "dataUrl": f"data:image/png;base64,{PNG_1X1}",
        "droneId": drone_id,
        "vantageLabel": f"{drone_id} north view",
        "lat": lat,
        "lon": lon,
        "alt": alt,
        "yaw": 0,
        "pitch": -15,
        "roll": 0,
    }


class MissionReportPdfTest(unittest.TestCase):
    def test_builds_pdf_and_summarizes_task3_metadata(self):
        payload = MissionReportCreate(
            title="MIT low-altitude observation",
            summary="Customer-ready scouting report.",
            roomId="local-flight-room",
            missionId="mission-123",
            locations=[
                {
                    "title": "MIT Dome",
                    "address": "Cambridge, MA",
                    "route": {
                        "origin": {"label": "Drop-off", "lat": 42.3601, "lon": -71.0942},
                        "destination": {"label": "Observation point", "lat": 42.3602, "lon": -71.0941},
                        "mode": "walk",
                        "instructions": ["Walk east to the viewing point."],
                    },
                    "captures": [
                        capture("cf-01", 42.3602, -71.0941),
                        capture("cf-02", 42.3602001, -71.0941001),
                    ],
                }
            ],
        )

        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "report.pdf"
            summary = build_report_pdf(payload, output)
            self.assertTrue(output.exists())
            self.assertTrue(output.read_bytes().startswith(b"%PDF"))

        self.assertEqual(1, summary["locationCount"])
        self.assertEqual(2, summary["captureCount"])
        self.assertGreater(summary["locations"][0]["route"]["distanceMeters"], 0)
        self.assertEqual("warning", summary["safety"]["status"])
        self.assertEqual(1, summary["safety"]["warningCount"])

    def test_summary_excludes_large_data_urls_from_database_payload(self):
        payload = MissionReportCreate(
            title="Data URL trimming",
            locations=[{"title": "Site", "captures": [capture("cf-01", 1, 1)]}],
        )
        summary = summarize_payload(payload)
        self.assertNotIn("dataUrl", summary["locations"][0]["captures"][0])
        self.assertTrue(payload.locations[0].captures[0].dataUrl)


if __name__ == "__main__":
    unittest.main()
