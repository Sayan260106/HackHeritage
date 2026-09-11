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

const EAST_COAST_STATES = new Set(['West Bengal', 'Odisha', 'Andhra Pradesh', 'Tamil Nadu', 'Puducherry', 'Andaman and Nicobar Islands']);
const WEST_COAST_STATES = new Set(['Gujarat', 'Maharashtra', 'Goa', 'Karnataka', 'Kerala', 'Daman and Diu', 'Lakshadweep']);

export function resolveCoast(location: LocationInfo): 'east' | 'west' | 'all' {
  const state = location.state || '';
  if (EAST_COAST_STATES.has(state)) return 'east';
  if (WEST_COAST_STATES.has(state)) return 'west';
  if (location.longitude > 79.5) return 'east';
  if (location.longitude < 76.5) return 'west';
  return 'all';
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
    coast: (item.coast as 'east' | 'west' | 'all') || 'all',
    applicableStates: Array.isArray(item.applicableStates) ? (item.applicableStates as string[]) : ['all'],
    vesselClass: (item.vesselClass as any) || 'all',
    jurisdiction: (item.jurisdiction as any) || 'Territorial_Waters',
    topicCategory: String(item.topicCategory || ''),
    issuedAt: item.issuedAt ? String(item.issuedAt) : undefined,
    expiresAt: item.expiresAt ? String(item.expiresAt) : undefined,
    active: item.active !== undefined ? Boolean(item.active) : true,
    revision: item.revision !== undefined ? Number(item.revision) : 1,
  }));
}

function getRagCandidateUrls(): string[] {
  if (process.env.ORCA_RAG_API_URL) {
    return [process.env.ORCA_RAG_API_URL.replace(/\/$/, '')];
  }
  return ['http://127.0.0.1:8000', 'http://127.0.0.1:8001'];
}

export async function retrieveRagEvidence(
  query: string,
  location: LocationInfo,
  riskLevel: string,
): Promise<RagRetrievalResult> {
  return queryDenseRagAsync(query, location, riskLevel);
}

export async function queryDenseRagAsync(
  query: string,
  location: LocationInfo,
  riskLevel: string,
): Promise<RagRetrievalResult> {
  const timeoutMs = Math.max(1000, Number(process.env.ORCA_RAG_API_TIMEOUT_MS || 5000));
  const topK = Math.min(20, Math.max(1, Number(process.env.RAG_TOP_K || 8)));
  const coast = resolveCoast(location);
  const candidateUrls = getRagCandidateUrls();
  let lastError: Error | null = null;

  for (const ragApiUrl of candidateUrls) {
    try {
      const response = await withTimeout(fetch(`${ragApiUrl}/search`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json', Connection: 'keep-alive' },
        body: JSON.stringify({
          query,
          top_k: topK,
          coast: coast !== 'all' ? coast : undefined,
          state: location.state || undefined,
        }),
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
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  const message = lastError?.message || 'Unknown RAG failure';
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

export async function liveIngestEvidence(document: Partial<EvidenceItem> & {
  title: string;
  excerpt: string;
  sourceAuthority: string;
}): Promise<{ success: boolean; document_id: string; points_count: number; message: string }> {
  const candidateUrls = getRagCandidateUrls();
  const timeoutMs = 8000;
  const apiKey = process.env.RAG_INGEST_API_KEY || 'orca-rag-internal-key';
  let lastError: Error | null = null;

  for (const ragApiUrl of candidateUrls) {
    try {
      const response = await withTimeout(fetch(`${ragApiUrl}/live-ingest`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'X-API-Key': apiKey,
        },
        body: JSON.stringify(document),
      }), timeoutMs);

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Live ingest failed (${response.status}): ${text.slice(0, 200)}`);
      }
      return response.json();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw lastError || new Error('Live evidence ingestion failed across all candidate endpoints');
}

