import {
  LanguageCode,
  OceanData,
  RiskPrediction,
  WeatherData,
} from '../types';
import { localizeFeatureName } from './presentationLocalization';

type RiskCopy = {
  primary: string;
  summary: (ocean: OceanData, weather: WeatherData) => string;
  advisories: string[];
  restricted: string[];
  safe: string[];
};

type GroundedLabels = {
  live: string;
  wave: string;
  wind: string;
  swell: string;
  current: string;
  sea: string;
  retrieved: string;
  advisories: string;
  evidence: string;
};

const copy: Partial<
  Record<LanguageCode, Record<RiskPrediction['riskLevel'], RiskCopy>>
> = {
  // ---------------------------------------------------------------------------
  // ENGLISH
  // ---------------------------------------------------------------------------
  en: {
    LOW: {
      primary:
        'Favorable conditions. Safe for routine fishing operations.',
      summary: (o, w) =>
        `Normal sea state (Douglas Scale ${o.seaStateIndex}). Wave height is ${o.waveHeightMeters.toFixed(
          1
        )}m and wind is ${w.windSpeedKts.toFixed(0)} kts.`,
      advisories: [
        'Carry lifejackets and verify VHF Marine Channel 16.',
        'Observe routine tidal timings near harbor sandbars.',
      ],
      restricted: [],
      safe: [
        'Traditional non-motorized boats',
        'Motorized FRP crafts',
        'Mechanized trawlers and gillnetters',
        'Commercial vessels',
      ],
    },

    MODERATE: {
      primary:
        'Proceed with elevated caution. Small crafts should remain vigilant near breakers.',
      summary: (o, w) =>
        `Moderate sea state (Douglas Scale ${o.seaStateIndex}). Waves are ${o.waveHeightMeters.toFixed(
          1
        )}m with gusts up to ${w.windGustKts.toFixed(0)} kts.`,
      advisories: [
        'Keep small non-motorized boats close to shore.',
        'Check anchor lines, bilges, and fuel before departure.',
        'Monitor VHF Marine Channel 16 for official updates.',
      ],
      restricted: ['Small unstabilized canoes and rafts'],
      safe: [
        'Experienced motorized FRP crews',
        'Deep-sea mechanized trawlers',
        'Coast Guard patrol vessels',
      ],
    },

    HIGH: {
      primary:
        'High risk. Small crafts and artisanal boats should not enter open sea.',
      summary: (o, w) =>
        `Rough sea state (Douglas Scale ${o.seaStateIndex}). Waves of ${o.waveHeightMeters.toFixed(
          1
        )}m and gusts of ${w.windGustKts.toFixed(
          0
        )} kts create serious hazards.`,
      advisories: [
        'Do not enter deep sea or exposed coastal waters.',
        'Vessels already at sea should return to the nearest harbour.',
        'Secure moored crafts and strengthen harbor moorings.',
      ],
      restricted: [
        'All non-motorized crafts',
        'Small motorized FRP crafts',
        'Recreational water-sport vessels',
      ],
      safe: [
        'Large all-weather trawlers with caution',
        'Coast Guard and naval vessels',
      ],
    },

    EXTREME: {
      primary:
        'Extreme hazard. Suspend all marine and fishing activities.',
      summary: (o, w) =>
        `Very rough sea state (Douglas Scale ${o.seaStateIndex}). Waves of ${o.waveHeightMeters.toFixed(
          1
        )}m and gusts of ${w.windGustKts.toFixed(
          0
        )} kts threaten life and vessel integrity.`,
      advisories: [
        'No fishing vessel departures are permitted.',
        'Evacuate low-lying beach landing areas.',
        'Maintain continuous radio watch for disaster instructions.',
      ],
      restricted: [
        'All fishing crafts',
        'Artisanal boats',
        'Small and medium trawlers',
        'Tugs and barges',
      ],
      safe: ['Emergency rescue vessels only'],
    },
  },

  // ---------------------------------------------------------------------------
  // BENGALI
  // ---------------------------------------------------------------------------
  bn: {
    LOW: {
      primary: 'অনুকূল পরিস্থিতি। নিয়মিত মাছ ধরার কাজের জন্য নিরাপদ।',
      summary: (o, w) =>
        `স্বাভাবিক সমুদ্র অবস্থা (ডগলাস স্কেল ${o.seaStateIndex})। ঢেউ ${o.waveHeightMeters.toFixed(
          1
        )} মিটার এবং বাতাস ${w.windSpeedKts.toFixed(0)} নট।`,
      advisories: [
        'লাইফজ্যাকেট সঙ্গে রাখুন এবং VHF মেরিন চ্যানেল ১৬ পরীক্ষা করুন।',
        'বন্দরের বালুচরের কাছে জোয়ারের সময় মেনে চলুন।',
      ],
      restricted: [],
      safe: [
        'ঐতিহ্যবাহী ছোট নৌকা',
        'মোটরচালিত FRP নৌকা',
        'যান্ত্রিক ট্রলার ও গিলনেট নৌকা',
        'বাণিজ্যিক নৌযান',
      ],
    },

    MODERATE: {
      primary:
        'বাড়তি সতর্কতার সঙ্গে চলুন। ভাঙা ঢেউয়ের কাছে ছোট নৌকাকে সতর্ক থাকতে হবে।',
      summary: (o, w) =>
        `মাঝারি সমুদ্র অবস্থা (ডগলাস স্কেল ${o.seaStateIndex})। ঢেউ ${o.waveHeightMeters.toFixed(
          1
        )} মিটার, ঝোড়ো হাওয়া ${w.windGustKts.toFixed(0)} নট পর্যন্ত।`,
      advisories: [
        'ছোট নৌকা উপকূলের কাছাকাছি রাখুন।',
        'যাত্রার আগে নোঙর, বিলজ ও জ্বালানি পরীক্ষা করুন।',
        'সরকারি তথ্যের জন্য VHF মেরিন চ্যানেল ১৬ নজরে রাখুন।',
      ],
      restricted: ['ছোট অস্থিতিশীল ডিঙি ও ভেলা'],
      safe: [
        'অভিজ্ঞ মোটরচালিত FRP নৌকা',
        'গভীর সমুদ্রের যান্ত্রিক ট্রলার',
        'কোস্ট গার্ড টহল নৌকা',
      ],
    },

    HIGH: {
      primary:
        'উচ্চ ঝুঁকি। ছোট নৌকা ও কারিগরি মাছ ধরার নৌযান সমুদ্রে যাবেন না।',
      summary: (o, w) =>
        `রুক্ষ সমুদ্র অবস্থা (ডগলাস স্কেল ${o.seaStateIndex})। ${o.waveHeightMeters.toFixed(
          1
        )} মিটার ঢেউ ও ${w.windGustKts.toFixed(
          0
        )} নট ঝোড়ো হাওয়া গুরুতর বিপদ তৈরি করছে।`,
      advisories: [
        'গভীর সমুদ্র বা উন্মুক্ত উপকূলে যাবেন না।',
        'সমুদ্রে থাকা নৌযান নিকটতম বন্দরে ফিরে আসুন।',
        'নোঙর করা নৌকা সুরক্ষিত করুন এবং দড়ি শক্ত করুন।',
      ],
      restricted: [
        'সব অ-মোটরচালিত নৌকা',
        'ছোট মোটরচালিত FRP নৌকা',
        'জলক্রীড়ার নৌযান',
      ],
      safe: [
        'সতর্কতার সঙ্গে বড় ট্রলার',
        'কোস্ট গার্ড ও নৌবাহিনীর নৌযান',
      ],
    },

    EXTREME: {
      primary:
        'চরম বিপদ। সব সামুদ্রিক ও মাছ ধরার কাজ বন্ধ রাখুন।',
      summary: (o, w) =>
        `অত্যন্ত রুক্ষ সমুদ্র অবস্থা (ডগলাস স্কেল ${o.seaStateIndex})। ${o.waveHeightMeters.toFixed(
          1
        )} মিটার ঢেউ ও ${w.windGustKts.toFixed(
          0
        )} নট ঝোড়ো হাওয়া প্রাণঘাতী।`,
      advisories: [
        'কোনো মাছ ধরার নৌযান সমুদ্রে ছাড়বেন না।',
        'নিচু সৈকত ও মাছ নামানোর স্থান থেকে সরে যান।',
        'দুর্যোগ ব্যবস্থাপনার নির্দেশের জন্য রেডিও চালু রাখুন।',
      ],
      restricted: [
        'সব মাছ ধরার নৌযান',
        'ছোট নৌকা',
        'ছোট ও মাঝারি ট্রলার',
        'টাগ ও বার্জ',
      ],
      safe: ['শুধু জরুরি উদ্ধার নৌযান'],
    },
  },

  // ---------------------------------------------------------------------------
  // HINDI
  // ---------------------------------------------------------------------------
  hi: {
    LOW: {
      primary:
        'अनुकूल परिस्थितियां। नियमित मछली पकड़ने के लिए सुरक्षित।',
      summary: (o, w) =>
        `सामान्य समुद्री स्थिति (डगलस स्केल ${o.seaStateIndex})। लहर ${o.waveHeightMeters.toFixed(
          1
        )} मीटर और हवा ${w.windSpeedKts.toFixed(0)} नॉट।`,
      advisories: [
        'लाइफ जैकेट रखें और VHF मरीन चैनल 16 जांचें।',
        'बंदरगाह के पास ज्वार का समय ध्यान में रखें।',
      ],
      restricted: [],
      safe: [
        'पारंपरिक छोटी नावें',
        'मोटर चालित FRP नावें',
        'यांत्रिक ट्रॉलर और गिलनेट नावें',
        'व्यावसायिक पोत',
      ],
    },

    MODERATE: {
      primary:
        'अतिरिक्त सावधानी बरतें। छोटी नावें टूटती लहरों के पास सतर्क रहें।',
      summary: (o, w) =>
        `मध्यम समुद्री स्थिति (डगलस स्केल ${o.seaStateIndex})। लहर ${o.waveHeightMeters.toFixed(
          1
        )} मीटर और झोंके ${w.windGustKts.toFixed(0)} नॉट तक।`,
      advisories: [
        'छोटी नावों को तट के पास रखें।',
        'प्रस्थान से पहले एंकर, बिल्ज और ईंधन जांचें।',
        'आधिकारिक सूचना के लिए VHF चैनल 16 सुनें।',
      ],
      restricted: ['छोटी अस्थिर डोंगी और राफ्ट'],
      safe: [
        'अनुभवी मोटर चालित FRP दल',
        'गहरे समुद्र के यांत्रिक ट्रॉलर',
        'कोस्ट गार्ड गश्ती पोत',
      ],
    },

    HIGH: {
      primary:
        'उच्च जोखिम। छोटी नावें और मछुआरे खुले समुद्र में न जाएं।',
      summary: (o, w) =>
        `रफ समुद्री स्थिति (डगलस स्केल ${o.seaStateIndex})। ${o.waveHeightMeters.toFixed(
          1
        )} मीटर लहर और ${w.windGustKts.toFixed(
          0
        )} नॉट झोंके गंभीर खतरा पैदा करते हैं।`,
      advisories: [
        'गहरे समुद्र या खुले तट में न जाएं।',
        'समुद्र में मौजूद नावें निकटतम बंदरगाह लौटें।',
        'बांधी गई नावों और मूरिंग रस्सियों को सुरक्षित करें।',
      ],
      restricted: [
        'सभी गैर-मोटर चालित नावें',
        'छोटी FRP नावें',
        'जल-क्रीड़ा पोत',
      ],
      safe: [
        'सावधानी के साथ बड़े ट्रॉलर',
        'कोस्ट गार्ड और नौसेना पोत',
      ],
    },

    EXTREME: {
      primary:
        'अत्यधिक खतरा। सभी समुद्री और मछली पकड़ने की गतिविधियां रोकें।',
      summary: (o, w) =>
        `बहुत खराब समुद्री स्थिति (डगलस स्केल ${o.seaStateIndex})। ${o.waveHeightMeters.toFixed(
          1
        )} मीटर लहर और ${w.windGustKts.toFixed(
          0
        )} नॉट झोंके जीवन के लिए खतरा हैं।`,
      advisories: [
        'किसी भी मछली पकड़ने वाले पोत को रवाना न करें।',
        'निचले समुद्र तट और लैंडिंग क्षेत्रों से हटें।',
        'आपदा निर्देशों के लिए रेडियो निगरानी रखें।',
      ],
      restricted: [
        'सभी मछली पकड़ने वाले पोत',
        'छोटी नावें',
        'छोटे और मध्यम ट्रॉलर',
        'टग और बार्ज',
      ],
      safe: ['केवल आपातकालीन बचाव पोत'],
    },
  },

  // ---------------------------------------------------------------------------
  // TAMIL
  // ---------------------------------------------------------------------------
  ta: {
    LOW: {
      primary:
        'சாதகமான சூழ்நிலைகள். வழக்கமான மீன்பிடி நடவடிக்கைகளுக்கு பாதுகாப்பானது.',
      summary: (o, w) =>
        `சாதாரண கடல் நிலை (டக்ளஸ் அளவுகோல் ${o.seaStateIndex}). அலை உயரம் ${o.waveHeightMeters.toFixed(
          1
        )}m மற்றும் காற்று ${w.windSpeedKts.toFixed(0)} kts.`,
      advisories: [
        'லைஃப் ஜாக்கெட்டுகளை எடுத்துச் செல்லுங்கள் மற்றும் VHF மரைன் சேனல் 16-ஐ சரிபார்க்கவும்.',
        'துறைமுகத்திற்கு அருகிலுள்ள அலை நேரங்களை கவனிக்கவும்.',
      ],
      restricted: [],
      safe: [
        'பாரம்பரிய சிறிய படகுகள்',
        'மோட்டார் பொருத்தப்பட்ட FRP படகுகள்',
        'இயந்திர ட்ராலர்கள்',
        'வணிகக் கப்பல்கள்',
      ],
    },

    MODERATE: {
      primary:
        'கூடுதல் எச்சரிக்கையுடன் செயல்படுங்கள். சிறிய படகுகள் அலை உடையும் பகுதிகளில் கவனமாக இருக்க வேண்டும்.',
      summary: (o, w) =>
        `மிதமான கடல் நிலை (டக்ளஸ் அளவுகோல் ${o.seaStateIndex}). அலைகள் ${o.waveHeightMeters.toFixed(
          1
        )}m மற்றும் காற்று வேகம் ${w.windGustKts.toFixed(0)} kts வரை.`,
      advisories: [
        'சிறிய படகுகளை கரைக்கு அருகில் வைத்திருக்கவும்.',
        'புறப்படும் முன் நங்கூரம், பில்ஜ் மற்றும் எரிபொருளைச் சரிபார்க்கவும்.',
        'அதிகாரப்பூர்வ தகவல்களுக்கு VHF சேனல் 16-ஐ கண்காணிக்கவும்.',
      ],
      restricted: ['சிறிய நிலையற்ற படகுகள் மற்றும் தெப்பங்கள்'],
      safe: [
        'அனுபவமுள்ள FRP குழுக்கள்',
        'ஆழ்கடல் இயந்திர ட்ராலர்கள்',
        'கடலோர காவல் படகுகள்',
      ],
    },

    HIGH: {
      primary:
        'அதிக ஆபத்து. சிறிய படகுகள் மற்றும் மீனவர்கள் திறந்த கடலுக்குச் செல்லக்கூடாது.',
      summary: (o, w) =>
        `கரடுமுரடான கடல் நிலை (டக்ளஸ் அளவுகோல் ${o.seaStateIndex}). ${o.waveHeightMeters.toFixed(
          1
        )}m அலைகள் மற்றும் ${w.windGustKts.toFixed(
          0
        )} kts காற்று கடுமையான ஆபத்தை ஏற்படுத்துகின்றன.`,
      advisories: [
        'ஆழ்கடல் அல்லது திறந்த கடலோர நீருக்கு செல்ல வேண்டாம்.',
        'கடலில் உள்ள படகுகள் அருகிலுள்ள துறைமுகத்திற்குத் திரும்ப வேண்டும்.',
        'கட்டப்பட்ட படகுகள் மற்றும் மூரிங் கயிறுகளைப் பாதுகாக்கவும்.',
      ],
      restricted: [
        'அனைத்து மோட்டார் இல்லாத படகுகள்',
        'சிறிய FRP படகுகள்',
        'நீர்விளையாட்டு படகுகள்',
      ],
      safe: [
        'பெரிய ட்ராலர்கள் மிகுந்த எச்சரிக்கையுடன்',
        'கடலோர காவல் மற்றும் கடற்படை கப்பல்கள்',
      ],
    },

    EXTREME: {
      primary:
        'மிகவும் ஆபத்தான நிலை. அனைத்து கடல் மற்றும் மீன்பிடி நடவடிக்கைகளையும் நிறுத்துங்கள்.',
      summary: (o, w) =>
        `மிகவும் கடுமையான கடல் நிலை (டக்ளஸ் அளவுகோல் ${o.seaStateIndex}). ${o.waveHeightMeters.toFixed(
          1
        )}m அலைகள் மற்றும் ${w.windGustKts.toFixed(
          0
        )} kts காற்று உயிருக்கு ஆபத்தானவை.`,
      advisories: [
        'எந்த மீன்பிடி படகையும் கடலுக்கு அனுப்ப வேண்டாம்.',
        'தாழ்வான கடலோர பகுதிகளில் இருந்து வெளியேறவும்.',
        'அவசர அறிவுறுத்தல்களுக்காக ரேடியோவை கண்காணிக்கவும்.',
      ],
      restricted: [
        'அனைத்து மீன்பிடி படகுகள்',
        'சிறிய படகுகள்',
        'சிறிய மற்றும் நடுத்தர ட்ராலர்கள்',
        'டக்கள் மற்றும் பார்ஜ்கள்',
      ],
      safe: ['அவசரகால மீட்பு கப்பல்கள் மட்டும்'],
    },
  },

  // ---------------------------------------------------------------------------
  // ODIA
  // ---------------------------------------------------------------------------
  or: {
    LOW: {
      primary:
        'ଅନୁକୂଳ ପରିସ୍ଥିତି। ନିୟମିତ ମାଛଧରା କାର୍ଯ୍ୟ ପାଇଁ ସୁରକ୍ଷିତ।',
      summary: (o, w) =>
        `ସାଧାରଣ ସମୁଦ୍ର ଅବସ୍ଥା (ଡଗ୍ଲାସ୍ ସ୍କେଲ୍ ${o.seaStateIndex})। ଢେଉର ଉଚ୍ଚତା ${o.waveHeightMeters.toFixed(
          1
        )} ମିଟର ଏବଂ ପବନ ${w.windSpeedKts.toFixed(0)} ନଟ୍।`,
      advisories: [
        'ଲାଇଫ୍ ଜ୍ୟାକେଟ୍ ସାଙ୍ଗରେ ରଖନ୍ତୁ ଏବଂ VHF ମେରିନ୍ ଚ୍ୟାନେଲ୍ 16 ଯାଞ୍ଚ କରନ୍ତୁ।',
        'ବନ୍ଦର ନିକଟରେ ଜୁଆର-ଭଟ୍ଟା ସମୟ ଧ୍ୟାନରେ ରଖନ୍ତୁ।',
      ],
      restricted: [],
      safe: [
        'ପାରମ୍ପରିକ ଛୋଟ ନୌକା',
        'ମୋଟରଚାଳିତ FRP ନୌକା',
        'ଯାନ୍ତ୍ରିକ ଟ୍ରଲର୍',
        'ବାଣିଜ୍ୟିକ ଜାହାଜ',
      ],
    },

    MODERATE: {
      primary:
        'ଅଧିକ ସତର୍କତାର ସହିତ ଚାଲନ୍ତୁ। ଭଙ୍ଗା ଢେଉ ନିକଟରେ ଛୋଟ ନୌକା ସାବଧାନ ରହନ୍ତୁ।',
      summary: (o, w) =>
        `ମଧ୍ୟମ ସମୁଦ୍ର ଅବସ୍ଥା (ଡଗ୍ଲାସ୍ ସ୍କେଲ୍ ${o.seaStateIndex})। ଢେଉ ${o.waveHeightMeters.toFixed(
          1
        )} ମିଟର ଏବଂ ଝଟକା ପବନ ${w.windGustKts.toFixed(0)} ନଟ୍ ପର୍ଯ୍ୟନ୍ତ।`,
      advisories: [
        'ଛୋଟ ନୌକାକୁ ଉପକୂଳ ନିକଟରେ ରଖନ୍ତୁ।',
        'ଯିବା ପୂର୍ବରୁ ନଙ୍ଗର, ବିଲ୍ଜ୍ ଓ ଇନ୍ଧନ ଯାଞ୍ଚ କରନ୍ତୁ।',
        'ସରକାରୀ ସୂଚନା ପାଇଁ VHF ଚ୍ୟାନେଲ୍ 16 ଶୁଣନ୍ତୁ।',
      ],
      restricted: ['ଛୋଟ ଅସ୍ଥିର ଡଙ୍ଗା ଓ ଭେଳା'],
      safe: [
        'ଅଭିଜ୍ଞ FRP ଦଳ',
        'ଗଭୀର ସମୁଦ୍ର ଟ୍ରଲର୍',
        'କୋଷ୍ଟ ଗାର୍ଡ ଟହଲ ନୌକା',
      ],
    },

    HIGH: {
      primary:
        'ଉଚ୍ଚ ବିପଦ। ଛୋଟ ନୌକା ଓ ମାଛଧରାଳି ଖୋଲା ସମୁଦ୍ରକୁ ଯାଆନ୍ତୁ ନାହିଁ।',
      summary: (o, w) =>
        `ରୁକ୍ଷ ସମୁଦ୍ର ଅବସ୍ଥା (ଡଗ୍ଲାସ୍ ସ୍କେଲ୍ ${o.seaStateIndex})। ${o.waveHeightMeters.toFixed(
          1
        )} ମିଟର ଢେଉ ଓ ${w.windGustKts.toFixed(
          0
        )} ନଟ୍ ପବନ ଗୁରୁତର ବିପଦ ସୃଷ୍ଟି କରୁଛି।`,
      advisories: [
        'ଗଭୀର ସମୁଦ୍ର କିମ୍ବା ଖୋଲା ଉପକୂଳକୁ ଯାଆନ୍ତୁ ନାହିଁ।',
        'ସମୁଦ୍ରରେ ଥିବା ନୌକା ନିକଟତମ ବନ୍ଦରକୁ ଫେରନ୍ତୁ।',
        'ବନ୍ଧା ନୌକା ଓ ମୁରିଂ ଦଉଡ଼ି ସୁରକ୍ଷିତ କରନ୍ତୁ।',
      ],
      restricted: [
        'ସମସ୍ତ ମୋଟର ନଥିବା ନୌକା',
        'ଛୋଟ FRP ନୌକା',
        'ଜଳକ୍ରୀଡ଼ା ନୌକା',
      ],
      safe: [
        'ସତର୍କତା ସହ ବଡ଼ ଟ୍ରଲର୍',
        'କୋଷ୍ଟ ଗାର୍ଡ ଓ ନୌସେନା ଜାହାଜ',
      ],
    },

    EXTREME: {
      primary:
        'ଅତ୍ୟଧିକ ବିପଦ। ସମସ୍ତ ସାମୁଦ୍ରିକ ଓ ମାଛଧରା କାର୍ଯ୍ୟ ବନ୍ଦ କରନ୍ତୁ।',
      summary: (o, w) =>
        `ଅତ୍ୟନ୍ତ ଖରାପ ସମୁଦ୍ର ଅବସ୍ଥା (ଡଗ୍ଲାସ୍ ସ୍କେଲ୍ ${o.seaStateIndex})। ${o.waveHeightMeters.toFixed(
          1
        )} ମିଟର ଢେଉ ଓ ${w.windGustKts.toFixed(
          0
        )} ନଟ୍ ପବନ ଜୀବନ ପାଇଁ ବିପଦପୂର୍ଣ୍ଣ।`,
      advisories: [
        'କୌଣସି ମାଛଧରା ନୌକାକୁ ଛାଡ଼ନ୍ତୁ ନାହିଁ।',
        'ନିମ୍ନ ସମୁଦ୍ରତଟ ଅବତରଣ ସ୍ଥାନରୁ ସରିଯାଆନ୍ତୁ।',
        'ବିପର୍ଯ୍ୟୟ ନିର୍ଦ୍ଦେଶ ପାଇଁ ରେଡିଓ ଶୁଣନ୍ତୁ।',
      ],
      restricted: [
        'ସମସ୍ତ ମାଛଧରା ନୌକା',
        'ଛୋଟ ନୌକା',
        'ଛୋଟ ଓ ମଧ୍ୟମ ଟ୍ରଲର୍',
        'ଟଗ୍ ଓ ବାର୍ଜ୍',
      ],
      safe: ['କେବଳ ଜରୁରୀ ଉଦ୍ଧାର ନୌକା'],
    },
  },

  // ---------------------------------------------------------------------------
  // TELUGU
  // ---------------------------------------------------------------------------
  te: {
    LOW: {
      primary: 'అనుకూల పరిస్థితులు. సాధారణ చేపల వేటకు సురక్షితం.',
      summary: (o, w) =>
        `సాధారణ సముద్ర స్థితి (డగ్లస్ స్కేల్ ${o.seaStateIndex}). అల ${o.waveHeightMeters.toFixed(
          1
        )} మీటర్లు, గాలి ${w.windSpeedKts.toFixed(0)} నాట్లు.`,
      advisories: [
        'లైఫ్ జాకెట్లు ఉంచి VHF మెరైన్ ఛానల్ 16 తనిఖీ చేయండి.',
        'నౌకాశ్రయం దగ్గర ఆటుపోట్ల సమయాన్ని గమనించండి.',
      ],
      restricted: [],
      safe: [
        'సాంప్రదాయ చిన్న పడవలు',
        'మోటారు FRP పడవలు',
        'మెకనైజ్డ్ ట్రాలర్లు',
        'వాణిజ్య నౌకలు',
      ],
    },

    MODERATE: {
      primary:
        'అదనపు జాగ్రత్తతో వెళ్లండి. విరిగే అలల దగ్గర చిన్న పడవలు అప్రమత్తంగా ఉండాలి.',
      summary: (o, w) =>
        `మధ్యస్థ సముద్ర స్థితి (డగ్లస్ స్కేల్ ${o.seaStateIndex}). అల ${o.waveHeightMeters.toFixed(
          1
        )} మీటర్లు, ఈదురుగాలులు ${w.windGustKts.toFixed(0)} నాట్ల వరకు.`,
      advisories: [
        'చిన్న పడవలను తీరానికి దగ్గరగా ఉంచండి.',
        'బయలుదేరే ముందు యాంకర్, బిల్జ్ మరియు ఇంధనం తనిఖీ చేయండి.',
        'అధికారిక సమాచారం కోసం VHF ఛానల్ 16 వినండి.',
      ],
      restricted: ['చిన్న అస్థిర పడవలు మరియు తెప్పలు'],
      safe: [
        'అనుభవజ్ఞులైన FRP సిబ్బంది',
        'డీప్-సీ ట్రాలర్లు',
        'కోస్ట్ గార్డ్ పెట్రోల్ పడవలు',
      ],
    },

    HIGH: {
      primary:
        'అధిక ప్రమాదం. చిన్న పడవలు మరియు మత్స్యకారులు బహిరంగ సముద్రంలోకి వెళ్లకూడదు.',
      summary: (o, w) =>
        `అల్లకల్లోల సముద్ర స్థితి (డగ్లస్ స్కేల్ ${o.seaStateIndex}). ${o.waveHeightMeters.toFixed(
          1
        )} మీటర్ల అలలు మరియు ${w.windGustKts.toFixed(
          0
        )} నాట్ల గాలులు తీవ్రమైన ప్రమాదం కలిగిస్తున్నాయి.`,
      advisories: [
        'డీప్ సీ లేదా బహిరంగ తీర జలాల్లోకి వెళ్లవద్దు.',
        'సముద్రంలోని పడవలు సమీప నౌకాశ్రయానికి తిరిగి రావాలి.',
        'కట్టిన పడవలు మరియు మూరింగ్ తాళ్లను భద్రపరచండి.',
      ],
      restricted: [
        'అన్ని మోటారు లేని పడవలు',
        'చిన్న FRP పడవలు',
        'వాటర్ స్పోర్ట్స్ పడవలు',
      ],
      safe: [
        'జాగ్రత్తతో పెద్ద ట్రాలర్లు',
        'కోస్ట్ గార్డ్ మరియు నేవీ నౌకలు',
      ],
    },

    EXTREME: {
      primary:
        'తీవ్ర ప్రమాదం. అన్ని సముద్ర మరియు చేపల వేట కార్యకలాపాలను నిలిపివేయండి.',
      summary: (o, w) =>
        `చాలా చెడ్డ సముద్ర స్థితి (డగ్లస్ స్కేల్ ${o.seaStateIndex}). ${o.waveHeightMeters.toFixed(
          1
        )} మీటర్ల అలలు మరియు ${w.windGustKts.toFixed(
          0
        )} నాట్ల గాలులు ప్రాణాలకు ముప్పు.`,
      advisories: [
        'ఏ చేపల వేట పడవను బయలుదేరనివ్వవద్దు.',
        'తక్కువ ఎత్తు తీర ప్రాంతాల నుంచి వెళ్లిపోండి.',
        'విపత్తు సూచనల కోసం రేడియో వినండి.',
      ],
      restricted: [
        'అన్ని చేపల వేట పడవలు',
        'చిన్న పడవలు',
        'చిన్న మరియు మధ్యస్థ ట్రాలర్లు',
        'టగ్‌లు మరియు బార్జ్‌లు',
      ],
      safe: ['అత్యవసర రక్షణ నౌకలు మాత్రమే'],
    },
  },

  // ---------------------------------------------------------------------------
  // MALAYALAM
  // ---------------------------------------------------------------------------
  ml: {
    LOW: {
      primary:
        'അനുകൂലമായ സാഹചര്യങ്ങൾ. സാധാരണ മത്സ്യബന്ധന പ്രവർത്തനങ്ങൾക്ക് സുരക്ഷിതമാണ്.',
      summary: (o, w) =>
        `സാധാരണ സമുദ്ര നില (ഡഗ്ലസ് സ്കെയിൽ ${o.seaStateIndex}). തിരമാല ഉയരം ${o.waveHeightMeters.toFixed(
          1
        )}m, കാറ്റ് ${w.windSpeedKts.toFixed(0)} kts.`,
      advisories: [
        'ലൈഫ് ജാക്കറ്റുകൾ കരുതുക, VHF ചാനൽ 16 പരിശോധിക്കുക.',
        'തീരദേശ വേലിയേറ്റ സമയങ്ങൾ ശ്രദ്ധിക്കുക.',
      ],
      restricted: [],
      safe: [
        'പരമ്പരാഗത വള്ളങ്ങൾ',
        'മോട്ടോർ ഘടിപ്പിച്ച യന്ത്രബോട്ടുകൾ',
        'വലിയ ട്രോളറുകൾ',
      ],
    },

    MODERATE: {
      primary:
        'ഉയർന്ന ജാഗ്രതയോടെ മുൻപോട്ട് പോകുക. ചെറിയ ബോട്ടുകൾ ശ്രദ്ധിക്കുക.',
      summary: (o, w) =>
        `മിതമായ സമുദ്ര നില (ഡഗ്ലസ് സ്കെയിൽ ${o.seaStateIndex}). തിരമാല ഉയരം ${o.waveHeightMeters.toFixed(
          1
        )}m, കാറ്റടിച്ചിൽ ${w.windGustKts.toFixed(0)} kts വരെ.`,
      advisories: [
        'ചെറിയ ബോട്ടുകൾ തീരത്തോട് ചേർന്ന് നിർത്തുവാൻ ശ്രദ്ധിക്കുക.',
        'പുറപ്പെടുന്നതിന് മുൻപ് ഇന്ധനവും ഉപകരണങ്ങളും പരിശോധിക്കുക.',
        'VHF ചാനൽ 16 സന്ദേശങ്ങൾ ശ്രദ്ധിക്കുക.',
      ],
      restricted: ['ചെറിയ യന്ത്രമില്ലാത്ത വള്ളങ്ങൾ'],
      safe: [
        'പരിചയസമ്പന്നരായ മോട്ടോർ ബോട്ട് ജീവനക്കാർ',
        'തീരസംരക്ഷണ സേനാ ബോട്ടുകൾ',
      ],
    },

    HIGH: {
      primary:
        'ഉയർന്ന അപകടസാധ്യത. ചെറിയ ബോട്ടുകളും മത്സ്യബന്ധന യാനങ്ങളും കടലിൽ പോകരുത്.',
      summary: (o, w) =>
        `മോശം സമുദ്ര നില (ഡഗ്ലസ് സ്കെയിൽ ${o.seaStateIndex}). ${o.waveHeightMeters.toFixed(
          1
        )}m തിരമാലകളും ${w.windGustKts.toFixed(
          0
        )} kts ശക്തമായ കാറ്റും അപകടകരമാണ്.`,
      advisories: [
        'ആഴക്കടലിലേക്ക് പോകരുത്.',
        'കടലിലുള്ള യാനങ്ങൾ അടുത്തുള്ള തുറമുഖത്തേക്ക് മടങ്ങുക.',
        'ബോട്ടുകൾ സുരക്ഷിതമായി കെട്ടിയിടുക.',
      ],
      restricted: [
        'എല്ലാ ചെറിയ വള്ളങ്ങളും',
        'വാട്ടർ സ്പോർട്സ് യാനങ്ങൾ',
      ],
      safe: [
        'വലിയ ആൾ-വെതർ ട്രോളറുകൾ',
        'തീരസംരക്ഷണ സേനാ യാനങ്ങൾ',
      ],
    },

    EXTREME: {
      primary:
        'അതീവ അപകടം. എല്ലാ സമുദ്ര-മത്സ്യബന്ധന പ്രവർത്തനങ്ങളും നിർത്തിവയ്ക്കുക.',
      summary: (o, w) =>
        `അതീവ രൂക്ഷമായ സമുദ്ര നില (ഡഗ്ലസ് സ്കെയിൽ ${o.seaStateIndex}). ${o.waveHeightMeters.toFixed(
          1
        )}m തിരമാലകളും ${w.windGustKts.toFixed(
          0
        )} kts കാറ്റും ജീവന് ഭീഷണിയാണ്.`,
      advisories: [
        'മത്സ്യബന്ധന ബോട്ടുകൾ കടലിൽ ഇറക്കരുത്.',
        'തീരദേശ താഴ്ന്ന പ്രദേശങ്ങളിൽ നിന്ന് മാറിനിൽക്കുക.',
        'റേഡിയോ അറിയിപ്പുകൾ ശ്രദ്ധിക്കുക.',
      ],
      restricted: [
        'എല്ലാ മത്സ്യബന്ധന യാനങ്ങളും ബോട്ടുകളും',
      ],
      safe: ['അടിയന്തര രക്ഷാപ്രവർത്തന ബോട്ടുകൾ മാത്രം'],
    },
  },

  // ---------------------------------------------------------------------------
  // GUJARATI
  // ---------------------------------------------------------------------------
  gu: {
    LOW: {
      primary:
        'અનુકૂળ પરિસ્થિતિઓ. દૈનિક માછીમારી પ્રવૃત્તિઓ માટે સુરક્ષિત.',
      summary: (o, w) =>
        `સામાન્ય સમુદ્ર સ્થિતિ (ડગ્લસ સ્કેલ ${o.seaStateIndex}). મોજાની ઊંચાઈ ${o.waveHeightMeters.toFixed(
          1
        )}m અને પવન ${w.windSpeedKts.toFixed(0)} kts.`,
      advisories: [
        'લાઇફ જેકેટ રાખો અને VHF ચેનલ 16 ચકાસો.',
        'બંદર પાસે ભરતી-ઓટના સમયનું ધ્યાન રાખો.',
      ],
      restricted: [],
      safe: [
        'પરંપરાગત નાની હોડીઓ',
        'મોટર સંચાલિત FRP હોડીઓ',
        'યાંત્રિક ટ્રોલોર્સ',
      ],
    },

    MODERATE: {
      primary:
        'વધુ સાવચેતી સાથે આગળ વધો. નાની હોડીઓએ સાવધ રહેવું.',
      summary: (o, w) =>
        `મધ્યમ સમુદ્ર સ્થિતિ (ડગ્લસ સ્કેલ ${o.seaStateIndex}). મોજા ${o.waveHeightMeters.toFixed(
          1
        )}m અને ઝડપી પવન ${w.windGustKts.toFixed(0)} kts સુધી.`,
      advisories: [
        'નાની હોડીઓ કાંઠાની નજીક રાખો.',
        'રવાના થતાં પહેલાં એન્કર અને બળતણ ચકાસો.',
        'સત્તાવાર અપડેટ્સ માટે VHF ચેનલ 16 સાંભળો.',
      ],
      restricted: ['નાની અસ્થિર હોડીઓ'],
      safe: [
        'અનુભવી FRP ટીમો',
        'કોસ્ટ ગાર્ડ પેટ્રોલ બોટ્સ',
      ],
    },

    HIGH: {
      primary:
        'ઉચ્ચ જોખમ. નાની હોડીઓ અને માછીમારોએ ખુલ્લા દરિયામાં ન જવું.',
      summary: (o, w) =>
        `ખરાબ સમુદ્ર સ્થિતિ (ડગ્લસ સ્કેલ ${o.seaStateIndex}). ${o.waveHeightMeters.toFixed(
          1
        )}m મોજા અને ${w.windGustKts.toFixed(
          0
        )} kts ઝડપી પવન ગંભીર જોખમ ઊભું કરે છે.`,
      advisories: [
        'ઊંડા દરિયામાં કે ખુલ્લા કાંઠે ન જવું.',
        'દરિયામાં રહેલી હોડીઓ નજીકના બંદરે પાછી ફરે.',
        'બાંધેલી હોડીઓ સુરક્ષિત કરો.',
      ],
      restricted: [
        'તમામ ગેર-મોટરવાળી હોડીઓ',
        'વોટર સ્પોર્ટ્સ બોટ્સ',
      ],
      safe: [
        'મોટા ટ્રોલોર્સ સાવચેતી સાથે',
        'કોસ્ટ ગાર્ડ અને નૌકાદળના જહાજો',
      ],
    },

    EXTREME: {
      primary:
        'અત્યંત જોખમ. તમામ દરિયાઈ અને માછીમારી પ્રવૃત્તિઓ સ્થગિત કરો.',
      summary: (o, w) =>
        `અત્યંત ગંભીર સમુદ્ર સ્થિતિ (ડગ્લસ સ્કેલ ${o.seaStateIndex}). ${o.waveHeightMeters.toFixed(
          1
        )}m મોજા અને ${w.windGustKts.toFixed(
          0
        )} kts પવન જીવ માટે જોખમી છે.`,
      advisories: [
        'કોઈપણ માછીમારી બોટને દરિયામાં ન મોકલો.',
        'દરિયાકિનારાના નીચાણવાળા વિસ્તારો ખાલી કરો.',
        'સતત રેડિયો સંદેશાઓ સાંભળો.',
      ],
      restricted: [
        'તમામ માછીમારી બોટ અને હોડીઓ',
      ],
      safe: ['માત્ર ઇમરજન્સી રેસ્ક્યૂ બોટ્સ'],
    },
  },

  // ---------------------------------------------------------------------------
  // MARATHI
  // ---------------------------------------------------------------------------
  mr: {
    LOW: {
      primary:
        'अनुकूल परिस्थिती. दैनंदिन मासेमारीसाठी सुरक्षित.',
      summary: (o, w) =>
        `सामान्य समुद्र स्थिती (डग्लस स्केल ${o.seaStateIndex}). लाटेची उंची ${o.waveHeightMeters.toFixed(
          1
        )}m आणि वारा ${w.windSpeedKts.toFixed(0)} kts.`,
      advisories: [
        'लाइफ जॅकेट सोबत ठेवा आणि VHF चॅनेल 16 तपासा.',
        'बंदरानजीक भरती-ओहोटीच्या वेळा पाळा.',
      ],
      restricted: [],
      safe: [
        'पारंपरिक लहान बोटी',
        'मोटारचलित FRP बोटी',
        'यांत्रिक ट्रॉलर',
      ],
    },

    MODERATE: {
      primary:
        'अधिक खबरदारी बाळगून पुढे जा. लहान बोटींनी सतर्क राहावे.',
      summary: (o, w) =>
        `मध्यम समुद्र स्थिती (डग्लस स्केल ${o.seaStateIndex}). लाटा ${o.waveHeightMeters.toFixed(
          1
        )}m आणि वाऱ्याचे झोत ${w.windGustKts.toFixed(0)} kts पर्यंत.`,
      advisories: [
        'लहान बोटी किनाऱ्याजवळ ठेवा.',
        'निघण्यापूर्वी नांगर आणि इंधन तपासा.',
        'अधिकृत माहितीसाठी VHF चॅनेल 16 ऐका.',
      ],
      restricted: ['लहान अस्थिर बोटी'],
      safe: [
        'अनुभवी FRP पथके',
        'कोस्ट गार्ड गस्ती नौका',
      ],
    },

    HIGH: {
      primary:
        'उच्च धोका. लहान बोटी आणि कोळ्यांनी उघड्या समुद्रात जाऊ नये.',
      summary: (o, w) =>
        `खराब समुद्र स्थिती (डग्लस स्केल ${o.seaStateIndex}). ${o.waveHeightMeters.toFixed(
          1
        )}m लाटा आणि ${w.windGustKts.toFixed(
          0
        )} kts वाऱ्याचे झोत गंभीर धोका निर्माण करतात.`,
      advisories: [
        'खोल समुद्रात जाऊ नका.',
        'समुद्रातील बोटींनी जवळच्या बंदरात परतावे.',
        'किनाऱ्यावर बांधलेल्या बोटी सुरक्षित करा.',
      ],
      restricted: [
        'सर्व बिन-मोटार बोटी',
        'वॉटर स्पोर्ट्स बोटी',
      ],
      safe: [
        'मोठे ट्रॉलर काळजीपूर्वक',
        'कोस्ट गार्ड आणि नौदलाच्या नौका',
      ],
    },

    EXTREME: {
      primary:
        'अत्यंत गंभीर धोका. सर्व सागरी व मासेमारी उपक्रम थांबवा.',
      summary: (o, w) =>
        `अत्यंत भीषण समुद्र स्थिती (डग्लस स्केल ${o.seaStateIndex}). ${o.waveHeightMeters.toFixed(
          1
        )}m लाटा आणि ${w.windGustKts.toFixed(
          0
        )} kts वारा प्राणास धोका निर्माण करतो.`,
      advisories: [
        'मासेमारी बोटी समुद्रात सोडू नका.',
        'किनाऱ्यावरील सखल भागातून निघून जा.',
        'आपत्ती व्यवस्थापन सूचनांसाठी रेडिओ ऐका.',
      ],
      restricted: [
        'सर्व मासेमारी बोटी आणि ट्रॉलर',
      ],
      safe: ['फक्त तातडीच्या बचाव नौका'],
    },
  },

  // ---------------------------------------------------------------------------
  // KANNADA
  // ---------------------------------------------------------------------------
  kn: {
    LOW: {
      primary:
        'ಅನುಕೂಲಕರ ಪರಿಸ್ಥಿತಿಗಳು. ಸಾಮಾನ್ಯ ಮೀನುಗಾರಿಕೆ ಕಾರ್ಯಾಚರಣೆಗಳಿಗೆ ಸುರಕ್ಷಿತ.',
      summary: (o, w) =>
        `ಸಾಮಾನ್ಯ ಸಮುದ್ರ ಸ್ಥಿತಿ (ಡಗ್ಲಸ್ ಸ್ಕೇಲ್ ${o.seaStateIndex}). ಅಲೆಯ ಎತ್ತರ ${o.waveHeightMeters.toFixed(
          1
        )}m ಮತ್ತು ಗಾಳಿ ${w.windSpeedKts.toFixed(0)} kts.`,
      advisories: [
        'ಲೈಫ್ ಜಾಕೆಟ್‌ಗಳನ್ನು ಇರಿಸಿಕೊಳ್ಳಿ ಮತ್ತು VHF ಚಾನೆಲ್ 16 ಪರೀಕ್ಷಿಸಿ.',
        'ದೋಣಿ ನಿಲ್ದಾಣದ ಬಳಿ ಉಬ್ಬರವಿಳಿತದ ಸಮಯಗಳನ್ನು ಗಮನಿಸಿ.',
      ],
      restricted: [],
      safe: [
        'ಪಾರಂಪರಿಕ ಸಣ್ಣ ದೋಣಿಗಳು',
        'ಮೋಟಾರೀಕೃತ FRP ದೋಣಿಗಳು',
        'ಯಾಂತ್ರಿಕೃತ ಟ್ರಾಲರ್‌ಗಳು',
      ],
    },

    MODERATE: {
      primary:
        'ಹೆಚ್ಚಿನ ಎಚ್ಚರಿಕೆಯೊಂದಿಗೆ ಮುಂದುವರಿಯಿರಿ. ಸಣ್ಣ ದೋಣಿಗಳು ಜಾಗರೂಕರಾಗಿರಬೇಕು.',
      summary: (o, w) =>
        `ಮಧ್ಯಮ ಸಮುದ್ರ ಸ್ಥಿತಿ (ಡಗ್ಲಸ್ ಸ್ಕೇಲ್ ${o.seaStateIndex}). ಅಲೆಗಳು ${o.waveHeightMeters.toFixed(
          1
        )}m ಮತ್ತು ರಭಸದ ಗಾಳಿ ${w.windGustKts.toFixed(0)} kts ವರೆಗೆ.`,
      advisories: [
        'ಸಣ್ಣ ದೋಣಿಗಳನ್ನು ದಂಡೆಯ ಬಳಿ ಇರಿಸಿ.',
        'ಹೊರಡುವ ಮುನ್ನ ಇಂಧನ ಮತ್ತು ಲಂಗರು ಪರೀಕ್ಷಿಸಿ.',
        'ಅಧಿಕೃತ ಮಾಹಿತಿಗಾಗಿ VHF ಚಾನೆಲ್ 16 ಆಲಿಸಿ.',
      ],
      restricted: ['ಸಣ್ಣ ಅಸ್ಥಿರ ದೋಣಿಗಳು'],
      safe: [
        'ಅನುಭವಿ FRP ಸಿಬ್ಬಂದಿ',
        'ಕೋಸ್ಟ್ ಗಾರ್ಡ್ ಗಸ್ತು ದೋಣಿಗಳು',
      ],
    },

    HIGH: {
      primary:
        'ಹೆಚ್ಚಿನ ಅಪಾಯ. ಸಣ್ಣ ದೋಣಿಗಳು ಮತ್ತು ಮೀನುಗಾರರು ತೆರೆದ ಸಮುದ್ರಕ್ಕೆ ಹೋಗಬಾರದು.',
      summary: (o, w) =>
        `ಖರಾಬು ಸಮುದ್ರ ಸ್ಥಿತಿ (ಡಗ್ಲಸ್ ಸ್ಕೇಲ್ ${o.seaStateIndex}). ${o.waveHeightMeters.toFixed(
          1
        )}m ಅಲೆಗಳು ಮತ್ತು ${w.windGustKts.toFixed(
          0
        )} kts ಬಿರುಗಾಳಿ ತೀವ್ರ ಅಪಾಯವನ್ನುಂಟುಮಾಡುತ್ತವೆ.`,
      advisories: [
        'ಆಳ ಸಮುದ್ರಕ್ಕೆ ಹೋಗಬೇಡಿ.',
        'ಸಮುದ್ರದಲ್ಲಿರುವ ದೋಣಿಗಳು ಹತ್ತಿರದ ಬಂದರಿಗೆ ಹಿಂತಿರುಗಬೇಕು.',
        'ಕಟ್ಟಿದ ದೋಣಿಗಳನ್ನು ಭದ್ರಪಡಿಸಿ.',
      ],
      restricted: [
        'ಎಲ್ಲಾ ಮೋಟಾರ್ ಇಲ್ಲದ ದೋಣಿಗಳು',
        'ವಾಟರ್ ಸ್ಪೋರ್ಟ್ಸ್ ದೋಣಿಗಳು',
      ],
      safe: [
        'ಎಚ್ಚರಿಕೆಯೊಂದಿಗೆ ದೊಡ್ಡ ಟ್ರಾಲರ್‌ಗಳು',
        'ಕೋಸ್ಟ್ ಗಾರ್ಡ್ ಮತ್ತು ನೌಕಾಪಡೆಯ ನೌಕೆಗಳು',
      ],
    },

    EXTREME: {
      primary:
        'ಅತೀವ ಅಪಾಯ. ಎಲ್ಲಾ ಸಮುದ್ರ ಮತ್ತು ಮೀನುಗಾರಿಕೆ ಚಟುವಟಿಕೆಗಳನ್ನು ಅಮಾನತುಗೊಳಿಸಿ.',
      summary: (o, w) =>
        `ಅತ್ಯಂತ ಕೆಟ್ಟ ಸಮುದ್ರ ಸ್ಥಿತಿ (ಡಗ್ಲಸ್ ಸ್ಕೇಲ್ ${o.seaStateIndex}). ${o.waveHeightMeters.toFixed(
          1
        )}m ಅಲೆಗಳು ಮತ್ತು ${w.windGustKts.toFixed(
          0
        )} kts ಗಾಳಿ ಜೀವಕ್ಕೆ ಅಪಾಯಕಾರಿ.`,
      advisories: [
        'ಯಾವುದೇ ಮೀನುಗಾರಿಕಾ ದೋಣಿ ಹೊರಡಲು ಅನುಮತಿಯಿಲ್ಲ.',
        'ಕರಾವಳಿಯ ತಗ್ಗು ಪ್ರದೇಶಗಳಿಂದ ಹೊರಟುಹೋಗಿ.',
        'ತುರ್ತು ಸೂಚನೆಗಳಿಗಾಗಿ ರೇಡಿಯೋ ಆಲಿಸಿ.',
      ],
      restricted: ['ಎಲ್ಲಾ ಮೀನುಗಾರಿಕಾ ದೋಣಿಗಳು'],
      safe: ['ತುರ್ತು ರಕ್ಷಣಾ ನೌಕೆಗಳು ಮಾತ್ರ'],
    },
  },
};

