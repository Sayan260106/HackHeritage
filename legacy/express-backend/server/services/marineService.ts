import {
  LocationInfo,
  TimeWindow,
} from '../../src/types.ts';
import { COASTAL_LOCATIONS } from '../../src/data/coastalData.ts';
import { fetchRealtimeMarineObservation, RealtimeMarineObservation } from './realtime/realtimeObservationService.ts';
import { fetchOpenMeteoForecast } from './realtime/openMeteoProvider.ts';

export function resolveLocation(query: string, locationOverride?: any): LocationInfo {
  // If locationOverride is an object containing lat/lon
  if (locationOverride && typeof locationOverride === 'object') {
    const lat = Number(locationOverride.lat ?? locationOverride.latitude);
    const lon = Number(locationOverride.lon ?? locationOverride.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
      let nearestPortName = 'Open Sea';
      let minDist = Infinity;
      for (const loc of Object.values(COASTAL_LOCATIONS)) {
        const d = Math.hypot(loc.latitude - lat, loc.longitude - lon);
        if (d < minDist) {
          minDist = d;
          nearestPortName = loc.name;
        }
      }
      return {
        name: locationOverride.label || locationOverride.name || `Vessel Point (${lat.toFixed(3)}°N, ${lon.toFixed(3)}°E)`,
        country: 'India',
        latitude: lat,
        longitude: lon,
        regionType: 'open_sea',
        nearestPort: `Off ${nearestPortName}`
      };
    }
  }

  const target = (typeof locationOverride === 'string' && locationOverride.trim().length > 0)
    ? locationOverride
    : (typeof query === 'string' ? query : '');
  const q = target.toLowerCase();

  // 1. Check if locationOverride or query contains coordinates (e.g. "20.1234, 86.5678" or "20.1234°N, 86.5678°E")
  const coordMatch = target.match(/(-?\d+\.?\d*)\s*°?\s*([nNsS])?\s*,\s*(-?\d+\.?\d*)\s*°?\s*([eEwW])?/);
  if (coordMatch) {
    let lat = parseFloat(coordMatch[1]);
    let lon = parseFloat(coordMatch[3]);
    if (coordMatch[2]?.toUpperCase() === 'S') lat = -lat;
    if (coordMatch[4]?.toUpperCase() === 'W') lon = -lon;
    if (Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
      let nearestPortName = 'Open Sea';
      let minDist = Infinity;
      for (const loc of Object.values(COASTAL_LOCATIONS)) {
        const d = Math.hypot(loc.latitude - lat, loc.longitude - lon);
        if (d < minDist) {
          minDist = d;
          nearestPortName = loc.name;
        }
      }
      return {
        name: `Vessel Point (${lat.toFixed(3)}°N, ${lon.toFixed(3)}°E)`,
        country: 'India',
        latitude: lat,
        longitude: lon,
        regionType: 'open_sea',
        nearestPort: `Off ${nearestPortName}`
      };
    }
  }

  for (const [key, loc] of Object.entries(COASTAL_LOCATIONS)) {
    if (
      q.includes(key) ||
      q.includes(loc.name.toLowerCase()) ||
      (loc.state && q.includes(loc.state.toLowerCase())) ||
      (loc.nearestPort && q.includes(loc.nearestPort.toLowerCase()))
    ) return loc;
  }

  if (q.includes('digha') || q.includes('bengal') || q.includes('kolkata')) return COASTAL_LOCATIONS.digha;
  if (q.includes('puri') || q.includes('odisha') || q.includes('orissa')) return COASTAL_LOCATIONS.puri;
  if (q.includes('vizag') || q.includes('visakhapatnam') || q.includes('andhra')) return COASTAL_LOCATIONS.visakhapatnam;
  if (q.includes('paradeep') || q.includes('paradip')) return COASTAL_LOCATIONS.paradeep;
  if (q.includes('kochi') || q.includes('cochin') || q.includes('kerala')) return COASTAL_LOCATIONS.kochi;
  if (q.includes('chennai') || q.includes('madras') || q.includes('tamil')) return COASTAL_LOCATIONS.chennai;
  if (q.includes('mumbai') || q.includes('bombay') || q.includes('maharashtra')) return COASTAL_LOCATIONS.mumbai;
  if (q.includes('goa') || q.includes('mormugao')) return COASTAL_LOCATIONS.goa;
  if (q.includes('mangalore') || q.includes('karnataka')) return COASTAL_LOCATIONS.mangalore;
  if (q.includes('veraval') || q.includes('porbandar') || q.includes('gujarat')) return COASTAL_LOCATIONS.veraval;
  if (q.includes('andaman') || q.includes('port blair')) return COASTAL_LOCATIONS.port_blair;
  if (q.includes('sundarban')) return COASTAL_LOCATIONS.sundarbans;

  return COASTAL_LOCATIONS.digha;
}

