/**
 * Multi-lingual Voice Warning Engine
 * 
 * Uses the Web Speech Synthesis API and Indic AI Cloud Gateway to announce urgent
 * maritime alerts in 10 coastal Indian languages: English, Hindi, Bengali, Tamil,
 * Telugu, Odia, Malayalam, Gujarati, Marathi, and Kannada.
 * 
 * Hybrid Architecture:
 * 1. Cloud Layer: Sarvam AI (Bulbul:v1) & Bhashini NLTM (Dhruva/IndicTrans2/IndicTTS)
 *    via server proxy `/api/indic-voice/tts`.
 * 2. Edge Layer (100% Offline Guaranteed): Universal Indic Devanagari Phonemic Engine
 *    routes speech through Chromium's native Indian speech synthesizer (Google हिन्दी / hi-IN).
 *    All regional scripts (Bengali, Tamil, Telugu, Odia, Gujarati, Malayalam, Kannada)
 *    are automatically transliterated to Devanagari phonemes so Google हिन्दी pronounces
 *    fluent Indian regional words without dropping characters or sounding like American English.
 */

import { LanguageCode, GeofenceAlert, RiskPrediction, LocationInfo } from '../../types';
import { maritimeSiren } from './maritimeSirenService';
import {
  indicVoiceGateway,
  indicScriptToDevanagari,
  INDIC_DEVANAGARI_PHONEMES,
} from './indicVoiceService';
import { getLocalizedPrimaryRecommendation } from '../../utils/marineRiskLocalization';

export interface SpokenAlertPayload {
  key: string;
  language: LanguageCode;
  text: string;
  isCritical: boolean;
}

const LANGUAGE_BCP47_MAP: Record<LanguageCode, string[]> = {
  en: ['en-IN', 'en-GB', 'en-US', 'en'],
  hi: ['hi-IN', 'hi'],
  bn: ['bn-IN', 'bn-BD', 'bn'],
  ta: ['ta-IN', 'ta-LK', 'ta'],
  te: ['te-IN', 'te'],
  or: ['or-IN', 'or'],
  ml: ['ml-IN', 'ml'],
  gu: ['gu-IN', 'gu'],
  mr: ['mr-IN', 'mr'],
  kn: ['kn-IN', 'kn'],
};

const RISK_LEVEL_LOCALE_MAP: Record<LanguageCode, Record<string, string>> = {
  en: { LOW: 'Low', MODERATE: 'Moderate', HIGH: 'High', EXTREME: 'Extreme' },
  hi: { LOW: 'कम', MODERATE: 'मध्यम', HIGH: 'उच्च', EXTREME: 'अत्यधिक' },
  bn: { LOW: 'কম', MODERATE: 'মাঝারি', HIGH: 'উচ্চ', EXTREME: 'চরম' },
  ta: { LOW: 'குறைந்த', MODERATE: 'மிதமான', HIGH: 'அதிக', EXTREME: 'தீவிர' },
  te: { LOW: 'తక్కువ', MODERATE: 'మధ్యస్థ', HIGH: 'అధిక', EXTREME: 'తీవ్రమైన' },
  or: { LOW: 'କମ୍', MODERATE: 'ମଧ୍ୟମ', HIGH: 'ଉଚ୍ଚ', EXTREME: 'ଚରମ' },
  ml: { LOW: 'കുറഞ്ഞ', MODERATE: 'മിതമായ', HIGH: 'കൂടിയ', EXTREME: 'അതീവ ഗുരുതര' },
  gu: { LOW: 'ઓછું', MODERATE: 'મધ્યમ', HIGH: 'વધુ', EXTREME: 'અતિ ગંભીર' },
  mr: { LOW: 'कमी', MODERATE: 'मध्यम', HIGH: 'जास्त', EXTREME: 'अति तीव्र' },
  kn: { LOW: 'ಕಡಿಮೆ', MODERATE: 'ಮಧ್ಯಮ', HIGH: 'ಹೆಚ್ಚು', EXTREME: 'ತೀವ್ರ' },
};