// -----------------------------------------------------------------------------
// LOCALIZE RISK PREDICTION
// -----------------------------------------------------------------------------

export function localizeRiskPrediction(
  risk: RiskPrediction,
  weather: WeatherData,
  ocean: OceanData,
  language: LanguageCode
): RiskPrediction {
  const languageCopy = copy[language] ?? copy.en!;

  const selected =
    languageCopy[risk.riskLevel] ?? copy.en![risk.riskLevel];

  return {
    ...risk,

    primaryRecommendation: selected.primary,

    safetySummary: selected.summary(ocean, weather),

    actionableAdvisories: [...selected.advisories],

    restrictedCraftTypes: [...selected.restricted],

    safeCraftTypes: [...selected.safe],

    featureContributions: risk.featureContributions.map((feature) => ({
      ...feature,
      description: localizeFeatureDescription(
        feature.description,
        feature.featureName,
        language
      ),
    })),
  };
}

// -----------------------------------------------------------------------------
// LOCALIZE FEATURE DESCRIPTION
// -----------------------------------------------------------------------------

function localizeFeatureDescription(
  description: string,
  featureName: string,
  language: LanguageCode
): string {
  if (language === 'en') {
    return description;
  }

  const translated: Record<string, string> = {
    bn: 'এই পরিবেশগত উপাদানটি সামুদ্রিক ঝুঁকির সম্ভাবনাকে প্রভাবিত করছে।',

    hi: 'यह पर्यावरणीय कारक समुद्री जोखिम की संभावना को प्रभावित कर रहा है।',

    ta: 'இந்த சுற்றுச்சூழல் காரணி கடல் இடர் சாத்தியத்தை பாதிக்கிறது.',

    or: 'ଏହି ପରିବେଶୀୟ ଉପାଦାନ ସାମୁଦ୍ରିକ ବିପଦର ସମ୍ଭାବନାକୁ ପ୍ରଭାବିତ କରୁଛି।',

    te: 'ఈ పర్యావరణ అంశం సముద్ర ప్రమాద సంభావ్యతను ప్రభావితం చేస్తోంది.',

    ml: 'ഈ പരിസ്ഥിതി ഘടകം സമുദ്ര അപകടസാധ്യതയെ സ്വാധീനിക്കുന്നു.',

    gu: 'આ પર્યાવરણીય પરિબળ દરિયાઈ જોખમની શક્યતાને અસર કરી રહ્યું છે.',

    mr: 'हा पर्यावरणीय घटक सागरी धोक्याच्या शक्यतेला प्रभावित करत आहे.',

    kn: 'ಈ ಪರಿಸರ ಅಂಶವು ಸಮುದ್ರ ಅಪಾಯದ ಸಾಧ್ಯತೆಯ ಮೇಲೆ ಪರಿಣಾಮ ಬೀರುತ್ತಿದೆ.',
  };

  const prefix =
    translated[String(language)] ??
    'This environmental factor is affecting the likelihood of marine risk.';

  return `${prefix} (${localizeFeatureName(featureName, language)})`;
}

