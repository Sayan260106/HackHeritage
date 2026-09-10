import { RealtimeObservationMetadata, WeatherData, OceanData } from '../../../src/types.ts';
import { fetchFusedRealtimeMarineObservation } from './marineDataFusion.ts';
import type { MarineSourceId } from './marineDataSource.ts';
import type { MarineObservation, MarineObservationVariable } from './marineObservation.ts';

export interface RealtimeMarineObservation {
  weather: WeatherData;
  ocean: OceanData;
  normalizedSources: MarineObservation[];
  metadata: RealtimeObservationMetadata & {
    selectedSources: Record<string, MarineSourceId>;
    featureSources: Partial<Record<MarineObservationVariable, MarineSourceId>>;
    sourceScores: Record<MarineSourceId, number>;
  };
  degraded: boolean;
}

export async function fetchRealtimeMarineObservation(lat: number, lon: number): Promise<RealtimeMarineObservation> {
  const result = await fetchFusedRealtimeMarineObservation(lat, lon);
  return {
    weather: result.weather,
    ocean: result.ocean,
    normalizedSources: result.normalizedSources,
    metadata: {
      retrievedAt: result.retrievedAt,
      providers: result.providers,
      dataQuality: result.dataQuality,
      warnings: result.warnings.length > 0 ? result.warnings : [
        'Marine observations are advisory decision-support data and not a navigation substitute.',
      ],
      selectedSources: result.selectedSources,
      featureSources: result.featureSources,
      sourceScores: result.sourceScores,
    },
    degraded: result.dataQuality !== 'LIVE',
  };
}
