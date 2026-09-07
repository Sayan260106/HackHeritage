import type { OceanData, WeatherData } from '../../../src/types.ts';
import type { MarineObservation, MarineObservationVariable } from './marineObservation.ts';

export type MarineSourceId = 'INCOIS' | 'MOSDAC' | 'OPEN_METEO' | 'TEST_FIXTURE';
export type SourceAvailability = 'LIVE' | 'DEGRADED' | 'UNAVAILABLE';

export interface MarineObservationSource {
  id: MarineSourceId;
  displayName: string;
  priority: number;
  enabled: boolean;
  fetch(lat: number, lon: number): Promise<MarineSourceObservation>;
}

export interface MarineSourceObservation {
  source: MarineSourceId;
  weather?: WeatherData;
  ocean?: OceanData;
  values?: Partial<Record<MarineObservationVariable, number>>;
  observedAt: string;
  retrievedAt: string;
  availability: SourceAvailability;
  warnings: string[];
  qualityScore: number;
}

export interface FusedMarineObservation {
  weather: WeatherData;
  ocean: OceanData;
  normalizedSources: MarineObservation[];
  selectedSources: Record<string, MarineSourceId>;
  featureSources: Partial<Record<MarineObservationVariable, MarineSourceId>>;
  sourceScores: Record<MarineSourceId, number>;
  providers: MarineSourceId[];
  warnings: string[];
  dataQuality: 'LIVE' | 'DEGRADED' | 'UNAVAILABLE';
  retrievedAt: string;
}
