/**
 * Authentic Maritime Boundary and Marine Protected Area Geospatial Datasets for Indian Waters
 * 
 * Sources:
 * 1. UNCLOS / UN Treaty Series:
 *    - Agreement between the Republic of India and the Republic of Sri Lanka on the Boundary in Historic Waters (1974)
 *    - Supplementary Agreement on the Maritime Boundary in the Gulf of Mannar and Bay of Bengal (1976)
 * 2. Permanent Court of Arbitration (PCA) Award:
 *    - Bay of Bengal Maritime Boundary Arbitration between Bangladesh and India (PCA Case No. 2010-16, 7 July 2014)
 * 3. Ministry of Environment, Forest and Climate Change (MoEFCC) / Wildlife Institute of India (WII):
 *    - Gahirmatha Marine Sanctuary Gazette Notification (Odisha Forest Dept) - Olive Ridley Sea Turtle Protection
 *    - Gulf of Mannar Marine National Park & Biosphere Reserve Notification (Tamil Nadu)
 *    - Sundarbans Tiger Reserve Aquatic Buffer & UNESCO World Heritage Site Marine Zone
 */

import { GisGeoJsonFeature } from '../types.ts';

export interface MaritimeBoundaryDataset {
  id: string;
  name: string;
  countryPair: string;
  type: 'IMBL' | 'MPA' | 'RESTRICTED_ZONE';
  legalAuthority: string;
  enactedYear: number;
  description: string;
  coordinates: [number, number][]; // [lon, lat] in GeoJSON standard
  enforcementNotice: string;
}

export interface MarineProtectedAreaDataset {
  id: string;
  name: string;
  state: string;
  type: 'MPA' | 'BIOSPHERE_RESERVE' | 'TURTLE_SANCTUARY';
  legalAuthority: string;
  description: string;
  polygon: [number, number][]; // [lon, lat] closed loop
  prohibitedActivities: string[];
  conservationTarget: string;
}

/**
 * Authentic International Maritime Boundary Lines (IMBL)
 * Coordinates in [Longitude, Latitude] (EPSG:4326 GeoJSON standard)
 */
export const AUTHENTIC_IMBL_BOUNDARIES: MaritimeBoundaryDataset[] = [
  {
    id: 'imbl-india-srilanka',
    name: 'India – Sri Lanka International Maritime Boundary Line (IMBL)',
    countryPair: 'India - Sri Lanka',
    type: 'IMBL',
    legalAuthority: '1974 & 1976 Bilateral Treaties (UN Treaty Series Nos. 14139 & 15833)',
    enactedYear: 1976,
    description: 'Bilateral maritime delimitation dividing territorial waters and EEZ across Palk Strait, Palk Bay, Adam\'s Bridge, and Gulf of Mannar.',
    coordinates: [
      // Palk Strait to Bay of Bengal (North to South)
      [80.0500, 10.0833], // Pt 1
      [79.9333, 9.9833],  // Pt 2
      [79.5500, 9.6917],  // Pt 3
      [79.4083, 9.5917],  // Pt 4
      [79.2167, 9.4250],  // Pt 5 (Palk Bay narrow)
      [79.3767, 9.1750],  // Pt 6
      [79.4467, 9.1000],  // Pt 7 (Adam\'s Bridge / Talaimannar line)
      [79.5217, 9.0000],  // Pt 8 (Entering Gulf of Mannar)
      [79.6600, 8.8967],  // Pt 9
      [79.3033, 8.6667],  // Pt 10
      [79.2167, 8.6200],  // Pt 11
      [79.0783, 8.5200],  // Pt 12
      [78.9233, 8.3700],  // Pt 13
      [78.8950, 8.2033],  // Pt 14
      [78.3533, 7.5883],  // Pt 15 (Deep Gulf of Mannar)
      [78.1333, 7.1667],  // Pt 16
      [78.0000, 6.5000],  // Pt 17
      [77.1767, 5.0000]   // Pt 18 (Indian Ocean High Seas tri-junction)
    ],
    enforcementNotice: 'Strictly monitored by Indian Coast Guard and Sri Lanka Navy. Crossing causes international arrest and craft impoundment.'
  },
  {
    id: 'imbl-india-bangladesh',
    name: 'India – Bangladesh Maritime Boundary (PCA 2014 Delimitation)',
    countryPair: 'India - Bangladesh',
    type: 'IMBL',
    legalAuthority: 'Permanent Court of Arbitration (PCA) Award, The Hague, 7 July 2014',
    enactedYear: 2014,
    description: 'Sovereign maritime delimitation line established by PCA arbitral award beginning from Raimangal / Haribhanga river estuary extending into Bay of Bengal EEZ.',
    coordinates: [
      [89.1447, 21.6511], // Point 1 (Land boundary terminus / Haribhanga estuary)
      [89.2497, 21.4450], // Point 2
      [89.2322, 21.1289], // Point 3
      [89.1850, 20.3814], // Point 4
      [89.2031, 19.8836], // Point 5
      [89.3633, 18.2650], // Point 6
      [89.4325, 17.8242], // Point 7
      [89.4325, 16.7244], // Point 8
      [89.4325, 15.4064], // Point 9
      [89.4325, 14.1667]  // Point 10 (Bay of Bengal Outer EEZ)
    ],
    enforcementNotice: 'Monitored by Indian Coast Guard (North East Regional HQ, Kolkata) and Bangladesh Coast Guard. Unauthorized fishing is subject to international maritime apprehension.'
  },
  {
    id: 'imbl-india-pakistan',
    name: 'India – Pakistan Arabian Sea Maritime Delimitation / Notional Border',
    countryPair: 'India - Pakistan',
    type: 'IMBL',
    legalAuthority: 'UNCLOS Equidistance Principle & Sir Creek Hydrographic Surveys',
    enactedYear: 2007,
    description: 'Arabian Sea notional boundary line extending seaward from Sir Creek estuary off the coast of Kutch, Gujarat into the northern Arabian Sea.',
    coordinates: [
      [68.0500, 23.6167], // Sir Creek mouth
      [67.8167, 23.5167], // Point 2
      [67.4167, 23.3000], // Point 3
      [66.6667, 22.8333], // Point 4
      [65.9167, 22.2500], // Point 5
      [65.0000, 21.5000]  // Arabian Sea EEZ line
    ],
    enforcementNotice: 'High-risk security zone patrolled by Indian Coast Guard (North-West Region) and Pakistan Maritime Security Agency (PMSA). Incursions carry extreme risk of vessel seizure.'
  }
];

