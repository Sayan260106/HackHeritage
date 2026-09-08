import { Router } from 'express';
import { COASTAL_LOCATIONS } from '../../src/data/coastalData.ts';
import { calculateMarineRisk } from '../../src/utils/marineRiskEngine.ts';
import { analyzeSpatialContext, buildOperationalZones } from '../services/gisIntelligence.ts';
import { fetchMarineAndWeatherData, resolveLocation } from '../services/marineService.ts';
import { SatelliteData } from '../../src/types.ts';

const router = Router();

router.post('/analyze', async (req, res, next) => {
  try {
    const query = typeof req.body?.query === 'string' ? req.body.query : '';
    const requestedLocation = typeof req.body?.location === 'string' ? req.body.location : undefined;
    const location = requestedLocation && COASTAL_LOCATIONS[requestedLocation]
      ? COASTAL_LOCATIONS[requestedLocation]
      : resolveLocation(query || 'Goa');
    const realtime = await fetchMarineAndWeatherData(location.latitude, location.longitude);
    const satellite: SatelliteData = {
      status: 'UNAVAILABLE',
      satelliteName: 'GIS endpoint without EO dependency',
      processingTime: new Date().toISOString(),
      latitude: location.latitude,
      longitude: location.longitude,
      source: 'ORCA-X GIS',
      sourceUrl: '',
      observationType: 'NO_OBSERVATION',
      warnings: ['Satellite observations are not part of this GIS-only request.'],
      observations: []
    };
    const risk = calculateMarineRisk(realtime.weather, realtime.ocean, satellite, location);
    const zones = buildOperationalZones(location, risk);
    const spatialAnalysis = analyzeSpatialContext(location, risk, zones);
    res.json({ location, riskLevel: risk.riskLevel, riskScore: risk.riskScore, spatialAnalysis, zones });
  } catch (error) {
    next(error);
  }
});

import { fetchLiveOilSpillAnalysis } from '../services/realtime/oilSpillService.ts';

router.post('/oil-spills', async (req, res, next) => {
  try {
    const lat = Number(req.body?.latitude);
    const lon = Number(req.body?.longitude);

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return res.status(400).json({ error: 'Valid latitude and longitude are required.' });
    }

    const analysis = await fetchLiveOilSpillAnalysis(lat, lon);
    res.json(analysis);
  } catch (error) {
    next(error);
  }
});

export default router;
