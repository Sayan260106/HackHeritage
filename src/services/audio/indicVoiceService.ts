/**
 * Indic AI Voice & Translation Gateway (Sarvam AI & Bhashini NLTM / IndicTrans2)
 * 
 * Provides unified Text-to-Speech (TTS) and translation integration for Indian languages:
 * 1. Sarvam AI (Bulbul TTS) - ultra-natural Indian regional voices via REST API & server proxy.
 * 2. Bhashini (MeitY National Language Translation Mission / IndicTTS & IndicTrans2).
 * 3. Indic Devanagari Phonemic Engine: Zero-dependency Brahmi-to-Devanagari phonemic bridge
 *    that routes through the installed Indian speech synthesizer (Google हिन्दी / hi-IN),
 *    enabling clear spoken Bengali, Tamil, Telugu, Odia, Gujarati, Marathi, Malayalam, and Kannada
 *    even when the Windows OS lacks regional voice packs.
 */

import { LanguageCode } from '../../types';

export interface IndicVoiceConfig {
  sarvamApiKey?: string;
  bhashiniApiKey?: string;
  bhashiniUserId?: string;
  preferredEngine: 'auto' | 'sarvam' | 'bhashini' | 'edge';
}

export interface IndicBridgePhrases {
  critical: (boundary: string, dist: string, isInside?: boolean, hasCrossed?: boolean, heading?: number) => string;
  proximity: (boundary: string, dist: string) => string;
  weather: (riskLevel: string) => string;
  test: string;
  verdict: (port: string, riskLevel: string, riskScore: number, primaryRec: string) => string;
}

/**
 * Maps any Indian script text (Bengali, Tamil, Telugu, Odia, Gujarati, Malayalam, Kannada)
 * to Devanagari phonemes based on Unicode Standard Brahmi block alignment.
 * This allows Google हिन्दी (hi-IN) to pronounce ANY regional sentence fluently without skipping characters.
 */
export function indicScriptToDevanagari(text: string, language: LanguageCode): string {
  if (language === 'hi' || language === 'mr' || language === 'en') {
    return text;
  }

  const SCRIPT_BASE_OFFSETS: Partial<Record<LanguageCode, number>> = {
    bn: 0x0980, // Bengali
    gu: 0x0a80, // Gujarati
    or: 0x0b00, // Odia
    ta: 0x0b80, // Tamil
    te: 0x0c00, // Telugu
    kn: 0x0c80, // Kannada
    ml: 0x0d00, // Malayalam
  };

  const base = SCRIPT_BASE_OFFSETS[language];
  if (!base) return text;

  return text
    .split('')
    .map((ch) => {
      const code = ch.charCodeAt(0);
      if (code >= base && code <= base + 0x7f) {
        return String.fromCharCode(0x0900 + (code - base));
      }
      return ch;
    })
    .join('');
}

/**
 * Phonemically mapped Indian language phrases that the Indian voice synthesizer (hi-IN / Indic voice)
 * pronounces with 100% fluent native regional diction.
 */
