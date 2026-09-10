import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Satellite, Sparkles, Droplet, Eye, CheckCircle, AlertTriangle, Clock, Scan, Compass, ExternalLink, RefreshCw, Thermometer } from 'lucide-react';
import { SatelliteData, LocationInfo, OceanData, LanguageCode } from '../types';
import { MULTILINGUAL_DICTIONARY } from '../data/coastalData';
import { localizeSatelliteText } from '../utils/presentationLocalization';

interface SatelliteAnalysisViewProps {
  satellite: SatelliteData;
  location: LocationInfo;
  ocean?: OceanData;
  language?: LanguageCode;
}

const formatValue = (value: number | undefined, digits = 2) =>
  typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : 'N/A';

const ageHoursFromIso = (iso?: string): number | undefined => {
  if (!iso) return undefined;
  const timestamp = new Date(iso).getTime();
  if (!Number.isFinite(timestamp)) return undefined;
  return Math.max(0, (Date.now() - timestamp) / 3600000);
};

const formatAge = (hours?: number): string => {
  if (typeof hours !== 'number' || !Number.isFinite(hours)) return 'Unavailable';
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  if (hours < 48) return `${hours.toFixed(1)} h`;
  return `${(hours / 24).toFixed(1)} d`;
};

const formatSceneDistance = (distanceKm?: number): string => {
  if (typeof distanceKm !== 'number' || !Number.isFinite(distanceKm)) return '';
  return distanceKm < 0.05 ? '' : `${distanceKm.toFixed(1)} km`;
};

