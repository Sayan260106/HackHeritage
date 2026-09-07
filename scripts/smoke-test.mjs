const baseUrl = process.env.ORCA_BASE_URL || 'http://127.0.0.1:3000';
const mlUrl = process.env.ORCA_ML_API_URL || 'http://127.0.0.1:8000';
const ragUrl = process.env.ORCA_RAG_API_URL || 'http://127.0.0.1:8001';

async function request(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!response.ok) throw new Error(`${url} returned ${response.status}: ${text}`);
  return body;
}

async function requestWithRetry(url, options = {}, attempts = 3, delayMs = 2000) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await request(url, options);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

function assert(condition, message) { if (!condition) throw new Error(message); }

const mlHealth = await request(`${mlUrl}/health`);
assert(mlHealth.status === 'healthy', 'ML health check failed');
assert(mlHealth.model_loaded === true, 'ML model is not loaded');

const ragHealth = await request(`${ragUrl}/health`);
assert(ragHealth.status === 'healthy', 'RAG health check failed');
assert(ragHealth.embedding_model === 'BAAI/bge-m3', 'RAG is not configured for BAAI/bge-m3');
assert(ragHealth.embedding_dimension === 1024, 'RAG embedding dimension is not 1024');
assert(Number(ragHealth.points_count) > 0, 'Qdrant evidence collection is empty');

const ragSearch = await request(`${ragUrl}/search`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ query: 'Is it safe for small fishing boats near Digha right now?', top_k: 5 }),
});
assert(ragSearch.retrieval === 'qdrant_dense_cosine', 'RAG search did not use Qdrant dense cosine retrieval');
assert(ragSearch.embedding_model === 'BAAI/bge-m3', 'RAG search did not use BGE-M3');
assert(Array.isArray(ragSearch.results) && ragSearch.results.length > 0, 'RAG search returned no results');

const appHealth = await request(`${baseUrl}/api/health`);
assert(appHealth.status === 'healthy', 'ORCA API health check failed');
assert(appHealth.services.mlRiskApi, 'ML service metadata is missing');
assert(appHealth.capabilities?.tomorrowMarineForecast === true, 'Tomorrow forecast capability is not enabled');

// External realtime providers can transiently time out or return 5xx responses from a
// hosted CI runner. Retry the complete fusion endpoint before declaring the smoke test
// unhealthy. Persistent failure still fails the test; no synthetic or stale data is used.
const live = await requestWithRetry(`${baseUrl}/api/marine/conditions?lat=21.6266&lon=87.5074`);
// Overall realtime fusion is DEGRADED when CI has only Open-Meteo configured. This is
// expected. The fused weather/ocean payload must remain LIVE and its base source must be
// Open-Meteo; additional Indian sources may override individual variables when configured.
assert(['LIVE', 'DEGRADED'].includes(live.metadata?.dataQuality), 'Live marine fusion returned an invalid data-quality state');
assert(live.metadata?.dataQuality !== 'UNAVAILABLE', 'Live marine/weather fusion is unavailable');
assert(live.weather?.dataQuality === 'LIVE', 'Weather data is not marked LIVE');
assert(live.ocean?.dataQuality === 'LIVE', 'Marine data is not marked LIVE');
assert(typeof live.weather?.source === 'string' && live.weather.source.startsWith('ORCA-X variable fusion'), 'Weather payload is not marked as fused');
assert(typeof live.ocean?.source === 'string' && live.ocean.source.startsWith('ORCA-X variable fusion'), 'Marine payload is not marked as fused');
assert(live.metadata?.selectedSources?.weather === 'OPEN_METEO', 'Unexpected weather base provider');
assert(live.metadata?.selectedSources?.ocean === 'OPEN_METEO', 'Unexpected marine base provider');