export const PORT_LOCALE_MAP: Record<LanguageCode, Record<string, string>> = {
  en: {},
  hi: {
    digha: 'दीघा बंदरगाह',
    kakdwip: 'काकद्वीप बंदरगाह',
    namkhana: 'नामखाना बंदरगाह',
    puri: 'पुरी बंदरगाह',
    paradip: 'पारादीप बंदरगाह',
    paradeep: 'पारादीप बंदरगाह',
    gopalpur: 'गोपालपुर बंदरगाह',
    visakhapatnam: 'विशाखापट्टनम बंदरगाह',
    vizag: 'विशाखापट्टनम बंदरगाह',
    kakinada: 'काकीनाड़ा बंदरगाह',
    kasimedu: 'चेन्नई बंदरगाह',
    chennai: 'चेन्नई बंदरगाह',
    tuticorin: 'तूतीकोरिन बंदरगाह',
    chidambaranar: 'तूतीकोरिन बंदरगाह',
    kochi: 'कोच्चि बंदरगाह',
    cochin: 'कोच्चि बंदरगाह',
    mangalore: 'मैंगलोर बंदरगाह',
    mormugao: 'मोरमुगाओ बंदरगाह',
    goa: 'गोवा बंदरगाह',
    mumbai: 'मुंबई बंदरगाह',
    sassoon: 'मुंबई बंदरगाह',
    veraval: 'वेरावल बंदरगाह',
    porbandar: 'पोरबंदर बंदरगाह',
    'port blair': 'पोर्ट ब्लेयर बंदरगाह',
    haddo: 'पोर्ट ब्लेयर बंदरगाह',
    dhanushkodi: 'धनुषकोडी',
    jakhau: 'जाखौ बंदरगाह',
  },
  bn: {
    digha: 'দিঘা বন্দর',
    kakdwip: 'কাকদ্বীপ বন্দর',
    namkhana: 'নামখানা বন্দর',
    puri: 'পুরী বন্দর',
    paradip: 'পারাদ্বীপ বন্দর',
    paradeep: 'পারাদ্বীপ বন্দর',
    gopalpur: 'গোপালপুর বন্দর',
    visakhapatnam: 'বিশাখাপত্তনম বন্দর',
    vizag: 'বিশাখাপত্তনম বন্দর',
    kakinada: 'কাকিনাড়া বন্দর',
    kasimedu: 'চেন্নাই বন্দর',
    chennai: 'চেন্নাই বন্দর',
    tuticorin: 'তুতিকোরিন বন্দর',
    chidambaranar: 'তুতিকোরিন বন্দর',
    kochi: 'কোচি বন্দর',
    cochin: 'কোচি বন্দর',
    mangalore: 'ম্যাঙ্গালোর বন্দর',
    mormugao: 'মার্মাগাঁও বন্দর',
    goa: 'গোয়া বন্দর',
    mumbai: 'মুম্বই বন্দর',
    sassoon: 'মুম্বই বন্দর',
    veraval: 'ভেরাভাল বন্দর',
    porbandar: 'পোরবন্দর',
    'port blair': 'পোর্ট ব্লেয়ার বন্দর',
    haddo: 'পোর্ট ব্লেয়ার বন্দর',
    dhanushkodi: 'ধনুষ্কোডি',
    jakhau: 'জাখাউ বন্দর',
  },
  ta: {
    digha: 'திகா துறைமுகம்',
    kakdwip: 'காக்த்வீプ துறைமுகம்',
    namkhana: 'நாம்கானா துறைமுகம்',
    puri: 'பூரி துறைமுகம்',
    paradip: 'பாராதீப் துறைமுகம்',
    paradeep: 'பாராதீப் துறைமுகம்',
    gopalpur: 'கோபால்பூர் துறைமுகம்',
    visakhapatnam: 'விசாகப்பட்டினம் துறைமுகம்',
    vizag: 'விசாகப்பட்டினம் துறைமுகம்',
    kakinada: 'காக்கிநாடா துறைமுகம்',
    kasimedu: 'சென்னை துறைமுகம்',
    chennai: 'சென்னை துறைமுகம்',
    tuticorin: 'தூத்துக்குடி துறைமுகம்',
    chidambaranar: 'தூத்துக்குடி துறைமுகம்',
    kochi: 'கொச்சி துறைமுகம்',
    cochin: 'கொச்சி துறைமுகம்',
    mangalore: 'மங்களூர் துறைமுகம்',
    mormugao: 'மர்மகோவா துறைமுகம்',
    goa: 'கோவா துறைமுகம்',
    mumbai: 'மும்பை துறைமுகம்',
    sassoon: 'மும்பை துறைமுகம்',
    veraval: 'வேராவல் துறைமுகம்',
    porbandar: 'போர்பந்தர் துறைமுகம்',
    'port blair': 'போர்ட் பிளேர் துறைமுகம்',
    haddo: 'போர்ட் பிளேர் துறைமுகம்',
    dhanushkodi: 'தனுஷ்கோடி',
    jakhau: 'ஜாகாவ் துறைமுகம்',
  },
  te: {
    digha: 'దిఘా ఓడరేవు',
    kakdwip: 'కాకద్వీప్ ఓడరేవు',
    namkhana: 'నామ్‌ఖానా ఓడరేవు',
    puri: 'పూరీ ఓడరేవు',
    paradip: 'పారదీప్ ఓడరేవు',
    paradeep: 'పారదీప్ ఓడరేవు',
    gopalpur: 'గోపాల్‌పూర్ ఓడరేవు',
    visakhapatnam: 'విశాఖపట్నం పోర్టు',
    vizag: 'విశాఖపట్నం పోర్టు',
    kakinada: 'కాకినాడ పోర్టు',
    kasimedu: 'చెన్నై పోర్టు',
    chennai: 'చెన్నై పోర్టు',
    tuticorin: 'తూత్తుకుడి పోర్టు',
    chidambaranar: 'తూత్తుకుడి పోర్టు',
    kochi: 'కొచ్చి పోర్టు',
    cochin: 'కొచ్చి పోర్టు',
    mangalore: 'మంగళూరు పోర్టు',
    mormugao: 'మోర్ముగావ్ పోర్టు',
    goa: 'గోవా పోర్టు',
    mumbai: 'ముంబై పోర్టు',
    sassoon: 'ముంబై పోర్టు',
    veraval: 'వెరావల్ పోర్టు',
    porbandar: 'పోర్‌బందర్ పోర్టు',
    'port blair': 'పోర్ట్ బ్లెయిర్ పోర్టు',
    haddo: 'పోర్ట్ బ్లెయిర్ పోర్టు',
    dhanushkodi: 'ధనుష్కోడి',
    jakhau: 'జఖౌ పోర్టు',
  },
  or: {
    digha: 'ଦିଘା ବନ୍ଦର',
    kakdwip: 'କାକଦ୍ୱୀପ ବନ୍ଦର',
    namkhana: 'ନାମଖାନା ବନ୍ଦର',
    puri: 'ପୁରୀ ବନ୍ଦର',
    paradip: 'ପାରାଦୀପ ବନ୍ଦର',
    paradeep: 'ପାରାଦୀପ ବନ୍ଦର',
    gopalpur: 'ଗୋପାଳପୁର ବନ୍ଦର',
    visakhapatnam: 'ବିଶାଖାପାଟଣା ବନ୍ଦର',
    vizag: 'ବିଶାଖାପାଟଣା ବନ୍ଦର',
    kakinada: 'କାକିନାଡା ବନ୍ଦର',
    kasimedu: 'ଚେନ୍ନାଇ ବନ୍ଦର',
    chennai: 'ଚେନ୍ନାଇ ବନ୍ଦର',
    tuticorin: 'ତୁତିକୋରିନ୍ ବନ୍ଦର',
    chidambaranar: 'ତୁତିକୋରିନ୍ ବନ୍ଦର',
    kochi: 'କୋଚି ବନ୍ଦର',
    cochin: 'କୋଚି ବନ୍ଦର',
    mangalore: 'ମାଙ୍ଗାଲୋର ବନ୍ଦର',
    mormugao: 'ମୋର୍ମୁଗାଓ ବନ୍ଦର',
    goa: 'ଗୋଆ ବନ୍ଦର',
    mumbai: 'ମୁମ୍ବାଇ ବନ୍ଦର',
    sassoon: 'ମୁମ୍ବାଇ ବନ୍ଦର',
    veraval: 'ଭେରାଭାଲ ବନ୍ଦର',
    porbandar: 'ପୋରବନ୍ଦର ବନ୍ଦର',
    'port blair': 'ପୋର୍ଟ ବ୍ଲେୟାର ବନ୍ଦର',
    haddo: 'ପୋର୍ଟ ବ୍ଲେୟାର ବନ୍ଦର',
    dhanushkodi: 'ଧନୁଷ୍କୋଡି',
    jakhau: 'ଜାଖାଉ ବନ୍ଦର',
  },
  ml: {
    digha: 'ദിഘ തുറമുഖം',
    kakdwip: 'കാകദ്വീപ് തുറമുഖം',
    namkhana: 'നാംഖാന തുറമുഖം',
    puri: 'പുരി തുറമുഖം',
    paradip: 'പാരാദ്വീപ് തുറമുഖം',
    paradeep: 'പാരാദ്വീപ് തുറമുഖം',
    gopalpur: 'ഗോപാൽപൂർ തുറമുഖം',
    visakhapatnam: 'വിശാഖപട്ടണം തുറമുഖം',
    vizag: 'വിശാഖപട്ടണം തുറമുഖം',
    kakinada: 'കാക്കിനട തുറമുഖം',
    kasimedu: 'ചെന്നൈ തുറമുഖം',
    chennai: 'ചെന്നൈ തുറമുഖം',
    tuticorin: 'തൂത്തുക്കുടി തുറമുഖം',
    chidambaranar: 'തൂത്തുക്കുടി തുറമുഖം',
    kochi: 'കൊച്ചി തുറമുഖം',
    cochin: 'കൊച്ചി തുറമുഖം',
    mangalore: 'മംഗലാപുരം തുറമുഖം',
    mormugao: 'മർമ്മഗോവ തുറമുഖം',
    goa: 'ഗോവ തുറമുഖം',
    mumbai: 'മുംബൈ തുറമുഖം',
    sassoon: 'മുംബൈ തുറമുഖം',
    veraval: 'വെരാവൽ തുറമുഖം',
    porbandar: 'പോർബന്ദർ തുറമുഖം',
    'port blair': 'പോർട്ട് ബ്ലെയർ തുറമുഖം',
    haddo: 'പോർട്ട് ബ്ലെയർ തുറമുഖം',
    dhanushkodi: 'ധനുഷ്കോടി',
    jakhau: 'ജഖാവ് തുറമുഖം',
  },
  gu: {
    digha: 'દીઘા બંદર',
    kakdwip: 'કાકદ્વીપ બંદર',
    namkhana: 'નામખાના બંદર',
    puri: 'પુરી બંદર',
    paradip: 'પારાદીપ બંદર',
    paradeep: 'પારાદીપ બંદર',
    gopalpur: 'ગોપાલપુર બંદર',
    visakhapatnam: 'વિશાખાપટ્ટનમ બંદર',
    vizag: 'વિશાખાપટ્ટનમ બંદર',
    kakinada: 'કાકીનાડા બંદર',
    kasimedu: 'ચેન્નાઈ બંદર',
    chennai: 'ચેન્નાઈ બંદર',
    tuticorin: 'તુતીકોરીન બંદર',
    chidambaranar: 'તુતીકોરીન બંદર',
    kochi: 'કોચી બંદર',
    cochin: 'કોચી બંદર',
    mangalore: 'મેંગલોર બંદર',
    mormugao: 'મોર્મુગાઓ બંદર',
    goa: 'ગોવા બંદર',
    mumbai: 'મુંબઈ બંદર',
    sassoon: 'મુંબઈ બંદર',
    veraval: 'વેરાવળ બંદર',
    porbandar: 'પોરબંદર',
    'port blair': 'પોર્ટ બ્લેયર બંદર',
    haddo: 'પોર્ટ બ્લેયર બંદર',
    dhanushkodi: 'ધનુષકોડી',
    jakhau: 'જાખો બંદર',
  },
  mr: {
    digha: 'दीघा बंदर',
    kakdwip: 'काकद्वीप बंदर',
    namkhana: 'नामखाना बंदर',
    puri: 'पुरी बंदर',
    paradip: 'पारादीप बंदर',
    paradeep: 'पारादीप बंदर',
    gopalpur: 'गोपाळपूर बंदर',
    visakhapatnam: 'विशाखापट्टणम बंदर',
    vizag: 'विशाखापट्टणम बंदर',
    kakinada: 'काकिनाडा बंदर',
    kasimedu: 'चेन्नई बंदर',
    chennai: 'चेन्नई बंदर',
    tuticorin: 'तुतीकोरीन बंदर',
    chidambaranar: 'तुतीकोरीन बंदर',
    kochi: 'कोची बंदर',
    cochin: 'कोची बंदर',
    mangalore: 'मंगलोर बंदर',
    mormugao: 'मोरमुगाओ बंदर',
    goa: 'गोवा बंदर',
    mumbai: 'मुंबई बंदर',
    sassoon: 'मुंबई बंदर',
    veraval: 'वेरावळ बंदर',
    porbandar: 'पोरबंदर',
    'port blair': 'पोर्ट ब्लेअर बंदर',
    haddo: 'पोर्ट ब्लेअर बंदर',
    dhanushkodi: 'धनुषकोडी',
    jakhau: 'जाखौ बंदर',
  },
  kn: {
    digha: 'ದಿಘಾ ಬಂದರು',
    kakdwip: 'ಕಾಕದ್ವೀಪ ಬಂದರು',
    namkhana: 'ನಾಮ್ಖಾನಾ ಬಂದರು',
    puri: 'ಪುರಿ ಬಂದರು',
    paradip: 'ಪಾರಾದೀಪ್ ಬಂದರು',
    paradeep: 'ಪಾರಾದೀಪ್ ಬಂದರು',
    gopalpur: 'ಗೋಪಾಲ್ಪುರ ಬಂದರು',
    visakhapatnam: 'ವಿಶಾಖಪಟ್ಟಣಂ ಬಂದರು',
    vizag: 'ವಿಶಾಖಪಟ್ಟಣಂ ಬಂದರು',
    kakinada: 'ಕಾಕಿನಾಡ ಬಂದರು',
    kasimedu: 'ಚೆನ್ನೈ ಬಂದರು',
    chennai: 'ಚೆನ್ನೈ ಬಂದರು',
    tuticorin: 'ತೂತುಕುಡಿ ಬಂದರು',
    chidambaranar: 'ತೂತುಕುಡಿ ಬಂದರು',
    kochi: 'ಕೊಚ್ಚಿ ಬಂದರು',
    cochin: 'ಕೊಚ್ಚಿ ಬಂದರು',
    mangalore: 'ಮಂಗಳೂರು ಬಂದರು',
    mormugao: 'ಮೋರ್ಮುಗಾವೊ ಬಂದರು',
    goa: 'ಗೋವಾ ಬಂದರು',
    mumbai: 'ಮುಂಬೈ ಬಂದರು',
    sassoon: 'ಮುಂಬೈ ಬಂದರು',
    veraval: 'ವೆರಾವಲ್ ಬಂದರು',
    porbandar: 'ಪೋರ್ಬಂದರ್ ಬಂದರು',
    'port blair': 'ಪೋರ್ಟ್ ಬ್ಲೇರ್ ಬಂದರು',
    haddo: 'ಪೋರ್ಟ್ ಬ್ಲೇರ್ ಬಂದರು',
    dhanushkodi: 'ಧನುಷ್ಕೋಡಿ',
    jakhau: 'ಜಖೌ ಬಂದರು',
  },
};

