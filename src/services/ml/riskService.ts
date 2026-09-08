import { FeatureContribution, LocationInfo, OceanData, RiskLevel, RiskPrediction, SatelliteData, WeatherData } from '../../types.ts';

type ImpactLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
const REQUIRED_PROBABILITY_LABELS = ['LOW', 'MODERATE', 'HIGH', 'EXTREME'] as const;

interface MlRiskResult {
  success: boolean;
  risk_class: number;
  risk_label: RiskLevel;
  confidence: number;
  probabilities: Record<string, number>;
  uncertainty?: {
    softmax_entropy: number;
    normalized_entropy: number;
    margin: number;
    conformal_confidence_band: [number, number];
    conformal_prediction_set: RiskLevel[];
  };
  ood_diagnostics?: {
    is_ood: boolean;
    severity: 'NORMAL' | 'EXTREME_CYCLONIC_ANOMALY' | 'OUT_OF_DISTRIBUTION';
    anomalies: string[];
    recommendation?: string;
  };
  model_version?: string;
  domain_validation?: {
    status: 'UNVALIDATED_DEPLOYMENT_DOMAIN' | 'INVALID_INPUT';
    training_dataset: string;
    deployment_validation_status: string;
    warnings: string[];
    invalid_features: string[];
  };
}

let lastHealthCheck = { healthy: false, checkedAt: 0 };

export async function checkMlHealth(force = false): Promise<boolean> {
  const now = Date.now();
  if (!force && now - lastHealthCheck.checkedAt < 4000) {
    return lastHealthCheck.healthy;
  }
  const { url } = getMlApiConfig();
  try {
    const res = await fetch(`${url}/health`, {
      method: 'GET',
      headers: { Connection: 'keep-alive' },
      signal: AbortSignal.timeout(800),
    });
    const isHealthy = res.ok;
    lastHealthCheck = { healthy: isHealthy, checkedAt: now };
    return isHealthy;
  } catch {
    lastHealthCheck = { healthy: false, checkedAt: now };
    return false;
  }
}

