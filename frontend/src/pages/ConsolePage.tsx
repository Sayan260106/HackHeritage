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
    <div className="flex min-h-screen flex-col bg-abyssal text-chartpaper lg:flex-row">
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
            className="group hidden items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-fathom transition-colors hover:text-shoal lg:inline-flex"
          >
            <ArrowLeft className="h-3.5 w-3.5 transition-transform duration-300 group-hover:-translate-x-1" />
            Project brief
          </button>

          {/* Multi-Port Coastal Hubs Live Status Bar (Section 2C: Touch-Snap Carousel) */}
          <div ref={portBarRef} className="relative flex items-center space-x-2 overflow-x-auto horizontal-snap-carousel py-2.5 px-4 orca-glass-panel rounded-xl text-xs font-mono shadow-lg">
            <span className="text-[11px] text-cyan-400 font-bold uppercase tracking-wider shrink-0 flex items-center gap-1.5 px-1">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse"></span>
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
                  className={`min-h-[44px] px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all duration-200 flex items-center gap-1.5 shrink-0 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 ${
                    isPending
                      ? 'bg-cyan-500/15 text-cyan-100 border border-cyan-400 ring-2 ring-cyan-400/40 shadow-[0_0_16px_rgba(34,211,238,0.35)]'
                      : isActive
                      ? `bg-cyan-400 text-slate-950 shadow-md shadow-cyan-400/30 font-black border border-cyan-300 ${isLeaving ? 'opacity-50' : ''}`
                      : hasError
                      ? 'bg-red-950/40 text-red-200 border border-red-500/60 hover:bg-red-900/40'
                      : 'bg-slate-900 text-slate-200 hover:text-white hover:bg-slate-800 border border-slate-700 hover:border-cyan-500/50'
                  }`}
                >
                  {isPending ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin text-cyan-300" aria-hidden />
                  ) : isActive ? (
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                  ) : hasError ? (
                    <AlertCircle className="h-3.5 w-3.5 text-red-400" aria-hidden />
                  ) : (
                    <MapPin className="h-3.5 w-3.5 opacity-50" aria-hidden />
                  )}
                  <span>{loc.name.split(' ')[0]}</span>
                  <span className="text-[10px] opacity-80 font-mono">
                    {isPending ? 'loading…' : `(${loc.latitude.toFixed(1)}°N)`}
                  </span>
                </button>
              );
            })}

            <button
              onClick={() => setIsHealthModalOpen(true)}
              title="Inspect multi-service connectivity & fallback health"
              className="ml-auto shrink-0 flex items-center gap-1.5 rounded-xl border border-cyan-500/30 bg-slate-950/80 px-3 py-2 text-xs font-mono text-cyan-300 hover:bg-slate-900 hover:text-white hover:border-cyan-400 transition-all active:scale-95"
            >
              <Activity className="h-3.5 w-3.5 text-emerald-400 animate-pulse" />
              <span className="hidden sm:inline">System Diagnostics</span>
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
            <div className={`flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl border transition-all ${
              analysisData.vesselTraffic.highRiskEncounter
                ? 'bg-rose-950/40 border-rose-500/60 shadow-lg shadow-rose-950/50 ring-1 ring-rose-500/30'
                : 'bg-slate-900/80 border-cyan-500/40 shadow-md'
            }`}>
              <div className="flex items-center space-x-3">
                <div className={`p-2 rounded-lg flex items-center justify-center ${
                  analysisData.vesselTraffic.highRiskEncounter
                    ? 'bg-rose-600/30 text-rose-400 border border-rose-500/50 animate-pulse'
                    : 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40'
                }`}>
                  <Radio className="h-4 w-4" />
                </div>
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="text-xs font-bold font-mono tracking-wide text-white uppercase">
                      Maritime Surveillance Radar
                    </span>
                    <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border ${
                      analysisData.vesselTraffic.darkVesselCount > 0
                        ? 'bg-rose-500/20 text-rose-300 border-rose-500/50 animate-pulse'
                        : 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                    }`}>
                      {analysisData.vesselTraffic.totalTrackedVessels} Targets ({analysisData.vesselTraffic.darkVesselCount} Dark, {analysisData.vesselTraffic.activeAisVessels} AIS)
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 mt-0.5">
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
                  className="px-3 py-1.5 rounded-lg text-xs font-mono font-bold text-cyan-300 bg-cyan-950/80 hover:bg-cyan-900/80 border border-cyan-600/50 hover:border-cyan-400 transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  <Navigation className="h-3 w-3 text-cyan-400" />
                  <span>View on Map</span>
                </button>
              </div>
            </div>
          )}

          {isLoading && (
            <div role="status" aria-live="polite" className="relative overflow-hidden flex items-center gap-3 rounded-xl border border-cyan-500/30 orca-glass-panel p-3.5 shadow-md">
              <RefreshCw className="h-4 w-4 shrink-0 animate-spin text-cyan-400" />
              <div className="text-xs min-w-0">
                {pendingPort ? (
                  <>
                    <span className="font-mono font-bold tracking-wider text-cyan-400 uppercase">
                      {!analysisData ? 'Loading' : isSwitchingPort ? 'Switching to' : 'Refreshing'} {pendingPort.name.split(' ')[0]}&nbsp;
                    </span>
                    <span className="text-slate-300">
                      {pendingPort.state} · {pendingPort.latitude.toFixed(2)}°N, {pendingPort.longitude.toFixed(2)}°E — fetching live weather, sea state and risk for this port.
                    </span>
                  </>
                ) : (
                  <>
                    <span className="font-mono font-bold tracking-wider text-cyan-400 uppercase">
                      PIPELINE RUNNING&nbsp;
                    </span>
                    <span className="text-slate-300">
                      {dict.processing} — live weather and marine observations, Copernicus catalogue, BGE-M3 retrieval, risk engine.
                    </span>
                  </>
                )}
              </div>
              <div className="absolute inset-x-0 bottom-0 h-0.5 bg-gradient-to-r from-transparent via-cyan-400 to-transparent animate-pulse" aria-hidden />
            </div>
          )}

          {switchNotice && !isLoading && (
            <div role="status" aria-live="polite" className="flex items-center gap-3 rounded-xl border border-emerald-500/40 bg-emerald-950/40 p-3 shadow-md">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
              <p className="min-w-0 flex-1 text-xs text-slate-200">
                <span className="font-mono font-bold uppercase tracking-wider text-emerald-300">Now showing&nbsp;</span>
                {switchNotice.name}
                {switchNotice.state ? `, ${switchNotice.state}` : ''}
                <span className="font-mono text-slate-400">
                  {' '}· {switchNotice.latitude.toFixed(2)}°N, {switchNotice.longitude.toFixed(2)}°E
                </span>
              </p>
              <button
                onClick={() => setSwitchNotice(null)}
                aria-label="Dismiss"
                className="shrink-0 rounded p-1 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {errorMessage && !isLoading && (
            <div role="alert" className="flex items-start gap-3 rounded-sm border border-red-500/35 bg-red-950/25 p-4">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
              <div>
                <p className="text-sm font-semibold text-red-300">
                  {failedPort
                    ? `Could not load ${failedPort.name}`
                    : `Live marine data ${dict.unavailable ? dict.unavailable.toLowerCase() : 'unavailable'}`}
                </p>
                <p className="mt-1 text-xs text-slate-300">{errorMessage}</p>
                {failedPort && analysisData && (
                  <p className="mt-1 text-xs text-slate-400">Still showing {analysisData.location.name}.</p>
                )}
                <p className="mt-2 text-[11px] text-fathom">
                  ORCA-X does not substitute synthetic weather or ocean
                  measurements when a live provider fails.
                </p>
                {portError && failedPort && (
                  <button
                    onClick={() => handleLocationSelect(portError.key)}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-red-400/50 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-red-200 transition-colors hover:border-red-300 hover:bg-red-900/40"
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
                    <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-cyan-400/50 bg-slate-950/95 px-4 py-2 font-mono text-[11px] text-cyan-200 shadow-lg shadow-cyan-500/20">
                      <RefreshCw className="h-3.5 w-3.5 animate-spin text-cyan-400" />
                      <span>
                        {pendingPort ? `Loading ${pendingPort.name.split(' ')[0]}` : 'Refreshing analysis'}
                        {isSwitchingPort && (
                          <span className="text-slate-400"> · showing {analysisData.location.name.split(' ')[0]} until ready</span>
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
                <RefreshCw className="h-7 w-7 animate-spin text-shoal" />
              ) : (
                <AlertCircle className="h-7 w-7 text-red-400" />
              )}
              <p className="font-mono text-xs tracking-wide text-fathom">
                {isLoading
                  ? `Connecting to live marine intelligence services${pendingPort ? ` for ${pendingPort.name}` : ''}…`
                  : "No live analysis yet. Start orca-core on port 8100, then retry."}
              </p>
              {!isLoading && errorMessage && (
                <button
                  className="rounded-sm border border-shoal/35 px-5 py-2.5 font-mono text-[10px] uppercase tracking-[0.2em] text-shoal transition-colors hover:border-shoal/70 hover:bg-shoal/8"
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
          className="fixed bottom-6 right-6 z-40 flex items-center gap-2.5 rounded-2xl border border-cyan-400/50 bg-slate-900/95 px-4 py-3 text-xs font-bold font-mono text-cyan-300 shadow-2xl shadow-cyan-500/25 backdrop-blur-md hover:bg-slate-800 hover:text-white hover:scale-105 active:scale-95 transition-all group"
        >
          <div className="relative">
            <MessageSquare className="h-4 w-4 text-cyan-400 group-hover:animate-bounce" />
            {chatTurns.length > 0 && (
              <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-cyan-400 text-[9px] font-black text-slate-950 shadow-sm">
                {chatTurns.length}
              </span>
            )}
          </div>
          <span>Multi-Turn Chat</span>
          <span className="rounded bg-cyan-950 px-1.5 py-0.5 text-[9px] text-cyan-300 border border-cyan-800 font-semibold">
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

        <footer className="mt-8 border-t border-shoal/12 bg-abyssal py-4">
          <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-4 text-xs text-fathom sm:flex-row sm:px-6 lg:px-8">
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-shoal" />
              <span className="font-semibold text-slate-300">
                ORCA-X — Ocean Reasoning &amp; Collaborative AI
              </span>
              <span className="font-mono text-[10px] text-fathom">
                | Smart India Hackathon
              </span>
            </div>
            <div className="max-w-xl text-center text-[11px] leading-tight sm:text-right">
              <strong className="text-slate-300">Statutory notice:</strong>{" "}
              {analysisData?.officialDisclaimer || dict.disclaimer}
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default ConsolePage;
