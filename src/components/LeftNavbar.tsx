import React, { useState, useEffect } from 'react';
import {
  Waves,
  Compass,
  Activity,
  Globe,
  ShieldCheck,
  Satellite,
  SlidersHorizontal,
  BookOpen,
  Menu,
  X,
  ArrowLeft
} from 'lucide-react';
import { LanguageCode } from '../types';
import { MULTILINGUAL_DICTIONARY } from '../data/coastalData';

type TabId = 'dashboard' | 'analysis' | 'satellite' | 'evidence' | 'simulator';

interface LeftNavbarProps {
  currentTab: TabId;
  setCurrentTab: (tab: TabId) => void;
  language: LanguageCode;
  setLanguage: (lang: LanguageCode) => void;
  isProcessing?: boolean;
  /** Returns to the project brief. */
  onExit?: () => void;
}

const languages: { code: LanguageCode; label: string; native: string }[] = [
  { code: 'en', label: 'English', native: 'English' },
  { code: 'bn', label: 'Bengali', native: 'বাংলা' },
  { code: 'hi', label: 'Hindi', native: 'हिन्दी' },
  { code: 'ta', label: 'Tamil', native: 'தமிழ்' },
  { code: 'or', label: 'Odia', native: 'ଓଡ଼ିଆ' },
  { code: 'te', label: 'Telugu', native: 'తెలుగు' },
  { code: 'ml', label: 'Malayalam', native: 'മലയാളം' },
  { code: 'gu', label: 'Gujarati', native: 'ગુજરાતી' },
  { code: 'mr', label: 'Marathi', native: 'मराठी' },
  { code: 'kn', label: 'Kannada', native: 'ಕನ್ನಡ' }
];

const navItems: {
  id: TabId;
  label: string;
  description: string;
  icon: React.ElementType;
  badge?: string;
}[] = [
  {
    id: 'dashboard',
    label: 'Mission Control',
    description: 'Advisory, telemetry and live chart',
    icon: Compass,
    badge: 'LIVE'
  },
  {
    id: 'analysis',
    label: 'Risk Drivers',
    description: 'Feature attribution behind the score',
    icon: Activity
  },
  {
    id: 'satellite',
    label: 'Satellite Passes',
    description: 'Copernicus Sentinel catalogue',
    icon: Satellite,
    badge: 'SAR'
  },
  {
    id: 'evidence',
    label: 'Authority Corpus',
    description: 'INCOIS, IMD and NDMA guidance',
    icon: BookOpen
  },
  {
    id: 'simulator',
    label: 'What-If Studio',
    description: 'Perturb conditions against the engine',
    icon: SlidersHorizontal
  }
];

/** ORCA-X wordmark: a sounding mark struck over a contour. */
const Wordmark: React.FC<{ compact?: boolean }> = ({ compact = false }) => (
  <div className="flex items-center gap-3">
    <span className="flex h-9 w-9 shrink-0 items-center justify-center border border-shoal/35 bg-shoal/10">
      <Waves className="h-4 w-4 text-shoal" />
    </span>
    <div className="min-w-0">
      <div className="flex items-baseline gap-2">
        <span className="font-display text-lg font-bold tracking-tight text-chartpaper">
          ORCA&#8209;X
        </span>
        <span className="font-mono text-[9px] tracking-[0.16em] text-buoy/85">
          v2.4
        </span>
      </div>
      {!compact && (
        <p className="mt-0.5 truncate font-mono text-[9.5px] tracking-[0.14em] text-fathom">
          OCEAN REASONING AI
        </p>
      )}
    </div>
  </div>
);

/**
 * The three sub-views below live at module scope on purpose. The sidebar
 * re-renders once a second to advance its clocks; declaring these inline would
 * hand React a new component type on every tick and remount the subtree,
 * closing the language `<select>` under the operator's cursor.
 */