function getMlApiConfig() {
  return {
    url: (process.env.ORCA_ML_API_URL || 'http://127.0.0.1:8000').replace(/\/$/, ''),
    timeoutMs: Number(process.env.ORCA_ML_API_TIMEOUT_MS || 3500),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function riskScoreFromProbabilities(probabilities: Record<string, number>): number {
  return Math.round(clamp(
    (probabilities.LOW || 0) * 10 +
    (probabilities.MODERATE || 0) * 40 +
    (probabilities.HIGH || 0) * 70 +
    (probabilities.EXTREME || 0) * 95,
    8,
    98,
  ));
}

function hasValidProbabilityDistribution(probabilities: Record<string, number>): boolean {
  const values = REQUIRED_PROBABILITY_LABELS.map((label) => probabilities[label]);
  return !values.some((value) => !Number.isFinite(value) || value < 0 || value > 1)
    && Math.abs(values.reduce((sum, value) => sum + value, 0) - 1) <= 0.001;
}

function getDisplayedConfidence(probabilities: Record<string, number>): number {
  return Math.max(...REQUIRED_PROBABILITY_LABELS.map((label) => probabilities[label]));
}

function formatProbabilityDistribution(probabilities: Record<string, number>): string {
  return REQUIRED_PROBABILITY_LABELS
    .map((label) => `${label} ${(probabilities[label] * 100).toFixed(1)}%`)
    .join(', ');
}

function seasonForMonth(month: number): number {
  if ([12, 1, 2].includes(month)) return 0;
  if ([3, 4, 5].includes(month)) return 1;
  if ([6, 7, 8, 9].includes(month)) return 2;
  return 3;
}

function buildFeaturePayload(weather: WeatherData, ocean: OceanData, location: LocationInfo) {
  const observed = new Date(weather.observedAt || new Date().toISOString());
  const month = observed.getUTCMonth() + 1;
  let hour = observed.getUTCHours();
  if (weather.observedAt && weather.observedAt.includes('T')) {
    const rawHour = parseInt(weather.observedAt.split('T')[1].slice(0, 2), 10);
    if (Number.isFinite(rawHour) && rawHour >= 0 && rawHour <= 23 && !weather.observedAt.endsWith('Z') && !weather.observedAt.slice(10).includes('+') && !weather.observedAt.slice(10).includes('-')) {
      hour = rawHour;
    }
  }
  return {
    wind_speed_kts: weather.windSpeedKts,
    wind_gust_kts: weather.windGustKts,
    wave_height_m: ocean.waveHeightMeters,
    wave_period_s: ocean.wavePeriodSec,
    swell_height_m: ocean.swellHeightMeters,
    swell_period_s: ocean.swellPeriodSec,
    wind_direction_deg: weather.windDirectionDeg,
    wave_direction_deg: ocean.waveDirectionDeg,
    swell_direction_deg: ocean.swellDirectionDeg,
    air_pressure_hpa: weather.pressureHpa,
    air_temperature_c: weather.airTemperatureC,
    sea_surface_temperature_c: ocean.seaSurfaceTemperatureC,
    precipitation_mm: weather.precipitationMm,
    visibility_km: weather.visibilityKm,
    latitude: location.latitude,
    longitude: location.longitude,
    month,
    hour,
    season: seasonForMonth(month),
    observed_at: weather.observedAt,
  };
}

function formatRiskPrediction(
  result: MlRiskResult,
  weather: WeatherData,
  ocean: OceanData,
  satellite: SatelliteData,
  location: LocationInfo,
): RiskPrediction {
  const riskScore = riskScoreFromProbabilities(result.probabilities);
  const displayedConfidence = getDisplayedConfidence(result.probabilities);
  const confidenceScore = Math.round(clamp(displayedConfidence * 100, 0, 100));
  const mlImpact: ImpactLevel = result.risk_label === 'EXTREME' ? 'CRITICAL' : result.risk_label === 'HIGH' ? 'HIGH' : result.risk_label === 'MODERATE' ? 'MEDIUM' : 'LOW';
  const waveImpact: ImpactLevel = ocean.waveHeightMeters >= 4 ? 'CRITICAL' : ocean.waveHeightMeters >= 2.5 ? 'HIGH' : ocean.waveHeightMeters >= 1.25 ? 'MEDIUM' : 'LOW';
  const gustImpact: ImpactLevel = weather.windGustKts >= 48 ? 'CRITICAL' : weather.windGustKts >= 34 ? 'HIGH' : weather.windGustKts >= 25 ? 'MEDIUM' : 'LOW';
  const swellImpact: ImpactLevel = ocean.swellHeightMeters >= 4 ? 'CRITICAL' : ocean.swellHeightMeters >= 2 ? 'HIGH' : ocean.swellHeightMeters >= 1 ? 'MEDIUM' : 'LOW';

  const featureContributions: FeatureContribution[] = [
    {
      featureName: 'ML Risk Classification',
      featureValue: result.risk_label,
      unit: 'class',
      riskWeight: clamp((riskScore - 50) / 50, -1, 1),
      impactLevel: mlImpact,
      description: `XGBoost ${result.model_version || 'unknown'} classified the live marine state as ${result.risk_label} with ${(displayedConfidence * 100).toFixed(1)}% probability confidence.`,
    },
    {
      featureName: 'Significant Wave Height (Hs)',
      featureValue: ocean.waveHeightMeters.toFixed(2),
      unit: 'm',
      riskWeight: clamp((ocean.waveHeightMeters - 1.0) / 3.0, -1, 1),
      impactLevel: waveImpact,
      description: `Observed significant wave height is ${ocean.waveHeightMeters.toFixed(2)}m.`,
    },
    {
      featureName: 'Wind Gusts',
      featureValue: weather.windGustKts.toFixed(1),
      unit: 'kts',
      riskWeight: clamp((weather.windGustKts - 15) / 35, -1, 1),
      impactLevel: gustImpact,
      description: `Observed wind gusts reach ${weather.windGustKts.toFixed(1)} knots.`,
    },
    {
      featureName: 'Swell Height',
      featureValue: ocean.swellHeightMeters.toFixed(2),
      unit: 'm',
      riskWeight: clamp((ocean.swellHeightMeters - 1) / 4, -1, 1),
      impactLevel: swellImpact,
      description: `Observed swell height is ${ocean.swellHeightMeters.toFixed(2)}m.`,
    },
  ];

  const advisories: string[] = [];
  const restrictedCraftTypes: string[] = [];
  const safeCraftTypes: string[] = [];
  if (result.risk_label === 'LOW') {
    advisories.push("Conditions are within the model's low-risk operating envelope; maintain normal marine safety procedures.");
    safeCraftTypes.push('Traditional Non-motorized Crafts', 'Motorized FRP Crafts', 'Mechanized Fishing Vessels');
  } else if (result.risk_label === 'MODERATE') {
    advisories.push('Exercise increased caution, particularly during surf-zone crossings and harbour approaches.');
    advisories.push('Verify lifejackets, communications, fuel, bilge and mooring readiness before departure.');
    restrictedCraftTypes.push('Small Unstabilized Non-motorized Crafts');
    safeCraftTypes.push('Motorized FRP Boats with Experienced Crew', 'Mechanized Fishing Vessels');
  } else if (result.risk_label === 'HIGH') {
    advisories.push('Small and exposed craft should not enter open sea under the current model classification.');
    advisories.push('Vessels already at sea should move toward the nearest safe harbour when operationally feasible.');
    restrictedCraftTypes.push('Small Non-motorized Crafts', 'Small Motorized FRP Crafts', 'Recreational Water-sport Vessels');
    safeCraftTypes.push('Large All-Weather Mechanized Vessels with Caution', 'Emergency Response Vessels');
  } else {
    advisories.push('Suspend normal fishing and recreational marine activity until authoritative warnings permit operations.');
    advisories.push('Secure moorings and maintain continuous monitoring of official maritime safety advisories.');
    restrictedCraftTypes.push('All Fishing Crafts', 'Small and Medium Commercial Vessels', 'Recreational Vessels');
    safeCraftTypes.push('Emergency Disaster Response Vessels Only');
  }

  if (satellite.status !== 'LIVE') advisories.push('Satellite observations are unavailable or degraded; treat remote-sensing-derived confidence separately from the ML classification.');
  const domainValidation = result.domain_validation ? {
    status: result.domain_validation.status,
    trainingDataset: result.domain_validation.training_dataset,
    deploymentValidationStatus: result.domain_validation.deployment_validation_status,
    warnings: result.domain_validation.warnings,
    invalidFeatures: result.domain_validation.invalid_features,
  } : undefined;
  if (domainValidation?.status === 'UNVALIDATED_DEPLOYMENT_DOMAIN') advisories.push('ML output is decision support. Defer to IMD/INCOIS/Coast Guard advisories for statutory safety decisions.');

  if (result.ood_diagnostics?.is_ood) {
    advisories.unshift(`⚠️ STATISTICAL OOD ANOMALY: ${result.ood_diagnostics.anomalies.join('; ')}. Conditions exceed historical operational training envelope!`);
  }
  if (result.uncertainty) {
    if (result.uncertainty.normalized_entropy > 0.65) {
      advisories.push('High class transition entropy: marine parameters are near the decision boundary between risk categories.');
    }
    if (result.uncertainty.margin < 0.2) {
      advisories.push(`Close margin (${(result.uncertainty.margin * 100).toFixed(1)}%) between top classifications.`);
    }
  }

  const modelVersion = result.model_version || 'orca-xgb-risk-unknown';
  return {
    riskScore,
    riskLevel: result.risk_label,
    confidenceScore,
    modelVersion,
    predictionTarget: 'Marine environmental risk classification for fishing and navigation safety',
    primaryRecommendation: result.risk_label === 'LOW' ? 'Favorable modeled conditions with normal safety precautions.' : result.risk_label === 'MODERATE' ? 'Elevated caution is advised, especially for small craft.' : result.risk_label === 'HIGH' ? 'High modeled risk: restrict small-craft operations and seek safer conditions.' : 'Extreme modeled risk: suspend normal marine operations and follow statutory warnings.',
    safetySummary: `XGBoost ${modelVersion} classified the current environmental state as ${result.risk_label}. Probability distribution: ${formatProbabilityDistribution(result.probabilities)}.`,
    actionableAdvisories: advisories,
    restrictedCraftTypes,
    safeCraftTypes,
    featureContributions,
    domainValidation,
    validUntil: new Date(Date.now() + 3 * 3600 * 1000).toISOString(),
    generatedAt: new Date().toISOString(),
    probabilities: result.probabilities,
    uncertainty: result.uncertainty ? {
      softmaxEntropy: result.uncertainty.softmax_entropy,
      normalizedEntropy: result.uncertainty.normalized_entropy,
      margin: result.uncertainty.margin,
      conformalConfidenceBand: result.uncertainty.conformal_confidence_band,
      conformalPredictionSet: result.uncertainty.conformal_prediction_set,
    } : undefined,
    oodDiagnostics: result.ood_diagnostics ? {
      isOod: result.ood_diagnostics.is_ood,
      severity: result.ood_diagnostics.severity,
      anomalies: result.ood_diagnostics.anomalies,
      recommendation: result.ood_diagnostics.recommendation,
    } : undefined,
  };
}

export async function predictMarineRiskWithMl(
  weather: WeatherData,
  ocean: OceanData,
  satellite: SatelliteData,
  location: LocationInfo,
): Promise<RiskPrediction | null> {
  const { url, timeoutMs } = getMlApiConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${url}/predict-risk`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Connection: 'keep-alive',
      },
      body: JSON.stringify(buildFeaturePayload(weather, ocean, location)),
      signal: controller.signal,
    });
    if (!response.ok) return null;

    const result = (await response.json()) as MlRiskResult;
    if (!result.success || !result.risk_label || !Number.isFinite(result.confidence) || !result.probabilities || !hasValidProbabilityDistribution(result.probabilities)) return null;

    return formatRiskPrediction(result, weather, ocean, satellite, location);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function predictMarineRiskBatchWithMl(
  items: Array<{ weather: WeatherData; ocean: OceanData; satellite: SatelliteData; location: LocationInfo }>,
): Promise<Array<RiskPrediction | null>> {
  if (!items.length) return [];
  const { url, timeoutMs } = getMlApiConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(timeoutMs * 2, 6000));

  try {
    const response = await fetch(`${url}/predict-risk-batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Connection: 'keep-alive',
      },
      body: JSON.stringify({
        items: items.map((item) => buildFeaturePayload(item.weather, item.ocean, item.location)),
      }),
      signal: controller.signal,
    });

    if (response.ok) {
      const data = (await response.json()) as { success: boolean; results: MlRiskResult[] };
      if (data.success && Array.isArray(data.results) && data.results.length === items.length) {
        return data.results.map((result, idx) => {
          if (!result.risk_label || !Number.isFinite(result.confidence) || !result.probabilities || !hasValidProbabilityDistribution(result.probabilities)) {
            return null;
          }
          const item = items[idx];
          return formatRiskPrediction(result, item.weather, item.ocean, item.satellite, item.location);
        });
      }
    }
  } catch {
    // Fall back to parallel individual calls
  } finally {
    clearTimeout(timeout);
  }

  // Graceful fallback to individual evaluation
  return Promise.all(items.map((item) => predictMarineRiskWithMl(item.weather, item.ocean, item.satellite, item.location)));
}

