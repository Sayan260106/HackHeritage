import { Router } from 'express';
import { calculateSafeRoute } from '../services/safeRouting.ts';

const router = Router();

router.post('/safe-route', (req, res) => {
  try {
    const origin = req.body?.origin;
    const destination = req.body?.destination;
    const riskLevel = req.body?.riskLevel;
    const maxNodes = req.body?.maxNodes;

    if (!origin || !destination) {
      return res.status(400).json({ error: 'origin and destination coordinates are required.' });
    }

    const result = calculateSafeRoute({
      origin: { latitude: Number(origin.latitude), longitude: Number(origin.longitude) },
      destination: { latitude: Number(destination.latitude), longitude: Number(destination.longitude) },
      riskLevel: ['LOW', 'MODERATE', 'HIGH', 'EXTREME'].includes(riskLevel) ? riskLevel : undefined,
      maxNodes: Number.isFinite(Number(maxNodes)) ? Number(maxNodes) : undefined,
    });

    return res.json(result);
  } catch (error) {
    console.error('Safe route analysis error:', error);
    return res.status(400).json({ error: error instanceof Error ? error.message : 'Safe route analysis failed.' });
  }
});

export default router;
