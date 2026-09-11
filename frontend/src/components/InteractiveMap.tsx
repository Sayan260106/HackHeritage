import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import {
  Layers,
  MapPin,
  Eye,
  EyeOff,
  Compass,
  Waves,
  Navigation,
  Anchor,
  Radio,
  Maximize2,
  Minimize2,
  Info,
  ShieldAlert,
  ShieldCheck,
  AlertTriangle
} from 'lucide-react';
import { LocationInfo, GisLayerData, RiskLevel, RiskPrediction, OceanData, LanguageCode, GeofenceSpatialAnalysis, DarkVesselAnalysis, VesselTarget, OilSpillAnalysis, OilSpillEvent } from '../types';
import { COASTAL_LOCATIONS, MULTILINGUAL_DICTIONARY } from '../data/coastalData';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';
import { maritimeSiren } from '../services/audio/maritimeSirenService';
import { voiceWarning } from '../services/audio/voiceWarningService';

interface InteractiveMapProps {
  location: LocationInfo;
  gisLayers: GisLayerData;
  geofenceAnalysis?: GeofenceSpatialAnalysis;
  ocean: OceanData;
  riskLevel: RiskLevel;
  risk?: RiskPrediction;
  safeRoute?: any;
  vesselTraffic?: DarkVesselAnalysis;
  onSelectLocation: (locKey: string) => void;
  onCoordinateClick?: (lat: number, lon: number) => void;
  language: LanguageCode;
}

