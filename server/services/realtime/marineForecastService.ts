import { LocationInfo, RiskLevel, SatelliteData } from '../../../src/types.ts';
import { predictMarineRiskBatchWithMl } from '../../../src/services/ml/riskService.ts';
import { calculateMarineRisk } from '../../../src/utils/marineRiskEngine.ts';
import { fetchOpenMeteoTomorrowForecast } from './openMeteoForecastProvider.ts';

const RISK_ORDER: RiskLevel[] = ['LOW', 'MODERATE', 'HIGH', 'EXTREME'];

function riskRank(level: RiskLevel): number {
  return RISK_ORDER.indexOf(level);
}

function forecastSatellite(location: LocationInfo): SatelliteData {
  return {
    status: 'UNAVAILABLE',
    satelliteName: 'No forecast satellite observation supplied',
    processingTime: new Date().toISOString(),
    latitude: location.latitude,
    longitude: location.longitude,
    source: 'No satellite forecast source',
    sourceUrl: '',
    observationType: 'NO_OBSERVATION',
    warnings: ['Satellite observations are point-in-time remote-sensing data and are not used as a synthetic future observation.'],
    observations: [],
  };
}

export async function buildTomorrowMarineRiskForecast(location: LocationInfo) {
  const forecast = await fetchOpenMeteoTomorrowForecast(location.latitude, location.longitude);
  const satellite = forecastSatellite(location);

  const batchInputs = forecast.points.map((point) => ({
    weather: point.weather,
    ocean: point.ocean,
    satellite,
    location,
  }));

  const mlPredictions = await predictMarineRiskBatchWithMl(batchInputs);
  let usedMlCount = 0;

  const points = forecast.points.map((point, idx) => {
    const mlRisk = mlPredictions[idx];
    if (mlRisk) usedMlCount += 1;
    const risk = mlRisk || calculateMarineRisk(point.weather, point.ocean, satellite, location);

    const forecastRisk = {
      ...risk,
      predictionTarget: '6-hour marine environmental risk forecast evaluated at this forecast hour',
      primaryRecommendation: risk.primaryRecommendation
        .replace(/current environmental state/gi, 'forecast environmental state')
        .replace(/current model classification/gi, 'forecast model classification'),
      safetySummary: risk.safetySummary.replace(/current environmental state/gi, 'forecast environmental state'),
      featureContributions: risk.featureContributions.map((feature) => ({
        ...feature,
        description: feature.description.replace(/^Observed /, 'Forecast '),
      })),
      validUntil: point.forecastAt,
    };

    return { forecastAt: point.forecastAt, risk: forecastRisk };
  });


  const ranked = [...points].sort((a, b) => riskRank(b.risk!.riskLevel) - riskRank(a.risk!.riskLevel));
  const worst = ranked[0];
  const averageScore = Math.round(points.reduce((sum, point) => sum + (point.risk?.riskScore || 0), 0) / points.length);
  const highRiskHours = points.filter((point) => riskRank(point.risk!.riskLevel) >= riskRank('HIGH')).length;

  return {
    forecastDate: forecast.forecastDate,
    timezone: forecast.timezone,
    retrievedAt: forecast.retrievedAt,
    location,
    modelVersion: worst.risk!.modelVersion,
    predictionHorizonHours: 6,
    source: ['Open-Meteo Weather Forecast API', 'Open-Meteo Marine Forecast API'],
    sourceType: 'FORECAST',
    summary: {
      worstRiskLevel: worst.risk!.riskLevel,
      worstRiskAt: worst.forecastAt,
      worstRiskScore: worst.risk!.riskScore,
      averageRiskScore: averageScore,
      highOrExtremeHours: highRiskHours,
      totalHours: points.length,
      recommendation: riskRank(worst.risk!.riskLevel) >= riskRank('HIGH')
        ? 'Do not treat tomorrow as broadly safe for small-craft operations; follow the hourly risk and authoritative IMD/INCOIS warnings.'
        : riskRank(worst.risk!.riskLevel) === riskRank('MODERATE')
          ? 'Tomorrow remains conditionally operable in the model, but small craft require increased caution and official-warning checks.'
          : 'Tomorrow is within the model low-risk envelope, subject to authoritative warnings and normal marine safety procedures.',
    },
    hourly: points.map(({ forecastAt, risk }) => ({ forecastAt, risk })),
    warnings: [
      'This is a model-based forecast using Open-Meteo forecast inputs; it is not an observed measurement.',
      usedMlCount > 0
        ? `Hourly risk evaluated using XGBoost ML model (${usedMlCount}/${points.length} slots evaluated via live ML).`
        : 'Hourly risk evaluated via physics fallback engine (Douglas sea state index) because ML inference daemon was offline.',
      'IMD, INCOIS and Coast Guard safety warnings take precedence over this ML decision-support output.',
      'Forecast conditions can change; re-check close to departure and monitor official advisories continuously.',
    ],

  };
}
