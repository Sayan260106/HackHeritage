import { MARINE_EVIDENCE_CORPUS } from '../src/data/coastalData.ts';

const baseUrl = process.env.ORCA_RAG_API_URL || 'http://127.0.0.1:8001';
const response = await fetch(`${baseUrl}/ingest`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ documents: MARINE_EVIDENCE_CORPUS }),
});

const body = await response.text();
if (!response.ok) {
  console.error(body);
  process.exit(1);
}
console.log(body);
