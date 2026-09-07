import { Router } from 'express';
import { COASTAL_LOCATIONS } from '../../src/data/coastalData.ts';
import { analyzePfz } from '../services/pfzService.ts';
import { resolveLocation } from '../services/marineService.ts';
import { fetchRealtimeMarineObservation } from '../services/realtime/realtimeObservationService.ts';
import { analyzeMaritimeGeofencing } from '../services/geofenceService.ts';
import { predictMarineRiskWithMl } from '../../src/services/ml/riskService.ts';
import { calculateMarineRisk } from '../../src/utils/marineRiskEngine.ts';
import { fetchSatelliteData } from '../../src/services/satellite/satelliteService.ts';

const router = Router();

router.post('/analyze', async (req, res) => {
  try {
    const locationKey = typeof req.body?.locationKey === 'string' ? req.body.locationKey : undefined;
    const query = typeof req.body?.query === 'string' ? req.body.query : '';
    const lat = Number(req.body?.latitude);
    const lon = Number(req.body?.longitude);

    const location = locationKey && COASTAL_LOCATIONS[locationKey]
      ? COASTAL_LOCATIONS[locationKey]
      : Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180
        ? { name: 'Custom Coastal Point', country: 'India', latitude: lat, longitude: lon, regionType: 'open_sea' as const }
        : resolveLocation(query || 'Goa');

    const geofence = analyzeMaritimeGeofencing(location.latitude, location.longitude);
    const realtime = await fetchRealtimeMarineObservation(location.latitude, location.longitude).catch(() => undefined);
    
    const now = new Date();
    const past = new Date(now.getTime() - 7 * 86400 * 1000);
    const satellite = await fetchSatelliteData(location.latitude, location.longitude, past.toISOString(), now.toISOString()).catch(() => undefined);

    let risk = undefined;
    if (realtime) {
      risk = await predictMarineRiskWithMl(realtime.weather, realtime.ocean, satellite as any, location)
        .catch(() => calculateMarineRisk(realtime.weather, realtime.ocean, satellite as any, location));
    }

    res.json(await analyzePfz(location, risk, geofence));
  } catch (error) {
    console.error('PFZ analysis error:', error);
    res.status(502).json({ error: error instanceof Error ? error.message : 'PFZ analysis failed.' });
  }
});

export default router;
