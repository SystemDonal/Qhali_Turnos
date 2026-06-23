const socket = window.io ? io({
  transports: ['websocket', 'polling'],
  upgrade: true,
  rememberUpgrade: true,
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 250,
  reconnectionDelayMax: 1500,
  timeout: 4000
}) : { on() {}, emit() {} };
let TURNERO_CONFIG = { modules: [], videos: [], settings: {} };

const ATTENTION_TYPES = [
  { id: 'nuevo', label: 'Nuevo', bg: 'linear-gradient(135deg, #3f8cff 0%, #1f6dff 58%, #0c4ed9 100%)', text: '#ffffff', border: 'rgba(175, 213, 255, 0.5)', shadow: 'rgba(31, 109, 255, 0.34)' },
  { id: 'controles', label: 'Controles', bg: 'linear-gradient(135deg, #59d98c 0%, #25b05a 55%, #128248 100%)', text: '#ffffff', border: 'rgba(175, 245, 201, 0.48)', shadow: 'rgba(37, 176, 90, 0.32)' },
  { id: 'glaucoma', label: 'Glaucoma', bg: 'linear-gradient(135deg, #9e67ff 0%, #7a3fe0 58%, #5925bb 100%)', text: '#ffffff', border: 'rgba(217, 196, 255, 0.48)', shadow: 'rgba(122, 63, 224, 0.34)' },
  { id: 'cirugia', label: 'Cirugía', bg: 'linear-gradient(135deg, #ff6e6e 0%, #d64545 56%, #b42525 100%)', text: '#ffffff', border: 'rgba(255, 196, 196, 0.48)', shadow: 'rgba(214, 69, 69, 0.34)' },
  { id: 'retina', label: 'Retina', bg: 'linear-gradient(135deg, #2f8a58 0%, #1f6a3d 56%, #13492a 100%)', text: '#ffffff', border: 'rgba(171, 224, 194, 0.45)', shadow: 'rgba(31, 106, 61, 0.34)' },
  { id: 'cornea', label: 'Cornea', bg: 'linear-gradient(135deg, #ffb45d 0%, #f08a24 58%, #d66a06 100%)', text: '#221302', border: 'rgba(255, 223, 183, 0.45)', shadow: 'rgba(240, 138, 36, 0.3)' },
  { id: 'catarata', label: 'Catarata', bg: 'linear-gradient(135deg, #fff08a 0%, #e8c638 58%, #b88906 100%)', text: '#251b02', border: 'rgba(255, 244, 188, 0.48)', shadow: 'rgba(202, 138, 4, 0.28)' },
  { id: 'ipl', label: 'IPL', bg: 'linear-gradient(135deg, #ffe77a 0%, #f2d53c 58%, #d7b70d 100%)', text: '#2a2204', border: 'rgba(255, 244, 188, 0.45)', shadow: 'rgba(242, 213, 60, 0.28)' },
  { id: 'examenes', label: 'Exámenes', bg: 'linear-gradient(135deg, #ffd45c 0%, #e8b322 58%, #be8600 100%)', text: '#221302', border: 'rgba(255, 236, 173, 0.45)', shadow: 'rgba(232, 179, 34, 0.32)' },
  { id: 'imagenes', label: 'Imágenes', bg: 'linear-gradient(135deg, #37d4c9 0%, #1499a0 58%, #0e6f76 100%)', text: '#ffffff', border: 'rgba(183, 249, 243, 0.45)', shadow: 'rgba(20, 153, 160, 0.32)' },
  { id: 'lentes', label: 'Lentes', bg: 'linear-gradient(135deg, #ff88d4 0%, #dd4db2 58%, #b72b8d 100%)', text: '#ffffff', border: 'rgba(255, 205, 237, 0.45)', shadow: 'rgba(221, 77, 178, 0.32)' }
];

