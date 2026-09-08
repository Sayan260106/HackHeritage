import { Router } from 'express';
import {
  evidenceSearch,
  health,
  marineConditions,
  marineForecast,
  marineRisk,
  marineTelemetry,
  marineTelemetryAnalysis,
  orcaQuery,
  satelliteAnalysis,
  gisSpatialAnalysis,
  evidenceLiveIngest,
  getConversation,
  listConversations,
  deleteConversation,
  createConversation,
} from '../controllers/apiController.ts';

import { analyzeVesselTrafficAsync } from '../services/aisVesselService.ts';
import { COASTAL_LOCATIONS } from '../../src/data/coastalData.ts';

const router = Router();

router.post('/orca/query', orcaQuery);
router.post('/orca/chat', orcaQuery);
router.get('/orca/conversations', listConversations);
router.post('/orca/conversations', createConversation);
router.get('/orca/conversations/:sessionId', getConversation);
router.delete('/orca/conversations/:sessionId', deleteConversation);
router.get('/marine/conditions', marineConditions);
router.get('/marine/forecast', marineForecast);
router.get('/marine/telemetry', marineTelemetry);
router.get('/marine/telemetry/analysis', marineTelemetryAnalysis);
router.post('/marine/risk', marineRisk);
router.post('/satellite/analysis', satelliteAnalysis);
router.post('/evidence/search', evidenceSearch);
router.post('/evidence/live-ingest', evidenceLiveIngest);
router.get('/gis/spatial-analysis', gisSpatialAnalysis);
router.post('/gis/spatial-analysis', gisSpatialAnalysis);
router.get('/vessels/live', async (req, res, next) => {
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

    const vesselData = await analyzeVesselTrafficAsync(latitude, longitude, name);
    res.json(vesselData);
  } catch (error) {
    next(error);
  }
});
router.get('/health', health);

export default router;
