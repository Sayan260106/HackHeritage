import { GeofenceSpatialAnalysis, OceanData, RiskLevel, RiskPrediction, WeatherData } from '../../src/types.ts';

export type AlertSeverity = 'INFO' | 'ADVISORY' | 'WARNING' | 'CRITICAL';
export type AlertType = 'LIGHTNING' | 'SEVERE_WEATHER' | 'CYCLONE_PROXY' | 'MARINE_RISK_CHANGE' | 'SEA_STATE' | 'GEOFENCE' | 'PFZ_CHANGE';

export interface AlertSignal {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  message: string;
  source: string;
  sourceTimestamp: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  actionable: string;
  dedupeKey: string;
}

export interface AlertEvaluationInput {
  weather: WeatherData;
  ocean: OceanData;
  risk: RiskPrediction;
  geofence?: GeofenceSpatialAnalysis;
  pfz?: { status?: string; bestZone?: { id: string; score: number; suitability?: string }; zones?: Array<{ id: string; score: number }> };
  previousRiskLevel?: RiskLevel;
  previousRiskScore?: number;
  previousPfzScore?: number;
  evaluatedAt?: string;
}

export interface AlertEvaluationResult {
  generatedAt: string;
  alerts: AlertSignal[];
  highestSeverity: AlertSeverity | 'NONE';
  activeAlertCount: number;
  warnings: string[];
}

const severityRank: Record<AlertSeverity, number> = { INFO: 0, ADVISORY: 1, WARNING: 2, CRITICAL: 3 };
const cooldownMs = Math.max(0, Number(process.env.ORCA_ALERT_COOLDOWN_MS || 15 * 60 * 1000));
const emittedAt = new Map<string, number>();

