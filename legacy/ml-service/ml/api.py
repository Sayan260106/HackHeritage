"""ORCA-X XGBoost ML inference API with staged v1/v2 model compatibility."""
from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
import sys
from typing import Any, Optional, Union

# pyrefly: ignore [missing-import]
from fastapi import FastAPI, HTTPException
# pyrefly: ignore [missing-import]
from pydantic import BaseModel

ML_ROOT = Path(__file__).resolve().parent
ML_SRC = ML_ROOT / "src"
if str(ML_SRC) not in sys.path:
    sys.path.insert(0, str(ML_SRC))

try:
    from ml.src.predict import MODEL_VERSION, OrcaXRiskPredictor  # noqa: E402
    from ml.src.source_auditor import MarineSourceAuditor  # noqa: E402
except ImportError:
    try:
        from predict import MODEL_VERSION, OrcaXRiskPredictor  # noqa: E402
        from source_auditor import MarineSourceAuditor  # noqa: E402
    except ImportError:
        from .src.predict import MODEL_VERSION, OrcaXRiskPredictor  # noqa: E402
        from .src.source_auditor import MarineSourceAuditor  # noqa: E402

# Unified RAG integration
try:
    from ml.rag_api import (  # noqa: E402
        rag_router,
        get_rag_health_dict,
        auto_warmup_corpus,
        get_qdrant_client,
        _ensure_collection,
        _collection_info,
        EMBEDDING_MODEL,
    )