function normalizeAttentionTypeKey(value = '') {
  return String(value || '')
    .trim()
    .toLocaleLowerCase('es-PE')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

function getAttentionTypeMeta(value = '') {
  const normalized = normalizeAttentionTypeKey(value);
  return ATTENTION_TYPES.find((item) => item.id === normalized || normalizeAttentionTypeKey(item.label) === normalized) || null;
}

function buildAttentionTypeOptions(selectedValue = '') {
  const selectedKey = normalizeAttentionTypeKey(selectedValue);
  return ATTENTION_TYPES.map((item) => {
    const isSelected = selectedKey && selectedKey === normalizeAttentionTypeKey(item.label);
    return `<option value="${escapeHtml(item.label)}" ${isSelected ? 'selected' : ''}>${escapeHtml(item.label)}</option>`;
  }).join('');
}


function buildModuleDoctorOptions(moduleId = '', selectedValue = '', placeholder = 'Seleccione especialidad / subárea') {
  const module = getModuleMeta(moduleId);
  const doctors = Array.isArray(module.doctors) ? module.doctors : [];
  const selectedKey = normalizeAttentionTypeKey(selectedValue);
  const options = doctors.map((doctor) => {
    const isSelected = selectedKey && selectedKey === normalizeAttentionTypeKey(doctor);
    return `<option value="${escapeHtml(doctor)}" ${isSelected ? 'selected' : ''}>${escapeHtml(doctor)}</option>`;
  }).join('');
  return `<option value="">${escapeHtml(placeholder)}</option>${options}`;
}

function getAttentionTypeLabel(value = '') {
  return getAttentionTypeMeta(value)?.label || String(value || '').trim();
}


function renderAttentionTypeTag(attentionType = '', extraClass = 'attention-type-tag') {
  const meta = getAttentionTypeMeta(attentionType);
  const label = meta?.label || String(attentionType || '').trim();
  if (!label) return '';
  const style = meta
    ? ` style="--attention-badge-bg:${meta.bg};--attention-badge-text:${meta.text};--attention-badge-border:${meta.border || 'rgba(255,255,255,0.18)'};--attention-badge-shadow:${meta.shadow || 'rgba(7,18,31,0.28)'};"`
    : '';
  const dataAttr = meta ? ` data-attention-type="${meta.id}"` : '';
  return `<span class="${extraClass}${meta ? ' has-attention-type' : ''}"${dataAttr}${style}>${escapeHtml(label)}</span>`;
}

function renderAttentionCodeBadge(code = '', attentionType = '', extraClass = 'mini-code') {
  const meta = getAttentionTypeMeta(attentionType);
  const style = meta
    ? ` style="--attention-badge-bg:${meta.bg};--attention-badge-text:${meta.text};--attention-badge-border:${meta.border || 'rgba(255,255,255,0.18)'};--attention-badge-shadow:${meta.shadow || 'rgba(7,18,31,0.28)'};"`
    : '';
  const dataAttr = meta ? ` data-attention-type="${meta.id}"` : '';
  return `<span class="${extraClass} attention-code${meta ? ' has-attention-type' : ''}"${dataAttr}${style}>${escapeHtml(code)}</span>`;
}
const SESSION_USER_KEY = 'qhaliUser';
const SESSION_TOKEN_KEY = 'qhaliSessionToken';

async function api(url, options = {}) {
  const controller = new AbortController();
  const timeoutMs = Number(options.timeoutMs || 4500);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const sessionToken = getSessionToken();
    const response = await fetch(url, {
      headers: { 'Content-Type': 'application/json', 'X-Qhali-Ignore-Cookie': '1', ...(sessionToken ? { 'X-Qhali-Session': sessionToken } : {}) },
      cache: 'no-store',
      credentials: 'same-origin',
      ...options,
      signal: options.signal || controller.signal
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) {
        clearSessionToken();
        clearSessionUser();
        if (!location.pathname.includes('login.html') && !location.pathname.includes('index.html') && !location.pathname.includes('panel-publico.html')) {
          const next = `${location.pathname}${location.search}`;
          location.href = `/login.html?next=${encodeURIComponent(next)}`;
        }
      }
      throw new Error(data.message || 'Ocurrió un error inesperado.');
    }
    return data;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('La operación tardó demasiado. Revise la red local o el servicio SQL.');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function loadConfig() {
  TURNERO_CONFIG = await api('/api/config');
  return TURNERO_CONFIG;
}

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  return new Intl.DateTimeFormat('es-PE', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(date);
}

function formatTime(value) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('es-PE', {
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value));
}

function formatSeconds(totalSeconds) {
  const seconds = Number(totalSeconds) || 0;
  const minutes = Math.max(0, Math.round(seconds / 60));
  return `${minutes} min`;
}

function formatMinutes(totalMinutes) {
  const minutes = Number(totalMinutes) || 0;
  return `${Math.max(0, Math.round(minutes))} min`;
}

function escapeHtml(text = '') {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getModuleMeta(moduleId) {
  return (TURNERO_CONFIG.modules || []).find((item) => item.id === moduleId) || {
    id: moduleId,
    label: moduleId,
    room: 'Módulo',
    doctors: []
  };
}

function getCodeOrderValue(code = '') {
  const text = String(code || '').trim().toUpperCase();
  if (!text) return Number.MAX_SAFE_INTEGER;
  const parts = text.split('-');
  const prefix = parts[0] || text;
  const numberPart = parts[1] || '';
  const numeric = Number.parseInt(numberPart.replace(/\D+/g, ''), 10);
  const prefixOrder = (TURNERO_CONFIG.modules || []).findIndex((item) => String(item.prefix || '').toUpperCase() === prefix);
  const safePrefixOrder = prefixOrder >= 0 ? prefixOrder : 999;
  const safeNumeric = Number.isFinite(numeric) ? numeric : Number.MAX_SAFE_INTEGER;
  return safePrefixOrder * 1000000 + safeNumeric;
}

function byCodeOrder(a, b) {
  const orderDiff = getCodeOrderValue(a?.code) - getCodeOrderValue(b?.code);
  if (orderDiff !== 0) return orderDiff;
  return new Date(a?.createdAt || 0) - new Date(b?.createdAt || 0);
}

function byCreatedAt(a, b) {
  return new Date(a.createdAt) - new Date(b.createdAt);
}

function getQueryParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

function getSessionUser() {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_USER_KEY) || 'null');
  } catch {
    return null;
  }
}