/**
 * Authentic Marine Protected Areas (MPAs) & Ecological Sanctuaries
 * Coordinates in [Longitude, Latitude] (EPSG:4326 GeoJSON standard closed polygons)
 */
export const AUTHENTIC_MPAS: MarineProtectedAreaDataset[] = [
  {
    id: 'mpa-gahirmatha',
    name: 'Gahirmatha Marine Wildlife Sanctuary',
    state: 'Odisha',
    type: 'TURTLE_SANCTUARY',
    legalAuthority: 'Govt of Odisha Forest Dept Gazette Notification No. 18805/F&E (1997)',
    description: 'World\'s largest mass nesting rookery for vulnerable Olive Ridley Sea Turtles (Lepidochelys olivacea). Complete seasonal fishing ban applies within 20 km of shoreline between Dhamra and Mahanadi river mouths.',
    polygon: [
      [86.9500, 20.8000], // Dhamra river mouth (North-West)
      [87.2000, 20.8000], // Offshore North-East limit (20km offshore)
      [87.1200, 20.3000], // Offshore South-East limit
      [86.7500, 20.3000], // Mahanadi / Hukitola mouth (South-West)
      [86.8800, 20.5500], // Coastline along Wheeler / APJ Abdul Kalam Island
      [86.9500, 20.8000]  // Closing back to Dhamra
    ],
    prohibitedActivities: [
      'Mechanized trawling and gillnetting strictly prohibited (Nov 1 - May 31)',
      'TED (Turtle Excluder Device) mandatory for all licensed artisanal boats',
      'Artificial high-intensity lights prohibited within 10km of coast'
    ],
    conservationTarget: 'Olive Ridley Sea Turtles (Arribada mass nesting) & Irrawaddy Dolphins'
  },
  {
    id: 'mpa-gulf-of-mannar',
    name: 'Gulf of Mannar Marine National Park & Biosphere Reserve',
    state: 'Tamil Nadu',
    type: 'BIOSPHERE_RESERVE',
    legalAuthority: 'Govt of Tamil Nadu G.O. Ms. No. 962 / UNESCO MAB Reserve (1989)',
    description: 'Ecologically pristine chain of 21 core islands with rich coral reef ecosystems, seagrass meadows, and primary habitat for the endangered Dugong (sea cow).',
    polygon: [
      [79.2500, 9.2700], // Pamban / Mandapam North Island
      [79.3500, 9.1500], // Shingle & Krusadai Island outer reef
      [79.1000, 8.9500], // Kilakarai group outer reef
      [78.6000, 8.7000], // Vembar group outer reef
      [78.2500, 8.6500], // Tuticorin / Kasuwar island offshore
      [78.1800, 8.8000], // Tuticorin coast
      [78.5000, 9.0500], // Coastal return Mandapam
      [79.1200, 9.2500], // Mandapam mainland
      [79.2500, 9.2700]  // Closing polygon
    ],
    prohibitedActivities: [
      'Pair trawling and purse seining strictly banned year-round',
      'Coral reef extraction, destructive blast/dynamite fishing strictly prohibited',
      'Anchoring on live coral reefs banned; moorings mandatory'
    ],
    conservationTarget: 'Dugong dugon (Sea Cow), Scleractinian Corals, Seagrass Beds'
  },
  {
    id: 'mpa-sundarbans-aquatic',
    name: 'Sundarbans Biosphere Reserve Marine Buffer Zone',
    state: 'West Bengal',
    type: 'BIOSPHERE_RESERVE',
    legalAuthority: 'UNESCO World Heritage / MoEFCC Biosphere Reserve Notification',
    description: 'Largest contiguous mangrove delta on Earth. Estuarine waters harbour Gangetic dolphins, fishing cats, estuarine crocodiles, and critical fish nursery grounds.',
    polygon: [
      [88.1000, 21.6000], // Sagar Island / Muriganga river mouth
      [89.1000, 21.6500], // Haribhanga estuary mouth (Border with Bangladesh)
      [89.0500, 21.2500], // Bay of Bengal outer buffer
      [88.1000, 21.2500], // South-Western marine buffer
      [88.1000, 21.6000]  // Closing loop
    ],
    prohibitedActivities: [
      'Trawling in core mangrove creeks strictly banned',
      'Fine mesh (mosquito net) monofilament wild shrimp seed collection banned',
      'Entry into Core Area without Forest Dept permits strictly prohibited'
    ],
    conservationTarget: 'Platanista gangetica (Gangetic Dolphin), Mangrove Nursery, Royal Bengal Tiger aquatic zone'
  }
];

