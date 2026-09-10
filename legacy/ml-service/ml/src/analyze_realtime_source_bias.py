"""Analyze persisted ORCA-X multi-source telemetry before any ML retraining.

This script intentionally does not train or modify a model. It measures source
coverage, missingness, quality and pairwise disagreement from the JSONL telemetry
written by the server and exposes an auditable evidence gate for v2.7 review.
"""

from __future__ import annotations

import json
import os
from collections import defaultdict
from pathlib import Path
from statistics import mean

VARIABLES = [
    "windSpeedKts", "windGustKts", "waveHeightMeters", "wavePeriodSec",
    "swellHeightMeters", "swellPeriodSec", "seaSurfaceTemperatureC",
]

DEFAULT_PATH = Path("data/realtime/marine_telemetry.jsonl")
REPORT_PATH = Path(os.getenv("REALTIME_EVIDENCE_REPORT_PATH", "ml/evaluations/realtime_source_evidence_gate.json"))
MIN_EVENTS = max(1, int(os.getenv("REALTIME_ANALYSIS_MIN_EVENTS", "100")))
MIN_LIVE_SOURCES = max(2, int(os.getenv("REALTIME_ANALYSIS_MIN_LIVE_SOURCES", "2")))
MIN_SOURCE_LIVE_RATE = min(1.0, max(0.0, float(os.getenv("REALTIME_ANALYSIS_MIN_LIVE_RATE", "0.80"))))
MIN_PAIRWISE_SAMPLES = max(1, int(os.getenv("REALTIME_ANALYSIS_MIN_PAIRWISE_SAMPLES", "50")))
MIN_SOURCE_QUALITY = min(1.0, max(0.0, float(os.getenv("REALTIME_ANALYSIS_MIN_SOURCE_QUALITY", "0.60"))))


def load_events(path: Path) -> list[dict]:
    if not path.exists():
        raise SystemExit(f"Telemetry file not found: {path}. Run the realtime collector first.")
    events: list[dict] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            item = json.loads(line)
            if isinstance(item, dict) and isinstance(item.get("sources"), list):
                events.append(item)
        except json.JSONDecodeError:
            continue
    return events


def build_report(events: list[dict]) -> dict:
    source_rows: dict[str, list[dict]] = defaultdict(list)
    pair_rows: dict[tuple[str, str, str], list[float]] = defaultdict(list)
    signed_rows: dict[tuple[str, str, str], list[float]] = defaultdict(list)

    for event in events:
        sources = event["sources"]
        for source in sources:
            source_rows[source.get("source", "UNKNOWN")].append(source)
        for left_idx, left in enumerate(sources):
            for right in sources[left_idx + 1:]:
                left_name, right_name = sorted((left.get("source", "UNKNOWN"), right.get("source", "UNKNOWN")))
                left_by_var, right_by_var = left.get("values", {}), right.get("values", {})
                for variable in VARIABLES:
                    a, b = left_by_var.get(variable), right_by_var.get(variable)
                    if not isinstance(a, (int, float)) or not isinstance(b, (int, float)):
                        continue
                    denominator = max(abs(float(b)), 0.1)
                    key = (left_name, right_name, variable)
                    pair_rows[key].append(abs(float(a) - float(b)) / denominator)
                    signed_rows[key].append(float(a) - float(b))

    source_report = {
        source: {
            "observations": len(rows),
            "live_rate": round(sum(row.get("availability") == "LIVE" for row in rows) / len(rows), 4),
            "mean_quality": round(mean(float(row.get("qualityScore", 0)) for row in rows), 4),
            "mean_missing_variables": round(mean(len(row.get("missingVariables", [])) for row in rows), 2),
        }
        for source, rows in sorted(source_rows.items())
    }
    live_sources = [source for source, values in source_report.items()
                    if source != "UNKNOWN" and values["live_rate"] >= MIN_SOURCE_LIVE_RATE
                    and values["mean_quality"] >= MIN_SOURCE_QUALITY]
    pairwise_pairs = {
        f"{left}__{right}": {
            "samples": sum(len(values) for (a, b, _), values in pair_rows.items() if (a, b) == (left, right)),
            "variables": sorted(variable for (a, b, variable) in pair_rows if (a, b) == (left, right)),
        }
        for left, right in sorted({(a, b) for a, b, _ in pair_rows})
    }
    pairwise_evidence = [key for key, value in pairwise_pairs.items() if value["samples"] >= MIN_PAIRWISE_SAMPLES]
    criteria = {
        "minimum_events": {"required": MIN_EVENTS, "actual": len(events), "pass": len(events) >= MIN_EVENTS},
        "minimum_live_sources": {"required": MIN_LIVE_SOURCES, "actual": len(live_sources), "pass": len(live_sources) >= MIN_LIVE_SOURCES},
        "source_live_rate": {"required": MIN_SOURCE_LIVE_RATE, "sources": live_sources, "pass": len(live_sources) >= MIN_LIVE_SOURCES},
        "pairwise_evidence": {"required_samples_per_pair": MIN_PAIRWISE_SAMPLES, "pairs_with_evidence": pairwise_evidence, "pass": len(pairwise_evidence) >= 1},
        "distribution_shift_review": {"pass": False, "reason": "Requires explicit domain/engineering review before v2.7 training."},
    }
    return {
        "schema_version": 1,
        "generated_at": pd_timestamp_now(),
        "event_count": len(events),
        "sources": source_report,
        "pairwise_bias": {
            f"{left}__{right}__{variable}": {
                "samples": len(values),
                "mean_relative_difference": round(mean(values), 4),
                "mean_signed_difference": round(mean(signed_rows[(left, right, variable)]), 4),
            }
            for (left, right, variable), values in sorted(pair_rows.items())
        },
        "gate": {
            "ready_for_retraining": False,
            "criteria": criteria,
            "reason": "Multi-source evidence and explicit distribution-shift review are required before XGBoost v2.7 retraining.",
        },
    }


def pd_timestamp_now() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


def main() -> None:
    path = Path(os.getenv("ORCA_TELEMETRY_PATH", str(DEFAULT_PATH)))
    report = build_report(load_events(path))
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2, sort_keys=True))
    print(f"Evidence report written: {REPORT_PATH}")


if __name__ == "__main__":
    main()
