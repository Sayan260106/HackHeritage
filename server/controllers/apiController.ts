import { Request, Response } from 'express';
import { calculateMarineRisk } from '../../src/utils/marineRiskEngine.ts';
import { predictMarineRiskWithMl } from '../../src/services/ml/riskService.ts';
import { fetchSatelliteData } from '../../src/services/satellite/satelliteService.ts';
import { COASTAL_LOCATIONS } from '../../src/data/coastalData.ts';
import { LanguageCode, SatelliteData } from '../../src/types.ts';
import { fetchMarineAndWeatherData } from '../services/marineService.ts';
import { buildTomorrowMarineRiskForecast } from '../services/realtime/marineForecastService.ts';
import { getRealtimeSourceReadiness } from '../services/realtime/marineDataFusion.ts';
import { getMarineTelemetry, getMarineTelemetryAnalysis, getMarineTelemetrySummary } from '../services/realtime/marineTelemetry.ts';
import { retrieveRagEvidence } from '../services/ragService.ts';
import { getEvidenceCorpusSize, getSupportedLocationCount, runOrcaAgentWorkflow } from '../services/orcaService.ts';
import { localizeRiskPrediction } from '../../src/utils/marineRiskLocalization.ts';
import { analyzeMaritimeGeofencing } from '../services/geofenceService.ts';
import { generateMaritimeGeoJsonFeatures } from '../../src/data/maritimeBoundaries.ts';
import { analyzeVesselTrafficAsync } from '../services/aisVesselService.ts';
import { detectQueryLanguage } from '../../src/utils/languageDetector.ts';

import { getSession, listSessions, deleteSession, getOrCreateSession } from '../services/conversationService.ts';

function resolveLocationFromRequest(req: Request) {
  const locationKey = typeof req.query.locationKey === 'string' ? req.query.locationKey : undefined;
  if (locationKey && COASTAL_LOCATIONS[locationKey]) return COASTAL_LOCATIONS[locationKey];

  const lat = Number(req.query.lat ?? 21.6266);
  const lon = Number(req.query.lon ?? 87.5074);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;

  return {
    name: 'Custom Coastal Point',
    country: 'India',
    latitude: lat,
    longitude: lon,
    regionType: 'open_sea' as const,
  };
}

const SUPPORTED_LANGUAGES: LanguageCode[] = ['en', 'bn', 'hi', 'ta', 'or', 'te', 'ml', 'gu', 'mr', 'kn'];

export async function orcaQuery(req: Request, res: Response) {
  try {
    const { query, locationOverride, timeOverride, language = 'en', sessionId } = req.body;
    if (!query || typeof query !== 'string') return res.status(400).json({ error: 'Query string is required.' });

    // Autonomously detect Indian regional language from query script
    const detected = detectQueryLanguage(query, (language as LanguageCode) || 'en');
    const effectiveLang = (language && language !== 'en') ? (language as LanguageCode) : detected.language;

    if (!SUPPORTED_LANGUAGES.includes(effectiveLang)) return res.status(400).json({ error: 'Unsupported language code.' });
    res.json(await runOrcaAgentWorkflow(query, locationOverride, timeOverride, effectiveLang, sessionId));
  } catch (error) {
    console.error('ORCA query error:', error);
    res.status(502).json({ error: error instanceof Error ? error.message : 'Live ORCA data pipeline failed.' });
  }
}

export async function getConversation(req: Request, res: Response) {
  const session = getSession(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Conversation session not found.' });
  res.json(session);
}

export async function listConversations(_req: Request, res: Response) {
  res.json(listSessions());
}

export async function deleteConversation(req: Request, res: Response) {
  const deleted = deleteSession(req.params.sessionId);
  res.json({ success: deleted });
}

export async function createConversation(req: Request, res: Response) {
  const session = getOrCreateSession(req.body.sessionId, req.body.initialLocation);
  res.json(session);
}

export async function marineConditions(req: Request, res: Response) {
  try {
    const lat = Number(req.query.lat ?? 21.6266);
    const lon = Number(req.query.lon ?? 87.5074);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return res.status(400).json({ error: 'Valid latitude and longitude are required.' });
    }
    res.json(await fetchMarineAndWeatherData(lat, lon));
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : 'Live marine/weather fetch failed.' });
  }
}