/**
 * Converts authentic IMBL lines and MPA polygons into standard GeoJSON features
 * ready for rendering in Leaflet.
 */
export function generateMaritimeGeoJsonFeatures(): GisGeoJsonFeature[] {
  const features: GisGeoJsonFeature[] = [];

  // 1. Add IMBL Lines
  for (const imbl of AUTHENTIC_IMBL_BOUNDARIES) {
    features.push({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: imbl.coordinates
      },
      properties: {
        name: imbl.name,
        category: 'international_boundary' as any,
        description: `${imbl.description} Authority: ${imbl.legalAuthority}. ${imbl.enforcementNotice}`,
        color: '#f43f5e', // High visibility crimson/rose border line
        details: {
          boundaryId: imbl.id,
          countryPair: imbl.countryPair,
          legalAuthority: imbl.legalAuthority,
          enactedYear: imbl.enactedYear,
          enforcementNotice: imbl.enforcementNotice
        }
      }
    });

    // Add mid-point border marker tags
    const midIdx = Math.floor(imbl.coordinates.length / 2);
    const midCoord = imbl.coordinates[midIdx];
    features.push({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: midCoord
      },
      properties: {
        name: `IMBL Marker: ${imbl.countryPair}`,
        category: 'international_boundary' as any,
        description: `International Maritime Boundary Line: ${imbl.legalAuthority}`,
        color: '#ef4444',
        details: {
          markerType: 'BORDER_BUOY',
          countryPair: imbl.countryPair
        }
      }
    });
  }

  // 2. Add MPA Polygons
  for (const mpa of AUTHENTIC_MPAS) {
    features.push({
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [mpa.polygon]
      },
      properties: {
        name: mpa.name,
        category: 'marine_protected_area' as any,
        description: `${mpa.description} Conservation focus: ${mpa.conservationTarget}. Regulations: ${mpa.prohibitedActivities.join('; ')}`,
        color: '#10b981', // Emerald conservation green
        details: {
          mpaId: mpa.id,
          state: mpa.state,
          conservationTarget: mpa.conservationTarget,
          legalAuthority: mpa.legalAuthority,
          prohibitions: mpa.prohibitedActivities
        }
      }
    });
  }

  return features;
}
