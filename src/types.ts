export type RiskLevel = 'LOW' | 'MODERATE' | 'HIGH' | 'EXTREME';

export type LanguageCode = 'en' | 'bn' | 'hi' | 'ta' | 'or' | 'te' | 'ml' | 'gu' | 'mr' | 'kn';

export interface LocationInfo {
  name: string;
  state?: string;
  country: string;
  latitude: number;
  longitude: number;
  regionType: 'coastal_harbor' | 'open_sea' | 'estuary' | 'island' | 'bay';
  depthMeters?: number;
  nearestPort?: string;
}

export interface TimeWindow {
  requestedText: string;
  resolvedStartTime: string;
  resolvedEndTime: string;
  localDisplayTime: string;
  isForecast: boolean;
}

export type DataQuality = 'LIVE' | 'DEGRADED' | 'UNAVAILABLE';

export interface WeatherData { airTemperatureC: number; windSpeedKts: number; windGustKts: number; windDirectionDeg: number; windDirectionCompass: string; precipitationMm: number; cloudCoverPct: number; visibilityKm: number; pressureHpa: number; weatherCode: number; weatherDescription: string; source: string; sourceUrl?: string; observedAt: string; retrievedAt?: string; dataQuality?: DataQuality; }
export interface OceanData { waveHeightMeters: number; maxWaveHeightMeters: number; wavePeriodSec: number; waveDirectionDeg: number; swellHeightMeters: number; swellPeriodSec: number; swellDirectionDeg: number; seaSurfaceTemperatureC: number; currentSpeedKts: number; currentDirectionDeg: number; salinityPsu?: number; seaStateIndex: number; seaStateDescription: string; tidePhase: 'High Tide' | 'Low Tide' | 'Flood Tide' | 'Ebb Tide' | 'Unknown'; tideHeightMeters?: number; source: string; sourceUrl?: string; observedAt: string; retrievedAt?: string; dataQuality?: DataQuality; }
export interface RealtimeObservationMetadata { retrievedAt: string; providers: string[]; dataQuality: DataQuality; warnings: string[]; }
export interface SatelliteObservation { collectionId: string; collectionTitle: string; productId: string; productUrl?: string; platform?: string; instrument?: string; acquisitionTime?: string; cloudCoverPct?: number; distanceKm?: number; observationAgeHours?: number; processingLevel?: string; productType?: string; timeliness?: string; orbitState?: string; relativeOrbit?: number; productSizeMb?: number; assetCount?: number; sceneWaterPct?: number; sceneVegetationPct?: number; sceneCloudShadowPct?: number; sceneHighCloudPct?: number; sceneMediumCloudPct?: number; }
export type SatelliteStatus = 'LIVE' | 'DEGRADED' | 'UNAVAILABLE' | 'SIMULATED';
export interface SatelliteData { status: SatelliteStatus; satelliteName: string; platform?: string; productId?: string; productUrl?: string; acquisitionTime?: string; processingTime: string; latitude: number; longitude: number; chlorophyllConcentrationMgM3?: number; sstC?: number; sstAnomalyC?: number; turbidityNTU?: number; totalSuspendedSolidsMgL?: number; sarRoughnessIndex?: number; cloudCoverPct?: number; algalBloomDetected?: boolean; thermalFrontDetected?: boolean; surfaceSlickAnomalies?: boolean; confidenceScore?: number; latestObservationAgeHours?: number; nearestObservationDistanceKm?: number; collectionCount?: number; totalAssetCount?: number; totalProductSizeMb?: number; bestSceneWaterPct?: number; bestSceneHighCloudPct?: number; bestSceneMediumCloudPct?: number; source: string; sourceUrl: string; observationType: 'OBSERVATION' | 'NO_OBSERVATION'; observationAgeHours?: number; warnings: string[]; observations: SatelliteObservation[]; }
export interface FeatureContribution { featureName: string; featureValue: string | number; unit: string; riskWeight: number; impactLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'; description: string; }
export interface RiskDomainValidation { status: 'UNVALIDATED_DEPLOYMENT_DOMAIN' | 'INVALID_INPUT'; trainingDataset: string; deploymentValidationStatus: string; warnings: string[]; invalidFeatures: string[]; }
export interface RiskPrediction { riskScore: number; riskLevel: RiskLevel; confidenceScore: number; modelVersion: string; predictionTarget: string; primaryRecommendation: string; safetySummary: string; actionableAdvisories: string[]; restrictedCraftTypes: string[]; safeCraftTypes: string[]; featureContributions: FeatureContribution[]; domainValidation?: RiskDomainValidation; validUntil: string; generatedAt: string; }
export interface GisGeoJsonFeature { type: 'Feature'; geometry: { type: 'Polygon' | 'Point' | 'LineString'; coordinates: any }; properties: { name: string; category: 'restricted_zone' | 'hazard_zone' | 'precaution_zone' | 'fishing_zone' | 'port_buffer' | 'safe_corridor' | 'port_shelter' | 'buoy_station' | 'bathymetry'; riskLevel?: RiskLevel; description: string; color: string; details?: Record<string, any>; }; }
export interface GisLayerData { type: 'FeatureCollection'; features: GisGeoJsonFeature[]; }
export interface EvidenceItem { id: string; title: string; sourceAuthority: string; documentType: 'Fisheries Advisory' | 'Ocean State Forecast' | 'Cyclone Bulletin' | 'Maritime Regulation' | 'Scientific Protocol'; publicationDate: string; excerpt: string; relevanceScore: number; officialUrl?: string; complianceRule?: string; }

export interface AgentStepTrace { agentName: 'Planner' | 'LocationTimeResolver' | 'WeatherAgent' | 'OceanAgent' | 'SatelliteAgent' | 'RiskEngine' | 'GisAgent' | 'EvidenceRetrieval' | 'ResponseGrounding'; status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'; startedAt: string; completedAt?: string; durationMs?: number; inputSummary: string; outputSummary: string; logs: string[]; error?: string; taskId?: string; dependencies?: string[]; }
export interface OrcaExecutionTask { id: string; label: string; dependsOn: string[]; required: boolean; enabled: boolean; status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'; reason: string; }
export interface OrcaExecutionPlan { planId: string; intent: string; rationale: string; tasks: OrcaExecutionTask[]; generatedAt: string; }

export interface OrcaAnalysisResponse { queryId: string; originalQuery: string; language: LanguageCode; detectedIntent: string; location: LocationInfo; timeWindow: TimeWindow; weather: WeatherData; ocean: OceanData; satellite: SatelliteData; risk: RiskPrediction; gisLayers: GisLayerData; evidence: EvidenceItem[]; agentTraces: AgentStepTrace[]; groundedSummary: string; translatedSummary?: Record<string, string>; isDataDegraded?: boolean; warnings?: string[]; freshnessTimestamp: string; officialDisclaimer: string; executionPlan?: OrcaExecutionPlan; }

export interface QueryRequest { query: string; locationOverride?: string; timeOverride?: string; language?: LanguageCode; includeSatellite?: boolean; }