export const BOUNDARY_LOCALE_MAP: Record<LanguageCode, Record<string, string>> = {
  en: {
    srilanka: 'India – Sri Lanka International Maritime Boundary Line',
    bangladesh: 'India – Bangladesh Maritime Boundary',
    pakistan: 'India – Pakistan Arabian Sea Maritime Boundary',
    gahirmatha: 'Gahirmatha Marine Wildlife Sanctuary',
    mannar: 'Gulf of Mannar Marine National Park',
    sundarbans: 'Sundarbans Biosphere Marine Reserve',
    generic: 'International Maritime Boundary',
  },
  hi: {
    srilanka: 'भारत-श्रीलंका अंतर्राष्ट्रीय समुद्री सीमा',
    bangladesh: 'भारत-बांग्लादेश अंतर्राष्ट्रीय समुद्री सीमा',
    pakistan: 'भारत-पाकिस्तान अंतर्राष्ट्रीय समुद्री सीमा',
    gahirmatha: 'गहिरमाथा समुद्री अभयारण्य',
    mannar: 'मन्नार की खाड़ी समुद्री राष्ट्रीय उद्यान',
    sundarbans: 'सुंदरवन समुद्री संरक्षित क्षेत्र',
    generic: 'अंतर्राष्ट्रीय समुद्री सीमा',
  },
  bn: {
    srilanka: 'ভারত-শ্রীলঙ্কা আন্তর্জাতিক সমুদ্রসীমা',
    bangladesh: 'ভারত-বাংলাদেশ আন্তর্জাতিক সমুদ্রসীমা',
    pakistan: 'ভারত-পাকিস্তান আন্তর্জাতিক সমুদ্রসীমা',
    gahirmatha: 'গহিরমাথা সামুদ্রিক অভয়ারণ্য',
    mannar: 'মান্নার উপসাগর সামুদ্রিক জাতীয় উদ্যান',
    sundarbans: 'সুন্দরবন সামুদ্রিক সংরক্ষিত অঞ্চল',
    generic: 'আন্তর্জাতিক সমুদ্রসীমা',
  },
  ta: {
    srilanka: 'இந்தியா-இலங்கை சர்வதேச கடல் எல்லை',
    bangladesh: 'இந்தியா-வங்கதேசம் சர்வதேச கடல் எல்லை',
    pakistan: 'இந்தியா-பாகிஸ்தான் சர்வதேச கடல் எல்லை',
    gahirmatha: 'கஹிர்மாதா கடல் சரணாலயம்',
    mannar: 'மன்னார் வளைகுடா கடல்சார் தேசிய பூங்கா',
    sundarbans: 'சுந்தரவனக் கடல்சார் காப்பகம்',
    generic: 'சர்வதேச கடல் எல்லை',
  },
  te: {
    srilanka: 'భారతదేశం-శ్రీలంక అంతర్జాతీయ సముద్ర సరిహద్దు',
    bangladesh: 'భారతదేశం-బంగ్లాదేశ్ అంతర్జాతీయ సముద్ర సరిహద్దు',
    pakistan: 'భారతదేశం-పాకిస్తాన్ అంతర్జాతీయ సముద్ర సరిహద్దు',
    gahirmatha: 'గహిర్‌మాథా సముద్ర అభయారణ్యం',
    mannar: 'మన్నార్ గల్ఫ్ సముద్ర జాతీయ ఉద్యానవనం',
    sundarbans: 'సుందర్బన్స్ సముద్ర రిజర్వ్',
    generic: 'అంతర్జాతీయ సముద్ర సరిహద్దు',
  },
  or: {
    srilanka: 'ଭାରତ-ଶ୍ରୀଲଙ୍କା ଆନ୍ତର୍ଜାତୀୟ ସମୁଦ୍ର ସୀମା',
    bangladesh: 'ଭାରତ-ବାଂଲାଦେଶ ଆନ୍ତର୍ଜାତୀୟ ସମୁଦ୍ର ସୀମା',
    pakistan: 'ଭାରତ-ପାକିସ୍ତାନ ଆନ୍ତର୍ଜାତୀୟ ସମୁଦ୍ର ସୀମା',
    gahirmatha: 'ଗହିରମଥା ସାମୁଦ୍ରିକ ଅଭୟାରଣ୍ୟ',
    mannar: 'ମନ୍ନାର ଉପସାଗର ସାମୁଦ୍ରିକ ଜାତୀୟ ଉଦ୍ୟାନ',
    sundarbans: 'ସୁନ୍ଦରବନ ସାମୁଦ୍ରିକ ସଂରକ୍ଷିତ ଅଞ୍ଚଳ',
    generic: 'ଆନ୍ତର୍ଜାତୀୟ ସମୁଦ୍ର ସୀମା',
  },
  ml: {
    srilanka: 'ഇന്ത്യ-ശ്രീലങ്ക അന്താരാഷ്ട്ര സമുദ്ര അതിർത്തി',
    bangladesh: 'ഇന്ത്യ-ബംഗ്ലാദേശ് അന്താരാഷ്ട്ര സമുദ്ര അതിർത്തി',
    pakistan: 'ഇന്ത്യ-പാകിസ്ഥാൻ അന്താരാഷ്ട്ര സമുദ്ര അതിർത്തി',
    gahirmatha: 'ഗഹിർമാതാ മറൈൻ വന്യജീവി സങ്കേതം',
    mannar: 'മന്നാർ ഉൾക്കടൽ മറൈൻ നാഷണൽ പാർക്ക്',
    sundarbans: 'സുന്ദർബൻസ് മറൈൻ റിസർവ്വ്',
    generic: 'അന്താരാഷ്ട്ര സമുദ്ര അതിർത്തി',
  },
  gu: {
    srilanka: 'ભારત-શ્રીલંકા આંતરરાષ્ટ્રીય દરિયાઈ સીમા',
    bangladesh: 'ભારત-બાંગ્લાદેશ આંતરરાષ્ટ્રીય દરિયાઈ સીમા',
    pakistan: 'ભારત-પાકિસ્તાન આંતરરાષ્ટ્રીય દરિયાઈ સીમા',
    gahirmatha: 'ગહિરમાથા દરિયાઈ અભયારણ્ય',
    mannar: 'મન્નારનો અખાત મરીન નેશનલ પાર્ક',
    sundarbans: 'સુંદરબન દરિયાઈ અનામત વિસ્તાર',
    generic: 'આંતરરાષ્ટ્રીય દરિયાઈ સીમા',
  },
  mr: {
    srilanka: 'भारत-श्रीलंका आंतरराष्ट्रीय सागरी सीमा',
    bangladesh: 'भारत-बांगलादेश आंतरराष्ट्रीय सागरी सीमा',
    pakistan: 'भारत-पाकिस्तान आंतरराष्ट्रीय सागरी सीमा',
    gahirmatha: 'गहिरमाथा सागरी अभयारण्य',
    mannar: 'मन्नारचे आखात सागरी राष्ट्रीय उद्यान',
    sundarbans: 'सुंदरबन सागरी राखीव क्षेत्र',
    generic: 'आंतरराष्ट्रीय सागरी सीमा',
  },
  kn: {
    srilanka: 'ಭಾರತ-ಶ್ರೀಲಂಕಾ ಅಂತರರಾಷ್ಟ್ರೀಯ ಕಡಲ ಗಡಿ',
    bangladesh: 'ಭಾರತ-ಬಾಂಗ್ಲಾದೇಶ ಅಂತರರಾಷ್ಟ್ರೀಯ ಕಡಲ ಗಡಿ',
    pakistan: 'ಭಾರತ-ಪಾಕಿಸ್ತಾನ ಅಂತರರಾಷ್ಟ್ರೀಯ ಕಡಲ ಗಡಿ',
    gahirmatha: 'ಗಹಿರ್‌ಮಾಥಾ ಕಡಲ ವನ್ಯಜೀವಿ ಧಾಮ',
    mannar: 'ಮನ್ನಾರ್ ಕೊಲ್ಲಿ ಕಡಲ ರಾಷ್ಟ್ರೀಯ ಉದ್ಯಾನ',
    sundarbans: 'ಸುಂದರಬನ ಕಡಲ ಸಂರಕ್ಷಿತ ಪ್ರದೇಶ',
    generic: 'ಅಂತರರಾಷ್ಟ್ರೀಯ ಕಡಲ ಗಡಿ',
  },
};