export async function marineForecast(req: Request, res: Response) {
  try {
    const location = resolveLocationFromRequest(req);
    if (!location) return res.status(400).json({ error: 'Valid latitude and longitude, or a supported locationKey, are required.' });
    res.json(await buildTomorrowMarineRiskForecast(location));
  } catch (error) {
    console.error('Marine forecast error:', error);
    res.status(502).json({ error: error instanceof Error ? error.message : 'Tomorrow marine forecast pipeline failed.' });
  }
}

export async function marineRisk(req: Request, res: Response) {
  try {
    const { weather, ocean, satellite, location, language = 'en' } = req.body;
    if (!weather || !ocean || !location) return res.status(400).json({ error: 'Missing required environmental observation inputs.' });
    const defaultSat = satellite || {
      status: 'UNAVAILABLE', satelliteName: 'No satellite observation supplied', processingTime: new Date().toISOString(),
      latitude: location.latitude, longitude: location.longitude, source: 'No satellite source', sourceUrl: '',
      observationType: 'NO_OBSERVATION', warnings: ['Satellite observation was not supplied to the risk endpoint.'], observations: [],
    } as SatelliteData;
    const mlRisk = await predictMarineRiskWithMl(weather, ocean, defaultSat, location);
    const rawRisk = mlRisk || calculateMarineRisk(weather, ocean, defaultSat, location);
    res.json(localizeRiskPrediction(rawRisk, weather, ocean, SUPPORTED_LANGUAGES.includes(language as LanguageCode) ? (language as LanguageCode) : 'en'));
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Risk calculation failed.' });
  }
}

function parseBoolean(value: unknown, defaultValue = false): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return defaultValue;
  return ['true', '1', 'yes', 'on'].includes(value.trim().toLowerCase());
}

export async function satelliteAnalysis(req: Request, res: Response) {
  try {
    const lat = Number(req.body.latitude);
    const lon = Number(req.body.longitude);
    const forceRefresh = parseBoolean(req.body.forceRefresh);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return res.status(400).json({ error: 'Valid latitude and longitude are required.' });
    }
    const now = new Date();
    let start = req.body.startTime ? new Date(req.body.startTime) : new Date(now.getTime() - 6 * 3600000);
    let end = req.body.endTime ? new Date(req.body.endTime) : now;
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return res.status(400).json({ error: 'startTime and endTime must be valid ISO timestamps.' });
    if (start > now) { start = new Date(now.getTime() - 7 * 24 * 3600000); end = now; }
    else { if (end > now) end = now; if (start >= end) start = new Date(end.getTime() - 24 * 3600000); }
    res.json(await fetchSatelliteData(lat, lon, start.toISOString(), end.toISOString(), forceRefresh));
  } catch (error) {
    console.error('Satellite analysis error:', error);
    res.status(502).json({ error: error instanceof Error ? error.message : 'Satellite observation search failed.' });
  }
}

export async function evidenceSearch(req: Request, res: Response) {
  try {
    const { query = '', riskLevel = 'MODERATE', locationKey = 'digha' } = req.body;
    if (typeof query !== 'string' || query.trim().length < 2) {
      return res.status(400).json({ error: 'A query string with at least 2 characters is required.' });
    }
    const location = COASTAL_LOCATIONS[locationKey] || COASTAL_LOCATIONS.digha;
    const rag = await retrieveRagEvidence(query, location, riskLevel);
    res.json({ results: rag.evidence, count: rag.evidence.length, provider: rag.provider, model: rag.model, degraded: rag.provider !== 'bge-m3-qdrant' });
  } catch (error) {
    console.error('Evidence search error:', error);
    res.status(503).json({ error: error instanceof Error ? error.message : 'Evidence search failed.' });
  }
}

export function marineTelemetry(req: Request, res: Response) {
  const rawLimit = Number(req.query.limit ?? 50);
  const limit = Number.isFinite(rawLimit) ? rawLimit : 50;
  res.json({ summary: getMarineTelemetrySummary(), events: getMarineTelemetry(limit) });
}

export function marineTelemetryAnalysis(_req: Request, res: Response) {
  res.json(getMarineTelemetryAnalysis());
}

export function gisSpatialAnalysis(req: Request, res: Response) {
  try {
    const lat = Number(req.query.lat ?? req.body?.latitude ?? 21.6266);
    const lon = Number(req.query.lon ?? req.body?.longitude ?? 87.5074);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return res.status(400).json({ error: 'Valid latitude and longitude are required.' });
    }
    const geofence = analyzeMaritimeGeofencing(lat, lon);
    const geoFeatures = generateMaritimeGeoJsonFeatures();
    res.json({
      coordinates: { latitude: lat, longitude: lon },
      geofence,
      featuresCount: geoFeatures.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'GIS spatial analysis failed.' });
  }
}