// -----------------------------------------------------------------------------
// LOCALIZED GROUNDED SUMMARY LABELS
// -----------------------------------------------------------------------------

const labels: Partial<Record<LanguageCode, GroundedLabels>> = {
  en: {
    live: 'LIVE DATA',
    wave: 'Significant Wave Height',
    wind: 'Wind',
    swell: 'Swell Period',
    current: 'Current',
    sea: 'Sea State',
    retrieved: 'Retrieved',
    advisories: 'Safety Advisories',
    evidence: 'Evidence',
  },

  bn: {
    live: 'লাইভ তথ্য',
    wave: 'উল্লেখযোগ্য ঢেউয়ের উচ্চতা',
    wind: 'বাতাস',
    swell: 'সোয়েল পর্যায়',
    current: 'স্রোত',
    sea: 'সমুদ্র অবস্থা',
    retrieved: 'সংগ্রহের সময়',
    advisories: 'নিরাপত্তা নির্দেশিকা',
    evidence: 'প্রমাণ',
  },

  hi: {
    live: 'लाइव डेटा',
    wave: 'महत्वपूर्ण लहर ऊंचाई',
    wind: 'हवा',
    swell: 'स्वेल अवधि',
    current: 'धारा',
    sea: 'समुद्री स्थिति',
    retrieved: 'प्राप्त समय',
    advisories: 'सुरक्षा सलाह',
    evidence: 'साक्ष्य',
  },

  ta: {
    live: 'நேரடி தரவு',
    wave: 'குறிப்பிடத்தக்க அலை உயரம்',
    wind: 'காற்று',
    swell: 'ஸ்வெல் காலம்',
    current: 'நீரோட்டம்',
    sea: 'கடல் நிலை',
    retrieved: 'பெற்ற நேரம்',
    advisories: 'பாதுகாப்பு ஆலோசனைகள்',
    evidence: 'ஆதாரங்கள்',
  },

  or: {
    live: 'ଲାଇଭ୍ ତଥ୍ୟ',
    wave: 'ଗୁରୁତ୍ୱପୂର୍ଣ୍ଣ ଢେଉ ଉଚ୍ଚତା',
    wind: 'ପବନ',
    swell: 'ସ୍ୱେଲ୍ ଅବଧି',
    current: 'ସ୍ରୋତ',
    sea: 'ସମୁଦ୍ର ଅବସ୍ଥା',
    retrieved: 'ସଂଗ୍ରହ ସମୟ',
    advisories: 'ସୁରକ୍ଷା ପରାମର୍ଶ',
    evidence: 'ପ୍ରମାଣ',
  },

  te: {
    live: 'లైవ్ డేటా',
    wave: 'ముఖ్యమైన అల ఎత్తు',
    wind: 'గాలి',
    swell: 'స్వెల్ కాలం',
    current: 'ప్రవాహం',
    sea: 'సముద్ర స్థితి',
    retrieved: 'సేకరించిన సమయం',
    advisories: 'భద్రతా సూచనలు',
    evidence: 'ఆధారాలు',
  },

  ml: {
    live: 'ലൈവ് വിവരങ്ങൾ',
    wave: 'തിരമാലയുടെ ഉയരം',
    wind: 'കാറ്റ്',
    swell: 'സ്വെൽ കാലയളവ്',
    current: 'നീരൊഴുക്ക്',
    sea: 'സമുദ്ര നില',
    retrieved: 'ശേഖരിച്ച സമയം',
    advisories: 'സുരക്ഷാ നിർദ്ദേശങ്ങൾ',
    evidence: 'തെളിവുകൾ',
  },

  gu: {
    live: 'લાઈવ ડેટા',
    wave: 'મોજાની ઊંચાઈ',
    wind: 'પવન',
    swell: 'સ્વેલ સમયગાળો',
    current: 'પ્રવાહ',
    sea: 'સમુદ્ર સ્થિતિ',
    retrieved: 'પ્રાપ્ત સમય',
    advisories: 'સુરક્ષા સલાહ',
    evidence: 'પુરાવા',
  },

  mr: {
    live: 'थेट डेटा',
    wave: 'लाटेची उंची',
    wind: 'वारा',
    swell: 'स्वेल कालावधी',
    current: 'प्रवाह',
    sea: 'समुद्र स्थिती',
    retrieved: 'प्राप्त वेळ',
    advisories: 'सुरक्षा सूचना',
    evidence: 'पुरावे',
  },

  kn: {
    live: 'ಲೈವ್ ಮಾಹಿತಿ',
    wave: 'ಅಲೆಯ ಎತ್ತರ',
    wind: 'ಗಾಳಿ',
    swell: 'ಸ್ವೆಲ್ ಅವಧಿ',
    current: 'ಪ್ರವಾಹ',
    sea: 'ಸಮುದ್ರ ಸ್ಥಿತಿ',
    retrieved: 'ಪಡೆದ ಸಮಯ',
    advisories: 'ಸುರಕ್ಷತಾ ಸಲಹೆಗಳು',
    evidence: 'ಆಧಾರಗಳು',
  },
};

