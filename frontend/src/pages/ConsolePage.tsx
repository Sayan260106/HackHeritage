import React, { useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowLeft, RefreshCw, MessageSquare, Activity, Radio, Navigation, CheckCircle2, MapPin, X } from "lucide-react";
import { ConsoleErrorBoundary } from "../components/ConsoleErrorBoundary";
import { LeftNavbar } from "../components/LeftNavbar";
import { InteractiveMap } from "../components/InteractiveMap";
import { QueryPanel } from "../components/QueryPanel";
import { RiskCard } from "../components/RiskCard";
import { MarineTelemetry } from "../components/MarineTelemetry";
import { FeatureContributions } from "../components/FeatureContributions";
import { AgentExecutionTimeline } from "../components/AgentExecutionTimeline";
import { GroundedEvidenceDrawer } from "../components/GroundedEvidenceDrawer";
import { SatelliteAnalysisView } from "../components/SatelliteAnalysisView";
import { WhatIfSimulator } from "../components/WhatIfSimulator";
import { AudioAlertController } from "../components/AudioAlertController";
import { MarineChatDrawer } from "../components/MarineChatDrawer";
import { SystemHealthModal } from "../components/SystemHealthModal";
import { OrcaAnalysisResponse, LanguageCode, ConversationTurn, LocationOverride } from "../types";
import { COASTAL_LOCATIONS, MULTILINGUAL_DICTIONARY } from "../data/coastalData";
import { detectQueryLanguage } from "../utils/languageDetector";

const PORT_BAR_KEYS = ['digha', 'puri', 'paradeep', 'visakhapatnam', 'kochi', 'chennai', 'mumbai'];

// Matched by distance rather than by name: orca-core's place names come from a
// geocoder that spells ports differently from this table (Paradip vs Paradeep).
const PORT_MATCH_KM = 15;

function nearestPortKey(lat: number, lon: number): string | null {
  let best: string | null = null;
  let bestKm = PORT_MATCH_KM;
  for (const [key, port] of Object.entries(COASTAL_LOCATIONS)) {
    const dLatKm = (port.latitude - lat) * 111;
    const dLonKm = (port.longitude - lon) * 111 * Math.cos((lat * Math.PI) / 180);
    const km = Math.hypot(dLatKm, dLonKm);
    if (km < bestKm) {
      best = key;
      bestKm = km;
    }
  }
  return best;
}

interface ConsolePageProps {
  onExit: () => void;
}

