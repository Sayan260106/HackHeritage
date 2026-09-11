import { MARINE_EVIDENCE_CORPUS } from '../src/data/coastalData.ts';
import { retrieveEvidence } from '../server/services/evidenceService.ts';
import { resolveCoast } from '../server/services/ragService.ts';
import { LocationInfo } from '../src/types.ts';

interface HealthResponse {
  status: string;
  embedding_model?: string;
  points_count?: number;
  qdrant_mode?: string;
  qdrant_collection?: string;
}

interface DenseSearchResult {
  success: boolean;
  results: Array<{
    id: string;
    title: string;
    relevanceScore: number;
    denseScore?: number;
    lexicalScore?: number;
  }>;
}

async function probeRagHealth(url: string): Promise<HealthResponse | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    const resp = await fetch(`${url}/health`, { signal: controller.signal });
    clearTimeout(timer);
    if (!resp.ok) return null;
    return (await resp.json()) as HealthResponse;
  } catch {
    return null;
  }
}

async function queryDenseRag(
  url: string,
  query: string,
  loc: LocationInfo,
): Promise<DenseSearchResult['results'] | null> {
  try {
    const coast = resolveCoast(loc);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const resp = await fetch(`${url}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        top_k: 10,
        coast: coast !== 'all' ? coast : undefined,
        state: loc.state || undefined,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!resp.ok) return null;
    const data = (await resp.json()) as DenseSearchResult;
    return data.results || [];
  } catch {
    return null;
  }
}

async function runBenchmark() {
  console.log('======================================================================');
  console.log('🌊 ORCA-X DUAL-CHANNEL RAG BENCHMARK: BGE-M3 DENSE + LEXICAL FALLBACK');
  console.log('======================================================================\n');

  console.log(`[1] Canonical Evidence Corpus Size: ${MARINE_EVIDENCE_CORPUS.length} statutory marine documents`);
  if (MARINE_EVIDENCE_CORPUS.length < 35) {
    throw new Error(`Expected at least 35 statutory evidence items, found ${MARINE_EVIDENCE_CORPUS.length}`);
  }

  let ragApiUrl = (process.env.ORCA_RAG_API_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
  let health = await probeRagHealth(ragApiUrl);
  if ((!health || health.status !== 'healthy') && !process.env.ORCA_RAG_API_URL) {
    ragApiUrl = 'http://127.0.0.1:8001';
    health = await probeRagHealth(ragApiUrl);
  }

  if (health && health.status === 'healthy') {
    console.log(`[2] Live BGE-M3/Qdrant Microservice: ONLINE at ${ragApiUrl}`);
    console.log(`    - Model: ${health.embedding_model || 'BAAI/bge-m3'}`);
    console.log(`    - Qdrant Mode: ${health.qdrant_mode || 'embedded'}`);
    console.log(`    - Collection Points: ${health.points_count ?? 'N/A'}`);
  } else {
    console.log(`[2] Live BGE-M3/Qdrant Microservice: OFFLINE on ports 8000/8001`);
    console.log(`    (Hint: Start unified service via 'npm run dev:ml' or 'uvicorn ml.api:app --port 8000')`);
    console.log(`    Proceeding with Lexical Fallback Evaluation.`);
  }

  const vizagLocation: LocationInfo = {
    name: 'Visakhapatnam Outer Harbour',
    state: 'Andhra Pradesh',
    country: 'India',
    latitude: 17.6868,
    longitude: 83.2185,
    regionType: 'coastal_harbor',
  };

  const dighaLocation: LocationInfo = {
    name: 'Digha Coastal Sector',
    state: 'West Bengal',
    country: 'India',
    latitude: 21.6266,
    longitude: 87.5074,
    regionType: 'inshore_water',
  };

  const kochiLocation: LocationInfo = {
    name: 'Cochin Fisheries Harbour',
    state: 'Kerala',
    country: 'India',
    latitude: 9.9312,
    longitude: 76.2673,
    regionType: 'coastal_harbor',
  };

  const mumbaiLocation: LocationInfo = {
    name: 'Sassoon Dock Harbor',
    state: 'Maharashtra',
    country: 'India',
    latitude: 18.9186,
    longitude: 72.8277,
    regionType: 'coastal_harbor',
  };

  const benchmarkCases = [
    {
      query: 'What is the Coast Guard VHF channel for maritime distress and SAR hotline?',
      expectedId: 'ICG-SAR-SOP-2026-01',
      topic: 'Coast Guard Search and Rescue (SAR)',
      loc: vizagLocation,
    },
    {
      query: 'When is the annual monsoon trawl ban enforced on the East Coast and West Coast?',
      expectedId: 'DAHD-TRAWL-BAN-2026-61',
      topic: 'Uniform Monsoon Trawl Ban Calendars',
      loc: vizagLocation,
    },
    {
      query: 'What do IMD port warning signals 3 and 7 mean for fishing boats and harbors?',
      expectedId: 'IMD-PORT-SIGNALS-1TO11',
      topic: 'Cyclone Port Warning Signals (1 to 11)',
      loc: vizagLocation,
    },
    {
      query: 'How do SST thermal fronts and chlorophyll gradients aggregate pelagic fish?',
      expectedId: 'CMFRI-PFZ-PROD-2026-88',
      topic: 'CMFRI Pelagic Fish & Thermal Fronts',
      loc: vizagLocation,
    },
    {
      query: 'What are the seasonal fishing restrictions in Gahirmatha turtle sanctuary and MPAs?',
      expectedId: 'MPA-GEOFENCE-REG-2026',
      topic: 'Marine Protected Area (MPA) Geofences',
      loc: dighaLocation,
    },
    {
      query: 'Why has pelagic sardine and mackerel catch declined near coastal waters?',
      expectedId: 'CMFRI-MFB-2026-108',
      topic: 'Pelagic Productivity Collapse & Hypoxia',
      loc: kochiLocation,
    },
    {
      query: 'What is the minimum gillnet mesh size for Hilsa conservation under WBMFRA?',
      expectedId: 'WBMFRA-HILSA-CONSERV-2026',
      topic: 'West Bengal Hilsa Spawning Sanctuaries',
      loc: dighaLocation,
    },
    {
      query: 'What are the turtle excluder device TED requirements and sanctuary ban in Odisha?',
      expectedId: 'OMFRA-TURTLE-TED-2026',
      topic: 'Odisha Marine Fishing Regulation Act (TED & OMFRA)',
      loc: dighaLocation,
    },
    {
      query: 'What is the 3-day token departure schedule for trawlers in Palk Bay?',
      expectedId: 'TNMFR-PALKBAY-3DAY-2026',
      topic: 'Tamil Nadu Trawler Token Rotation System',
      loc: vizagLocation,
    },
    {
      query: 'What are the inshore fishing boundaries and Coringa mangrove buffers under APMFRA?',
      expectedId: 'APMFRA-DELTA-ZONE-2026',
      topic: 'Andhra Pradesh Inshore Zoning & Coringa Mangroves',
      loc: vizagLocation,
    },
    {
      query: 'What is the minimum legal size MLS for oil sardine and mackerel in Kerala?',
      expectedId: 'KMFRA-MLS-REG-2026',
      topic: 'Kerala Minimum Legal Size & Night Trawling Ban',
      loc: kochiLocation,
    },
    {
      query: 'Is artificial LED light fishing or pair trawling permitted in Karnataka territorial waters?',
      expectedId: 'KARMFR-LIGHT-BAN-2026',
      topic: 'Karnataka Artificial LED Light Fishing Ban',
      loc: kochiLocation,
    },
    {
      query: 'What are the purse seine limits and monsoon trawl dates under Maharashtra MFRA?',
      expectedId: 'MHMFR-PURSE-SEINE-2026',
      topic: 'Maharashtra Purse Seine Zoning & Monsoon Ban',
      loc: mumbaiLocation,
    },
    {
      query: 'What biometric card and IMBL border restrictions apply to Gujarat fishing vessels?',
      expectedId: 'GJMFRA-BORDER-ID-2026',
      topic: 'Gujarat Fisheries Biometric & Sir Creek IMBL Buffer',
      loc: mumbaiLocation,
    },
    {
      query: 'What coastal zone is reserved for Ramponkar traditional fishermen in Goa?',
      expectedId: 'GOA-MFRA-ESTUARY-2026',
      topic: 'Goa Ramponkar Traditional Estuarine Reservation',
      loc: kochiLocation,
    },
    {
      query: 'What are the 4 stages of IMD cyclone alert and warning?',
      expectedId: 'IMD-CYCLONE-4STAGE-2026',
      topic: 'IMD 4-Stage Cyclone Warning Protocol',
      loc: dighaLocation,
    },
    {
      query: 'What precautions must artisanal crafts take during INCOIS Kallakkadal flash swell warnings?',
      expectedId: 'INCOIS-SWELL-KALLAKKADAL-2026',
      topic: 'INCOIS Kallakkadal Flash Swell Surge Alert',
      loc: kochiLocation,
    },
    {
      query: 'What life saving appliances LSA and parachute flares are mandatory on fishing vessels?',
      expectedId: 'DGS-LSA-EQUIP-NOTICE-2026',
      topic: 'DG Shipping Mandatory Life Saving Appliances (LSA)',
      loc: vizagLocation,
    },
    {
      query: 'What should fishers do if a Schedule I whale shark or sea turtle is caught as bycatch?',
      expectedId: 'WPA-SCHED1-MARINE-2026',
      topic: 'Wildlife Protection Act Schedule I Marine Bycatch Protocol',
      loc: vizagLocation,
    },
    {
      query: 'Where are NAVAREA VIII navigational warnings and marine safety broadcasts transmitted?',
      expectedId: 'NAVAREA-VIII-NAVWARN-2026',
      topic: 'NAVAREA VIII Indian Ocean Navigational Warnings',
      loc: vizagLocation,
    },
    {
      query: 'What actions should deep-sea and in-harbor vessels take during an ITEWC tsunami warning?',
      expectedId: 'INCOIS-TSUNAMI-EARLY-WARN-2026',
      topic: 'Indian Tsunami Early Warning Centre (ITEWC) Harbor Defense',
      loc: vizagLocation,
    },
    {
      query: 'When does IMD issue a Small Craft Advisory for marine squalls?',
      expectedId: 'IMD-SQUALL-BEAUFORT-GALE-2026',
      topic: 'IMD Marine Squall Scale & Small Craft Advisory',
      loc: dighaLocation,
    },
  ];

  console.log(`\n[3] Running Evaluation on ${benchmarkCases.length} Maritime Operational Queries:\n`);

  let lexTop1 = 0;
  let lexTop3 = 0;
  let denseTop1 = 0;
  let denseTop3 = 0;
  let denseEvaluated = 0;

  console.log(
    '| #  | Topic                                | Expected ID            | Lexical | Dense   | Status |',
  );
  console.log(
    '|----|--------------------------------------|------------------------|---------|---------|--------|',
  );

  for (let i = 0; i < benchmarkCases.length; i++) {
    const { query, expectedId, topic, loc } = benchmarkCases[i];

    // 1. Lexical channel
    const lexResults = retrieveEvidence(query, loc, 'MODERATE');
    const lexRank = lexResults.findIndex((item) => item.id === expectedId);
    if (lexRank === 0) lexTop1++;
    if (lexRank >= 0 && lexRank < 3) lexTop3++;

    // 2. Dense channel (if online)
    let denseRank = -1;
    if (health?.status === 'healthy') {
      const denseResults = await queryDenseRag(ragApiUrl, query, loc);
      if (denseResults) {
        denseEvaluated++;
        denseRank = denseResults.findIndex((item) => item.id === expectedId);
        if (denseRank === 0) denseTop1++;
        if (denseRank >= 0 && denseRank < 3) denseTop3++;
      }
    }

    const lexStr = lexRank >= 0 ? `#${lexRank + 1}` : 'MISS';
    const denseStr = denseRank >= 0 ? `#${denseRank + 1}` : health?.status === 'healthy' ? 'MISS' : 'N/A';
    const ok = lexRank === 0 || denseRank === 0;
    const symbol = ok ? '✓ PASS' : (lexRank < 3 || denseRank < 3) ? '⚡ TOP-3' : '⚠ SUB';

    const padTopic = topic.slice(0, 36).padEnd(36, ' ');
    const padExpected = expectedId.slice(0, 22).padEnd(22, ' ');
    const num = String(i + 1).padStart(2, '0');

    console.log(
      `| ${num} | ${padTopic} | ${padExpected} | ${lexStr.padEnd(7)} | ${denseStr.padEnd(7)} | ${symbol.padEnd(6)} |`,
    );
  }

  const lexTop1Pct = ((lexTop1 / benchmarkCases.length) * 100).toFixed(1);
  const lexTop3Pct = ((lexTop3 / benchmarkCases.length) * 100).toFixed(1);

  console.log('\n======================================================================');
  console.log('📊 RAG BENCHMARK RESULTS SUMMARY:');
  console.log('----------------------------------------------------------------------');
  console.log(`   Total Test Cases: ${benchmarkCases.length}`);
  console.log(`   ▶ Lexical Fallback Precision @ Rank 1: ${lexTop1}/${benchmarkCases.length} (${lexTop1Pct}%)`);
  console.log(`   ▶ Lexical Fallback Precision @ Rank 3: ${lexTop3}/${benchmarkCases.length} (${lexTop3Pct}%)`);

  if (denseEvaluated > 0) {
    const denseTop1Pct = ((denseTop1 / denseEvaluated) * 100).toFixed(1);
    const denseTop3Pct = ((denseTop3 / denseEvaluated) * 100).toFixed(1);
    console.log(`   ▶ Dense BGE-M3 Precision @ Rank 1:   ${denseTop1}/${denseEvaluated} (${denseTop1Pct}%)`);
    console.log(`   ▶ Dense BGE-M3 Precision @ Rank 3:   ${denseTop3}/${denseEvaluated} (${denseTop3Pct}%)`);
  }

  console.log('======================================================================');

  // Hard assertion: Lexical Precision@1 must be >= 85%, and Precision@3 must be 100%
  if (lexTop1 / benchmarkCases.length < 0.85) {
    throw new Error(`Lexical Precision@1 (${lexTop1Pct}%) is below 85% safety threshold.`);
  }
  if (lexTop3 < benchmarkCases.length) {
    throw new Error(`Lexical Precision@3 (${lexTop3Pct}%) missed ${benchmarkCases.length - lexTop3} queries.`);
  }

  console.log('✔ ALL RAG STATUTORY GROUNDING BENCHMARKS PASSED SUCCESSFULLY!');
}

runBenchmark().catch((err) => {
  console.error('[FAIL] RAG evidence benchmark failed:', err);
  process.exit(1);
});
