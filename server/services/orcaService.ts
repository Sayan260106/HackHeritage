import { GoogleGenAI } from '@google/genai';
import { COASTAL_LOCATIONS, MARINE_EVIDENCE_CORPUS } from '../../src/data/coastalData.ts';
import { calculateMarineRisk, generateGisLayers } from '../../src/utils/marineRiskEngine.ts';
import { predictMarineRiskWithMl } from '../../src/services/ml/riskService.ts';
import { fetchSatelliteData } from '../../src/services/satellite/satelliteService.ts';
import { AgentStepTrace, LanguageCode, OrcaAnalysisResponse, SatelliteData, RiskPrediction, LocationInfo, TimeWindow, GisLayerData, EvidenceItem, GeofenceSpatialAnalysis } from '../../src/types.ts';
import { fetchMarineAndWeatherData, resolveLocation, resolveSatelliteObservationWindow, resolveTimeWindow } from './marineService.ts';
import { retrieveRagEvidence } from './ragService.ts';
import { buildLocalizedGroundedSummary, localizeRiskPrediction } from '../../src/utils/marineRiskLocalization.ts';
import { createOrcaPlan } from './agenticPlanner.ts';
import { executeOrcaPlan } from './agenticExecutor.ts';
import { analyzeMaritimeGeofencing } from './geofenceService.ts';

let genAIClient: GoogleGenAI | null = null;
function getGenAI(): GoogleGenAI | null {
  if (!genAIClient && process.env.GEMINI_API_KEY) genAIClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, httpOptions: { headers: { 'User-Agent': 'orca-x-server' } } });
  return genAIClient;
}
function unavailableSatellite(location: LocationInfo): SatelliteData {
  return { status: 'UNAVAILABLE', satelliteName: 'No satellite source', processingTime: new Date().toISOString(), latitude: location.latitude, longitude: location.longitude, source: 'No satellite source', sourceUrl: '', observationType: 'NO_OBSERVATION', warnings: ['Satellite branch unavailable; no EO observation was supplied.'], observations: [] };
}