const forecast = await request(`${baseUrl}/api/marine/forecast?locationKey=digha`);
assert(forecast.sourceType === 'FORECAST', 'Marine forecast is not explicitly marked as forecast data');
assert(typeof forecast.forecastDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(forecast.forecastDate), 'Forecast date is invalid');
assert(Array.isArray(forecast.hourly) && forecast.hourly.length >= 12, 'Tomorrow forecast returned too few hourly points');
assert(forecast.hourly.every((point) => point.risk?.riskLevel && Number.isFinite(point.risk?.riskScore)), 'Forecast contains an invalid ML risk point');
assert(forecast.hourly.every((point) => point.risk?.predictionTarget?.includes('forecast hour')), 'Forecast points are not labeled as forecast predictions');
assert(['LOW', 'MODERATE', 'HIGH', 'EXTREME'].includes(forecast.summary?.worstRiskLevel), 'Forecast summary returned an invalid risk level');

const risk = await request(`${baseUrl}/api/marine/risk`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    weather: { windSpeedKts: 14, windGustKts: 20, windDirectionDeg: 90, pressureHpa: 1010, airTemperatureC: 28, observedAt: new Date().toISOString() },
    ocean: { waveHeightMeters: 0.9, wavePeriodSec: 5, waveDirectionDeg: 90, swellHeightMeters: 0.5, swellPeriodSec: 7, maxWaveHeightMeters: 1.4, currentSpeedKts: 0.6, seaSurfaceTemperatureC: 28, seaStateIndex: 3, seaStateDescription: 'Slight' },
    location: { key: 'digha', name: 'Digha', state: 'West Bengal', country: 'India', latitude: 21.6266, longitude: 87.5074 },
  }),
});
assert(['LOW', 'MODERATE', 'HIGH', 'EXTREME'].includes(risk.riskLevel), 'Risk endpoint returned an invalid risk level');
assert(Number.isFinite(risk.riskScore), 'Risk endpoint returned an invalid risk score');

const evidence = await request(`${baseUrl}/api/evidence/search`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ query: 'fishing small boats wind waves', riskLevel: risk.riskLevel, locationKey: 'digha' }),
});
assert(Array.isArray(evidence.results) && evidence.results.length > 0, 'Evidence endpoint returned no evidence');
assert(evidence.provider === 'bge-m3-qdrant', `Node RAG integration degraded: ${evidence.provider}`);
assert(evidence.model === 'BAAI/bge-m3', 'Node RAG integration did not report BGE-M3');
assert(evidence.degraded === false, 'Node RAG integration is degraded');

const orca = await request(`${baseUrl}/api/orca/query`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ query: 'Is it safe for small fishing boats near Digha right now?' }),
});
const ragTrace = orca.agentTraces?.find((trace) => trace.agentName === 'EvidenceRetrieval');
assert(ragTrace?.logs?.some((log) => log.includes('provider: bge-m3-qdrant')), 'End-to-end ORCA query did not use BGE-M3 + Qdrant');

// Satellite coverage can legitimately be partial when the requested Sentinel product
// type is unavailable for the current observation window. That must not invalidate the
// Refinement 3 smoke test as long as live weather/marine data and BGE-M3/Qdrant retrieval
// are healthy. A true RAG or live-environment failure is checked explicitly above.
const satellitePartial = orca.satellite?.status !== 'LIVE';
const satelliteWarning = Array.isArray(orca.warnings)
  ? orca.warnings.find((warning) => /sentinel|satellite/i.test(String(warning)))
  : undefined;

console.log('ORCA-X live + forecast smoke test passed:', JSON.stringify({
  ml: mlHealth.model_version,
  rag: ragSearch.retrieval,
  embedding: ragSearch.embedding_model,
  liveWeather: live.weather.source,
  liveMarine: live.ocean.source,
  liveFusionQuality: live.metadata?.dataQuality || 'UNKNOWN',
  featureSources: live.metadata?.featureSources || {},
  forecastDate: forecast.forecastDate,
  forecastHours: forecast.hourly.length,
  worstForecastRisk: forecast.summary.worstRiskLevel,
  riskLevel: orca.risk.riskLevel,
  evidenceCount: orca.evidence.length,
  satelliteStatus: orca.satellite?.status || 'UNKNOWN',
  satellitePartial,
  satelliteWarning: satelliteWarning || null,
}));