function setSessionUser(user) {
  if (!user) {
    clearSessionUser();
    return;
  }
  const serialized = JSON.stringify(user);
  sessionStorage.setItem(SESSION_USER_KEY, serialized);
}

function clearSessionUser() {
  sessionStorage.removeItem(SESSION_USER_KEY);
}

function getSessionToken() {
  return sessionStorage.getItem(SESSION_TOKEN_KEY) || '';
}

function setSessionToken(token) {
  if (!token) return;
  sessionStorage.setItem(SESSION_TOKEN_KEY, token);
}

function clearSessionToken() {
  sessionStorage.removeItem(SESSION_TOKEN_KEY);
}

async function syncSessionUser() {
  try {
    const response = await api('/api/session', { timeoutMs: 8000 });
    if (response?.user) {
      setSessionUser(response.user);
      return response.user;
    }
  } catch {
    clearSessionToken();
    clearSessionUser();
  }
  return null;
}

function roleAllows(user, allowedRoles = []) {
  if (!user) return false;
  if (!allowedRoles.length) return true;
  return allowedRoles.includes(String(user.role || '').toUpperCase());
}

function requireSession(allowedRoles = []) {
  const user = getSessionUser();
  if (!user || !roleAllows(user, allowedRoles)) {
    const next = `${location.pathname}${location.search}`;
    location.href = `/login.html?next=${encodeURIComponent(next)}`;
    throw new Error('Sesión requerida.');
  }
  return user;
}

function attachSessionHeader(labelSelector = '#sessionLabel', logoutSelector = '[data-action="logout"]') {
  const user = getSessionUser();
  const label = document.querySelector(labelSelector);
  if (label && user) {
    label.textContent = `${user.fullName} · ${user.role}`;
  }
  const logoutBtn = document.querySelector(logoutSelector);
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      try { await api('/api/logout', { method: 'POST', body: JSON.stringify({}) }); } catch {}
      clearSessionToken();
      clearSessionUser();
      location.href = '/login.html';
    });
  }
}

function toUppercaseValue(value = '') {
  return String(value || '').toLocaleUpperCase('es-PE');
}

function bindUppercaseInputs(scope = document) {
  const fields = scope.querySelectorAll('input[type="text"], input:not([type]), textarea');
  fields.forEach((field) => {
    if (field.dataset.uppercaseBound === 'true') return;
    field.dataset.uppercaseBound = 'true';
    const transformNow = () => {
      const start = typeof field.selectionStart === 'number' ? field.selectionStart : null;
      const end = typeof field.selectionEnd === 'number' ? field.selectionEnd : null;
      const nextValue = toUppercaseValue(field.value);
      if (field.value !== nextValue) {
        field.value = nextValue;
        if (start !== null && end !== null) {
          try { field.setSelectionRange(start, end); } catch {}
        }
      }
    };
    field.addEventListener('input', transformNow);
    field.addEventListener('change', transformNow);
    transformNow();
  });
}

function setModulePageTitle(moduleId, suffix = '') {
  const module = getModuleMeta(moduleId || '');
  if (!module?.id) return;
  document.title = suffix ? `${module.label} · ${suffix}` : `${module.label}`;
}


function getAnnouncementVoice() {
  const voices = (window.speechSynthesis?.getVoices?.() || []).slice();
  const cfg = window.TURNERO_VOICE_CONFIG || {};
  const preferredLangs = Array.isArray(cfg.preferredVoiceLangs)
    ? cfg.preferredVoiceLangs.map((item) => String(item || '').toLowerCase())
    : ['quz-pe', 'quz', 'es-pe', 'es'];

  const preferred = voices
    .filter((voice) => {
      const lang = String(voice.lang || '').toLowerCase();
      return preferredLangs.some((item) => lang.startsWith(item));
    })
    .sort((a, b) => {
      const score = (voice) => {
        const name = String(voice.name || '').toLowerCase();
        const lang = String(voice.lang || '').toLowerCase();
        let value = 0;
        const rank = preferredLangs.findIndex((item) => lang.startsWith(item));
        if (rank >= 0) value += 60 - (rank * 8);
        if (/natural|neural|online/.test(name)) value += 20;
        if (/microsoft|google/.test(name)) value += 10;
        if (/female|dalia|elvira|helena|laura|maria|andrea|sabina|sofia/.test(name)) value += 12;
        return value;
      };
      return score(b) - score(a);
    });
  return preferred[0] || voices[0] || null;
}

function speakLocalAnnouncement(text, options = {}) {
  const normalizeSpeech = typeof window.normalizeSpeechText === 'function'
    ? window.normalizeSpeechText
    : (value) => String(value || '').trim();
  const message = normalizeSpeech(text);
  if (!message || !window.speechSynthesis || typeof window.SpeechSynthesisUtterance === 'undefined') return;
  const utterance = new SpeechSynthesisUtterance(message);
  const voice = getAnnouncementVoice();
  const cfg = window.TURNERO_VOICE_CONFIG || {};
  const speechCfg = cfg.speech || {};
  if (voice) utterance.voice = voice;
  utterance.lang = voice?.lang || cfg.lang || 'es-PE';
  utterance.rate = Number(options.rate ?? speechCfg.rate ?? 0.93);
  utterance.pitch = Number(options.pitch ?? speechCfg.pitch ?? 1.03);
  utterance.volume = Number(options.volume ?? speechCfg.volume ?? 1.0);
  try {
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  } catch {}
}