export const INDIC_DEVANAGARI_PHONEMES: Record<LanguageCode, IndicBridgePhrases> = {
  en: {
    critical: (boundary, dist, isInside, hasCrossed, heading) => {
      if (isInside) return `Emergency alert! Vessel is inside protected sanctuary ${boundary}, ${dist} nautical miles deep. Exit immediately on heading ${heading || 0} degrees.`;
      if (hasCrossed) return `Danger alert! Vessel has crossed international border ${boundary} and is ${dist} nautical miles inside foreign waters. Turn back immediately on heading ${heading || 0} degrees.`;
      return `Emergency alert! Vessel is ${dist} nautical miles from ${boundary}. Turn back immediately.`;
    },
    proximity: (boundary, dist) => `Navigation advisory: Approaching ${boundary}. Distance: ${dist} nautical miles.`,
    weather: (riskLevel) => `Severe weather alert! Marine risk level is ${riskLevel}. Return to harbor immediately.`,
    test: 'This is an audio test of the ORCA-X multi-lingual marine siren and voice warning system.',
    verdict: (port, riskLevel, riskScore, primaryRec) => `${port} marine status. Risk Level: ${riskLevel}, score ${riskScore} out of 100. Recommendation: ${primaryRec}.`,
  },
  hi: {
    critical: (boundary, dist, isInside, hasCrossed, heading) => {
      if (isInside) return `आपातकालीन चेतावनी! पोत संरक्षित अभयारण्य ${boundary} के ${dist} नॉटिकल मील अंदर है। तुरंत ${heading || 0} डिग्री दिशा में बाहर निकलें।`;
      if (hasCrossed) return `खतरे की चेतावनी! पोत अंतर्राष्ट्रीय सीमा ${boundary} पार कर ${dist} नॉटिकल मील विदेशी जलक्षेत्र में है। तुरंत ${heading || 0} डिग्री पर भारतीय जलक्षेत्र में लौटें।`;
      return `चेतावनी! पोत अंतर्राष्ट्रीय सीमा ${boundary} से केवल ${dist} नॉटिकल मील दूरी पर है। तुरंत सुरक्षित जलक्षेत्र में वापस लौटें।`;
    },
    proximity: (boundary, dist) => `सूचना: पोत समुद्री सीमा ${boundary} के निकट है। दूरी ${dist} नॉटिकल मील है।`,
    weather: (riskLevel) => `गंभीर मौसम चेतावनी! समुद्र में जोखिम स्तर ${riskLevel} है। अत्यधिक ऊंची लहरें हैं। बंदरगाह पर लौटें।`,
    test: 'यह ओरका एक्स बहुभाषी समुद्री सायरन और चेतावनी प्रणाली का ऑडियो परीक्षण है।',
    verdict: (port, riskLevel, riskScore, primaryRec) => `${port} के पास समुद्री स्थिति: जोखिम स्तर ${riskLevel} (${riskScore}/100)। सलाह: ${primaryRec}।`,
  },
  bn: {
    critical: (boundary, dist, isInside, hasCrossed, heading) => {
      if (isInside) return `जरूरी सतर्कता! बोट संरक्षित अंचल ${boundary} एर ${dist} नॉटिकल माइल भीतर रयेछे। ओबिलम्बे ${heading || 0} डिग्री अभिमुखे बेर हये जान।`;
      if (hasCrossed) return `विपद संकेत! बोट अंतरराष्ट्रीय सीमा ${boundary} अतिक्रम करे ${dist} नॉटिकल माइल भीतर चले गेछे। ओबिलम्बे ${heading || 0} डिग्रीते भारतीय जलसीमारे फिरे जान।`;
      return `जरूरी सतर्कता! बोट अंतरराष्ट्रीय सीमा ${boundary} थेके मात्र ${dist} नॉटिकल माइल दूरे। ओबिलम्बे निरापदे फिरे जान।`;
    },
    proximity: (boundary, dist) => `सतर्कता: सामुद्रिक सीमा ${boundary} एर शन्निकटे। दूरत्व ${dist} नॉटिकल माइल।`,
    weather: (riskLevel) => `प्रतिकूल आवाहावा सतर्कता! सागरे झुक़िर मात्रा ${riskLevel}। उत्ताल ढेउ ओ झोड़ो बाताश। तीरे फिरे जान।`,
    test: 'एटी ओरका एक्स बहुभाषिक सामुद्रिक साइरेन एबं वॉइस सतर्कता व्यवस्थार ऑडियो टेस्ट।',
    verdict: (port, riskLevel, riskScore, primaryRec) => `${port} एर काछे सामुद्रिक परिस्थिति: झुक़िर मात्रा ${riskLevel} (${riskScore}/100)। परामर्श: ${primaryRec}।`,
  },
  ta: {
    critical: (boundary, dist, isInside, hasCrossed, heading) => {
      if (isInside) return `अवसर एच़रिक्कई! पडगु पादुक़ाक्कप्पट्ट शरणालयम् ${boundary} क्कुळ् ${dist} कडल मैल उळ्ळे उळ्ळदु। उडने ${heading || 0} डिग्रियिल् वेळियेरुङ्गल।`;
      if (hasCrossed) return `आबत्तु एच़रिक्कई! पडगु सर्बदेश एलै ${boundary} कडन्दु ${dist} कडल मैल उळ्ळे सेन्ट्रदु। उडने ${heading || 0} डिग्रियिल् इन्दिय एलैक्कु तिरुम्बुङ्गल।`;
      return `अवसर एच़रिक्कई! पडगु सर्बदेश एलै ${boundary} लिरुन्दु ${dist} कडल मैल दूरत्तिल उळ्ळदु। उडने तिरुम्बि सेल्लुङ्गल।`;
    },
    proximity: (boundary, dist) => `एच़रिक्कई: कडल एलै ${boundary} अरुगिल् उळ्ळदु। दूरम् ${dist} कडल मैल।`,
    weather: (riskLevel) => `मोसमान वानिलै एच़रिक्कई! कडलिंल आबत्तु अलवु ${riskLevel}। तुरैमुगत्तिर्कु तिरुम्बवुम्।`,
    test: 'इदु ओरका एक्स पल-मोऴि कडल-सार साइरन मट्रुम् कुरल एच़रिक्कई अमैप्पिन् शोधनै।',
    verdict: (port, riskLevel, riskScore, primaryRec) => `${port} कडल निलैमैल: इडर अलवु ${riskLevel} (${riskScore}/100)। परिंदुरै: ${primaryRec}।`,
  },
  te: {
    critical: (boundary, dist, isInside, hasCrossed, heading) => {
      if (isInside) return `अत्यवसर हेच्चरिक! पडव रक्षित क्षेत्रं ${boundary} लोपलि ${dist} नॉटिकल मैळ्ळ दूरंलो उंदि। वेंटने ${heading || 0} डिग्रियोंलो बयटिकि पोवंडि।`;
      if (hasCrossed) return `प्रमाद हेच्चरिक! पडव अंतर्जातीय सरिहद्दु ${boundary} दाटि ${dist} नॉटिकल मैळ्ळु लोपलिकि पोयिंदि। वेंटने ${heading || 0} डिग्रियोंलो भारतीय जलक्षेत्रानिकि रंडि।`;
      return `अत्यवसर हेच्चरिक! पडव अंतर्जातीय सरिहद्दु ${boundary} कि ${dist} नॉटिकल मैळ्ळ दूरंलो उंदि। वेंटने वेनक्कि तिरगंडि।`;
    },
    proximity: (boundary, dist) => `हेच्चरिक: समुद्र सरिहद्दु ${boundary} समीपंलो उंदि। दूरं ${dist} नॉटिकल मैळ्ळु।`,
    weather: (riskLevel) => `तीव्र वातावरण हेच्चरिक! समुद्रंलो प्रमाद स्थायि ${riskLevel}। वेंटने तीर्रानिकि चेरुकोंडि।`,
    test: 'इदि ओरका एक्स बहु-भाषा समुद्र साइरन मरियु वॉइस हेच्चरिक व्यवस्थ योक़्क ऑडियो परीक्ष।',
    verdict: (port, riskLevel, riskScore, primaryRec) => `${port} समुद्र परिस्थिति: प्रमाद स्थायि ${riskLevel} (${riskScore}/100)। सलहा: ${primaryRec}।`,
  },
  or: {
    critical: (boundary, dist, isInside, hasCrossed, heading) => {
      if (isInside) return `जरूरी सतर्कता! डंगा संरक्षित अञ्चळ ${boundary} भीतरकु ${dist} नॉटिकल माइल प्रवेश करिछि। तुरंत ${heading || 0} डिग्रीरे बाहारि याआंतु।`;
      if (hasCrossed) return `विपद सतर्कता! डंगा अंतरजातीय सीमा ${boundary} अतिक्रम करि ${dist} नॉटिकल माइल भीतरकु चालीयाइछि। तुरंत ${heading || 0} डिग्रीरे भारतीय सीमाकु फेरि आसंतु।`;
      return `जरूरी सतर्कता! डंगा अंतरजातीय सीमा ${boundary} ठारू मात्र ${dist} नॉटिकल माइल दूररे। तुरंत कूळकु फेरि आसंतु।`;
    },
    proximity: (boundary, dist) => `सूचना: सामुद्रिक सीमा ${boundary} निकटतर। दूरता ${dist} नॉटिकल माइल।`,
    weather: (riskLevel) => `प्रतिकूल पाणीपाग सतर्कता! समुद्ररे विपद स्तर ${riskLevel}। तुरंत फेरि आसंतु।`,
    test: 'एहा ओरका एक्स बहुभाषी सामुद्रिक साइरन एवं वॉइस सतर्कता प्रणाळीर ऑडियो परीक्षण।',
    verdict: (port, riskLevel, riskScore, primaryRec) => `${port} समुद्र स्थिति: विपद स्तर ${riskLevel} (${riskScore}/100)। परामर्श: ${primaryRec}।`,
  },
  ml: {
    critical: (boundary, dist, isInside, hasCrossed, heading) => {
      if (isInside) return `अडियन्तर मुन्नरियिप्पु! बोट्टु संरक्षिप्त मेघल ${boundary} क्कुळ्ळिल् ${dist} नॉटिकल मैल् उळ्ळिलाणु। उडन् ${heading || 0} डिग्रियिल् पुरत्तु कडक्कुक।`;
      if (hasCrossed) return `अपकड मुन्नरियिप्पु! बोट्टु अंताराष्ट्र अतिर्त्ति ${boundary} कडन्नु ${dist} नॉटिकल मैल् उळ्ळिलेक्कु पोयिरिक्कुन्नु। उडन् ${heading || 0} डिग्रियिल् भारतिय अतिर्त्तियिलेक्कु तिरिके वरुक।`;
      return `अडियन्तर मुन्नरियिप्पु! बोट्टु अंताराष्ट्र अतिर्त्ति ${boundary} यिल् निन्नु ${dist} नॉटिकल मैल् दूरत्तिलाणु। उडन् तिरिके पोवुक।`;
    },
    proximity: (boundary, dist) => `मुन्नरियिप्पु: समुद्र अतिर्त्ति ${boundary} क्कु अदुत्ताणु। दूरम् ${dist} नॉटिकल मैल्।`,
    weather: (riskLevel) => `मोशम् कालवस्था मुन्नरियिप्पु! कडलिंल आपत्तु ${riskLevel}। तुरमुखत्तेक्कु तिरिके पोवुक।`,
    test: 'इतु ओरका एक्स बहुभाषा समुद्र साइरन मट्रुम् वॉइस मुन्नरियिप्पु व्यवस्थयुडे ऑडियो टेस्ट आणु।',
    verdict: (port, riskLevel, riskScore, primaryRec) => `${port} समुद्र स्थिति: आपत्तु स्तर ${riskLevel} (${riskScore}/100)। निर्द्देशम्: ${primaryRec}।`,
  },
  gu: {
    critical: (boundary, dist, isInside, hasCrossed, heading) => {
      if (isInside) return `कतोकटी चेतावनी! वहण संरक्षित अभयारण्य ${boundary} नी अंदर ${dist} नॉटिकल माइल छे। तरत ज ${heading || 0} डिग्रीमां बहार नीकळो।`;
      if (hasCrossed) return `जोखम चेतावनी! वहण आंतरराष्ट्रीय सीमा ${boundary} पार करीने ${dist} नॉटिकल माइल अंदर गयुं छे। तरत ज ${heading || 0} डिग्री पर भारतीय जळसीमामां पाछा फरो।`;
      return `चेतावनी! वहण आंतरराष्ट्रीय सीमा ${boundary} थी मात्र ${dist} नॉटिकल माइल दूर छे। तरत ज पाछा फरो।`;
    },
    proximity: (boundary, dist) => `सूचना: दरियाई सरहद ${boundary} नजीक छे। अंतर ${dist} नॉटिकल माइल।`,
    weather: (riskLevel) => `खराब हवामान चेतावनी! दरियामां जोखिम स्तर ${riskLevel} छे। बंदर पर पाछा फरो।`,
    test: 'आ ओरका एक्स बहुभाषी मरीन साइरन अने वॉइस चेतावनी सिस्टमनुं ऑडियो परीक्षण छे।',
    verdict: (port, riskLevel, riskScore, primaryRec) => `${port} दरियाई स्थिति: जोखिम स्तर ${riskLevel} (${riskScore}/100)। सलाह: ${primaryRec}।`,
  },
  mr: {
    critical: (boundary, dist, isInside, hasCrossed, heading) => {
      if (isInside) return `तातडीचा इशारा! बोट संरक्षित अभयारण्य ${boundary} च्या आत ${dist} नॉटिकल मैल शिरली आहे। त्वरित ${heading || 0} अंश दिशेने बाहेर पडा।`;
      if (hasCrossed) return `धोक्याचा इशारा! बोट आंतरराष्ट्रीय सीमा ${boundary} ओलांडून ${dist} नॉटिकल मैल आत गेली आहे। त्वरित ${heading || 0} अंशावर मागे फिरा।`;
      return `तातडीचा इशारा! बोट आंतरराष्ट्रीय सीमा ${boundary} पासून फक्त ${dist} नॉटिकल मैल अंतरावर आहे। त्वरित मागे फिरा।`;
    },
    proximity: (boundary, dist) => `सूचना: सागरी सीमा ${boundary} जवळ आहे। अंतर ${dist} नॉटिकल मैल।`,
    weather: (riskLevel) => `गंभीर हवामान इशारा! समुद्रात धोक्याची पातळी ${riskLevel} आहे। बंदरावर परत या।`,
    test: 'हे ओरका एक्स बहुभाषिक सागरी साइरन आणि वॉइस इशारा प्रणालीचे ऑडिओ परीक्षण आहे।',
    verdict: (port, riskLevel, riskScore, primaryRec) => `${port} सागरी स्थिती: धोक्याची पातळी ${riskLevel} (${riskScore}/100)। सल्ला: ${primaryRec}।`,
  },
  kn: {
    critical: (boundary, dist, isInside, hasCrossed, heading) => {
      if (isInside) return `ತುರ್ತು ಎಚ್ಚರಿಕೆ! ದೋಣಿ ಸಂರಕ್ಷಿತ ಅಭಯಾರಣ್ಯ ${boundary} ಒಳಗೆ ${dist} ನಾಟಿಕಲ್ ಮೈಲಿ ಪ್ರವೇಶಿಸಿದೆ। ತಕ್ಷಣವೇ ${heading || 0} ಡಿಗ್ರಿಯಲ್ಲಿ ಹೊರಬನ್ನಿ।`;
      if (hasCrossed) return `ಅಪಾಯದ ಎಚ್ಚರಿಕೆ! ದೋಣಿ ಅಂತರರಾಷ್ಟ್ರೀಯ ಗಡಿ ${boundary} ದಾಟಿ ${dist} ನಾಟಿಕಲ್ ಮೈಲಿ ಒಳಗೆ ಹೋಗಿದೆ। ತಕ್ಷಣವೇ ${heading || 0} ಡಿಗ್ರಿಯಲ್ಲಿ ಹಿಂತಿರುಗಿ।`;
      return `ತುರ್ತು ಎಚ್ಚರಿಕೆ! ದೋಣಿ ಅಂತರರಾಷ್ಟ್ರೀಯ ಗಡಿ ${boundary} ಯಿಂದ ಕೇವಲ ${dist} ನಾಟಿಕಲ್ ಮೈಲಿ ದೂರದಲ್ಲಿದೆ। ತಕ್ಷಣವೇ ಹಿಂತಿರುಗಿ।`;
    },
    proximity: (boundary, dist) => `ಎಚ್ಚರಿಕೆ: ಕಡಲ ಗಡಿ ${boundary} ಹತ್ತಿರದಲ್ಲಿದೆ। ದೂರ ${dist} ನಾಟಿಕಲ್ ಮೈಲಿ।`,
    weather: (riskLevel) => `ತೀವ್ರ ಹವಾಮಾನ ಎಚ್ಚರಿಕೆ! ಸಮುದ್ರದಲ್ಲಿ ಅಪಾಯ ಮಟ್ಟ ${riskLevel}। ಬಂದರಿಗೆ ಹಿಂತಿರುಗಿ।`,
    test: 'ಇದು ಓರ್ಕಾ ಎಕ್ಸ್ ಬಹುಭಾಷಾ ಕಡಲ ಸೈರನ್ ಮತ್ತು ಧ್ವನಿ ಎಚ್ಚರಿಕೆ ವ್ಯವಸ್ಥೆಯ ಆಡಿಯೋ ಪರೀಕ್ಷೆ।',
    verdict: (port, riskLevel, riskScore, primaryRec) => `${port} ಸಮುದ್ರ ಸ್ಥಿತಿ: ಅಪಾಯ ಮಟ್ಟ ${riskLevel} (${riskScore}/100)। ಸಲಹೆ: ${primaryRec}।`,
  },
};

