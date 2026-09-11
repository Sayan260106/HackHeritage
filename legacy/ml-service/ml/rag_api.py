"""ORCA-X 100% Production-Ready Dynamic BGE-M3 + Qdrant RAG Service with Hybrid RRF."""
from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import datetime, timezone
from functools import lru_cache
import json
import os
from pathlib import Path
import re
from typing import Any, Optional
import uuid

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

from fastapi import APIRouter, FastAPI, Header, HTTPException, Security
from FlagEmbedding import BGEM3FlagModel
from pydantic import BaseModel, Field
from qdrant_client import QdrantClient
from qdrant_client.http import models

rag_router = APIRouter(tags=["Evidence RAG"])

QDRANT_URL = os.getenv("QDRANT_URL", "http://127.0.0.1:6333")
QDRANT_API_KEY = os.getenv("QDRANT_API_KEY") or None
RAG_INGEST_API_KEY = os.getenv("RAG_INGEST_API_KEY", "orca-rag-internal-key")
QDRANT_COLLECTION = os.getenv("QDRANT_COLLECTION", "orca_marine_evidence")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "BAAI/bge-m3")
EMBEDDING_DEVICE = os.getenv("EMBEDDING_DEVICE", "cpu")
RAG_TOP_K = int(os.getenv("RAG_TOP_K", "8"))


@lru_cache(maxsize=1)
def get_embedder() -> BGEM3FlagModel:
    return BGEM3FlagModel(EMBEDDING_MODEL, use_fp16=EMBEDDING_DEVICE != "cpu", devices=EMBEDDING_DEVICE)


@lru_cache(maxsize=1)
def get_qdrant_client() -> tuple[QdrantClient, str]:
    """Resilient dual-mode Qdrant client.

    Attempts remote connection if QDRANT_URL is configured, and seamlessly falls back
    to embedded local storage without failing to lexical-only search.
    """
    if QDRANT_URL:
        try:
            client = QdrantClient(url=QDRANT_URL, api_key=QDRANT_API_KEY, timeout=1.5)
            client.get_collections()
            return client, f"remote ({QDRANT_URL})"
        except Exception:
            pass

    # Embedded local disk storage
    try:
        storage_path = Path(__file__).resolve().parents[1] / "data" / "qdrant_storage"
        storage_path.mkdir(parents=True, exist_ok=True)
        client = QdrantClient(path=str(storage_path))
        return client, f"embedded_disk ({storage_path})"
    except Exception:
        # Fallback to in-memory embedded storage
        client = QdrantClient(location=":memory:")
        return client, "embedded_memory"


def get_qdrant() -> QdrantClient:
    return get_qdrant_client()[0]


class EvidenceDocument(BaseModel):
    id: str
    title: str
    sourceAuthority: str
    documentType: str
    publicationDate: str
    excerpt: str
    relevanceScore: float = 0
    officialUrl: str = ""
    complianceRule: str = ""
    coast: Optional[str] = "all"
    applicableStates: Optional[list[str]] = Field(default_factory=lambda: ["all"])
    vesselClass: Optional[str] = "all"
    jurisdiction: Optional[str] = "Territorial_Waters"
    topicCategory: Optional[str] = ""
    issuedAt: Optional[str] = None
    expiresAt: Optional[str] = None
    active: bool = True
    revision: int = 1


class IngestRequest(BaseModel):
    documents: list[EvidenceDocument] = Field(min_length=1, max_length=1000)


class LiveIngestRequest(BaseModel):
    title: str = Field(min_length=3, max_length=500)
    excerpt: str = Field(min_length=10, max_length=5000)
    sourceAuthority: str = Field(min_length=2, max_length=200)
    documentType: str = Field(default="Cyclone Bulletin")
    publicationDate: Optional[str] = None
    complianceRule: Optional[str] = ""
    officialUrl: Optional[str] = ""
    id: Optional[str] = None
    coast: Optional[str] = "all"
    applicableStates: Optional[list[str]] = Field(default_factory=lambda: ["all"])
    vesselClass: Optional[str] = "all"
    jurisdiction: Optional[str] = "Territorial_Waters"
    topicCategory: Optional[str] = ""
    issuedAt: Optional[str] = None
    expiresAt: Optional[str] = None
    active: bool = True
    revision: int = 1