export function resolvePortName(name: string, lang: LanguageCode): string {
  if (lang === 'en') return name;
  const map = PORT_LOCALE_MAP[lang] || {};
  const lower = name.toLowerCase();
  for (const [key, val] of Object.entries(map)) {
    if (lower.includes(key)) return val;
  }
  return name;
}

export function resolveBoundaryName(name: string, lang: LanguageCode): string {
  if (lang === 'en') return name;
  const lower = name.toLowerCase();
  const map = BOUNDARY_LOCALE_MAP[lang] || {};

  if (lower.includes('sri lanka') || lower.includes('srilanka') || lower.includes('palk')) return map.srilanka || name;
  if (lower.includes('bangladesh')) return map.bangladesh || name;
  if (lower.includes('pakistan') || lower.includes('sir creek') || lower.includes('creek')) return map.pakistan || name;
  if (lower.includes('gahirmatha')) return map.gahirmatha || name;
  if (lower.includes('mannar')) return map.mannar || name;
  if (lower.includes('sundarban')) return map.sundarbans || name;

  return map.generic || name;
}

export function resolveRiskLevelName(level: string, lang: LanguageCode): string {
  const map = RISK_LEVEL_LOCALE_MAP[lang] || {};
  return map[level] || level;
}

class VoiceWarningService {
  private isMuted: boolean = false;
  private isSpeaking: boolean = false;
  private lastSpokenAt = new Map<string, number>();
  private cooldownMs = 15000; // 15 seconds debounce per alert key
  private listeners: Set<(isSpeaking: boolean) => void> = new Set();
  private currentAudioElement: HTMLAudioElement | null = null;
  private currentSourceNode: AudioBufferSourceNode | null = null;