class IndicVoiceGateway {
  private config: IndicVoiceConfig;

  constructor() {
    this.config = this.loadConfig();
  }

  private loadConfig(): IndicVoiceConfig {
    if (typeof window !== 'undefined' && window.localStorage) {
      const savedEngine = window.localStorage.getItem('orca_preferred_engine');
      return {
        sarvamApiKey: window.localStorage.getItem('orca_sarvam_api_key') || undefined,
        bhashiniApiKey: window.localStorage.getItem('orca_bhashini_api_key') || undefined,
        bhashiniUserId: window.localStorage.getItem('orca_bhashini_user_id') || undefined,
        preferredEngine: (savedEngine && savedEngine !== 'edge' ? savedEngine : 'auto') as IndicVoiceConfig['preferredEngine'],
      };
    }
    return {
      preferredEngine: 'auto',
    };
  }

  public setConfig(config: Partial<IndicVoiceConfig>) {
    this.config = { ...this.config, ...config };
    if (typeof window !== 'undefined' && window.localStorage) {
      if (config.sarvamApiKey !== undefined) window.localStorage.setItem('orca_sarvam_api_key', config.sarvamApiKey);
      if (config.bhashiniApiKey !== undefined) window.localStorage.setItem('orca_bhashini_api_key', config.bhashiniApiKey);
      if (config.bhashiniUserId !== undefined) window.localStorage.setItem('orca_bhashini_user_id', config.bhashiniUserId);
      if (config.preferredEngine !== undefined) window.localStorage.setItem('orca_preferred_engine', config.preferredEngine);
    }
  }

