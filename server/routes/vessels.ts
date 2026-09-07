import { Router } from 'express';
import { analyzeVesselTraffic } from '../services/aisVesselService.ts';
import { COASTAL_LOCATIONS } from '../../src/data/coastalData.ts';
import { resolveLocation } from '../services/marineService.ts';

const router = Router();

router.get('/live', (req, res, next) => {
  try {
    const latStr = req.query.lat as string;
    const lonStr = req.query.lon as string;
    const locationKey = req.query.locationKey as string;

    let latitude = 21.6266;
    let longitude = 87.5074;
    let name = 'Digha Coast';

    if (locationKey && COASTAL_LOCATIONS[locationKey]) {
      latitude = COASTAL_LOCATIONS[locationKey].latitude;
      longitude = COASTAL_LOCATIONS[locationKey].longitude;
      name = COASTAL_LOCATIONS[locationKey].name;
    } else if (latStr && lonStr && !isNaN(Number(latStr)) && !isNaN(Number(lonStr))) {
      latitude = Number(latStr);
      longitude = Number(lonStr);
      name = 'Operating Point';
    }

    const vesselData = analyzeVesselTraffic(latitude, longitude, name);
    res.json(vesselData);
  } catch (error) {
    next(error);
  }
});

export default router;
