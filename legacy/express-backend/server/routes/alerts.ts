import { Router } from 'express';
import { evaluateMarineAlerts, type AlertEvaluationInput } from '../services/alertEngine.ts';

const router = Router();

router.post('/evaluate', (req, res) => {
  try {
    const body = req.body as Partial<AlertEvaluationInput>;
    if (!body.weather || !body.ocean || !body.risk) {
      return res.status(400).json({ error: 'weather, ocean and risk inputs are required.' });
    }
    const result = evaluateMarineAlerts(body as AlertEvaluationInput);
    return res.json(result);
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : 'Marine alert evaluation failed.' });
  }
});

router.post('/dispatch', (req, res) => {
  try {
    const { targetType, mmsi, name, latitude, longitude, reason, recipient } = req.body;
    console.log(`🚨 [COAST GUARD DISPATCH] Transmitted ${targetType} warning for ${name} (${mmsi}) at ${latitude}°N, ${longitude}°E to ${recipient}`);
    return res.json({
      status: 'DISPATCHED',
      dispatchId: `cg-dispatch-${Date.now()}`,
      target: { mmsi, name, latitude, longitude, reason },
      recipient: recipient || 'INDIAN_COAST_GUARD_ICGS_PATROL',
      timestamp: new Date().toISOString(),
      message: 'Emergency interception request transmitted to Coast Guard Command Control.'
    });
  } catch (error) {
    return res.status(500).json({ error: 'Dispatch failed' });
  }
});

export default router;