export const InteractiveMap: React.FC<InteractiveMapProps> = ({
  location,
  gisLayers,
  geofenceAnalysis,
  ocean,
  riskLevel,
  risk,
  safeRoute,
  vesselTraffic,
  onSelectLocation,
  onCoordinateClick,
  language
}) => {
  const outerWrapperRef = useRef<HTMLDivElement>(null);
  const dict = MULTILINGUAL_DICTIONARY[language] || MULTILINGUAL_DICTIONARY.en;
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const satelliteLayerRef = useRef<L.TileLayer | null>(null);
  const seamarksLayerRef = useRef<L.TileLayer | null>(null);
  const geojsonLayerRef = useRef<L.GeoJSON | null>(null);
  const pfzLayerGroupRef = useRef<L.LayerGroup | null>(null);
  const routeLayerGroupRef = useRef<L.LayerGroup | null>(null);
  const vesselLayerGroupRef = useRef<L.LayerGroup | null>(null);
  const oilSpillLayerGroupRef = useRef<L.LayerGroup | null>(null);
  const targetMarkerRef = useRef<L.Marker | null>(null);
  const clickMarkerRef = useRef<L.Marker | null>(null);
  const onCoordinateClickRef = useRef(onCoordinateClick);
  useEffect(() => {
    onCoordinateClickRef.current = onCoordinateClick;
  }, [onCoordinateClick]);

  const [isLocating, setIsLocating] = useState<boolean>(false);
  const [isSatelliteView, setIsSatelliteView] = useState<boolean>(false);
  const [pfzZones, setPfzZones] = useState<any[]>([]);
  const [pfzFrontlines, setPfzFrontlines] = useState<any | null>(null);

  // Safe Routing Navigation State
  const [routeDestination, setRouteDestination] = useState<{ latitude: number; longitude: number; name?: string } | null>(null);
  const [safeRouteResult, setSafeRouteResult] = useState<any | null>(null);
  const [isCalculatingRoute, setIsCalculatingRoute] = useState<boolean>(false);
  const [showSafeRouteLayer, setShowSafeRouteLayer] = useState<boolean>(true);

  // Sync external safe route from Agent execution if available
  useEffect(() => {
    if (safeRoute && safeRoute.status === 'ROUTE_FOUND' && Array.isArray(safeRoute.waypoints) && safeRoute.waypoints.length > 0) {
      setSafeRouteResult(safeRoute);
      if (safeRoute.destination) {
        setRouteDestination(safeRoute.destination);
      }
    }
  }, [safeRoute]);

  // Global callbacks for leaflet popups (relocate boat, plot safe route & dispatch Coast Guard warning)
  useEffect(() => {
    (window as any).__orcaSetBoatLocation = (lat: number, lon: number) => {
      if (onCoordinateClickRef.current) {
        onCoordinateClickRef.current(lat, lon);
      }
    };
    (window as any).__orcaPlotRouteTo = (lat: number, lon: number, name?: string) => {
      setRouteDestination({ latitude: lat, longitude: lon, name });
    };
    (window as any).__orcaDispatchCoastGuardAlert = async (mmsi: string, name: string, lat: number, lon: number, reason: string) => {
      await maritimeSiren.unlock();
      const alertText = `Alert Coast Guard Command: Unregistered Dark Vessel target detected at ${lat.toFixed(4)} degrees North, ${lon.toFixed(4)} degrees East. ${reason}`;
      voiceWarning.speak(alertText, language, {
        playSirenFirst: true,
        isCritical: true,
        force: true,
      });

      fetch('/api/alerts/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetType: 'DARK_VESSEL',
          mmsi,
          name,
          latitude: lat,
          longitude: lon,
          reason,
          recipient: 'INDIAN_COAST_GUARD_ICGS_PATROL'
        })
      }).catch(() => { });

      if (onCoordinateClickRef.current) {
        onCoordinateClickRef.current(lat, lon);
      }

      alert(`🚨 COAST GUARD INTERCEPT WARNING DISPATCHED!\n\nTarget: ${name} (${mmsi})\nPosition: ${lat}°N, ${lon}°E\nRecipient: Indian Coast Guard ICGS Patrol Unit\nStatus: Transmitted to Maritime Security Command.\nAudio Siren Activated.`);
    };
    return () => {
      delete (window as any).__orcaSetBoatLocation;
      delete (window as any).__orcaPlotRouteTo;
      delete (window as any).__orcaDispatchCoastGuardAlert;
    };
  }, [language]);

  const handleLocateBoat = () => {
    if (!navigator.geolocation) {
      alert('Geolocation is not supported by your device browser.');
      return;
    }
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setIsLocating(false);
        const lat = Number(pos.coords.latitude.toFixed(4));
        const lon = Number(pos.coords.longitude.toFixed(4));
        if (onCoordinateClickRef.current) {
          onCoordinateClickRef.current(lat, lon);
        }
      },
      (err) => {
        setIsLocating(false);
        alert(`Could not acquire GPS position: ${err.message}. Please enable location permissions.`);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };
  /* Leaflet drives its camera in JS, so no CSS media query can quiet it. */
  const reducedMotion = usePrefersReducedMotion();

  // Layer toggles state
  const [showHazardZones, setShowHazardZones] = useState<boolean>(true);
  const [showSafeCorridors, setShowSafeCorridors] = useState<boolean>(true);
  const [showBuoys, setShowBuoys] = useState<boolean>(true);
  const [showImbl, setShowImbl] = useState<boolean>(true);
  const [showMpas, setShowMpas] = useState<boolean>(true);
  const [showPfz, setShowPfz] = useState<boolean>(true);
  const [showVessels, setShowVessels] = useState<boolean>(true);
  const [vesselsData, setVesselsData] = useState<DarkVesselAnalysis | null>(null);
  const [showOilSpills, setShowOilSpills] = useState<boolean>(true);
  const [oilSpillsData, setOilSpillsData] = useState<OilSpillAnalysis | null>(null);
  const [showSstOverlay, setShowSstOverlay] = useState<boolean>(true);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  // Fetch live satellite oil spill analysis (NASA EONET & Copernicus STAC)
  useEffect(() => {
    let isMounted = true;
    fetch('/api/gis/oil-spills', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ latitude: location.latitude, longitude: location.longitude })
    })
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (isMounted && data && Array.isArray(data.events)) {
          setOilSpillsData(data);
        }
      })
      .catch(err => console.error('Failed to fetch live oil spill satellite data:', err));

    return () => { isMounted = false; };
  }, [location.latitude, location.longitude]);

  // Synchronize vessel traffic from Agentic Brain analysis or fetch live AIS & SAR data
  useEffect(() => {
    if (vesselTraffic && Array.isArray(vesselTraffic.targetVessels) && vesselTraffic.targetVessels.length > 0) {
      setVesselsData(vesselTraffic);
      return;
    }
    let isMounted = true;
    fetch(`/api/vessels/live?lat=${location.latitude}&lon=${location.longitude}`)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (isMounted && data && Array.isArray(data.targetVessels)) {
          setVesselsData(data);
        }
      })
      .catch(err => console.error('Failed to fetch live AIS vessel traffic:', err));

    return () => { isMounted = false; };
  }, [location.latitude, location.longitude, vesselTraffic]);

  // Fetch live statutory INCOIS PFZ satellite analysis for current location
  useEffect(() => {
    let isMounted = true;
    fetch('/api/pfz/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        latitude: location.latitude,
        longitude: location.longitude,
        query: location.name
      })
    })
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (isMounted && data) {
          if (Array.isArray(data.zones)) {
            setPfzZones(data.zones);
          }
          if (data.frontlines) {
            setPfzFrontlines(data.frontlines);
          }
        }
      })
      .catch(err => console.error('Failed to fetch real-time PFZ satellite zones:', err));

    // Also fetch full daily statutory frontlines GeoJSON if not yet populated
    fetch('/api/pfz/frontlines')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (isMounted && data?.features) {
          setPfzFrontlines(data);
        }
      })
      .catch(() => { });

    return () => { isMounted = false; };
  }, [location.latitude, location.longitude, location.name]);

  // Fetch dynamic conflict-free safe navigation route
  useEffect(() => {
    if (!routeDestination) {
      setSafeRouteResult(null);
      return;
    }

    let isMounted = true;
    setIsCalculatingRoute(true);

    fetch('/api/routing/safe-route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        origin: { latitude: location.latitude, longitude: location.longitude },
        destination: { latitude: routeDestination.latitude, longitude: routeDestination.longitude },
        riskLevel: riskLevel
      })
    })
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (isMounted) {
          setIsCalculatingRoute(false);
          if (data) setSafeRouteResult(data);
        }
      })
      .catch(err => {
        if (isMounted) {
          setIsCalculatingRoute(false);
          console.error('Failed to calculate safe navigation route:', err);
        }
      });

    return () => { isMounted = false; };
  }, [location.latitude, location.longitude, routeDestination, riskLevel]);

  // Native Fullscreen API Handler
  const toggleFullscreen = () => {
    const container = outerWrapperRef.current;
    if (!container) return;

    if (!document.fullscreenElement) {
      if (container.requestFullscreen) {
        container.requestFullscreen().catch(() => setIsFullscreen(true));
      } else {
        setIsFullscreen(true);
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => setIsFullscreen(false));
      } else {
        setIsFullscreen(false);
      }
    }
  };

  // Fullscreen Change Event Listener
  useEffect(() => {
    const handleFSChange = () => {
      const isFS = Boolean(document.fullscreenElement);
      setIsFullscreen(isFS);
      const map = mapInstanceRef.current;
      if (map) {
        setTimeout(() => map.invalidateSize(), 50);
        setTimeout(() => map.invalidateSize(), 200);
      }
    };

    document.addEventListener('fullscreenchange', handleFSChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFSChange);
    };
  }, []);

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        center: [location.latitude, location.longitude],
        zoom: 11,
        zoomControl: false,
        attributionControl: true
      });

      // OpenStreetMap Detailed Map Engine (Google Maps-level details: cities, towns, villages, beaches, ports, roads)
      const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        subdomains: ['a', 'b', 'c'],
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      }).addTo(map);
      tileLayerRef.current = osmLayer;

      // Force Leaflet to recalculate container size immediately
      requestAnimationFrame(() => map.invalidateSize());
      setTimeout(() => map.invalidateSize(), 200);

      // Custom Zoom control in bottom right
      L.control.zoom({ position: 'bottomright' }).addTo(map);

      // Click event for custom coordinate selection with immediate marker feedback
      map.on('click', (e: L.LeafletMouseEvent) => {
        const lat = Number(e.latlng.lat.toFixed(4));
        const lon = Number(e.latlng.lng.toFixed(4));

        if (clickMarkerRef.current) {
          map.removeLayer(clickMarkerRef.current);
        }

        const clickIcon = L.divIcon({
          className: 'custom-click-marker',
          html: `
            <div class="relative flex items-center justify-center">
              <div class="absolute w-8 h-8 rounded-full bg-cyan-400/50 animate-ping"></div>
              <div class="w-7 h-7 rounded-full bg-cyan-500 flex items-center justify-center shadow-lg border-2 border-white text-white font-bold text-xs">
                ⚓
              </div>
            </div>
          `,
          iconSize: [28, 28],
          iconAnchor: [14, 14]
        });

        const newMarker = L.marker([lat, lon], { icon: clickIcon })
          .addTo(map)
          .bindPopup(`
            <div class="p-2 space-y-1.5 min-w-[190px]">
              <div class="font-bold text-cyan-300 text-xs flex items-center gap-1">
                <span>📍 Map Location Selected</span>
              </div>
              <div class="text-[11px] font-mono text-slate-200">${lat.toFixed(4)}°N, ${lon.toFixed(4)}°E</div>
              <div class="pt-1 border-t border-slate-700 space-y-1">
                <button 
                  onclick="window.__orcaSetBoatLocation && window.__orcaSetBoatLocation(${lat}, ${lon})"
                  class="w-full py-1 px-2 rounded bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-[10px] flex items-center justify-center gap-1 shadow cursor-pointer transition-all"
                >
                  ⚓ Set Boat Position Here
                </button>
                <button 
                  onclick="window.__orcaPlotRouteTo && window.__orcaPlotRouteTo(${lat}, ${lon}, 'Custom Target Point')"
                  class="w-full py-1 px-2 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[10px] flex items-center justify-center gap-1 shadow cursor-pointer transition-all"
                >
                  🧭 Plot Safe Route to Here
                </button>
              </div>
            </div>
          `)
          .openPopup();

        clickMarkerRef.current = newMarker;

        if (onCoordinateClickRef.current) {
          onCoordinateClickRef.current(lat, lon);
        }
      });

      mapInstanceRef.current = map;
    }

    return () => {
      // The console now unmounts whenever the operator returns to the brief, so
      // this teardown is load-bearing: without it every visit leaks a live map,
      // its tile layer and its DOM listeners.
      if (clickMarkerRef.current) {
        mapInstanceRef.current?.removeLayer(clickMarkerRef.current);
        clickMarkerRef.current = null;
      }
      mapInstanceRef.current?.remove();
      mapInstanceRef.current = null;
      geojsonLayerRef.current = null;
      targetMarkerRef.current = null;
    };
  }, []);

  // Toggle Real High-Resolution Optical Satellite Imagery Base Layer
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (isSatelliteView) {
      if (tileLayerRef.current && map.hasLayer(tileLayerRef.current)) {
        map.removeLayer(tileLayerRef.current);
      }
      if (!satelliteLayerRef.current) {
        satelliteLayerRef.current = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
          maxZoom: 19,
          attribution: 'Satellite Imagery &copy; Esri, Maxar, Earthstar Geographics, CNES/Airbus DS, USDA, USGS, AeroGRID, IGN'
        });
      }
      if (!map.hasLayer(satelliteLayerRef.current)) {
        satelliteLayerRef.current.addTo(map);
      }
      if (!seamarksLayerRef.current) {
        seamarksLayerRef.current = L.tileLayer('https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png', {
          maxZoom: 18,
          opacity: 0.85,
          attribution: '&copy; OpenSeaMap contributors'
        });
      }
      if (!map.hasLayer(seamarksLayerRef.current)) {
        seamarksLayerRef.current.addTo(map);
      }
    } else {
      if (satelliteLayerRef.current && map.hasLayer(satelliteLayerRef.current)) {
        map.removeLayer(satelliteLayerRef.current);
      }
      if (seamarksLayerRef.current && map.hasLayer(seamarksLayerRef.current)) {
        map.removeLayer(seamarksLayerRef.current);
      }
      if (tileLayerRef.current && !map.hasLayer(tileLayerRef.current)) {
        tileLayerRef.current.addTo(map);
      }
    }
  }, [isSatelliteView]);

  // Update map view when location changes
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    if (reducedMotion) {
      mapInstanceRef.current.setView([location.latitude, location.longitude], 11, {
        animate: false
      });
      return;
    }
    mapInstanceRef.current.flyTo([location.latitude, location.longitude], 11, {
      duration: 1.2,
      easeLinearity: 0.25
    });
  }, [location.latitude, location.longitude, reducedMotion]);

  // Handle container resize & visibility changes with ResizeObserver & window resize events
  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container) return;

    const handleResize = () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.invalidateSize({ animate: false });
      }
    };

    // Immediately trigger invalidateSize
    handleResize();

    // Observe element dimensions for layout changes (e.g. flex expansion or tab switch)
    const observer = new ResizeObserver(handleResize);
    observer.observe(container);

    // Also listen to window resize events
    window.addEventListener('resize', handleResize);

    // Staggered invalidations for CSS & Framer Motion transitions
    const t1 = setTimeout(handleResize, 100);
    const t2 = setTimeout(handleResize, 300);
    const t3 = setTimeout(handleResize, 600);
    const t4 = setTimeout(handleResize, 1000);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', handleResize);
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
    };
  }, [isFullscreen, location]);

  // Render GeoJSON layers & markers
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    // Remove previous geojson layers
    if (geojsonLayerRef.current) {
      map.removeLayer(geojsonLayerRef.current);
    }
    if (targetMarkerRef.current) {
      map.removeLayer(targetMarkerRef.current);
    }

    // Add main location focal marker
    const mainIcon = L.divIcon({
      className: 'custom-anchor-marker',
      html: `
        <div class="relative flex items-center justify-center">
          <div class="absolute w-8 h-8 rounded-full ${riskLevel === 'EXTREME' || riskLevel === 'HIGH' ? 'bg-red-500/30 animate-ping' : 'bg-cyan-500/30 animate-ping'}"></div>
          <div class="w-7 h-7 rounded-full ${riskLevel === 'EXTREME' ? 'bg-red-600' : riskLevel === 'HIGH' ? 'bg-rose-600' : riskLevel === 'MODERATE' ? 'bg-amber-500' : 'bg-cyan-500'} flex items-center justify-center shadow-lg border-2 border-white text-white font-bold text-xs">
            ⚓
          </div>
        </div>
      `,
      iconSize: [28, 28],
      iconAnchor: [14, 14]
    });

    targetMarkerRef.current = L.marker([location.latitude, location.longitude], { icon: mainIcon })
      .addTo(map)
      .bindPopup(`
        <div class="p-2 space-y-1">
          <div class="font-bold text-slate-100 text-sm flex items-center gap-1.5">
            <span>⚓ ${location.name}</span>
          </div>
          <p class="text-xs text-slate-300">${location.nearestPort || 'Harbor Point'} • ${location.regionType}</p>
          <div class="pt-1 flex items-center justify-between text-[11px] border-t border-slate-700 font-mono">
            <span class="text-cyan-400">Hs: ${ocean.waveHeightMeters}m</span>
            <span class="text-amber-400">Risk: ${riskLevel}</span>
          </div>
        </div>
      `);

    // Render GIS GeoJSON Features
    if (gisLayers && gisLayers.features) {
      const geoLayer = L.geoJSON(gisLayers as any, {
        filter: (feature) => {
          const cat = feature.properties.category;
          if (cat === 'hazard_zone' && !showHazardZones) return false;
          if (cat === 'precaution_zone' && !showHazardZones) return false;
          if (cat === 'safe_corridor' && !showSafeCorridors) return false;
          if (cat === 'buoy_station' && !showBuoys) return false;
          if (cat === 'international_boundary' && !showImbl) return false;
          if (cat === 'marine_protected_area' && !showMpas) return false;
          return true;
        },
        style: (feature) => {
          const cat = feature?.properties?.category;
          if (cat === 'international_boundary') {
            return {
              color: '#f43f5e',
              weight: 3.5,
              opacity: 0.95,
              dashArray: '8, 6'
            };
          }
          if (cat === 'marine_protected_area') {
            return {
              color: '#10b981',
              weight: 2,
              opacity: 0.9,
              fillColor: '#059669',
              fillOpacity: 0.22,
              dashArray: '5, 5'
            };
          }
          if (cat === 'hazard_zone') {
            const isHighRisk = feature.properties.riskLevel === 'HIGH' || feature.properties.riskLevel === 'EXTREME';
            return {
              color: isHighRisk ? '#d6453d' : '#f2b33d',
              weight: 2,
              opacity: 0.85,
              fillColor: isHighRisk ? '#a52a24' : '#de9a1f',
              fillOpacity: 0.25,
              dashArray: '5, 5'
            };
          }
          if (cat === 'precaution_zone') {
            return {
              color: '#2c7a97',
              weight: 1.5,
              opacity: 0.7,
              fillColor: '#1e5f7a',
              fillOpacity: 0.15
            };
          }
          if (cat === 'safe_corridor') {
            return {
              color: '#45bb90',
              weight: 3.5,
              opacity: 0.9,
              dashArray: '2, 6'
            };
          }
          return { color: '#4a7189', weight: 1 };
        },
        pointToLayer: (feature, latlng) => {
          const cat = feature.properties.category;
          if (cat === 'international_boundary') {
            const borderIcon = L.divIcon({
              className: 'imbl-marker-icon',
              html: `
                <div class="relative flex items-center justify-center">
                  <div class="w-6 h-6 rounded-full bg-rose-600 border-2 border-white shadow-lg flex items-center justify-center text-[10px] text-white font-bold animate-pulse">
                    ⚓
                  </div>
                </div>
              `,
              iconSize: [22, 22],
              iconAnchor: [11, 11]
            });
            return L.marker(latlng, { icon: borderIcon });
          }
          if (cat === 'buoy_station') {
            const buoyIcon = L.divIcon({
              className: 'buoy-icon',
              html: `
                <div class="relative flex items-center justify-center">
                  <div class="w-5 h-5 rounded-full bg-slate-950 border border-amber-400 shadow-[0_0_12px_rgba(245,158,11,0.8)] flex items-center justify-center text-[10px] text-amber-300 font-mono">
                    📡
                  </div>
                </div>
              `,
              iconSize: [20, 20],
              iconAnchor: [10, 10]
            });
            return L.marker(latlng, { icon: buoyIcon });
          }
          return L.circleMarker(latlng, { radius: 6, color: '#7fd4c1' });
        },
        onEachFeature: (feature, layer) => {
          const p = feature.properties;
          const isBorder = p.category === 'international_boundary';
          const isMpa = p.category === 'marine_protected_area';

          layer.on('click', (e: L.LeafletMouseEvent) => {
            const clickLat = Number(e.latlng.lat.toFixed(4));
            const clickLon = Number(e.latlng.lng.toFixed(4));
            layer.bindPopup(`
              <div class="p-2.5 space-y-2 max-w-[290px]">
                <div class="font-bold ${isBorder ? 'text-rose-400' : isMpa ? 'text-emerald-400' : 'text-slate-100'} text-xs border-b border-slate-700 pb-1 flex items-center gap-1.5">
                  <span>${isBorder ? '🛡️' : isMpa ? '🌿' : '⚓'}</span>
                  <span>${p.name}</span>
                </div>
                <p class="text-xs text-slate-300 leading-relaxed">${p.description}</p>
                ${p.details ? `
                  <div class="text-[11px] font-mono ${isBorder ? 'text-rose-300 bg-rose-950/50 border border-rose-800/60' : isMpa ? 'text-emerald-300 bg-emerald-950/50 border border-emerald-800/60' : 'text-cyan-300 bg-slate-800/80'} p-2 rounded space-y-1">
                    ${Object.entries(p.details).map(([k, v]) => `<div><span class="opacity-75">${k}:</span> <span class="text-slate-100 font-semibold">${Array.isArray(v) ? v.join('; ') : v}</span></div>`).join('')}
                  </div>
                ` : ''}
                <div class="pt-2 border-t border-slate-700/60 space-y-1">
                  <div class="text-[10px] text-slate-400 font-mono">Tapped: ${clickLat}°N, ${clickLon}°E</div>
                  <button 
                    onclick="window.__orcaSetBoatLocation && window.__orcaSetBoatLocation(${clickLat}, ${clickLon})"
                    class="w-full py-1.5 px-2 rounded bg-cyan-600 hover:bg-cyan-500 active:bg-cyan-700 text-white font-bold text-[11px] flex items-center justify-center gap-1 shadow cursor-pointer transition-all"
                  >
                    ⚓ Set Boat Here & Check Distance
                  </button>
                </div>
              </div>
            `).openPopup(e.latlng);
          });
        }
      });

      geoLayer.addTo(map);
      geojsonLayerRef.current = geoLayer;
    }
  }, [gisLayers, location, riskLevel, ocean, showHazardZones, showSafeCorridors, showBuoys, showImbl, showMpas]);

  // Render Real-Time Potential Fishing Zones (PFZ) Layer & INCOIS Satellite Frontlines
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (pfzLayerGroupRef.current) {
      map.removeLayer(pfzLayerGroupRef.current);
      pfzLayerGroupRef.current = null;
    }

    if (!showPfz) return;

    const layerGroup = L.layerGroup();

    // 1. Render Official INCOIS Statutory Frontlines (Illuminated Cyan Polylines)
    if (pfzFrontlines && pfzFrontlines.features && Array.isArray(pfzFrontlines.features) && pfzFrontlines.features.length > 0) {
      const frontlinesLayer = L.geoJSON(pfzFrontlines, {
        style: () => ({
          color: '#06b6d4',
          weight: 3.5,
          opacity: 0.9,
          dashArray: '8, 5',
          lineCap: 'round',
          lineJoin: 'round',
        }),
        onEachFeature: (feature: any, layer: L.Layer) => {
          const props = feature.properties || {};
          const uid = props.UID ?? props.uid ?? 'INCOIS-FRONT';
          const year = props.YEAR ?? props.year ?? '2026';
          const julianDay = props.JULIAN_DAY ?? props.julian_day ?? '';

          let midLat = 0;
          let midLon = 0;
          if (feature.geometry?.coordinates) {
            const coords = feature.geometry.type === 'LineString'
              ? feature.geometry.coordinates
              : Array.isArray(feature.geometry.coordinates?.[0])
                ? feature.geometry.coordinates[0]
                : [];
            if (Array.isArray(coords) && coords.length > 0) {
              const midIdx = Math.floor(coords.length / 2);
              if (Array.isArray(coords[midIdx]) && coords[midIdx].length >= 2) {
                midLon = Number(coords[midIdx][0]);
                midLat = Number(coords[midIdx][1]);
              }
            }
          }

          layer.bindPopup(`
            <div class="p-2.5 space-y-2 max-w-[270px] bg-slate-900 text-slate-100 rounded-lg text-xs font-mono">
              <div class="font-bold text-cyan-300 border-b border-cyan-800/80 pb-1 flex items-center justify-between">
                <span class="flex items-center gap-1">🛰️ INCOIS Satellite Front</span>
                <span class="text-[9px] bg-cyan-950 text-cyan-300 px-1.5 py-0.5 rounded border border-cyan-700/60 font-black">GOVT WFS</span>
              </div>
              <div class="space-y-1 text-[11px] bg-slate-950/80 p-2 rounded border border-slate-800">
                <div class="flex justify-between"><span class="text-slate-400">Front UID:</span> <span class="text-white font-bold">${uid}</span></div>
                <div class="flex justify-between"><span class="text-slate-400">Julian Day:</span> <span class="text-cyan-300 font-semibold">${julianDay} (${year})</span></div>
                <div class="flex justify-between"><span class="text-slate-400">Agency:</span> <span class="text-emerald-400 font-bold">INCOIS / MoES</span></div>
                <div class="flex justify-between"><span class="text-slate-400">Sensors:</span> <span class="text-slate-200">Oceansat / Thermal Comp.</span></div>
              </div>
              <p class="text-[10px] text-slate-300 italic bg-cyan-950/40 p-1.5 rounded border border-cyan-900/60">
                Official statutory thermal/chlorophyll boundary where nutrient upwelling concentrates pelagic fish shoals.
              </p>
              ${midLat !== 0 && midLon !== 0 ? `
                <button
                  onclick="window.__orcaPlotRouteTo && window.__orcaPlotRouteTo(${midLat.toFixed(4)}, ${midLon.toFixed(4)}, 'INCOIS Front ${uid}')"
                  class="w-full mt-1 py-1.5 px-2 bg-gradient-to-r from-cyan-600 to-emerald-600 hover:from-cyan-500 hover:to-emerald-500 text-white font-bold text-[10px] rounded transition-all text-center flex items-center justify-center gap-1 shadow cursor-pointer"
                >
                  🧭 Compute Safe Route to Front
                </button>
              ` : ''}
            </div>
          `);
        }
      });
      frontlinesLayer.addTo(layerGroup);
    }

    // 2. Render PFZ Intercept Zones and Pins
    if (pfzZones && pfzZones.length > 0) {
      pfzZones.forEach((zone: any) => {
        const isHigh = zone.suitability === 'HIGH';
        const isMod = zone.suitability === 'MODERATE';
        const isRestricted = zone.geofenceStatus === 'RESTRICTED';

        const strokeColor = isRestricted ? '#f43f5e' : isHigh ? '#10b981' : isMod ? '#f59e0b' : '#3b82f6';
        const fillColor = isRestricted ? '#9f1239' : isHigh ? '#059669' : isMod ? '#d97706' : '#1d4ed8';

        // Front Intercept Concentric Convergence Circle
        const circle = L.circle([zone.latitude, zone.longitude], {
          radius: isHigh ? 3500 : 2500,
          color: strokeColor,
          weight: isHigh ? 2.5 : 1.5,
          opacity: 0.85,
          fillColor: fillColor,
          fillOpacity: isHigh ? 0.25 : 0.15,
          dashArray: isRestricted ? '5, 5' : undefined
        });

        // Custom Glowing Fish Icon Pin
        const fishIcon = L.divIcon({
          className: 'custom-pfz-marker-icon',
          html: `
            <div class="relative flex items-center justify-center cursor-pointer">
              <div class="absolute w-8 h-8 rounded-full ${isHigh ? 'bg-emerald-500/40 animate-ping' : 'bg-amber-500/30'}"></div>
              <div class="px-2 py-0.5 rounded-full ${isRestricted ? 'bg-rose-700 border-rose-400' : isHigh ? 'bg-emerald-600 border-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.5)]' : 'bg-amber-600 border-amber-300'} border flex items-center gap-1 shadow-xl text-white font-bold text-[10px] whitespace-nowrap">
                <span>🐟</span>
                <span>INCOIS #${zone.rank}</span>
                <span class="font-mono text-[9px] ${isHigh ? 'text-emerald-200' : 'text-amber-200'}">(${zone.score}%)</span>
              </div>
            </div>
          `,
          iconSize: [95, 26],
          iconAnchor: [47, 13]
        });

        const marker = L.marker([zone.latitude, zone.longitude], { icon: fishIcon });

        const popupContent = `
          <div class="p-2.5 space-y-2 max-w-[280px] bg-slate-900 text-slate-100 rounded-lg">
            <div class="flex items-center justify-between border-b border-slate-700/80 pb-1.5">
              <div class="flex items-center gap-1.5 font-bold text-xs text-emerald-400">
                <span>🐟 ${zone.id}</span>
                <span class="text-[10px] text-cyan-300 font-mono">UID: ${zone.incoisUid || 'INCOIS'}</span>
              </div>
              <span class="px-1.5 py-0.5 rounded text-[9px] font-black tracking-wider uppercase ${isRestricted ? 'bg-rose-600 text-white' :
            isHigh ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' :
              'bg-amber-500/20 text-amber-300 border border-amber-500/40'
          }">
                ${zone.suitability}
              </span>
            </div>

            <div class="text-[11px] font-mono space-y-1 bg-slate-950/80 p-2 rounded border border-slate-800">
              <div class="flex justify-between">
                <span class="text-slate-400">Fishing Score:</span>
                <span class="font-bold text-cyan-300">${zone.score}/100</span>
              </div>
              <div class="flex justify-between">
                <span class="text-slate-400">Distance from Port:</span>
                <span class="text-emerald-400 font-bold">${zone.distanceNm ?? '—'} NM (${zone.distanceKm ?? '—'} km)</span>
              </div>
              <div class="flex justify-between">
                <span class="text-slate-400">Compass Bearing:</span>
                <span class="text-amber-300 font-bold">${zone.bearingDeg ?? '—'}°</span>
              </div>
              <div class="flex justify-between">
                <span class="text-slate-400">Front Length:</span>
                <span class="text-cyan-300 font-bold">${zone.frontLengthKm ?? '—'} km</span>
              </div>
              ${zone.sstC !== undefined ? `
                <div class="flex justify-between">
                  <span class="text-slate-400">SST at Front:</span>
                  <span class="text-amber-400 font-bold">${zone.sstC.toFixed(1)}°C</span>
                </div>
              ` : ''}
              <div class="flex justify-between border-t border-slate-800 pt-1">
                <span class="text-slate-400">Geofence Status:</span>
                <span class="font-bold ${zone.geofenceStatus === 'CLEAR' ? 'text-emerald-400' :
            zone.geofenceStatus === 'CAUTION' ? 'text-amber-400' : 'text-red-400'
          }">${zone.geofenceStatus}</span>
              </div>
            </div>

            ${zone.explanations?.[0] ? `
              <p class="text-[10px] text-slate-300 leading-tight italic bg-emerald-950/30 p-1.5 rounded border border-emerald-800/40">
                💡 ${zone.explanations[0]}
              </p>
            ` : ''}

            <div class="text-[9px] text-slate-400 font-mono flex flex-wrap gap-1">
              <span class="text-slate-500">Source:</span>
              <span class="bg-slate-800 px-1 rounded text-cyan-300">INCOIS GeoServer WFS</span>
              <span class="bg-slate-800 px-1 rounded text-emerald-300">Daily Statutory</span>
            </div>

            <div class="grid grid-cols-2 gap-1.5 pt-1">
              <button
                onclick="window.__orcaSetBoatLocation && window.__orcaSetBoatLocation(${zone.latitude}, ${zone.longitude})"
                class="py-1 px-1.5 bg-cyan-700 hover:bg-cyan-600 text-white font-bold text-[10px] rounded transition-all text-center flex items-center justify-center gap-1 shadow cursor-pointer"
              >
                ⚓ Move Boat Here
              </button>
              <button
                onclick="window.__orcaPlotRouteTo && window.__orcaPlotRouteTo(${zone.latitude}, ${zone.longitude}, 'INCOIS Front #${zone.rank}')"
                class="py-1 px-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-[10px] rounded transition-all text-center flex items-center justify-center gap-1 shadow cursor-pointer"
              >
                🧭 Compute Safe Route Here
              </button>
            </div>
          </div>
        `;

        circle.bindPopup(popupContent);
        marker.bindPopup(popupContent);

        circle.addTo(layerGroup);
        marker.addTo(layerGroup);
      });
    }

    layerGroup.addTo(map);
    pfzLayerGroupRef.current = layerGroup;
  }, [showPfz, pfzZones, pfzFrontlines]);

  // Render Dynamic Safe Navigation Polyline & Waypoint Markers
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (routeLayerGroupRef.current) {
      map.removeLayer(routeLayerGroupRef.current);
      routeLayerGroupRef.current = null;
    }

    if (!showSafeRouteLayer || !safeRouteResult || safeRouteResult.status !== 'ROUTE_FOUND' || !safeRouteResult.waypoints || safeRouteResult.waypoints.length === 0) return;

    const layerGroup = L.layerGroup();
    const waypoints = safeRouteResult.waypoints;
    const latLngs = waypoints.map((wp: any) => [wp.latitude, wp.longitude]);

    // 1a. Route Base Glow Halo (Contrasting Outer Shadow / Corridor Casing)
    const haloPolyline = L.polyline(latLngs, {
      color: '#064e3b',
      weight: 8,
      opacity: 0.75,
      lineCap: 'round',
      lineJoin: 'round'
    });
    haloPolyline.addTo(layerGroup);

    // 1b. Safe Navigation Polyline (Vibrant Emerald Glowing Dashed Passage)
    const polyline = L.polyline(latLngs, {
      color: '#10b981',
      weight: 4.5,
      opacity: 0.95,
      dashArray: '8, 8',
      lineCap: 'round',
      lineJoin: 'round'
    });

    const routeDistanceNm = ((safeRouteResult.distanceKm || 0) / 1.852).toFixed(1);
    const routeDirectNm = ((safeRouteResult.directDistanceKm || 0) / 1.852).toFixed(1);

    polyline.bindPopup(`
      <div class="p-2.5 space-y-2 max-w-[280px] bg-slate-900 text-slate-100 rounded-xl font-mono text-xs shadow-2xl border border-emerald-500/50">
        <div class="flex items-center justify-between border-b border-slate-700/80 pb-1.5 font-bold text-emerald-400">
          <span class="flex items-center gap-1.5">🧭 Safe Navigation Route</span>
          <span class="text-[9px] bg-emerald-950 text-emerald-300 px-1.5 py-0.5 rounded border border-emerald-700 font-black">ACTIVE</span>
        </div>
        <div class="space-y-1 text-[11px] bg-slate-950/80 p-2 rounded border border-slate-800">
          <div class="flex justify-between"><span class="text-slate-400">Total Route:</span> <span class="text-emerald-300 font-bold">${routeDistanceNm} NM (${safeRouteResult.distanceKm} km)</span></div>
          <div class="flex justify-between"><span class="text-slate-400">Direct Distance:</span> <span class="text-cyan-300">${routeDirectNm} NM</span></div>
          <div class="flex justify-between"><span class="text-slate-400">Sequenced Waypoints:</span> <span class="text-white font-bold">${waypoints.length} points</span></div>
          ${safeRouteResult.routeEfficiencyPct ? `<div class="flex justify-between"><span class="text-slate-400">Passage Efficiency:</span> <span class="text-amber-300 font-bold">${safeRouteResult.routeEfficiencyPct}%</span></div>` : ''}
          <div class="flex justify-between"><span class="text-slate-400">Geofence Status:</span> <span class="text-emerald-400 font-bold">VERIFIED CLEAR</span></div>
        </div>
        ${safeRouteResult.avoidedConstraints?.length > 0 ? `
          <div class="text-[10px] text-amber-300 bg-amber-950/40 p-1.5 rounded border border-amber-800/40 space-y-0.5">
            <span class="font-bold text-amber-400">Avoided Constraints:</span>
            <div class="text-slate-200">${safeRouteResult.avoidedConstraints.join(', ')}</div>
          </div>
        ` : ''}
        ${safeRouteResult.rationale ? `
          <p class="text-[10px] text-slate-300 italic bg-emerald-950/30 p-1.5 rounded border border-emerald-900/40">
            💡 ${safeRouteResult.rationale}
          </p>
        ` : ''}
      </div>
    `);

    // 2. Waypoint Markers along the route with sequenced bearing and distance tags
    waypoints.forEach((wp: any, idx: number) => {
      const isStart = idx === 0;
      const isEnd = idx === waypoints.length - 1;
      // Keep density balanced for long routes, but always include key inflection nodes
      if (!isStart && !isEnd && idx % 2 !== 0 && waypoints.length > 10) return;

      const cumDistNm = ((wp.cumulativeDistanceKm || 0) / 1.852).toFixed(1);
      const bearingStr = wp.bearingDeg !== undefined ? `${wp.bearingDeg}°` : '—';

      const wpIcon = L.divIcon({
        className: 'custom-wp-marker-icon',
        html: `
          <div class="relative flex items-center justify-center cursor-pointer group">
            <div class="w-6 h-6 rounded-full ${isStart ? 'bg-cyan-600 border-2 border-white shadow-[0_0_12px_rgba(6,182,212,0.8)]' : isEnd ? 'bg-emerald-600 border-2 border-white animate-pulse shadow-[0_0_12px_rgba(16,185,129,0.8)]' : 'bg-slate-800 border-2 border-emerald-400'} shadow-lg flex items-center justify-center text-[10px] text-white font-bold font-mono">
              ${isStart ? '⚓' : isEnd ? '🏁' : idx}
            </div>
            <div class="absolute -bottom-4 hidden group-hover:flex bg-slate-950/90 text-cyan-300 text-[9px] font-mono px-1 rounded border border-cyan-700 whitespace-nowrap shadow-md z-30">
              ${cumDistNm} NM
            </div>
          </div>
        `,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      });

      const marker = L.marker([wp.latitude, wp.longitude], { icon: wpIcon });

      // Hover tooltip showing sequence number, distance, and bearing tag
      marker.bindTooltip(
        isStart
          ? '⚓ Route Origin (Boat)'
          : isEnd
            ? `🏁 Destination • ${cumDistNm} NM`
            : `WP #${idx} • ${cumDistNm} NM • ${bearingStr}`,
        {
          direction: 'top',
          offset: [0, -12],
          className: 'orca-route-tooltip'
        }
      );

      const popupContent = `
        <div class="p-2.5 space-y-2 bg-slate-900 text-slate-100 rounded-xl text-xs font-mono max-w-[250px] shadow-2xl border border-slate-700">
          <div class="font-bold text-emerald-400 border-b border-slate-700 pb-1.5 flex items-center justify-between">
            <span>${isStart ? '⚓ Route Origin (Boat)' : isEnd ? '🏁 Safe Destination' : `Waypoint #${idx}`}</span>
            <span class="text-[10px] text-cyan-300">${wp.latitude.toFixed(3)}°N, ${wp.longitude.toFixed(3)}°E</span>
          </div>
          <div class="space-y-1 text-[11px] bg-slate-950/80 p-2 rounded border border-slate-800">
            <div class="flex justify-between">
              <span class="text-slate-400">Cumulative Distance:</span>
              <span class="font-bold text-cyan-300">${cumDistNm} NM (${(wp.cumulativeDistanceKm || 0).toFixed(1)} km)</span>
            </div>
            ${wp.bearingDeg !== undefined ? `
              <div class="flex justify-between">
                <span class="text-slate-400">Compass Bearing:</span>
                <span class="font-bold text-amber-300">${wp.bearingDeg}°</span>
              </div>
            ` : ''}
            <div class="flex justify-between border-t border-slate-800 pt-1">
              <span class="text-slate-400">Geofence Status:</span>
              <span class="font-bold ${wp.geofenceStatus === 'CLEAR' ? 'text-emerald-400' : 'text-amber-400'}">${wp.geofenceStatus}</span>
            </div>
          </div>
          <div class="pt-1">
            <button
              onclick="window.__orcaSetBoatLocation && window.__orcaSetBoatLocation(${wp.latitude}, ${wp.longitude})"
              class="w-full py-1 px-2 rounded bg-cyan-700 hover:bg-cyan-600 text-white font-bold text-[10px] flex items-center justify-center gap-1 shadow cursor-pointer transition-all"
            >
              ⚓ Set Boat Position Here
            </button>
          </div>
        </div>
      `;

      marker.bindPopup(popupContent);
      marker.addTo(layerGroup);
    });

    polyline.addTo(layerGroup);
    layerGroup.addTo(map);
    routeLayerGroupRef.current = layerGroup;

    // 3. Auto-centering Camera on Origin and Destination Bounds
    if (latLngs.length > 0) {
      try {
        const bounds = L.latLngBounds(latLngs);
        map.fitBounds(bounds, {
          padding: [60, 60],
          maxZoom: 13,
          animate: !reducedMotion,
          duration: 0.8
        });
      } catch (err) {
        console.warn('Could not auto-fit map bounds to safe route:', err);
      }
    }
  }, [showSafeRouteLayer, safeRouteResult, reducedMotion]);

  // Render Real-Time AIS & Sentinel-1 SAR Dark Vessel Layer
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (vesselLayerGroupRef.current) {
      map.removeLayer(vesselLayerGroupRef.current);
      vesselLayerGroupRef.current = null;
    }

    if (!showVessels || !vesselsData?.targetVessels || vesselsData.targetVessels.length === 0) return;

    const layerGroup = L.layerGroup();

    vesselsData.targetVessels.forEach((vessel: VesselTarget) => {
      const isDark = vessel.isDarkVessel;
      const isBuoy = vessel.type === 'OCEANOGRAPHIC_BUOY';

      const iconHtml = isBuoy
        ? `
          <div class="relative flex items-center justify-center cursor-pointer">
            <div class="absolute w-8 h-8 rounded-full bg-amber-400/25 animate-ping"></div>
            <div class="px-2 py-0.5 rounded-full bg-slate-950 border border-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.6)] flex items-center gap-1 shadow-xl text-white font-bold text-[10px] whitespace-nowrap">
              <span>📡</span>
              <span class="font-mono text-[9px] text-amber-300 font-black">${vessel.buoyStationId || vessel.name.split(' ')[0]}</span>
              <span class="font-mono text-[8px] text-cyan-300">${vessel.waveHeightM !== undefined ? `${vessel.waveHeightM}m` : ''}</span>
            </div>
          </div>
        `
        : `
          <div class="relative flex items-center justify-center cursor-pointer">
            <div class="absolute w-9 h-9 rounded-full ${isDark ? 'bg-red-600/40 animate-ping' : 'bg-cyan-500/20'}"></div>
            <div class="px-2 py-0.5 rounded-full ${isDark ? 'bg-red-700 border-red-300 shadow-[0_0_15px_rgba(239,68,68,0.8)]' : 'bg-slate-900 border-cyan-400'} border flex items-center gap-1 shadow-xl text-white font-bold text-[10px] whitespace-nowrap">
              <span>${isDark ? '🚨' : '🚢'}</span>
              <span class="font-mono text-[9px] ${isDark ? 'text-red-100 font-black tracking-wider' : 'text-cyan-200'}">${vessel.name.split(' ')[0]}</span>
              <span class="font-mono text-[8px] opacity-75">(${vessel.speedKts}kts)</span>
            </div>
          </div>
        `;

      const icon = L.divIcon({
        className: 'custom-vessel-marker-icon',
        html: iconHtml,
        iconSize: [100, 26],
        iconAnchor: [50, 13]
      });

      const marker = L.marker([vessel.latitude, vessel.longitude], { icon });

      const popupContent = isBuoy ? `
        <div class="p-2.5 space-y-2 max-w-[290px] bg-slate-900 text-slate-100 rounded-lg">
          <div class="flex items-center justify-between border-b border-slate-700/80 pb-1.5">
            <div class="flex items-center gap-1.5 font-bold text-xs text-amber-300">
              <span>📡 INCOIS MOORED BUOY STATION</span>
            </div>
            <span class="px-1.5 py-0.5 rounded text-[8.5px] font-black font-mono bg-amber-500/20 text-amber-300 border border-amber-500/40">
              ${vessel.buoyStationId || 'MOES'}
            </span>
          </div>

          <div class="text-[11px] font-mono space-y-1 bg-slate-950/90 p-2 rounded border border-slate-800">
            <div class="flex justify-between">
              <span class="text-slate-400">Station Name:</span>
              <span class="font-bold text-slate-100">${vessel.name.replace('📡 ', '')}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-slate-400">Authority:</span>
              <span class="text-slate-300">${vessel.flagState}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-slate-400">Coordinates:</span>
              <span class="text-slate-200 font-bold">${vessel.latitude.toFixed(4)}°N, ${vessel.longitude.toFixed(4)}°E</span>
            </div>
            <div class="flex justify-between border-t border-slate-800/80 pt-1">
              <span class="text-slate-400">Wave Height (Hs):</span>
              <span class="text-cyan-300 font-bold">${vessel.waveHeightM ?? 'N/A'} m</span>
            </div>
            <div class="flex justify-between">
              <span class="text-slate-400">Sea Surface Temp:</span>
              <span class="text-amber-300 font-bold">${vessel.seaSurfaceTempC ?? 'N/A'} °C</span>
            </div>
            <div class="flex justify-between">
              <span class="text-slate-400">Surface Pressure:</span>
              <span class="text-emerald-300 font-bold">${vessel.pressureHpa ?? 'N/A'} hPa</span>
            </div>
            <div class="flex justify-between">
              <span class="text-slate-400">Wind Speed:</span>
              <span class="text-slate-100 font-bold">${vessel.windSpeedKts ?? 'N/A'} kts</span>
            </div>
            <div class="flex justify-between border-t border-slate-800/80 pt-1 text-[10px]">
              <span class="text-slate-400">Distance from Base:</span>
              <span class="text-cyan-400 font-bold">${vessel.distanceFromBoatNm} NM (${vessel.distanceFromBoatKm} km)</span>
            </div>
          </div>

          <div class="pt-1">
            <button
              onclick="window.__orcaSetBoatLocation && window.__orcaSetBoatLocation(${vessel.latitude}, ${vessel.longitude})"
              class="w-full py-1.5 px-2 bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold text-[10px] rounded transition-all text-center flex items-center justify-center gap-1 shadow cursor-pointer"
            >
              ⚓ Center Radar at Buoy Station
            </button>
          </div>
        </div>
      ` : `
        <div class="p-2.5 space-y-2 max-w-[280px] bg-slate-900 text-slate-100 rounded-lg">
          <div class="flex items-center justify-between border-b border-slate-700/80 pb-1.5">
            <div class="flex items-center gap-1.5 font-bold text-xs ${isDark ? 'text-red-400' : 'text-cyan-300'}">
              <span>${isDark ? '🚨 DARK VESSEL DETECTED' : '🚢 AIS BROADCASTING VESSEL'}</span>
            </div>
            <span class="px-1.5 py-0.5 rounded text-[8.5px] font-black uppercase font-mono ${isDark ? 'bg-red-600 text-white animate-pulse' : 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'}">
              ${vessel.aisStatus.replace('_', ' ')}
            </span>
          </div>

          <div class="text-[11px] font-mono space-y-1 bg-slate-950/90 p-2 rounded border ${isDark ? 'border-red-800/80' : 'border-slate-800'}">
            <div class="flex justify-between">
              <span class="text-slate-400">Target ID:</span>
              <span class="font-bold ${isDark ? 'text-red-300' : 'text-slate-100'}">${vessel.name}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-slate-400">MMSI:</span>
              <span class="text-cyan-300 font-bold">${vessel.mmsi}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-slate-400">Flag State:</span>
              <span class="text-slate-200">${vessel.flagState}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-slate-400">Speed / Heading:</span>
              <span class="text-amber-300 font-bold">${vessel.speedKts} kts • ${vessel.headingDeg}°</span>
            </div>
            <div class="flex justify-between border-t border-slate-800 pt-1">
              <span class="text-slate-400">SAR Radar Match:</span>
              <span class="text-emerald-400 font-bold">${vessel.sarDetectionConfidencePct}% Confidence</span>
            </div>
          </div>

          ${isDark ? `
            <div class="p-2 bg-red-950/60 border border-red-800 rounded text-[10px] text-red-200 leading-tight space-y-1">
              <div class="font-bold text-red-400 flex items-center gap-1">
                <span>⚠️ ANOMALY REASON:</span>
              </div>
              <p>${vessel.suspiciousReason}</p>
            </div>
          ` : ''}

          <div class="pt-1">
            <button
              onclick="${isDark ? `window.__orcaDispatchCoastGuardAlert && window.__orcaDispatchCoastGuardAlert('${vessel.mmsi}', '${vessel.name.replace(/'/g, "\\'")}', ${vessel.latitude}, ${vessel.longitude}, '${(vessel.suspiciousReason || 'Unregistered target').replace(/'/g, "\\'")}')` : `window.__orcaSetBoatLocation && window.__orcaSetBoatLocation(${vessel.latitude}, ${vessel.longitude})`}"
              class="w-full py-1.5 px-2 ${isDark ? 'bg-red-700 hover:bg-red-600' : 'bg-cyan-700 hover:bg-cyan-600'} text-white font-bold text-[10px] rounded transition-all text-center flex items-center justify-center gap-1 shadow cursor-pointer"
            >
              ${isDark ? '🚨 Dispatch Coast Guard Warning' : '⚓ Track Vessel Coordinates'}
            </button>
          </div>
        </div>
      `;

      marker.bindPopup(popupContent);
      marker.addTo(layerGroup);
    });


    layerGroup.addTo(map);
    vesselLayerGroupRef.current = layerGroup;
  }, [showVessels, vesselsData]);

  // Render Real-Time Satellite Oil Spill Slicks & Hazards Layer
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (oilSpillLayerGroupRef.current) {
      map.removeLayer(oilSpillLayerGroupRef.current);
      oilSpillLayerGroupRef.current = null;
    }

    if (!showOilSpills || !oilSpillsData?.events || oilSpillsData.events.length === 0) return;

    const layerGroup = L.layerGroup();

    oilSpillsData.events.forEach((spill: OilSpillEvent) => {
      if (spill.polygon && Array.isArray(spill.polygon) && spill.polygon.length > 0) {
        // Convert [lon, lat] pairs to Leaflet [lat, lon]
        const latLngs = spill.polygon.map(pt => [pt[1], pt[0]] as [number, number]);

        const poly = L.polygon(latLngs, {
          color: '#c084fc',
          weight: 2.5,
          opacity: 0.9,
          fillColor: '#581c87',
          fillOpacity: 0.35,
          dashArray: '6, 4'
        });

        const spillIcon = L.divIcon({
          className: 'custom-oil-spill-icon',
          html: `
            <div class="relative flex items-center justify-center cursor-pointer">
              <div class="absolute w-9 h-9 rounded-full bg-purple-600/40 animate-ping"></div>
              <div class="px-2 py-0.5 rounded-full bg-purple-950 border border-purple-400 shadow-[0_0_15px_rgba(168,85,247,0.8)] flex items-center gap-1 shadow-xl text-white font-bold text-[10px] whitespace-nowrap">
                <span>🛢️</span>
                <span class="font-mono text-[9px] text-purple-200 font-black">OIL SLICK</span>
                <span class="font-mono text-[8px] text-amber-300">(${spill.distanceNm ?? '—'} NM)</span>
              </div>
            </div>
          `,
          iconSize: [95, 26],
          iconAnchor: [47, 13]
        });

        const marker = L.marker([spill.latitude, spill.longitude], { icon: spillIcon });

        const popupContent = `
          <div class="p-2.5 space-y-2 max-w-[290px] bg-slate-900 text-slate-100 rounded-xl font-mono text-xs shadow-2xl border border-purple-500/60">
            <div class="flex items-center justify-between border-b border-purple-800/80 pb-1.5 font-bold text-purple-300">
              <span class="flex items-center gap-1.5">🛢️ ${spill.title}</span>
              <span class="text-[9px] bg-purple-950 text-purple-200 px-1.5 py-0.5 rounded border border-purple-700 font-black">SATELLITE</span>
            </div>

            <div class="space-y-1 text-[11px] bg-slate-950/90 p-2 rounded border border-slate-800">
              <div class="flex justify-between"><span class="text-slate-400">Authority:</span> <span class="text-purple-300 font-bold">${spill.sourceAuthority}</span></div>
              <div class="flex justify-between"><span class="text-slate-400">Position:</span> <span class="text-slate-200">${spill.latitude.toFixed(4)}°N, ${spill.longitude.toFixed(4)}°E</span></div>
              <div class="flex justify-between"><span class="text-slate-400">Distance:</span> <span class="text-amber-300 font-bold">${spill.distanceNm} NM (${spill.distanceKm} km)</span></div>
              <div class="flex justify-between"><span class="text-slate-400">Est. Slick Area:</span> <span class="text-cyan-300 font-bold">${spill.areaKm2} km²</span></div>
              <div class="flex justify-between border-t border-slate-800 pt-1"><span class="text-slate-400">Drift Vector:</span> <span class="text-emerald-400 font-bold">${spill.driftSpeedKts} kts @ ${spill.driftDirectionDeg}°</span></div>
            </div>

            <p class="text-[10px] text-purple-200 bg-purple-950/50 p-1.5 rounded border border-purple-900/60 italic leading-tight">
              ⚠️ MARPOL Annex I Hazard Zone. Safe navigation routing will automatically steer vessels around this slick.
            </p>

            <button
              onclick="window.__orcaPlotRouteTo && window.__orcaPlotRouteTo(${spill.latitude + 0.08}, ${spill.longitude + 0.08}, 'Bypass Point for ${spill.id}')"
              class="w-full py-1.5 px-2 bg-gradient-to-r from-purple-700 to-indigo-700 hover:from-purple-600 hover:to-indigo-600 text-white font-bold text-[10px] rounded transition-all text-center flex items-center justify-center gap-1 shadow cursor-pointer"
            >
              🧭 Plot Safe Route Bypass Around Slick
            </button>
          </div>
        `;

        poly.bindPopup(popupContent);
        marker.bindPopup(popupContent);

        poly.addTo(layerGroup);
        marker.addTo(layerGroup);
      }
    });

    layerGroup.addTo(map);
    oilSpillLayerGroupRef.current = layerGroup;
  }, [showOilSpills, oilSpillsData]);

  return (
    <div
      ref={outerWrapperRef}
      className={`orca-map-frame relative bg-slate-900 rounded-2xl overflow-hidden shadow-2xl transition-all ${isFullscreen ? 'fixed inset-0 z-[9999] w-screen h-screen rounded-none' : 'h-[440px] sm:h-[480px] lg:h-[540px]'
        }`}
    >
      {/* Decorative glowing border frame — purely cosmetic, non-interactive */}
      <div className="orca-frame-glow pointer-events-none absolute inset-0 z-[350] rounded-2xl" />
      <div className="orca-corner orca-corner-tl pointer-events-none" />
      <div className="orca-corner orca-corner-tr pointer-events-none" />
      <div className="orca-corner orca-corner-bl pointer-events-none" />
      <div className="orca-corner orca-corner-br pointer-events-none" />

      {/* Decorative scanline sweep — purely cosmetic, non-interactive */}
      <div className="orca-scanline pointer-events-none absolute inset-0 z-[340] rounded-2xl overflow-hidden" />

      {/* Map Header & Controls Overlay — Stacked layout prevents UI collision */}
      <div className="absolute top-3 left-3 z-[400] flex flex-col items-start gap-2 max-w-[82%] sm:max-w-[88%] lg:max-w-2xl">

        {/* Quick Coastal Hub Jump Menu — All 17 Indian Coastal Hubs */}
        <div className="orca-glass-panel p-1.5 flex items-center space-x-1.5 overflow-x-auto max-w-full scrollbar-thin">
          <span className="text-[10px] font-mono uppercase text-slate-400 pl-1.5 flex items-center gap-1 shrink-0">
            <Compass className="h-3 w-3 text-cyan-400" />
            <span className="hidden sm:inline">{dict.coastalHubs}:</span>
          </span>
          {location.regionType === 'open_sea' && (
            <span className="px-2.5 py-0.5 rounded-lg text-xs font-bold bg-cyan-500 text-slate-950 shadow-[0_0_12px_rgba(34,211,238,0.7)] flex items-center gap-1 shrink-0">
              ⚓ Custom Boat Pin
            </span>
          )}
          {Object.keys(COASTAL_LOCATIONS).map((key) => {
            const loc = COASTAL_LOCATIONS[key];
            if (!loc) return null;
            const isSelected = location.regionType !== 'open_sea' && (
              loc.name.toLowerCase() === location.name.toLowerCase() ||
              location.name.toLowerCase().includes(key)
            );
            const shortName = loc.name.split(' ')[0].replace('/', '');
            return (
              <button
                key={key}
                id={`map-loc-${key}`}
                onClick={() => onSelectLocation(key)}
                className={`px-2 py-0.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all shrink-0 ${isSelected
                    ? 'bg-cyan-500 text-slate-950 shadow-[0_0_12px_rgba(34,211,238,0.6)]'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                  }`}
              >
                {shortName}
              </button>
            );
          })}
        </div>

        {/* Layer Toggles Popover */}
        <div className="orca-glass-panel p-1 flex items-center space-x-1 overflow-x-auto max-w-full scrollbar-thin">
          <button
            onClick={() => setShowHazardZones(!showHazardZones)}
            title="Toggle Hazard Polygons"
            className={`px-2 py-1 rounded-lg text-[11px] font-medium flex items-center gap-1 transition-all whitespace-nowrap ${showHazardZones ? 'bg-red-950/70 text-red-300 border border-red-700/50 shadow-[0_0_10px_rgba(239,68,68,0.25)]' : 'text-slate-400 hover:bg-slate-800/60'
              }`}
          >
            <Waves className="h-3 w-3 text-red-400" />
            <span className="hidden md:inline">{dict.hazardZones}</span>
          </button>

          <button
            onClick={() => setShowSafeCorridors(!showSafeCorridors)}
            title="Toggle Safe Navigation Corridors"
            className={`px-2 py-1 rounded-lg text-[11px] font-medium flex items-center gap-1 transition-all whitespace-nowrap ${showSafeCorridors ? 'bg-emerald-950/70 text-emerald-300 border border-emerald-700/50 shadow-[0_0_10px_rgba(16,185,129,0.25)]' : 'text-slate-400 hover:bg-slate-800/60'
              }`}
          >
            <Navigation className="h-3 w-3 text-emerald-400" />
            <span className="hidden md:inline">{dict.safeChannels}</span>
          </button>

          <button
            onClick={() => setShowBuoys(!showBuoys)}
            title="Toggle Ocean Buoys"
            className={`px-2 py-1 rounded-lg text-[11px] font-medium flex items-center gap-1 transition-all whitespace-nowrap ${showBuoys ? 'bg-amber-950/70 text-amber-300 border border-amber-600/60 shadow-[0_0_10px_rgba(245,158,11,0.25)]' : 'text-slate-400 hover:bg-slate-800/60'
              }`}
          >
            <Radio className="h-3 w-3 text-amber-400" />
            <span className="hidden md:inline">{dict.buoys}</span>
          </button>

          <button
            onClick={() => setShowImbl(!showImbl)}
            title="Toggle International Maritime Boundary Lines (IMBL)"
            className={`px-2 py-1 rounded-lg text-[11px] font-medium flex items-center gap-1 transition-all whitespace-nowrap ${showImbl ? 'bg-rose-950/70 text-rose-300 border border-rose-700/50 shadow-[0_0_10px_rgba(244,63,94,0.25)] font-bold' : 'text-slate-400 hover:bg-slate-800/60'
              }`}
          >
            <ShieldAlert className="h-3 w-3 text-rose-400" />
            <span className="hidden sm:inline">IMBL Border</span>
          </button>

          <button
            onClick={() => setShowMpas(!showMpas)}
            title="Toggle Marine Protected Areas (MPAs)"
            className={`px-2 py-1 rounded-lg text-[11px] font-medium flex items-center gap-1 transition-all whitespace-nowrap ${showMpas ? 'bg-emerald-950/70 text-emerald-300 border border-emerald-700/50 shadow-[0_0_10px_rgba(16,185,129,0.25)] font-bold' : 'text-slate-400 hover:bg-slate-800/60'
              }`}
          >
            <ShieldCheck className="h-3 w-3 text-emerald-400" />
            <span className="hidden sm:inline">MPA Reserves</span>
          </button>

          <button
            onClick={() => setShowPfz(!showPfz)}
            title="Toggle Statutory INCOIS Daily Potential Fishing Zones (PFZ) & Satellite Frontlines"
            className={`px-2 py-1 rounded-lg text-[11px] font-medium flex items-center gap-1 transition-all whitespace-nowrap ${showPfz ? 'bg-emerald-950/90 text-emerald-200 border border-emerald-500/80 shadow-[0_0_12px_rgba(16,185,129,0.4)] font-bold' : 'text-slate-400 hover:bg-slate-800/60'
              }`}
          >
            <span>🐟</span>
            <span className="hidden sm:inline">INCOIS PFZ (Live WFS)</span>
          </button>

          <button
            onClick={() => setIsSatelliteView(!isSatelliteView)}
            title="Toggle Real High-Resolution Optical Satellite Imagery Base Layer (Esri World Imagery + OpenSeaMap)"
            className={`px-2 py-1 rounded-lg text-[11px] font-medium flex items-center gap-1 transition-all whitespace-nowrap ${isSatelliteView ? 'bg-cyan-950/90 text-cyan-200 border border-cyan-400 shadow-[0_0_12px_rgba(6,182,212,0.4)] font-bold' : 'text-slate-400 hover:bg-slate-800/60'
              }`}
          >
            <span>🛰️</span>
            <span className="hidden sm:inline">{isSatelliteView ? 'Satellite Map (Live)' : 'Satellite View'}</span>
          </button>

          <button
            onClick={() => {
              setShowSafeRouteLayer(true);
              if (!routeDestination) {
                if (pfzZones && pfzZones.length > 0 && pfzZones[0].geofenceStatus !== 'RESTRICTED') {
                  setRouteDestination({ latitude: pfzZones[0].latitude, longitude: pfzZones[0].longitude, name: `PFZ Zone #${pfzZones[0].rank}` });
                } else {
                  setRouteDestination({ latitude: Number((location.latitude + 0.12).toFixed(4)), longitude: Number((location.longitude + 0.15).toFixed(4)), name: 'Offshore Channel Point' });
                }
              } else {
                setShowSafeRouteLayer(!showSafeRouteLayer);
              }
            }}
            title="Toggle Dynamic Safe Navigation Route Polyline"
            className={`px-2 py-1 rounded-lg text-[11px] font-medium flex items-center gap-1 transition-all whitespace-nowrap ${showSafeRouteLayer && (safeRouteResult || routeDestination)
                ? 'bg-emerald-950/90 text-emerald-200 border border-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.5)] font-bold'
                : 'text-slate-400 hover:bg-slate-800/60'
              }`}
          >
            <Navigation className="h-3 w-3 text-emerald-400" />
            <span className="hidden sm:inline">Safe Route</span>
          </button>

          <button
            onClick={() => setShowVessels(!showVessels)}
            title="Toggle Live INCOIS Moored Ocean Buoy Stations (NDBP/NIOT Telemetry)"
            className={`px-2 py-1 rounded-lg text-[11px] font-medium flex items-center gap-1 transition-all whitespace-nowrap ${showVessels
                ? 'bg-amber-950/90 text-amber-200 border border-amber-500/80 shadow-[0_0_12px_rgba(245,158,11,0.5)] font-bold'
                : 'text-slate-400 hover:bg-slate-800/60'
              }`}
          >
            <span>📡</span>
            <span className="hidden sm:inline">INCOIS Buoys (Live)</span>
          </button>

          <button
            onClick={() => setShowOilSpills(!showOilSpills)}
            title="Toggle Live Satellite Oil Spill Slicks & Hazards (NASA EONET / Copernicus STAC)"
            className={`px-2 py-1 rounded-lg text-[11px] font-medium flex items-center gap-1 transition-all whitespace-nowrap ${showOilSpills
                ? 'bg-purple-950/90 text-purple-200 border border-purple-500/80 shadow-[0_0_12px_rgba(168,85,247,0.5)] font-bold'
                : 'text-slate-400 hover:bg-slate-800/60'
              }`}
          >
            <span>🛢️</span>
            <span className="hidden sm:inline">Oil Slicks (Live NASA)</span>
          </button>

        </div>

      </div>

      {/* Top Right Controls: GPS Boat & Fullscreen Toggle */}
      <div className="absolute top-3 right-3 z-[400] flex items-center gap-1.5">
        <button
          onClick={handleLocateBoat}
          disabled={isLocating}
          className={`orca-glass-panel px-2.5 py-1.5 flex items-center gap-1.5 text-xs font-semibold rounded-lg transition-all shadow-lg ${isLocating
              ? 'bg-cyan-500/30 text-cyan-300 border border-cyan-400 animate-pulse'
              : 'text-cyan-300 hover:text-white hover:bg-slate-800/80 border border-slate-700/60'
            }`}
          title="Detect live GPS coordinates from this device / boat"
        >
          <Navigation className={`h-3.5 w-3.5 ${isLocating ? 'animate-spin' : 'text-cyan-400'}`} />
          <span className="hidden sm:inline">{isLocating ? 'Locating...' : '📍 My Boat GPS'}</span>
        </button>

        <button
          onClick={toggleFullscreen}
          className="orca-glass-panel p-2 text-slate-300 hover:bg-slate-800/60 transition-all rounded-lg"
          title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen Map'}
        >
          {isFullscreen ? <Minimize2 className="h-4 w-4 text-cyan-400" /> : <Maximize2 className="h-4 w-4 text-cyan-400" />}
        </button>
      </div>

      {/* Real-Time Geofence & Border Proximity HUD (Top Right Under Fullscreen) */}
      {(geofenceAnalysis || (gisLayers as any)?.geofenceAnalysis) && (
        <div className="orca-glass-panel absolute top-14 right-3 z-[400] p-2.5 max-w-[280px] text-xs space-y-2 shadow-2xl border border-slate-700/80 hidden sm:block">
          {(() => {
            const geo = geofenceAnalysis || (gisLayers as any).geofenceAnalysis;
            const isBreach = geo.status === 'RESTRICTED_BREACH';
            const isCaution = geo.status === 'CAUTION';
            return (
              <>
                <div className="flex items-center justify-between border-b border-slate-700/60 pb-1">
                  <span className="font-mono text-[10px] uppercase font-bold text-slate-300 flex items-center gap-1">
                    <ShieldAlert className="h-3.5 w-3.5 text-cyan-400" />
                    <span>Geofence Status</span>
                  </span>
                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-black uppercase ${isBreach ? 'bg-red-600 text-white animate-pulse' :
                      isCaution ? 'bg-amber-500 text-slate-950' :
                        'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    }`}>
                    {geo.status}
                  </span>
                </div>

                {/* Vessel Position Anchor Indicator */}
                <div className="py-1.5 px-2 bg-slate-950/80 rounded border border-cyan-500/40 space-y-1">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-cyan-400 font-bold flex items-center gap-1">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500"></span>
                      </span>
                      <span>Boat Position:</span>
                    </span>
                    <span className="font-mono text-white font-bold bg-cyan-950/80 border border-cyan-800/80 px-1.5 py-0.5 rounded text-[10px]">
                      {location.latitude.toFixed(4)}°N, {location.longitude.toFixed(4)}°E
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-300 font-mono flex items-center justify-between pt-0.5 border-t border-slate-800">
                    <span className="text-slate-400">Nearest Coast/Base:</span>
                    <span className="text-cyan-300 font-semibold">{location.nearestPort || location.name}</span>
                  </div>
                </div>

                {geo.nearestImbl && (
                  <div className="space-y-0.5 pt-0.5">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-300 truncate max-w-[170px]" title={geo.nearestImbl.boundaryName}>
                        {geo.nearestImbl.boundaryName.split('(')[0].replace('International Maritime Boundary Line', 'IMBL')}
                      </span>
                      <span className={`font-mono font-bold ${geo.nearestImbl.hasCrossedBorder ? 'text-red-400 font-black animate-pulse' :
                          geo.nearestImbl.distanceNm <= 3.0 ? 'text-red-400 font-black animate-pulse' :
                            geo.nearestImbl.distanceNm <= 8.0 ? 'text-amber-400' : 'text-slate-300'
                        }`}>
                        {geo.nearestImbl.hasCrossedBorder ? `CROSSED (${geo.nearestImbl.distanceNm} NM)` : `${geo.nearestImbl.distanceNm} NM`}
                      </span>
                    </div>
                    {geo.nearestImbl.bearingDeg !== undefined && (
                      <div className="text-[10px] text-slate-400 font-mono">
                        {geo.nearestImbl.hasCrossedBorder ? 'Return Heading' : 'Bearing'}: {geo.nearestImbl.bearingDeg}° • ({geo.nearestImbl.hasCrossedBorder ? 'BORDER BREACH' : geo.nearestImbl.severity.replace('_', ' ')})
                      </div>
                    )}
                  </div>
                )}

                {geo.nearestMpa && (
                  <div className="pt-1 border-t border-slate-800 space-y-0.5">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-300 truncate max-w-[170px]" title={geo.nearestMpa.boundaryName}>
                        {geo.nearestMpa.boundaryName.split(' ')[0]} Sanctuary
                      </span>
                      <span className={`font-mono font-bold ${(geo.nearestMpa.isInside || geo.nearestMpa.distanceNm === 0) ? 'text-red-400 font-black animate-pulse' :
                          geo.nearestMpa.distanceNm <= 3.0 ? 'text-amber-400' : 'text-emerald-400'
                        }`}>
                        {(geo.nearestMpa.isInside || geo.nearestMpa.distanceNm === 0)
                          ? `INSIDE (${geo.nearestMpa.insideDepthNm ?? geo.nearestMpa.distanceNm} NM)`
                          : `${geo.nearestMpa.distanceNm} NM`}
                      </span>
                    </div>
                    {(geo.nearestMpa.isInside || geo.nearestMpa.distanceNm === 0) && (
                      <div className="text-[10px] text-red-300 font-mono">
                        Escape Heading: {geo.nearestMpa.escapeBearingDeg ?? geo.nearestMpa.bearingDeg ?? 0}° • SANCTUARY INVASION
                      </div>
                    )}
                  </div>
                )}

                {geo.activeAlerts?.length > 0 && (
                  <div className="pt-1 border-t border-red-500/30 text-[10px] text-amber-300 flex items-start gap-1 leading-tight">
                    <AlertTriangle className="h-3 w-3 shrink-0 text-amber-400 mt-0.5" />
                    <span>{geo.activeAlerts[0].warningMessage}</span>
                  </div>
                )}

                {/* Maritime Audio Broadcast Button */}
                <button
                  id="btn-geofence-audio-broadcast"
                  onClick={async () => {
                    await maritimeSiren.unlock();
                    // Pick the most critical alert first (CRITICAL_BREACH > PROXIMITY_WARNING > ADVISORY)
                    const criticalActiveAlert =
                      geo.activeAlerts?.find((a) => a.severity === 'CRITICAL_BREACH') ||
                      geo.activeAlerts?.find((a) => a.severity === 'PROXIMITY_WARNING') ||
                      geo.activeAlerts?.[0];
                    if (criticalActiveAlert) {
                      const phrase = voiceWarning.generateGeofencePhrase(criticalActiveAlert, language);
                      voiceWarning.speak(phrase, language, {
                        playSirenFirst: true,
                        isCritical: criticalActiveAlert.severity === 'CRITICAL_BREACH',
                        force: true,
                      });
                    } else if (geo.nearestImbl || geo.nearestMpa) {
                      // Nearest boundary: use status to determine severity
                      const nearestAlert = geo.nearestImbl || geo.nearestMpa!;
                      const isBreach = geo.status === 'RESTRICTED_BREACH';
                      const isCaution = geo.status === 'CAUTION';
                      const alertWithSeverity = {
                        ...nearestAlert,
                        severity: isBreach
                          ? ('CRITICAL_BREACH' as const)
                          : isCaution
                            ? ('PROXIMITY_WARNING' as const)
                            : ('ADVISORY' as const),
                      };
                      const phrase = voiceWarning.generateGeofencePhrase(alertWithSeverity, language);
                      voiceWarning.speak(phrase, language, {
                        playSirenFirst: isBreach || isCaution,
                        isCritical: isBreach,
                        force: true,
                      });
                    } else {
                      const phrase = voiceWarning.generateTestPhrase(language);
                      voiceWarning.speak(phrase, language, { playSirenFirst: false, isCritical: false, force: true });
                    }
                  }}
                  className="w-full mt-2 py-1.5 px-2 rounded-lg bg-cyan-950/70 hover:bg-cyan-900/80 border border-cyan-700/60 text-cyan-300 font-mono text-[10px] font-bold flex items-center justify-center gap-1.5 transition-all active:scale-95 shadow-sm"
                  title="Broadcast audible voice warning & siren for current boat position"
                >
                  <Radio className="h-3 w-3 text-cyan-400 animate-pulse" />
                  <span>🔊 Broadcast Alert ({language.toUpperCase()})</span>
                </button>
              </>
            );
          })()}
        </div>
      )}

      {/* Dynamic Safe Navigation Route HUD (Top Left under controls) */}
      {(routeDestination || isCalculatingRoute || safeRouteResult) && (
        <div className="orca-glass-panel absolute top-20 left-3 z-[400] p-3 max-w-[280px] sm:max-w-[300px] text-xs space-y-2 shadow-2xl border border-emerald-500/60 bg-slate-950/90 rounded-xl">
          <div className="flex items-center justify-between border-b border-slate-700/80 pb-1.5">
            <span className="font-mono text-[11px] uppercase font-bold text-emerald-400 flex items-center gap-1.5">
              <Navigation className={`h-3.5 w-3.5 ${isCalculatingRoute ? 'animate-spin text-cyan-400' : 'text-emerald-400'}`} />
              <span>Safe Route Navigation</span>
            </span>
            <div className="flex items-center gap-1.5">
              {safeRouteResult?.waypoints && safeRouteResult.waypoints.length > 0 && (
                <button
                  onClick={() => {
                    const map = mapInstanceRef.current;
                    if (map && safeRouteResult?.waypoints) {
                      const bounds = L.latLngBounds(safeRouteResult.waypoints.map((w: any) => [w.latitude, w.longitude]));
                      map.fitBounds(bounds, { padding: [60, 60], maxZoom: 13, animate: true, duration: 0.6 });
                    }
                  }}
                  className="text-cyan-300 hover:text-white bg-slate-800 hover:bg-slate-700 px-1.5 py-0.5 rounded text-[10px] font-bold flex items-center gap-1"
                  title="Frame Camera to Full Safe Route"
                >
                  🎯 Frame
                </button>
              )}
              <button
                onClick={() => {
                  setRouteDestination(null);
                  setSafeRouteResult(null);
                }}
                className="text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 px-1.5 py-0.5 rounded text-[10px] font-bold"
                title="Clear Active Navigation Route"
              >
                ✕ Clear
              </button>
            </div>
          </div>

          {isCalculatingRoute ? (
            <div className="py-2 text-center text-cyan-300 text-[11px] font-mono animate-pulse flex items-center justify-center gap-1.5">
              <Compass className="h-3.5 w-3.5 animate-spin" />
              <span>Calculating safe waypoints around IMBL & sanctuaries...</span>
            </div>
          ) : safeRouteResult?.status === 'ROUTE_FOUND' ? (
            <div className="space-y-1.5 font-mono text-[11px]">
              <div className="flex justify-between items-center bg-slate-900 p-1.5 rounded border border-slate-800">
                <span className="text-slate-400">Total Route:</span>
                <span className="font-bold text-emerald-400 text-xs">
                  {((safeRouteResult.distanceKm || 0) / 1.852).toFixed(1)} NM ({safeRouteResult.distanceKm} KM)
                </span>
              </div>
              <div className="flex justify-between items-center text-[10px]">
                <span className="text-slate-400">Direct vs Safe:</span>
                <span className="text-cyan-300">{((safeRouteResult.directDistanceKm || 0) / 1.852).toFixed(1)} NM direct</span>
              </div>
              {safeRouteResult.avoidedConstraints?.length > 0 && (
                <div className="text-[10px] text-amber-300 bg-amber-950/40 p-1.5 rounded border border-amber-800/50 space-y-0.5">
                  <div className="font-bold text-amber-400 flex items-center gap-1">
                    <ShieldCheck className="h-3 w-3 text-amber-400" />
                    <span>Avoided Constraints:</span>
                  </div>
                  <div className="truncate text-slate-200">{safeRouteResult.avoidedConstraints.join(', ')}</div>
                </div>
              )}
              {safeRouteResult.rationale && (
                <p className="text-[10px] text-slate-300 italic leading-tight pt-0.5">
                  💡 {safeRouteResult.rationale}
                </p>
              )}
              <div className="text-[9px] text-slate-400 bg-slate-900/90 p-1.5 rounded border border-slate-800 text-center font-mono">
                ⚠️ DECISION SUPPORT ONLY — Not for primary vessel navigation.
              </div>
            </div>
          ) : safeRouteResult?.status === 'ROUTE_UNAVAILABLE' ? (
            <div className="p-2 bg-rose-950/50 border border-rose-800/80 rounded text-[11px] text-rose-300 space-y-1">
              <div className="font-bold text-rose-400 flex items-center gap-1">
                <AlertTriangle className="h-3.5 w-3.5 text-rose-400" />
                <span>ROUTE BLOCKED / RESTRICTED</span>
              </div>
              <p className="text-[10px] text-slate-300 leading-tight">
                {safeRouteResult.warnings?.[0] || 'Destination is inside or too close to a restricted zone.'}
              </p>
            </div>
          ) : null}
        </div>
      )}

      {/* Map Floating Legend (Bottom Left) */}
      <div className="orca-glass-panel absolute bottom-3 left-3 z-[400] p-2.5 text-xs space-y-1.5 max-w-[240px] hidden sm:block">
        <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 uppercase border-b border-slate-700/60 pb-1">
          <span className="flex items-center gap-1">
            <Layers className="h-3 w-3 text-cyan-400" />
            <span>{dict.gisLegend}</span>
          </span>
          <span className="flex items-center gap-1 text-[10px] text-cyan-400">
            <span className="orca-live-dot" />
            Active
          </span>
        </div>
        <div className="space-y-1 text-[11px]">
          <div className="flex items-center space-x-2">
            <span className="w-3.5 h-3.5 rounded-full bg-cyan-500 border border-white shadow-[0_0_8px_rgba(6,182,212,0.8)] flex items-center justify-center text-[8px] text-white">⚓</span>
            <span className="text-cyan-200 font-semibold">My Boat / Base Port</span>
          </div>
          <div className="flex items-center space-x-2">
            <span className="w-3.5 h-0.5 bg-rose-500 border border-rose-500 border-dashed"></span>
            <span className="text-rose-300 font-semibold">IMBL Border (1974/PCA)</span>
          </div>
          <div className="flex items-center space-x-2">
            <span className="w-3 h-3 rounded bg-emerald-500/25 border border-emerald-400 border-dashed"></span>
            <span className="text-emerald-300 font-semibold">Marine Protected Area</span>
          </div>
          <div className="flex items-center space-x-2">
            <span className="w-3 h-3 rounded bg-amber-500/30 border border-amber-400 border-dashed"></span>
            <span className="text-amber-300 font-semibold">{dict.offshoreHazard || 'Offshore Hazard Sector'}</span>
          </div>
          <div className="flex items-center space-x-2">
            <span className="w-3.5 h-0.5 bg-cyan-400 border border-cyan-400 border-dashed"></span>
            <span className="text-cyan-300 font-semibold">INCOIS Frontline (WFS)</span>
          </div>
          <div className="flex items-center space-x-2">
            <span className="w-3.5 h-3.5 rounded-full bg-emerald-600 border border-emerald-300 shadow-[0_0_8px_rgba(16,185,129,0.8)] flex items-center justify-center text-[9px] text-white">🐟</span>
            <span className="text-emerald-300 font-semibold">PFZ Hotspot (INCOIS/ISRO)</span>
          </div>
          <div className="flex items-center space-x-2">
            <span className="w-3.5 h-0.5 bg-emerald-400 border border-emerald-300 border-dashed"></span>
            <span className="text-emerald-300 font-semibold">Safe Route Polyline (A*)</span>
          </div>
          <div className="flex items-center space-x-2">
            <span className="w-3.5 h-3.5 rounded-full bg-slate-950 border border-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.8)] flex items-center justify-center text-[8px] text-amber-300">📡</span>
            <span className="text-amber-300 font-semibold">{dict.buoyStation || 'INCOIS MoES Buoy'}</span>
          </div>
        </div>
        <div className="text-[10px] text-cyan-300/90 pt-0.5 font-mono">
          💡 Tap map or &apos;My Boat GPS&apos; to measure border distance
        </div>
      </div>

      {/* Actual Leaflet Container */}
      <div ref={mapContainerRef} className="w-full h-full min-h-[440px] sm:min-h-[480px] lg:min-h-[540px]" />

    </div>
  );
};
