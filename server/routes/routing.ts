import { Router } from 'express';
import { calculateSafeRoute } from '../services/safeRouting.ts';

const router = Router();

import { fetchLiveOilSpillAnalysis } from '../services/realtime/oilSpillService.ts';

router.post('/safe-route', async (req, res) => {
  try {
    const origin = req.body?.origin;
    const destination = req.body?.destination;
    const riskLevel = req.body?.riskLevel;
    const maxNodes = req.body?.maxNodes;

    if (!origin || !destination) {
      return res.status(400).json({ error: 'origin and destination coordinates are required.' });
    }

    const originLat = Number(origin.latitude);
    const originLon = Number(origin.longitude);

    let oilSpills: any[] = [];
    try {
      const oilAnalysis = await fetchLiveOilSpillAnalysis(originLat, originLon);
      if (oilAnalysis.events && oilAnalysis.events.length > 0) {
        oilSpills = oilAnalysis.events;
      }
    } catch {
      // Ignore oil spill fetch failure, fallback to base routing
    }

    const result = calculateSafeRoute({
      origin: { latitude: originLat, longitude: originLon },
      destination: { latitude: Number(destination.latitude), longitude: Number(destination.longitude) },
      riskLevel: ['LOW', 'MODERATE', 'HIGH', 'EXTREME'].includes(riskLevel) ? riskLevel : undefined,
      maxNodes: Number.isFinite(Number(maxNodes)) ? Number(maxNodes) : undefined,
      oilSpills
    });

    if (oilSpills.length > 0 && result.status === 'ROUTE_FOUND') {
      if (!result.avoidedConstraints.includes('Active Satellite Oil Slick (NASA EONET / Copernicus SAR)')) {
        result.avoidedConstraints.push('Active Satellite Oil Slick (NASA EONET / Copernicus SAR)');
      }
    }

    return res.json(result);
  } catch (error) {
    console.error('Safe route analysis error:', error);
    return res.status(400).json({ error: error instanceof Error ? error.message : 'Safe route analysis failed.' });
  }
});

export default router;