export async function health(_req: Request, res: Response) {
  const mlUrl = process.env.ORCA_ML_API_URL || 'http://127.0.0.1:8000';
  const ragUrl = process.env.ORCA_RAG_API_URL || 'http://127.0.0.1:8001';
  const qdrantUrl = process.env.QDRANT_URL || 'http://127.0.0.1:6333';

  const [mlCheck, ragCheck, qdrantCheck] = await Promise.all([
    fetch(`${mlUrl}/health`, { signal: AbortSignal.timeout(600) })
      .then(r => r.ok)
      .catch(() => false),
    fetch(`${ragUrl}/health`, { signal: AbortSignal.timeout(600) })
      .then(r => r.ok)
      .catch(() => false),
    fetch(`${qdrantUrl}/healthz`, { signal: AbortSignal.timeout(600) })
      .then(r => r.ok)
      .catch(() => false),
  ]);

  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    liveStatus: {
      mlService: mlCheck ? 'ONLINE' : 'PHYSICS_FALLBACK',
      ragService: ragCheck ? 'ONLINE' : 'LEXICAL_FALLBACK',
      qdrantVectorDb: qdrantCheck ? 'ONLINE' : 'OFFLINE',
      geminiLlm: process.env.GEMINI_API_KEY ? 'ACTIVE' : 'DETERMINISTIC_FALLBACK',
      openMeteo: 'ONLINE',
      incoisPfz: 'AVAILABLE',
    },
    services: {
      liveWeather: 'open_meteo_current_conditions',
      liveMarine: 'open_meteo_marine_current_conditions',
      realtimeFusion: 'incois_mosdac_open_meteo_quality_routing',
      forecastWeather: 'open_meteo_hourly_forecast',
      forecastMarine: 'open_meteo_hourly_marine_forecast',
      pfzSatelliteEngine: 'incois_geoserver_wfs_daily_statutory_fronts',
      satelliteCatalog: 'copernicus_dataspace_stac',
      satelliteProcessing: 'incois_statutory_ocean_fronts_and_copernicus_stac',
      riskEngine: mlCheck ? 'xgboost_microservice' : 'xgboost_with_rule_based_fallback',
      mlRiskApi: mlUrl,
      evidenceRetrieval: ragCheck ? 'bge-m3-qdrant_vector' : 'bge-m3-qdrant_with_lexical_fallback',
      ragApi: ragUrl,
      agentOrchestrator: 'server_workflow',
      geminiGroundingAgent: process.env.GEMINI_API_KEY ? 'configured' : 'standby_deterministic',
      geofenceSurveillance: 'authentic_unclos_pca_treaty_engine',
    },
    realtimeSources: getRealtimeSourceReadiness(),
    telemetry: getMarineTelemetrySummary(),
    capabilities: {
      realtimeWeather: true,
      realtimeMarine: true,
      tomorrowMarineForecast: true,
      vectorRag: true,
      incoisStatutoryPfzFronts: true,
      evidenceCorpusItems: getEvidenceCorpusSize(),
      latestSatelliteCatalogueSearch: true,
      satelliteImageProcessing: true,
      geofencingBoundarySurveillance: true,
      authenticImblCoverage: true,
      marineProtectedAreasCoverage: true,
    },
    supportedLocations: getSupportedLocationCount(),
  });
}

export async function vesselsLive(req: Request, res: Response) {
  try {
    const latStr = req.query.lat as string;
    const lonStr = req.query.lon as string;
    const locationKey = req.query.locationKey as string;

    let latitude = 21.6266;
    let longitude = 87.5074;
    let name = 'Digha Coast';

    if (locationKey && COASTAL_LOCATIONS[locationKey]) {
      latitude = COASTAL_LOCATIONS[locationKey].latitude;
      longitude = COASTAL_LOCATIONS[locationKey].longitude;
      name = COASTAL_LOCATIONS[locationKey].name;
    } else if (latStr && lonStr && !isNaN(Number(latStr)) && !isNaN(Number(lonStr))) {
      latitude = Number(latStr);
      longitude = Number(lonStr);
      name = 'Operating Point';
    }

    const vesselData = await analyzeVesselTrafficAsync(latitude, longitude, name);
    res.json(vesselData);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve AIS vessel traffic' });
  }
}

