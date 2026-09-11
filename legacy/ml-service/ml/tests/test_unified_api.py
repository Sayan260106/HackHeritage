"""Contract tests for unified ORCA-X FastAPI microservice (Port 8000: ML + RAG)."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

ML_ROOT = Path(__file__).resolve().parents[1]
ML_SRC = ML_ROOT / "src"
if str(ML_SRC) not in sys.path:
    sys.path.insert(0, str(ML_SRC))

try:
    from ml.api import app
except ImportError:
    from api import app


class UnifiedApiContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.client = TestClient(app)

    def test_root_endpoint_metadata(self) -> None:
        res = self.client.get("/")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["service"], "ORCA-X Unified AI Microservice")
        self.assertEqual(data["status"], "online")
        self.assertTrue(data.get("rag_unified"))

    def test_health_endpoint_satisfies_dual_contracts(self) -> None:
        res = self.client.get("/health")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        # ML health assertions
        self.assertEqual(data["status"], "healthy")
        self.assertTrue(data["model_loaded"])
        self.assertGreater(data["feature_count"], 0)
        # RAG health assertions
        self.assertIn("rag", data)
        self.assertEqual(data["rag"]["status"], "healthy")
        self.assertGreater(data["rag"]["points_count"], 0)

    def test_predict_risk_endpoint(self) -> None:
        sample = {
            "wind_speed_kts": 12.0,
            "wind_gust_kts": 16.0,
            "wave_height_m": 1.2,
            "wave_period_s": 7.0,
            "mean_wave_period_s": 7.0,
            "swell_height_m": 0.6,
            "swell_period_s": 6.0,
            "wind_direction_deg": 220.0,
            "wave_direction_deg": 130.0,
            "swell_direction_deg": 120.0,
            "air_pressure_hpa": 1015.0,
            "air_temperature_c": 25.0,
            "water_temperature_c": 26.0,
            "sea_surface_temperature_c": 26.0,
            "precipitation_mm": 0.0,
            "visibility_km": 12.0,
            "latitude": 21.6266,
            "longitude": 87.5074,
            "month": 8,
            "hour": 3,
            "season": 2,
            "observed_at": "2026-08-25T03:00:00Z",
        }
        res = self.client.post("/predict-risk", json=sample)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data["success"])
        self.assertIn("risk_label", data)
        self.assertIn(data["risk_label"], ["LOW", "MODERATE", "HIGH", "EXTREME"])

    def test_rag_search_via_unified_endpoint(self) -> None:
        res = self.client.post(
            "/search",
            json={"query": "What is the monsoon trawl ban period for West Bengal?", "top_k": 3},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data["success"])
        self.assertGreater(data["count"], 0)
        self.assertIn("results", data)
        first_doc = data["results"][0]
        self.assertTrue(any(term in first_doc["title"].lower() or term in first_doc["excerpt"].lower() for term in ["trawl", "ban", "monsoon", "west bengal"]))

    def test_rag_aliased_path(self) -> None:
        res = self.client.get("/rag/health")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "healthy")


if __name__ == "__main__":
    unittest.main()
