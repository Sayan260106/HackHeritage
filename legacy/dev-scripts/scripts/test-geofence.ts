import assert from 'node:assert/strict';
import { analyzeMaritimeGeofencing, haversineDistanceKm } from '../server/services/geofenceService.ts';
import { AUTHENTIC_IMBL_BOUNDARIES, AUTHENTIC_MPAS, generateMaritimeGeoJsonFeatures } from '../src/data/maritimeBoundaries.ts';

console.log('--- Testing ORCA-X Authentic Maritime Geofence Engine ---');

// 1. Verify Authentic Datasets
assert.equal(AUTHENTIC_IMBL_BOUNDARIES.length, 3, 'Should have 3 authentic IMBL lines');
assert.equal(AUTHENTIC_MPAS.length, 3, 'Should have 3 authentic MPA zones');

const geoFeatures = generateMaritimeGeoJsonFeatures();
assert.ok(geoFeatures.length >= 6, 'Should generate GeoJSON boundary and marker features');
console.log(`✓ GeoJSON Boundary features verified: ${geoFeatures.length} features generated`);

// 2. Test Dhanushkodi / Palk Strait point close to India - Sri Lanka IMBL
// Coordinates: 9.1600°N, 79.4300°E (approx 3-5 km from treaty line in Palk Bay)
const dhanushkodi = analyzeMaritimeGeofencing(9.1600, 79.4300);
console.log(`Dhanushkodi Analysis:`, {
  status: dhanushkodi.status,
  nearestImbl: dhanushkodi.nearestImbl?.boundaryName,
  distanceNm: dhanushkodi.nearestImbl?.distanceNm,
  severity: dhanushkodi.nearestImbl?.severity
});
assert.ok(dhanushkodi.nearestImbl, 'Should find nearest IMBL for Dhanushkodi');
assert.equal(dhanushkodi.nearestImbl.boundaryId, 'imbl-india-srilanka');
assert.ok(dhanushkodi.nearestImbl.distanceNm < 6.0, 'Dhanushkodi must be within 6 NM of India-Sri Lanka IMBL');
assert.ok(['CRITICAL_BREACH', 'PROXIMITY_WARNING'].includes(dhanushkodi.nearestImbl.severity), 'Must flag warning or critical breach');
console.log(`✓ India-Sri Lanka IMBL proximity verified: ${dhanushkodi.nearestImbl.distanceNm} NM (${dhanushkodi.nearestImbl.severity})`);

// 3. Test Gahirmatha Olive Ridley Turtle Sanctuary Incursion / Proximity
// Coordinates: 20.6000°N, 86.9500°E (directly inside Gahirmatha coastal sanctuary)
const gahirmatha = analyzeMaritimeGeofencing(20.6000, 86.9500);
console.log(`Gahirmatha Analysis:`, {
  status: gahirmatha.status,
  nearestMpa: gahirmatha.nearestMpa?.boundaryName,
  isInside: gahirmatha.nearestMpa?.isInside,
  insideDepthNm: gahirmatha.nearestMpa?.insideDepthNm,
  escapeBearingDeg: gahirmatha.nearestMpa?.escapeBearingDeg,
  severity: gahirmatha.nearestMpa?.severity
});
assert.ok(gahirmatha.nearestMpa, 'Should find Gahirmatha MPA');
assert.equal(gahirmatha.nearestMpa.boundaryId, 'mpa-gahirmatha');
assert.equal(gahirmatha.nearestMpa.isInside, true, 'Should detect inside Gahirmatha Marine Sanctuary');
assert.ok(gahirmatha.nearestMpa.insideDepthNm! > 0, 'Incursion depth must be > 0 (not 0.0)');
assert.ok(gahirmatha.nearestMpa.escapeBearingDeg !== undefined, 'Must provide escape bearing');
assert.equal(gahirmatha.nearestMpa.severity, 'CRITICAL_BREACH');
console.log(`✓ Gahirmatha Marine Sanctuary incursion detection verified: ${gahirmatha.nearestMpa.insideDepthNm} NM deep, escape heading ${gahirmatha.nearestMpa.escapeBearingDeg}°`);

// 3B. Test Sundarbans Biosphere Reserve Incursion
// Coordinates: 21.4500°N, 88.6000°E (deep inside Sundarbans aquatic buffer)
const sundarbans = analyzeMaritimeGeofencing(21.4500, 88.6000);
console.log(`Sundarbans Incursion Analysis:`, {
  status: sundarbans.status,
  nearestMpa: sundarbans.nearestMpa?.boundaryName,
  isInside: sundarbans.nearestMpa?.isInside,
  insideDepthNm: sundarbans.nearestMpa?.insideDepthNm,
  escapeBearingDeg: sundarbans.nearestMpa?.escapeBearingDeg,
  severity: sundarbans.nearestMpa?.severity
});
assert.ok(sundarbans.nearestMpa, 'Should find Sundarbans MPA');
assert.equal(sundarbans.nearestMpa.boundaryId, 'mpa-sundarbans-aquatic');
assert.equal(sundarbans.nearestMpa.isInside, true, 'Should detect inside Sundarbans');
assert.ok(sundarbans.nearestMpa.insideDepthNm! > 0, 'Sundarbans incursion depth must be > 0 NM (never 0.0)');
assert.ok(sundarbans.nearestMpa.escapeBearingDeg !== undefined, 'Sundarbans must provide escape bearing');
assert.equal(sundarbans.nearestMpa.severity, 'CRITICAL_BREACH');
console.log(`✓ Sundarbans Marine Reserve incursion detection verified: ${sundarbans.nearestMpa.insideDepthNm} NM deep, escape heading ${sundarbans.nearestMpa.escapeBearingDeg}°`);