const StatusLamp: React.FC<{ isProcessing: boolean; language?: LanguageCode }> = ({ isProcessing, language = 'en' }) => {
  const dict = MULTILINGUAL_DICTIONARY[language] || MULTILINGUAL_DICTIONARY.en;
  return (
  <span className="flex items-center gap-2">
    <span className="relative flex h-1.5 w-1.5">
      {isProcessing && (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-buoy/70" />
      )}
      <span
        className={`relative inline-flex h-1.5 w-1.5 rounded-full ${
          isProcessing ? 'bg-buoy' : 'bg-emerald-400'
        }`}
      />
    </span>
    <span className="font-mono text-[9.5px] tracking-[0.18em] text-fathom">
      {isProcessing ? dict.running : dict.standingBy}
    </span>
  </span>
  );
};

const LanguageField: React.FC<{
  id: string;
  language: LanguageCode;
  setLanguage: (lang: LanguageCode) => void;
}> = ({ id, language, setLanguage }) => {
  const dict = MULTILINGUAL_DICTIONARY[language] || MULTILINGUAL_DICTIONARY.en;
  return (
  <div>
    <label
      htmlFor={id}
      className="mb-2 flex items-center justify-between font-mono text-[9.5px] uppercase tracking-[0.18em] text-fathom"
    >
      <span className="flex items-center gap-1.5">
        <Globe className="h-3 w-3 text-shoal" />
        {dict.languageLabel}
      </span>
      <span className="text-buoy">{language}</span>
    </label>
    <select
      id={id}
      value={language}
      onChange={(e) => setLanguage(e.target.value as LanguageCode)}
      className="w-full cursor-pointer appearance-none border border-shoal/20 bg-shelf/60 px-3 py-2 font-mono text-[11px] text-slate-200 transition-colors hover:border-shoal/50 focus:border-shoal"
    >
      {languages.map((lang) => (
        <option key={lang.code} value={lang.code} className="bg-shelf text-slate-200">
          {lang.native} — {lang.label}
        </option>
      ))}
    </select>
  </div>
  );
};

const NavList: React.FC<{
  currentTab: TabId;
  setCurrentTab: (tab: TabId) => void;
  onNavigate?: () => void;
  language?: LanguageCode;
}> = ({ currentTab, setCurrentTab, onNavigate, language = 'en' }) => {
  const dict = MULTILINGUAL_DICTIONARY[language] || MULTILINGUAL_DICTIONARY.en;
  const labels: Record<TabId, string> = {
    dashboard: dict.missionTitle,
    analysis: dict.riskScore,
    satellite: dict.satelliteIntelligence,
    evidence: dict.evidenceGrounding,
    simulator: dict.whatIfSimulation
  };
  const descriptions: Record<TabId, string> = {
    dashboard: `${dict.recommendations}, ${dict.telemetryTitle}`,
    analysis: dict.factors,
    satellite: dict.satelliteLayer,
    evidence: dict.citations,
    simulator: dict.simulatorTitle
  };
  return (
  <nav className="space-y-0.5">
    {navItems.map((item) => {
      const Icon = item.icon;
      const isActive = currentTab === item.id;

      return (
        <button
          key={item.id}
          id={`left-nav-tab-${item.id}`}
          aria-current={isActive ? 'page' : undefined}
          onClick={() => {
            setCurrentTab(item.id);
            onNavigate?.();
          }}
          /* Active module reads as a plotted fix: a shoal rule and a lifted plate. */
          className={[
            'group flex w-full items-center justify-between gap-3 border-l-2 py-2.5 pl-3.5 pr-3 text-left transition-colors duration-200',
            isActive
              ? 'border-shoal bg-shoal/10 text-chartpaper'
              : 'border-transparent text-slate-300 hover:border-shoal/40 hover:bg-shoal/5 hover:text-chartpaper'
          ].join(' ')}
        >
          <span className="flex min-w-0 items-center gap-3">
            <Icon
              className={`h-4 w-4 shrink-0 transition-colors ${
                isActive ? 'text-shoal' : 'text-fathom group-hover:text-shoal'
              }`}
            />
            <span className="min-w-0">
              <span className="block truncate text-[12.5px] font-medium leading-tight">
                {labels[item.id]}
              </span>
              <span className="mt-0.5 block truncate text-[10.5px] leading-tight text-fathom">
                {descriptions[item.id]}
              </span>
            </span>
          </span>

          {item.badge && (
            <span
              className={`shrink-0 border px-1.5 py-0.5 font-mono text-[8.5px] tracking-[0.12em] ${
                isActive ? 'border-shoal/45 text-shoal' : 'border-slate-700 text-fathom'
              }`}
            >
              {item.badge}
            </span>
          )}
        </button>
      );
    })}
  </nav>
  );
};