except ImportError:
    try:
        from rag_api import (  # noqa: E402
            rag_router,
            get_rag_health_dict,
            auto_warmup_corpus,
            get_qdrant_client,
            _ensure_collection,
            _collection_info,
            EMBEDDING_MODEL,
        )
    except ImportError:
        rag_router = None
        get_rag_health_dict = None
        auto_warmup_corpus = None
        get_qdrant_client = None
        _ensure_collection = None
        _collection_info = None
        EMBEDDING_MODEL = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan supervisor: warms up both ML models and embedded Qdrant vector corpus upon startup."""
    if auto_warmup_corpus and get_qdrant_client and _ensure_collection:
        try:
            client, mode = get_qdrant_client()
            _ensure_collection(client)
            count = auto_warmup_corpus(client)
            print(f"[ORCA-X Unified AI] Startup RAG warmup complete. Mode: {mode}, Points in collection: {count}")
        except Exception as exc:
            print(f"[ORCA-X Unified AI] Startup RAG warmup notice: {exc}")
    yield


app = FastAPI(
    title="ORCA-X Unified AI Microservice",
    description="Consolidated XGBoost Risk Prediction, Multi-Source Sensor Fusion, and BGE-M3 + Qdrant RAG Engine.",
    version="3.0.0",
    lifespan=lifespan,
)

if rag_router:
    app.include_router(rag_router)

predictor = OrcaXRiskPredictor()
auditor = MarineSourceAuditor()


class RiskRequest(BaseModel):
    wind_speed_kts: Optional[float] = None
    wind_gust_kts: Optional[float] = None
    wave_height_m: Optional[float] = None
    wave_period_s: Optional[float] = None
    mean_wave_period_s: Optional[float] = None
    swell_height_m: Optional[float] = None
    swell_period_s: Optional[float] = None
    wind_direction_deg: Optional[float] = None
    wave_direction_deg: Optional[float] = None
    swell_direction_deg: Optional[float] = None
    air_pressure_hpa: Optional[float] = None
    air_temperature_c: Optional[float] = None
    water_temperature_c: Optional[float] = None
    sea_surface_temperature_c: Optional[float] = None
    precipitation_mm: Optional[float] = None
    visibility_km: Optional[float] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    month: Optional[int] = None
    hour: Optional[int] = None
    season: Optional[int] = None
    observed_at: Optional[Union[datetime, str]] = None



@app.get("/")
def root():
    return {
        "service": "ORCA-X Unified AI Microservice",
        "status": "online",
        "model": "XGBoost",
        "model_version": MODEL_VERSION,
        "loaded_model_version": predictor.model_version,
        "feature_count": len(predictor.feature_columns),
        "feature_contract": predictor.feature_columns,
        "rag_unified": rag_router is not None,
        "ports": "Unified Port 8000 (ML Risk + Marine Evidence RAG)",
    }


@app.get("/health")
def health():
    res: dict[str, Any] = {
        "status": "healthy",
        "model_loaded": predictor.model is not None,
        "model_version": predictor.model_version,
        "feature_count": len(predictor.feature_columns),
    }
    if get_rag_health_dict:
        try:
            rag_data = get_rag_health_dict()
            res["rag"] = rag_data
            if rag_data.get("status") == "healthy":
                res["embedding_model"] = rag_data.get("embedding_model", EMBEDDING_MODEL or "BAAI/bge-m3")
                res["embedding_dimension"] = rag_data.get("embedding_dimension", 1024)
                res["points_count"] = rag_data.get("points_count", 0)
                res["qdrant_mode"] = rag_data.get("qdrant_mode")
                res["qdrant_collection"] = rag_data.get("qdrant_collection")
        except Exception as exc:
            res["rag"] = {"status": "degraded", "error": str(exc)}
    return res


@app.get("/ready")
def ready():
    if predictor.model is None:
        raise HTTPException(status_code=503, detail="ML model is not loaded")
    return {
        "status": "ready",
        "model_loaded": True,
        "model_version": predictor.model_version,
        "feature_count": len(predictor.feature_columns),
    }


class BatchRiskRequest(BaseModel):
    items: list[RiskRequest]


@app.post("/predict-risk")
def predict_risk(request: RiskRequest):
    try:
        payload = request.model_dump(exclude_none=True)
        if isinstance(payload.get("observed_at"), datetime):
            payload["observed_at"] = payload["observed_at"].isoformat()
        result = predictor.predict_one(payload)
        return {"success": True, **result}
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Risk prediction failed: {exc}") from exc


@app.post("/predict-risk-batch")
def predict_risk_batch(request: BatchRiskRequest):
    try:
        payloads = []
        for item in request.items:
            dumped = item.model_dump(exclude_none=True)
            if isinstance(dumped.get("observed_at"), datetime):
                dumped["observed_at"] = dumped["observed_at"].isoformat()
            payloads.append(dumped)
        results = predictor.predict_batch(payloads)
        return {"success": True, "count": len(results), "results": results}
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Batch risk prediction failed: {exc}") from exc


@app.post("/diagnostics/ood")
def diagnose_ood(request: RiskRequest):
    try:
        payload = request.model_dump(exclude_none=True)
        diagnostics = predictor.diagnose_ood(payload)
        return {"success": True, **diagnostics}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"OOD diagnostics failed: {exc}") from exc


class MultiSourceAuditRequest(BaseModel):
    sources: dict[str, Any]
    latitude: float
    longitude: float


@app.post("/audit-and-fuse")
def audit_and_fuse(request: MultiSourceAuditRequest):
    """Model 1: Ingest, audit, and fuse multiple real-time observation feeds (Open-Meteo, INCOIS, MOSDAC, Copernicus)."""
    try:
        audit_res = auditor.audit_and_fuse(
            sources_payload=request.sources,
            target_lat=request.latitude,
            target_lon=request.longitude,
        )
        return {"success": True, **audit_res}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Multi-source audit and fusion failed: {exc}") from exc


@app.post("/predict-realtime-risk")
def predict_realtime_risk(request: MultiSourceAuditRequest):
    """Dual-Model Pipeline: Model 1 (Audit & Precision Fusion) -> Model 2 (XGBoost Marine Risk Predictor)."""
    try:
        # Step 1: Execute Model 1 to produce canonical precision vector
        audit_res = auditor.audit_and_fuse(
            sources_payload=request.sources,
            target_lat=request.latitude,
            target_lon=request.longitude,
        )
        fused_vector = audit_res.get("audited_vector") or {}

        # Step 2: Execute Model 2 over the audited vector
        prediction = predictor.predict_one(fused_vector)

        return {
            "success": True,
            "pipeline": "dual-model-precision-risk",
            "audit": {
                "quality_score": audit_res.get("quality_score"),
                "active_sources": audit_res.get("active_sources"),
                "source_diagnostics": audit_res.get("source_diagnostics"),
                "audit_warnings": audit_res.get("audit_warnings"),
                "provenance_per_variable": audit_res.get("provenance_per_variable"),
                "audited_at": audit_res.get("audited_at"),
            },
            "audited_features": fused_vector,
            "prediction": prediction,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Real-time dual-model risk pipeline failed: {exc}") from exc



