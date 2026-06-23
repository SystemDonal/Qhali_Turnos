/* ======================================================
   Configuración de voz Qhali Ñawi
   Español Perú + nombres andinos/quechuas
   ====================================================== */

window.TURNERO_VOICE_CONFIG = {
  lang: 'es-PE',
  preferredVoiceLangs: ['es-PE', 'es-MX', 'es-US', 'es-ES', 'quz-PE', 'quz', 'qu'],
  fallbackLangs: ['es-PE', 'es-MX', 'es-ES', 'es-US'],
  preferredGender: 'female',
  quechuaAware: true,
  maleVoiceHints: [
    'pablo', 'jorge', 'raul', 'raúl', 'alvaro', 'álvaro', 'alejandro',
    'sebastian', 'sebastián', 'emilio', 'male', 'mascul', 'hombre'
  ],
  femaleVoiceHints: [
    'dalia', 'elvira', 'helena', 'laura', 'lucia', 'lucía', 'sofia', 'sofía',
    'paulina', 'maria', 'maría', 'monica', 'mónica', 'sabina', 'salome',
    'salomé', 'paloma', 'andrea', 'zira', 'aria', 'female', 'femen', 'mujer'
  ],
  preferredVoices: [
    'Microsoft Dalia Online (Natural)',
    'Microsoft Elvira Online (Natural)',
    'Microsoft Helena Online (Natural)',
    'Microsoft Sabina Online (Natural)',
    'Microsoft Laura Online (Natural)',
    'Microsoft Maria Online (Natural)',
    'Microsoft Andrea Online (Natural)',
    'Google español de Perú',
    'Google español de México',
    'Google español de Estados Unidos',
    'Google español'
  ],
  speech: {
    rate: 0.96,
    pitch: 1,
    volume: 1
  },
  preludeText: '',
  callTemplate: 'Paciente {name} acercarse a {destination} para su atención.',
  chimeUrl: '/assets/ding.wav',
  chimeDelayMs: 55,
  duckingVolume: 0.02,
  defaultVideoVolume: 0.55,
  institutionalAnnouncement: {
    enabled: true,
    intervalMs: 20 * 60 * 1000,
    initialDelayMs: 20 * 60 * 1000,
    text: 'Bienvenido a la clínica Qhali Ñawi. Atentos al llamado.'
  },
  repeatCount: 1,
  segmentPauseMs: 55,
  sentencePauseMs: 45,
  postSpeechHoldMs: 180,
  duckingRestoreDelayMs: 160,
  pronunciationFix: {
    'QHALI ÑAWI': 'Jali Ñawi',
    'Qhali Ñawi': 'Jali Ñawi',
    'qhali ñawi': 'jali ñawi',
    'QHALI ÑAHUI': 'Jali Ñawi',
    'Qhali Ñahui': 'Jali Ñawi',
    'Ñawi': 'Ñawi',
    'ñawi': 'ñawi',
    'Qosqo': 'Cosco',
    'qosqo': 'cosco',
    'Cusco': 'Cusco',
    'cusco': 'cusco',
    'Optometria': 'Optometría',
    'optometria': 'optometría',
    'Examenes': 'Exámenes',
    'examenes': 'exámenes',
    'Imagenes': 'Imágenes',
    'imagenes': 'imágenes',
    'Cirugia': 'Cirugía',
    'cirugia': 'cirugía',
    'Cornea': 'Córnea',
    'cornea': 'córnea',
    'Meibografia': 'Meibografía',
    'meibografia': 'meibografía',
    'Agudeza visual': 'Agudeza visual',
    'IPL': 'i pe ele',
    'DNI': 'de ene i',
    'N°': 'número',
    'Nº': 'número',
    'OPTO': 'ópto',
    'CON': 'con',
    'EXA': 'exa',
    'IMG': 'imagen'
  },
  quechuaFix: {
    'Qh': 'J',
    'qh': 'j',
    'QH': 'J',
    'Cc': 'K',
    'cc': 'k',
    'CC': 'K',
    'Ph': 'P',
    'ph': 'p',
    'Th': 'T',
    'th': 't'
  }
};

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function detectWordStyle(word) {
  const clean = String(word || '');
  if (!clean) return 'plain';
  if (clean === clean.toUpperCase() && /[A-ZÁÉÍÓÚÑ]/.test(clean)) return 'upper';
  if (clean.charAt(0) === clean.charAt(0).toUpperCase()) return 'title';
  return 'lower';
}

function applyWordStyle(word, style) {
  const clean = String(word || '');
  if (!clean) return clean;
  if (style === 'upper') return clean.toUpperCase();
  if (style === 'title') return clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase();
  return clean.toLowerCase();
}