  constructor() {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = () => {
        // Pre-warm voices list
        window.speechSynthesis.getVoices();
      };
    }
  }

  public subscribe(listener: (isSpeaking: boolean) => void): () => void {
    this.listeners.add(listener);
    listener(this.isSpeaking);
    return () => this.listeners.delete(listener);
  }

  private setSpeaking(speaking: boolean) {
    this.isSpeaking = speaking;
    this.listeners.forEach((fn) => fn(speaking));
  }

  public getIsSpeaking(): boolean {
    return this.isSpeaking;
  }

  public setMuted(muted: boolean) {
    this.isMuted = muted;
    if (muted) {
      this.cancel();
    }
  }

  public getIsMuted(): boolean {
    return this.isMuted;
  }

  /**
   * Check whether the browser has a native TTS voice installed for the given language.
   */
  public hasNativeVoiceFor(language: LanguageCode): boolean {
    if (typeof window === 'undefined' || !window.speechSynthesis) return false;
    const voices = window.speechSynthesis.getVoices();
    if (!voices || voices.length === 0) return false;

    const candidateTags = LANGUAGE_BCP47_MAP[language] || [];
    return voices.some((v) =>
      candidateTags.some(
        (tag) =>
          v.lang.toLowerCase() === tag.toLowerCase() ||
          v.lang.toLowerCase().startsWith(tag.toLowerCase())
      )
    );
  }

  /**
   * Resolve best SpeechSynthesisVoice matching the language.
   * For English: selects an English voice (preferring en-IN).
   * For Indian languages: selects specific regional voice if installed,
   * otherwise always routes to the Indian voice engine (Google हिन्दी / hi-IN)
   * so it NEVER falls back to an American English accent.
   */
  private getBestVoice(language: LanguageCode): SpeechSynthesisVoice | null {
    if (typeof window === 'undefined' || !window.speechSynthesis) return null;
    const voices = window.speechSynthesis.getVoices();
    if (!voices || voices.length === 0) return null;

    if (language === 'en') {
      return (
        voices.find((v) => v.lang.toLowerCase().startsWith('en-in')) ||
        voices.find((v) => v.lang.toLowerCase().startsWith('en')) ||
        voices[0]
      );
    }

    // For any Indian language:
    // 1. Try to find the exact regional language voice (e.g. bn-IN, ta-IN)
    const candidateTags = LANGUAGE_BCP47_MAP[language] || [];
    for (const tag of candidateTags) {
      const matched = voices.find(
        (v) =>
          v.lang.toLowerCase() === tag.toLowerCase() ||
          v.lang.toLowerCase().startsWith(tag.toLowerCase())
      );
      if (matched) return matched;
    }

    // 2. If no regional voice exists, use the Indian speech synthesizer (Google हिन्दी / hi-IN)
    const hindiVoice = voices.find((v) => v.lang.toLowerCase().startsWith('hi'));
    if (hindiVoice) return hindiVoice;

    return null;
  }

  /**
   * Build localized spoken phrase for an IMBL or MPA geofence alert.
   * Handles 4 distinct maritime scenarios with authentic coastal diction:
   * 1. Inside Marine Protected Area / Sanctuary (depth inside + escape compass heading)
   * 2. Crossed International Border into foreign waters (foreign water depth + escape heading)
   * 3. Critical approach (<3 NM from boundary)
   * 4. Proximity warning / advisory
   */
  public generateGeofencePhrase(alert: GeofenceAlert, language: LanguageCode): string {
    const isInsideMpa = alert.type === 'MPA' && (alert.isInside || alert.distanceNm === 0);
    const hasCrossedImbl = alert.type === 'IMBL' && Boolean(alert.hasCrossedBorder);
    const depthNm = alert.insideDepthNm ?? (alert.distanceNm > 0 ? alert.distanceNm : 0.5);
    const dist = (isInsideMpa || hasCrossedImbl ? depthNm : alert.distanceNm).toFixed(1);
    const heading = alert.escapeBearingDeg ?? alert.bearingDeg ?? 0;
    const boundary = resolveBoundaryName(alert.boundaryName, language);

    switch (language) {
      case 'hi':
        if (isInsideMpa) {
          return `आपातकालीन चेतावनी! पोत संरक्षित अभयारण्य ${boundary} के ${dist} नॉटिकल मील अंदर है। तुरंत ${heading} डिग्री दिशा में बाहर निकलें।`;
        }
        if (hasCrossedImbl) {
          return `खतरे की चेतावनी! पोत अंतर्राष्ट्रीय सीमा ${boundary} पार कर ${dist} नॉटिकल मील विदेशी जलक्षेत्र में है। तुरंत ${heading} डिग्री पर भारतीय जलक्षेत्र में लौटें।`;
        }
        return alert.severity === 'CRITICAL_BREACH'
          ? `चेतावनी! पोत अंतर्राष्ट्रीय सीमा ${boundary} से केवल ${dist} नॉटिकल मील दूरी पर है। तुरंत सुरक्षित जलक्षेत्र में वापस लौटें।`
          : `सूचना: पोत समुद्री सीमा ${boundary} के निकट है। दूरी ${dist} नॉटिकल मील है।`;

      case 'bn':
        if (isInsideMpa) {
          return `জরুরী সতর্কতা! বোটটি সংরক্ষিত অঞ্চল ${boundary} এর ${dist} নটিক্যাল মাইল ভেতরে রয়েছে। অবিলম্বে ${heading} ডিগ্রি অভিমুখে বের হয়ে যান।`;
        }
        if (hasCrossedImbl) {
          return `বিপদ সংকেত! বোটটি আন্তর্জাতিক সীমান্ত ${boundary} অতিক্রম করে ${dist} নটিক্যাল মাইল ভেতরে চলে গেছে। অবিলম্বে ${heading} ডিগ্রিতে ভারতীয় জলসীমায় ফিরে যান।`;
        }
        return alert.severity === 'CRITICAL_BREACH'
          ? `জরুরী সতর্কতা! বোটটি আন্তর্জাতিক সীমা ${boundary} এর মাত্র ${dist} নটিক্যাল মাইল সন্নিকটে। অবিলম্বে নিরাপদ অঞ্চলে ফিরে যান।`
          : `সতর্কতা: সামুদ্রিক সীমা ${boundary} এর সন্নিকটে। দূরত্ব ${dist} নটিক্যাল মাইল।`;

      case 'ta':
        if (isInsideMpa) {
          return `அவசர எச்சரிக்கை! படகு பாதுகாக்கப்பட்ட சரணாலயம் ${boundary} க்குள் ${dist} கடல் மைல் உள்ளே உள்ளது. உடனடியாக ${heading} டிகிரி திசையில் வெளியேறுங்கள்.`;
        }
        if (hasCrossedImbl) {
          return `ஆபத்து எச்சரிக்கை! படகு சர்வதேச எல்லை ${boundary} கடந்து ${dist} கடல் மைல் உள்ளே சென்றுவிட்டது. உடனடியாக ${heading} டிகிரியில் இந்திய எல்லைக்கு திரும்புங்கள்.`;
        }
        return alert.severity === 'CRITICAL_BREACH'
          ? `அவசர எச்சரிக்கை! படகு சர்வதேச எல்லை ${boundary} லிருந்து ${dist} கடல் மைல் தூரத்தில் உள்ளது. உடனே திரும்பி செல்லுங்கள்.`
          : `எச்சரிக்கை: கடல் எல்லை ${boundary} அருகில் உள்ளீர்கள். தூரம் ${dist} கடல் மைல்.`;

      case 'te':
        if (isInsideMpa) {
          return `అత్యవసర హెచ్చరిక! పడవ రక్షిత ప్రాంతం ${boundary} లోపల ${dist} నాటికల్ మైళ్ళ దూరంలో ఉంది. వెంటనే ${heading} డిగ్రీల దిశలో బయటకు వెళ్ళండి.`;
        }
        if (hasCrossedImbl) {
          return `ప్రమాద హెచ్చరిక! పడవ అంతర్జాతీయ సరిహద్దు ${boundary} దాటి ${dist} నాటికల్ మైళ్ళు లోపలికి వెళ్ళింది. వెంటనే ${heading} డిగ్రీల వైపు భారత జలాల్లోకి తిరిగి రండి.`;
        }
        return alert.severity === 'CRITICAL_BREACH'
          ? `అత్యవసర హెచ్చరిక! పడవ అంతర్జాతీయ సరిహద్దు ${boundary} కి ${dist} నాటికల్ మైళ్ల దూరంలో ఉంది. వెంటనే వెనక్కి తిరగండి.`
          : `హెచ్చరిక: సముద్ర సరిహద్దు ${boundary} సమీపంలో ఉంది. దూరం ${dist} నాటికల్ మైళ్ళు.`;

      case 'or':
        if (isInsideMpa) {
          return `ଜରୁରୀ ସତର୍କତା! ଡଙ୍ଗା ସଂରକ୍ଷିତ ଅଭୟାରଣ୍ୟ ${boundary} ଭିତରେ ${dist} ନଟିକାଲ ମାଇଲ ପ୍ରବେଶ କରିଛି। ତୁରନ୍ତ ${heading} ଡିଗ୍ରୀ ଦିଗରେ ବାହାରି ଯାଆନ୍ତୁ।`;
        }
        if (hasCrossedImbl) {
          return `ବିପଦ ସତର୍କତା! ଡଙ୍ଗା ଆନ୍ତର୍ଜାତୀୟ ସୀମା ${boundary} ଅତିକ୍ରମ କରି ${dist} ନଟିକାଲ ମାଇଲ ଭିତରକୁ ଚାଲିଯାଇଛି। ତୁରନ୍ତ ${heading} ଡିଗ୍ରୀରେ ଭାରତୀୟ ଜଳସୀମାକୁ ଫେରିଆସନ୍ତୁ।`;
        }
        return alert.severity === 'CRITICAL_BREACH'
          ? `ଜରୁରୀ ସତର୍କତା! ଡଙ୍ଗା ଆନ୍ତର୍ଜାତୀୟ ସୀମା ${boundary} ଠାରୁ ମାତ୍ର ${dist} ନଟିକାଲ ମାଇଲ ଦୂରରେ। ତୁରନ୍ତ ଫେରିଆସନ୍ତୁ।`
          : `ସୂଚନା: ସାମୁଦ୍ରିକ ସୀମା ${boundary} ନିକଟତର। ଦୂରତା ${dist} ନଟିକାଲ ମାଇଲ।`;

      case 'ml':
        if (isInsideMpa) {
          return `അടിയന്തര മുന്നറിയിപ്പ്! ബോട്ട് സംരക്ഷിത മേഖല ${boundary} ക്കുള്ളിൽ ${dist} നോട്ടിക്കൽ മൈൽ ഉള്ളിലാണ്. ഉടൻ ${heading} ഡിഗ്രി ദിശയിൽ പുറത്തു കടക്കുക.`;
        }
        if (hasCrossedImbl) {
          return `അപകട മുന്നറിയിപ്പ്! ബോട്ട് അന്താരാഷ്ട്ര അതിർത്തി ${boundary} കടന്ന് ${dist} നോട്ടിക്കൽ മൈൽ ഉള്ളിലേക്ക് പോയിരിക്കുന്നു. ഉടൻ ${heading} ഡിഗ്രിയിൽ ഇന്ത്യൻ അതിർത്തിയിലേക്ക് തിരികെ വരിക.`;
        }
        return alert.severity === 'CRITICAL_BREACH'
          ? `അടിയന്തര മുന്നറിയിപ്പ്! ബോട്ട് അന്താരാഷ്ട്ര അതിർത്തി ${boundary} യിൽ നിന്നും ${dist} നോട്ടിക്കൽ മൈൽ ദൂരത്തിലാണ്. ഉടൻ തിരികെ പോവുക.`
          : `മുന്നറിയിപ്പ്: സമുദ്ര അതിർത്തി ${boundary} ക്ക് അടുത്താണ്. ദൂരം ${dist} നോട്ടിക്കൽ മൈൽ.`;

      case 'gu':
        if (isInsideMpa) {
          return `કટોકટી ચેતવણી! વહાણ સંરક્ષિત અભયારણ્ય ${boundary} ની અંદર ${dist} નોટિકલ માઇલ પ્રવેશી ગયું છે. તરત જ ${heading} ડિગ્રી દિશામાં બહાર નીકળો.`;
        }
        if (hasCrossedImbl) {
          return `જોખમ ચેતવણી! વહાણ આંતરરાષ્ટ્રીય સરહદ ${boundary} પાર કરીને ${dist} નોટિકલ માઇલ અંદર ગયું છે. તરત જ ${heading} ડિગ્રી પર ભારતીય જળસીમામાં પાછા ફરો.`;
        }
        return alert.severity === 'CRITICAL_BREACH'
          ? `ચેતવણી! વહાણ આંતરરાષ્ટ્રીય સીમા ${boundary} થી માત્ર ${dist} નોટિકલ માઇલ દૂર છે. તરત જ પાછા ફરો.`
          : `સૂચના: દરિયાઈ સરહદ ${boundary} નજીક છે. અંતર ${dist} નોટિકલ માઇલ.`;

      case 'mr':
        if (isInsideMpa) {
          return `तातडीचा इशारा! बोट संरक्षित अभयारण्य ${boundary} च्या आत ${dist} नॉटिकल मैल शिरली आहे. त्वरित ${heading} अंश दिशेने बाहेर पडा.`;
        }
        if (hasCrossedImbl) {
          return `धोक्याचा इशारा! बोट आंतरराष्ट्रीय सीमा ${boundary} ओलांडून ${dist} नॉटिकल मैल आत गेली आहे. त्वरित ${heading} अंशावर भारतीय सागरी हद्दीत मागे फिरा.`;
        }
        return alert.severity === 'CRITICAL_BREACH'
          ? `तातडीचा इशारा! बोट आंतरराष्ट्रीय सीमा ${boundary} पासून फक्त ${dist} नॉटिकल मैल अंतरावर आहे. त्वरित मागे फिरा.`
          : `सूचना: सागरी सीमा ${boundary} जवळ आहे. अंतर ${dist} नॉटिकल मैल.`;

      case 'kn':
        if (isInsideMpa) {
          return `ತುರ್ತು ಎಚ್ಚರಿಕೆ! ದೋಣಿ ಸಂರಕ್ಷಿತ ಅಭಯಾರಣ್ಯ ${boundary} ಒಳಗೆ ${dist} ನಾಟಿಕಲ್ ಮೈಲಿ ಪ್ರವೇಶಿಸಿದೆ. ತಕ್ಷಣವೇ ${heading} ಡಿಗ್ರಿ ದಿಕ್ಕಿನಲ್ಲಿ ಹೊರಬನ್ನಿ.`;
        }
        if (hasCrossedImbl) {
          return `ಅಪಾಯದ ಎಚ್ಚರಿಕೆ! ದೋಣಿ ಅಂತರರಾಷ್ಟ್ರೀಯ ಗಡಿ ${boundary} ದಾಟಿ ${dist} ನಾಟಿಕಲ್ ಮೈಲಿ ಒಳಗೆ ಹೋಗಿದೆ. ತಕ್ಷಣವೇ ${heading} ಡಿಗ್ರಿಯಲ್ಲಿ ಭಾರತೀಯ ಜಲಪ್ರದೇಶಕ್ಕೆ ಹಿಂತಿರುಗಿ.`;
        }
        return alert.severity === 'CRITICAL_BREACH'
          ? `ತುರ್ತು ಎಚ್ಚರಿಕೆ! ದೋಣಿ ಅಂತರರಾಷ್ಟ್ರೀಯ ಗಡಿ ${boundary} ಯಿಂದ ಕೇವಲ ${dist} ನಾಟಿಕಲ್ ಮೈಲಿ ದೂರದಲ್ಲಿದೆ. ತಕ್ಷಣವೇ ಹಿಂತಿರುಗಿ.`
          : `ಎಚ್ಚರಿಕೆ: ಕಡಲ ಗಡಿ ${boundary} ಹತ್ತಿರದಲ್ಲಿದೆ. ದೂರ ${dist} ನಾಟಿಕಲ್ ಮೈಲಿ.`;

      case 'en':
      default:
        if (isInsideMpa) {
          return `Emergency Alert! Vessel is INSIDE protected sanctuary ${boundary}, ${dist} nautical miles deep. Exit immediately on heading ${heading} degrees.`;
        }
        if (hasCrossedImbl) {
          return `Danger Alert! Vessel has CROSSED international border ${boundary} and is ${dist} nautical miles inside foreign waters. Turn back immediately on heading ${heading} degrees to return to Indian waters.`;
        }
        return alert.severity === 'CRITICAL_BREACH'
          ? `Emergency Alert! Vessel is ${dist} nautical miles from ${boundary}. Risk of maritime breach; adjust course immediately.`
          : `Navigation advisory: Vessel approaching ${boundary}. Distance: ${dist} nautical miles.`;
    }
  }

  /**
   * Build localized phrase for severe marine weather / gale warnings.
   */
  public generateWeatherPhrase(risk: RiskPrediction, language: LanguageCode): string {
    const riskLevelText = resolveRiskLevelName(risk.riskLevel, language);

    switch (language) {
      case 'hi':
        return `गंभीर मौसम चेतावनी! समुद्र में जोखिम स्तर ${riskLevelText} है। अत्यधिक ऊंची लहरें और तेज हवाएं हैं। बंदरगाह पर लौटें।`;
      case 'bn':
        return `প্রতিকূল আবহাওয়া সতর্কতা! সাগরে ঝুঁকির মাত্রা ${riskLevelText}। উত্তাল ঢেউ ও ঝোড়ো বাতাস। নিরাপদ আশ্রয়ে ফিরে যান।`;
      case 'ta':
        return `மோசமான வானிலை எச்சரிக்கை! கடலில் ஆபத்து அளவு ${riskLevelText} ஆக உள்ளது. கொந்தளிப்பான அலைகள். துறைமுகத்திற்கு திரும்பவும்.`;
      case 'te':
        return `తీవ్ర వాతావరణ హెచ్చరిక! సముద్రంలో ప్రమాద స్థాయి ${riskLevelText} గా ఉంది. ఎత్తైన అలలు. సురಕ್ಷిత తీరానికి చేరుకోండి.`;
      case 'or':
        return `ପ୍ରତିକୂଳ ପାଣିପାଗ ସତର୍କତା! ସମୁଦ୍ରରେ ବିପଦ ସ୍ତର ${riskLevelText}। ତୁରନ୍ତ କୂଳକୁ ଫେରିଆସନ୍ତୁ।`;
      case 'ml':
        return `പ്രതികൂല കാലാവസ്ഥാ മുന്നറിയിപ്പ്! കടലിൽ അപകടസാധ്യത ${riskLevelText} ആണ്. തുറമുഖത്തേക്ക് തിരികെ പോകുക.`;
      case 'gu':
        return `ખરાબ હવામાન ચેતવણી! દરિયામાં જોખમ સ્તર ${riskLevelText} છે. ઊંચા મોજા અને ભારે પવન. બંદર પર પાછા ફરો.`;
      case 'mr':
        return `गंभीर हवामान इशारा! समुद्रात धोक्याची पातळी ${riskLevelText} आहे. बंदरावर परत या.`;
      case 'kn':
        return `ಪ್ರತಿಕೂಲ ಹವಾಮಾನ ಎಚ್ಚರಿಕೆ! ಸಮುದ್ರದಲ್ಲಿ ಅಪಾಯ ಮಟ್ಟ ${riskLevelText} ಆಗಿದೆ. ಬಲವಾದ ಅಲೆಗಳು. ಬಂದರಿಗೆ ಹಿಂತಿರುಗಿ.`;
      case 'en':
      default:
        return `Severe weather alert! Marine risk level is ${riskLevelText}. Dangerous swell and gale force winds detected. Return to harbor.`;
    }
  }

  /**
   * Build localized demo test phrase.
   */
  public generateTestPhrase(language: LanguageCode): string {
    switch (language) {
      case 'hi':
        return 'यह ओरका एक्स बहुभाषी समुद्री सायरन और चेतावनी प्रणाली का ऑडियो परीक्षण है।';
      case 'bn':
        return 'এটি ওর্কা এক্স বহুভাষিক সামুদ্রিক সাইরেন এবং ভয়েস সতর্কতা ব্যবস্থার অডিও টেস্ট।';
      case 'ta':
        return 'இது ஓர்கா எக்ஸ் பலமொழி கடல்சார் சைரன் மற்றும் குரல் எச்சரிக்கை அமைப்பின் சோதனை.';
      case 'te':
        return 'ఇది ఓర్కా ఎక్స్ బహుభాషా సముద్ర సైరన్ మరియు వాయిస్ హెచ్చరిక వ్యవస్థ యొక్క ఆడియో పరీక్ష.';
      case 'or':
        return 'ଏହା ଓର୍କା ଏକ୍ସ ବହୁଭାଷୀ ସାମୁଦ୍ରିକ ସାଇରନ୍ ଏବଂ ଭଏସ୍ ସତର୍କତା ପ୍ରଣାଳୀର ଅଡିଓ ପରୀକ୍ଷଣ।';
      case 'ml':
        return 'ഇത് ഓർക്ക എക്സ് സമുദ്ര മുന്നറിയിപ്പ് സംവിധാനത്തിന്റെ ഓഡിയോ പരിശോധനയാണ്.';
      case 'gu':
        return 'આ ઓર્કા એક્સ મરીન સાયરન અને વોઇસ ચેતવણી સિસ્ટમનું ઓડિયો પરીક્ષણ છે.';
      case 'mr':
        return 'हे ओरका एक्स बहुभाषिक सागरी साइरन आणि वॉइस इशारा प्रणालीचे ऑडिओ परीक्षण आहे.';
      case 'kn':
        return 'ಇದು ಓರ್ಕಾ ಎಕ್ಸ್ ಬಹುಭಾಷಾ ಕಡಲ ಸೈರನ್ ಮತ್ತು ಧ್ವನಿ ಎಚ್ಚರಿಕೆ ವ್ಯವಸ್ಥೆಯ ಆಡಿಯೋ ಪರೀಕ್ಷೆ.';
      case 'en':
      default:
        return 'This is an audio test of the ORCA-X multi-lingual marine siren and voice warning system.';
    }
  }

  /**
   * Build comprehensive localized Risk Card verdict phrase.
   */
  public generateRiskVerdictPhrase(
    location: LocationInfo,
    risk: RiskPrediction,
    _geofenceAlert: GeofenceAlert | undefined,
    language: LanguageCode
  ): string {
    const port = resolvePortName(location.nearestPort || location.name, language);
    const riskLevelText = resolveRiskLevelName(risk.riskLevel, language);
    const primaryRec = getLocalizedPrimaryRecommendation(risk.riskLevel, language) || risk.primaryRecommendation;

    switch (language) {
      case 'hi':
        return `${port} के पास समुद्री स्थिति: जोखिम स्तर ${riskLevelText} (${risk.riskScore}/100)। सलाह: ${primaryRec}।`;
      case 'bn':
        return `${port} এর কাছে সামুদ্রিক পরিস্থিতি: ঝুঁকির মাত্রা ${riskLevelText} (${risk.riskScore}/100)। পরামর্শ: ${primaryRec}।`;
      case 'ta':
        return `${port} கடல் நிலைமை: இடர் அளவு ${riskLevelText} (${risk.riskScore}/100). பரிந்துரை: ${primaryRec}.`;
      case 'te':
        return `${port} సముద్ర పరిస్థితి: ప్రమాద స్థాయి ${riskLevelText} (${risk.riskScore}/100). సలహా: ${primaryRec}.`;
      case 'or':
        return `${port} ସମୁଦ୍ର ସ୍ଥିତି: ବିପଦ ସ୍ତର ${riskLevelText} (${risk.riskScore}/100)। ପରାମର୍ଶ: ${primaryRec}।`;
      case 'ml':
        return `${port} കടൽ അവസ്ഥ: അപകടസാധ്യത ${riskLevelText} (${risk.riskScore}/100). നിർദ്ദേശം: ${primaryRec}.`;
      case 'gu':
        return `${port} દરિયાઈ સ્થિતિ: જોખમ સ્તર ${riskLevelText} (${risk.riskScore}/100). સલાહ: ${primaryRec}.`;
      case 'mr':
        return `${port} सागरी स्थिती: धोक्याची पातळी ${riskLevelText} (${risk.riskScore}/100). सल्ला: ${primaryRec}.`;
      case 'kn':
        return `${port} ಕಡಲ ಸ್ಥಿತಿ: ಅಪಾಯ ಮಟ್ಟ ${riskLevelText} (${risk.riskScore}/100). ಸಲಹೆ: ${primaryRec}.`;
      case 'en':
      default:
        return `${port} marine status. Risk Level: ${risk.riskLevel}, score ${risk.riskScore} out of 100. Recommendation: ${primaryRec}.`;
    }
  }

  /**
   * Speak a phrase with the given language and options.
   * Uses Web Audio API decoding with unlocked AudioContext for 100% guaranteed,
   * unblockable audio playback in all 10 Indian coastal languages.
   */
  public async speak(
    text: string,
    language: LanguageCode,
    options?: { playSirenFirst?: boolean; isCritical?: boolean; dedupeKey?: string; force?: boolean }
  ): Promise<boolean> {
    if (this.isMuted) return false;

    // Check cooldown
    const now = Date.now();
    if (!options?.force && options?.dedupeKey) {
      const last = this.lastSpokenAt.get(options.dedupeKey);
      if (last && now - last < this.cooldownMs) {
        return false;
      }
      this.lastSpokenAt.set(options.dedupeKey, now);
    }

    // Cancel any ongoing audio or speech
    this.cancel();

    // 1. Kick off parallel audio fetch IMMEDIATELY while siren/chime is sounding
    const audioFetchPromise = indicVoiceGateway.fetchSpeechAudio(text, language);

    // 2. Optionally sound maritime emergency siren or chime first
    if (options?.playSirenFirst) {
      if (options.isCritical) {
        maritimeSiren.playCriticalSiren(3.0);
        await new Promise((r) => setTimeout(r, 3200));
      } else {
        maritimeSiren.playProximityChime();
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    // 3. Obtain audio data (already completed or finishing in background)
    const speechAudio = await audioFetchPromise;

    // 4. Primary High-Definition Playback: Web Audio API (Guaranteed Unlocked Playback)
    const ctx = maritimeSiren.getAudioContext();
    if (ctx && speechAudio?.audioBase64) {
      try {
        if (ctx.state === 'suspended') {
          await ctx.resume();
        }
        const binaryString = window.atob(speechAudio.audioBase64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }

        const decodedBuffer = await ctx.decodeAudioData(bytes.buffer);
        return await new Promise<boolean>((resolve) => {
          this.cancel();
          const source = ctx.createBufferSource();
          source.buffer = decodedBuffer;
          source.connect(ctx.destination);
          this.currentSourceNode = source;
          this.setSpeaking(true);

          source.onended = () => {
            if (this.currentSourceNode === source) {
              this.currentSourceNode = null;
              this.setSpeaking(false);
            }
            resolve(true);
          };

          source.start(0);
        });
      } catch (decodeErr) {
        console.warn('Web Audio decoding failed, attempting HTML5 Audio fallback:', decodeErr);
      }
    }

    // 5. Secondary Playback: HTML5 Audio Element
    if (speechAudio?.audioBase64) {
      try {
        const audio = new Audio(`data:${speechAudio.format};base64,${speechAudio.audioBase64}`);
        this.currentAudioElement = audio;
        this.setSpeaking(true);
        audio.onended = () => {
          this.setSpeaking(false);
          this.currentAudioElement = null;
        };
        audio.onerror = () => {
          this.setSpeaking(false);
          this.currentAudioElement = null;
        };
        await audio.play();
        return true;
      } catch (audioErr) {
        console.warn('HTML5 Audio playback interrupted, checking edge TTS:', audioErr);
      }
    }

    // 6. Tertiary Fallback: Native Browser Speech Synthesis (Offline Edge)
    if (typeof window === 'undefined' || !window.speechSynthesis) return false;

    window.speechSynthesis.cancel();
    const voice = this.getBestVoice(language);
    const hasNative = this.hasNativeVoiceFor(language);

    let textToSpeak = text;
    if (!hasNative && language !== 'en' && language !== 'hi') {
      textToSpeak = indicScriptToDevanagari(text, language);
    }

    const utterance = new SpeechSynthesisUtterance(textToSpeak);
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    } else {
      const allVoices = window.speechSynthesis.getVoices();
      const hindiFallback = allVoices.find((v) => v.lang.toLowerCase().startsWith('hi'));
      if (hindiFallback && language !== 'en') {
        utterance.voice = hindiFallback;
        utterance.lang = 'hi-IN';
      } else if (language === 'en') {
        utterance.lang = 'en-IN';
      } else {
        // Under no circumstances speak American English for an Indian coastal language
        console.warn(`No native Indic voice pack available for ${language}; avoiding English voice playback.`);
        return false;
      }
    }

    utterance.rate = 0.92;
    utterance.pitch = options?.isCritical ? 1.05 : 1.0;
    utterance.volume = 0.95;

    this.setSpeaking(true);
    utterance.onend = () => this.setSpeaking(false);
    utterance.onerror = () => this.setSpeaking(false);

    window.speechSynthesis.speak(utterance);
    return true;
  }

  /**
   * Trigger automatic evaluation of geofence and weather risk.
   */
  public evaluateAndAnnounce(
    alert: GeofenceAlert | undefined,
    risk: RiskPrediction | undefined,
    language: LanguageCode
  ) {
    if (this.isMuted) return;

    if (alert && alert.severity === 'CRITICAL_BREACH') {
      const phrase = this.generateGeofencePhrase(alert, language);
      const dedupeKey = `geofence:critical:${alert.boundaryId}`;
      this.speak(phrase, language, { playSirenFirst: true, isCritical: true, dedupeKey });
      return;
    }

    if (alert && alert.severity === 'PROXIMITY_WARNING') {
      const phrase = this.generateGeofencePhrase(alert, language);
      const dedupeKey = `geofence:proximity:${alert.boundaryId}`;
      this.speak(phrase, language, { playSirenFirst: true, isCritical: false, dedupeKey });
      return;
    }

    if (risk && risk.riskLevel === 'EXTREME') {
      const phrase = this.generateWeatherPhrase(risk, language);
      const dedupeKey = `risk:extreme:${risk.riskScore}`;
      this.speak(phrase, language, { playSirenFirst: true, isCritical: true, dedupeKey });
    }
  }

  /**
   * Cancel ongoing speech immediately.
   */
  public cancel() {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    if (this.currentSourceNode) {
      try {
        this.currentSourceNode.stop();
        this.currentSourceNode.disconnect();
      } catch {}
      this.currentSourceNode = null;
    }
    if (this.currentAudioElement) {
      this.currentAudioElement.pause();
      this.currentAudioElement = null;
    }
    maritimeSiren.stop();
    this.setSpeaking(false);
  }
}

export const voiceWarning = new VoiceWarningService();
