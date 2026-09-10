import React, { useEffect, useState } from "react";
import { AlertCircle, ArrowLeft, RefreshCw, MessageSquare, Activity } from "lucide-react";
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
import { OrcaAnalysisResponse, LanguageCode, ConversationTurn } from "../types";
import { COASTAL_LOCATIONS, MULTILINGUAL_DICTIONARY } from "../data/coastalData";
import { detectQueryLanguage } from "../utils/languageDetector";

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
  // Seventeen ports at equal weight is a wall. Show the few that are in
  // play and keep the rest one click away.
  const [showAllPorts, setShowAllPorts] = useState<boolean>(false);
  const PORTS_SHOWN = 5;

  const fetchAnalysis = async (
    queryText: string,
    locOverride?: string,
    timeOverride?: string,
    responseLanguage: LanguageCode = language,
    retryCount: number = 0,
  ) => {
    setIsLoading(true);
    // Only clear errorMessage on first attempt; keep previous analysisData for smooth UX
    if (retryCount === 0) {
      setErrorMessage(null);
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
        body: JSON.stringify({
          query: queryText,
          locationOverride: locOverride,
          timeOverride,
          language: effectiveLang,
          sessionId,
        }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          payload?.error || `Server returned status ${response.status}`,
        );
      }

      if (!payload?.weather || !payload?.ocean || !payload?.risk) {
        throw new Error(
          "ORCA returned an incomplete live-data analysis. No synthetic telemetry will be displayed.",
        );
      }

      const responsePayload = payload as OrcaAnalysisResponse;
      setAnalysisData(responsePayload);

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
      // Auto-retry once after 1 second for transient network or agent initialization blips
      if (retryCount < 1) {
        console.warn(`ORCA live-data transient hiccup, auto-retrying in 1s...`);
        setTimeout(() => {
          fetchAnalysis(queryText, locOverride, timeOverride, responseLanguage, retryCount + 1);
        }, 1000);
        return;
      }

      const message =
        err instanceof Error ? err.message : "Unable to retrieve live ORCA data.";
      console.error("ORCA live-data request failed:", message);
      // Only nullify analysisData if there was none previously to prevent layout flashing
      setAnalysisData((prev) => prev);
      setErrorMessage(message);
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalysis("Is it safe for small fishing boats near Digha right now?");
  }, []);

  const handleLocationSelect = (locKey: string) => {
    const loc = COASTAL_LOCATIONS[locKey];
    if (loc)
      fetchAnalysis(
        `Is it safe for small fishing boats near ${loc.name} right now?`,
        locKey,
      );
  };

  const handleMapCoordinateClick = (lat: number, lon: number) => {
    fetchAnalysis(
      `Analyze live marine conditions at coordinates ${lat.toFixed(4)}°N, ${lon.toFixed(4)}°E`,
      `${lat.toFixed(4)},${lon.toFixed(4)}`
    );
  };

  const dict = MULTILINGUAL_DICTIONARY[language] || MULTILINGUAL_DICTIONARY.en;

  return (
    <div className="flex min-h-screen flex-col bg-abyssal text-chartpaper lg:flex-row">
      <LeftNavbar
        currentTab={currentTab}
        setCurrentTab={setCurrentTab}
        language={language}
        setLanguage={(nextLanguage) => {
          setLanguage(nextLanguage);
          if (analysisData)
            fetchAnalysis(analysisData.originalQuery, undefined, undefined, nextLanguage);
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
          <div className="flex items-center space-x-2 horizontal-snap-carousel overflow-x-auto py-2.5 px-4 orca-glass-panel rounded-xl text-xs font-mono shadow-lg scrollbar-thin scrollbar-thumb-slate-700">
            <span className="text-[11px] text-cyan-400 font-bold uppercase tracking-wider shrink-0 flex items-center gap-1.5 px-1 pr-2 border-r border-slate-800">
              <span className="h-2 w-2 rounded-full bg-emerald-400"></span>
              <span>Coastal Ports:</span>
            </span>
            {(() => {
              // The selected port is always shown, wherever it sits in the
              // list — collapsing it away would hide the one that matters.
              const allKeys = Object.keys(COASTAL_LOCATIONS);
              const selectedKey = allKeys.find((k) => {
                const l = COASTAL_LOCATIONS[k];
                const name = analysisData?.location.name?.toLowerCase() ?? '';
                return l && (name.includes(l.name.toLowerCase()) || name.includes(k));
              });
              const head = allKeys.slice(0, PORTS_SHOWN);
              if (selectedKey && !head.includes(selectedKey)) head[PORTS_SHOWN - 1] = selectedKey;
              return showAllPorts ? allKeys : head;
            })().map((key) => {
              const loc = COASTAL_LOCATIONS[key];
              if (!loc) return null;
              const isSelected = analysisData?.location.name.toLowerCase().includes(loc.name.toLowerCase()) || analysisData?.location.name.toLowerCase().includes(key);
              return (
                <button
                  key={key}
                  onClick={() => handleLocationSelect(key)}
                  className={`min-h-[38px] px-3 py-1.5 rounded-xl text-xs whitespace-nowrap transition-colors flex items-center gap-1.5 active:scale-95 shrink-0 ${isSelected
                      ? 'bg-cyan-400 text-slate-950 font-bold border border-cyan-300'
                      : 'bg-transparent text-slate-400 hover:text-slate-100 hover:bg-slate-800/60 border border-slate-800'
                    }`}
                >
                  <span>{loc.name.split('/')[0].split(' ')[0]}</span>
                  <span className="text-[10px] font-mono opacity-60">{loc.latitude.toFixed(1)}°N</span>
                </button>
              );
            })}

            {Object.keys(COASTAL_LOCATIONS).length > PORTS_SHOWN && (
              <button
                onClick={() => setShowAllPorts((v) => !v)}
                className="min-h-[38px] shrink-0 rounded-xl border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-400 transition-colors hover:border-slate-500 hover:text-slate-200"
              >
                {showAllPorts
                  ? 'Show fewer'
                  : `+${Object.keys(COASTAL_LOCATIONS).length - PORTS_SHOWN} more ports`}
              </button>
            )}

            <button
              onClick={() => setIsHealthModalOpen(true)}
              title="Inspect multi-service connectivity & fallback health"
              className="ml-auto shrink-0 flex items-center gap-1.5 rounded-xl border border-cyan-500/30 bg-slate-950/80 px-3 py-2 text-xs font-mono text-cyan-300 hover:bg-slate-900 hover:text-white hover:border-cyan-400 transition-all active:scale-95"
            >
              <Activity className="h-3.5 w-3.5 text-emerald-400" />
              <span className="hidden sm:inline">System Diagnostics</span>
            </button>
          </div>

          {/* Maritime Audio Siren & Multi-lingual Warning Voice Controller */}
          <AudioAlertController
            language={language}
            geofenceAnalysis={analysisData?.geofenceAnalysis || analysisData?.gisLayers?.geofenceAnalysis}
            risk={analysisData?.risk}
          />

          {isLoading && (
            <div className="flex items-center gap-3 rounded-xl border border-cyan-500/30 orca-glass-panel p-3.5 shadow-md">
              <RefreshCw className="h-4 w-4 shrink-0 animate-spin text-cyan-400" />
              <div className="text-xs">
                <span className="font-mono font-bold tracking-wider text-cyan-400 uppercase">
                  PIPELINE RUNNING&nbsp;
                </span>
                <span className="text-slate-300">
                  {dict.processing} — live weather and marine observations, Copernicus catalogue, BGE-M3 retrieval, risk engine.
                </span>
              </div>
            </div>
          )}

          {errorMessage && !isLoading && (
            <div className="flex items-start gap-3 rounded-sm border border-red-500/35 bg-red-950/25 p-4">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
              <div>
                <p className="text-sm font-semibold text-red-300">
                  Live marine data {dict.unavailable ? dict.unavailable.toLowerCase() : 'unavailable'}
                </p>
                <p className="mt-1 text-xs text-slate-300">{errorMessage}</p>
                <p className="mt-2 text-[11px] text-fathom">
                  ORCA-X does not substitute synthetic weather or ocean
                  measurements when a live provider fails.
                </p>
              </div>
            </div>
          )}

          {analysisData ? (
            <>
              {currentTab === "dashboard" && (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                    <div className="space-y-4 lg:col-span-5">
                      <QueryPanel
                        onSearch={(q, loc, time, detectedLang) => fetchAnalysis(q, loc, time, detectedLang || language)}
                        isLoading={isLoading}
                        language={language}
                        onOpenChat={() => setIsChatDrawerOpen(true)}
                        activeLocationName={analysisData?.location.name}
                        activeLocationKey={analysisData ? Object.keys(COASTAL_LOCATIONS).find(k => COASTAL_LOCATIONS[k].name === analysisData.location.name) : undefined}
                        activeQuery={analysisData?.originalQuery}
                      />
                      <MarineTelemetry
                        weather={analysisData.weather}
                        ocean={analysisData.ocean}
                        satellite={analysisData.satellite}
                        language={language}
                      />
                    </div>
                    <div className="space-y-4 lg:col-span-7">
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
                        onSelectLocation={handleLocationSelect}
                        onCoordinateClick={handleMapCoordinateClick}
                        language={language}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                    <div className="lg:col-span-6">
                      <FeatureContributions risk={analysisData.risk} language={language} />
                    </div>
                    <div className="lg:col-span-6">
                      <AgentExecutionTimeline
                        traces={analysisData.agentTraces}
                        queryId={analysisData.queryId}
                        language={language}
                      />
                    </div>
                  </div>

                  <GroundedEvidenceDrawer
                    evidence={analysisData.evidence}
                    groundedSummary={analysisData.groundedSummary}
                    language={language}
                  />
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
                    onSelectLocation={handleLocationSelect}
                    onCoordinateClick={handleMapCoordinateClick}
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
                    onSelectLocation={handleLocationSelect}
                    onCoordinateClick={handleMapCoordinateClick}
                    language={language}
                  />
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center space-y-4 py-24 text-center">
              {isLoading ? (
                <RefreshCw className="h-7 w-7 animate-spin text-shoal" />
              ) : (
                <AlertCircle className="h-7 w-7 text-red-400" />
              )}
              <p className="font-mono text-xs tracking-wide text-fathom">
                {isLoading
                  ? "Connecting to live marine intelligence services…"
                  : "No live analysis yet. Start the API on port 3000, then retry."}
              </p>
              {!isLoading && errorMessage && (
                <button
                  className="rounded-sm border border-shoal/35 px-5 py-2.5 font-mono text-[10px] uppercase tracking-[0.2em] text-shoal transition-colors hover:border-shoal/70 hover:bg-shoal/8"
                  onClick={() =>
                    fetchAnalysis(
                      "Is it safe for small fishing boats near Digha right now?",
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
          turns={chatTurns}
          isLoading={isLoading}
          onSendMessage={(query) => fetchAnalysis(query)}
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