function pageSupportsPatientTools() {
  const path = String(window.location.pathname || '').toLowerCase();
  const moduleId = String(getQueryParam('module') || '').toLowerCase();
  const userModuleId = String(getSessionUser()?.moduleId || '').toLowerCase();
  if ((path.endsWith('/operator.html') || path === '/operator.html') && (moduleId === 'optometria' || userModuleId === 'optometria')) return false;
  return path.endsWith('/admin.html') || path.endsWith('/operator.html') || path === '/admin.html' || path === '/operator.html';
}

function normalizeSpeechTranscriptValue(value = '') {
  return toUppercaseValue(
    String(value || '')
      .replace(/\s+/g, ' ')
      .replace(/[…]+/g, '')
      .replace(/[\.,;:]+$/g, '')
      .trim()
  );
}

let activeBrowserDictation = null;

function stopActiveBrowserDictation() {
  if (!activeBrowserDictation) return;
  try { activeBrowserDictation.abort?.(); } catch {}
  try { activeBrowserDictation.stop?.(); } catch {}
  activeBrowserDictation = null;
}

function normalizeSpokenDigits(value = '') {
  const raw = String(value || '').toUpperCase();
  if (!raw) return '';
  const compact = raw
    .replace(/CERO/g, ' 0 ')
    .replace(/UNO/g, ' 1 ')
    .replace(/DOS/g, ' 2 ')
    .replace(/TRES/g, ' 3 ')
    .replace(/CUATRO/g, ' 4 ')
    .replace(/CINCO/g, ' 5 ')
    .replace(/SEIS/g, ' 6 ')
    .replace(/SIETE/g, ' 7 ')
    .replace(/OCHO/g, ' 8 ')
    .replace(/NUEVE/g, ' 9 ');
  return compact.replace(/\D/g, '');
}

function fillInputFromVoice(field, transcript = '') {
  if (!field) return;
  const normalized = normalizeSpeechTranscriptValue(transcript);
  if (!normalized) return;
  const inputType = String(field.getAttribute('type') || '').toLowerCase();
  const isDniField = Boolean((field.id && /dni/i.test(field.id)) || inputType === 'tel' || inputType === 'number');
  if (field.tagName === 'TEXTAREA') {
    field.value = [field.value, normalized].filter(Boolean).join(field.value ? ' ' : '');
  } else if (isDniField) {
    const digits = normalizeSpokenDigits(normalized) || normalized.replace(/\D/g, '');
    field.value = digits.slice(0, Number(field.maxLength || 32));
  } else {
    field.value = normalized;
  }
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
}

function applyPatientVoiceTranscript(fields = {}, transcript = '') {
  const text = normalizeSpeechTranscriptValue(transcript);
  if (!text) return 0;
  let matches = 0;
  const patterns = [
    { key: 'dni', regex: /(?:MI\s+)?DNI(?:\s+ES)?\s+([A-Z0-9ÁÉÍÓÚÑ\s]{8,40})/i, transform: (v) => (normalizeSpokenDigits(v) || String(v || '').replace(/\D/g, '')).slice(0, 8) },
    { key: 'firstName', regex: /(?:NOMBRE|NOMBRES)(?:\s+ES)?\s+([A-ZÁÉÍÓÚÑ ]+?)(?=\s+APELLID|\s+OBSERVACI|\s+NOTA|\s+DNI|$)/i },
    { key: 'lastName', regex: /(?:APELLIDO|APELLIDOS)(?:\s+ES)?\s+([A-ZÁÉÍÓÚÑ ]+?)(?=\s+OBSERVACI|\s+NOTA|\s+DNI|$)/i },
    { key: 'notes', regex: /(?:OBSERVACION|OBSERVACIONES|NOTA|NOTAS)(?:\s+ES)?\s+([A-ZÁÉÍÓÚÑ0-9 ]+)$/i }
  ];
  patterns.forEach((pattern) => {
    const match = text.match(pattern.regex);
    const field = fields[pattern.key];
    if (!match || !field) return;
    const value = typeof pattern.transform === 'function' ? pattern.transform(match[1] || '') : match[1];
    if (!value) return;
    fillInputFromVoice(field, value);
    matches += 1;
  });
  return matches;
}