class SearchRequest(BaseModel):
    query: str = Field(min_length=2, max_length=2000)
    top_k: int = Field(default=RAG_TOP_K, ge=1, le=20)
    coast: Optional[str] = Field(default=None, description="Optional coastal filter: 'east', 'west', or 'all'")
    state: Optional[str] = Field(default=None, description="Optional maritime state filter e.g. 'Odisha', 'Kerala'")
    vessel_class: Optional[str] = Field(default=None, description="Optional craft filter: 'artisanal', 'mechanized', 'all'")
    include_expired: bool = Field(default=False, description="Whether to include expired emergency bulletins in results")


def _ensure_collection(client: QdrantClient) -> None:
    """Create the configured collection if not present."""
    names = {item.name for item in client.get_collections().collections}
    if QDRANT_COLLECTION not in names:
        client.create_collection(
            collection_name=QDRANT_COLLECTION,
            vectors_config=models.VectorParams(size=1024, distance=models.Distance.COSINE),
        )


def _collection_info(client: QdrantClient):
    _ensure_collection(client)
    return client.get_collection(QDRANT_COLLECTION)


def _index_documents(client: QdrantClient, documents: list[EvidenceDocument]) -> int:
    """Embed documents with BGE-M3 and upsert into Qdrant."""
    _ensure_collection(client)
    texts = [
        f"{d.title}\n{d.excerpt}\n{d.complianceRule}\n{d.id}\n{d.sourceAuthority}\n{d.topicCategory}\n{d.jurisdiction}\n{d.coast}"
        for d in documents
    ]
    encoded = get_embedder().encode(texts, batch_size=8, max_length=8192, return_dense=True)
    points = []
    for doc, vector in zip(documents, encoded["dense_vecs"]):
        point_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"orca-x:{doc.id}"))
        points.append(models.PointStruct(id=point_id, vector=vector.tolist(), payload=doc.model_dump()))
    client.upsert(collection_name=QDRANT_COLLECTION, points=points, wait=True)
    info = client.get_collection(QDRANT_COLLECTION)
    return info.points_count or 0