/** Returns to the project brief. Shown in both the drawer and the sidebar. */
const BriefLink: React.FC<{ onExit: () => void; size?: 'sm' | 'xs'; language?: LanguageCode }> = ({
  onExit,
  size = 'xs',
  language = 'en'
}) => (
  <button
    onClick={onExit}
    className={`group flex items-center gap-2 font-mono ${
      size === 'sm' ? 'text-[10px]' : 'text-[9.5px]'
    } uppercase tracking-[0.18em] text-fathom transition-colors hover:text-shoal`}
  >
    <ArrowLeft className="h-3.5 w-3.5 transition-transform duration-300 group-hover:-translate-x-1" />
    {(MULTILINGUAL_DICTIONARY[language] || MULTILINGUAL_DICTIONARY.en).projectBrief}
  </button>
);

export const LeftNavbar: React.FC<LeftNavbarProps> = ({
  currentTab,
  setCurrentTab,
  language,
  setLanguage,
  isProcessing = false,
  onExit
}) => {
  const [timeUtc, setTimeUtc] = useState<string>('');
  const [timeIst, setTimeIst] = useState<string>('');
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);

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

  /** The two clocks an operator works against. */
  const Clocks = (
    <>
      <div className="flex justify-between">
        <span>IST</span>
        <span className="tabular-nums text-slate-300">{timeIst}</span>
      </div>
      <div className="flex justify-between">
        <span>UTC</span>
        <span className="tabular-nums">{timeUtc}</span>
      </div>
    </>
  );

  return (
    <>
      {/* ---- Mobile top bar --------------------------------------------- */}
      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-shoal/12 bg-abyssal/95 px-4 py-3 backdrop-blur-md lg:hidden">
        <Wordmark compact />
        <div className="flex items-center gap-3">
          <StatusLamp isProcessing={isProcessing} language={language} />
          <button
            id="mobile-nav-toggle"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="border border-shoal/20 p-2 text-slate-300 transition-colors hover:border-shoal/50 hover:text-chartpaper"
            aria-label="Toggle navigation"
            aria-expanded={mobileMenuOpen}
          >
            {mobileMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </header>

      {/* ---- Mobile drawer ---------------------------------------------- */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-50 flex bg-abyssal/80 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        >
          <div
            className="flex h-full w-72 max-w-[85vw] flex-col justify-between overflow-y-auto border-r border-shoal/15 bg-abyssal p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-7">
              <div className="flex items-center justify-between border-b border-shoal/12 pb-5">
                <Wordmark />
                <button
                  onClick={() => setMobileMenuOpen(false)}
                  className="p-1 text-fathom transition-colors hover:text-chartpaper"
                  aria-label="Close navigation"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {onExit && (
                <BriefLink
                  size="sm"
                  language={language}
                  onExit={() => {
                    setMobileMenuOpen(false);
                    onExit();
                  }}
                />
              )}

              <NavList
                currentTab={currentTab}
                setCurrentTab={setCurrentTab}
                language={language}
                onNavigate={() => setMobileMenuOpen(false)}
              />
              <LanguageField
                id="drawer-language-selector"
                language={language}
                setLanguage={setLanguage}
              />
            </div>

            <div className="mt-8 space-y-1 border-t border-shoal/12 pt-5 font-mono text-[10px] text-fathom">
              {Clocks}
            </div>
          </div>
        </div>
      )}

      {/* ---- Mobile Sticky Bottom Thumb Navigation Dock (Section 2A) ---- */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-between border-t border-cyan-500/30 bg-slate-950/90 px-2 py-1.5 backdrop-blur-xl lg:hidden shadow-[0_-8px_30px_rgba(0,0,0,0.7)]">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setCurrentTab(item.id)}
              className={`relative flex flex-col items-center justify-center min-h-[52px] flex-1 py-1 px-1 rounded-xl transition-all btn-micro-interactive ${
                isActive
                  ? 'bg-slate-800/80 text-white font-bold border border-slate-700/60 shadow-sm'
                  : 'text-slate-500 hover:text-slate-300 active:scale-95'
              }`}
            >
              {isActive && (
                <span className="absolute -top-1 h-1 w-6 rounded-full bg-slate-300" />
              )}
              <Icon className={`h-5 w-5 ${isActive ? 'text-white' : 'text-slate-500'}`} />
              <span className="text-[9.5px] tracking-tight mt-1 font-mono truncate max-w-[62px]">
                {item.label.split(' ')[0]}
              </span>
            </button>
          );
        })}
        {/* Mobile Compact Language Selector */}
        <div className="flex flex-col items-center justify-center min-h-[52px] px-1">
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value as LanguageCode)}
            className="bg-slate-900/90 text-cyan-300 font-mono font-bold border border-cyan-500/40 text-[10px] rounded-xl px-2 py-2.5 cursor-pointer focus:outline-none focus:ring-1 focus:ring-cyan-400 shadow-sm"
          >
            {languages.map((l) => (
              <option key={l.code} value={l.code} className="bg-slate-900 text-slate-200">
                {l.code.toUpperCase()}
              </option>
            ))}
          </select>
        </div>
      </nav>

      {/* ---- Desktop sidebar -------------------------------------------- */}
      <aside
        id="left-sidebar-navigation"
        className="sticky top-0 z-30 hidden h-screen w-64 shrink-0 flex-col justify-between overflow-y-auto border-r border-shoal/12 bg-abyssal lg:flex xl:w-72"
      >
        <div className="space-y-7 p-5">
          <Wordmark />

          {onExit && <BriefLink onExit={onExit} language={language} />}

          <div className="border border-shoal/15 bg-shelf/40 p-3.5">
            <div className="flex items-center justify-between">
              <StatusLamp isProcessing={isProcessing} language={language} />
              <span className="font-mono text-[8.5px] tracking-[0.14em] text-emerald-400">
                LIVE FEED
              </span>
            </div>
            <div className="mt-3 space-y-1 font-mono text-[10.5px] text-fathom">
              {Clocks}
            </div>
          </div>

          <div>
            <p className="plate-label mb-3 pl-3.5">{dict.modules}</p>
            <NavList currentTab={currentTab} setCurrentTab={setCurrentTab} language={language} />
          </div>
        </div>

        <div className="space-y-5 border-t border-shoal/12 p-5">
          <LanguageField
            id="sidebar-language-selector"
            language={language}
            setLanguage={setLanguage}
          />

          <p className="text-[10.5px] leading-snug text-fathom">{dict.missionSubtitle}</p>

          <div className="flex items-center justify-between border-t border-shoal/12 pt-4 font-mono text-[9.5px] tracking-[0.12em] text-fathom">
            <span>INCOIS · IMD · NOAA</span>
            <span className="flex items-center gap-1 text-shoal">
              <ShieldCheck className="h-3 w-3" />
              CITED
            </span>
          </div>
        </div>
      </aside>
    </>
  );
};