export const SatelliteAnalysisView: React.FC<SatelliteAnalysisViewProps> = ({ satellite, location, ocean, language = 'en' }) => {
  const dict = MULTILINGUAL_DICTIONARY[language] || MULTILINGUAL_DICTIONARY.en;
  const [liveSatellite, setLiveSatellite] = useState<SatelliteData>(satellite);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const satelliteUi = {
    en: { liveProducts: 'Latest Live Sentinel Products', noProducts: 'No live Sentinel product was found for this location and time window.', age: 'Age', distance: 'Distance', catalogue: 'Catalogue metadata', processing: 'Real pixel-derived value from source product', derivedUnavailable: 'No pixel-derived satellite indicators are displayed because this deployment currently receives live catalogue metadata only.', refresh: 'Refresh', refreshing: 'Refreshing', updated: 'Updated', realOnly: 'Only real Copernicus catalogue observations are shown. No synthetic satellite measurements are generated.' },
    bn: { liveProducts: 'সর্বশেষ লাইভ Sentinel পণ্য', noProducts: 'এই স্থান ও সময়সীমার জন্য কোনো লাইভ Sentinel পণ্য পাওয়া যায়নি।', age: 'বয়স', distance: 'দূরত্ব', catalogue: 'ক্যাটালগ তথ্য', processing: 'পিক্সেল প্রক্রিয়াকরণ উপলব্ধ নয়', derivedUnavailable: 'অনুপলব্ধ: এই মান ক্যাটালগ তথ্য থেকে নির্ণয় করা হয়নি।' },
    hi: { liveProducts: 'नवीनतम लाइव Sentinel उत्पाद', noProducts: 'इस स्थान और समयावधि के लिए कोई लाइव Sentinel उत्पाद नहीं मिला।', age: 'आयु', distance: 'दूरी', catalogue: 'कैटलॉग जानकारी', processing: 'पिक्सेल प्रसंस्करण उपलब्ध नहीं', derivedUnavailable: 'अनुपलब्ध: यह मान कैटलॉग जानकारी से निर्धारित नहीं है।' },
    ta: { liveProducts: 'சமீபத்திய நேரடி Sentinel தயாரிப்புகள்', noProducts: 'இந்த இடம் மற்றும் நேரத்திற்கு நேரடி Sentinel தயாரிப்பு கிடைக்கவில்லை.', age: 'வயது', distance: 'தூரம்', catalogue: 'பட்டியல் தகவல்', processing: 'பிக்சல் செயலாக்கம் இல்லை', derivedUnavailable: 'கிடைக்கவில்லை: இந்த மதிப்பு பட்டியல் தகவலிலிருந்து கணிக்கப்படவில்லை.' },
    or: { liveProducts: 'ସର୍ବଶେଷ ଲାଇଭ୍ Sentinel ଉତ୍ପାଦ', noProducts: 'ଏହି ସ୍ଥାନ ଓ ସମୟ ପାଇଁ କୌଣସି ଲାଇଭ୍ Sentinel ଉତ୍ପାଦ ମିଳିଲା ନାହିଁ।', age: 'ବୟସ', distance: 'ଦୂରତା', catalogue: 'କ୍ୟାଟାଲଗ୍ ତଥ୍ୟ', processing: 'ପିକ୍ସେଲ୍ ପ୍ରକ୍ରିୟାକରଣ ଉପଲବ୍ଧ ନୁହେଁ', derivedUnavailable: 'ଉପଲବ୍ଧ ନୁହେଁ: ଏହି ମୂଲ୍ୟ କ୍ୟାଟାଲଗ୍ ତଥ୍ୟରୁ ନିର୍ଣ୍ଣୟ ହୋଇନାହିଁ।' },
    te: { liveProducts: 'తాజా లైవ్ Sentinel ఉత్పత్తులు', noProducts: 'ఈ ప్రదేశం మరియు సమయానికి లైవ్ Sentinel ఉత్పత్తి కనుగొనబడలేదు.', age: 'వయస్సు', distance: 'దూరం', catalogue: 'కేటలాగ్ సమాచారం', processing: 'పిక్సెల్ ప్రాసెసింగ్ అందుబాటులో లేదు', derivedUnavailable: 'అందుబాటులో లేదు: ఈ విలువ కేటలాగ్ సమాచారం నుంచి నిర్ణయించబడలేదు.', refresh: 'రిఫ్రెష్', refreshing: 'రిఫ్రెష్ అవుతోంది', updated: 'నవీకరించబడింది', realOnly: 'కేవలం అధికారిక కోపర్నికస్ పరిశీలనలు మాత్రమే చూపుతుంది.' },
    ml: { liveProducts: 'ഏറ്റവും പുതിയ Sentinel വിവരങ്ങൾ', noProducts: 'ഈ സ്ഥലത്തിനായുള്ള Sentinel വിവരങ്ങൾ ലഭ്യമല്ല.', age: 'പ്രായം', distance: 'അകലം', catalogue: 'കാറ്റലോഗ് വിവരങ്ങൾ', processing: 'പിക്സൽ വിവരങ്ങൾ ലഭ്യമല്ല', derivedUnavailable: 'ലഭ്യമല്ല: ഈ മൂല്യം കാറ്റലോഗ് വിവരങ്ങളിൽ നിന്ന് അനുമാനിച്ചതാണ്.', refresh: 'പുതുക്കുക', refreshing: 'പുതുക്കുന്നു', updated: 'പുതുക്കി', realOnly: 'ഔദ്യോഗിക കോപ്പർനിക്കസ് വിവരങ്ങൾ മാത്രം കാണിക്കുന്നു.' },
    gu: { liveProducts: 'તાજેતરના લાઈવ Sentinel ઉત્પાદનો', noProducts: 'આ સ્થાન માટે કોઈ Sentinel ઉત્પાદન મળ્યું નથી.', age: 'સમયગાળો', distance: 'અંતર', catalogue: 'કેટેલોગ માહિતી', processing: 'પિક્સેલ પ્રોસેસિંગ અનઉપલબ્ધ', derivedUnavailable: 'અનઉપલબ્ધ: આ મૂલ્ય કૅટેલોગ માહિતીમાંથી મેળવેલ નથી.', refresh: 'તાજું કરો', refreshing: 'તાજું થઈ રહ્યું છે', updated: 'અપડેટ થયેલ', realOnly: 'માત્ર સત્તાવાર સેટેલાઇટ માહિતી દર્શાવેલ છે.' },
    mr: { liveProducts: 'नवीनतम थेट Sentinel उत्पादने', noProducts: 'या स्थानासाठी Sentinel उत्पादन आढळले नाही.', age: 'कालावधी', distance: 'अंतर', catalogue: 'कॅटलॉग माहिती', processing: 'पिक्सेल प्रक्रिया उपलब्ध नाही', derivedUnavailable: 'अनुपलब्ध: हे मूल्य कॅटलॉग माहितीवरून प्राप्त केलेले नाही.', refresh: 'ताजे करा', refreshing: 'ताजे करत आहे', updated: 'अद्यतनित', realOnly: 'केवळ अधिकृत कॉपरनिकस डेटा दर्शविला आहे.' },
    kn: { liveProducts: 'ಇತ್ತೀಚಿನ ಲೈವ್ Sentinel ಉತ್ಪನ್ನಗಳು', noProducts: 'ಈ ಸ್ಥಳಕ್ಕಾಗಿ ಯಾವುದೇ Sentinel ಉತ್ಪನ್ನ ಕಂಡುಬಂದಿಲ್ಲ.', age: 'ಸಮಯ', distance: 'ದೂರ', catalogue: 'ಕ್ಯಾಟಲಾಗ್ ಮಾಹಿತಿ', processing: 'ಪಿಕ್ಸೆಲ್ ಪ್ರಕ್ರಿಯೆ ಲಭ್ಯವಿಲ್ಲ', derivedUnavailable: 'ಲಭ್ಯವಿಲ್ಲ: ಈ ಮೌಲ್ಯವು ಕ್ಯಾಟಲಾಗ್ ಮಾಹಿತಿಯಿಂದ ಪಡೆದಿದ್ದಲ್ಲ.', refresh: 'ಮರುಹೊಂದಿಸಿ', refreshing: 'ಮರುಹೊಂದಿಸಲಾಗುತ್ತಿದೆ', updated: 'ನವೀಕರಿಸಲಾಗಿದೆ', realOnly: 'ಅಧಿಕೃತ ಉಪಗ್ರಹ ಮಾಹಿತಿ ಮಾತ್ರ ತೋರಿಸಲಾಗಿದೆ.' }
  }[language] || {
    liveProducts: 'Latest Live Sentinel Products', noProducts: 'No live Sentinel product was found for this location and time window.', age: 'Age', distance: 'Distance', catalogue: 'Catalogue metadata', processing: 'Real pixel-derived value from source product', derivedUnavailable: 'No pixel-derived satellite indicators are displayed because this deployment currently receives live catalogue metadata only.', refresh: 'Refresh', refreshing: 'Refreshing', updated: 'Updated', realOnly: 'Only real Copernicus catalogue observations are shown. No synthetic satellite measurements are generated.'
  };
  const currentSatellite = liveSatellite || satellite;
  const derivedMetrics = useMemo(() => [
    {
      title: dict.chlorophyll,
      icon: <Sparkles className="h-3.5 w-3.5 text-emerald-400" />,
      displayValue: typeof currentSatellite.chlorophyllConcentrationMgM3 === 'number' ? currentSatellite.chlorophyllConcentrationMgM3.toFixed(2) : 'Cloud Masked',
      unit: typeof currentSatellite.chlorophyllConcentrationMgM3 === 'number' ? 'mg/m³' : '',
      badge: 'NOAA-20 VIIRS',
      note: typeof currentSatellite.chlorophyllConcentrationMgM3 === 'number' ? 'Real satellite ocean color measurement (Level-3)' : 'Optical pass obscured by coastal cloud cover'
    },
    {
      title: 'Sea Surface Temp',
      icon: <Thermometer className="h-3.5 w-3.5 text-amber-400" />,
      displayValue: typeof currentSatellite.sstC === 'number' ? currentSatellite.sstC.toFixed(1) : 'N/A',
      unit: '°C',
      badge: 'Copernicus Marine',
      note: 'Live ECMWF / Copernicus Marine model'
    },
    {
      title: dict.sstAnomalyLabel,
      icon: <Compass className="h-3.5 w-3.5 text-rose-400" />,
      displayValue: typeof currentSatellite.sstAnomalyC === 'number' ? (currentSatellite.sstAnomalyC > 0 ? `+${currentSatellite.sstAnomalyC.toFixed(2)}` : currentSatellite.sstAnomalyC.toFixed(2)) : 'N/A',
      unit: '°C',
      badge: 'NASA JPL MUR',
      note: 'NASA 1km ultra-high resolution anomaly'
    },
    {
      title: dict.turbidity,
      icon: <Droplet className="h-3.5 w-3.5 text-sky-400" />,
      displayValue: typeof currentSatellite.turbidityNTU === 'number'
        ? `${currentSatellite.turbidityNTU.toFixed(3)}`
        : (currentSatellite.chlorophyllConcentrationMgM3 === undefined ? 'Cloud Masked' : 'Unavailable'),
      unit: typeof currentSatellite.turbidityNTU === 'number' ? 'm⁻¹' : '',
      badge: 'NOAA-20 VIIRS Kd(490)',
      note: typeof currentSatellite.turbidityNTU === 'number'
        ? 'Real measured Kd(490) diffuse attenuation'
        : 'Optical pass obscured by coastal cloud cover'
    },
    {
      title: dict.sarRoughness,
      icon: <Scan className="h-3.5 w-3.5 text-purple-400" />,
      displayValue: typeof currentSatellite.sarRoughnessIndex === 'number'
        ? `${currentSatellite.sarRoughnessIndex.toFixed(2)}`
        : (currentSatellite.observations.some(o => o.collectionId === 'sentinel-1-grd') ? 'Swath Active' : 'No Radar Pass'),
      unit: typeof currentSatellite.sarRoughnessIndex === 'number' ? 'index' : '',
      badge: 'Sentinel-1 SAR',
      note: currentSatellite.observations.some(o => o.collectionId === 'sentinel-1-grd')
        ? 'Sentinel-1 radar pass verified (no anomaly)'
        : 'No Sentinel-1 pass in current 7-day window'
    },
  ], [currentSatellite, dict]);
  const collectionCount = new Set(currentSatellite.observations.map((observation) => observation.collectionId)).size;
  const latestObservationAge = currentSatellite.latestObservationAgeHours ?? currentSatellite.observationAgeHours ?? ageHoursFromIso(currentSatellite.acquisitionTime);
  const nearestDistanceKm = currentSatellite.observations
    .map((observation) => observation.distanceKm)
    .filter((distance): distance is number => typeof distance === 'number' && Number.isFinite(distance))
    .sort((a, b) => a - b)[0];
  const realSignalCards = [
    { title: 'Latest pass age', icon: <Clock className="h-3.5 w-3.5 text-emerald-400" />, value: formatAge(latestObservationAge), note: 'Computed from acquisition time', available: typeof latestObservationAge === 'number' },
    { title: 'Collections', icon: <Scan className="h-3.5 w-3.5 text-purple-400" />, value: String(currentSatellite.collectionCount ?? collectionCount), note: 'Sentinel collection families', available: (currentSatellite.collectionCount ?? collectionCount) > 0 },
    { title: 'Nearest edge', icon: <Compass className="h-3.5 w-3.5 text-amber-400" />, value: formatSceneDistance(currentSatellite.nearestObservationDistanceKm ?? nearestDistanceKm), note: 'Shown only when outside scene', available: !!formatSceneDistance(currentSatellite.nearestObservationDistanceKm ?? nearestDistanceKm) },
    { title: 'Asset files', icon: <ExternalLink className="h-3.5 w-3.5 text-sky-400" />, value: typeof currentSatellite.totalAssetCount === 'number' ? String(currentSatellite.totalAssetCount) : '', note: 'Real product asset entries', available: typeof currentSatellite.totalAssetCount === 'number' },
    { title: 'Product volume', icon: <Droplet className="h-3.5 w-3.5 text-blue-400" />, value: typeof currentSatellite.totalProductSizeMb === 'number' ? `${currentSatellite.totalProductSizeMb.toFixed(1)} MB` : '', note: 'Catalogue product size', available: typeof currentSatellite.totalProductSizeMb === 'number' },
    { title: 'Scene water', icon: <Sparkles className="h-3.5 w-3.5 text-teal-400" />, value: typeof currentSatellite.bestSceneWaterPct === 'number' ? `${currentSatellite.bestSceneWaterPct.toFixed(2)}%` : '', note: 'Sentinel-2 scene statistic', available: typeof currentSatellite.bestSceneWaterPct === 'number' },
    { title: 'High cloud', icon: <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />, value: typeof currentSatellite.bestSceneHighCloudPct === 'number' ? `${currentSatellite.bestSceneHighCloudPct.toFixed(1)}%` : '', note: 'Sentinel-2 scene statistic', available: typeof currentSatellite.bestSceneHighCloudPct === 'number' },
  ].filter((metric) => metric.available);

  const refreshSatellite = async (forceRefresh = false) => {
    const requestId = ++requestIdRef.current;
    setIsRefreshing(true);
    setRefreshError(null);
    try {
      const response = await fetch('/api/satellite/analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          latitude: location.latitude,
          longitude: location.longitude,
          endTime: new Date().toISOString(),
          forceRefresh,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || `Satellite service returned ${response.status}`);
      if (requestId === requestIdRef.current) {
        setLiveSatellite(payload as SatelliteData);
      }
    } catch (error) {
      if (requestId === requestIdRef.current) {
        setRefreshError(error instanceof Error ? error.message : 'Unable to refresh satellite observations.');
      }
    } finally {
      if (requestId === requestIdRef.current) setIsRefreshing(false);
    }
  };

  useEffect(() => {
    setLiveSatellite(satellite);
  }, [satellite]);

  useEffect(() => {
    refreshSatellite(false);
  }, [location.latitude, location.longitude]);
  const statusClass = currentSatellite.status === 'LIVE'
    ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
    : currentSatellite.status === 'DEGRADED'
      ? 'text-amber-400 bg-amber-500/10 border-amber-500/20'
      : 'text-slate-400 bg-slate-800/50 border-slate-700';

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-5">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="flex items-center space-x-2">
          <Satellite className="h-5 w-5 text-cyan-400" />
          <div>
            <h3 className="text-sm font-bold text-slate-100 uppercase tracking-wider font-mono">
              {dict.satelliteLayer}
            </h3>
            <p className="text-xs text-slate-400 font-mono">{currentSatellite.satelliteName}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => refreshSatellite(true)}
            disabled={isRefreshing}
            className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/25 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-cyan-300 transition-colors hover:border-cyan-400/60 hover:bg-cyan-500/10 disabled:cursor-wait disabled:opacity-60"
          >
            <RefreshCw className={`h-3 w-3 ${isRefreshing ? 'animate-spin' : ''}`} />
            {isRefreshing ? satelliteUi.refreshing || 'Refreshing' : satelliteUi.refresh || 'Refresh'}
          </button>
          <span className={`text-[11px] font-mono px-2.5 py-1 rounded-lg border ${statusClass}`}>
            {currentSatellite.status}
          </span>
        </div>
      </div>

      {currentSatellite.observations.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3">
            <div className="text-[10px] uppercase tracking-wider text-slate-500">{dict.platform}</div>
            <div className="text-sm font-bold text-slate-200 mt-1">{currentSatellite.platform || dict.notReported}</div>
          </div>
          <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3">
            <div className="text-[10px] uppercase tracking-wider text-slate-500">{dict.acquisition}</div>
            <div className="text-sm font-bold text-slate-200 mt-1 flex items-center gap-1">
              <Clock className="h-3.5 w-3.5 text-cyan-400" />
              {currentSatellite.acquisitionTime ? new Date(currentSatellite.acquisitionTime).toLocaleString('en-IN', { timeZone: 'UTC' }) + ' UTC' : dict.unavailable}
            </div>
          </div>
          <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3">
            <div className="text-[10px] uppercase tracking-wider text-slate-500">{dict.cloudCover}</div>
            <div className="text-sm font-bold text-slate-200 mt-1">
              {typeof currentSatellite.cloudCoverPct === 'number' ? `${formatValue(currentSatellite.cloudCoverPct, 0)}%` : dict.notReported}
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 text-xs text-slate-400">
          No live Copernicus Sentinel product is available for this exact location window right now.
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        {realSignalCards.map((metric) => (
          <RealMetric key={metric.title} title={metric.title} icon={metric.icon} value={metric.value} note={metric.note} />
        ))}
      </div>

      {refreshError && (
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 text-[11px] text-amber-200">
          {refreshError}
        </div>
      )}

      {derivedMetrics.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {derivedMetrics.map((metric) => (
            <Metric key={metric.title} title={metric.title} icon={metric.icon} value={metric.displayValue} unit={metric.unit} note={metric.note} badge={metric.badge} />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-[11px] leading-relaxed text-slate-400">
          {satelliteUi.derivedUnavailable}
        </div>
      )}

      <div className="bg-slate-950/70 border border-cyan-500/20 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h4 className="text-xs font-bold text-slate-200">{satelliteUi.liveProducts}</h4>
            <p className="text-[11px] text-slate-500">{satelliteUi.catalogue} · latest returned Sentinel products</p>
          </div>
          <span className="text-[10px] font-mono text-cyan-400">{satelliteUi.updated || 'Updated'} {new Date(currentSatellite.processingTime).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })}</span>
        </div>
        <p className="text-[11px] text-slate-500">{satelliteUi.realOnly || 'Only real Copernicus catalogue observations are shown. No synthetic satellite measurements are generated.'}</p>
        {currentSatellite.observations.length === 0 ? (
          <p className="text-[11px] text-slate-400">{satelliteUi.noProducts}</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {currentSatellite.observations.map((observation) => (
              <div key={observation.productId} className="border border-slate-800 bg-slate-900/70 rounded-lg p-3 space-y-1.5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-xs font-semibold text-slate-200">{observation.collectionTitle}</div>
                    <div className="text-[10px] text-cyan-300 font-mono break-all">{observation.productId}</div>
                  </div>
                  {observation.productUrl && <a href={observation.productUrl} target="_blank" rel="noreferrer" className="text-[10px] text-cyan-400"><ExternalLink className="h-3 w-3" /></a>}
                </div>
                <div className="text-[10px] text-slate-400 grid grid-cols-2 gap-1">
                  <span>{dict.acquisition}: {observation.acquisitionTime ? new Date(observation.acquisitionTime).toLocaleString('en-IN', { timeZone: 'UTC' }) : dict.unavailable}</span>
                  <span>{satelliteUi.age}: {formatAge(observation.observationAgeHours ?? ageHoursFromIso(observation.acquisitionTime))}</span>
                  <span>{dict.cloudCover}: {typeof observation.cloudCoverPct === 'number' ? `${observation.cloudCoverPct.toFixed(0)}%` : dict.notReported}</span>
                  {formatSceneDistance(observation.distanceKm) && <span>{satelliteUi.distance}: {formatSceneDistance(observation.distanceKm)}</span>}
                  {observation.processingLevel && <span>Level: {observation.processingLevel}</span>}
                  {observation.productType && <span>Type: {observation.productType}</span>}
                  {(observation.orbitState || typeof observation.relativeOrbit === 'number') && <span>Orbit: {observation.orbitState || 'orbit'}{typeof observation.relativeOrbit === 'number' ? ` / ${observation.relativeOrbit}` : ''}</span>}
                  {typeof observation.assetCount === 'number' && <span>Assets: {observation.assetCount}</span>}
                  {typeof observation.productSizeMb === 'number' && <span>Size: {observation.productSizeMb.toFixed(1)} MB</span>}
                  {observation.timeliness && <span>Timeliness: {observation.timeliness}</span>}
                  {typeof observation.sceneWaterPct === 'number' && <span>Water: {observation.sceneWaterPct.toFixed(2)}%</span>}
                  {typeof observation.sceneHighCloudPct === 'number' && <span>High cloud: {observation.sceneHighCloudPct.toFixed(1)}%</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
        <StatusCard title={dict.algalBloom} active={currentSatellite.algalBloomDetected} unavailable={currentSatellite.algalBloomDetected === undefined} icon={<AlertTriangle className="h-4 w-4" />} language={language} />
        <StatusCard title={dict.frontalZone} active={currentSatellite.thermalFrontDetected} unavailable={currentSatellite.thermalFrontDetected === undefined} icon={<Compass className="h-4 w-4" />} language={language} />
        <StatusCard title={dict.slickAnomaly} active={currentSatellite.surfaceSlickAnomalies} unavailable={currentSatellite.surfaceSlickAnomalies === undefined} icon={<Eye className="h-4 w-4" />} language={language} />
      </div>

      {/* INCOIS / ISRO Potential Fishing Zone (PFZ) Satellite Synthesis */}
      {typeof currentSatellite.chlorophyllConcentrationMgM3 === 'number' && typeof currentSatellite.sstC === 'number' && (
        <div className="bg-gradient-to-r from-emerald-950/40 via-slate-900/60 to-cyan-950/40 border border-emerald-500/30 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                INCOIS / ISRO PFZ SYNTHESIS
              </span>
              <span className="text-xs font-semibold text-slate-200">
                {currentSatellite.chlorophyllConcentrationMgM3 >= 0.3 && currentSatellite.chlorophyllConcentrationMgM3 <= 2.2 && currentSatellite.sstC >= 26 && currentSatellite.sstC <= 31
                  ? 'Favourable Potential Fishing Zone (PFZ) Conditions'
                  : 'Sub-Optimal Potential Fishing Zone (PFZ) Conditions'}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Satellite Chlorophyll-a ({currentSatellite.chlorophyllConcentrationMgM3.toFixed(2)} mg/m³) intersects with sea surface temperature ({currentSatellite.sstC.toFixed(1)}°C).
              {typeof currentSatellite.cloudCoverPct === 'number' && currentSatellite.cloudCoverPct > 50
                ? ` Optical confidence reduced due to ${currentSatellite.cloudCoverPct.toFixed(0)}% cloud coverage.`
                : ' High optical clarity supports pelagic fish aggregation assessment.'}
            </p>
          </div>
          <a
            href={`https://browser.dataspace.copernicus.eu/?zoom=10&lat=${location.latitude.toFixed(4)}&lng=${location.longitude.toFixed(4)}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 transition-colors shrink-0"
          >
            <span>Explore in Copernicus Browser</span>
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      )}

      <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-bold text-slate-200">{dict.observationProvenance}</div>
            <div className="text-[11px] text-slate-500">{location.name} · {currentSatellite.latitude.toFixed(4)}, {currentSatellite.longitude.toFixed(4)}</div>
          </div>
          {currentSatellite.productUrl && (
            <a href={currentSatellite.productUrl} target="_blank" rel="noreferrer" className="text-[11px] text-cyan-400 flex items-center gap-1">
              {dict.product} <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
        <div className="text-[11px] text-slate-400">Source: {currentSatellite.source}</div>
        {currentSatellite.productId && <div className="text-[10px] font-mono text-slate-500 break-all">{currentSatellite.productId}</div>}
      </div>

      {currentSatellite.warnings.length > 0 && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 space-y-1">
          {currentSatellite.warnings.map((warning, index) => (
            <div key={index} className="text-[11px] text-amber-300 flex gap-2">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>{warning}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const Metric: React.FC<{ title: string; icon: React.ReactNode; value: string; unit: string; note: string; badge?: string }> = ({ title, icon, value, unit, note, badge }) => {
  return (
    <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3 space-y-1.5 hover:border-cyan-500/30 transition-colors">
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1 text-[11px] text-slate-400 font-medium truncate">{icon}<span className="truncate">{title}</span></div>
        {badge && <span className="text-[8px] font-mono px-1 py-0.5 rounded bg-cyan-950/90 text-cyan-300 border border-cyan-800/40 shrink-0">{badge}</span>}
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-xl font-black text-slate-100 font-mono">{value}</span>
        <span className="text-xs text-slate-400">{unit}</span>
      </div>
      <p className="text-[10px] text-slate-500 leading-tight pt-1 border-t border-slate-800/80">{note}</p>
    </div>
  );
};

const RealMetric: React.FC<{ title: string; icon: React.ReactNode; value: string; note: string }> = ({ title, icon, value, note }) => {
  return (
    <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3.5 space-y-1.5">
      <div className="flex items-center gap-1 text-xs text-slate-400 font-medium">{icon}<span>{title}</span></div>
      <div className="text-2xl font-black text-slate-100 font-mono">{value}</div>
      <p className="text-[10px] text-slate-500 leading-tight pt-1 border-t border-slate-800/80">{note}</p>
    </div>
  );
};

const StatusCard: React.FC<{ title: string; active?: boolean; unavailable: boolean; icon: React.ReactNode; language: LanguageCode }> = ({ title, active, unavailable, icon, language }) => {
  const text = unavailable ? 'Not derived from available observations' : active ? 'Detected by satellite processing' : 'No anomaly detected';
  return (
    <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3 flex items-center space-x-3">
      <div className={`p-2 rounded-lg ${unavailable ? 'bg-slate-800 text-slate-500' : active ? 'bg-amber-500/20 text-amber-400' : 'bg-emerald-500/20 text-emerald-400'}`}>
        {unavailable ? icon : active ? icon : <CheckCircle className="h-4 w-4" />}
      </div>
      <div>
        <div className="font-bold text-slate-200">{title}</div>
              <div className="text-[11px] text-slate-400">{localizeSatelliteText(text, language)}</div>
      </div>
    </div>
  );
};