function startBrowserDictation({ onResult, onError, onStart, onEnd, lang = 'es-PE' } = {}) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    onError?.(new Error('El navegador no tiene reconocimiento de voz habilitado. Use Microsoft Edge o Google Chrome.'));
    return null;
  }
  stopActiveBrowserDictation();
  const recognition = new SpeechRecognition();
  let finalTranscript = '';
  let bestTranscript = '';
  let lastResultAt = 0;
  let finished = false;
  let silenceTimer = null;
  let hardStopTimer = null;
  let emittedFinalFromEnd = false;

  const clearTimers = () => {
    if (silenceTimer) clearTimeout(silenceTimer);
    if (hardStopTimer) clearTimeout(hardStopTimer);
    silenceTimer = null;
    hardStopTimer = null;
  };
  const safeFinish = (callback) => {
    if (finished) return;
    finished = true;
    clearTimers();
    callback?.();
  };
  const scheduleAutoStop = () => {
    if (silenceTimer) clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => {
      try { recognition.stop(); } catch {}
    }, 4800);
  };

  recognition.lang = lang;
  recognition.interimResults = true;
  recognition.maxAlternatives = 3;
  recognition.continuous = true;
  activeBrowserDictation = recognition;
  recognition.onstart = () => {
    lastResultAt = Date.now();
    hardStopTimer = setTimeout(() => {
      try { recognition.stop(); } catch {}
    }, 24000);
    onStart?.();
  };
  recognition.onerror = (event) => {
    const code = String(event?.error || '').trim();
    if (code === 'aborted') return;
    if (code === 'no-speech' && bestTranscript.trim()) return;
    const message = code === 'not-allowed'
      ? 'Debe permitir el uso del micrófono para dictado por voz. Si abre el sistema por IP local, use HTTPS o localhost.'
      : code === 'no-speech'
        ? 'No se detectó voz. Intente nuevamente.'
        : code === 'service-not-allowed'
          ? 'El navegador bloqueó el servicio de voz. Use Edge o Chrome y permita micrófono. Hable seguido y sin pausas largas.'
          : 'No se pudo completar el dictado por voz.';
    safeFinish(() => { if (activeBrowserDictation === recognition) activeBrowserDictation = null; onError?.(new Error(message)); });
  };
  recognition.onresult = (event) => {
    const results = Array.from(event.results || []);
    let interimTranscript = '';
    results.forEach((result) => {
      const phrase = String(result?.[0]?.transcript || '').trim();
      if (!phrase) return;
      if (result.isFinal) {
        finalTranscript = `${finalTranscript} ${phrase}`.trim();
      } else {
        interimTranscript = `${interimTranscript} ${phrase}`.trim();
      }
    });
    lastResultAt = Date.now();
    scheduleAutoStop();
    const transcript = `${finalTranscript} ${interimTranscript}`.trim();
    if (transcript) {
      bestTranscript = transcript;
      onResult?.(transcript, { interim: Boolean(interimTranscript), finalText: finalTranscript.trim() });
    }
  };
  recognition.onend = () => {
    const resolvedTranscript = String(finalTranscript || bestTranscript || '').trim();
    const endedWithVoice = Boolean(resolvedTranscript) || (Date.now() - lastResultAt) < 4000;
    safeFinish(() => {
      if (activeBrowserDictation === recognition) activeBrowserDictation = null;
      if (resolvedTranscript && !emittedFinalFromEnd) {
        emittedFinalFromEnd = true;
        onResult?.(resolvedTranscript, { interim: false, finalText: resolvedTranscript, fromEnd: true });
      }
      onEnd?.(resolvedTranscript, { hasTranscript: Boolean(resolvedTranscript), endedWithVoice });
    });
  };
  try {
    recognition.start();
    return recognition;
  } catch (error) {
    if (activeBrowserDictation === recognition) activeBrowserDictation = null;
    onError?.(new Error('No se pudo iniciar el dictado por voz. Verifique el micrófono e intente nuevamente.'));
    return null;
  }
}

function resolveVoiceTargetField(fields = {}, fallbackField = null) {
  const activeField = document.activeElement;
  const candidates = [fields.dni, fields.firstName, fields.lastName, fields.notes].filter(Boolean);
  const target = candidates.find((field) => field === activeField) || fallbackField || fields.dni || candidates[0] || null;
  if (target?.focus) {
    try {
      target.focus({ preventScroll: false });
      if (typeof target.select === 'function' && target.tagName !== 'TEXTAREA') target.select();
    } catch {}
  }
  return target;
}

function setVoiceListeningState(button, targetField, listening) {
  if (button) button.classList.toggle('voice-btn-listening', Boolean(listening));
  if (targetField) targetField.classList.toggle('voice-target-listening', Boolean(listening));
}