// 4. Test Digha Coast (Safe from Sri Lanka IMBL, computes distance to Bangladesh IMBL)
const digha = analyzeMaritimeGeofencing(21.6266, 87.5074);
console.log(`Digha Analysis:`, {
  status: digha.status,
  nearestImbl: digha.nearestImbl?.boundaryName,
  distanceNm: digha.nearestImbl?.distanceNm,
  nearestMpa: digha.nearestMpa?.boundaryName,
  distanceMpaNm: digha.nearestMpa?.distanceNm
});
assert.ok(digha.nearestImbl, 'Should compute nearest IMBL for Digha');
assert.equal(digha.nearestImbl.boundaryId, 'imbl-india-bangladesh');
assert.ok(digha.nearestImbl.distanceNm > 50, 'Digha should be well clear (>50 NM) of Bangladesh IMBL');
console.log(`✓ Digha coastal distance to Bangladesh IMBL verified: ${digha.nearestImbl.distanceNm} NM (SAFE)`);

// 5. Test Gujarat / Jakhau Port Proximity to India - Pakistan Line
// Coordinates: 23.2000°N, 68.3000°E
const jakhau = analyzeMaritimeGeofencing(23.2000, 68.3000);
console.log(`Jakhau Analysis:`, {
  nearestImbl: jakhau.nearestImbl?.boundaryName,
  distanceNm: jakhau.nearestImbl?.distanceNm,
  hasCrossedBorder: jakhau.nearestImbl?.hasCrossedBorder,
  severity: jakhau.nearestImbl?.severity
});
assert.ok(jakhau.nearestImbl, 'Should compute India-Pakistan IMBL for Jakhau');
assert.equal(jakhau.nearestImbl.boundaryId, 'imbl-india-pakistan');
assert.equal(jakhau.nearestImbl.hasCrossedBorder, false, 'Jakhau is on Indian side of line');
console.log(`✓ India-Pakistan Arabian Sea border distance verified: ${jakhau.nearestImbl.distanceNm} NM`);

// 6. Test International Border Crossing (Vessel crossing into foreign waters)
// 6A. Bangladesh foreign waters: 21.3000°N, 89.6000°E (East of PCA delimitation line)
const bangladeshCrossed = analyzeMaritimeGeofencing(21.3000, 89.6000);
assert.equal(bangladeshCrossed.nearestImbl?.hasCrossedBorder, true, 'Should detect crossed Bangladesh border');
assert.equal(bangladeshCrossed.nearestImbl?.severity, 'CRITICAL_BREACH');
assert.ok(bangladeshCrossed.inRestrictedWaters, 'Crossing border must set inRestrictedWaters true');
console.log(`✓ Crossed into Bangladesh waters verified: ${bangladeshCrossed.nearestImbl?.distanceNm} NM inside, return heading ${bangladeshCrossed.nearestImbl?.bearingDeg}°`);

// 6B. Sri Lanka foreign waters: 9.5000°N, 79.8000°E (East of Palk Bay line)
const srilankaCrossed = analyzeMaritimeGeofencing(9.5000, 79.8000);
assert.equal(srilankaCrossed.nearestImbl?.hasCrossedBorder, true, 'Should detect crossed Sri Lanka border');
assert.equal(srilankaCrossed.nearestImbl?.severity, 'CRITICAL_BREACH');
console.log(`✓ Crossed into Sri Lanka waters verified: ${srilankaCrossed.nearestImbl?.distanceNm} NM inside, return heading ${srilankaCrossed.nearestImbl?.bearingDeg}°`);

// 6C. Pakistan foreign waters: 23.8000°N, 67.5000°E (North/West of Sir Creek line)
const pakistanCrossed = analyzeMaritimeGeofencing(23.8000, 67.5000);
assert.equal(pakistanCrossed.nearestImbl?.hasCrossedBorder, true, 'Should detect crossed Pakistan border');
assert.equal(pakistanCrossed.nearestImbl?.severity, 'CRITICAL_BREACH');
console.log(`✓ Crossed into Pakistan waters verified: ${pakistanCrossed.nearestImbl?.distanceNm} NM inside, return heading ${pakistanCrossed.nearestImbl?.bearingDeg}°`);

console.log('--- ALL AUTHENTIC MARITIME GEOFENCE TESTS PASSED ---');