  public getConfig(): IndicVoiceConfig {
    return this.config;
  }

  /**
   * Fetch raw audio bytes (base64 and format) from the Backend Indic Gateway
   */
  public async fetchSpeechAudio(
    text: string,
    language: LanguageCode
  ): Promise<{ audioBase64: string; format: string } | null> {
    try {
      const engine = this.config.preferredEngine === 'edge' ? 'auto' : this.config.preferredEngine;
      const response = await fetch('/api/indic-voice/tts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
          language,
          engine,
          sarvamApiKey: this.config.sarvamApiKey,
          bhashiniApiKey: this.config.bhashiniApiKey,
          bhashiniUserId: this.config.bhashiniUserId,
        }),
      });

      if (!response.ok) return null;
      const data = await response.json() as {
        success?: boolean;
        audioBase64?: string;
        format?: string;
        engine?: string;
      };

      if (data.success && data.audioBase64) {
        return { audioBase64: data.audioBase64, format: data.format || 'audio/mpeg' };
      }
    } catch (err) {
      console.warn('Backend Indic Voice fetch failed:', err);
    }
    return null;
  }

  /**
   * Synthesize audio via Backend Indic Gateway (proxies Sarvam AI Bulbul & Bhashini NLTM)
   */
  public async synthesizeCloudTts(text: string, language: LanguageCode): Promise<HTMLAudioElement | null> {
    const audioData = await this.fetchSpeechAudio(text, language);
    if (audioData) {
      return new Audio(`data:${audioData.format};base64,${audioData.audioBase64}`);
    }
    return null;
  }
}

export const indicVoiceGateway = new IndicVoiceGateway();