export async function runOrcaAgentWorkflow(query: string, locationOverride?: string, timeOverride?: string, language: LanguageCode = 'en'): Promise<OrcaAnalysisResponse> {
  const queryId = `orca-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const traces: AgentStepTrace[] = [];
  const startTrace = (agentName: AgentStepTrace['agentName'], inputSummary: string, taskId?: string, dependencies?: string[]) => {
    const trace: AgentStepTrace = { agentName, status: 'running', startedAt: new Date().toISOString(), inputSummary, outputSummary: '', logs: [`Started ${agentName} processing`], taskId, dependencies }; traces.push(trace); return trace;
  };
  const finishTrace = (trace: AgentStepTrace, output: string, error?: string) => { trace.status = error ? 'failed' : 'completed'; trace.completedAt = new Date().toISOString(); trace.durationMs = Math.max(1, Date.now() - new Date(trace.startedAt).getTime()); trace.outputSummary = output; if (error) trace.error = error; };

  const plan = createOrcaPlan(query, language);
  const planner = startTrace('Planner', `Analyze query: "${query}"`, 'planner');
  planner.logs.push(`Plan ID: ${plan.planId}`);
  planner.logs.push(plan.rationale);
  planner.logs.push(`Enabled tasks: ${plan.tasks.filter(t => t.enabled).map(t => t.id).join(', ')}`);
  planner.logs.push(`Parallel-ready after context: ${plan.tasks.filter(t => t.enabled && t.dependsOn.length === 1 && t.dependsOn[0] === 'resolve_location_time').map(t => t.id).join(', ') || 'none'}`);
  finishTrace(planner, `Dynamic dependency graph created with ${plan.tasks.filter(t => t.enabled).length} enabled tasks.`);

  let location: LocationInfo | undefined;
  let timeWindow: TimeWindow | undefined;
  let realtime: Awaited<ReturnType<typeof fetchMarineAndWeatherData>> | undefined;
  let satellite: SatelliteData = unavailableSatellite(resolveLocation(query, locationOverride));
  let risk: RiskPrediction | undefined;
  let gisLayers: GisLayerData = { type: 'FeatureCollection', features: [] };
  let geofenceAnalysis: GeofenceSpatialAnalysis | undefined;
  let evidence: EvidenceItem[] = [];
  let ragProvider = 'not-run';
  let ragModel = 'not-run';
  let groundedSummary = '';
  let freshnessTimestamp = new Date().toISOString();

  const realtimePromise = new Map<string, ReturnType<typeof fetchMarineAndWeatherData>>();
  const getRealtime = (lat: number, lon: number) => {
    const key = `${lat},${lon}`;
    let promise = realtimePromise.get(key);
    if (!promise) { promise = fetchMarineAndWeatherData(lat, lon); realtimePromise.set(key, promise); }
    return promise;
  };

  const result = await executeOrcaPlan(plan, {
    resolve_location_time: async () => {
      const trace = startTrace('LocationTimeResolver', 'Resolve geographic and temporal intent', 'resolve_location_time');
      location = resolveLocation(query, locationOverride); timeWindow = resolveTimeWindow(query, timeOverride);
      trace.logs.push(`Matched location: ${location.name} (${location.latitude}, ${location.longitude})`); finishTrace(trace, `Target: ${location.name} | ${timeWindow.requestedText}`);
    },
    weather: async () => {
      if (!location) throw new Error('Location/time context is unavailable.');
      const trace = startTrace('WeatherAgent', `Fetch LIVE weather for ${location.name}`, 'weather', ['resolve_location_time']);
      realtime = await getRealtime(location.latitude, location.longitude); freshnessTimestamp = realtime.metadata.retrievedAt;
      trace.logs.push(`Source: ${realtime.weather.source}; observed at ${realtime.weather.observedAt}; retrieved at ${realtime.weather.retrievedAt || realtime.metadata.retrievedAt}.`);
      finishTrace(trace, `LIVE | Temperature ${realtime.weather.airTemperatureC}°C | Wind ${realtime.weather.windSpeedKts} kts | Gust ${realtime.weather.windGustKts} kts`);
    },
    ocean: async () => {
      if (!location) throw new Error('Location/time context is unavailable.');
      const trace = startTrace('OceanAgent', `Fetch LIVE marine conditions for ${location.name}`, 'ocean', ['resolve_location_time']);
      realtime = await getRealtime(location.latitude, location.longitude);
      for (const warning of realtime.metadata.warnings) trace.logs.push(warning);
      finishTrace(trace, `LIVE | Wave ${realtime.ocean.waveHeightMeters}m | Swell ${realtime.ocean.swellHeightMeters}m | Current ${realtime.ocean.currentSpeedKts} kts`);
    },
    satellite: async () => {
      if (!location || !timeWindow) throw new Error('Location/time context is unavailable.');
      const trace = startTrace('SatelliteAgent', `Search latest Copernicus observations for ${location.name}`, 'satellite', ['resolve_location_time']);
      const window = resolveSatelliteObservationWindow(timeWindow); satellite = await fetchSatelliteData(location.latitude, location.longitude, window.startTime, window.endTime);
      finishTrace(trace, `${satellite.status} | ${satellite.observations.length} observations`);
    },
    risk: async () => {
      if (!location || !realtime) throw new Error('Required weather/ocean context is unavailable.');
      const trace = startTrace('RiskEngine', 'Run XGBoost ML risk service with deterministic fallback', 'risk', plan.tasks.find(t => t.id === 'risk')?.dependsOn);
      const mlRisk = await predictMarineRiskWithMl(realtime.weather, realtime.ocean, satellite, location); const rawRisk = mlRisk || calculateMarineRisk(realtime.weather, realtime.ocean, satellite, location);
      risk = localizeRiskPrediction(rawRisk, realtime.weather, realtime.ocean, language);
      if (mlRisk) { trace.logs.push(`XGBoost prediction received: ${mlRisk.riskLevel} (${mlRisk.confidenceScore}%).`); if (mlRisk.domainValidation) trace.logs.push(`ML deployment validation: ${mlRisk.domainValidation.deploymentValidationStatus}.`); } else trace.logs.push('ML API unavailable; deterministic fallback used.');
      finishTrace(trace, `${risk.riskScore}/100 ${risk.riskLevel}`);
    },
    gis: async () => {
      if (!location || !realtime || !risk) throw new Error('Required context for GIS reasoning is unavailable.');
      const trace = startTrace('GisAgent', 'Generate GeoJSON hazard and navigation layers with authentic IMBL and MPA geofences', 'gis', ['resolve_location_time', 'risk']);
      gisLayers = generateGisLayers(location, risk, realtime.ocean);
      geofenceAnalysis = analyzeMaritimeGeofencing(location.latitude, location.longitude);
      gisLayers.geofenceAnalysis = geofenceAnalysis;
      trace.logs.push(`Geofence Status: ${geofenceAnalysis.status}`);
      if (geofenceAnalysis.nearestImbl) {
        trace.logs.push(`Nearest IMBL: ${geofenceAnalysis.nearestImbl.boundaryName} — ${geofenceAnalysis.nearestImbl.distanceNm} NM (bearing ${geofenceAnalysis.nearestImbl.bearingDeg ?? 0}°, ${geofenceAnalysis.nearestImbl.severity})`);
      }
      if (geofenceAnalysis.nearestMpa) {
        trace.logs.push(`Nearest MPA: ${geofenceAnalysis.nearestMpa.boundaryName} — ${geofenceAnalysis.nearestMpa.distanceNm} NM (${geofenceAnalysis.nearestMpa.severity})`);
      }
      for (const alert of geofenceAnalysis.activeAlerts) {
        trace.logs.push(`[GEOFENCE WARNING] ${alert.warningMessage}`);
      }
      finishTrace(trace, `${gisLayers.features.length} GeoJSON features generated; Geofence status: ${geofenceAnalysis.status} (Nearest IMBL: ${geofenceAnalysis.nearestImbl?.distanceNm ?? 'N/A'} NM)`);
    },
    evidence: async () => {
      if (!location || !risk) throw new Error('Required context for evidence retrieval is unavailable.');
      const trace = startTrace('EvidenceRetrieval', 'Retrieve marine evidence with BGE-M3 embeddings and Qdrant', 'evidence', ['resolve_location_time', 'risk']);
      const rag = await retrieveRagEvidence(query, location, risk.riskLevel); evidence = rag.evidence; ragProvider = rag.provider; ragModel = rag.model;
      trace.logs.push(`Retrieval provider: ${rag.provider}; retrieval: ${rag.retrieval}; embedding model: ${rag.model}.`); if (rag.degraded && rag.error) trace.logs.push(`Fallback reason: ${rag.error}`);
      finishTrace(trace, `${rag.evidence.length} evidence items retrieved via ${rag.provider}${rag.degraded ? ' (degraded)' : ''}.`);
    },
    synthesis: async (task) => {
      if (!location || !timeWindow || !realtime || !risk) throw new Error('Required execution outputs are unavailable for synthesis.');
      const trace = startTrace('ResponseGrounding', 'Generate grounded marine intelligence briefing', 'synthesis', task.dependsOn); const genAI = getGenAI();
      if (genAI) {
        const geofenceSummary = geofenceAnalysis
          ? `GEOFENCING & MARITIME BOUNDARIES (IMBL & MPAs):\nStatus: ${geofenceAnalysis.status}\nNearest IMBL: ${geofenceAnalysis.nearestImbl?.boundaryName} at ${geofenceAnalysis.nearestImbl?.distanceNm} NM (${geofenceAnalysis.nearestImbl?.severity})\nNearest Marine Sanctuary: ${geofenceAnalysis.nearestMpa?.boundaryName} at ${geofenceAnalysis.nearestMpa?.distanceNm} NM (${geofenceAnalysis.nearestMpa?.severity})\n${geofenceAnalysis.activeAlerts.length ? `Active Warnings:\n${geofenceAnalysis.activeAlerts.map(a => `- ${a.warningMessage}`).join('\n')}` : 'All clear of international and restricted waters.'}`
          : 'Geofence evaluation clear.';

        const prompt = `You are ORCA-X (Ocean Reasoning & Collaborative AI), an authoritative marine intelligence assistant.\nUser Query: "${query}"\nLocation: ${location.name}, ${location.state || ''}, ${location.country}\nTime Window: ${timeWindow.requestedText}\nPlanner intent: ${plan.intent}\nPlanner rationale: ${plan.rationale}\n\nLIVE ENVIRONMENTAL DATA:\nWeather source: ${realtime.weather.source}; observed: ${realtime.weather.observedAt}; retrieved: ${realtime.weather.retrievedAt || realtime.metadata.retrievedAt}\nMarine source: ${realtime.ocean.source}; observed: ${realtime.ocean.observedAt}; retrieved: ${realtime.ocean.retrievedAt || realtime.metadata.retrievedAt}\nWave Height: ${realtime.ocean.waveHeightMeters}m; Max Wave Today: ${realtime.ocean.maxWaveHeightMeters}m\nSwell: ${realtime.ocean.swellHeightMeters}m / ${realtime.ocean.swellPeriodSec}s\nWind: ${realtime.weather.windSpeedKts} kts; Gusts: ${realtime.weather.windGustKts} kts; Direction: ${realtime.weather.windDirectionCompass}\nCurrent: ${realtime.ocean.currentSpeedKts} kts\nSea State: ${realtime.ocean.seaStateIndex} (${realtime.ocean.seaStateDescription})\nSST: ${realtime.ocean.seaSurfaceTemperatureC}°C\nVisibility: ${realtime.weather.visibilityKm} km\nRisk: ${risk.riskScore}/100 ${risk.riskLevel}; Confidence: ${risk.confidenceScore}%\nRecommendation: ${risk.primaryRecommendation}\nAdvisories: ${risk.actionableAdvisories.join('; ')}\nSatellite: ${satellite.status}; observations: ${satellite.observations.length}\n${geofenceSummary}\nRetrieved Evidence (${ragProvider}, ${ragModel}):\n${evidence.map(e => `- ${e.title} | ${e.sourceAuthority} | ${e.excerpt} | ${e.complianceRule}`).join('\n')}\n\nRespond in ${language}. Never invent measurements. Clearly distinguish live/modelled observations from authoritative evidence, give a concise verdict, key physical drivers, operational advisories, highlight any boundary/geofence alerts, cite the retrieved evidence authorities by name, and state that official INCOIS/IMD/MRCC warnings supersede this system.`;
        for (const model of ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-3.7-flash']) {
          try { const response = await genAI.models.generateContent({ model, contents: prompt, config: { temperature: 0.2, topP: 0.85 } }); if (response.text) { groundedSummary = response.text; break; } } catch { trace.logs.push(`Model ${model} unavailable; trying next model.`); }
        }
      }
      if (!groundedSummary) groundedSummary = buildLocalizedGroundedSummary(risk, realtime.weather, realtime.ocean, language, ragProvider, realtime.metadata.retrievedAt);
      finishTrace(trace, 'Grounded marine briefing generated from executed task graph outputs.');
    }
  }, {
    onTaskFailure: (task, error) => { const trace = traces.find(t => t.taskId === task.id && t.status === 'running'); if (trace) finishTrace(trace, `${task.label} failed`, error.message); }
  });

  for (const task of result.plan.tasks.filter(t => !t.enabled)) {
    if (traces.some(t => t.taskId === task.id) || task.id === 'synthesis') continue;
    const agentName: AgentStepTrace['agentName'] = task.id === 'satellite' ? 'SatelliteAgent' : task.id === 'gis' ? 'GisAgent' : task.id === 'evidence' ? 'EvidenceRetrieval' : 'RiskEngine';
    traces.push({ agentName, status: 'skipped', startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), durationMs: 0, inputSummary: task.label, outputSummary: task.reason, logs: [`Skipped by planner/replanner: ${task.reason}`], taskId: task.id, dependencies: task.dependsOn });
  }
  if (!location || !timeWindow || !realtime || !risk) { const failure = result.failures.map(f => `${f.taskId}: ${f.reason}`).join('; '); throw new Error(`ORCA-X agent execution could not complete required tasks.${failure ? ` ${failure}` : ''}`); }

  if (!geofenceAnalysis && location) {
    geofenceAnalysis = analyzeMaritimeGeofencing(location.latitude, location.longitude);
    if (!gisLayers || gisLayers.features.length === 0) {
      gisLayers = generateGisLayers(location, risk, realtime.ocean);
    }
    gisLayers.geofenceAnalysis = geofenceAnalysis;
  }

  const satelliteDegraded = satellite.status !== 'LIVE';
  const evidenceTask = result.plan.tasks.find(t => t.id === 'evidence');
  const ragDegraded = Boolean(evidenceTask?.enabled && evidenceTask.status !== 'completed');
  const finalWarnings = [...realtime.metadata.warnings, ...satellite.warnings];
  if (geofenceAnalysis?.activeAlerts) {
    for (const alert of geofenceAnalysis.activeAlerts) {
      if (alert.severity === 'CRITICAL_BREACH' || alert.severity === 'PROXIMITY_WARNING') {
        finalWarnings.push(alert.warningMessage);
      }
    }
  }
  if (ragDegraded) finalWarnings.push('Evidence retrieval did not complete; response was synthesized with available grounded data.');
  if (result.replans > 0) finalWarnings.push(`Execution replanned ${result.replans} time${result.replans === 1 ? '' : 's'} after an optional branch failure.`);
  return { queryId, originalQuery: query, language, detectedIntent: result.plan.intent, location, timeWindow, weather: realtime.weather, ocean: realtime.ocean, satellite, risk, gisLayers, geofenceAnalysis, evidence, agentTraces: traces, groundedSummary, executionPlan: { planId: result.plan.planId, intent: result.plan.intent, rationale: result.plan.rationale, tasks: result.plan.tasks, generatedAt: result.plan.generatedAt }, isDataDegraded: realtime.degraded || satelliteDegraded || ragDegraded, warnings: finalWarnings, freshnessTimestamp, officialDisclaimer: 'ORCA-X is an AI decision-support platform for marine intelligence. It does NOT supersede statutory warnings from INCOIS, IMD, or Maritime Rescue Coordination Centres (MRCC). Open-Meteo modelled marine currents/tides are advisory and do not replace nautical navigation information.' };
}
export function getSupportedLocationCount(): number { return Object.keys(COASTAL_LOCATIONS).length; }
export function getEvidenceCorpusSize(): number { return MARINE_EVIDENCE_CORPUS.length; }
