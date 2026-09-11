"""Contract tests for the committed ORCA-X ML inference service."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

ML_ROOT = Path(__file__).resolve().parents[1]
ML_SRC = ML_ROOT / "src"
if str(ML_SRC) not in sys.path:
    sys.path.insert(0, str(ML_SRC))

try:
    from ml.src.predict import LEGACY_FEATURE_COLUMNS, MODEL_VERSION, OrcaXRiskPredictor, build_inference_features  # noqa: E402
except ImportError:
    # pyrefly: ignore [missing-import]
    from predict import LEGACY_FEATURE_COLUMNS, MODEL_VERSION, OrcaXRiskPredictor, build_inference_features  # noqa: E402



class InferenceContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.predictor = OrcaXRiskPredictor()
        cls.sample = {
            "wind_speed_kts": 12.0,
            "wind_gust_kts": 16.0,
            "wave_height_m": 1.2,
            "wave_period_s": 7.0,
            "swell_height_m": 0.6,
            "swell_period_s": 6.0,
            "wind_direction_deg": 220.0,
            "wave_direction_deg": 130.0,
            "swell_direction_deg": 120.0,
            "air_pressure_hpa": 1015.0,
            "air_temperature_c": 25.0,
            "sea_surface_temperature_c": 26.0,
            "precipitation_mm": 0.0,
            "visibility_km": 12.0,
            "latitude": 21.6266,
            "longitude": 87.5074,
            "month": 8,
            "season": 2,
            "observed_at": "2026-08-25T03:00:00Z",
        }

    def test_feature_contract_matches_committed_metadata(self) -> None:
        self.assertEqual(self.predictor.feature_columns, self.predictor.metadata["features"])
        self.assertEqual(len(self.predictor.feature_columns), self.predictor.metadata["feature_count"])
        self.assertEqual(set(self.predictor.metadata["classes"].values()), {"LOW", "MODERATE", "HIGH", "EXTREME"})
        self.assertIn(self.predictor.model_version, {MODEL_VERSION, "orca-xgb-risk-v1"})


    def test_legacy_model_can_consume_current_live_payload(self) -> None:
        model_features = build_inference_features(self.sample, LEGACY_FEATURE_COLUMNS)
        self.assertEqual(set(model_features), set(LEGACY_FEATURE_COLUMNS))
        self.assertEqual(model_features["mean_wave_period_s"], self.sample["wave_period_s"])
        self.assertEqual(model_features["water_temperature_c"], self.sample["sea_surface_temperature_c"])
        self.assertEqual(model_features["hour"], 3.0)

    def test_prediction_returns_valid_probability_distribution(self) -> None:
        result = self.predictor.predict_one(self.sample)
        probabilities = result["probabilities"]

        self.assertEqual(result["model_version"], self.predictor.model_version)
        self.assertIn(result["risk_label"], {"LOW", "MODERATE", "HIGH", "EXTREME"})
        self.assertAlmostEqual(sum(probabilities.values()), 1.0, places=5)
        self.assertTrue(all(0.0 <= value <= 1.0 for value in probabilities.values()))
        self.assertEqual(set(probabilities), {"LOW", "MODERATE", "HIGH", "EXTREME"})

    def test_confidence_matches_exposed_top_probability(self) -> None:
        result = self.predictor.predict_one(self.sample)
        self.assertEqual(result["confidence"], max(result["probabilities"].values()))
        self.assertEqual(result["confidence"], result["probabilities"][result["risk_label"]])

    def test_invalid_physical_input_is_rejected(self) -> None:
        invalid = dict(self.sample)
        invalid["wave_height_m"] = -1.0

        with self.assertRaises(ValueError):
            self.predictor.predict_one(invalid)

    def test_batch_prediction_matches_single_prediction(self) -> None:
        batch_results = self.predictor.predict_batch([self.sample, self.sample])
        single_result = self.predictor.predict_one(self.sample)
        self.assertEqual(len(batch_results), 2)
        self.assertEqual(batch_results[0]["risk_label"], single_result["risk_label"])
        self.assertEqual(batch_results[0]["confidence"], single_result["confidence"])
        self.assertEqual(batch_results[1]["risk_label"], single_result["risk_label"])

    def test_hourly_forecast_contract(self) -> None:
        # Test naive ISO timestamp common in Open-Meteo hourly forecast
        forecast_point = dict(self.sample)
        forecast_point["observed_at"] = "2026-09-08T15:00"
        features = build_inference_features(forecast_point, LEGACY_FEATURE_COLUMNS)
        self.assertEqual(features["hour"], 15.0)

        # Test explicit hour parameter
        forecast_point_explicit = dict(self.sample)
        forecast_point_explicit["hour"] = 21
        features_explicit = build_inference_features(forecast_point_explicit, LEGACY_FEATURE_COLUMNS)
        self.assertEqual(features_explicit["hour"], 21.0)

    def test_missing_coordinates_rejected(self) -> None:
        # Latitude missing
        no_lat = dict(self.sample)
        del no_lat["latitude"]
        with self.assertRaises(ValueError):
            self.predictor.predict_one(no_lat)

        # Longitude missing
        no_lon = dict(self.sample)
        del no_lon["longitude"]
        with self.assertRaises(ValueError):
            self.predictor.predict_one(no_lon)

    def test_missing_timestamp_rejected(self) -> None:
        # Both observed_at and month/hour missing
        no_time = dict(self.sample)
        del no_time["observed_at"]
        del no_time["month"]
        if "hour" in no_time:
            del no_time["hour"]
        with self.assertRaises(ValueError):
            self.predictor.predict_one(no_time)

    def test_uncertainty_and_conformal_metrics(self) -> None:
        result = self.predictor.predict_one(self.sample)
        self.assertIn("uncertainty", result)
        unc = result["uncertainty"]

        self.assertIn("softmax_entropy", unc)
        self.assertIn("normalized_entropy", unc)
        self.assertIn("margin", unc)
        self.assertIn("conformal_confidence_band", unc)
        self.assertIn("conformal_prediction_set", unc)

        self.assertGreaterEqual(unc["softmax_entropy"], 0.0)
        self.assertTrue(0.0 <= unc["normalized_entropy"] <= 1.0)
        self.assertTrue(0.0 <= unc["margin"] <= 1.0)
        band = unc["conformal_confidence_band"]
        self.assertEqual(len(band), 2)
        self.assertTrue(0.0 <= band[0] <= band[1] <= 1.0)
        self.assertIn(result["risk_label"], unc["conformal_prediction_set"])

    def test_ood_detection_for_extreme_anomalies(self) -> None:
        # Normal condition -> Not OOD
        normal_result = self.predictor.predict_one(self.sample)
        self.assertFalse(normal_result["ood_diagnostics"]["is_ood"])
        self.assertEqual(normal_result["ood_diagnostics"]["severity"], "NORMAL")

        # Rogue wave extreme anomaly (>9.0m)
        rogue_wave_point = dict(self.sample)
        rogue_wave_point["wave_height_m"] = 11.5
        ood_result = self.predictor.predict_one(rogue_wave_point)
        self.assertTrue(ood_result["ood_diagnostics"]["is_ood"])
        self.assertEqual(ood_result["ood_diagnostics"]["severity"], "EXTREME_CYCLONIC_ANOMALY")
        self.assertTrue(any("rogue/cyclonic" in a.lower() for a in ood_result["ood_diagnostics"]["anomalies"]))


    def test_dual_model_audited_realtime_prediction(self) -> None:
        from source_auditor import MarineSourceAuditor
        auditor = MarineSourceAuditor()
        sources = {
            "OPEN_METEO": {
                "observed_at": "2026-08-25T03:00:00Z",
                "values": {
                    "wind_speed_kts": 14.0,
                    "wave_height_m": 1.4,
                    "air_temperature_c": 26.0,
                    "wind_direction_deg": 210.0,
                },
            },
            "INCOIS": {
                "observed_at": "2026-08-25T02:45:00Z",
                "latitude": 21.63,
                "longitude": 87.51,
                "values": {
                    "wind_speed_kts": 16.5,
                    "wave_height_m": 1.6,
                    "water_temperature_c": 27.2,
                    "sea_surface_temperature_c": 27.2,
                    "wind_direction_deg": 225.0,
                },
            },
            "MOSDAC": {
                "observed_at": "2026-08-25T02:00:00Z",
                "values": {
                    "wind_speed_kts": 15.8,
                    "sea_surface_temperature_c": 27.0,
                },
            },
        }
        # Step 1: Model 1 Audit & Precision Fusion
        audit_res = auditor.audit_and_fuse(sources, target_lat=21.6266, target_lon=87.5074)
        self.assertIn("audited_vector", audit_res)
        fused = audit_res["audited_vector"]
        self.assertGreater(fused["wind_speed_kts"], 14.5)
        self.assertLess(fused["wind_speed_kts"], 16.5)

        # Step 2: Model 2 Predict over fused precision vector
        result = self.predictor.predict_one(fused)
        self.assertIn(result["risk_label"], {"LOW", "MODERATE", "HIGH", "EXTREME"})
        self.assertTrue(0.0 <= result["confidence"] <= 1.0)
        self.assertIn("uncertainty", result)


if __name__ == "__main__":
    unittest.main()