function normalizeToken(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function smartNamePronunciation(word) {
  const original = String(word || '').trim();
  if (!original) return original;

  const style = detectWordStyle(original);
  const normalized = normalizeToken(original);

  const exactMap = {
    akeemy: 'akimi',
    apaza: 'apása',
    brayan: 'bráyan',
    bryan: 'bráyan',
    ccahuana: 'kahuána',
    ccama: 'káma',
    cahuana: 'kahuána',
    callañaupa: 'cayañaupa',
    chambi: 'chambi',
    chilca: 'chílca',
    choque: 'chóque',
    choquecahua: 'choquecáhua',
    choquehuanca: 'choquehuánca',
    condori: 'condóri',
    cusihuaman: 'cusihuamán',
    huaman: 'huamán',
    huamán: 'huamán',
    huanca: 'huánca',
    huancas: 'huáncas',
    huanqui: 'huánqui',
    huayta: 'huáyta',
    huillca: 'huílca',
    huillcañaupa: 'huilcañáupa',
    jhon: 'yon',
    jonathan: 'yonatan',
    jackeline: 'yaquelín',
    jackelin: 'yaquelín',
    jacqueline: 'yaquelín',
    jakeline: 'yaquelín',
    jakelin: 'yaquelín',
    yackelin: 'yaquelín',
    kevin: 'kévin',
    luque: 'lúque',
    mamani: 'mamáni',
    ñahui: 'ñawi',
    ñawi: 'ñawi',
    pari: 'pári',
    parodi: 'paródi',
    quispe: 'quíspe',
    qhali: 'jali',
    qosqo: 'cosco',
    quilla: 'quílla',
    quillca: 'quílca',
    rocío: 'rocío',
    rocio: 'rocío',
    roger: 'róger',
    sanca: 'sánca',
    sangay: 'sangái',
    sullca: 'súlca',
    tica: 'tíca',
    tupia: 'túpia',
    uscamayta: 'uscamaíta',
    valderrama: 'valderrama',
    yucra: 'yúcra',
    yucri: 'yúcri',
    yupanqui: 'yupánqui',
    yerussza: 'yerúsa'
  };

  if (exactMap[normalized]) return applyWordStyle(exactMap[normalized], style);

  if (/^ja?c?k+e+l+i+n+e?$/.test(normalized) || /^jacq+u?e?l+i+n+e?$/.test(normalized)) {
    return applyWordStyle('yaquelín', style);
  }
  if (/^kev+i+n+$/.test(normalized)) return applyWordStyle('kévin', style);
  if (/^st?e?v+e?n+$/.test(normalized)) return applyWordStyle('estíven', style);
  if (/^br?a?y+a+n+$/.test(normalized)) return applyWordStyle('bráyan', style);
  if (/^(j|y)h?o+n+$/.test(normalized)) return applyWordStyle('yon', style);

  return original;
}

function fixQuechuaApproximation(text) {
  const cfg = window.TURNERO_VOICE_CONFIG || {};
  if (!cfg.quechuaAware) return String(text || '');

  let output = String(text || '');
  const replacements = cfg.quechuaFix || {};
  Object.keys(replacements).forEach((key) => {
    output = output.replace(new RegExp(escapeRegExp(key), 'g'), replacements[key]);
  });

  return output
    .replace(/\bhua/gi, (match) => match[0] === match[0].toUpperCase() ? 'Wa' : 'wa')
    .replace(/\bhue/gi, (match) => match[0] === match[0].toUpperCase() ? 'We' : 'we')
    .replace(/\bhui/gi, (match) => match[0] === match[0].toUpperCase() ? 'Wi' : 'wi')
    .replace(/\bqui/gi, (match) => match[0] === match[0].toUpperCase() ? 'Qui' : 'qui');
}

function addSpeechPauses(text) {
  return String(text || '')
    .replace(/\bPaciente\s+/i, 'Paciente ')
    .replace(/\s*,\s*,+/g, ', ')
    .replace(/\s+,\s+/g, ', ')
    .replace(/\s*\.\s*/g, '. ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();
}

function fixTicketCode(text) {
  return String(text || '').replace(/\b([A-Z]{2,4})-(\d{1,4})\b/g, (_all, letters, nums) => {
    const spokenLetters = letters.split('').join(' ');
    const spokenNums = String(nums).split('').join(' ');
    return `${spokenLetters}, ${spokenNums}`;
  });
}

function fixPronunciation(text) {
  let output = String(text || '');
  const cfg = window.TURNERO_VOICE_CONFIG || {};
  const fixes = cfg.pronunciationFix || {};

  Object.keys(fixes).forEach((key) => {
    const regex = new RegExp(`\\b${escapeRegExp(key)}\\b`, 'g');
    output = output.replace(regex, fixes[key]);
  });

  output = output.replace(/\b([A-Za-zÁÉÍÓÚáéíóúÑñ'´`-]{3,})\b/g, (word) => smartNamePronunciation(word));
  output = fixQuechuaApproximation(output);
  output = fixTicketCode(output);
  output = addSpeechPauses(output);

  return output
    .replace(/\bDNI\b/g, 'de ene i')
    .replace(/\bN°\b/g, 'número')
    .replace(/\bNº\b/g, 'número')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildCallText(data) {
  const cfg = window.TURNERO_VOICE_CONFIG;
  let text = cfg.callTemplate
    .replace('{name}', data.name)
    .replace('{code}', data.code)
    .replace('{area}', data.area)
    .replace('{moduleLabel}', data.moduleLabel)
    .replace('{destination}', data.destination || data.moduleLabel || data.area)
    .replace('{doctorTitle}', data.doctorTitle || data.doctorName)
    .replace('{doctorName}', data.doctorName);
  return fixPronunciation(text);
}

window.normalizeSpeechText = fixPronunciation;
window.fixPronunciation = fixPronunciation;
window.buildCallText = buildCallText;