const id = (type: AlertType) => `alert-${type.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

function addAlert(alerts: AlertSignal[], input: Omit<AlertSignal, 'id' | 'dedupeKey'>) {
  const dedupeKey = `${input.type}:${input.title}:${input.message}`;
  const now = Date.now();
  const last = emittedAt.get(dedupeKey);
  if (last !== undefined && cooldownMs > 0 && now - last < cooldownMs) return;
  emittedAt.set(dedupeKey, now);
  alerts.push({ ...input, id: id(input.type), dedupeKey });
}

function evaluateLightning(weather: WeatherData, alerts: AlertSignal[]) {
  if (![95, 96, 97, 98, 99].includes(weather.weatherCode)) return;
  const critical = [96, 97, 98, 99].includes(weather.weatherCode);
  addAlert(alerts, {
    type: 'LIGHTNING',
    severity: critical ? 'CRITICAL' : 'WARNING',
    title: critical ? 'Thunderstorm with lightning signal' : 'Thunderstorm signal detected',
    message: `WMO weather code ${weather.weatherCode} indicates thunderstorm activity. Lightning risk may be present in the operating area.`,
    source: weather.source,
    sourceTimestamp: weather.observedAt,
    confidence: 'MEDIUM',
    actionable: 'Avoid open-water exposure and seek authoritative lightning/thunderstorm bulletins before departure.',
  });
}

function evaluateSevereWeather(weather: WeatherData, alerts: AlertSignal[]) {
  if (weather.windGustKts >= 45) {
    addAlert(alerts, {
      type: 'SEVERE_WEATHER', severity: 'CRITICAL', title: 'Extreme wind-gust exposure',
      message: `Forecast/current gusts are ${weather.windGustKts} kt, creating severe operational exposure.`, source: weather.source,
      sourceTimestamp: weather.observedAt, confidence: 'HIGH', actionable: 'Do not venture without an authoritative marine warning and vessel-specific safety clearance.',
    });
  } else if (weather.windGustKts >= 30) {
    addAlert(alerts, {
      type: 'SEVERE_WEATHER', severity: 'WARNING', title: 'Strong wind-gust exposure',
      message: `Wind gusts are ${weather.windGustKts} kt and warrant heightened marine caution.`, source: weather.source,
      sourceTimestamp: weather.observedAt, confidence: 'HIGH', actionable: 'Review vessel limits, route exposure and the latest official marine forecast before departure.',
    });
  }
}

function evaluateCycloneProxy(weather: WeatherData, alerts: AlertSignal[]) {
  if (![96, 97, 98, 99].includes(weather.weatherCode)) return;
  addAlert(alerts, {
    type: 'CYCLONE_PROXY', severity: weather.windGustKts >= 45 ? 'CRITICAL' : 'WARNING', title: 'Severe convective weather / cyclone-proxy signal',
    message: `Severe WMO weather code ${weather.weatherCode} is present. ORCA-X treats this as a severe-weather proxy, not confirmation of a named cyclone.`, source: weather.source,
    sourceTimestamp: weather.observedAt, confidence: 'MEDIUM', actionable: 'Check IMD cyclone and coastal warning bulletins before making an operational decision.',
  });
}

function evaluateSeaState(ocean: OceanData, alerts: AlertSignal[]) {
  if (ocean.waveHeightMeters >= 4) {
    addAlert(alerts, {
      type: 'SEA_STATE', severity: 'CRITICAL', title: 'Very rough to high sea state',
      message: `Wave height is ${ocean.waveHeightMeters} m with sea-state index ${ocean.seaStateIndex}.`, source: ocean.source,
      sourceTimestamp: ocean.observedAt, confidence: 'HIGH', actionable: 'Avoid exposed operations and verify official marine warnings.',
    });
  } else if (ocean.waveHeightMeters >= 2.5) {
    addAlert(alerts, {
      type: 'SEA_STATE', severity: 'WARNING', title: 'Rough sea state',
      message: `Wave height is ${ocean.waveHeightMeters} m; route and vessel limits require additional caution.`, source: ocean.source,
      sourceTimestamp: ocean.observedAt, confidence: 'HIGH', actionable: 'Reassess departure timing, vessel capability and route exposure.',
    });
  }
}

function evaluateRiskChange(risk: RiskPrediction, previousRiskLevel: RiskLevel | undefined, previousRiskScore: number | undefined, alerts: AlertSignal[]) {
  const scoreDelta = previousRiskScore === undefined ? 0 : risk.riskScore - previousRiskScore;
  const levelWorsened = previousRiskLevel !== undefined && severityRankRisk(risk.riskLevel) > severityRankRisk(previousRiskLevel);
  if (!levelWorsened && scoreDelta < 15) return;
  addAlert(alerts, {
    type: 'MARINE_RISK_CHANGE', severity: levelWorsened && (risk.riskLevel === 'EXTREME' || risk.riskLevel === 'HIGH') ? 'CRITICAL' : 'WARNING',
    title: 'Marine risk has increased', message: `Risk changed to ${risk.riskLevel} (${risk.riskScore}/100)${previousRiskScore !== undefined ? `, ${scoreDelta >= 0 ? '+' : ''}${scoreDelta.toFixed(1)} score points` : ''}.`,
    source: risk.modelVersion, sourceTimestamp: risk.generatedAt, confidence: risk.confidenceScore >= 80 ? 'HIGH' : 'MEDIUM', actionable: risk.primaryRecommendation,
  });
}

function severityRankRisk(level: RiskLevel): number { return { LOW: 0, MODERATE: 1, HIGH: 2, EXTREME: 3 }[level]; }

function evaluateGeofence(geofence: GeofenceSpatialAnalysis | undefined, alerts: AlertSignal[]) {
  if (!geofence) return;
  for (const signal of geofence.activeAlerts) {
    if (signal.severity === 'CRITICAL_BREACH') {
      addAlert(alerts, { type: 'GEOFENCE', severity: 'CRITICAL', title: 'Restricted maritime area breach', message: signal.warningMessage, source: signal.treatyOrAuthority, sourceTimestamp: geofence.timestamp, confidence: 'HIGH', actionable: 'Stop routing toward the restricted area and comply with the applicable maritime authority.' });
    } else if (signal.severity === 'PROXIMITY_WARNING') {
      addAlert(alerts, { type: 'GEOFENCE', severity: 'WARNING', title: 'Restricted-boundary proximity warning', message: signal.warningMessage, source: signal.treatyOrAuthority, sourceTimestamp: geofence.timestamp, confidence: 'HIGH', actionable: 'Maintain separation from the boundary and verify the intended route.' });
    }
  }
}

function evaluatePfz(input: AlertEvaluationInput, alerts: AlertSignal[]) {
  const current = input.pfz?.bestZone;
  if (!current) return;
  const delta = input.previousPfzScore === undefined ? 0 : current.score - input.previousPfzScore;
  if (delta < 15 && current.score < 75) return;
  addAlert(alerts, {
    type: 'PFZ_CHANGE', severity: current.score >= 85 ? 'ADVISORY' : 'INFO', title: 'Potential fishing zone signal changed',
    message: `Best PFZ candidate ${current.id} is scored ${current.score}/100${input.previousPfzScore !== undefined ? ` (${delta >= 0 ? '+' : ''}${delta.toFixed(1)} versus the previous score)` : ''}.`, source: 'ORCA-X PFZ intelligence engine', sourceTimestamp: input.evaluatedAt || new Date().toISOString(), confidence: current.score >= 75 ? 'MEDIUM' : 'LOW', actionable: 'Use the PFZ ranking as decision support and confirm current fisheries advisories before departure.',
  });
}

export function evaluateMarineAlerts(input: AlertEvaluationInput): AlertEvaluationResult {
  const generatedAt = input.evaluatedAt || new Date().toISOString();
  const alerts: AlertSignal[] = [];
  evaluateLightning(input.weather, alerts);
  evaluateSevereWeather(input.weather, alerts);
  evaluateCycloneProxy(input.weather, alerts);
  evaluateSeaState(input.ocean, alerts);
  evaluateRiskChange(input.risk, input.previousRiskLevel, input.previousRiskScore, alerts);
  evaluateGeofence(input.geofence, alerts);
  evaluatePfz(input, alerts);
  alerts.sort((a, b) => severityRank[b.severity] - severityRank[a.severity]);
  return {
    generatedAt,
    alerts,
    highestSeverity: alerts[0]?.severity || 'NONE',
    activeAlertCount: alerts.length,
    warnings: input.weather.dataQuality === 'UNAVAILABLE' || input.ocean.dataQuality === 'UNAVAILABLE' ? ['Alert evaluation is operating with unavailable realtime data and may be incomplete.'] : [],
  };
}

export function clearAlertCooldowns(): void { emittedAt.clear(); }
