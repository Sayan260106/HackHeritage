import 'dotenv/config';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const TIMEOUT_MS = Math.max(1000, Number(process.env.REALTIME_DATA_TIMEOUT_MS || 8000));
const LAT = Number(process.env.REALTIME_VERIFY_LAT || 15.0);
const LON = Number(process.env.REALTIME_VERIFY_LON || 73.0);

const OFFICIAL_INCOIS_PFZ_WFS = 'https://incois.gov.in/geoserver/PFZ_Automation/wfs?service=WFS&version=1.0.0&request=GetFeature&typeName=PFZ_Automation:pfzlines&outputFormat=application/json';
const OFFICIAL_INCOIS_ERDDAP = process.env.INCOIS_ERDDAP_URL || 'https://erddap.incois.gov.in/erddap/tabledap/Indian_ARGO_Floats.json';
const OFFICIAL_MOSDAC_CATALOG = 'https://mosdac.gov.in/catalog-app/satellite.php';
const OPEN_METEO_WEATHER = process.env.OPEN_METEO_WEATHER_API_URL || 'https://api.open-meteo.com/v1/forecast';
const OPEN_METEO_MARINE = process.env.OPEN_METEO_MARINE_API_URL || 'https://marine-api.open-meteo.com/v1/marine';

async function probe(name, url, options = {}) {
  const started = Date.now();
  try {
    const response = await fetch(url, {
      method: options.method || 'GET',
      headers: { Accept: options.accept || 'application/json', ...(options.headers || {}) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await response.text();
    return {
      name,
      ok: response.ok,
      status: response.status,
      latencyMs: Date.now() - started,
      contentType: response.headers.get('content-type'),
      bytes: Buffer.byteLength(text),
      note: response.ok ? 'reachable' : `HTTP ${response.status}`,
      errorType: response.ok ? undefined : 'HTTP_ERROR',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      name,
      ok: false,
      status: null,
      latencyMs: Date.now() - started,
      contentType: null,
      bytes: 0,
      note: message,
      errorType: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
    };
  }
}

function incoisQueryUrl() {
  const radius = 2;
  const since = new Date(Date.now() - 3650 * 86400000).toISOString();
  const projection = encodeURIComponent('time,latitude,longitude,PRES,TEMP,PSAL');
  return `${OFFICIAL_INCOIS_ERDDAP}?${projection}`
    + `&latitude>=${Math.max(-90, LAT - radius)}&latitude<=${Math.min(90, LAT + radius)}`
    + `&longitude>=${Math.max(-180, LON - radius)}&longitude<=${Math.min(180, LON + radius)}`
    + `&time>=${encodeURIComponent(since)}`;
}

async function main() {
  const configuredIncois = process.env.INCOIS_REALTIME_URL;
  const configuredMosdac = process.env.MOSDAC_REALTIME_URL;
  const results = await Promise.all([
    probe('INCOIS GeoServer WFS (Statutory Daily PFZ Frontlines)', OFFICIAL_INCOIS_PFZ_WFS),
    probe('INCOIS ERDDAP official endpoint', incoisQueryUrl()),
    probe('MOSDAC official catalog', OFFICIAL_MOSDAC_CATALOG, { accept: 'text/html' }),
    probe('Open-Meteo weather', `${OPEN_METEO_WEATHER}?latitude=${LAT}&longitude=${LON}&current=wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_2m,precipitation,surface_pressure`),
    probe('Open-Meteo marine', `${OPEN_METEO_MARINE}?latitude=${LAT}&longitude=${LON}&current=wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,swell_wave_period,sea_surface_temperature`),
    ...(configuredIncois ? [probe('Configured INCOIS normalized adapter', configuredIncois)] : []),
    ...(configuredMosdac ? [probe('Configured MOSDAC normalized adapter', configuredMosdac)] : []),
  ]);

  const report = {
    generatedAt: new Date().toISOString(),
    verificationPoint: { latitude: LAT, longitude: LON },
    configuredAdapters: { INCOIS: Boolean(configuredIncois), MOSDAC: Boolean(configuredMosdac) },
    results,
    interpretation: {
      incois: 'INCOIS ERDDAP is used directly as an auxiliary in-situ source. The verified Indian_ARGO_Floats product provides profile temperature/salinity, not a complete live surface wind/wave vector; stale observations are automatically excluded from the live ML feature merge by the freshness gate.',
      mosdac: 'MOSDAC is integrated through either an approved normalized gateway or a locally generated normalized cache from the official MOSDAC API/download workflow. The official workflow requires a MOSDAC account for downloads; credentials are never stored in this repository.',
      fusion: 'The ML input remains the existing 44-feature point-in-time contract. Sources are fused per variable, so a fresh INCOIS or MOSDAC SST can replace only SST without replacing Open-Meteo wind/wave features. This avoids pretending that one source supplies variables it does not actually measure.',
      retraining: 'This source integration does not automatically promote or retrain XGBoost. Collect parallel telemetry, review coverage/missingness/disagreement/distribution shift, then train and evaluate a v2.7 candidate against the locked temporal and Digha spatial protocols.',
    },
  };

  console.log(JSON.stringify(report, null, 2));
  process.exitCode = results.some((result) => result.name.startsWith('Open-Meteo') && !result.ok) ? 1 : 0;
}

main();