export const ConsolePage: React.FC<ConsolePageProps> = ({ onExit }) => {
  const [currentTab, setCurrentTab] = useState<
    "dashboard" | "analysis" | "satellite" | "evidence" | "simulator"
  >("dashboard");
  const [language, setLanguage] = useState<LanguageCode>("en");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [analysisData, setAnalysisData] =
    useState<OrcaAnalysisResponse | null>(null);
  const [sessionId, setSessionId] = useState<string>(() => `session-${Date.now()}`);
  const [chatTurns, setChatTurns] = useState<ConversationTurn[]>([]);
  const [isChatDrawerOpen, setIsChatDrawerOpen] = useState<boolean>(false);
  const [isHealthModalOpen, setIsHealthModalOpen] = useState<boolean>(false);
  const [activePortKey, setActivePortKey] = useState<string | null>(null);
  const [pendingPortKey, setPendingPortKey] = useState<string | null>(null);
  const [portError, setPortError] = useState<{ key: string; message: string } | null>(null);
  const [switchNotice, setSwitchNotice] = useState<{ name: string; state?: string; latitude: number; longitude: number } | null>(null);
  const [querySync, setQuerySync] = useState<{ query: string; locationKey: string | null; nonce: number } | null>(null);
  const [analysisVersion, setAnalysisVersion] = useState(0);
  const requestSeqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const lastCoordsRef = useRef<[number, number] | null>(null);
  const portBarRef = useRef<HTMLDivElement>(null);
  const portButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const fetchAnalysis = async (
    queryText: string,
    locOverride?: string,
    timeOverride?: string,
    responseLanguage: LanguageCode = language,
    retryCount: number = 0,
  ) => {
    // A newer click supersedes an older one; without this, a slow response for
    // the previous port can land after the new one and silently undo the switch.
    const seq = ++requestSeqRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const portKey = locOverride && COASTAL_LOCATIONS[locOverride] ? locOverride : null;
    const port = portKey ? COASTAL_LOCATIONS[portKey] : null;
    // Known ports go as coordinates: sending the key makes orca-core geocode it,
    // and a name the geocoder can't find falls back to Digha without telling anyone.
    const override: LocationOverride | undefined = port
      ? { latitude: port.latitude, longitude: port.longitude, name: port.name }
      : locOverride;

    setIsLoading(true);
    setPendingPortKey(portKey);
    if (retryCount === 0) {
      setErrorMessage(null);
      setPortError(null);
    }

    // Auto-detect regional script from query (e.g. Bengali, Hindi, Tamil)
    const detected = detectQueryLanguage(queryText, responseLanguage);
    const effectiveLang = (responseLanguage && responseLanguage !== 'en') ? responseLanguage : detected.language;
    if (effectiveLang !== language) {
      setLanguage(effectiveLang);
    }

    try {
      const response = await fetch("/api/orca/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          query: queryText,
          locationOverride: override,
          timeOverride,
          language: effectiveLang,
          sessionId,
        }),
      });

      const payload = await response.json().catch(() => null);
      if (seq !== requestSeqRef.current) return;
      if (!response.ok) {
        throw new Error(
          payload?.error ||
            (typeof payload?.detail === "string" ? payload.detail : null) ||
            `Server returned status ${response.status}`,
        );
      }

      if (!payload?.weather || !payload?.ocean || !payload?.risk) {
        throw new Error(
          "ORCA returned an incomplete live-data analysis. No synthetic telemetry will be displayed.",
        );
      }

      const raw = payload as OrcaAnalysisResponse;
      const resolvedKey =
        portKey ?? (override ? null : nearestPortKey(raw.location.latitude, raw.location.longitude));
      const resolvedPort = resolvedKey ? COASTAL_LOCATIONS[resolvedKey] : null;
      // orca-core labels every point "open_sea" with no port metadata, so a
      // known port's own record is the more accurate label.
      const responsePayload: OrcaAnalysisResponse = resolvedPort
        ? {
            ...raw,
            location: {
              ...raw.location,
              name: resolvedPort.name,
              state: resolvedPort.state,
              regionType: resolvedPort.regionType,
              nearestPort: resolvedPort.nearestPort,
              depthMeters: resolvedPort.depthMeters,
            },
          }
        : raw;
      setAnalysisData(responsePayload);
      setAnalysisVersion((v) => v + 1);
      setActivePortKey(resolvedKey);
      setPendingPortKey(null);

      const { latitude, longitude, name, state } = responsePayload.location;
      const previous = lastCoordsRef.current;
      if (previous && (Math.abs(previous[0] - latitude) > 1e-3 || Math.abs(previous[1] - longitude) > 1e-3)) {
        setSwitchNotice({ name, state, latitude, longitude });
      }
      lastCoordsRef.current = [latitude, longitude];

      const turn: ConversationTurn = {
        turnId: `turn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        query: queryText,
        timestamp: new Date().toISOString(),
        language: effectiveLang,
        detectedIntent: responsePayload.detectedIntent,
        locationName: responsePayload.location.name,
        responseSummary: responsePayload.groundedSummary,
        responseAnalysis: responsePayload,
      };

      setChatTurns((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.query === queryText && last.locationName === turn.locationName) {
          return [...prev.slice(0, -1), turn];
        }
        return [...prev, turn];
      });

      setErrorMessage(null);
      setIsLoading(false);
    } catch (err) {
      if (controller.signal.aborted || seq !== requestSeqRef.current) return;
      // Auto-retry once after 1 second for transient network or agent initialization blips
      if (retryCount < 1) {
        console.warn(`ORCA live-data transient hiccup, auto-retrying in 1s...`);
        setTimeout(() => {
          if (seq === requestSeqRef.current) {
            fetchAnalysis(queryText, locOverride, timeOverride, responseLanguage, retryCount + 1);
          }
        }, 1000);
        return;
      }

      const message =
        err instanceof Error ? err.message : "Unable to retrieve live ORCA data.";
      console.error("ORCA live-data request failed:", message);
      setErrorMessage(message);
      if (portKey) setPortError({ key: portKey, message });
      setPendingPortKey(null);
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalysis("Is it safe for small fishing boats near Digha right now?", "digha");
    return () => abortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (!switchNotice) return;
    const timer = setTimeout(() => setSwitchNotice(null), 8000);
    return () => clearTimeout(timer);
  }, [switchNotice]);

  // Scroll only the port bar itself; scrollIntoView would also yank the page
  // up when the port was picked from the map further down.
  useEffect(() => {
    const key = pendingPortKey ?? activePortKey;
    const bar = portBarRef.current;
    const button = key ? portButtonRefs.current[key] : null;
    if (!bar || !button) return;
    bar.scrollTo({ left: button.offsetLeft - (bar.clientWidth - button.clientWidth) / 2, behavior: "smooth" });
  }, [pendingPortKey, activePortKey]);

  const handleLocationSelect = (locKey: string) => {
    const loc = COASTAL_LOCATIONS[locKey];
    if (!loc) return;
    const query = `Is it safe for small fishing boats near ${loc.name} right now?`;
    setQuerySync({ query, locationKey: locKey, nonce: Date.now() });
    fetchAnalysis(query, locKey);
  };

  // Follow-up questions stay where the operator is looking. orca-core has no
  // place detection of its own, so sending nothing would answer for Digha.
  const currentLocationOverride = (): string | undefined => {
    if (activePortKey) return activePortKey;
    if (!analysisData) return undefined;
    return `${analysisData.location.latitude},${analysisData.location.longitude}`;
  };

  const handleMapCoordinateClick = (lat: number, lon: number) => {
    fetchAnalysis(
      `Analyze live marine conditions at coordinates ${lat.toFixed(4)}°N, ${lon.toFixed(4)}°E`,
      `${lat.toFixed(4)},${lon.toFixed(4)}`
    );
  };

  const dict = MULTILINGUAL_DICTIONARY[language] || MULTILINGUAL_DICTIONARY.en;
  const pendingPort = pendingPortKey ? COASTAL_LOCATIONS[pendingPortKey] : null;
  const isSwitchingPort = pendingPortKey !== null && pendingPortKey !== activePortKey;
  const failedPort = portError ? COASTAL_LOCATIONS[portError.key] : null;

  return (
    <div className="orca-console flex min-h-screen flex-col bg-[#f8fafc] text-slate-800 lg:flex-row font-sans">
      <LeftNavbar
        currentTab={currentTab}
        setCurrentTab={setCurrentTab}
        language={language}
        setLanguage={(nextLanguage) => {
          setLanguage(nextLanguage);
          if (analysisData)
            fetchAnalysis(analysisData.originalQuery, currentLocationOverride(), undefined, nextLanguage);
        }}
        isProcessing={isLoading}
        onExit={onExit}
      />

      <div className="flex min-w-0 flex-1 flex-col justify-between pb-20 lg:pb-0">
        <main className="mx-auto w-full max-w-7xl flex-1 space-y-6 px-4 py-6 sm:px-6 lg:px-8">
          {/* The console is a wall of live modules with no visible title, which
              leaves a screen-reader user on an unnamed page. This names it
              without occupying any of the layout. */}
          <h1 className="sr-only">
            ORCA-X live console — marine risk advisory for the Indian coast
          </h1>

          {/* Return path to the brief, kept out of the way of the live modules. */}
          <button
            onClick={onExit}
            className="group hidden items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-slate-500 transition-colors hover:text-sky-700 lg:inline-flex"
          >
            <ArrowLeft className="h-3.5 w-3.5 transition-transform duration-300 group-hover:-translate-x-1 text-sky-600" />
            Project brief
          </button>

          {/* Multi-Port Coastal Hubs Live Status Bar (Section 2C: Touch-Snap Carousel) */}
          <div ref={portBarRef} className="relative flex items-center space-x-2 overflow-x-auto horizontal-snap-carousel py-2.5 px-4 bg-white border border-slate-200/90 rounded-2xl text-xs font-mono shadow-sm">
            <span className="text-[11px] text-sky-800 font-bold uppercase tracking-wider shrink-0 flex items-center gap-1.5 px-1">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span>Coastal Ports:</span>
            </span>
            {PORT_BAR_KEYS.map((key) => {
              const loc = COASTAL_LOCATIONS[key];
              if (!loc) return null;
              const isPending = pendingPortKey === key;
              const isActive = activePortKey === key && !isPending;
              const isLeaving = isActive && isSwitchingPort;
              const hasError = portError?.key === key;
              return (
                <button
                  key={key}
                  ref={(el) => {
                    portButtonRefs.current[key] = el;
                  }}
                  onClick={() => handleLocationSelect(key)}
                  aria-pressed={activePortKey === key}
                  aria-busy={isPending}
                  title={hasError ? `Could not load ${loc.name}: ${portError?.message}` : `${loc.name}, ${loc.state}`}
                  className={`min-h-[42px] px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all duration-200 flex items-center gap-1.5 shrink-0 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
                    isPending
                      ? 'bg-sky-50 text-sky-700 border border-sky-400 ring-2 ring-sky-300 shadow-sm'
                      : isActive
                      ? `bg-sky-600 text-white shadow-md shadow-sky-600/25 font-bold border border-sky-600 ${isLeaving ? 'opacity-50' : ''}`
                      : hasError
                      ? 'bg-rose-50 text-rose-700 border border-rose-300 hover:bg-rose-100'
                      : 'bg-slate-50 text-slate-700 hover:text-sky-700 hover:bg-sky-50/70 border border-slate-200 hover:border-sky-300'
                  }`}
                >
                  {isPending ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin text-sky-600" aria-hidden />
                  ) : isActive ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-white" aria-hidden />
                  ) : hasError ? (
                    <AlertCircle className="h-3.5 w-3.5 text-rose-500" aria-hidden />
                  ) : (
                    <MapPin className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                  )}
                  <span>{loc.name.split(' ')[0]}</span>
                  <span className={`text-[10px] font-mono ${isActive ? 'text-sky-100' : 'text-slate-400'}`}>
                    {isPending ? 'loading…' : `(${loc.latitude.toFixed(1)}°N)`}
                  </span>
                </button>
              );
            })}

            <button
              onClick={() => setIsHealthModalOpen(true)}
              title="Inspect multi-service connectivity & fallback health"
              className="ml-auto shrink-0 flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 px-3.5 py-2 text-xs font-mono text-slate-700 hover:text-sky-700 shadow-xs transition-all active:scale-95"
            >
              <Activity className="h-3.5 w-3.5 text-emerald-500 animate-pulse" />
              <span className="hidden sm:inline font-semibold">System Diagnostics</span>
            </button>
          </div>

          {/* Maritime Audio Siren & Multi-lingual Warning Voice Controller */}
          <AudioAlertController
            language={language}
            geofenceAnalysis={analysisData?.geofenceAnalysis || analysisData?.gisLayers?.geofenceAnalysis}
            risk={analysisData?.risk}
            audioAlert={analysisData?.audioAlert}
          />

          {/* Maritime Vessel Surveillance Radar Banner */}
          {analysisData?.vesselTraffic && analysisData.vesselTraffic.targetVessels && analysisData.vesselTraffic.targetVessels.length > 0 && (
            <div className={`flex flex-wrap items-center justify-between gap-3 p-4 rounded-2xl border transition-all ${
              analysisData.vesselTraffic.highRiskEncounter
                ? 'bg-rose-50 border-rose-200 shadow-sm'
                : 'bg-white border-slate-200/90 shadow-sm'
            }`}>
              <div className="flex items-center space-x-3">
                <div className={`p-2.5 rounded-xl flex items-center justify-center ${
                  analysisData.vesselTraffic.highRiskEncounter
                    ? 'bg-rose-100 text-rose-600 border border-rose-200'
                    : 'bg-sky-50 text-sky-600 border border-sky-200'
                }`}>
                  <Radio className="h-4 w-4" />
                </div>
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="text-xs font-bold font-mono tracking-wide text-slate-900 uppercase">
                      Maritime Surveillance Radar
                    </span>
                    <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border ${
                      analysisData.vesselTraffic.darkVesselCount > 0
                        ? 'bg-rose-100 text-rose-700 border-rose-300 animate-pulse'
                        : 'bg-sky-100 text-sky-700 border-sky-300'
                    }`}>
                      {analysisData.vesselTraffic.totalTrackedVessels} Targets ({analysisData.vesselTraffic.darkVesselCount} Dark, {analysisData.vesselTraffic.activeAisVessels} AIS)
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 mt-0.5">
                    {analysisData.vesselTraffic.alerts?.[0]?.description || `${analysisData.vesselTraffic.totalTrackedVessels} maritime targets tracked via INCOIS MoES Buoys and Sentinel-1 SAR radar.`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    const mapEl = document.querySelector('.leaflet-container');
                    if (mapEl) mapEl.scrollIntoView({ behavior: 'smooth' });
                  }}
                  className="px-3.5 py-1.5 rounded-xl text-xs font-mono font-bold text-sky-700 bg-sky-50 hover:bg-sky-100 border border-sky-200 transition-all flex items-center gap-1.5 cursor-pointer shadow-xs"
                >
                  <Navigation className="h-3 w-3 text-sky-600" />
                  <span>View on Map</span>
                </button>
              </div>
            </div>
          )}

          {isLoading && (
            <div role="status" aria-live="polite" className="relative overflow-hidden flex items-center gap-3 rounded-2xl border border-sky-200 bg-sky-50/90 p-3.5 shadow-sm">
              <RefreshCw className="h-4 w-4 shrink-0 animate-spin text-sky-600" />
              <div className="text-xs min-w-0">
                {pendingPort ? (
                  <>
                    <span className="font-mono font-bold tracking-wider text-sky-700 uppercase">
                      {!analysisData ? 'Loading' : isSwitchingPort ? 'Switching to' : 'Refreshing'} {pendingPort.name.split(' ')[0]}&nbsp;
                    </span>
                    <span className="text-slate-600">
                      {pendingPort.state} · {pendingPort.latitude.toFixed(2)}°N, {pendingPort.longitude.toFixed(2)}°E — fetching live weather, sea state and risk for this port.
                    </span>
                  </>
                ) : (
                  <>
                    <span className="font-mono font-bold tracking-wider text-sky-700 uppercase">
                      PIPELINE RUNNING&nbsp;
                    </span>
                    <span className="text-slate-600">
                      {dict.processing} — live weather and marine observations, Copernicus catalogue, BGE-M3 retrieval, risk engine.
                    </span>
                  </>
                )}
              </div>
              <div className="absolute inset-x-0 bottom-0 h-0.5 bg-gradient-to-r from-transparent via-sky-500 to-transparent animate-pulse" aria-hidden />
            </div>
          )}

          {switchNotice && !isLoading && (
            <div role="status" aria-live="polite" className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/90 p-3 shadow-sm">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
              <p className="min-w-0 flex-1 text-xs text-slate-800">
                <span className="font-mono font-bold uppercase tracking-wider text-emerald-700">Now showing&nbsp;</span>
                {switchNotice.name}
                {switchNotice.state ? `, ${switchNotice.state}` : ''}
                <span className="font-mono text-slate-500">
                  {' '}· {switchNotice.latitude.toFixed(2)}°N, {switchNotice.longitude.toFixed(2)}°E
                </span>
              </p>
              <button
                onClick={() => setSwitchNotice(null)}
                aria-label="Dismiss"
                className="shrink-0 rounded-lg p-1 text-slate-400 transition-colors hover:bg-emerald-100 hover:text-slate-700"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {errorMessage && !isLoading && (
            <div role="alert" className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50/90 p-4 shadow-sm">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-500" />
              <div>
                <p className="text-sm font-semibold text-rose-800">
                  {failedPort
                    ? `Could not load ${failedPort.name}`
                    : `Live marine data ${dict.unavailable ? dict.unavailable.toLowerCase() : 'unavailable'}`}
                </p>
                <p className="mt-1 text-xs text-slate-700">{errorMessage}</p>
                {failedPort && analysisData && (
                  <p className="mt-1 text-xs text-slate-500">Still showing {analysisData.location.name}.</p>
                )}
                <p className="mt-2 text-[11px] text-slate-500">
                  ORCA-X does not substitute synthetic weather or ocean
                  measurements when a live provider fails.
                </p>
                {portError && failedPort && (
                  <button
                    onClick={() => handleLocationSelect(portError.key)}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-rose-300 bg-white px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-rose-700 transition-colors hover:bg-rose-100 shadow-xs"
                  >
                    <RefreshCw className="h-3 w-3" />
                    Retry {failedPort.name.split(' ')[0]}
                  </button>
                )}
              </div>
            </div>
          )}

          {analysisData ? (
            <ConsoleErrorBoundary resetKey={`${currentTab}|${analysisVersion}`}>
              <div className="relative">
                {isLoading && (
                  <div className="pointer-events-none sticky top-4 z-[1100] flex h-0 justify-center">
                    <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-sky-300 bg-white/95 px-4 py-2 font-mono text-[11px] text-sky-800 shadow-lg shadow-sky-900/10">
                      <RefreshCw className="h-3.5 w-3.5 animate-spin text-sky-600" />
                      <span>
                        {pendingPort ? `Loading ${pendingPort.name.split(' ')[0]}` : 'Refreshing analysis'}
                        {isSwitchingPort && (
                          <span className="text-slate-500"> · showing {analysisData.location.name.split(' ')[0]} until ready</span>
                        )}
                      </span>
                    </div>
                  </div>
                )}
                <div
                  aria-busy={isLoading}
                  className={`transition-[opacity,filter] duration-300 ${isLoading ? 'pointer-events-none select-none opacity-40 saturate-50' : ''}`}
                >
              {currentTab === "dashboard" && (
                <div className="space-y-6">
                  {/* Full-width Query Input Bar with single-line preset chips */}
                  <QueryPanel
                    onSearch={(q, loc, time, detectedLang) => fetchAnalysis(q, loc || currentLocationOverride(), time, detectedLang || language)}
                    isLoading={isLoading}
                    sync={querySync ?? undefined}
                    language={language}
                    onOpenChat={() => setIsChatDrawerOpen(true)}
                  />

                  {/* Next Line: Official Sea Advisory (RiskCard) & Interactive Map */}
                  <div className="space-y-6">
                    <RiskCard
                      risk={analysisData.risk}
                      location={analysisData.location}
                      timeWindow={analysisData.timeWindow}
                      language={language}
                      groundedSummary={analysisData.groundedSummary}
                      geofenceAnalysis={analysisData.geofenceAnalysis || analysisData.gisLayers?.geofenceAnalysis}
                    />
                    <InteractiveMap
                      location={analysisData.location}
                      gisLayers={analysisData.gisLayers}
                      geofenceAnalysis={analysisData.geofenceAnalysis || analysisData.gisLayers?.geofenceAnalysis}
                      ocean={analysisData.ocean}
                      riskLevel={analysisData.risk.riskLevel}
                      risk={analysisData.risk}
                      safeRoute={analysisData.safeRoute}
                      vesselTraffic={analysisData.vesselTraffic}
                      onSelectLocation={handleLocationSelect}
                      onCoordinateClick={handleMapCoordinateClick} activePortKey={activePortKey} pendingPortKey={pendingPortKey}
                      language={language}
                    />

                    {/* <MarineTelemetry
                      weather={analysisData.weather}
                      ocean={analysisData.ocean}
                      satellite={analysisData.satellite}
                      language={language}
                    /> */}
                  </div>

                  {/* <div className="w-full">
                    <FeatureContributions risk={analysisData.risk} language={language} />
                  </div>

                  <GroundedEvidenceDrawer
                    evidence={analysisData.evidence}
                    groundedSummary={analysisData.groundedSummary}
                    language={language}
                  /> */}
                </div>
              )}

              {currentTab === "analysis" && (
                <div className="space-y-6">
                  <RiskCard
                    risk={analysisData.risk}
                    location={analysisData.location}
                    timeWindow={analysisData.timeWindow}
                    language={language}
                    groundedSummary={analysisData.groundedSummary}
                    geofenceAnalysis={analysisData.geofenceAnalysis || analysisData.gisLayers?.geofenceAnalysis}
                  />
                  <FeatureContributions risk={analysisData.risk} language={language} />
                  <MarineTelemetry
                    weather={analysisData.weather}
                    ocean={analysisData.ocean}
                    satellite={analysisData.satellite}
                    language={language}
                  />
                </div>
              )}

              {currentTab === "satellite" && (
                <div className="space-y-6">
                  <SatelliteAnalysisView
                    satellite={analysisData.satellite}
                    location={analysisData.location}
                    language={language}
                  />
                  <InteractiveMap
                    location={analysisData.location}
                    gisLayers={analysisData.gisLayers}
                    geofenceAnalysis={analysisData.geofenceAnalysis || analysisData.gisLayers?.geofenceAnalysis}
                    ocean={analysisData.ocean}
                    riskLevel={analysisData.risk.riskLevel}
                    risk={analysisData.risk}
                    safeRoute={analysisData.safeRoute}
                    vesselTraffic={analysisData.vesselTraffic}
                    onSelectLocation={handleLocationSelect}
                    onCoordinateClick={handleMapCoordinateClick} activePortKey={activePortKey} pendingPortKey={pendingPortKey}
                    language={language}
                  />
                </div>
              )}

              {currentTab === "evidence" && (
                <div className="space-y-6">
                  <GroundedEvidenceDrawer
                    evidence={analysisData.evidence}
                    groundedSummary={analysisData.groundedSummary}
                    language={language}
                  />
                  <AgentExecutionTimeline
                    traces={analysisData.agentTraces}
                    queryId={analysisData.queryId}
                    language={language}
                  />
                </div>
              )}

              {currentTab === "simulator" && (
                <div className="space-y-6">
                  <WhatIfSimulator
                    location={analysisData.location}
                    initialWeather={analysisData.weather}
                    initialOcean={analysisData.ocean}
                    initialSatellite={analysisData.satellite}
                    language={language}
                  />
                  <InteractiveMap
                    location={analysisData.location}
                    gisLayers={analysisData.gisLayers}
                    geofenceAnalysis={analysisData.geofenceAnalysis || analysisData.gisLayers?.geofenceAnalysis}
                    ocean={analysisData.ocean}
                    riskLevel={analysisData.risk.riskLevel}
                    risk={analysisData.risk}
                    safeRoute={analysisData.safeRoute}
                    vesselTraffic={analysisData.vesselTraffic}
                    onSelectLocation={handleLocationSelect}
                    onCoordinateClick={handleMapCoordinateClick} activePortKey={activePortKey} pendingPortKey={pendingPortKey}
                    language={language}
                  />
                </div>
              )}
                </div>
              </div>
            </ConsoleErrorBoundary>
          ) : (
            <div className="flex flex-col items-center justify-center space-y-4 py-24 text-center">
              {isLoading ? (
                <RefreshCw className="h-7 w-7 animate-spin text-sky-600" />
              ) : (
                <AlertCircle className="h-7 w-7 text-rose-500" />
              )}
              <p className="font-mono text-xs tracking-wide text-slate-500">
                {isLoading
                  ? `Connecting to live marine intelligence services${pendingPort ? ` for ${pendingPort.name}` : ''}…`
                  : "No live analysis yet. Start orca-core on port 8100, then retry."}
              </p>
              {!isLoading && errorMessage && (
                <button
                  className="rounded-xl border border-sky-300 bg-white px-5 py-2.5 font-mono text-[10px] uppercase tracking-[0.2em] text-sky-700 transition-colors hover:border-sky-500 hover:bg-sky-50 shadow-xs"
                  onClick={() =>
                    fetchAnalysis(
                      "Is it safe for small fishing boats near Digha right now?",
                      "digha",
                    )
                  }
                >
                  Retry live data
                </button>
              )}
            </div>
          )}
        </main>

        <SystemHealthModal
          isOpen={isHealthModalOpen}
          onClose={() => setIsHealthModalOpen(false)}
          language={language}
        />

        {/* Floating Multi-Turn Marine Chat Drawer Button */}
        <button
          onClick={() => setIsChatDrawerOpen(true)}
          className="fixed bottom-6 right-6 z-40 flex items-center gap-2.5 rounded-2xl border border-sky-200 bg-white px-4 py-3 text-xs font-bold font-mono text-sky-800 shadow-xl shadow-slate-300/60 backdrop-blur-md hover:bg-sky-50 hover:text-sky-900 hover:scale-105 active:scale-95 transition-all group"
        >
          <div className="relative">
            <MessageSquare className="h-4 w-4 text-sky-600 group-hover:animate-bounce" />
            {chatTurns.length > 0 && (
              <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-sky-500 text-[9px] font-black text-white shadow-sm">
                {chatTurns.length}
              </span>
            )}
          </div>
          <span>Multi-Turn Chat</span>
          <span className="rounded-md bg-sky-50 px-1.5 py-0.5 text-[9px] text-sky-700 border border-sky-200 font-semibold">
            {chatTurns.length > 0 ? `${chatTurns.length} Turns` : 'AI Session'}
          </span>
        </button>

        {/* Multi-Turn Contextual Chat Drawer */}
        <MarineChatDrawer
          isOpen={isChatDrawerOpen}
          onClose={() => setIsChatDrawerOpen(false)}
          sessionId={sessionId}
          onNewSession={() => {
            const nextSessionId = `session-${Date.now()}`;
            setSessionId(nextSessionId);
            setChatTurns([]);
          }}
          onSelectSession={(newSessionId, turns, latestAnalysis) => {
            setSessionId(newSessionId);
            setChatTurns(turns);
            if (latestAnalysis) {
              setAnalysisData(latestAnalysis);
            }
          }}
          turns={chatTurns}
          isLoading={isLoading}
          onSendMessage={(query) => fetchAnalysis(query, currentLocationOverride())}
          language={language}
          onSelectLocation={handleLocationSelect}
          onSelectTurnData={(turnAnalysis) => {
            setAnalysisData(turnAnalysis);
            setIsChatDrawerOpen(false);
          }}
        />

        <footer className="mt-8 border-t border-slate-200 bg-white/90 py-4">
          <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-4 text-xs text-slate-500 sm:flex-row sm:px-6 lg:px-8">
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              <span className="font-semibold text-slate-700">
                ORCA-X — Ocean Reasoning &amp; Collaborative AI
              </span>
              <span className="font-mono text-[10px] text-slate-400">
                | Smart India Hackathon
              </span>
            </div>
            <div className="max-w-xl text-center text-[11px] leading-tight text-slate-500 sm:text-right">
              <strong className="text-slate-700">Statutory notice:</strong>{" "}
              {analysisData?.officialDisclaimer || dict.disclaimer}
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default ConsolePage;
