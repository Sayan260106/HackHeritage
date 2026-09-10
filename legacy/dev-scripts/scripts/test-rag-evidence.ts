import { MARINE_EVIDENCE_CORPUS } from '../src/data/coastalData.ts';
import { retrieveEvidence } from '../server/services/evidenceService.ts';
import { LocationInfo } from '../src/types.ts';

async function runTest() {
  console.log('=== Testing ORCA-X Marine Knowledge Corpus & RAG Grounding ===');

  console.log(`[1] Total Corpus Size: ${MARINE_EVIDENCE_CORPUS.length} statutory documents`);
  if (MARINE_EVIDENCE_CORPUS.length < 14) {
    throw new Error(`Expected at least 14 statutory evidence items, found ${MARINE_EVIDENCE_CORPUS.length}`);
  }

  // Verify UUID5 reproducibility simulation
  const dummyLocation: LocationInfo = {
    name: 'Visakhapatnam Outer Harbour',
    state: 'Andhra Pradesh',
    country: 'India',
    latitude: 17.6868,
    longitude: 83.2185,
    regionType: 'coastal_harbor',
  };

  const testQueries = [
    {
      query: 'What is the Coast Guard VHF channel for maritime distress and SAR hotline?',
      expectedId: 'ICG-SAR-SOP-2026-01',
      topic: 'Coast Guard Search and Rescue (SAR)',
    },
    {
      query: 'When is the annual monsoon trawl ban enforced on the East Coast and West Coast?',
      expectedId: 'DAHD-TRAWL-BAN-2026-61',
      topic: 'Monsoon Trawl Ban Regulations',
    },
    {
      query: 'What do IMD port warning signals 3 and 7 mean for fishing boats and harbors?',
      expectedId: 'IMD-PORT-SIGNALS-1TO11',
      topic: 'Cyclone Port Warning Signals (1 to 11)',
    },
    {
      query: 'How do SST thermal fronts and chlorophyll gradients aggregate pelagic fish?',
      expectedId: 'CMFRI-PFZ-PROD-2026-88',
      topic: 'CMFRI Pelagic Fish & Thermal Fronts',
    },
    {
      query: 'What are the seasonal fishing restrictions in Gahirmatha turtle sanctuary and MPAs?',
      expectedId: 'MPA-GEOFENCE-REG-2026',
      topic: 'Marine Protected Area (MPA) Geofences',
    },
    {
      query: 'Why has pelagic sardine and mackerel catch declined near coastal waters?',
      expectedId: 'CMFRI-MFB-2026-108',
      topic: 'Pelagic Productivity Collapse & Hypoxia',
    },
  ];

  console.log('\n[2] Testing Contextual Evidence Retrieval Grounding:');
  for (const { query, expectedId, topic } of testQueries) {
    const results = retrieveEvidence(query, dummyLocation, 'MODERATE');
    const topMatch = results[0];
    const foundRank = results.findIndex((item) => item.id === expectedId);

    if (foundRank === -1) {
      throw new Error(`Failed to retrieve expected document ${expectedId} for query: "${query}"`);
    }

    console.log(`✓ Topic: "${topic}"`);
    console.log(`  Query: "${query}"`);
    console.log(`  Top Match: [${topMatch.id}] "${topMatch.title}" (Score: ${topMatch.relevanceScore})`);
    console.log(`  Target Document [${expectedId}] Rank: #${foundRank + 1}\n`);
  }

  console.log('=== ALL RAG CORPUS EXPANSION & RETRIEVAL TESTS PASSED ===');
}

runTest().catch((err) => {
  console.error('[FAIL] RAG evidence test failed:', err);
  process.exit(1);
});
