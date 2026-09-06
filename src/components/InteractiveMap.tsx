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
import { LocationInfo, GisLayerData, RiskLevel, OceanData, LanguageCode, GeofenceSpatialAnalysis } from '../types';
import { COASTAL_LOCATIONS, MULTILINGUAL_DICTIONARY } from '../data/coastalData';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';

interface InteractiveMapProps {
  location: LocationInfo;
  gisLayers: GisLayerData;
  geofenceAnalysis?: GeofenceSpatialAnalysis;
  ocean: OceanData;
  riskLevel: RiskLevel;
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
  onSelectLocation,
  onCoordinateClick,
  language
}) => {
  const outerWrapperRef = useRef<HTMLDivElement>(null);
  const dict = MULTILINGUAL_DICTIONARY[language] || MULTILINGUAL_DICTIONARY.en;
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const geojsonLayerRef = useRef<L.GeoJSON | null>(null);
  const pfzLayerGroupRef = useRef<L.LayerGroup | null>(null);
  const routeLayerGroupRef = useRef<L.LayerGroup | null>(null);
  const targetMarkerRef = useRef<L.Marker | null>(null);
  const clickMarkerRef = useRef<L.Marker | null>(null);
  const onCoordinateClickRef = useRef(onCoordinateClick);
  useEffect(() => {
    onCoordinateClickRef.current = onCoordinateClick;
  }, [onCoordinateClick]);

  const [isLocating, setIsLocating] = useState<boolean>(false);
  const [pfzZones, setPfzZones] = useState<any[]>([]);

  // Safe Routing Navigation State
  const [routeDestination, setRouteDestination] = useState<{ latitude: number; longitude: number; name?: string } | null>(null);
  const [safeRouteResult, setSafeRouteResult] = useState<any | null>(null);
  const [isCalculatingRoute, setIsCalculatingRoute] = useState<boolean>(false);
  const [showSafeRouteLayer, setShowSafeRouteLayer] = useState<boolean>(true);

  // Global callbacks for leaflet popups (relocate boat & plot safe route)
  useEffect(() => {
    (window as any).__orcaSetBoatLocation = (lat: number, lon: number) => {
      if (onCoordinateClickRef.current) {
        onCoordinateClickRef.current(lat, lon);
      }
    };
    (window as any).__orcaPlotRouteTo = (lat: number, lon: number, name?: string) => {
      setRouteDestination({ latitude: lat, longitude: lon, name });
    };
    return () => {
      delete (window as any).__orcaSetBoatLocation;
      delete (window as any).__orcaPlotRouteTo;
    };
  }, []);

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
  const [showSstOverlay, setShowSstOverlay] = useState<boolean>(true);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  // Fetch live PFZ satellite analysis for current location
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
        if (isMounted && data && Array.isArray(data.zones)) {
          setPfzZones(data.zones);
        }
      })
      .catch(err => console.error('Failed to fetch real-time PFZ satellite zones:', err));

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
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      }).addTo(map);

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
                  <div class="w-5 h-5 rounded-full bg-purple-500/80 border border-white shadow-md flex items-center justify-center text-[10px] text-white font-mono">
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

  // Render Real-Time Potential Fishing Zones (PFZ) Layer
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (pfzLayerGroupRef.current) {
      map.removeLayer(pfzLayerGroupRef.current);
      pfzLayerGroupRef.current = null;
    }

    if (!showPfz || !pfzZones || pfzZones.length === 0) return;

    const layerGroup = L.layerGroup();

    pfzZones.forEach((zone: any) => {
      const isHigh = zone.suitability === 'HIGH';
      const isMod = zone.suitability === 'MODERATE';
      const isRestricted = zone.geofenceStatus === 'RESTRICTED';

      const strokeColor = isRestricted ? '#f43f5e' : isHigh ? '#10b981' : isMod ? '#f59e0b' : '#3b82f6';
      const fillColor = isRestricted ? '#9f1239' : isHigh ? '#059669' : isMod ? '#d97706' : '#1d4ed8';

      // 1. Chlorophyll & Thermal Front Gradient Circle
      const circle = L.circle([zone.latitude, zone.longitude], {
        radius: isHigh ? 3000 : 2000,
        color: strokeColor,
        weight: isHigh ? 2.5 : 1.5,
        opacity: 0.85,
        fillColor: fillColor,
        fillOpacity: isHigh ? 0.25 : 0.15,
        dashArray: isRestricted ? '5, 5' : undefined
      });

      // 2. Custom Glowing Fish Icon Pin
      const fishIcon = L.divIcon({
        className: 'custom-pfz-marker-icon',
        html: `
          <div class="relative flex items-center justify-center cursor-pointer">
            <div class="absolute w-8 h-8 rounded-full ${isHigh ? 'bg-emerald-500/40 animate-ping' : 'bg-amber-500/30'}"></div>
            <div class="px-2 py-0.5 rounded-full ${isRestricted ? 'bg-rose-700 border-rose-400' : isHigh ? 'bg-emerald-600 border-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.5)]' : 'bg-amber-600 border-amber-300'} border flex items-center gap-1 shadow-xl text-white font-bold text-[10px] whitespace-nowrap">
              <span>🐟</span>
              <span>PFZ #${zone.rank}</span>
              <span class="font-mono text-[9px] ${isHigh ? 'text-emerald-200' : 'text-amber-200'}">(${zone.score}%)</span>
            </div>
          </div>
        `,
        iconSize: [85, 26],
        iconAnchor: [42, 13]
      });

      const marker = L.marker([zone.latitude, zone.longitude], { icon: fishIcon });

      const popupContent = `
        <div class="p-2.5 space-y-2 max-w-[260px] bg-slate-900 text-slate-100 rounded-lg">
          <div class="flex items-center justify-between border-b border-slate-700/80 pb-1.5">
            <div class="flex items-center gap-1.5 font-bold text-xs text-emerald-400">
              <span>🐟 ${zone.id}</span>
              <span class="text-[10px] text-slate-300 font-mono">(Rank #${zone.rank})</span>
            </div>
            <span class="px-1.5 py-0.5 rounded text-[9px] font-black tracking-wider uppercase ${
              isRestricted ? 'bg-rose-600 text-white' :
              isHigh ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' :
              'bg-amber-500/20 text-amber-300 border border-amber-500/40'
            }">
              ${zone.suitability} SUITABILITY
            </span>
          </div>

          <div class="text-[11px] font-mono space-y-1 bg-slate-950/80 p-2 rounded border border-slate-800">
            <div class="flex justify-between">
              <span class="text-slate-400">Fishing Score:</span>
              <span class="font-bold text-cyan-300">${zone.score}/100</span>
            </div>
            <div class="flex justify-between">
              <span class="text-slate-400">Chlorophyll-a:</span>
              <span class="${zone.chlorophyllMgM3 !== undefined ? 'text-emerald-400 font-bold' : 'text-slate-400 font-semibold'}">
                ${zone.chlorophyllMgM3 !== undefined ? `${zone.chlorophyllMgM3.toFixed(2)} mg/m³` : 'Cloud Masked (NOAA)'}
              </span>
            </div>
            ${zone.sstC !== undefined ? `
              <div class="flex justify-between">
                <span class="text-slate-400">Sea Surface Temp:</span>
                <span class="text-amber-400 font-bold">${zone.sstC.toFixed(1)}°C</span>
              </div>
            ` : ''}
            ${zone.sstAnomalyC !== undefined ? `
              <div class="flex justify-between">
                <span class="text-slate-400">SST Anomaly:</span>
                <span class="text-cyan-400 font-bold">${zone.sstAnomalyC >= 0 ? '+' : ''}${zone.sstAnomalyC.toFixed(2)}°C</span>
              </div>
            ` : ''}
            <div class="flex justify-between border-t border-slate-800 pt-1">
              <span class="text-slate-400">Geofence Clearance:</span>
              <span class="font-bold ${
                zone.geofenceStatus === 'CLEAR' ? 'text-emerald-400' :
                zone.geofenceStatus === 'CAUTION' ? 'text-amber-400' : 'text-red-400'
              }">${zone.geofenceStatus}</span>
            </div>
          </div>

          ${zone.explanations?.[0] ? `
            <p class="text-[10px] text-slate-300 leading-tight italic bg-emerald-950/30 p-1.5 rounded border border-emerald-800/40">
              💡 ${zone.explanations[0]}
            </p>
          ` : ''}

          ${zone.sources?.length ? `
            <div class="text-[9px] text-slate-400 font-mono flex flex-wrap gap-1">
              <span class="text-slate-500">Feeds:</span>
              ${zone.sources.map((s: string) => `<span class="bg-slate-800 px-1 rounded text-cyan-300">${s.split(' ')[0]}</span>`).join('')}
            </div>
          ` : ''}

          <div class="grid grid-cols-2 gap-1 pt-1">
            <button
              onclick="window.__orcaSetBoatLocation && window.__orcaSetBoatLocation(${zone.latitude}, ${zone.longitude})"
              class="py-1 px-1.5 bg-cyan-700 hover:bg-cyan-600 text-white font-bold text-[10px] rounded transition-all text-center flex items-center justify-center gap-1 shadow cursor-pointer"
            >
              ⚓ Move Boat Here
            </button>
            <button
              onclick="window.__orcaPlotRouteTo && window.__orcaPlotRouteTo(${zone.latitude}, ${zone.longitude}, 'PFZ Zone #${zone.rank}')"
              class="py-1 px-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[10px] rounded transition-all text-center flex items-center justify-center gap-1 shadow cursor-pointer"
            >
              🧭 Safe Route
            </button>
          </div>
        </div>
      `;

      circle.bindPopup(popupContent);
      marker.bindPopup(popupContent);

      circle.addTo(layerGroup);
      marker.addTo(layerGroup);
    });

    layerGroup.addTo(map);
    pfzLayerGroupRef.current = layerGroup;
  }, [showPfz, pfzZones]);

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

    // 1. Safe Navigation Polyline (Emerald Glowing Dashed Line)
    const polyline = L.polyline(latLngs, {
      color: '#10b981',
      weight: 4.5,
      opacity: 0.9,
      dashArray: '8, 8'
    });

    // 2. Waypoint Markers along the route
    waypoints.forEach((wp: any, idx: number) => {
      const isStart = idx === 0;
      const isEnd = idx === waypoints.length - 1;
      if (!isStart && !isEnd && idx % 2 !== 0 && waypoints.length > 8) return;

      const wpIcon = L.divIcon({
        className: 'custom-wp-marker-icon',
        html: `
          <div class="relative flex items-center justify-center cursor-pointer">
            <div class="w-6 h-6 rounded-full ${isStart ? 'bg-cyan-600 border-2 border-white' : isEnd ? 'bg-emerald-600 border-2 border-white animate-pulse' : 'bg-slate-800 border border-emerald-400'} shadow-lg flex items-center justify-center text-[10px] text-white font-bold font-mono">
              ${isStart ? '⚓' : isEnd ? '🏁' : idx}
            </div>
          </div>
        `,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      });

      const marker = L.marker([wp.latitude, wp.longitude], { icon: wpIcon });

      const popupContent = `
        <div class="p-2 space-y-1 bg-slate-900 text-slate-100 rounded-lg text-xs font-mono">
          <div class="font-bold text-emerald-400 border-b border-slate-700 pb-1 flex items-center gap-1">
            <span>${isStart ? '⚓ Route Origin (Boat)' : isEnd ? '🏁 Safe Destination' : `Waypoint #${idx}`}</span>
          </div>
          <div class="flex justify-between text-[11px]">
            <span class="text-slate-400">Cumulative:</span>
            <span class="font-bold text-cyan-300">${((wp.cumulativeDistanceKm || 0) / 1.852).toFixed(1)} NM (${(wp.cumulativeDistanceKm || 0).toFixed(1)} KM)</span>
          </div>
          ${wp.bearingDeg !== undefined ? `
            <div class="flex justify-between text-[11px]">
              <span class="text-slate-400">Compass Bearing:</span>
              <span class="font-bold text-amber-300">${wp.bearingDeg}°</span>
            </div>
          ` : ''}
          <div class="flex justify-between text-[11px]">
            <span class="text-slate-400">Geofence Status:</span>
            <span class="font-bold ${wp.geofenceStatus === 'CLEAR' ? 'text-emerald-400' : 'text-amber-400'}">${wp.geofenceStatus}</span>
          </div>
        </div>
      `;

      marker.bindPopup(popupContent);
      marker.addTo(layerGroup);
    });

    polyline.addTo(layerGroup);
    layerGroup.addTo(map);
    routeLayerGroupRef.current = layerGroup;
  }, [showSafeRouteLayer, safeRouteResult]);

  return (
    <div 
      ref={outerWrapperRef} 
      className={`orca-map-frame relative bg-slate-900 rounded-2xl overflow-hidden shadow-2xl transition-all ${
        isFullscreen ? 'fixed inset-0 z-[9999] w-screen h-screen rounded-none' : 'h-[440px] sm:h-[480px] lg:h-[540px]'
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
                className={`px-2 py-0.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all shrink-0 ${
                  isSelected
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
            className={`px-2 py-1 rounded-lg text-[11px] font-medium flex items-center gap-1 transition-all whitespace-nowrap ${
              showHazardZones ? 'bg-red-950/70 text-red-300 border border-red-700/50 shadow-[0_0_10px_rgba(239,68,68,0.25)]' : 'text-slate-400 hover:bg-slate-800/60'
            }`}
          >
            <Waves className="h-3 w-3 text-red-400" />
            <span className="hidden md:inline">{dict.hazardZones}</span>
          </button>

          <button
            onClick={() => setShowSafeCorridors(!showSafeCorridors)}
            title="Toggle Safe Navigation Corridors"
            className={`px-2 py-1 rounded-lg text-[11px] font-medium flex items-center gap-1 transition-all whitespace-nowrap ${
              showSafeCorridors ? 'bg-emerald-950/70 text-emerald-300 border border-emerald-700/50 shadow-[0_0_10px_rgba(16,185,129,0.25)]' : 'text-slate-400 hover:bg-slate-800/60'
            }`}
          >
            <Navigation className="h-3 w-3 text-emerald-400" />
            <span className="hidden md:inline">{dict.safeChannels}</span>
          </button>

          <button
            onClick={() => setShowBuoys(!showBuoys)}
            title="Toggle Ocean Buoys"
            className={`px-2 py-1 rounded-lg text-[11px] font-medium flex items-center gap-1 transition-all whitespace-nowrap ${
              showBuoys ? 'bg-purple-950/70 text-purple-300 border border-purple-700/50 shadow-[0_0_10px_rgba(168,85,247,0.25)]' : 'text-slate-400 hover:bg-slate-800/60'
            }`}
          >
            <Radio className="h-3 w-3 text-purple-400" />
            <span className="hidden md:inline">{dict.buoys}</span>
          </button>

          <button
            onClick={() => setShowImbl(!showImbl)}
            title="Toggle International Maritime Boundary Lines (IMBL)"
            className={`px-2 py-1 rounded-lg text-[11px] font-medium flex items-center gap-1 transition-all whitespace-nowrap ${
              showImbl ? 'bg-rose-950/70 text-rose-300 border border-rose-700/50 shadow-[0_0_10px_rgba(244,63,94,0.25)] font-bold' : 'text-slate-400 hover:bg-slate-800/60'
            }`}
          >
            <ShieldAlert className="h-3 w-3 text-rose-400" />
            <span className="hidden sm:inline">IMBL Border</span>
          </button>

          <button
            onClick={() => setShowMpas(!showMpas)}
            title="Toggle Marine Protected Areas (MPAs)"
            className={`px-2 py-1 rounded-lg text-[11px] font-medium flex items-center gap-1 transition-all whitespace-nowrap ${
              showMpas ? 'bg-emerald-950/70 text-emerald-300 border border-emerald-700/50 shadow-[0_0_10px_rgba(16,185,129,0.25)] font-bold' : 'text-slate-400 hover:bg-slate-800/60'
            }`}
          >
            <ShieldCheck className="h-3 w-3 text-emerald-400" />
            <span className="hidden sm:inline">MPA Reserves</span>
          </button>

          <button
            onClick={() => setShowPfz(!showPfz)}
            title="Toggle Potential Fishing Zones (PFZ) Satellite Layer"
            className={`px-2 py-1 rounded-lg text-[11px] font-medium flex items-center gap-1 transition-all whitespace-nowrap ${
              showPfz ? 'bg-emerald-950/90 text-emerald-200 border border-emerald-500/80 shadow-[0_0_12px_rgba(16,185,129,0.4)] font-bold' : 'text-slate-400 hover:bg-slate-800/60'
            }`}
          >
            <span>🐟</span>
            <span className="hidden sm:inline">PFZ Hotspots</span>
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
            className={`px-2 py-1 rounded-lg text-[11px] font-medium flex items-center gap-1 transition-all whitespace-nowrap ${
              showSafeRouteLayer && (safeRouteResult || routeDestination)
                ? 'bg-emerald-950/90 text-emerald-200 border border-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.5)] font-bold'
                : 'text-slate-400 hover:bg-slate-800/60'
            }`}
          >
            <Navigation className="h-3 w-3 text-emerald-400" />
            <span className="hidden sm:inline">Safe Route</span>
          </button>
        </div>

      </div>

      {/* Top Right Controls: GPS Boat & Fullscreen Toggle */}
      <div className="absolute top-3 right-3 z-[400] flex items-center gap-1.5">
        <button
          onClick={handleLocateBoat}
          disabled={isLocating}
          className={`orca-glass-panel px-2.5 py-1.5 flex items-center gap-1.5 text-xs font-semibold rounded-lg transition-all shadow-lg ${
            isLocating 
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
                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-black uppercase ${
                    isBreach ? 'bg-red-600 text-white animate-pulse' :
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
                      <span className={`font-mono font-bold ${
                        geo.nearestImbl.distanceNm <= 3.0 ? 'text-red-400 font-black animate-pulse' :
                        geo.nearestImbl.distanceNm <= 8.0 ? 'text-amber-400' : 'text-slate-300'
                      }`}>
                        {geo.nearestImbl.distanceNm} NM
                      </span>
                    </div>
                    {geo.nearestImbl.bearingDeg !== undefined && (
                      <div className="text-[10px] text-slate-400 font-mono">
                        Bearing: {geo.nearestImbl.bearingDeg}° • ({geo.nearestImbl.severity.replace('_', ' ')})
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
                      <span className={`font-mono font-bold ${
                        geo.nearestMpa.distanceNm === 0 ? 'text-red-400 font-black animate-pulse' :
                        geo.nearestMpa.distanceNm <= 3.0 ? 'text-amber-400' : 'text-emerald-400'
                      }`}>
                        {geo.nearestMpa.distanceNm === 0 ? 'INSIDE' : `${geo.nearestMpa.distanceNm} NM`}
                      </span>
                    </div>
                  </div>
                )}

                {geo.activeAlerts?.length > 0 && (
                  <div className="pt-1 border-t border-red-500/30 text-[10px] text-amber-300 flex items-start gap-1 leading-tight">
                    <AlertTriangle className="h-3 w-3 shrink-0 text-amber-400 mt-0.5" />
                    <span>{geo.activeAlerts[0].warningMessage}</span>
                  </div>
                )}
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
            <span className="w-3.5 h-0.5 bg-rose-500 border border-rose-500 border-dashed"></span>
            <span className="text-slate-300 font-semibold">IMBL Border (1974/PCA)</span>
          </div>
          <div className="flex items-center space-x-2">
            <span className="w-3 h-3 rounded bg-emerald-500/30 border border-emerald-500"></span>
            <span className="text-slate-300 font-semibold">Marine Protected Area</span>
          </div>
          <div className="flex items-center space-x-2">
            <span className="w-3 h-3 rounded bg-red-500/40 border border-red-500"></span>
            <span className="text-slate-300">{dict.offshoreHazard}</span>
          </div>
          <div className="flex items-center space-x-2">
            <span className="w-3 h-3 rounded bg-blue-500/30 border border-blue-400"></span>
            <span className="text-slate-300">{dict.inshoreBuffer}</span>
          </div>
          <div className="flex items-center space-x-2">
            <span className="w-3 h-0.5 bg-emerald-400 border border-emerald-400 border-dashed"></span>
            <span className="text-slate-300">{dict.fairwayChannel}</span>
          </div>
          <div className="flex items-center space-x-2">
            <span className="w-2.5 h-2.5 rounded-full bg-purple-500 border border-white"></span>
            <span className="text-slate-300">{dict.buoyStation}</span>
          </div>
          <div className="flex items-center space-x-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 border border-emerald-200 shadow-[0_0_8px_rgba(16,185,129,0.8)]"></span>
            <span className="text-emerald-300 font-semibold">PFZ Hotspot (NOAA/ISRO)</span>
          </div>
          <div className="flex items-center space-x-2">
            <span className="w-3.5 h-0.5 bg-emerald-400 border border-emerald-300 border-dashed"></span>
            <span className="text-cyan-300 font-semibold">Safe Route Polyline</span>
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
