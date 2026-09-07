import React, { useState, useEffect } from 'react';
import { 
  Waves, 
  Compass, 
  Activity, 
  Globe, 
  ShieldCheck, 
  Layers, 
  Satellite, 
  Cpu, 
  SlidersHorizontal, 
  BookOpen,
  Radio,
  Clock,
  Volume2,
  VolumeX
} from 'lucide-react';
import { LanguageCode } from '../types';
import { MULTILINGUAL_DICTIONARY } from '../data/coastalData';
import { hydrophoneEngine } from '../services/hydrophoneAudio';
import { OrcaWaveLogo } from './ui/OrcaWaveLogo';
import { OrcaWordmark } from './ui/OrcaWordmark';

interface HeaderProps {
  currentTab: 'dashboard' | 'analysis' | 'satellite' | 'evidence' | 'simulator';
  setCurrentTab: (tab: 'dashboard' | 'analysis' | 'satellite' | 'evidence' | 'simulator') => void;
  language: LanguageCode;
  setLanguage: (lang: LanguageCode) => void;
  isProcessing?: boolean;
  onExit?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentTab,
  setCurrentTab,
  language,
  setLanguage,
  isProcessing = false,
  onExit
}) => {
  const [timeUtc, setTimeUtc] = useState<string>('');
  const [timeIst, setTimeIst] = useState<string>('');
  const [isAudioActive, setIsAudioActive] = useState<boolean>(false);

  useEffect(() => {
    const unsubscribe = hydrophoneEngine.subscribe((active) => {
      setIsAudioActive(active);
    });
    return () => unsubscribe();
  }, []);

  const handleToggleAudio = () => {
    hydrophoneEngine.toggleAudio();
  };

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTimeUtc(now.toUTCString().slice(17, 25) + ' UTC');
      setTimeIst(
        now.toLocaleTimeString('en-IN', {
          timeZone: 'Asia/Kolkata',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false
        }) + ' IST'
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const dict = MULTILINGUAL_DICTIONARY[language] || MULTILINGUAL_DICTIONARY.en;

  const languages: { code: LanguageCode; label: string; native: string }[] = [
    { code: 'en', label: 'English', native: 'English' },
    { code: 'bn', label: 'Bengali', native: 'বাংলা' },
    { code: 'hi', label: 'Hindi', native: 'हिन्दी' },
    { code: 'ta', label: 'Tamil', native: 'தமிழ்' },
    { code: 'or', label: 'Odia', native: 'ଓଡ଼ିଆ' },
    { code: 'te', label: 'Telugu', native: 'తెలుగు' }
  ];

  return (
    <header className="border-b border-slate-800 bg-slate-950/90 backdrop-blur-md sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          
          {/* Logo & Identity */}
          <div className="flex items-center space-x-3">
            <OrcaWaveLogo size="lg" variant="console" className="shrink-0" />
            <OrcaWordmark
              size="lg"
              badge="v2.4 SIH"
              subtitle={dict.missionSubtitle}
            />
          </div>

          {/* Navigation Tabs */}
          <nav className="hidden md:flex items-center space-x-1 bg-slate-900/90 p-1 rounded-xl border border-slate-800">
            <button
              id="tab-dashboard"
              onClick={() => setCurrentTab('dashboard')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                currentTab === 'dashboard'
                  ? 'bg-cyan-500 text-slate-950 shadow-sm shadow-cyan-500/50'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <Compass className="h-3.5 w-3.5" />
              <span>Mission Control</span>
            </button>

            <button
              id="tab-analysis"
              onClick={() => setCurrentTab('analysis')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                currentTab === 'analysis'
                  ? 'bg-cyan-500 text-slate-950 shadow-sm shadow-cyan-500/50'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <Activity className="h-3.5 w-3.5" />
              <span>ML Risk Drivers</span>
            </button>

            <button
              id="tab-satellite"
              onClick={() => setCurrentTab('satellite')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                currentTab === 'satellite'
                  ? 'bg-cyan-500 text-slate-950 shadow-sm shadow-cyan-500/50'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <Satellite className="h-3.5 w-3.5" />
              <span>Satellite GIS</span>
            </button>

            <button
              id="tab-evidence"
              onClick={() => setCurrentTab('evidence')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                currentTab === 'evidence'
                  ? 'bg-cyan-500 text-slate-950 shadow-sm shadow-cyan-500/50'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <BookOpen className="h-3.5 w-3.5" />
              <span>RAG Corpus</span>
            </button>

            <button
              id="tab-simulator"
              onClick={() => setCurrentTab('simulator')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                currentTab === 'simulator'
                  ? 'bg-cyan-500 text-slate-950 shadow-sm shadow-cyan-500/50'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              <span>What-If Studio</span>
            </button>
          </nav>

          {/* Right Status & Language Controls */}
          <div className="flex items-center space-x-3">
            
            {/* Live Clock / UTC */}
            <div className="hidden lg:flex flex-col items-end text-[11px] font-mono text-slate-400 border-r border-slate-800 pr-3">
              <div className="flex items-center space-x-1 text-slate-300">
                <Clock className="h-3 w-3 text-cyan-400" />
                <span>{timeIst}</span>
              </div>
              <span className="text-[10px] text-slate-500">{timeUtc}</span>
            </div>

            {/* Agent / Ingestion Status */}
            <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-slate-900 border border-slate-800 text-xs">
              <span className={`h-2 w-2 rounded-full ${isProcessing ? 'bg-amber-400 animate-ping' : 'bg-emerald-400 shadow-sm shadow-emerald-400/50'}`} />
              <span className="text-[11px] font-mono text-slate-300 hidden sm:inline">
                {isProcessing ? 'SYNTHESIZING...' : 'COP-NOAA ONLINE'}
              </span>
            </div>

            {/* Language Selector */}
            <div className="relative">
              <select
                id="language-selector"
                value={language}
                onChange={(e) => setLanguage(e.target.value as LanguageCode)}
                className="bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded-lg px-2.5 py-1.5 font-medium focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500 cursor-pointer appearance-none pr-7"
              >
                {languages.map((lang) => (
                  <option key={lang.code} value={lang.code} className="bg-slate-900 text-slate-200">
                    {lang.native} ({lang.label})
                  </option>
                ))}
              </select>
              <Globe className="h-3.5 w-3.5 text-slate-400 absolute right-2 top-2 pointer-events-none" />
            </div>

            {/* Hydrophone Audio Toggle */}
            <button
              id="hydrophone-audio-toggle"
              onClick={handleToggleAudio}
              title={isAudioActive ? "Hydrophone Ambiance: Active (Click to mute)" : "Hydrophone Ambiance: Muted (Click to enable ocean audio)"}
              className={`flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all border ${
                isAudioActive
                  ? "bg-cyan-950/80 border-cyan-500/80 text-cyan-300 shadow-md shadow-cyan-500/20"
                  : "bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-600"
              }`}
            >
              {isAudioActive ? (
                <>
                  <Volume2 className="h-4 w-4 text-cyan-400 animate-pulse" />
                  <span className="text-[11px] font-mono hidden xl:inline text-cyan-300">
                    HYDROPHONE ON
                  </span>
                  <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-ping" />
                </>
              ) : (
                <>
                  <VolumeX className="h-4 w-4 text-slate-400" />
                  <span className="text-[11px] font-mono hidden xl:inline">
                    HYDROPHONE OFF
                  </span>
                </>
              )}
            </button>

          </div>

        </div>

        {/* Mobile Navigation Tabs */}
        <div className="flex md:hidden items-center justify-between py-2 border-t border-slate-800/80 overflow-x-auto space-x-2">
          <button
            onClick={() => setCurrentTab('dashboard')}
            className={`px-3 py-1 text-xs rounded-md font-medium whitespace-nowrap ${currentTab === 'dashboard' ? 'bg-cyan-500 text-slate-950 font-bold' : 'text-slate-400 bg-slate-900'}`}
          >
            Mission
          </button>
          <button
            onClick={() => setCurrentTab('analysis')}
            className={`px-3 py-1 text-xs rounded-md font-medium whitespace-nowrap ${currentTab === 'analysis' ? 'bg-cyan-500 text-slate-950 font-bold' : 'text-slate-400 bg-slate-900'}`}
          >
            Risk Drivers
          </button>
          <button
            onClick={() => setCurrentTab('satellite')}
            className={`px-3 py-1 text-xs rounded-md font-medium whitespace-nowrap ${currentTab === 'satellite' ? 'bg-cyan-500 text-slate-950 font-bold' : 'text-slate-400 bg-slate-900'}`}
          >
            Satellite
          </button>
          <button
            onClick={() => setCurrentTab('evidence')}
            className={`px-3 py-1 text-xs rounded-md font-medium whitespace-nowrap ${currentTab === 'evidence' ? 'bg-cyan-500 text-slate-950 font-bold' : 'text-slate-400 bg-slate-900'}`}
          >
            RAG Corpus
          </button>
          <button
            onClick={() => setCurrentTab('simulator')}
            className={`px-3 py-1 text-xs rounded-md font-medium whitespace-nowrap ${currentTab === 'simulator' ? 'bg-cyan-500 text-slate-950 font-bold' : 'text-slate-400 bg-slate-900'}`}
          >
            Simulator
          </button>
        </div>

      </div>
    </header>
  );
};
