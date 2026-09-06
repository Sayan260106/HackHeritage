import React, { useEffect, useState } from "react";
import { AlertCircle, ArrowLeft, RefreshCw } from "lucide-react";
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
import { OrcaAnalysisResponse, LanguageCode } from "../types";
import { COASTAL_LOCATIONS, MULTILINGUAL_DICTIONARY } from "../data/coastalData";

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

  const fetchAnalysis = async (
    queryText: string,
    locOverride?: string,
    timeOverride?: string,
    responseLanguage: LanguageCode = language,
  ) => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/orca/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: queryText,
          locationOverride: locOverride,
          timeOverride,
          language: responseLanguage,
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

      setAnalysisData(payload as OrcaAnalysisResponse);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unable to retrieve live ORCA data.";
      console.error("ORCA live-data request failed:", message);
      setAnalysisData(null);
      setErrorMessage(message);
    } finally {
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
          <div className="flex items-center space-x-2 horizontal-snap-carousel py-2.5 px-4 orca-glass-panel rounded-xl text-xs font-mono shadow-lg">
            <span className="text-[11px] text-cyan-400 font-bold uppercase tracking-wider shrink-0 flex items-center gap-1.5 px-1">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse"></span>
              <span>Coastal Ports:</span>
            </span>
            {['digha', 'puri', 'paradeep', 'visakhapatnam', 'kochi', 'chennai', 'mumbai'].map((key) => {
              const loc = COASTAL_LOCATIONS[key];
              if (!loc) return null;
              const isSelected = analysisData?.location.name.toLowerCase().includes(key);
              return (
                <button
                  key={key}
                  onClick={() => handleLocationSelect(key)}
                  className={`min-h-[44px] px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all flex items-center space-x-1.5 active:scale-95 ${
                    isSelected
                      ? 'bg-cyan-400 text-slate-950 shadow-md shadow-cyan-400/30 font-black border border-cyan-300'
                      : 'bg-slate-900 text-slate-200 hover:text-white hover:bg-slate-800 border border-slate-700'
                  }`}
                >
                  <span>{loc.name.split(' ')[0]}</span>
                  <span className="text-[10px] opacity-80 font-mono">({loc.latitude.toFixed(1)}°N)</span>
                </button>
              );
            })}
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
                        onSearch={(q, loc, time) => fetchAnalysis(q, loc, time)}
                        isLoading={isLoading}
                        language={language}
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