// -----------------------------------------------------------------------------
// BUILD LOCALIZED GROUNDED SUMMARY
// -----------------------------------------------------------------------------

export function buildLocalizedGroundedSummary(
  risk: RiskPrediction,
  weather: WeatherData,
  ocean: OceanData,
  language: LanguageCode,
  provider: string,
  retrievedAt: string
): string {
  const label = labels[language] ?? labels.en!;

  const advisoryText =
    risk.actionableAdvisories.length > 0
      ? risk.actionableAdvisories
        .map((advisory, index) => `${index + 1}. ${advisory}`)
        .join('\n')
      : 'None';

  return [
    risk.primaryRecommendation,
    '',
    risk.safetySummary,
    '',
    `${label.live} (${weather.source} / ${ocean.source}):`,
    `• ${label.wave}: ${ocean.waveHeightMeters}m`,
    `• ${label.wind}: ${weather.windSpeedKts} kts (gusts ${weather.windGustKts} kts)`,
    `• ${label.swell}: ${ocean.swellPeriodSec}s`,
    `• ${label.current}: ${ocean.currentSpeedKts} kts`,
    `• ${label.sea}: ${ocean.seaStateIndex} (${ocean.seaStateDescription})`,
    `• ${label.retrieved}: ${retrievedAt}`,
    '',
    `${label.advisories}:`,
    advisoryText,
    '',
    `${label.evidence} (${provider}):`,
    risk.riskLevel,
  ].join('\n');
}

export function getLocalizedPrimaryRecommendation(
  riskLevel: import('../types').RiskLevel,
  language: LanguageCode
): string {
  const languageCopy = copy[language] ?? copy.en!;
  const selected = languageCopy[riskLevel] ?? copy.en![riskLevel];
  return selected ? selected.primary : '';
}