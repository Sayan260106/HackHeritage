"""Unit tests for Model 1: MarineSourceAuditor."""

from __future__ import annotations

from datetime import datetime, timezone, timedelta
import unittest
import sys
from pathlib import Path

ML_SRC = Path(__file__).resolve().parents[1] / "src"
if str(ML_SRC) not in sys.path:
    sys.path.insert(0, str(ML_SRC))

from source_auditor import MarineSourceAuditor, PHYSICAL_BOUNDS


class TestMarineSourceAuditor(unittest.TestCase):
    def setUp(self):
        self.auditor = MarineSourceAuditor()
        self.target_lat = 21.626
        self.target_lon = 87.508
        self.now = datetime(2026, 9, 9, 12, 0, 0, tzinfo=timezone.utc)

    def test_bounds_checking(self):
        # Normal value
        val, err = self.auditor.audit_single_value("wave_height_m", 2.5)
        self.assertEqual(val, 2.5)
        self.assertIsNone(err)

        # Negative wave height
        val, err = self.auditor.audit_single_value("wave_height_m", -1.0)
        self.assertIsNone(val)
        self.assertIn("Physical bounds violation", err)

        # Unrealistic wind speed (>150 kts)
        val, err = self.auditor.audit_single_value("wind_speed_kts", 250.0)
        self.assertIsNone(val)
        self.assertIn("Physical bounds violation", err)

    def test_source_weight_prioritizes_fresh_incois_over_open_meteo(self):
        incois_weight, diag_incois = self.auditor.calculate_source_weight(
            source_name="INCOIS",
            observed_at=self.now - timedelta(hours=1),
            target_lat=self.target_lat,
            target_lon=self.target_lon,
            source_lat=self.target_lat + 0.05,
            source_lon=self.target_lon + 0.05,
            now=self.now,
        )
        meteo_weight, diag_meteo = self.auditor.calculate_source_weight(
            source_name="OPEN_METEO",
            observed_at=self.now,
            target_lat=self.target_lat,
            target_lon=self.target_lon,
            source_lat=self.target_lat,
            source_lon=self.target_lon,
            now=self.now,
        )
        # Ground-truth INCOIS has higher base authority than numerical weather prediction
        self.assertGreater(incois_weight, meteo_weight)

    def test_stale_source_decay(self):
        fresh_weight, _ = self.auditor.calculate_source_weight(
            source_name="MOSDAC",
            observed_at=self.now - timedelta(hours=2),
            target_lat=self.target_lat,
            target_lon=self.target_lon,
            now=self.now,
        )
        stale_weight, _ = self.auditor.calculate_source_weight(
            source_name="MOSDAC",
            observed_at=self.now - timedelta(hours=36),
            target_lat=self.target_lat,
            target_lon=self.target_lon,
            now=self.now,
        )
        self.assertGreater(fresh_weight, stale_weight * 2.0)

    def test_precision_fusion_multi_source(self):
        sources = {
            "OPEN_METEO": {
                "observed_at": self.now.isoformat(),
                "values": {
                    "wind_speed_kts": 15.0,
                    "wave_height_m": 1.5,
                    "air_temperature_c": 28.0,
                    "wind_direction_deg": 90.0,
                },
            },
            "INCOIS": {
                "observed_at": (self.now - timedelta(hours=0.5)).isoformat(),
                "latitude": self.target_lat + 0.01,
                "longitude": self.target_lon + 0.01,
                "values": {
                    "wind_speed_kts": 18.0,
                    "wave_height_m": 1.8,
                    "sea_surface_temperature_c": 29.5,
                    "wind_direction_deg": 100.0,
                },
            },
            "MOSDAC": {
                "observed_at": (self.now - timedelta(hours=1.0)).isoformat(),
                "values": {
                    "wind_speed_kts": 17.0,
                    "sea_surface_temperature_c": 29.2,
                },
            },
        }
        res = self.auditor.audit_and_fuse(sources, self.target_lat, self.target_lon, now=self.now)
        self.assertIn("audited_vector", res)
        vector = res["audited_vector"]

        # Wind speed should be fused between 15 and 18, weighted towards INCOIS & MOSDAC
        self.assertGreater(vector["wind_speed_kts"], 15.5)
        self.assertLess(vector["wind_speed_kts"], 17.8)

        # Wave height present from both Open-Meteo and INCOIS
        self.assertGreater(vector["wave_height_m"], 1.5)
        self.assertLess(vector["wave_height_m"], 1.8)

        # Latitude, longitude, month, hour set properly
        self.assertEqual(vector["latitude"], self.target_lat)
        self.assertEqual(vector["longitude"], self.target_lon)
        self.assertEqual(vector["month"], 9)
        self.assertEqual(vector["hour"], 12)

        # Provenance per variable exists
        self.assertIn("wind_speed_kts", res["provenance_per_variable"])
        self.assertEqual(len(res["provenance_per_variable"]["wind_speed_kts"]["sources_used"]), 3)


if __name__ == "__main__":
    unittest.main()