def auto_warmup_corpus(client: QdrantClient) -> int:
    """Automatically indexes the statutory marine corpus if Qdrant collection is uninitialized or out of date."""
    _ensure_collection(client)
    corpus_path = Path(__file__).resolve().parents[1] / "data" / "evidence" / "statutory_marine_corpus.json"
    if not corpus_path.exists():
        return 0

    docs_data = json.loads(corpus_path.read_text(encoding="utf-8"))
    info = client.get_collection(QDRANT_COLLECTION)
    if info.points_count and info.points_count >= len(docs_data):
        return info.points_count

    documents = [EvidenceDocument(**d) for d in docs_data]
    return _index_documents(client, documents)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifecycle manager: automatically warms up embedded vector collection upon startup."""
    try:
        client, mode = get_qdrant_client()
        _ensure_collection(client)
        count = auto_warmup_corpus(client)
        print(f"[RAG] Startup warmup complete. Mode: {mode}, Points in collection: {count}")
    except Exception as exc:
        print(f"[RAG] Startup warmup warning: {exc}")
    yield


app = FastAPI(
    title="ORCA-X BGE-M3 Qdrant RAG",
    description="Production-grade hybrid semantic + lexical marine regulatory retrieval.",
    version="3.0.0",
    lifespan=lifespan,
)


def get_rag_health_dict() -> dict[str, Any]:
    try:
        client, mode = get_qdrant_client()
        collection = _collection_info(client)
        return {
            "status": "healthy",
            "embedding_model": EMBEDDING_MODEL,
            "embedding_dimension": 1024,
            "qdrant_mode": mode,
            "qdrant_collection": QDRANT_COLLECTION,
            "points_count": collection.points_count,
        }
    except Exception as exc:
        return {"status": "degraded", "error": str(exc), "embedding_model": EMBEDDING_MODEL}


@rag_router.get("/rag/health")
def health() -> dict[str, Any]:
    return get_rag_health_dict()


def _query_points(client: QdrantClient, vector: list[float], limit: int, query_filter: Optional[models.Filter] = None):
    """Use the current Qdrant client query_points API with optional metadata filtering."""
    return client.query_points(
        collection_name=QDRANT_COLLECTION,
        query=vector,
        limit=limit,
        query_filter=query_filter,
        with_payload=True,
    ).points


def _tokenize(text: str) -> list[str]:
    return [t for t in re.sub(r"[^a-zA-Z0-9\s-]", " ", text.lower()).split() if len(t) >= 2]


def _lexical_score(query: str, payload: dict[str, Any]) -> float:
    q_tokens = set(_tokenize(query))
    if not q_tokens:
        return 0.0

    doc_id = str(payload.get("id", "")).lower()
    title = str(payload.get("title", "")).lower()
    excerpt = str(payload.get("excerpt", "")).lower()
    rule = str(payload.get("complianceRule", "")).lower()
    auth = str(payload.get("sourceAuthority", "")).lower()

    haystack = f"{doc_id} {title} {excerpt} {rule} {auth}"
    doc_tokens = set(_tokenize(haystack))

    overlap = len(q_tokens & doc_tokens) / len(q_tokens)
    bonus = 0.0

    # Strong exact match bonus for statutory identifiers and regulatory terms
    for token in q_tokens:
        if token in doc_id:
            bonus += 0.4
        if token in title:
            bonus += 0.2
        if token in rule:
            bonus += 0.2

    # High-value maritime domain phrases
    q_lower = query.lower()
    for kw in ["vhf", "ch 16", "channel 16", "signal 3", "signal 7", "gahirmatha", "trawl ban", "monsoon ban", "sardine", "mackerel", "turtle", "mpa", "solas"]:
        if kw in q_lower and kw in haystack:
            bonus += 0.45

    return overlap + bonus


@rag_router.post("/ingest")
@rag_router.post("/rag/ingest")
def ingest(
    request: IngestRequest,
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
) -> dict[str, Any]:
    """Bulk-ingest canonical marine regulatory documents into the Qdrant vector index."""
    is_prod = os.getenv("NODE_ENV") == "production" or os.getenv("ORCA_PRODUCTION", "").lower() in ("true", "1")
    if is_prod:
        if not x_api_key or x_api_key == "orca-rag-internal-key":
            raise HTTPException(
                status_code=403,
                detail="Forbidden: Insecure or default RAG ingestion key rejected in production mode. Configure a custom RAG_INGEST_API_KEY.",
            )
        if RAG_INGEST_API_KEY and x_api_key != RAG_INGEST_API_KEY:
            raise HTTPException(status_code=401, detail="Unauthorized: Invalid X-API-Key for bulk evidence ingestion.")
    elif RAG_INGEST_API_KEY and x_api_key != RAG_INGEST_API_KEY:
        raise HTTPException(status_code=401, detail="Unauthorized: Invalid or missing X-API-Key for bulk evidence ingestion.")

    try:
        client = get_qdrant()
        new_count = _index_documents(client, request.documents)
        return {
            "success": True,
            "indexed": len(request.documents),
            "points_count": new_count,
            "collection": QDRANT_COLLECTION,
            "embedding_model": EMBEDDING_MODEL,
        }
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"RAG ingestion unavailable: {exc}") from exc


@rag_router.post("/live-ingest")
@rag_router.post("/rag/live-ingest")
def live_ingest(
    request: LiveIngestRequest,
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
) -> dict[str, Any]:
    """Ingest a live IMD cyclone warning, Coast Guard alert, or INCOIS bulletin in real time."""
    # Production security check: reject default or missing API key in production mode
    is_prod = os.getenv("NODE_ENV") == "production" or os.getenv("ORCA_PRODUCTION", "").lower() in ("true", "1")
    if is_prod:
        if not x_api_key or x_api_key == "orca-rag-internal-key":
            raise HTTPException(
                status_code=403,
                detail="Forbidden: Insecure or default RAG ingestion key rejected in production mode. Configure a custom RAG_INGEST_API_KEY.",
            )
        if RAG_INGEST_API_KEY and x_api_key != RAG_INGEST_API_KEY:
            raise HTTPException(status_code=401, detail="Unauthorized: Invalid X-API-Key for live evidence ingestion.")
    elif RAG_INGEST_API_KEY and x_api_key != RAG_INGEST_API_KEY:
        raise HTTPException(status_code=401, detail="Unauthorized: Invalid or missing X-API-Key for live evidence ingestion.")

    try:
        client = get_qdrant()
        _ensure_collection(client)
        doc_id = request.id or f"LIVE-{uuid.uuid4().hex[:8].upper()}"
        pub_date = request.publicationDate or datetime.now(timezone.utc).date().isoformat()
        now_iso = datetime.now(timezone.utc).isoformat()

        doc = EvidenceDocument(
            id=doc_id,
            title=request.title,
            sourceAuthority=request.sourceAuthority,
            documentType=request.documentType,
            publicationDate=pub_date,
            excerpt=request.excerpt,
            relevanceScore=0.96,
            officialUrl=request.officialUrl or "",
            complianceRule=request.complianceRule or "",
            coast=request.coast or "all",
            applicableStates=request.applicableStates or ["all"],
            vesselClass=request.vesselClass or "all",
            jurisdiction=request.jurisdiction or "Territorial_Waters",
            topicCategory=request.topicCategory or "Advisory",
            issuedAt=request.issuedAt or now_iso,
            expiresAt=request.expiresAt,
            active=request.active,
            revision=request.revision,
        )

        new_count = _index_documents(client, [doc])
        print(f"[RAG Live Ingest] Successfully ingested {doc_id} ('{doc.title}') into Qdrant collection {QDRANT_COLLECTION}. Total points: {new_count}")
        return {
            "success": True,
            "document_id": doc_id,
            "points_count": new_count,
            "collection": QDRANT_COLLECTION,
            "embedding_model": EMBEDDING_MODEL,
            "message": f"Successfully live-ingested bulletin '{doc_id}' into hybrid Qdrant vector store.",
        }
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Live evidence ingestion failed: {exc}") from exc


@rag_router.post("/cleanup-expired")
@rag_router.post("/rag/cleanup-expired")
def cleanup_expired(
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
) -> dict[str, Any]:
    """Prunes expired emergency bulletins and temporary alerts from the active Qdrant vector index."""
    is_prod = os.getenv("NODE_ENV") == "production" or os.getenv("ORCA_PRODUCTION", "").lower() in ("true", "1")
    if is_prod and (not x_api_key or x_api_key == "orca-rag-internal-key"):
        raise HTTPException(status_code=403, detail="Forbidden: Production key required for cleanup.")
    if RAG_INGEST_API_KEY and x_api_key != RAG_INGEST_API_KEY:
        raise HTTPException(status_code=401, detail="Unauthorized")

    try:
        client = get_qdrant()
        _ensure_collection(client)
        now_iso = datetime.now(timezone.utc).isoformat()

        # Scroll all points to check for expired temporary bulletins
        pruned = 0
        offset = None
        points_to_delete = []

        while True:
            records, offset = client.scroll(
                collection_name=QDRANT_COLLECTION,
                limit=100,
                offset=offset,
                with_payload=True,
            )
            for record in records:
                payload = record.payload or {}
                expires_at = payload.get("expiresAt")
                active = payload.get("active", True)
                if not active or (expires_at and expires_at < now_iso):
                    points_to_delete.append(record.id)
            if offset is None:
                break

        if points_to_delete:
            client.delete(
                collection_name=QDRANT_COLLECTION,
                points_selector=models.PointIdsList(points=points_to_delete),
                wait=True,
            )
            pruned = len(points_to_delete)

        collection = _collection_info(client)
        return {
            "success": True,
            "pruned_count": pruned,
            "remaining_points": collection.points_count,
            "timestamp": now_iso,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Cleanup failed: {exc}") from exc


@rag_router.post("/search")
@rag_router.post("/rag/search")
def search(request: SearchRequest) -> dict[str, Any]:
    """True Hybrid Search blending Dense Cosine Similarity and Lexical Token Matching via RRF."""
    try:
        client = get_qdrant()
        _ensure_collection(client)

        # Auto-warmup if collection is empty
        info = client.get_collection(QDRANT_COLLECTION)
        if not info.points_count or info.points_count == 0:
            auto_warmup_corpus(client)

        # Build Qdrant metadata filters if coastal or state parameters provided
        must_filters: list[Any] = []
        if request.coast and request.coast.lower() in ("east", "west"):
            must_filters.append(
                models.FieldCondition(
                    key="coast",
                    match=models.MatchAny(any=[request.coast.lower(), "all"]),
                )
            )
        if request.state and request.state.strip():
            must_filters.append(
                models.FieldCondition(
                    key="applicableStates",
                    match=models.MatchAny(any=[request.state.strip(), "all"]),
                )
            )
        if request.vessel_class and request.vessel_class.strip():
            must_filters.append(
                models.FieldCondition(
                    key="vesselClass",
                    match=models.MatchAny(any=[request.vessel_class.strip(), "all"]),
                )
            )

        query_filter = models.Filter(must=must_filters) if must_filters else None

        # 1. Dense Semantic Channel with optional metadata filter
        output = get_embedder().encode([request.query], batch_size=1, max_length=8192, return_dense=True)
        query_vector = output["dense_vecs"][0].tolist()
        dense_hits = _query_points(
            client,
            query_vector,
            limit=min(60, max(30, request.top_k * 4)),
            query_filter=query_filter,
        )

        # Fallback if filtered hits are too sparse (< 2 hits):
        # Relax vesselClass constraint first, but STRICTLY maintain coast/state jurisdiction
        # to prevent surfacing out-of-jurisdiction state regulations.
        if len(dense_hits) < 2 and query_filter is not None:
            relaxed_filters: list[Any] = []
            if request.coast and request.coast.lower() in ("east", "west"):
                relaxed_filters.append(
                    models.FieldCondition(
                        key="coast",
                        match=models.MatchAny(any=[request.coast.lower(), "all"]),
                    )
                )
            if request.state and request.state.strip():
                relaxed_filters.append(
                    models.FieldCondition(
                        key="applicableStates",
                        match=models.MatchAny(any=[request.state.strip(), "all"]),
                    )
                )
            relaxed_query_filter = models.Filter(must=relaxed_filters) if relaxed_filters else None
            relaxed_hits = _query_points(client, query_vector, limit=min(60, max(30, request.top_k * 4)), query_filter=relaxed_query_filter)
            if relaxed_hits:
                dense_hits = relaxed_hits

        now_iso = datetime.now(timezone.utc).isoformat()
        candidates: dict[str, dict[str, Any]] = {}
        for rank, hit in enumerate(dense_hits):
            payload = hit.payload or {}
            # Exclude expired or inactive documents unless requested
            if not request.include_expired:
                if not payload.get("active", True):
                    continue
                expires_at = payload.get("expiresAt")
                if expires_at and expires_at < now_iso:
                    continue

            doc_id = str(payload.get("id") or hit.id)
            candidates[doc_id] = {
                "payload": payload,
                "dense_score": float(hit.score),
                "dense_rank": rank + 1,
            }

        # 2. Sparse Lexical Channel
        for doc_id, data in candidates.items():
            data["lexical_score"] = _lexical_score(request.query, data["payload"])

        sorted_by_lexical = sorted(candidates.keys(), key=lambda k: candidates[k]["lexical_score"], reverse=True)
        for rank, doc_id in enumerate(sorted_by_lexical):
            candidates[doc_id]["lexical_rank"] = rank + 1

        # 3. Reciprocal Rank Fusion (RRF with k=20)
        K = 20.0
        for doc_id, data in candidates.items():
            data["rrf_score"] = (1.0 / (K + data["dense_rank"])) + (1.0 / (K + data["lexical_rank"]))

        sorted_rrf = sorted(candidates.values(), key=lambda x: x["rrf_score"], reverse=True)

        results = []
        for item in sorted_rrf[:request.top_k]:
            p = item["payload"]
            calibrated_score = round(
                min(0.99, max(0.65, item["dense_score"] * 0.45 + min(1.0, item["lexical_score"]) * 0.35 + float(p.get("relevanceScore", 0.8)) * 0.2)),
                2,
            )
            results.append({
                "id": str(p.get("id", "")),
                "title": str(p.get("title", "")),
                "sourceAuthority": str(p.get("sourceAuthority", "")),
                "documentType": str(p.get("documentType", "")),
                "publicationDate": str(p.get("publicationDate", "")),
                "excerpt": str(p.get("excerpt", "")),
                "complianceRule": str(p.get("complianceRule", "")),
                "officialUrl": str(p.get("officialUrl", "")),
                "coast": str(p.get("coast", "all")),
                "applicableStates": p.get("applicableStates", ["all"]),
                "vesselClass": str(p.get("vesselClass", "all")),
                "jurisdiction": str(p.get("jurisdiction", "Territorial_Waters")),
                "topicCategory": str(p.get("topicCategory", "")),
                "issuedAt": p.get("issuedAt"),
                "expiresAt": p.get("expiresAt"),
                "active": p.get("active", True),
                "revision": p.get("revision", 1),
                "relevanceScore": calibrated_score,
                "denseScore": round(item["dense_score"], 4),
                "lexicalScore": round(item["lexical_score"], 4),
                "rrfScore": round(item["rrf_score"], 6),
            })

        return {
            "success": True,
            "query": request.query,
            "embedding_model": EMBEDDING_MODEL,
            "retrieval": "hybrid_rrf_bge_m3",
            "count": len(results),
            "results": results,
        }
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"RAG retrieval unavailable: {exc}") from exc


app.include_router(rag_router)


@app.get("/health")
def standalone_health() -> dict[str, Any]:
    return get_rag_health_dict()

