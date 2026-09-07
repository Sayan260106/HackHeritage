import { GoogleGenAI } from '@google/genai';
import { COASTAL_LOCATIONS, MARINE_EVIDENCE_CORPUS } from '../../src/data/coastalData.ts';
import { calculateMarineRisk, generateGisLayers } from '../../src/utils/marineRiskEngine.ts';
import { predictMarineRiskWithMl } from '../../src/services/ml/riskService.ts';
import { fetchSatelliteData } from '../../src/services/satellite/satelliteService.ts';
import { AgentStepTrace, AlertSummary, LanguageCode, OrcaAnalysisResponse, SatelliteData, RiskPrediction, LocationInfo, TimeWindow, GisLayerData, EvidenceItem, GeofenceSpatialAnalysis, OperationalDecision, SafeRouteSummary } from '../../src/types.ts';
import { fetchMarineAndWeatherData, resolveLocation, resolveSatelliteObservationWindow, resolveTimeWindow } from './marineService.ts';
import { retrieveRagEvidence } from './ragService.ts';
import { buildLocalizedGroundedSummary, localizeRiskPrediction } from '../../src/utils/marineRiskLocalization.ts';
import { createOrcaPlan } from './agenticPlanner.ts';
import { executeOrcaPlan } from './agenticExecutor.ts';
import { analyzeMaritimeGeofencing } from './geofenceService.ts';
import { analyzePfz, type PfzAnalysis } from './pfzService.ts';
import { fuseMarineDecision } from './decisionFusion.ts';
import { runAgenticSafeRouting } from './agenticSafeRouting.ts';
import { runAgenticAlertEvaluation } from './agenticAlertAgent.ts';

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
  finishTrace(planner, `Dynamic dependency graph created with ${plan.tasks.filter(t => t.enabled).length} enabled tasks.`);

  let location: LocationInfo | undefined;
  let timeWindow: TimeWindow | undefined;
  let realtime: Awaited<ReturnType<typeof fetchMarineAndWeatherData>> | undefined;
  let satellite: SatelliteData = unavailableSatellite(resolveLocation(query, locationOverride));
  let risk: RiskPrediction | undefined;
  let gisLayers: GisLayerData = { type: 'FeatureCollection', features: [] };
  let geofenceAnalysis: GeofenceSpatialAnalysis | undefined;
  let pfz: PfzAnalysis | undefined;
  let operationalDecision: OperationalDecision | undefined;
  let safeRoute: SafeRouteSummary | undefined;
  let alertSummary: AlertSummary | undefined;
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
      gisLayers = generateGisLayers(location, risk, realtime.ocean); geofenceAnalysis = analyzeMaritimeGeofencing(location.latitude, location.longitude); gisLayers.geofenceAnalysis = geofenceAnalysis;
      trace.logs.push(`Geofence Status: ${geofenceAnalysis.status}`); for (const alert of geofenceAnalysis.activeAlerts) trace.logs.push(`[GEOFENCE WARNING] ${alert.warningMessage}`);
      finishTrace(trace, `${gisLayers.features.length} GeoJSON features generated; Geofence status: ${geofenceAnalysis.status}`);
    },
    pfz: async () => {
      if (!location || !risk) throw new Error('Required context for PFZ reasoning is unavailable.');
      const trace = startTrace('PFZAgent', 'Rank potential fishing zones from measured oceanographic signals, risk and geofences', 'pfz', plan.tasks.find(t => t.id === 'pfz')?.dependsOn);
      if (!geofenceAnalysis) geofenceAnalysis = analyzeMaritimeGeofencing(location.latitude, location.longitude);
      pfz = await analyzePfz(location, risk, geofenceAnalysis);
      trace.logs.push(`PFZ status: ${pfz.status}; candidate zones: ${pfz.zones.length}.`); if (pfz.bestZone) trace.logs.push(`Best candidate: ${pfz.bestZone.id} score ${pfz.bestZone.score}/100, suitability ${pfz.bestZone.suitability}, confidence ${pfz.bestZone.confidence}.`);
      for (const warning of pfz.warnings) trace.logs.push(`[PFZ WARNING] ${warning}`);
      finishTrace(trace, `${pfz.zones.length} candidate zones ranked; best=${pfz.bestZone?.id ?? 'none'}; status=${pfz.status}`);
    },
    safe_route: async (task) => {
      if (!location || !risk || !pfz) throw new Error('Safe routing requires resolved location, risk and PFZ outputs.');
      const trace = startTrace('SafeRoutingAgent', 'Fuse risk/PFZ/geofence decisions and compute a geofence-safe route to the selected PFZ', 'safe_route', task.dependsOn);
      const routing = runAgenticSafeRouting({ origin: location, risk, geofence: geofenceAnalysis, pfz }); operationalDecision = routing.decision;
      const route = routing.route;
      safeRoute = { status: routing.status, destinationLabel: routing.destinationLabel, distanceKm: route?.distanceKm, directDistanceKm: route?.directDistanceKm, routeEfficiencyPct: route?.routeEfficiencyPct, waypointCount: route?.waypoints.length ?? 0, warnings: routing.warnings, rationale: route?.rationale || routing.decision.rationale, source: route?.source || 'ORCA-X agentic safe-routing decision gate' };
      trace.logs.push(`Decision Fusion: ${routing.decision.decision} (${routing.decision.confidence}, score ${routing.decision.score}/100).`); trace.logs.push(`Routing status: ${routing.status}; destination: ${routing.destinationLabel ?? 'none'}; waypoints: ${route?.waypoints.length ?? 0}.`);
      for (const warning of routing.warnings) trace.logs.push(`[ROUTING WARNING] ${warning}`);
      finishTrace(trace, `${routing.status} | decision=${routing.decision.decision} | waypoints=${route?.waypoints.length ?? 0}`);
    },
    alerts: async (task) => {
      if (!location || !realtime || !risk) throw new Error('Alert evaluation requires weather, ocean and risk outputs.');
      const trace = startTrace('AlertAgent', 'Evaluate proactive marine alerts from live weather, ocean, risk, geofence and PFZ signals', 'alerts', task.dependsOn);
      const previousRiskLevel = risk.riskLevel === 'LOW' ? 'LOW' : risk.riskLevel === 'MODERATE' ? 'LOW' : risk.riskLevel === 'HIGH' ? 'MODERATE' : 'HIGH';
      const evaluation = runAgenticAlertEvaluation({ weather: realtime.weather, ocean: realtime.ocean, risk, geofence: geofenceAnalysis, pfz, previousRiskLevel });
      alertSummary = { decision: evaluation.decision, highestSeverity: evaluation.highestSeverity, activeAlertCount: evaluation.activeAlertCount, rationale: evaluation.rationale, nextActions: evaluation.nextActions, alerts: evaluation.alerts.map(alert => ({ id: alert.id, type: alert.type, severity: alert.severity, title: alert.title, message: alert.message, source: alert.source, confidence: alert.confidence, actionable: alert.actionable })) };
      trace.logs.push(`Alert decision: ${evaluation.decision}; highest severity: ${evaluation.highestSeverity}; active alerts: ${evaluation.activeAlertCount}.`);
      for (const alert of evaluation.alerts) trace.logs.push(`[${alert.severity}] ${alert.title}: ${alert.message}`);
      for (const warning of evaluation.warnings) trace.logs.push(`[ALERT WARNING] ${warning}`);
      finishTrace(trace, `${evaluation.activeAlertCount} alert(s); decision=${evaluation.decision}; highest=${evaluation.highestSeverity}`);
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
      if (!operationalDecision && (pfz || geofenceAnalysis)) operationalDecision = fuseMarineDecision(risk, geofenceAnalysis, pfz);
      const trace = startTrace('ResponseGrounding', 'Generate grounded marine intelligence briefing', 'synthesis', task.dependsOn); const genAI = getGenAI();
      if (genAI) {
        const alertSummaryText = alertSummary ? `ALERTS: decision=${alertSummary.decision}; highest=${alertSummary.highestSeverity}; active=${alertSummary.activeAlertCount}; rationale=${alertSummary.rationale}; alerts=${alertSummary.alerts.map(a => `${a.severity} ${a.title}: ${a.message} | action=${a.actionable}`).join(' || ')}.` : 'ALERTS: alert branch not selected or unavailable.';
        const geofenceSummary = geofenceAnalysis ? `GEOFENCING: status=${geofenceAnalysis.status}; active alerts=${geofenceAnalysis.activeAlerts.length}.` : 'GEOFENCING: unavailable.';
        const pfzSummary = pfz ? `PFZ: status=${pfz.status}; best=${pfz.bestZone ? `${pfz.bestZone.id} score=${pfz.bestZone.score}/100 suitability=${pfz.bestZone.suitability} confidence=${pfz.bestZone.confidence}` : 'none'}; warnings=${pfz.warnings.join(' | ') || 'none'}.` : 'PFZ: not selected.';
        const decisionSummary = operationalDecision ? `DECISION: ${operationalDecision.decision}; score=${operationalDecision.score}/100; confidence=${operationalDecision.confidence}; rationale=${operationalDecision.rationale}.` : 'DECISION: not required.';
        const routeSummary = safeRoute ? `SAFE ROUTE: status=${safeRoute.status}; destination=${safeRoute.destinationLabel || 'none'}; distance=${safeRoute.distanceKm ?? 'N/A'} km; waypoints=${safeRoute.waypointCount}.` : 'SAFE ROUTE: not selected.';
        const prompt = `You are ORCA-X, a grounded marine intelligence assistant. User query: "${query}". Location: ${location.name}, ${location.country}. Time: ${timeWindow.requestedText}. Intent: ${plan.intent}. LIVE weather source=${realtime.weather.source}, wind=${realtime.weather.windSpeedKts}kt, gust=${realtime.weather.windGustKts}kt, weatherCode=${realtime.weather.weatherCode}. LIVE marine source=${realtime.ocean.source}, wave=${realtime.ocean.waveHeightMeters}m, swell=${realtime.ocean.swellHeightMeters}m. Risk=${risk.riskScore}/100 ${risk.riskLevel}, confidence=${risk.confidenceScore}%. ${geofenceSummary} ${pfzSummary} ${decisionSummary} ${routeSummary} ${alertSummaryText} Evidence=${evidence.map(e => `${e.title} | ${e.sourceAuthority} | ${e.excerpt}`).join(' || ')}. Never invent measurements. Critical alerts and AVOID decisions must be treated as hard operational warnings. The cyclone signal is only a proxy unless authoritative IMD confirmation is present. State degraded data explicitly and do not imply that ORCA-X replaces IMD, INCOIS, MRCC, nautical charts or statutory warnings.`;
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
    const agentName = task.id === 'satellite' ? 'SatelliteAgent' : task.id === 'gis' ? 'GisAgent' : task.id === 'pfz' ? 'PFZAgent' : task.id === 'safe_route' ? 'SafeRoutingAgent' : task.id === 'alerts' ? 'AlertAgent' : task.id === 'evidence' ? 'EvidenceRetrieval' : 'RiskEngine';
    traces.push({ agentName: agentName as AgentStepTrace['agentName'], status: 'skipped', startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), durationMs: 0, inputSummary: task.label, outputSummary: task.reason, logs: [`Skipped by planner/replanner: ${task.reason}`], taskId: task.id, dependencies: task.dependsOn });
  }
  if (!location || !timeWindow || !realtime || !risk) { const failure = result.failures.map(f => `${f.taskId}: ${f.reason}`).join('; '); throw new Error(`ORCA-X agent execution could not complete required tasks.${failure ? ` ${failure}` : ''}`); }

  if (!geofenceAnalysis && location) { geofenceAnalysis = analyzeMaritimeGeofencing(location.latitude, location.longitude); if (gisLayers.features.length === 0) gisLayers = generateGisLayers(location, risk, realtime.ocean); gisLayers.geofenceAnalysis = geofenceAnalysis; }
  if (!operationalDecision && risk) operationalDecision = fuseMarineDecision(risk, geofenceAnalysis, pfz);

  const satelliteDegraded = satellite.status !== 'LIVE';
  const pfzTask = result.plan.tasks.find(t => t.id === 'pfz');
  const pfzDegraded = Boolean(pfzTask?.enabled && (pfzTask.status !== 'completed' || pfz?.status !== 'READY'));
  const evidenceTask = result.plan.tasks.find(t => t.id === 'evidence');
  const ragDegraded = Boolean(evidenceTask?.enabled && evidenceTask.status !== 'completed');
  const routingTask = result.plan.tasks.find(t => t.id === 'safe_route');
  const routingDegraded = Boolean(routingTask?.enabled && (routingTask.status !== 'completed' || safeRoute?.status === 'ROUTE_UNAVAILABLE'));
  const alertTask = result.plan.tasks.find(t => t.id === 'alerts');
  const alertsDegraded = Boolean(alertTask?.enabled && alertTask.status !== 'completed');
  const finalWarnings = [...realtime.metadata.warnings, ...satellite.warnings];
  if (operationalDecision?.warnings) finalWarnings.push(...operationalDecision.warnings);
  if (pfzDegraded) finalWarnings.push(pfz ? 'PFZ intelligence completed in degraded mode; candidate ranking should not be treated as a fish-catch guarantee.' : 'PFZ intelligence was selected but did not complete; no fishing-zone ranking is available.');
  if (pfz?.warnings) finalWarnings.push(...pfz.warnings);
  if (safeRoute?.warnings) finalWarnings.push(...safeRoute.warnings);
  if (routingDegraded) finalWarnings.push('Safe routing was selected but did not produce a confirmed route.');
  if (alertSummary?.alerts.some(alert => alert.severity === 'CRITICAL')) finalWarnings.push('Critical marine alert(s) are active; verify authoritative warnings before operating.');
  if (alertsDegraded) finalWarnings.push('Alert evaluation was selected but did not complete; the response may omit proactive warning signals.');
  if (geofenceAnalysis?.activeAlerts) for (const alert of geofenceAnalysis.activeAlerts) if (alert.severity === 'CRITICAL_BREACH' || alert.severity === 'PROXIMITY_WARNING') finalWarnings.push(alert.warningMessage);
  if (ragDegraded) finalWarnings.push('Evidence retrieval did not complete; response was synthesized with available grounded data.');
  if (result.replans > 0) finalWarnings.push(`Execution replanned ${result.replans} time${result.replans === 1 ? '' : 's'} after an optional branch failure.`);

  const response: OrcaAnalysisResponse = { queryId, originalQuery: query, language, detectedIntent: result.plan.intent, location, timeWindow, weather: realtime.weather, ocean: realtime.ocean, satellite, risk, gisLayers, geofenceAnalysis, pfz, operationalDecision, safeRoute, alertSummary, evidence, agentTraces: traces, groundedSummary, executionPlan: { planId: result.plan.planId, intent: result.plan.intent, rationale: result.plan.rationale, tasks: result.plan.tasks, generatedAt: result.plan.generatedAt }, isDataDegraded: realtime.degraded || satelliteDegraded || pfzDegraded || ragDegraded || routingDegraded || alertsDegraded || operationalDecision?.confidence === 'LOW', warnings: [...new Set(finalWarnings)], freshnessTimestamp, officialDisclaimer: 'ORCA-X is an AI decision-support platform for marine intelligence. It does NOT supersede statutory warnings from INCOIS, IMD, or Maritime Rescue Coordination Centres (MRCC). Open-Meteo modelled marine currents/tides are advisory and do not replace nautical navigation information.' };
  return response;
}
export function getSupportedLocationCount(): number { return Object.keys(COASTAL_LOCATIONS).length; }
export function getEvidenceCorpusSize(): number { return MARINE_EVIDENCE_CORPUS.length; }