export function resolveTimeWindow(query: string, timeOverride?: any): TimeWindow {
  const target = (typeof timeOverride === 'string' && timeOverride.trim().length > 0)
    ? timeOverride
    : (typeof query === 'string' ? query : '');
  const q = target.toLowerCase();
  const now = new Date();
  let start = new Date(now);
  let end = new Date(now.getTime() + 6 * 3600 * 1000);
  let isForecast = false;
  let requestedText = 'Current / Next 6 Hours';

  if (q.includes('today') || q.includes('current') || q.includes('now') || q.includes('এখন') || q.includes('आज')) {
    requestedText = 'Current Conditions';
  } else if (q.includes('tomorrow morning') || q.includes('কাল সকাল') || q.includes('कल सुबह')) {
    start = new Date(now.getTime() + 24 * 3600 * 1000);
    start.setHours(6, 0, 0, 0);
    end = new Date(start.getTime() + 6 * 3600 * 1000);
    requestedText = 'Tomorrow Morning (06:00 - 12:00 Local)';
    isForecast = true;
  } else if (q.includes('tomorrow') || q.includes('কাল') || q.includes('कल')) {
    start = new Date(now.getTime() + 24 * 3600 * 1000);
    end = new Date(start.getTime() + 12 * 3600 * 1000);
    requestedText = 'Tomorrow Full Day Window';
    isForecast = true;
  } else if (q.includes('this evening') || q.includes('tonight') || q.includes('আজ সন্ধ্যা')) {
    start.setHours(18, 0, 0, 0);
    end = new Date(start.getTime() + 6 * 3600 * 1000);
    requestedText = 'Today Evening / Night (18:00 - 24:00 Local)';
    isForecast = true;
  } else if (q.includes('weekend') || q.includes('sunday') || q.includes('saturday')) {
    start = new Date(now.getTime() + 48 * 3600 * 1000);
    end = new Date(start.getTime() + 24 * 3600 * 1000);
    requestedText = 'Upcoming Weekend Window';
    isForecast = true;
  } else if (q.includes('next week') || q.includes('পরের সপ্তাহ') || q.includes('अगले हफ्ते')) {
    start = new Date(now.getTime() + 7 * 24 * 3600 * 1000);
    end = new Date(start.getTime() + 12 * 3600 * 1000);
    requestedText = 'Next Week Forecast Window';
    isForecast = true;
  } else if (q.includes('day after tomorrow') || q.includes('2 days') || q.includes('পরশু')) {
    start = new Date(now.getTime() + 48 * 3600 * 1000);
    end = new Date(start.getTime() + 12 * 3600 * 1000);
    requestedText = 'Day After Tomorrow Window';
    isForecast = true;
  } else if (q.includes('next 3 days') || q.includes('3 days') || q.includes('আগামী ৩ দিন')) {
    start = new Date(now.getTime() + 72 * 3600 * 1000);
    end = new Date(start.getTime() + 12 * 3600 * 1000);
    requestedText = 'Next 3 Days Forecast';
    isForecast = true;
  }

  return {
    requestedText,
    resolvedStartTime: start.toISOString(),
    resolvedEndTime: end.toISOString(),
    localDisplayTime: start.toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      dateStyle: 'medium',
      timeStyle: 'short',
    }),
    isForecast,
  };
}

export function resolveSatelliteObservationWindow(timeWindow: TimeWindow) {
  const now = new Date();
  if (timeWindow.isForecast) {
    const start = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
    return {
      startTime: start.toISOString(),
      endTime: now.toISOString(),
      reason: 'Forecast query: using latest 7 days of satellite observations for context',
    };
  }

  const requestedStart = new Date(timeWindow.resolvedStartTime);
  const requestedEnd = new Date(timeWindow.resolvedEndTime);
  const end = requestedEnd > now ? now : requestedEnd;
  const start = requestedStart > end ? new Date(end.getTime() - 24 * 3600 * 1000) : requestedStart;
  return {
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    reason: 'Current query: using the requested current/recent satellite observation window',
  };
}

export async function fetchMarineAndWeatherData(
  lat: number,
  lon: number,
  timeWindow?: TimeWindow,
): Promise<RealtimeMarineObservation> {
  // If the query is about a future time, use the hourly forecast API so
  // wave height, wind and risk numbers actually reflect that future slot.
  if (timeWindow?.isForecast) {
    try {
      const targetIso = timeWindow.resolvedStartTime;
      const forecast = await fetchOpenMeteoForecast(lat, lon, targetIso);
      const warnings = [
        `Forecast data for ${timeWindow.requestedText} (${new Date(targetIso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}).`,
        'Forecast accuracy decreases beyond 3 days; always verify with INCOIS OSF before sailing.',
      ];
      return {
        weather: forecast.weather,
        ocean: forecast.ocean,
        normalizedSources: [],
        metadata: {
          retrievedAt: forecast.retrievedAt,
          providers: ['Open-Meteo 7-Day Hourly Forecast'],
          dataQuality: 'LIVE',
          warnings,
          selectedSources: { primary: 'OPEN_METEO' } as any,
          featureSources: {},
          sourceScores: { OPEN_METEO: 1 } as any,
        },
        degraded: false,
      };
    } catch (err) {
      // Fall through to current observation if forecast fetch fails
      console.warn('[MarineService] Forecast fetch failed, falling back to current:', err instanceof Error ? err.message : String(err));
    }
  }
  return fetchRealtimeMarineObservation(lat, lon);
}