function attachVoiceTriggerButton({ anchor, targetInput, mode = 'direct', fields = null, messageNode = null, placeholderText = 'Habla ahora...' } = {}) {
  if (!anchor || anchor.dataset.voiceAttached === 'true') return;
  anchor.dataset.voiceAttached = 'true';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'ghost-btn small-btn voice-trigger-btn';
  button.textContent = 'Voz';
  button.title = 'Llenar por voz';
  const setMessage = (text = '', isError = false) => {
    if (!messageNode) return;
    messageNode.textContent = text;
    messageNode.classList.toggle('error', isError);
  };
  button.addEventListener('click', () => {
    const resolvedTarget = fields ? resolveVoiceTargetField(fields, targetInput) : targetInput;
    startBrowserDictation({
      onStart: () => {
        button.disabled = true;
        button.textContent = 'Escuchando...';
        setVoiceListeningState(button, resolvedTarget, true);
        setMessage(placeholderText);
      },
      onEnd: () => {
        button.disabled = false;
        button.textContent = 'Voz';
        setVoiceListeningState(button, resolvedTarget, false);
      },
      onError: (error) => {
        button.disabled = false;
        button.textContent = 'Voz';
        setVoiceListeningState(button, resolvedTarget, false);
        setMessage(error.message, true);
      },
      onResult: (transcript, meta = {}) => {
        if (meta.interim) {
          setMessage(`${placeholderText} ${String(transcript || '').trim()}`.trim());
          return;
        }
        if (mode === 'search' && resolvedTarget) {
          resolvedTarget.value = normalizeSpeechTranscriptValue(transcript);
          resolvedTarget.dispatchEvent(new Event('input', { bubbles: true }));
          resolvedTarget.dispatchEvent(new Event('change', { bubbles: true }));
          setMessage('Búsqueda cargada por voz correctamente.');
          return;
        }
        if (mode === 'full' && fields) {
          const affected = applyPatientVoiceTranscript(fields, transcript);
          if (!affected && resolvedTarget) fillInputFromVoice(resolvedTarget, transcript);
          setMessage(affected ? 'Datos cargados por voz correctamente.' : 'Dictado recibido.');
          return;
        }
        fillInputFromVoice(resolvedTarget, transcript);
        setMessage('Dato cargado por voz correctamente.');
      }
    });
  });
  anchor.insertAdjacentElement('afterend', button);
}

function enhancePatientRegistrationVoice() {
  const setups = [
    {
      form: document.getElementById('patientForm'),
      message: document.getElementById('formMessage'),
      fields: {
        dni: document.getElementById('dniInput'),
        firstName: document.getElementById('firstNameInput'),
        lastName: document.getElementById('lastNameInput'),
        notes: document.querySelector('#patientForm textarea[name="notes"]')
      }
    },
    {
      form: document.getElementById('operatorPatientForm'),
      message: document.getElementById('operatorFormMessage'),
      fields: {
        dni: document.getElementById('operatorDni'),
        firstName: document.getElementById('operatorFirstName'),
        lastName: document.getElementById('operatorLastName'),
        notes: document.querySelector('#operatorPatientForm textarea[name="notes"]')
      }
    }
  ];

  setups.forEach((setup) => {
    if (!setup.form || setup.form.dataset.voiceEnhanced === 'true') return;
    setup.form.dataset.voiceEnhanced = 'true';
    const helper = document.createElement('div');
    helper.className = 'voice-toolbar full-span';
    helper.innerHTML = `
      <button type="button" class="ghost-btn small-btn" data-voice-target="full">Dictado por voz</button>
      <button type="button" class="ghost-btn small-btn" data-voice-target="dni">DNI</button>
      <button type="button" class="ghost-btn small-btn" data-voice-target="firstName">Nombre</button>
      <button type="button" class="ghost-btn small-btn" data-voice-target="lastName">Apellido</button>
      <button type="button" class="ghost-btn small-btn" data-voice-target="notes">Observación</button>
      <span class="muted small voice-toolbar-help">Diga por ejemplo: DNI 12345678 nombre Juan apellido Pérez observación control visual. Use Edge o Chrome y permita micrófono. Hable seguido y sin pausas largas.</span>
    `;
    const firstActionBlock = setup.form.querySelector('.actions') || setup.form.firstElementChild;
    if (firstActionBlock?.parentElement) firstActionBlock.insertAdjacentElement('afterend', helper);
    else setup.form.appendChild(helper);

    const setMessage = (text = '', isError = false) => {
      if (!setup.message) return;
      setup.message.textContent = text;
      setup.message.classList.toggle('error', isError);
    };

    helper.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-voice-target]');
      if (!button) return;
      const target = button.dataset.voiceTarget;
      const fields = setup.fields;
      const preferredTarget = target === 'full'
        ? resolveVoiceTargetField(fields, fields.dni)
        : resolveVoiceTargetField(fields, fields[target]);
      startBrowserDictation({
        onStart: () => {
          helper.classList.add('is-listening');
          button.classList.add('voice-btn-listening');
          setVoiceListeningState(button, preferredTarget, true);
          setMessage(target === 'full' ? 'Escuchando dictado completo...' : `Escuchando ${target === 'firstName' ? 'nombre' : target === 'lastName' ? 'apellido' : target === 'notes' ? 'observación' : 'DNI'}...`);
        },
        onEnd: () => {
          helper.classList.remove('is-listening');
          button.classList.remove('voice-btn-listening');
          setVoiceListeningState(button, preferredTarget, false);
        },
        onError: (error) => {
          helper.classList.remove('is-listening');
          button.classList.remove('voice-btn-listening');
          setVoiceListeningState(button, preferredTarget, false);
          setMessage(error.message, true);
        },
        onResult: (transcript, meta = {}) => {
          if (meta.interim) {
            setMessage(String(transcript || '').trim() ? `Escuchando: ${String(transcript || '').trim()}` : 'Escuchando...');
            return;
          }
          helper.classList.remove('is-listening');
          button.classList.remove('voice-btn-listening');
          setVoiceListeningState(button, preferredTarget, false);
          if (target === 'full') {
            const affected = applyPatientVoiceTranscript(fields, transcript);
            if (!affected) {
              const fallbackField = resolveVoiceTargetField(fields, fields.dni || fields.firstName || fields.lastName || fields.notes);
              fillInputFromVoice(fallbackField || fields.notes, transcript);
            }
            setMessage(affected ? 'Datos cargados por voz correctamente.' : 'Dato cargado por voz correctamente.');
            return;
          }
          const resolvedField = resolveVoiceTargetField(fields, fields[target]);
          fillInputFromVoice(resolvedField, transcript);
          setMessage('Dato cargado por voz correctamente.');
        }
      });
    });
  });
}

