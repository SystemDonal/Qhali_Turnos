(() => {
  const elements = {
    currentCard: document.getElementById('currentCard'),
    emptyCall: document.getElementById('emptyCall'),
    currentCallContent: document.getElementById('currentCallContent'),
    currentCode: document.getElementById('currentCode'),
    currentName: document.getElementById('currentName'),
    currentArea: document.getElementById('currentArea'),
    currentTime: document.getElementById('currentTime'),
    currentModuleChip: document.getElementById('currentModuleChip'),
    currentModuleText: document.getElementById('currentModuleText'),
    moduleColumns: document.getElementById('moduleColumns'),
    clock: document.getElementById('clock'),
    todayDate: document.getElementById('todayDate'),
    mediaLayer: document.getElementById('tvMediaLayer'),
    waitingVideo: document.getElementById('waitingVideo'),
    waitingAudio: document.getElementById('waitingAudio'),
    mediaStatus: document.getElementById('mediaStatus'),
    videoStateBadge: document.getElementById('videoStateBadge'),
    audioStateBadge: document.getElementById('audioStateBadge'),
    mediaHead: document.querySelector('#tvMediaLayer .tv-media-head')
  };

  const state = {
    modules: [],
    current: null,
    lastCallKey: '',
    snapshot: { queue: [], currentCalls: {}, currentCall: null },
    videos: [],
    mediaSync: null,
    audioEnabled: true,
    speechQueue: [],
    speechBusy: false,
    lastSpeechKey: ''
  };

  let cachedVoices = [];
  let activeSpeechToken = 0;
  let mediaBeforeSpeech = null;
  let institutionalTimer = null;
  let mediaDrag = null;
  let mediaRandomOrder = [];
  let suppressMediaAudioMemory = 0;
  const mediaPositionKey = 'qhali-tv-media-position-v1';
  const mediaVolumeKey = 'qhali-tv-media-volume-v1';
  const mediaMutedKey = 'qhali-tv-media-muted-v1';

  const moduleFallback = [
    { id: 'optometria', label: 'Optometría', room: 'Optometría', prefix: 'OPT' },
    { id: 'consultorio', label: 'Consultorio', room: 'Consultorio', prefix: 'CON' },
    { id: 'examenes', label: 'Exámenes', room: 'Exámenes', prefix: 'EXA' },
    { id: 'imagenes', label: 'Imágenes', room: 'Imágenes', prefix: 'IMG' },
    { id: 'ipl', label: 'IPL', room: 'IPL', prefix: 'IPL' },
    { id: 'cirugia', label: 'Cirugía', room: 'Cirugía', prefix: 'CIR' }
  ];

  const moduleOrder = ['optometria', 'consultorio', 'examenes', 'imagenes', 'ipl', 'cirugia'];

  const socket = window.io ? window.io({
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 300,
    reconnectionDelayMax: 1800,
    timeout: 4500
  }) : { on() {} };

  function escapeHtml(value = '') {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function normalized(value = '') {
    return String(value || '').trim().toLocaleLowerCase('es-PE');
  }

  function slug(value = '') {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function attentionType(item = {}) {
    const source = [
      item.referralSpecialty,
      item.doctorName,
      item.referralOriginDoctorName,
      item.area,
      item.moduleLabel
    ].filter(Boolean).join(' ');
    const key = slug(source);
    if (key.includes('glaucoma')) return 'glaucoma';
    if (key.includes('retina')) return 'retina';
    if (key.includes('cornea')) return 'cornea';
    if (key.includes('catarata')) return 'catarata';
    if (key.includes('refractiva') || key.includes('cirugia')) return 'refractiva';
    if (key.includes('general') || key.includes('medico-general')) return 'general';
    if (key.includes('procedimiento')) return 'procedimientos';
    if (key.includes('protocolo')) return 'protocolos';
    if (key.includes('meibografia')) return 'meibografia';
    if (key.includes('imagen')) return 'imagenes';
    if (key.includes('lente')) return 'lentes';
    if (key.includes('agudeza')) return 'agudeza';
    if (key.includes('especialista')) return 'especialista';
    return item.isReferred || item.referred ? 'referido' : 'nuevo';
  }

  function attentionClass(item = {}) {
    return `type-${attentionType(item)}`;
  }

  function normalizeVoiceToken(value = '') {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  function voiceConfig() {
    return window.TURNERO_VOICE_CONFIG || {};
  }

  function patientName(item = {}) {
    return String(item.displayName || `${item.firstName || ''} ${item.lastName || ''}`.trim() || 'Paciente').trim();
  }

  function moduleMeta(id = '') {
    return state.modules.find((item) => item.id === id) || moduleFallback.find((item) => item.id === id) || {
      id,
      label: id || 'Módulo',
      room: id || 'Módulo',
      prefix: ''
    };
  }

  function moduleTitle(id = '') {
    const meta = moduleMeta(id);
    if (id === 'optometria') return 'Optometría';
    if (id === 'consultorio') return 'Consultorio';
    return meta.room || meta.label || 'Módulo';
  }

  function formatTime(value = new Date()) {
    const date = value ? new Date(value) : new Date();
    const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
    return new Intl.DateTimeFormat('es-PE', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }).format(safeDate);
  }

  function formatShortTime(value = new Date()) {
    const date = value ? new Date(value) : new Date();
    const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
    return new Intl.DateTimeFormat('es-PE', {
      hour: '2-digit',
      minute: '2-digit'
    }).format(safeDate);
  }

  function formatDate(value = new Date()) {
    const date = value ? new Date(value) : new Date();
    const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
    return new Intl.DateTimeFormat('es-PE', {
      weekday: 'long',
      day: '2-digit',
      month: 'long'
    }).format(safeDate);
  }

  function extensionOf(url = '') {
    const cleanUrl = String(url || '').split('?')[0].toLowerCase();
    const dot = cleanUrl.lastIndexOf('.');
    return dot >= 0 ? cleanUrl.slice(dot) : '';
  }

  function isAudioUrl(url = '', item = null) {
    if (item?.type === 'audio') return true;
    return ['.mp3', '.wav', '.m4a', '.aac', '.flac', '.opus'].includes(extensionOf(url));
  }

  function mimeFor(url = '', mediaType = 'video') {
    const ext = extensionOf(url);
    const map = {
      '.mp4': 'video/mp4',
      '.m4v': 'video/mp4',
      '.mov': 'video/quicktime',
      '.webm': 'video/webm',
      '.ogv': 'video/ogg',
      '.ogg': mediaType === 'audio' ? 'audio/ogg' : 'video/ogg',
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.m4a': 'audio/mp4',
      '.aac': 'audio/aac',
      '.flac': 'audio/flac',
      '.opus': 'audio/ogg'
    };
    return map[ext] || (mediaType === 'audio' ? 'audio/mpeg' : 'video/mp4');
  }

  function isBrowserMediaFormat(url = '', mediaType = 'video', item = null) {
    if (item && item.html5Compatible === false) return false;
    const ext = extensionOf(url);
    const browserExts = new Set(['.mp4', '.m4v', '.webm', '.ogv', '.ogg', '.mp3', '.wav', '.m4a', '.aac', '.opus']);
    if (!browserExts.has(ext)) return false;
    const probe = mediaType === 'audio' ? document.createElement('audio') : document.createElement('video');
    const support = probe.canPlayType?.(mimeFor(url, mediaType));
    return support !== '';
  }

  function shuffleList(list = []) {
    const copy = [...list];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function nextRandomMediaItem() {
    if (!state.videos.length) return null;
    const currentUrl = state.mediaSync?.currentVideoUrl || '';
    if (!mediaRandomOrder.length) mediaRandomOrder = shuffleList(state.videos.map((_, index) => index));
    let nextIndex = mediaRandomOrder.shift();
    if (state.videos.length > 1 && state.videos[nextIndex]?.url === currentUrl) {
      if (!mediaRandomOrder.length) mediaRandomOrder = shuffleList(state.videos.map((_, index) => index));
      const alternate = mediaRandomOrder.find((index) => state.videos[index]?.url !== currentUrl);
      if (alternate !== undefined) {
        mediaRandomOrder = mediaRandomOrder.filter((index) => index !== alternate);
        mediaRandomOrder.unshift(nextIndex);
        nextIndex = alternate;
      }
    }
    return state.videos[nextIndex] || state.videos[0];
  }

  function playRandomFolderMedia() {
    const item = nextRandomMediaItem();
    if (!item) return;
    applyMediaSync({
      managedByAdmin: false,
      currentVideoUrl: item.url,
      currentVideoName: item.name,
      currentTime: 0,
      isPlaying: true,
      volume: preferredMediaVolume(voiceConfig().defaultVideoVolume ?? 0.55),
      muted: state.audioEnabled === false || preferredMediaMuted(false),
      playbackRate: 1,
      loop: false,
      controlsVisible: false,
      engine: item.playbackMode || 'html5'
    });
  }

  function setMediaStatus(message = '', active = false) {
    if (!elements.mediaStatus) return;
    elements.mediaStatus.textContent = message;
    elements.mediaStatus.classList.toggle('visible', Boolean(message && active));
  }

  function setMediaChrome({ videoLabel = null, videoActive = null, audioLabel = null, audioEnabled = null } = {}) {
    if (elements.videoStateBadge && videoLabel !== null) {
      elements.videoStateBadge.textContent = videoLabel;
      elements.videoStateBadge.classList.toggle('is-active', videoActive === true);
      elements.videoStateBadge.classList.toggle('is-error', /aviso|bloque|compatible|error/i.test(videoLabel));
      elements.videoStateBadge.classList.toggle('is-idle', /sin video/i.test(videoLabel));
    }
    if (elements.audioStateBadge && audioLabel !== null) {
      elements.audioStateBadge.textContent = audioLabel;
      elements.audioStateBadge.classList.toggle('is-muted', audioEnabled === false);
      elements.audioStateBadge.classList.toggle('is-audio', audioEnabled !== false);
    }
  }

  function preferredMediaVolume(fallback = 0.65) {
    try {
      const saved = Number(window.localStorage.getItem(mediaVolumeKey));
      if (Number.isFinite(saved)) return Math.max(0, Math.min(1, saved));
    } catch {}
    return Math.max(0, Math.min(1, Number(fallback ?? 0.65)));
  }

  function preferredMediaMuted(fallback = false) {
    try {
      const saved = window.localStorage.getItem(mediaMutedKey);
      if (saved === 'true') return true;
      if (saved === 'false') return false;
    } catch {}
    return fallback === true;
  }

  function rememberMediaAudio(media) {
    if (!media) return;
    if (suppressMediaAudioMemory > 0 || media.dataset?.temporarySpeechVolume === '1') return;
    try { window.localStorage.setItem(mediaVolumeKey, String(Math.max(0, Math.min(1, Number(media.volume || 0))))); } catch {}
    try { window.localStorage.setItem(mediaMutedKey, media.muted ? 'true' : 'false'); } catch {}
  }

  function setMediaAudioWithoutSaving(media, values = {}) {
    if (!media) return;
    suppressMediaAudioMemory += 1;
    try {
      if (Object.prototype.hasOwnProperty.call(values, 'volume')) media.volume = Math.max(0, Math.min(1, Number(values.volume)));
      if (Object.prototype.hasOwnProperty.call(values, 'muted')) media.muted = values.muted === true;
    } catch {} finally {
      window.setTimeout(() => {
        suppressMediaAudioMemory = Math.max(0, suppressMediaAudioMemory - 1);
      }, 0);
    }
  }

  function clampMediaPosition(left, top) {
    const layer = elements.mediaLayer;
    if (!layer) return { left: 0, top: 0 };
    const rect = layer.getBoundingClientRect();
    const margin = 10;
    const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
    const maxTop = Math.max((Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ticker-height')) || 34) + margin, window.innerHeight - rect.height - margin);
    return {
      left: Math.min(Math.max(margin, Number(left) || margin), maxLeft),
      top: Math.min(Math.max(margin, Number(top) || margin), maxTop)
    };
  }

  function setMediaPosition(left, top, persist = true) {
    const layer = elements.mediaLayer;
    if (!layer) return;
    const position = clampMediaPosition(left, top);
    layer.style.left = `${Math.round(position.left)}px`;
    layer.style.top = `${Math.round(position.top)}px`;
    layer.style.setProperty('--media-left', `${Math.round(position.left)}px`);
    layer.style.setProperty('--media-top', `${Math.round(position.top)}px`);
    layer.style.right = 'auto';
    layer.style.bottom = 'auto';
    layer.classList.add('is-positioned');
    if (persist) {
      try { window.localStorage.setItem(mediaPositionKey, JSON.stringify(position)); } catch {}
    }
  }

  function resetMediaPosition() {
    const layer = elements.mediaLayer;
    if (!layer) return;
    layer.style.left = '';
    layer.style.top = '';
    layer.style.removeProperty('--media-left');
    layer.style.removeProperty('--media-top');
    layer.style.right = '';
    layer.style.bottom = '';
    layer.classList.remove('is-positioned');
    try { window.localStorage.removeItem(mediaPositionKey); } catch {}
  }

  function restoreMediaPosition() {
    try {
      const saved = JSON.parse(window.localStorage.getItem(mediaPositionKey) || 'null');
      if (saved && Number.isFinite(Number(saved.left)) && Number.isFinite(Number(saved.top))) {
        window.requestAnimationFrame(() => setMediaPosition(saved.left, saved.top, false));
      }
    } catch {}
  }

  function setupDraggableMedia() {
    const layer = elements.mediaLayer;
    const handle = elements.mediaHead;
    if (!layer || !handle) return;
    handle.setAttribute('title', 'Arrastre para mover el reproductor. Doble clic para volver a la posición original.');

    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      const rect = layer.getBoundingClientRect();
      mediaDrag = {
        pointerId: event.pointerId,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top
      };
      layer.classList.add('is-dragging');
      try { handle.setPointerCapture(event.pointerId); } catch {}
      event.preventDefault();
    });

    handle.addEventListener('pointermove', (event) => {
      if (!mediaDrag || mediaDrag.pointerId !== event.pointerId) return;
      setMediaPosition(event.clientX - mediaDrag.offsetX, event.clientY - mediaDrag.offsetY, false);
    });

    const finishDrag = (event) => {
      if (!mediaDrag || mediaDrag.pointerId !== event.pointerId) return;
      const rect = layer.getBoundingClientRect();
      setMediaPosition(rect.left, rect.top, true);
      mediaDrag = null;
      layer.classList.remove('is-dragging');
      try { handle.releasePointerCapture(event.pointerId); } catch {}
    };

    handle.addEventListener('pointerup', finishDrag);
    handle.addEventListener('pointercancel', finishDrag);
    handle.addEventListener('dblclick', resetMediaPosition);
    window.addEventListener('resize', () => {
      if (!layer.classList.contains('is-positioned')) return;
      const rect = layer.getBoundingClientRect();
      setMediaPosition(rect.left, rect.top, true);
    });
  }

  function getVoices() {
    cachedVoices = window.speechSynthesis?.getVoices?.() || cachedVoices || [];
    return cachedVoices;
  }

  function voiceScore(voice) {
    const cfg = voiceConfig();
    const name = normalizeVoiceToken(voice?.name);
    const lang = normalizeVoiceToken(voice?.lang);
    const preferredLangs = Array.isArray(cfg.preferredVoiceLangs) ? cfg.preferredVoiceLangs.map(normalizeVoiceToken) : ['es-pe', 'es'];
    const preferred = Array.isArray(cfg.preferredVoices) ? cfg.preferredVoices.map(normalizeVoiceToken) : [];
    const femaleHints = Array.isArray(cfg.femaleVoiceHints) ? cfg.femaleVoiceHints.map(normalizeVoiceToken) : [];
    const maleHints = Array.isArray(cfg.maleVoiceHints) ? cfg.maleVoiceHints.map(normalizeVoiceToken) : [];
    const wantsFemale = normalizeVoiceToken(cfg.preferredGender) === 'female';
    const wantsMale = normalizeVoiceToken(cfg.preferredGender) === 'male';
    let score = 0;

    const langRank = preferredLangs.findIndex((item) => item && lang.startsWith(item));
    if (langRank >= 0) score += 260 - (langRank * 24);
    else if (lang.startsWith('es')) score += 140;
    else if (lang.startsWith('qu')) score += 90;
    else if (lang) score -= 120;

    preferred.forEach((item, index) => {
      if (!item) return;
      if (name === item) score += 520 - (index * 10);
      else if (name.includes(item)) score += 300 - (index * 6);
    });

    if (/natural|neural|online/.test(name)) score += 80;
    if (/microsoft|google/.test(name)) score += 35;
    if (voice?.default) score += 20;

    const femaleHit = femaleHints.some((hint) => hint && name.includes(hint));
    const maleHit = maleHints.some((hint) => hint && name.includes(hint));
    if (wantsFemale) {
      if (femaleHit) score += 220;
      if (maleHit) score -= 240;
    } else if (wantsMale) {
      if (maleHit) score += 220;
      if (femaleHit) score -= 240;
    }

    return score;
  }

  function chooseBestVoice() {
    const voices = getVoices();
    if (!voices.length) return null;
    return voices
      .slice()
      .sort((a, b) => voiceScore(b) - voiceScore(a))[0] || null;
  }

  function normalizeSpeechMessage(value = '') {
    const message = String(value || '').replace(/\s+/g, ' ').trim();
    if (!message) return '';
    return typeof window.normalizeSpeechText === 'function' ? window.normalizeSpeechText(message) : message;
  }

  function composeSpeechText(payload = {}) {
    if (payload.isInternalAnnouncement) {
      return normalizeSpeechMessage(payload.announcementText || payload.message || payload.area || '');
    }
    const cfg = voiceConfig();
    const destination = payload.destinationText || payload.moduleLabel || moduleTitle(payload.moduleId);
    const template = cfg.callTemplate || 'Paciente {name} acercarse a {destination} para su atención.';
    return normalizeSpeechMessage(template
      .replaceAll('{name}', patientName(payload))
      .replaceAll('{code}', payload.code || '')
      .replaceAll('{area}', payload.area || destination)
      .replaceAll('{moduleLabel}', payload.moduleLabel || destination)
      .replaceAll('{destination}', destination)
      .replaceAll('{doctorTitle}', payload.doctorName || '')
      .replaceAll('{doctorName}', payload.doctorName || ''));
  }

  function speechKey(payload = {}) {
    if (payload.isInternalAnnouncement) return `staff-${payload.id || payload.eventId || ''}-${payload.createdAt || payload.calledAt || ''}`;
    return `patient-${payload.id || payload.patientId || payload.eventId || ''}-${payload.calledAt || payload.announcementAt || ''}`;
  }

  function wait(ms = 0) {
    return new Promise((resolve) => window.setTimeout(resolve, Math.max(0, Number(ms) || 0)));
  }

  function waitUntilAnnouncementTime(payload = {}) {
    const target = payload.announcementAt ? new Date(payload.announcementAt).getTime() : Date.now();
    const delay = Number.isFinite(target) ? Math.max(0, target - Date.now()) : 0;
    return wait(delay);
  }

  function duckMediaForSpeech() {
    const cfg = voiceConfig();
    const duckVolume = Math.max(0, Math.min(1, Number(cfg.duckingVolume ?? 0.02)));
    elements.mediaLayer?.classList.add('media-ducked');
    mediaBeforeSpeech = [elements.waitingVideo, elements.waitingAudio]
      .filter(Boolean)
      .map((media) => ({
        media,
        volume: media.volume,
        muted: media.muted
      }));
    mediaBeforeSpeech.forEach(({ media }) => {
      try {
        media.dataset.temporarySpeechVolume = '1';
        if (!media.muted) setMediaAudioWithoutSaving(media, { volume: Math.min(media.volume, duckVolume) });
      } catch {}
    });
  }

  function restoreMediaAfterSpeech() {
    const previous = mediaBeforeSpeech || [];
    mediaBeforeSpeech = null;
    previous.forEach(({ media, volume, muted }) => {
      try {
        setMediaAudioWithoutSaving(media, { volume, muted: state.audioEnabled === false ? true : muted });
        window.setTimeout(() => { try { delete media.dataset.temporarySpeechVolume; } catch {} }, 0);
      } catch {}
    });
    elements.mediaLayer?.classList.remove('media-ducked');
  }

  async function playChime() {
    const cfg = voiceConfig();
    if (!state.audioEnabled || !cfg.chimeUrl) return;
    try {
      const audio = new Audio(cfg.chimeUrl);
      audio.volume = 0.9;
      await audio.play();
    } catch {}
  }

  function applySpeechSettings(utterance, voice) {
    const cfg = voiceConfig();
    const speech = cfg.speech || {};
    if (voice) utterance.voice = voice;
    utterance.lang = voice?.lang || cfg.lang || 'es-PE';
    utterance.rate = Math.max(0.6, Math.min(1.3, Number(speech.rate ?? 0.96)));
    utterance.pitch = Math.max(0.6, Math.min(1.4, Number(speech.pitch ?? 1)));
    utterance.volume = Math.max(0, Math.min(1, Number(speech.volume ?? 1)));
  }

  function speakSegment(text, voice) {
    return new Promise((resolve) => {
      if (!window.speechSynthesis || typeof window.SpeechSynthesisUtterance === 'undefined') {
        resolve(false);
        return;
      }
      const utterance = new SpeechSynthesisUtterance(text);
      applySpeechSettings(utterance, voice);
      let done = false;
      const finish = (ok = true) => {
        if (done) return;
        done = true;
        resolve(ok);
      };
      utterance.onend = () => finish(true);
      utterance.onerror = () => finish(false);
      try {
        window.speechSynthesis.speak(utterance);
        window.setTimeout(() => {
          if (!done && !window.speechSynthesis.speaking && !window.speechSynthesis.pending) finish(false);
        }, 1200);
      } catch {
        finish(false);
      }
    });
  }

  function speechSentences(text = '') {
    return String(text || '')
      .split(/(?<=\.)\s+/)
      .map((part) => part.trim())
      .filter(Boolean);
  }

  async function speakPayload(payload = {}) {
    if (!state.audioEnabled) return;
    const text = composeSpeechText(payload);
    if (!text) return;

    const cfg = voiceConfig();
    const repeatCount = Math.max(1, Math.min(1, Number(payload.repeatCount || cfg.repeatCount || 1)));
    const prelude = normalizeSpeechMessage(cfg.preludeText || '');
    const voice = chooseBestVoice();
    const token = ++activeSpeechToken;

    await waitUntilAnnouncementTime(payload);
    if (token !== activeSpeechToken) return;

    duckMediaForSpeech();
    await playChime();
    await wait(cfg.chimeDelayMs ?? 80);

    if (!window.speechSynthesis || typeof window.SpeechSynthesisUtterance === 'undefined') {
      setMediaStatus('Voz no disponible en este navegador.', true);
      await wait(1800);
      restoreMediaAfterSpeech();
      return;
    }

    try { window.speechSynthesis.cancel(); } catch {}
    setMediaStatus('Anunciando llamado por voz', true);

    for (let i = 0; i < repeatCount; i += 1) {
      if (token !== activeSpeechToken) break;
      if (prelude) await speakSegment(prelude, voice);
      if (token !== activeSpeechToken) break;
      const parts = speechSentences(text);
      for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
        if (token !== activeSpeechToken) break;
        await speakSegment(parts[partIndex], voice);
        if (partIndex < parts.length - 1) await wait(cfg.sentencePauseMs ?? 45);
      }
      await wait(cfg.segmentPauseMs ?? 55);
    }

    await wait(cfg.postSpeechHoldMs ?? 180);
    if (token === activeSpeechToken) {
      restoreMediaAfterSpeech();
      setMediaStatus('');
    }
  }

  function enqueueSpeech(payload = {}) {
    const key = speechKey(payload);
    if (!key || key === state.lastSpeechKey) return;
    state.lastSpeechKey = key;
    state.speechQueue.push(payload);
    processSpeechQueue();
  }

  async function processSpeechQueue() {
    if (state.speechBusy) return;
    state.speechBusy = true;
    while (state.speechQueue.length) {
      const payload = state.speechQueue.shift();
      try {
        await speakPayload(payload);
      } catch {
        restoreMediaAfterSpeech();
      }
    }
    state.speechBusy = false;
  }

  async function safePlay(media) {
    if (!media) return false;
    const waitForMediaReady = () => new Promise((resolve) => {
      if (media.readyState >= 2) {
        resolve(true);
        return;
      }
      let done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        media.removeEventListener('loadeddata', onReady);
        media.removeEventListener('canplay', onReady);
        media.removeEventListener('error', onError);
        window.clearTimeout(timer);
        resolve(ok);
      };
      const onReady = () => finish(true);
      const onError = () => finish(false);
      const timer = window.setTimeout(() => finish(media.readyState >= 1), 3500);
      media.addEventListener('loadeddata', onReady, { once: true });
      media.addEventListener('canplay', onReady, { once: true });
      media.addEventListener('error', onError, { once: true });
      try { media.load(); } catch {}
    });

    const ready = await waitForMediaReady();
    if (!ready) return false;

    try {
      const result = media.play();
      if (result && typeof result.then === 'function') await result;
      return true;
    } catch {
      try {
        media.muted = true;
        const result = media.play();
        if (result && typeof result.then === 'function') await result;
        return true;
      } catch {
        return false;
      }
    }
  }

  function stopMedia(target = null) {
    [elements.waitingVideo, elements.waitingAudio].forEach((media) => {
      if (!media || media === target) return;
      try { media.pause(); } catch {}
      media.removeAttribute('src');
      try { media.load(); } catch {}
    });
  }

  async function applyMediaSync(sync = {}) {
    state.mediaSync = sync || {};
    const url = String(sync?.currentVideoUrl || '').trim();
    if (!url) {
      stopMedia();
      elements.mediaLayer?.classList.remove('media-active', 'media-audio-only');
      setMediaStatus('');
      setMediaChrome({ videoLabel: 'Sin video', videoActive: null, audioLabel: state.audioEnabled === false ? 'Audio desactivado' : 'Audio habilitado', audioEnabled: state.audioEnabled !== false });
      return;
    }

    const item = state.videos.find((video) => video.url === url || video.name === sync.currentVideoName) || null;
    const audioOnly = isAudioUrl(url, item);
    const media = audioOnly ? elements.waitingAudio : elements.waitingVideo;
    if (!media) return;

    if (sync.engine === 'vlc_external') {
      stopMedia();
      elements.mediaLayer?.classList.remove('media-active', 'media-audio-only');
      setMediaStatus('Reproducción enviada a VLC externo para formatos especiales. El sistema de llamados sigue activo.', true);
      setMediaChrome({
        videoLabel: audioOnly ? 'Audio VLC activo' : 'VLC externo activo',
        videoActive: true,
        audioLabel: state.audioEnabled === false || sync.muted === true ? 'Audio desactivado' : 'Audio habilitado',
        audioEnabled: !(state.audioEnabled === false || sync.muted === true)
      });
      return;
    }

    if (!isBrowserMediaFormat(url, audioOnly ? 'audio' : 'video', item)) {
      stopMedia();
      elements.mediaLayer?.classList.remove('media-active', 'media-audio-only');
      setMediaStatus('Este formato no se reproduce dentro del navegador. Active motor VLC externo o use MP4 H.264 / WebM.', true);
      setMediaChrome({
        videoLabel: 'Formato no interno',
        videoActive: false,
        audioLabel: state.audioEnabled === false || sync.muted === true ? 'Audio desactivado' : 'Audio habilitado',
        audioEnabled: !(state.audioEnabled === false || sync.muted === true)
      });
      return;
    }

    stopMedia(media);
    const nextSrc = new URL(url, window.location.origin).href;
    const sourceChanged = media.src !== nextSrc;
    if (sourceChanged) {
      media.src = url;
      media.type = mimeFor(url, audioOnly ? 'audio' : 'video');
      try { media.load(); } catch {}
    }

    media.loop = sync.loop === true;
    media.volume = preferredMediaVolume(voiceConfig().defaultVideoVolume ?? 0.55);
    media.muted = state.audioEnabled === false || sync.muted === true || preferredMediaMuted(false);
    media.playbackRate = Math.max(0.5, Math.min(2, Number(sync.playbackRate || 1)));
    if (elements.waitingVideo) elements.waitingVideo.controls = sync.controlsVisible === true;

    const shouldSeek = sourceChanged || sync.forceSeek === true || sync.managedByAdmin === true;
    if (shouldSeek && Number.isFinite(Number(sync.currentTime)) && Math.abs((media.currentTime || 0) - Number(sync.currentTime)) > 2) {
      try { media.currentTime = Math.max(0, Number(sync.currentTime)); } catch {}
    }

    elements.mediaLayer?.classList.toggle('media-active', !audioOnly);
    elements.mediaLayer?.classList.toggle('media-audio-only', audioOnly);

    if (sync.isPlaying === false) {
      try { media.pause(); } catch {}
      setMediaStatus('Multimedia pausada', true);
      setMediaChrome({ videoLabel: audioOnly ? 'Audio pausado' : 'Video pausado', videoActive: false, audioLabel: state.audioEnabled === false || media.muted ? 'Audio desactivado' : 'Audio habilitado', audioEnabled: !(state.audioEnabled === false || media.muted) });
      return;
    }

    const played = await safePlay(media);
    if (!played) {
      const ext = extensionOf(url);
      const fallback = ['.avi', '.mkv', '.wmv', '.mpeg', '.mpg', '.flac'].includes(ext)
        ? 'Formato no compatible con el navegador. Use motor VLC externo para reproducirlo.'
        : 'El navegador bloqueó la reproducción automática. Active audio desde administración.';
      setMediaStatus(fallback, true);
      setMediaChrome({ videoLabel: 'Video con aviso', videoActive: false, audioLabel: state.audioEnabled === false || media.muted ? 'Audio desactivado' : 'Audio habilitado', audioEnabled: !(state.audioEnabled === false || media.muted) });
      return;
    }
    setMediaStatus('');
    setMediaChrome({ videoLabel: audioOnly ? 'Audio activo' : 'Video activo', videoActive: true, audioLabel: state.audioEnabled === false || media.muted ? 'Audio desactivado' : 'Audio habilitado', audioEnabled: !(state.audioEnabled === false || media.muted) });
  }

  function enqueueInstitutionalAnnouncement() {
    const cfg = voiceConfig();
    const institutional = cfg.institutionalAnnouncement || {};
    if (institutional.enabled === false || !institutional.text) return;
    if (state.speechBusy || state.speechQueue.length) return;
    enqueueSpeech({
      id: `institucional-${Date.now()}`,
      eventId: `institucional-${Date.now()}`,
      announcementText: institutional.text,
      message: institutional.text,
      area: 'Mensaje institucional',
      moduleId: 'institucional',
      moduleLabel: 'Mensaje institucional',
      calledAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      isInternalAnnouncement: true
    });
  }

  function scheduleInstitutionalAnnouncement() {
    const cfg = voiceConfig();
    const institutional = cfg.institutionalAnnouncement || {};
    if (institutionalTimer) {
      window.clearTimeout(institutionalTimer);
      institutionalTimer = null;
    }
    if (institutional.enabled === false || !institutional.text) return;
    const interval = Math.max(60_000, Number(institutional.intervalMs || 20 * 60 * 1000));
    const initialDelay = Math.max(60_000, Number(institutional.initialDelayMs || interval));
    const tick = () => {
      enqueueInstitutionalAnnouncement();
      institutionalTimer = window.setTimeout(tick, interval);
    };
    institutionalTimer = window.setTimeout(tick, initialDelay);
  }

  function codeOrder(code = '') {
    const text = String(code || '').toUpperCase();
    const number = Number.parseInt(text.replace(/^[A-Z]+-?/i, ''), 10);
    const prefix = text.split('-')[0];
    const prefixIndex = state.modules.findIndex((item) => String(item.prefix || '').toUpperCase() === prefix);
    return (prefixIndex >= 0 ? prefixIndex : 99) * 100000 + (Number.isFinite(number) ? number : 99999);
  }

  function visiblePatient(item = {}) {
    return ['waiting', 'called', 'attended', 'absent'].includes(normalized(item.status));
  }

  function waitingPatient(item = {}) {
    return ['waiting', 'called', 'absent'].includes(normalized(item.status));
  }

  function statusLabel(item = {}) {
    const status = normalized(item.status);
    if (status === 'called') return 'Llamando';
    if (status === 'attended') return 'Presente';
    if (status === 'absent') return 'Ausente';
    if (item.isReferred || item.referred) return 'Referido';
    return 'En espera';
  }

  function currentFromSnapshot(snapshot = {}) {
    return snapshot.currentCall || Object.values(snapshot.currentCalls || {})
      .filter(Boolean)
      .sort((a, b) => new Date(b.calledAt || 0) - new Date(a.calledAt || 0))[0] || null;
  }

  function renderCurrent(call) {
    state.current = call || null;
    if (!call) {
      elements.emptyCall?.classList.remove('hidden');
      elements.currentCallContent?.classList.add('hidden');
      if (elements.currentModuleChip) elements.currentModuleChip.textContent = 'Sin llamado';
      elements.currentCard?.classList.remove('is-announcing', 'has-call');
      if (elements.currentCard) {
        elements.currentCard.className = elements.currentCard.className
          .split(/\s+/)
          .filter((name) => name && !name.startsWith('type-'))
          .join(' ');
      }
      return;
    }

    const moduleLabel = moduleTitle(call.moduleId);
    const destination = call.doctorCareLabel ? `${moduleLabel} - ${call.doctorCareLabel}` : call.doctorName ? `${moduleLabel} - Medico oftalmologo: ${call.doctorName}` : moduleLabel;

    elements.emptyCall?.classList.add('hidden');
    elements.currentCallContent?.classList.remove('hidden');
    elements.currentCard?.classList.add('has-call');

    if (elements.currentCode) elements.currentCode.textContent = call.code || '---';
    if (elements.currentName) elements.currentName.textContent = patientName(call);
    if (elements.currentArea) elements.currentArea.textContent = destination;
    if (elements.currentTime) elements.currentTime.textContent = `Hora: ${formatShortTime(call.calledAt)}`;
    if (elements.currentModuleText) elements.currentModuleText.textContent = moduleLabel;
    if (elements.currentModuleChip) {
      elements.currentModuleChip.textContent = moduleLabel;
      elements.currentModuleChip.className = `module-chip ${escapeHtml(call.moduleId || '')}`;
    }
    if (elements.currentCard) {
      elements.currentCard.className = elements.currentCard.className
        .split(/\s+/)
        .filter((name) => name && !name.startsWith('type-'))
        .join(' ');
      elements.currentCard.classList.add(attentionClass(call));
    }

    const key = `${call.id || ''}-${call.calledAt || ''}`;
    if (key && key !== state.lastCallKey) {
      elements.currentCard?.classList.remove('is-announcing');
      void elements.currentCard?.offsetWidth;
      elements.currentCard?.classList.add('is-announcing');
      state.lastCallKey = key;
    }
  }

  function renderModules(snapshot = {}) {
    const queue = Array.isArray(snapshot.queue) ? snapshot.queue : [];
    const currentCalls = snapshot.currentCalls || {};
    const moduleIds = Array.from(new Set([
      'optometria',
      'consultorio',
      ...moduleOrder,
      ...queue.map((item) => item.moduleId).filter(Boolean)
    ])).filter(Boolean);

    const cards = moduleIds
      .map((id) => {
        const list = queue
          .filter((item) => item.moduleId === id && visiblePatient(item))
          .sort((a, b) => codeOrder(a.code) - codeOrder(b.code));
        const active = currentCalls[id] || list.find((item) => normalized(item.status) === 'called') || null;
        const waitingCount = list.filter(waitingPatient).length;
        return { id, title: moduleTitle(id), list, active, waitingCount };
      })
      .filter((card) => ['optometria', 'consultorio'].includes(card.id) || card.list.length || card.active)
      .sort((a, b) => {
        const ai = moduleOrder.indexOf(a.id);
        const bi = moduleOrder.indexOf(b.id);
        return (ai >= 0 ? ai : 99) - (bi >= 0 ? bi : 99);
      });

    elements.moduleColumns.innerHTML = cards.map((card) => `
      <article class="module-card ${escapeHtml(card.id)} ${card.active ? 'has-active' : ''} ${card.active ? attentionClass(card.active) : ''}">
        <header class="module-card-head">
          <div>
            <span>${escapeHtml(card.active ? 'Atención activa' : 'Sala de espera')}</span>
            <h2>${escapeHtml(card.title)}</h2>
          </div>
          <strong>${card.waitingCount}</strong>
        </header>
        <div class="module-active">
          <span>Último llamado</span>
          <b>${card.active ? escapeHtml(card.active.code || '---') : '---'}</b>
          <small>${card.active ? escapeHtml(patientName(card.active)) : 'Sin llamado activo'}</small>
        </div>
        <div class="patient-list">
          ${card.list.length ? card.list.slice(0, 8).map((item, index) => `
            <div class="patient-row ${normalized(item.status)} ${attentionClass(item)}">
              <span class="patient-position">${index + 1}</span>
              <span class="patient-row-code">${escapeHtml(item.code || '---')}</span>
              <span class="patient-row-name">${escapeHtml(patientName(item))}</span>
              <span class="patient-row-status">${escapeHtml(item.doctorCareLabel || item.doctorName || statusLabel(item))}</span>
            </div>
          `).join('') : '<div class="empty-list">Sin pacientes en espera</div>'}
        </div>
      </article>
    `).join('');
  }

  function render(snapshot = {}) {
    state.snapshot = {
      queue: Array.isArray(snapshot.queue) ? snapshot.queue : [],
      currentCalls: snapshot.currentCalls || {},
      currentCall: snapshot.currentCall || null,
      callHistory: snapshot.callHistory || []
    };
    renderCurrent(currentFromSnapshot(snapshot));
    renderModules(snapshot);
  }

  function updateClock() {
    if (elements.clock) elements.clock.textContent = formatTime(new Date());
    if (elements.todayDate) elements.todayDate.textContent = formatDate(new Date());
  }

  async function fetchJson(url) {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  async function init() {
    updateClock();
    setInterval(updateClock, 1000);
    setupDraggableMedia();
    restoreMediaPosition();

    try {
      const config = await fetchJson('/api/config');
      state.modules = Array.isArray(config.modules) && config.modules.length ? config.modules : moduleFallback;
      state.videos = Array.isArray(config.videos) ? config.videos : [];
      state.audioEnabled = config.settings?.audioEnabled !== false;
      setMediaChrome({ videoLabel: 'Sin video', videoActive: null, audioLabel: state.audioEnabled === false ? 'Audio desactivado' : 'Audio habilitado', audioEnabled: state.audioEnabled !== false });
      if (config.media?.randomPlayback !== false && state.videos.length) {
        playRandomFolderMedia();
      } else if (config.videoSyncState?.currentVideoUrl) {
        applyMediaSync(config.videoSyncState);
      } else if (state.videos.length) {
        playRandomFolderMedia();
      } else {
        setMediaChrome({ videoLabel: 'Sin video', videoActive: null });
      }
    } catch {
      state.modules = moduleFallback;
    }

    try {
      render(await fetchJson('/api/state'));
    } catch {
      render({ queue: [], currentCalls: {}, currentCall: null });
    }
  }

  socket.on('state:update', render);
  socket.on('patient:called', (payload) => {
    render({
      ...state.snapshot,
      currentCall: payload,
      currentCalls: { ...(state.snapshot.currentCalls || {}), [payload.moduleId]: payload }
    });
    enqueueSpeech(payload);
    window.setTimeout(async () => {
      try {
        render(await fetchJson('/api/state'));
      } catch {}
    }, 250);
  });

  socket.on('staff:announcement', (payload = {}) => {
    if (!payload?.id && !payload?.announcementText && !payload?.message) return;
    enqueueSpeech({
      ...payload,
      announcementAt: payload.announcementAt || new Date(Date.now() + 450).toISOString(),
      displayName: payload.targetName || 'LLAMADO DE APOYO',
      code: 'APOYO',
      area: payload.message || 'Acercarse al área solicitada',
      moduleId: payload.originModuleId || 'apoyo',
      moduleLabel: 'Llamado de apoyo',
      doctorName: payload.originLabel || '',
      calledAt: payload.createdAt || new Date().toISOString(),
      isInternalAnnouncement: true
    });
  });

  socket.on('video:sync', (payload = {}) => {
    if (state.videos.length && payload?.managedByAdmin !== true && !payload?.currentVideoUrl) return;
    applyMediaSync(payload);
  });

  socket.on('audio:settings', (payload = {}) => {
    state.audioEnabled = payload.enabled !== false;
    const mediaControlEvent = payload.source === 'media-control';
    if (mediaControlEvent && Number.isFinite(Number(payload.volume))) {
      try { window.localStorage.setItem(mediaVolumeKey, String(Math.max(0, Math.min(1, Number(payload.volume))))); } catch {}
    }
    if (mediaControlEvent && Object.prototype.hasOwnProperty.call(payload, 'muted')) {
      try { window.localStorage.setItem(mediaMutedKey, payload.muted === true ? 'true' : 'false'); } catch {}
    }
    setMediaChrome({ audioLabel: state.audioEnabled === false || payload.muted === true ? 'Audio desactivado' : 'Audio habilitado', audioEnabled: !(state.audioEnabled === false || payload.muted === true) });
    if (mediaControlEvent) {
      const patch = {
        ...(state.mediaSync || {}),
        muted: payload.muted === true,
        volume: Number.isFinite(Number(payload.volume)) ? Number(payload.volume) : state.mediaSync?.volume
      };
      applyMediaSync(patch);
    }
  });

  elements.waitingVideo?.addEventListener?.('playing', () => {
    setMediaChrome({ videoLabel: 'Video activo', videoActive: true });
  });

  elements.waitingVideo?.addEventListener?.('pause', () => {
    if (state.mediaSync?.currentVideoUrl && state.mediaSync?.isPlaying === false) {
      setMediaChrome({ videoLabel: 'Video pausado', videoActive: false });
    }
  });

  elements.waitingVideo?.addEventListener?.('error', () => {
    setMediaStatus('No se pudo reproducir este video. El sistema de llamados sigue activo.', true);
    setMediaChrome({ videoLabel: 'Video con aviso', videoActive: false });
  });

  elements.waitingVideo?.addEventListener?.('ended', () => {
    playRandomFolderMedia();
  });

  elements.waitingVideo?.addEventListener?.('volumechange', () => {
    rememberMediaAudio(elements.waitingVideo);
  });

  elements.waitingAudio?.addEventListener?.('ended', () => {
    playRandomFolderMedia();
  });

  elements.waitingAudio?.addEventListener?.('volumechange', () => {
    rememberMediaAudio(elements.waitingAudio);
  });

  window.speechSynthesis?.addEventListener?.('voiceschanged', () => {
    cachedVoices = window.speechSynthesis?.getVoices?.() || [];
  });

  init();
  scheduleInstitutionalAnnouncement();
})();
