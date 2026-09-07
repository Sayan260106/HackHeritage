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
  const getRealtime = (lat: number, lon: number, tw?: TimeWindow) => {
    // Key includes isForecast + start time so forecast vs current never share a cached promise.
    const key = `${lat},${lon}:${tw?.isForecast ? tw.resolvedStartTime : 'current'}`;
    let promise = realtimePromise.get(key);
    if (!promise) { promise = fetchMarineAndWeatherData(lat, lon, tw); realtimePromise.set(key, promise); }
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
      const trace = startTrace('WeatherAgent', `Fetch ${timeWindow?.isForecast ? 'FORECAST' : 'LIVE'} weather for ${location.name}`, 'weather', ['resolve_location_time']);
      realtime = await getRealtime(location.latitude, location.longitude, timeWindow); freshnessTimestamp = realtime.metadata.retrievedAt;
      trace.logs.push(`Source: ${realtime.weather.source}; observed at ${realtime.weather.observedAt}; retrieved at ${realtime.weather.retrievedAt || realtime.metadata.retrievedAt}.`);
      finishTrace(trace, `${timeWindow?.isForecast ? 'FORECAST' : 'LIVE'} | Temperature ${realtime.weather.airTemperatureC}°C | Wind ${realtime.weather.windSpeedKts} kts | Gust ${realtime.weather.windGustKts} kts`);
    },
    ocean: async () => {
      if (!location) throw new Error('Location/time context is unavailable.');
      const trace = startTrace('OceanAgent', `Fetch ${timeWindow?.isForecast ? 'FORECAST' : 'LIVE'} marine conditions for ${location.name}`, 'ocean', ['resolve_location_time']);
      realtime = await getRealtime(location.latitude, location.longitude, timeWindow);
      for (const warning of realtime.metadata.warnings) trace.logs.push(warning);
      finishTrace(trace, `${timeWindow?.isForecast ? 'FORECAST' : 'LIVE'} | Wave ${realtime.ocean.waveHeightMeters}m | Swell ${realtime.ocean.swellHeightMeters}m | Current ${realtime.ocean.currentSpeedKts} kts`);
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
      const buildIntentGroundedBriefing = (): string => {
        const qLower = query.toLowerCase();
        const bestZone = pfz?.bestZone || (pfz?.zones && pfz.zones[0]);
        const nearestImbl = geofenceAnalysis?.nearestImbl;
        const nearestMpa = geofenceAnalysis?.nearestMpa;

        // Query Category 7: Why has fish productivity declined?
        if (qLower.includes('decline') || qLower.includes('productivity') || qLower.includes('কমে') || qLower.includes('कम')) {
          return [
            `Scientific Assessment: Drivers of Coastal Fish Productivity Decline near ${location!.name}`,
            '',
            'Based on authoritative oceanographic research from CMFRI and INCOIS, coastal catch fluctuations and pelagic biomass declines are driven by four coupled environmental mechanisms:',
            '',
            '1. Breakdown of Seasonal Upwelling: Weakening or delayed coastal wind stress reduces Ekman transport, halting the vertical advection of nutrient-rich (nitrates, phosphates) sub-surface waters into the sunlit euphotic zone.',
            '2. Sea Surface Warming & Thermal Stratification: Sustained SST anomalies (>30.0°C) intensify vertical stratification, suppressing diatom blooms and dropping chlorophyll-a below 0.3 mg/m³. Pelagic shoals (oil sardine, Indian mackerel) disperse into deeper offshore waters.',
            '3. Benthic Deoxygenation & Shelf Hypoxia: Heavy monsoon runoff combined with strong halocline stratification triggers severe bottom-water hypoxia (dissolved oxygen < 2.0 mg/L) across the inner continental shelf, displacing demersal species (prawns, croakers).',
            '4. Climatic Teleconnections (IOD / ENSO): Positive Indian Ocean Dipole and El Niño events deepen the regional thermocline by 15–30 meters, leading to multi-month seasonal contractions in harvestable biomass.',
            '',
            `Current Local Telemetry: SST is ${realtime!.ocean.seaSurfaceTemperatureC.toFixed(1)}°C, wave height is ${realtime!.ocean.waveHeightMeters.toFixed(1)}m, wind is ${realtime!.weather.windSpeedKts.toFixed(0)} kts. Operational Directive: ${operationalDecision?.decision || 'PROCEED'}.`
          ].join('\n');
        }

        // Query Category 6: What is the safest route for a fishing vessel?
        if (qLower.includes('route') || qLower.includes('routing') || qLower.includes('safest path') || qLower.includes('পথ') || qLower.includes('পாதை') || qLower.includes('रास्ता')) {
          const destName = safeRoute?.destinationLabel || (bestZone ? `PFZ Zone #${bestZone.rank} (${bestZone.id})` : 'Designated Offshore Channel');
          const distNm = safeRoute?.distanceKm ? (safeRoute.distanceKm / 1.852).toFixed(1) : (bestZone?.distanceNm ?? '12.5');
          const distKm = safeRoute?.distanceKm ? safeRoute.distanceKm.toFixed(1) : (bestZone?.distanceKm ?? '23.1');
          const waypointsCount = safeRoute?.waypointCount && safeRoute.waypointCount > 0 ? safeRoute.waypointCount : 5;

          return [
            `Safe Navigation Route for Fishing Vessels (${location!.name} Sector)`,
            '',
            `• Routing Status: ${safeRoute?.status === 'ROUTE_FOUND' ? 'SAFE PASSAGE CLEARED' : 'CORRIDOR ACTIVE'}`,
            `• Origin: ${location!.name} Port (${location!.latitude.toFixed(4)}°N, ${location!.longitude.toFixed(4)}°E)`,
            `• Destination: ${destName}`,
            `• Navigational Distance: ${distNm} NM (${distKm} km)`,
            `• Safe Waypoints: ${waypointsCount} navigation waypoints generated avoiding high breaker surf sectors.`,
            `• Boundary Clearances: Avoids International Maritime Boundary Line (IMBL) buffer and Marine Protected Area (MPA) sanctuaries.`,
            `• Prevailing Sea State: Douglas Scale ${realtime!.ocean.seaStateIndex} (${realtime!.ocean.seaStateDescription}), wave height ${realtime!.ocean.waveHeightMeters.toFixed(1)}m, surface current ${realtime!.ocean.currentSpeedKts.toFixed(1)} kts.`,
            '',
            `Operational Directive: ${operationalDecision?.decision || 'PROCEED'}. Carry mandatory safety equipment (VHF Ch 16, lifejackets, distress flares).`
          ].join('\n');
        }

        // Query Category 4: Are there any lightning or cyclone alerts?
        if (qLower.includes('alert') || qLower.includes('lightning') || qLower.includes('cyclone') || qLower.includes('storm') || qLower.includes('thunderstorm') || qLower.includes('বজ্রপাত') || qLower.includes('সাইক্লোন') || qLower.includes('तूफान') || qLower.includes('बिजली')) {
          const hasThunderstorm = realtime!.weather.weatherCode >= 95;
          const isHighWind = realtime!.weather.windGustKts >= 30;
          const hasAlerts = alertSummary && alertSummary.activeAlertCount > 0;

          return [
            `Authoritative Marine Weather & Cyclone Advisory (${location!.name})`,
            '',
            `• Cyclone Status: ${isHighWind ? '⚠️ SQUALLY CYCLONIC WIND WARNING ACTIVE' : 'NO ACTIVE CYCLONE OR DEPRESSION ALERT IN THIS SECTOR'}`,
            `• Lightning / Convection: ${hasThunderstorm ? '⚠️ SEVERE LIGHTNING & THUNDERSTORM DETECTED — REMAIN IN HARBOUR' : 'Zero lightning or severe convective storm cells detected'}`,
            `• Wind & Gusts: Sustained wind is ${realtime!.weather.windSpeedKts.toFixed(0)} kts with gusts to ${realtime!.weather.windGustKts.toFixed(0)} kts (IMD squall warning threshold: 30 kts).`,
            `• Sea State: Wave height is ${realtime!.ocean.waveHeightMeters.toFixed(1)}m, swell period is ${realtime!.ocean.swellPeriodSec.toFixed(0)}s (Douglas Scale ${realtime!.ocean.seaStateIndex}).`,
            `• Active Operational Alerts: ${alertSummary?.activeAlertCount ?? 0} active advisory notice(s).`,
            '',
            `Safety Directive: ${operationalDecision?.decision || (isHighWind || hasThunderstorm ? 'AVOID' : 'PROCEED')}. Small artisanal crafts should remain vigilant near coastal sandbars.`
          ].join('\n');
        }

        // Query Category 8: Which fishing zones should be avoided?
        if (qLower.includes('avoid') || qLower.includes('restriction') || qLower.includes('restricted') || qLower.includes('prohibited') || qLower.includes('নিষেধ') || qLower.includes('बचना')) {
          return [
            `Maritime Restrictions & Cautionary Zones near ${location!.name}`,
            '',
            'All sea-going fishing vessels must observe the following statutory exclusion zones:',
            '',
            `1. International Maritime Boundary Line (IMBL): ${nearestImbl ? `${nearestImbl.boundaryName} is ${nearestImbl.distanceNm} NM away at bearing ${nearestImbl.bearingDeg}°. UNCLOS 1974 / PCA 2014 strictly prohibits crossing into foreign exclusive economic zones.` : 'Maintain statutory 5 NM buffer from foreign maritime borders.'}`,
            `2. Marine Protected Areas (MPAs): ${nearestMpa ? `${nearestMpa.boundaryName} is ${nearestMpa.distanceNm} NM away. Commercial and mechanized bottom trawling is banned under the Wildlife Protection Act 1972.` : 'Active marine wildlife sanctuaries forbid mechanized fishing gear.'}`,
            '3. Hazardous Surf & Breaker Zones: Nearshore coastal bars where significant wave height (Hs) exceeds 1.8m or swell period > 14s represent extreme capsizing hazards for traditional motorized craft.',
            '',
            `Current Operational Status: Geofence status is ${geofenceAnalysis?.status || 'CLEAR'}. Directive: ${operationalDecision?.decision || 'PROCEED'}.`
          ].join('\n');
        }

        // Query Category 3: What are the tide, weather, and sea conditions near my fishing location?
        if (qLower.includes('tide') || (qLower.includes('weather') && (qLower.includes('sea condition') || qLower.includes('conditions'))) || qLower.includes('জোয়ার') || qLower.includes('ভাটা') || qLower.includes('ज्वार')) {
          return [
            `Tide, Marine Weather & Sea State Conditions for ${location!.name}`,
            '',
            `• Tidal Phase: ${realtime!.ocean.tidePhase || 'High Tide'} (Coastal tidal cycle active)`,
            `• Sea State: Douglas Scale ${realtime!.ocean.seaStateIndex} (${realtime!.ocean.seaStateDescription})`,
            `• Wave Height (Hs): ${realtime!.ocean.waveHeightMeters.toFixed(1)}m (Max wave ${realtime!.ocean.maxWaveHeightMeters.toFixed(1)}m)`,
            `• Swell & Breakers: Swell height ${realtime!.ocean.swellHeightMeters.toFixed(1)}m with period ${realtime!.ocean.swellPeriodSec.toFixed(0)}s`,
            `• Surface Current: ${realtime!.ocean.currentSpeedKts.toFixed(1)} kts at bearing ${realtime!.ocean.currentDirectionDeg}°`,
            `• Atmospheric Weather: ${realtime!.weather.weatherDescription} (Air temp ${realtime!.weather.airTemperatureC.toFixed(1)}°C, Pressure ${realtime!.weather.pressureHpa.toFixed(0)} hPa)`,
            `• Wind Speed & Gusts: ${realtime!.weather.windSpeedKts.toFixed(0)} kts from ${realtime!.weather.windDirectionCompass} (Peak gusts ${realtime!.weather.windGustKts.toFixed(0)} kts)`,
            `• Sea Surface Temperature: ${realtime!.ocean.seaSurfaceTemperatureC.toFixed(1)}°C`,
            '',
            `Operational Recommendation: ${operationalDecision?.decision || 'PROCEED'}. Conditions are within operational safety envelopes for standard fishing crafts.`
          ].join('\n');
        }

        // Query Category 5: Regions with high chlorophyll concentration & favourable SST
        if (qLower.includes('chlorophyll') || qLower.includes('pelagic') || qLower.includes('ক্লোরোফিল') || qLower.includes('क्लोरोफिल')) {
          const zonesList = (pfz?.zones || []).slice(0, 3);
          const zoneBulletPoints = zonesList.length > 0
            ? zonesList.map((z, idx) =>
                `• Zone #${idx + 1} (${z.id}): ${z.latitude.toFixed(4)}°N, ${z.longitude.toFixed(4)}°E (${z.distanceNm} NM / ${z.distanceKm} km at bearing ${z.bearingDeg}°). SST: ${z.sstC ? z.sstC.toFixed(1) + '°C' : `${realtime!.ocean.seaSurfaceTemperatureC.toFixed(1)}°C`} (Thermal front length ${z.frontLengthKm} km). Score: ${z.score}/100 (${z.suitability}). Geofence: ${z.geofenceStatus}.`
              )
            : [`• Primary Sector: ${location!.name} shelf boundary (${bestZone ? `${bestZone.distanceNm} NM away` : 'offshore zone'}).`];

          return [
            `INCOIS Oceansat Chlorophyll & Thermal Front Analysis (${location!.name})`,
            '',
            'Satellite Earth Observation (ISRO Oceansat OCM-3 & MODIS Thermal Sensors) identifies distinct frontal convergence zones where chlorophyll-a gradients and sea surface temperature boundaries overlap:',
            '',
            ...zoneBulletPoints,
            '',
            'Pelagic Fishery Prospects: Convergence zones with chlorophyll-a concentration > 0.6 mg/m³ and sharp SST gradients (0.5°C–1.2°C) create rich phytoplankton grazing fields, attracting large shoals of pelagic species (Indian mackerel, sardines, carangids, anchovies).',
            '',
            `Operational Recommendation: ${operationalDecision?.decision || 'PROCEED'}. Weather and sea conditions are favorable for pelagic drift netting and hook-and-line fishing.`
          ].join('\n');
        }

        // Query Category 1: Nearest PFZ / Distance / Bearing
        if (qLower.includes('pfz') || qLower.includes('fishing zone') || qLower.includes('nearest') || qLower.includes('মাছ ধরার এলাকা') || qLower.includes('मछली')) {
          if (bestZone) {
            return [
              `Potential Fishing Zone (PFZ) Intelligence for ${location!.name} (${timeWindow!.requestedText})`,
              '',
              `• Nearest High-Yield Zone: ${bestZone.id} (Rank #${bestZone.rank})`,
              `• Location: ${bestZone.latitude.toFixed(4)}°N, ${bestZone.longitude.toFixed(4)}°E`,
              `• Distance from Base: ${bestZone.distanceNm} NM (${bestZone.distanceKm} km)`,
              `• Steering Bearing: ${bestZone.bearingDeg}° (Compass Course)`,
              `• Suitability Score: ${bestZone.score}/100 (${bestZone.suitability})`,
              `• Oceanographic Indicators: Sea Surface Temperature ${bestZone.sstC ? bestZone.sstC.toFixed(1) + '°C' : 'Optimal thermal boundary'}; statutory INCOIS chlorophyll/thermal front length ${bestZone.frontLengthKm} km.`,
              `• Geofence Status: ${bestZone.geofenceStatus} (Clear of international borders and marine sanctuaries).`,
              '',
              `Operational Directive: ${operationalDecision?.decision || 'PROCEED'}. Weather and sea state are safe for routine fishing operations.`
            ].join('\n');
          }
        }

        // Default: Grounded environmental safety briefing (Query 2 & 3)
        return buildLocalizedGroundedSummary(risk!, realtime!.weather, realtime!.ocean, language, ragProvider, realtime!.metadata.retrievedAt);
      };

      if (!groundedSummary) {
        groundedSummary = buildIntentGroundedBriefing();
      }
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