function createPatientSearchWidget() {
  if (!pageSupportsPatientTools() || document.getElementById('floatingPatientSearchFab')) return;
  const currentUser = getSessionUser();
  if (!currentUser || !roleAllows(currentUser, ['ADMIN', 'RECEPCION', 'OPERADOR'])) return;

  const fab = document.createElement('button');
  fab.type = 'button';
  fab.id = 'floatingPatientSearchFab';
  fab.className = 'patient-search-fab';
  fab.textContent = 'Buscar paciente';

  const overlay = document.createElement('div');
  overlay.id = 'floatingPatientSearchOverlay';
  overlay.className = 'modal-overlay hidden patient-search-overlay';
  overlay.innerHTML = `
    <div class="modal-card glass patient-search-card">
      <div class="section-head compact-modal-head">
        <div>
          <p class="section-kicker">Búsqueda flotante</p>
          <h3>Pacientes del día</h3>
          <p class="muted">Busque por DNI, nombre o código. Desde aquí puede emitir el llamado sin mover el resto del sistema.</p>
        </div>
        <button type="button" class="ghost-btn small-btn" data-close-patient-search>Cerrar</button>
      </div>
      <div class="patient-search-toolbar">
        <input type="search" id="floatingPatientSearchInput" placeholder="Buscar paciente del día" autocomplete="off" />
        <button type="button" id="floatingPatientSearchVoice" class="ghost-btn small-btn">Voz</button>
        <button type="button" id="floatingPatientSearchRun" class="primary-btn">Buscar</button>
      </div>
      <p id="floatingPatientSearchMessage" class="form-message"></p>
      <div id="floatingPatientSearchResults" class="patient-search-results"><div class="empty-state small">Escriba un DNI, nombre o código para buscar.</div></div>
    </div>
  `;

  document.body.appendChild(fab);
  document.body.appendChild(overlay);

  const input = overlay.querySelector('#floatingPatientSearchInput');
  const runBtn = overlay.querySelector('#floatingPatientSearchRun');
  const voiceBtn = overlay.querySelector('#floatingPatientSearchVoice');
  const resultsBox = overlay.querySelector('#floatingPatientSearchResults');
  const message = overlay.querySelector('#floatingPatientSearchMessage');
  let busy = false;

  const setMessage = (text = '', isError = false) => {
    message.textContent = text;
    message.classList.toggle('error', isError);
  };

  const renderResults = (items = []) => {
    if (!items.length) {
      resultsBox.innerHTML = '<div class="empty-state small">No se encontraron pacientes del día con ese criterio.</div>';
      return;
    }
    resultsBox.innerHTML = items.map((item) => {
      const status = String(item.status || '').toUpperCase();
      const statusKey = String(item.status || '').toLowerCase();
      const canCall = item.canCall === true && ['waiting', 'called'].includes(statusKey);
      const callMode = statusKey === 'called' ? 'repeat' : 'call';
      const statusLabel = ({ waiting: 'EN ESPERA', called: 'LLAMADO', attended: 'PRESENTE', completed: 'FINALIZADO', referred_out: 'REFERIDO' })[String(item.status || '').toLowerCase()] || status;
      return `
        <article class="admin-row compact patient-search-row">
          <div>
            <div class="row-badges">
              ${renderAttentionCodeBadge(item.code, item.doctorName, 'mini-code')}
              <span class="tag-module ${escapeHtml(item.moduleId || '')}">${escapeHtml(item.moduleLabel || getModuleMeta(item.moduleId).label || item.moduleId || '')}</span>
              <span class="ghost-btn small-btn patient-search-status" style="pointer-events:none;">${escapeHtml(statusLabel)}</span>
            </div>
            <h4>${escapeHtml(item.firstName || '')} ${escapeHtml(item.lastName || '')}</h4>
            <p class="muted">DNI ${escapeHtml(item.dni || '-')} · ${escapeHtml(item.area || getModuleMeta(item.moduleId).room || 'Área clínica')} · ${escapeHtml(item.doctorName || '')}</p>
            <p class="muted">Registrado ${escapeHtml(formatDateTime(item.createdAt))}</p>
          </div>
          <div class="row-actions stacked mobile-stack">
            <button type="button" class="primary-btn small-btn" data-patient-search-call="${escapeHtml(item.id)}" data-patient-search-module="${escapeHtml(item.moduleId || '')}" data-patient-search-call-mode="${escapeHtml(callMode)}" ${canCall ? '' : 'disabled'}>${canCall ? (callMode === 'repeat' ? 'Repetir llamado' : 'Llamar') : 'No disponible'}</button>
          </div>
        </article>
      `;
    }).join('');
  };

  const searchPatients = async () => {
    if (busy) return;
    const term = normalizeSpeechTranscriptValue(input.value || '');
    input.value = term;
    if (!term) {
      setMessage('Ingrese DNI, nombre o código para buscar.', true);
      resultsBox.innerHTML = '<div class="empty-state small">Escriba un DNI, nombre o código para buscar.</div>';
      return;
    }
    busy = true;
    setMessage('Buscando pacientes del día...');
    try {
      const response = await api(`/api/patients/day-search?q=${encodeURIComponent(term)}&limit=30`);
      renderResults(response.results || []);
      setMessage((response.results || []).length ? 'Resultados actualizados.' : 'Sin coincidencias para la búsqueda actual.');
    } catch (error) {
      setMessage(error.message, true);
      resultsBox.innerHTML = '<div class="empty-state small">No se pudo completar la búsqueda.</div>';
    } finally {
      busy = false;
    }
  };

  const openOverlay = () => {
    overlay.classList.remove('hidden');
    setTimeout(() => input.focus(), 40);
  };
  const closeOverlay = () => overlay.classList.add('hidden');

  fab.addEventListener('click', openOverlay);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay || event.target.closest('[data-close-patient-search]')) closeOverlay();
  });
  runBtn.addEventListener('click', searchPatients);
  voiceBtn?.addEventListener('click', () => {
    startBrowserDictation({
      onStart: () => {
        voiceBtn.disabled = true;
        voiceBtn.textContent = 'Escuchando...';
        setVoiceListeningState(voiceBtn, input, true);
        try { input.focus({ preventScroll: false }); } catch {}
        setMessage('Escuchando criterio de búsqueda...');
      },
      onEnd: () => {
        voiceBtn.disabled = false;
        voiceBtn.textContent = 'Voz';
        setVoiceListeningState(voiceBtn, input, false);
      },
      onError: (error) => {
        voiceBtn.disabled = false;
        voiceBtn.textContent = 'Voz';
        setVoiceListeningState(voiceBtn, input, false);
        setMessage(error.message, true);
      },
      onResult: async (transcript, meta = {}) => {
        input.value = normalizeSpeechTranscriptValue(transcript);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        if (meta.interim) {
          setMessage(`Escuchando: ${String(transcript || '').trim()}`.trim());
          return;
        }
        setMessage('Búsqueda cargada por voz correctamente.');
        await searchPatients();
      }
    });
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      searchPatients();
    }
    if (event.key === 'Escape') closeOverlay();
  });
  resultsBox.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-patient-search-call]');
    if (!button || button.disabled || busy) return;
    busy = true;
    const previousLabel = button.textContent;
    button.disabled = true;
    button.textContent = 'Procesando...';
    try {
      const callMode = String(button.dataset.patientSearchCallMode || 'call').toLowerCase();
      const patientId = encodeURIComponent(button.dataset.patientSearchCall || '');
      const moduleId = encodeURIComponent(button.dataset.patientSearchModule || '');
      const currentUser = getSessionUser() || {};
      const payload = { operatorUsername: currentUser.username || '', operatorName: currentUser.fullName || '' };
      if (callMode === 'repeat' && moduleId) {
        await api(`/api/repeat-call/${moduleId}`, { method: 'POST', body: JSON.stringify(payload) });
      } else {
        await api(`/api/call/${patientId}`, { method: 'POST', body: JSON.stringify(payload) });
      }
      setMessage(callMode === 'repeat' ? 'Llamado repetido correctamente.' : 'Llamado ejecutado correctamente.');
      closeOverlay();
      button.textContent = previousLabel;
      button.disabled = false;
      const eventDetail = {
        patientId: button.dataset.patientSearchCall || '',
        moduleId: button.dataset.patientSearchModule || '',
        mode: callMode
      };
      window.dispatchEvent(new CustomEvent('patient-search:called', { detail: eventDetail }));
      setTimeout(async () => {
        try {
          if (typeof window.refreshPatientToolHost === 'function') {
            await Promise.race([
              window.refreshPatientToolHost(),
              new Promise((resolve) => setTimeout(resolve, 1200))
            ]);
          }
          busy = false;
          await searchPatients();
        } catch (_) {
          busy = false;
        }
      }, 0);
    } catch (error) {
      setMessage(error.message, true);
      button.disabled = false;
      button.textContent = previousLabel;
    } finally {
      busy = false;
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !overlay.classList.contains('hidden')) closeOverlay();
  });
}

window.addEventListener('load', () => {
  if (!pageSupportsPatientTools()) return;
  enhancePatientRegistrationVoice();
  createPatientSearchWidget();
});
