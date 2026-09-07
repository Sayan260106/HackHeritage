import { LanguageCode } from '../types.ts';

export interface LanguageDetectionResult {
  language: LanguageCode;
  confidence: number;
  script: string;
  name: string;
  nativeName: string;
}

export const LANGUAGE_META: Record<LanguageCode, { name: string; nativeName: string; script: string }> = {
  en: { name: 'English', nativeName: 'English', script: 'Latin' },
  hi: { name: 'Hindi', nativeName: 'हिन्दी', script: 'Devanagari' },
  bn: { name: 'Bengali', nativeName: 'বাংলা', script: 'Bengali' },
  ta: { name: 'Tamil', nativeName: 'தமிழ்', script: 'Tamil' },
  te: { name: 'Telugu', nativeName: 'తెలుగు', script: 'Telugu' },
  or: { name: 'Odia', nativeName: 'ଓଡ଼ିଆ', script: 'Odia' },
  ml: { name: 'Malayalam', nativeName: 'മലയാളം', script: 'Malayalam' },
  gu: { name: 'Gujarati', nativeName: 'ગુજરાતી', script: 'Gujarati' },
  mr: { name: 'Marathi', nativeName: 'मराठी', script: 'Devanagari' },
  kn: { name: 'Kannada', nativeName: 'ಕನ್ನಡ', script: 'Kannada' },
};

/**
 * Autonomously detects the language of a natural language marine query.
 * Detects Indian regional scripts (Bengali, Devanagari, Tamil, Telugu, Odia, Gujarati, Malayalam, Kannada)
 * as well as common romanized Indic transliterated keywords.
 */
export function detectQueryLanguage(text: string, currentFallback: LanguageCode = 'en'): LanguageDetectionResult {
  if (!text || typeof text !== 'string') {
    return {
      language: currentFallback,
      confidence: 1.0,
      script: LANGUAGE_META[currentFallback].script,
      name: LANGUAGE_META[currentFallback].name,
      nativeName: LANGUAGE_META[currentFallback].nativeName,
    };
  }

  let bnCount = 0;   // Bengali & Assamese (\u0980 - \u09FF)
  let devCount = 0;  // Devanagari: Hindi & Marathi (\u0900 - \u097F)
  let taCount = 0;   // Tamil (\u0B80 - \u0BFF)
  let teCount = 0;   // Telugu (\u0C00 - \u0C7F)
  let orCount = 0;   // Odia (\u0B00 - \u0B7F)
  let mlCount = 0;   // Malayalam (\u0D00 - \u0D7F)
  let guCount = 0;   // Gujarati (\u0A80 - \u0AFF)
  let knCount = 0;   // Kannada (\u0C80 - \u0CFF)

  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0x0980 && code <= 0x09FF) bnCount++;
    else if (code >= 0x0900 && code <= 0x097F) devCount++;
    else if (code >= 0x0B80 && code <= 0x0BFF) taCount++;
    else if (code >= 0x0C00 && code <= 0x0C7F) teCount++;
    else if (code >= 0x0B00 && code <= 0x0B7F) orCount++;
    else if (code >= 0x0D00 && code <= 0x0D7F) mlCount++;
    else if (code >= 0x0A80 && code <= 0x0AFF) guCount++;
    else if (code >= 0x0C80 && code <= 0x0CFF) knCount++;
  }

  const scriptCandidates: Array<{ lang: LanguageCode; count: number }> = [
    { lang: 'bn', count: bnCount },
    { lang: 'ta', count: taCount },
    { lang: 'te', count: teCount },
    { lang: 'or', count: orCount },
    { lang: 'ml', count: mlCount },
    { lang: 'gu', count: guCount },
    { lang: 'kn', count: knCount },
  ];

  // Disambiguate Devanagari between Hindi and Marathi
  if (devCount > 0) {
    const marathiKeywords = /\b(आहे|नाही|काय|कसा|कशी|मासे|मासेमारी|वारा|लाटा|समुद्र|होडी|किनारा|बोट)\b/i;
    const isMarathi = marathiKeywords.test(text);
    scriptCandidates.push({ lang: isMarathi ? 'mr' : 'hi', count: devCount });
  }

  scriptCandidates.sort((a, b) => b.count - a.count);
  const bestScript = scriptCandidates[0];

  // If at least 2 characters belong to an Indic script, we have confident native script detection
  if (bestScript && bestScript.count >= 2) {
    const lang = bestScript.lang;
    const meta = LANGUAGE_META[lang];
    return {
      language: lang,
      confidence: Math.min(0.99, Number((0.88 + (bestScript.count / Math.max(1, text.length)) * 0.11).toFixed(2))),
      script: meta.script,
      name: meta.name,
      nativeName: meta.nativeName,
    };
  }

  // Check if sentence is predominantly standard English
  const lower = text.toLowerCase();
  const englishWords = /\b(is|it|safe|to|fish|fishing|near|what|where|how|when|tomorrow|morning|the|are|any|there|weather|wind|waves|wave|tide|height|conditions|warning|alerts|speed|for|small|boats|right|now)\b/g;
  const englishMatches = lower.match(englishWords);
  if (englishMatches && englishMatches.length >= 2) {
    const fallbackMeta = LANGUAGE_META.en;
    return {
      language: 'en',
      confidence: 0.95,
      script: 'Latin',
      name: fallbackMeta.name,
      nativeName: fallbackMeta.nativeName,
    };
  }

  // Check Romanized transliterated coastal phrases if purely Latin characters
  const romanizedChecks: Array<{ lang: LanguageCode; pattern: RegExp }> = [
    { lang: 'bn', pattern: /\b(mach|machh|nodi|somudro|somudra|bhalo|jhor|dheu|kemon|shokal|bikal|jabe|ki|hobe)\b/i },
    { lang: 'hi', pattern: /\b(machli|machhli|samundar|hawa|toofan|leher|leherein|surakshit|kaisa|paani|mausam|hoga|kya)\b/i },
    { lang: 'ta', pattern: /\b(meen|kadal|kaatru|alai|puyal|padagu|neram|paathukaapu|nalaiku|eppadi)\b/i },
    { lang: 'te', pattern: /\b(chepa|chepalu|samudram|gaali|ala|tufanu|padava|surakshitham|ela)\b/i },
    { lang: 'ml', pattern: /\b(meen|kadal|kaattu|thira|valakkar|vanchi|surakshitham|enganeyundu)\b/i },
    { lang: 'gu', pattern: /\b(machhli|dariyo|samandar|pavan|toofan|hodi|surakshit|kevu)\b/i },
    { lang: 'mr', pattern: /\b(mase|masemari|daryat|laata|vara|kinara|surakshit|ahe|kasa)\b/i },
    { lang: 'or', pattern: /\b(machha|samudra|pabana|dheu|bata|nodi|surakshita|kemiti)\b/i },
  ];

  for (const check of romanizedChecks) {
    if (check.pattern.test(lower)) {
      const meta = LANGUAGE_META[check.lang];
      return {
        language: check.lang,
        confidence: 0.85,
        script: 'Latin (Transliterated)',
        name: meta.name,
        nativeName: meta.nativeName,
      };
    }
  }

  // Fallback to currently selected language or English
  const fallbackMeta = LANGUAGE_META[currentFallback] || LANGUAGE_META.en;
  return {
    language: currentFallback,
    confidence: 0.8,
    script: fallbackMeta.script,
    name: fallbackMeta.name,
    nativeName: fallbackMeta.nativeName,
  };
}
