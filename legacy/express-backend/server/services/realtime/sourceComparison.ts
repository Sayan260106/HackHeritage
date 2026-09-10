import type { MarineSourceId } from './marineDataSource.ts';
import type { MarineObservation, MarineObservationVariable } from './marineObservation.ts';

export interface SourceComparisonMetric {
  variable: MarineObservationVariable;
  values: Partial<Record<MarineSourceId, number>>;
  spread?: number;
  relativeSpread?: number;
  disagreement: boolean;
}

export function compareSources(observations: MarineObservation[]): SourceComparisonMetric[] {
  const variables: MarineObservationVariable[] = [
    'windSpeedKts',
    'windGustKts',
    'waveHeightMeters',
    'wavePeriodSec',
    'swellHeightMeters',
    'swellPeriodSec',
    'seaSurfaceTemperatureC',
  ];

  return variables.map((variable) => {
    const values: Partial<Record<MarineSourceId, number>> = {};
    for (const observation of observations) {
      const current = observation.values[variable];
      if (typeof current === 'number' && Number.isFinite(current)) values[observation.source] = current;
    }

    const numbers = Object.values(values).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    const spread = numbers.length >= 2 ? Math.max(...numbers) - Math.min(...numbers) : undefined;
    const mean = numbers.length >= 2 ? numbers.reduce((sum, item) => sum + item, 0) / numbers.length : 0;
    const relativeSpread = mean !== 0 && spread !== undefined ? Math.abs(spread / mean) : 0;

    return {
      variable,
      values,
      spread,
      relativeSpread,
      disagreement: relativeSpread > 0.25,
    };
  });
}
