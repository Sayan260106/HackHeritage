import { EvidenceItem, LocationInfo } from '../../src/types.ts';
import { retrieveEvidence } from './evidenceService.ts';

export interface RagRetrievalResult {
  evidence: EvidenceItem[];
  provider: 'bge-m3-qdrant' | 'lexical-fallback';
  model: string;
  retrieval: 'hybrid_rrf_bge_m3' | 'qdrant_dense_cosine' | 'lexical_fallback';
  degraded: boolean;
  error?: string;
}

const EVIDENCE_DOCUMENT_TYPES = [
  'Fisheries Advisory',
  'Ocean State Forecast',
  'Cyclone Bulletin',
  'Maritime Regulation',
  'Scientific Protocol',
] as const;

type EvidenceDocumentType = typeof EVIDENCE_DOCUMENT_TYPES[number];

function normalizeDocumentType(value: unknown): EvidenceDocumentType {
  const documentType = String(value ?? '').trim();
  return EVIDENCE_DOCUMENT_TYPES.includes(documentType as EvidenceDocumentType)
    ? (documentType as EvidenceDocumentType)
    : 'Scientific Protocol';
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`RAG request timeout after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function mapQdrantEvidence(payload: {
  results?: Array<Record<string, unknown>>;
  embedding_model?: string;
}): EvidenceItem[] {
  return (payload.results || []).map((item) => ({
    id: String(item.sourceId || item.id || 'QDRANT-EVIDENCE'),
    title: String(item.title || ''),
    sourceAuthority: String(item.sourceAuthority || ''),
    documentType: normalizeDocumentType(item.documentType),
    publicationDate: String(item.publicationDate || ''),
    excerpt: String(item.excerpt || ''),
    relevanceScore: Number(item.relevanceScore || item.score || 0),
    officialUrl: String(item.officialUrl || ''),
    complianceRule: String(item.complianceRule || ''),
  }));
}

export async function retrieveRagEvidence(
  query: string,
  location: LocationInfo,
  riskLevel: string,
): Promise<RagRetrievalResult> {
  const ragApiUrl = (process.env.ORCA_RAG_API_URL || 'http://127.0.0.1:8001').replace(/\/$/, '');
  const timeoutMs = Math.max(1000, Number(process.env.ORCA_RAG_API_TIMEOUT_MS || 5000));
  const topK = Math.min(20, Math.max(1, Number(process.env.RAG_TOP_K || 8)));

  try {
    const response = await withTimeout(fetch(`${ragApiUrl}/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', Connection: 'keep-alive' },
      body: JSON.stringify({ query, top_k: topK }),
    }), timeoutMs);

    const rawBody = await response.text();
    let payload: { results?: Array<Record<string, unknown>>; embedding_model?: string; detail?: string; retrieval?: string } = {};
    try {
      payload = JSON.parse(rawBody) as typeof payload;
    } catch {
      throw new Error(`RAG API returned non-JSON response (${response.status})`);
    }

    if (!response.ok) throw new Error(`RAG API returned ${response.status}: ${payload.detail || rawBody.slice(0, 200)}`);

    const evidence = mapQdrantEvidence(payload);
    if (!evidence.length) throw new Error('Qdrant returned no evidence');

    const retrievalType = payload.retrieval === 'hybrid_rrf_bge_m3' ? 'hybrid_rrf_bge_m3' : 'qdrant_dense_cosine';

    return {
      evidence,
      provider: 'bge-m3-qdrant',
      model: payload.embedding_model || 'BAAI/bge-m3',
      retrieval: retrievalType,
      degraded: false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[RAG] BGE-M3/Qdrant unavailable; using lexical fallback: ${message}`);
    return {
      evidence: retrieveEvidence(query, location, riskLevel),
      provider: 'lexical-fallback',
      model: 'none',
      retrieval: 'lexical_fallback',
      degraded: true,
      error: message,
    };
  }
}

export async function liveIngestEvidence(document: {
  title: string;
  excerpt: string;
  sourceAuthority: string;
  documentType?: string;
  publicationDate?: string;
  complianceRule?: string;
  officialUrl?: string;
  id?: string;
}): Promise<{ success: boolean; document_id: string; points_count: number; message: string }> {
  const ragApiUrl = (process.env.ORCA_RAG_API_URL || 'http://127.0.0.1:8001').replace(/\/$/, '');
  const timeoutMs = 8000;

  const response = await withTimeout(fetch(`${ragApiUrl}/live-ingest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(document),
  }), timeoutMs);

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Live ingest failed (${response.status}): ${text.slice(0, 200)}`);
  }
  return response.json();
}

