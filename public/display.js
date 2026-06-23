let currentState = null;
let lastAnnouncedId = null;
let cachedVoices = [];
let playlistItems = [];
let playlistOrder = [];
let currentVideoIndex = -1;
let mediaDuckingDepth = 0;
let restoreMediaTimer = null;
let audioEnabled = true;
let activeSpeechToken = 0;
let announcementQueue = [];
let isAnnouncementRunning = false;
let pendingVideoSyncState = null;
let syncedVideoState = null;
let suppressEndedAutoplay = false;
let primeVideoTimer = null;
let lastVideoProgressClock = 0;
let lastVideoProgressPosition = 0;
let videoRecoveryTimer = null;
let videoRecoveryLockUntil = 0;
let manualVideoAudioState = { hasManualPreference: false, volume: null, muted: null };
let internalVideoAudioUpdateDepth = 0;
let announcementGuardUntil = 0;
let lastManagedVideoVolume = null;
let lastManagedVideoMuted = null;
let mediaRestoreSnapshot = null;
let suppressPauseRecoveryUntil = 0;
let videoSourceSwitching = false;
let videoAudioUnlockPending = false;

const cfg = window.TURNERO_VOICE_CONFIG || {};
const speechCfg = cfg.speech || {};

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
  historyList: document.getElementById('historyList'),
  moduleColumns: document.getElementById('moduleColumns'),
  clock: document.getElementById('clock'),
  todayDate: document.getElementById('todayDate'),
  totalWaiting: document.getElementById('totalWaiting'),
  countOptometria: document.getElementById('countOptometria'),
  countExamenes: document.getElementById('countExamenes'),
  countConsultorio: document.getElementById('countConsultorio'),
  countImagenes: document.getElementById('countImagenes'),
  countIpl: document.getElementById('countIpl'),
  countCirugia: document.getElementById('countCirugia'),
  waitingVideo: document.getElementById('waitingVideo'),
  waitingVideoSource: document.getElementById('waitingVideoSource'),
  videoFallbackMessage: document.getElementById('videoFallbackMessage'),
  playlistStatus: document.getElementById('playlistStatus')
};


const videoCompatibilityState = {
  retryCount: 0,
  stallCount: 0,
  hardReloadCount: 0,
  lastUrl: '',
  bootstrapped: false,
  buffering: false,
  lastPrimeAt: 0,
  loading: false,
  lastHealthyAt: 0,
  skipTimer: null
};


function isVlcExternalMode() {
  return (syncedVideoState?.engine || currentState?.videoSyncState?.engine || null) === 'vlc_external';
}

function applyExternalVlcUiMode() {
  const video = elements.waitingVideo;
  if (!video) return;
  video.classList.remove('vlc-external-hidden');
  if (isVlcExternalMode()) {
    if (elements.playlistStatus) elements.playlistStatus.textContent = 'Zona de reproducción externa';
    hideVideoFallback();
    return;
  }
  if (elements.playlistStatus) elements.playlistStatus.textContent = 'Zona de reproducción integrada';
}

function clampVideoLevel(value, fallback = 0.55) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return Math.max(0, Math.min(1, Number(fallback) || 0));
  return Math.max(0, Math.min(1, numeric));
}

function runWithManagedVideoAudioUpdate(callback) {
  internalVideoAudioUpdateDepth += 1;
  try {
    return callback();
  } finally {
    window.setTimeout(() => {
      internalVideoAudioUpdateDepth = Math.max(0, internalVideoAudioUpdateDepth - 1);
    }, 0);
  }
}

function getPreferredVideoVolume() {
  if (manualVideoAudioState.hasManualPreference && Number.isFinite(Number(manualVideoAudioState.volume))) {
    return clampVideoLevel(manualVideoAudioState.volume, cfg.defaultVideoVolume ?? 0.55);
  }
  return clampVideoLevel(syncedVideoState?.volume ?? cfg.defaultVideoVolume ?? 0.55, cfg.defaultVideoVolume ?? 0.55);
}

function getPreferredVideoMuted() {
  if (audioEnabled === false) return true;
  if (manualVideoAudioState.hasManualPreference && typeof manualVideoAudioState.muted === 'boolean') {
    return manualVideoAudioState.muted;
  }
  return syncedVideoState?.muted === true;
}

function rememberManualVideoAudioPreference(video, event = null) {
  if (!video) return;
  if (internalVideoAudioUpdateDepth > 0) return;
  if (mediaDuckingDepth > 0) return;
  if (event && event.isTrusted !== true) return;
  manualVideoAudioState = {
    hasManualPreference: true,
    volume: clampVideoLevel(video.volume, cfg.defaultVideoVolume ?? 0.55),
    muted: video.muted === true
  };
}

function applyManagedVideoAudioState(video, { muted, volume }) {
  if (!video) return;
  runWithManagedVideoAudioUpdate(() => {
    try {
      if (typeof muted === 'boolean') {
        video.muted = muted;
        lastManagedVideoMuted = muted;
      }
      if (Number.isFinite(Number(volume)) && muted !== true) {
        const nextVolume = clampVideoLevel(volume, cfg.defaultVideoVolume ?? 0.55);
        video.volume = nextVolume;
        lastManagedVideoVolume = nextVolume;
      }
    } catch {}
  });
}

function getVideoMimeType(url = '') {
  const clean = String(url || '').toLowerCase().split('?')[0];
  if (clean.endsWith('.mp4') || clean.endsWith('.m4v')) return 'video/mp4';
  if (clean.endsWith('.webm')) return 'video/webm';
  if (clean.endsWith('.ogv') || clean.endsWith('.ogg')) return 'video/ogg';
  if (clean.endsWith('.mov')) return 'video/quicktime';
  return 'video/mp4';
}

function setVideoFallback(message = '') {
  if (!elements.videoFallbackMessage) return;
  elements.videoFallbackMessage.textContent = message || 'No se pudo reproducir el video en este televisor.';
  elements.videoFallbackMessage.classList.remove('hidden');
}

function hideVideoFallback() {
  elements.videoFallbackMessage?.classList.add('hidden');
}


function updateVideoFrameLayout(video) {
  const wrap = video?.closest?.('.video-wrap');
  if (!wrap || !video) return;
  wrap.classList.remove('video-landscape', 'video-portrait', 'video-square');
  const vw = Number(video.videoWidth || 0);
  const vh = Number(video.videoHeight || 0);
  if (vw > 0 && vh > 0) {
    const ratio = vw / vh;
    if (ratio >= 1.2) wrap.classList.add('video-landscape');
    else if (ratio <= 0.85) wrap.classList.add('video-portrait');
    else wrap.classList.add('video-square');
  } else {
    wrap.classList.add('video-landscape');
  }
}

function markVideoHealthy(video) {
  videoSourceSwitching = false;
  videoCompatibilityState.buffering = false;
  videoCompatibilityState.loading = false;
  videoCompatibilityState.retryCount = 0;
  videoCompatibilityState.stallCount = 0;
  videoCompatibilityState.hardReloadCount = 0;
  videoCompatibilityState.lastHealthyAt = Date.now();
  lastVideoProgressClock = Date.now();
  lastVideoProgressPosition = Number(video?.currentTime || 0);
  hideVideoFallback();
}

function clearPendingVideoSkip() {
  if (!videoCompatibilityState.skipTimer) return;
  window.clearTimeout(videoCompatibilityState.skipTimer);
  videoCompatibilityState.skipTimer = null;
}

function scheduleSkipToNextVideo(reason = 'reproducción') {
  clearPendingVideoSkip();
  videoCompatibilityState.skipTimer = window.setTimeout(() => {
    videoCompatibilityState.retryCount = 0;
    videoCompatibilityState.stallCount = 0;
    videoCompatibilityState.hardReloadCount = 0;
    setVideoFallback(`Se cambió al siguiente video por ${reason}.`);
    playNextRandomVideo();
    window.setTimeout(hideVideoFallback, 1800);
  }, 320);
}

function getBufferedAhead(video) {
  if (!video || !video.buffered || !Number.isFinite(Number(video.currentTime))) return 0;
  try {
    for (let i = 0; i < video.buffered.length; i += 1) {
      const start = Number(video.buffered.start(i));
      const end = Number(video.buffered.end(i));
      const current = Number(video.currentTime || 0);
      if (current >= start && current <= end) return Math.max(0, end - current);
    }
  } catch {}
  return 0;
}

async function safePlayVideo(video) {
  if (!video) return false;
  try {
    const playResult = video.play();
    if (playResult && typeof playResult.then === 'function') await playResult;
    hideVideoFallback();
    return true;
  } catch (_error) {
    const previousMuted = video.muted === true;
    try {
      runWithManagedVideoAudioUpdate(() => {
        video.muted = true;
      });
      const secondTry = video.play();
      if (secondTry && typeof secondTry.then === 'function') await secondTry;
      hideVideoFallback();
      if (!previousMuted && getRuntimeVideoAudioTarget().muted !== true) {
        videoAudioUnlockPending = true;
        setVideoFallback('Video activo. Para habilitar el audio, toque una vez la pantalla.');
        window.setTimeout(() => {
          enforceVideoAudioState(0);
        }, 90);
      }
      return true;
    } catch (_error2) {
      runWithManagedVideoAudioUpdate(() => {
        video.muted = previousMuted;
      });
      return false;
    }
  }
}

function configureVideoElementForTv() {
  const video = elements.waitingVideo;
  if (!video || videoCompatibilityState.bootstrapped) return;
  videoCompatibilityState.bootstrapped = true;
  video.autoplay = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', 'true');
  video.setAttribute('x5-playsinline', 'true');
  video.preload = 'auto';
  video.controls = syncedVideoState?.controlsVisible === true;
  video.disablePictureInPicture = true;
  try { video.setAttribute('controlsList', 'nodownload noplaybackrate nofullscreen'); } catch {}
  if (!video.hasAttribute('muted')) video.setAttribute('muted', '');
  runWithManagedVideoAudioUpdate(() => {
    video.muted = true;
  });
  video.addEventListener('volumechange', (event) => {
    rememberManualVideoAudioPreference(video, event);
  });

  video.addEventListener('loadedmetadata', () => {
    updateVideoFrameLayout(video);
    markVideoHealthy(video);
  });

  video.addEventListener('loadeddata', () => {
    updateVideoFrameLayout(video);
    markVideoHealthy(video);
    if (Number.isFinite(video.currentTime) && video.currentTime < 0.05) {
      try { video.currentTime = 0.01; } catch {}
    }
  });

  video.addEventListener('canplay', () => {
    markVideoHealthy(video);
    safePlayVideo(video).catch(() => {});
  });

  video.addEventListener('canplaythrough', () => {
    markVideoHealthy(video);
    safePlayVideo(video).catch(() => {});
  });

  video.addEventListener('stalled', () => {
    videoCompatibilityState.buffering = true;
    videoCompatibilityState.stallCount += 1;
    setVideoFallback('El video se detuvo. Reintentando reproducción...');
    primeVideoBuffer('stalled');
  });

  video.addEventListener('waiting', () => {
    videoCompatibilityState.buffering = true;
    if (getBufferedAhead(video) < 0.25) {
      primeVideoBuffer('waiting');
    }
  });

  video.addEventListener('playing', () => {
    clearPendingVideoSkip();
    markVideoHealthy(video);
  });

  video.addEventListener('timeupdate', () => {
    clearPendingVideoSkip();
    markVideoHealthy(video);
  });

  video.addEventListener('pause', () => {
    if (video.ended) return;
    if (videoSourceSwitching) return;
    if (syncedVideoState?.isPlaying === false) return;
    if (Date.now() < (suppressPauseRecoveryUntil || 0)) return;
    window.setTimeout(() => {
      if (video.paused && !video.ended) {
        if (videoSourceSwitching) return;
        if (syncedVideoState?.isPlaying === false) return;
        if (Date.now() < (suppressPauseRecoveryUntil || 0)) return;
        safePlayVideo(video).then((ok) => {
          if (!ok) primeVideoBuffer('pause');
        }).catch(() => primeVideoBuffer('pause'));
      }
    }, 250);
  });

  video.addEventListener('suspend', () => {
    const bufferedAhead = getBufferedAhead(video);
    if (!video.currentSrc && videoCompatibilityState.lastUrl) {
      loadVideoSource(videoCompatibilityState.lastUrl, { preserveTime: false, autoplay: true, forceMuted: true, hardReload: true });
      return;
    }
    if (!video.paused && !video.ended && bufferedAhead < 0.2) {
      primeVideoBuffer('suspend');
    }
  });

  video.addEventListener('abort', () => {
    if (videoCompatibilityState.lastUrl && !videoCompatibilityState.loading) primeVideoBuffer('abort');
  });

  video.addEventListener('emptied', () => {
    if (videoCompatibilityState.lastUrl && !videoCompatibilityState.loading) primeVideoBuffer('emptied');
  });

  video.addEventListener('error', () => {
    const current = videoCompatibilityState.lastUrl;
    const currentName = playlistItems[currentVideoIndex]?.name || 'video';
    setVideoFallback(`Formato no compatible o error de reproducción en este televisor: ${currentName}.`);
    if (!current) return;
    if (videoCompatibilityState.retryCount < 2) {
      videoCompatibilityState.retryCount += 1;
      setTimeout(() => {
        loadVideoSource(current, { preserveTime: false, autoplay: true, forceMuted: true, hardReload: true });
      }, 700);
      return;
    }
    videoCompatibilityState.retryCount = 0;
    scheduleSkipToNextVideo('error de reproducción');
  });

  ensureVideoRecoveryWatcher();
  document.addEventListener('click', () => safePlayVideo(video).catch(() => {}), { passive: true });
  document.addEventListener('touchstart', () => safePlayVideo(video).catch(() => {}), { passive: true });

  const unlockAudio = () => {
    if (!videoAudioUnlockPending && getRuntimeVideoAudioTarget().muted === true) return;
    videoAudioUnlockPending = false;
    applyManagedVideoAudioState(video, {
      muted: getRuntimeVideoAudioTarget().muted,
      volume: getRuntimeVideoAudioTarget().volume
    });
    safePlayVideo(video).catch(() => {});
    if (getRuntimeVideoAudioTarget().muted !== true) hideVideoFallback();
  };
  document.addEventListener('pointerdown', unlockAudio, { passive: true });
  document.addEventListener('keydown', unlockAudio, { passive: true });
}

function setPauseRecoverySuppression(ms = 0) {
  suppressPauseRecoveryUntil = Math.max(suppressPauseRecoveryUntil || 0, Date.now() + Math.max(0, Number(ms) || 0));
}

function loadVideoSource(url, options = {}) {
  const video = elements.waitingVideo;
  if (!video || !url) return;
  configureVideoElementForTv();

  const previousTime = options.preserveTime ? Number(video.currentTime || 0) : 0;
  const normalizedUrl = String(url || '').trim();
  const shouldBustCache = options.cacheBust === true;
  const hardReload = options.hardReload === true;
  const requestedUrl = shouldBustCache ? `${normalizedUrl}${normalizedUrl.includes('?') ? '&' : '?'}_vh=${Date.now()}` : normalizedUrl;
  const currentSrc = String(video.currentSrc || '');
  const changed = videoCompatibilityState.lastUrl !== normalizedUrl || !currentSrc || !currentSrc.includes(normalizedUrl);

  if (!hardReload && !changed) {
    video.preload = 'auto';
    if (options.autoplay !== false) {
      setTimeout(() => { safePlayVideo(video).catch(() => {}); }, 80);
    }
    return;
  }

  videoCompatibilityState.lastUrl = normalizedUrl;
  videoCompatibilityState.loading = true;
  videoSourceSwitching = true;
  setPauseRecoverySuppression(1800);
  if (changed) {
    videoCompatibilityState.retryCount = 0;
    videoCompatibilityState.stallCount = 0;
    videoCompatibilityState.hardReloadCount = 0;
  }
  clearPendingVideoSkip();

  setPauseRecoverySuppression(1400);
  try { video.pause(); } catch {}
  hideVideoFallback();

  if (options.forceMuted === true) {
    video.defaultMuted = true;
    video.muted = true;
    video.setAttribute('muted', '');
  }

  if (elements.waitingVideoSource) {
    elements.waitingVideoSource.removeAttribute('src');
    elements.waitingVideoSource.type = getVideoMimeType(normalizedUrl);
  }
  try { video.removeAttribute('src'); } catch {}
  video.src = requestedUrl;
  video.preload = 'auto';
  video.load();

  const resumeTime = Number.isFinite(previousTime) ? previousTime : 0;
  if (resumeTime > 0.05) {
    const restoreTime = () => {
      try { video.currentTime = resumeTime; } catch {}
      video.removeEventListener('loadedmetadata', restoreTime);
    };
    video.addEventListener('loadedmetadata', restoreTime);
  }

  if (options.autoplay !== false) {
    setTimeout(() => { safePlayVideo(video).catch(() => {}); }, 120);
    setTimeout(() => { safePlayVideo(video).catch(() => {}); }, 700);
    setTimeout(() => { safePlayVideo(video).catch(() => {}); }, 1500);
  }
}

function softRecoverVideoPlayback(video, reason = 'buffer') {
  if (!video) return false;
  const now = Date.now();
  if (videoRecoveryLockUntil && now < videoRecoveryLockUntil) return false;
  videoRecoveryLockUntil = now + 6000;
  try {
    if (video.readyState >= 2 && Number.isFinite(video.currentTime) && !video.ended) {
      const nudgedTime = Math.max(0, Number(video.currentTime || 0) + 0.05);
      try { video.currentTime = nudgedTime; } catch {}
    }
  } catch {}
  safePlayVideo(video).catch(() => {});
  if (reason === 'stalled' || reason === 'watchdog') setVideoFallback('Reanudando video...');
  return true;
}

function primeVideoBuffer(reason = 'buffer') {
  const video = elements.waitingVideo;
  if (!video) return;
  if (primeVideoTimer) window.clearTimeout(primeVideoTimer);
  const delayByReason = { waiting: 22000, stalled: 18000, pause: 14000, watchdog: 18000, suspend: 18000, abort: 18000, emptied: 18000, buffer: 16000 };
  const delayMs = delayByReason[reason] || 10000;
  primeVideoTimer = window.setTimeout(() => {
    try {
      const now = Date.now();
      const staleFor = lastVideoProgressClock ? now - lastVideoProgressClock : 0;
      const bufferedAhead = getBufferedAhead(video);
      const hasDecodableData = video.readyState >= 2;
      const shouldSoftRecover = staleFor > 22000 || bufferedAhead < 0.16 || video.paused;

      if (hasDecodableData && !video.ended) {
        if (shouldSoftRecover) {
          const recovered = softRecoverVideoPlayback(video, reason);
          if (recovered) return;
        }
        safePlayVideo(video).then((ok) => {
          if (!ok && videoCompatibilityState.lastUrl && staleFor > 120000 && bufferedAhead < 0.08 && videoCompatibilityState.hardReloadCount < 1) {
            videoCompatibilityState.hardReloadCount += 1;
            loadVideoSource(videoCompatibilityState.lastUrl, { preserveTime: true, autoplay: true, forceMuted: true, hardReload: true });
          }
        }).catch(() => {});
        return;
      }

      if (videoCompatibilityState.lastUrl) {
        if ((staleFor > 210000 || videoCompatibilityState.stallCount >= 16) && videoCompatibilityState.hardReloadCount >= 1) {
          scheduleSkipToNextVideo(reason);
        } else if (staleFor > 150000 && videoCompatibilityState.hardReloadCount < 1) {
          videoCompatibilityState.hardReloadCount += 1;
          loadVideoSource(videoCompatibilityState.lastUrl, { preserveTime: true, autoplay: true, forceMuted: true, hardReload: true });
        } else {
          softRecoverVideoPlayback(video, reason);
        }
      }
    } catch {}
  }, delayMs);
}

function ensureVideoRecoveryWatcher() {
  if (videoRecoveryTimer) return;
  videoRecoveryTimer = window.setInterval(() => {
    const video = elements.waitingVideo;
    if (!video || !videoCompatibilityState.lastUrl) return;
    const now = Date.now();
    if (!video.paused && !video.ended && Number.isFinite(video.currentTime)) {
      if (Math.abs(video.currentTime - lastVideoProgressPosition) > 0.15) {
        lastVideoProgressPosition = Number(video.currentTime || 0);
        lastVideoProgressClock = now;
        videoCompatibilityState.lastHealthyAt = now;
        return;
      }
      if (lastVideoProgressClock && (now - lastVideoProgressClock) > 150000) {
        if (videoCompatibilityState.hardReloadCount >= 1) {
          scheduleSkipToNextVideo('bloqueo del video');
        } else {
          const recovered = softRecoverVideoPlayback(video, 'watchdog');
          if (!recovered) {
            videoCompatibilityState.hardReloadCount += 1;
            loadVideoSource(videoCompatibilityState.lastUrl, { preserveTime: true, autoplay: true, forceMuted: true, hardReload: true });
          }
          lastVideoProgressClock = now;
        }
      }
      return;
    }
    if (video.paused && !video.ended && video.readyState >= 2) {
      safePlayVideo(video).then((ok) => {
        if (!ok) primeVideoBuffer('pause');
      }).catch(() => primeVideoBuffer('pause'));
      return;
    }
    if (video.ended && !suppressEndedAutoplay) {
      if (syncedVideoState?.managedByAdmin) return;
      playNextRandomVideo();
    }
  }, 5000);
}

function syncViewportScale() {
  const width = Math.max(window.innerWidth || 0, 320);
  const height = Math.max(window.innerHeight || 0, 320);
  document.documentElement.style.setProperty('--screen-w', `${width}px`);
  document.documentElement.style.setProperty('--screen-h', `${height}px`);
}

function getVoices() {
  cachedVoices = window.speechSynthesis?.getVoices?.() || [];
  return cachedVoices;
}


function normalizeVoiceToken(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function voiceScore(voice, options = {}) {
  const name = normalizeVoiceToken(voice?.name);
  const lang = normalizeVoiceToken(voice?.lang);
  const wantsFemale = options.wantsFemale === true;
  const wantsMale = options.wantsMale === true;
  const femaleHints = options.femaleHints || [];
  const maleHints = options.maleHints || [];
  const preferred = options.preferred || [];
  const preferredLangs = options.preferredLangs || [];

  let score = 0;

  const langRank = preferredLangs.findIndex((item) => lang.startsWith(item));
  if (langRank >= 0) score += 260 - (langRank * 24);
  else if (lang.startsWith('es-pe')) score += 180;
  else if (lang.startsWith('es')) score += 140;
  else if (lang.startsWith('quz') || lang.startsWith('qu')) score += 120;
  else if (lang.startsWith('pt')) score -= 80;
  else if (lang) score -= 120;

  if (/natural|neural|online/.test(name)) score += 80;
  if (/microsoft|google/.test(name)) score += 35;
  if (/desktop/.test(name)) score -= 20;

  preferred.forEach((item, index) => {
    const token = normalizeVoiceToken(item);
    if (!token) return;
    if (name === token) score += 520 - (index * 10);
    else if (name.includes(token)) score += 300 - (index * 6);
  });

  const femaleHit = femaleHints.some((hint) => hint && name.includes(hint));
  const maleHit = maleHints.some((hint) => hint && name.includes(hint));

  if (wantsFemale) {
    if (femaleHit) score += 220;
    if (maleHit) score -= 260;
  } else if (wantsMale) {
    if (maleHit) score += 220;
    if (femaleHit) score -= 260;
  }

  if (voice?.default) score += 25;
  if (/zira|hazel|sabina|dalia|elvira|helena|laura|maria|andrea|monica|sofia|paloma|salome|paulina/.test(name)) score += 120;
  if (/pablo|jorge|raul|alvaro/.test(name)) score -= wantsFemale ? 180 : 0;

  return score;
}

function chooseBestVoice() {
  const voices = getVoices();
  if (!voices.length) return null;

  const preferred = Array.isArray(cfg.preferredVoices) ? cfg.preferredVoices : [];
  const preferredLangs = Array.isArray(cfg.preferredVoiceLangs) ? cfg.preferredVoiceLangs.map(normalizeVoiceToken) : [];
  const femaleHints = Array.isArray(cfg.femaleVoiceHints) ? cfg.femaleVoiceHints.map(normalizeVoiceToken) : [];
  const maleHints = Array.isArray(cfg.maleVoiceHints) ? cfg.maleVoiceHints.map(normalizeVoiceToken) : [];
  const gender = normalizeVoiceToken(cfg.preferredGender);
  const wantsFemale = gender === 'female';
  const wantsMale = gender === 'male';

  const ranked = voices
    .map((voice) => ({
      voice,
      score: voiceScore(voice, { preferred, preferredLangs, femaleHints, maleHints, wantsFemale, wantsMale })
    }))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0]?.voice || null;
  if (best) return best;

  const spanishVoices = voices.filter((voice) => normalizeVoiceToken(voice?.lang).startsWith('es'));
  return spanishVoices[0] || voices[0] || null;
}

function applySpeechSettings(utterance, voice) {
  if (voice && voice.lang) utterance.voice = voice;
  utterance.lang = (voice?.lang && /^es/i.test(String(voice.lang))) ? voice.lang : (cfg.lang || 'es-PE');
  utterance.rate = speechCfg.rate ?? 0.94;
  utterance.pitch = speechCfg.pitch ?? 0.8;
  utterance.volume = Math.max(0, Math.min(1, speechCfg.volume ?? 1));
}

function parseDoctorIdentity(name) {
  const clean = String(name || '').replace(/\s+/g, ' ').trim();
  if (!clean) return { gender: 'unknown', bareName: '', articleTitle: 'su médico' };
  const bareName = clean
    .replace(/^dra\.?\s*/i, '')
    .replace(/^doctora\s*/i, '')
    .replace(/^dr\.?\s*/i, '')
    .replace(/^doctor\s*/i, '')
    .trim();
  const lower = clean.toLowerCase();
  const gender = lower.startsWith('dra.') || lower.startsWith('dra ') || lower.startsWith('doctora')
    ? 'female'
    : lower.startsWith('dr.') || lower.startsWith('dr ') || lower.startsWith('doctor')
      ? 'male'
      : 'unknown';
  return {
    gender,
    bareName: bareName || clean,
    articleTitle: gender === 'female'
      ? `la doctora ${bareName || clean}`
      : gender === 'male'
        ? `el doctor ${bareName || clean}`
        : `su médico ${bareName || clean}`
  };
}
function humanDoctorTitle(name) {
  return parseDoctorIdentity(name).articleTitle;
}


function normalizeDestinationLabel(payload = {}) {
  const raw = String(payload.destinationText || payload.moduleLabel || payload.area || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  if (raw.includes('optometr')) return 'Optometría';
  if (raw.includes('consult')) return 'Consultorio';
  if (raw.includes('exam')) return 'Exámenes';
  if (raw.includes('ipl')) return 'IPL';
  return String(payload.destinationText || payload.moduleLabel || payload.area || 'Módulo').replace(/\s+/g, ' ').trim();
}

function formatAnnouncement(payload) {
  if (payload?.isInternalAnnouncement) {
    let internalMessage = String(payload.announcementText || '').trim();
    if (typeof fixPronunciation === 'function') internalMessage = fixPronunciation(internalMessage);
    return internalMessage.replace(/\s+/g, ' ').trim();
  }
  const template = cfg.callTemplate || '{name} acercarse a {destination}.';
  const destination = normalizeDestinationLabel(payload);
  let message = template
    .replaceAll('{name}', payload.displayName || `${payload.firstName || ''} ${payload.lastName || ''}`.trim())
    .replaceAll('{code}', payload.code || '')
    .replaceAll('{area}', payload.area || 'Módulo')
    .replaceAll('{moduleLabel}', payload.moduleLabel || 'Atención')
    .replaceAll('{destination}', destination)
    .replaceAll('{doctorTitle}', humanDoctorTitle(payload.doctorName))
    .replaceAll('{doctorName}', parseDoctorIdentity(payload.doctorName).bareName || payload.doctorName || 'su médico');
  if (typeof fixPronunciation === 'function') message = fixPronunciation(message);
  return message.replace(/\s+/g, ' ').trim();
}

async function playChime() {
  if (!audioEnabled || !cfg.chimeUrl) return;
  try {
    const audio = new Audio(cfg.chimeUrl);
    audio.volume = 0.85;
    await audio.play();
  } catch (_error) {}
}

function estimateSpeechDurationMs(text) {
  const content = String(text || '').trim();
  if (!content) return 0;
  const words = content.split(/\s+/).filter(Boolean).length;
  return Math.max(2000, words * 430);
}

function waitUntilAnnouncementTime(payload) {
  const target = payload?.announcementAt ? new Date(payload.announcementAt).getTime() : Date.now();
  const delay = Math.max(0, target - Date.now());
  return new Promise((resolve) => window.setTimeout(resolve, delay));
}

function markAnnouncementGuard(ms = 0) {
  announcementGuardUntil = Math.max(announcementGuardUntil || 0, Date.now() + Math.max(0, Number(ms) || 0));
}

function isAnnouncementGuardActive() {
  return Date.now() < (announcementGuardUntil || 0);
}

function getRuntimeVideoAudioTarget() {
  const preferredVolume = getPreferredVideoVolume();
  const preferredMuted = getPreferredVideoMuted();
  if (mediaDuckingDepth > 0) {
    return {
      muted: false,
      volume: clampVideoLevel(cfg.duckingVolume ?? 0.02, 0.02)
    };
  }
  return {
    muted: preferredMuted,
    volume: preferredVolume
  };
}

function enforceVideoAudioState(attempt = 0) {
  const video = elements.waitingVideo;
  if (!video) return;
  const target = getRuntimeVideoAudioTarget();
  applyManagedVideoAudioState(video, { muted: target.muted, volume: target.volume });
  if (!target.muted && attempt < 4) {
    window.setTimeout(() => {
      const retryTarget = getRuntimeVideoAudioTarget();
      applyManagedVideoAudioState(video, { muted: retryTarget.muted, volume: retryTarget.volume });
      enforceVideoAudioState(attempt + 1);
    }, 120 + (attempt * 90));
  }
}


async function speakCall(payload) {
  if (!payload) return;
  if (!audioEnabled) return;

  await waitUntilAnnouncementTime(payload);
  const announcementText = formatAnnouncement(payload);
  const preludeText = typeof cfg.preludeText === 'string' ? cfg.preludeText.trim() : '';
  const repeatCount = Math.max(1, Number(payload?.repeatCount || cfg.repeatCount || 2));
  const speechToken = ++activeSpeechToken;
  markAnnouncementGuard((estimateSpeechDurationMs(formatAnnouncement(payload)) * Math.max(1, Number(payload?.repeatCount || cfg.repeatCount || 2))) + Number(cfg.postSpeechHoldMs || 180) + 2500);
  duckWaitingMedia();

  const fullMessage = [preludeText, announcementText].filter((part) => String(part || '').trim()).join(' ').trim();

  if (!('speechSynthesis' in window)) {
    await playChime();
    const fallbackDuration = estimateSpeechDurationMs(fullMessage) * repeatCount;
    window.setTimeout(() => {
      if (speechToken === activeSpeechToken) restoreWaitingMedia(false);
    }, fallbackDuration + Number(cfg.chimeDelayMs || 0) + 1200);
    return;
  }

  const synth = window.speechSynthesis;
  try { synth.cancel(); } catch {}
  const preferredVoice = chooseBestVoice();
  const segments = [];
  for (let i = 0; i < repeatCount; i += 1) {
    if (preludeText) segments.push(preludeText);
    if (announcementText) segments.push(announcementText);
  }

  let index = 0;
  let restored = false;

  const safeRestore = () => {
    if (restored || speechToken !== activeSpeechToken) return;
    restored = true;
    const waitForFinish = () => {
      if (speechToken !== activeSpeechToken) return;
      if (synth.speaking || synth.pending) {
        window.setTimeout(waitForFinish, 180);
        return;
      }
      restoreWaitingMedia(false);
    };
    window.setTimeout(waitForFinish, Number(cfg.postSpeechHoldMs || 180));
  };

  const speakSegment = (text, allowFallback = true) => new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text);
    applySpeechSettings(utterance, preferredVoice);
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      resolve();
    };
    utterance.onend = finish;
    utterance.onerror = () => {
      if (!allowFallback) {
        finish();
        return;
      }
      try { synth.cancel(); } catch {}
      const fallbackUtterance = new SpeechSynthesisUtterance(text);
      applySpeechSettings(fallbackUtterance, null);
      fallbackUtterance.lang = cfg.lang || 'es-PE';
      fallbackUtterance.onend = finish;
      fallbackUtterance.onerror = finish;
      try {
        synth.speak(fallbackUtterance);
      } catch {
        finish();
      }
    };
    try {
      synth.speak(utterance);
      window.setTimeout(() => {
        if (finished) return;
        if (!synth.speaking && !synth.pending) {
          utterance.onerror?.();
        }
      }, 900);
    } catch {
      utterance.onerror?.();
    }
  });

  const speakNext = async () => {
    if (speechToken !== activeSpeechToken) return;
    if (index >= segments.length) {
      safeRestore();
      return;
    }
    const currentSegment = String(segments[index] || '').trim();
    if (!currentSegment) {
      index += 1;
      window.setTimeout(() => { speakNext().catch(() => safeRestore()); }, Number(cfg.segmentPauseMs || 55));
      return;
    }
    await speakSegment(currentSegment, true);
    index += 1;
    window.setTimeout(() => { speakNext().catch(() => safeRestore()); }, Number(cfg.segmentPauseMs || 55));
  };

  try {
    await playChime();
    window.setTimeout(() => {
      if (speechToken !== activeSpeechToken) return;
      speakNext().catch(() => safeRestore());
    }, Number(cfg.chimeDelayMs || 0));

    const emergencyTimeout = (estimateSpeechDurationMs(fullMessage) * repeatCount) + Number(cfg.chimeDelayMs || 0) + Number(cfg.postSpeechHoldMs || 180) + 6000;
    window.setTimeout(() => safeRestore(), emergencyTimeout);
  } catch {
    safeRestore();
  }
}

async function processAnnouncementQueue() {
  if (isAnnouncementRunning) return;
  if (!announcementQueue.length) return;

  isAnnouncementRunning = true;
  try {
    while (announcementQueue.length) {
      const payload = announcementQueue.shift();
      await speakCall(payload);
      await new Promise((resolve) => window.setTimeout(resolve, Number(cfg.betweenAnnouncementsGapMs || 120)));
      await new Promise((resolve) => {
        const waitForSpeech = () => {
          const synth = window.speechSynthesis;
          if (synth && (synth.speaking || synth.pending)) {
            window.setTimeout(waitForSpeech, 180);
            return;
          }
          window.setTimeout(resolve, Number(cfg.postSpeechHoldMs || 180));
        };
        waitForSpeech();
      });
    }
  } finally {
    isAnnouncementRunning = false;
  }
}

function duckWaitingMedia() {
  const video = elements.waitingVideo;
  if (!video) return;
  if (restoreMediaTimer) {
    clearTimeout(restoreMediaTimer);
    restoreMediaTimer = null;
  }
  if (!mediaRestoreSnapshot) {
    const currentVideoVolume = Number(video.volume);
    const currentVideoMuted = video.muted === true;
    const stableVolume = (mediaDuckingDepth > 0 || (Number.isFinite(currentVideoVolume) && currentVideoVolume <= clampVideoLevel(cfg.duckingVolume ?? 0.04, 0.04) + 0.01))
      ? getPreferredVideoVolume()
      : clampVideoLevel(currentVideoVolume, getPreferredVideoVolume());
    const stableMuted = (mediaDuckingDepth > 0)
      ? getPreferredVideoMuted()
      : currentVideoMuted;
    mediaRestoreSnapshot = {
      volume: stableVolume,
      muted: stableMuted
    };
    video.dataset.prevVolume = String(stableVolume);
    video.dataset.prevMuted = stableMuted ? 'true' : 'false';
  }
  mediaDuckingDepth = 1;
  const duckVolume = clampVideoLevel(cfg.duckingVolume ?? 0.04, 0.04);
  applyManagedVideoAudioState(video, { muted: false, volume: duckVolume });
}

function restoreWaitingMedia(immediate = false) {
  const video = elements.waitingVideo;
  if (!video) return;
  mediaDuckingDepth = 0;
  const restore = () => {
    const snapshotVolume = Number(mediaRestoreSnapshot?.volume);
    const snapshotMuted = mediaRestoreSnapshot?.muted === true;
    const prevVolume = Number(video.dataset.prevVolume);
    const prevMuted = video.dataset.prevMuted === 'true';
    const targetVolume = Number.isFinite(snapshotVolume)
      ? clampVideoLevel(snapshotVolume, cfg.defaultVideoVolume ?? 0.55)
      : (Number.isFinite(prevVolume)
        ? clampVideoLevel(prevVolume, cfg.defaultVideoVolume ?? 0.55)
        : getPreferredVideoVolume());
    const baseMuted = mediaRestoreSnapshot && typeof mediaRestoreSnapshot.muted === 'boolean'
      ? snapshotMuted
      : prevMuted;
    const shouldRemainMuted = audioEnabled === false ? true : baseMuted;
    mediaRestoreSnapshot = null;
    applyManagedVideoAudioState(video, { muted: shouldRemainMuted, volume: targetVolume });
    restoreMediaTimer = null;
    markAnnouncementGuard(1200);
    enforceVideoAudioState(0);
    safePlayVideo(video).catch(() => {});
  };
  if (immediate) return restore();
  restoreMediaTimer = setTimeout(restore, Number(cfg.duckingRestoreDelayMs ?? 180));
}


function locateVideoIndexByUrl(url) {
  return playlistItems.findIndex((item) => item.url === url);
}

function getSafeRemoteTime(video, remoteState = {}) {
  const desiredTime = Number(remoteState.currentTime || 0);
  if (!Number.isFinite(desiredTime) || desiredTime < 0) return null;
  const duration = Number(video?.duration || 0);
  // Evita que una sincronización vieja mande el video al final y provoque reinicios/repeticiones.
  if (Number.isFinite(duration) && duration > 1 && desiredTime >= Math.max(0, duration - 1.2)) return null;
  // Si aún no se conoce la duración, no saltar tiempos exagerados.
  if ((!Number.isFinite(duration) || duration <= 1) && desiredTime > 3600) return null;
  return desiredTime;
}

function applyRemoteVideoState(remoteState = {}) {
  const video = elements.waitingVideo;
  if (!video) return;
  syncedVideoState = remoteState;
  const currentUrl = remoteState.currentVideoUrl || remoteState.url || null;
  if (!currentUrl) return;
  const idx = locateVideoIndexByUrl(currentUrl);
  if (idx >= 0 && currentVideoIndex !== idx) {
    suppressEndedAutoplay = true;
    playVideoAt(idx);
  } else if (!video.currentSrc || !String(video.currentSrc).includes(currentUrl)) {
    suppressEndedAutoplay = true;
    loadVideoSource(currentUrl, { preserveTime: false, autoplay: false, forceMuted: true });
  }
  const desiredTime = getSafeRemoteTime(video, remoteState);
  const drift = desiredTime === null ? 0 : Math.abs((Number(video.currentTime) || 0) - desiredTime);
  const isActivelyPlaying = !video.paused && !video.ended;
  if (desiredTime !== null && ((isActivelyPlaying && drift > 4) || (!isActivelyPlaying && drift > 1.5))) {
    try { video.currentTime = desiredTime; } catch {}
  }
  video.controls = remoteState.controlsVisible === true;
  video.loop = false;
  video.removeAttribute('loop');
  video.playbackRate = Math.max(0.5, Math.min(2, Number(remoteState.playbackRate || 1)));
  const remoteVolume = Number.isFinite(Number(remoteState.volume)) ? Number(remoteState.volume) : getPreferredVideoVolume();
  const runtimeTarget = mediaDuckingDepth > 0
    ? { muted: false, volume: clampVideoLevel(cfg.duckingVolume ?? 0.02, 0.02) }
    : { muted: (remoteState.muted === true || audioEnabled === false), volume: remoteVolume };
  applyManagedVideoAudioState(video, runtimeTarget);
  if (remoteState.isPlaying === false) {
    setPauseRecoverySuppression(1600);
    try { video.pause(); } catch {}
  } else {
    safePlayVideo(video).catch(() => {});
    setTimeout(() => {
      enforceVideoAudioState(0);
    }, mediaDuckingDepth > 0 ? 60 : 200);
  }
  setTimeout(() => { suppressEndedAutoplay = false; }, 1200);
}


function shuffle(array) {
  const clone = [...array];
  for (let i = clone.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [clone[i], clone[j]] = [clone[j], clone[i]];
  }
  return clone;
}

function playVideoAt(index) {
  if (!playlistItems[index]) return;
  currentVideoIndex = index;
  const video = elements.waitingVideo;
  video.controls = syncedVideoState?.controlsVisible === true;
  video.loop = false;
  video.removeAttribute('loop');
  video.playbackRate = Math.max(0.5, Math.min(2, Number(syncedVideoState?.playbackRate || 1)));
  const runtimeTarget = getRuntimeVideoAudioTarget();
  applyManagedVideoAudioState(video, runtimeTarget);
  loadVideoSource(playlistItems[index].url, { preserveTime: false, autoplay: true, forceMuted: runtimeTarget.muted !== false });
  setTimeout(() => {
    enforceVideoAudioState(0);
  }, mediaDuckingDepth > 0 ? 60 : 200);
  elements.playlistStatus.textContent = 'Zona de reproducción';
}

function buildRandomOrder() {
  playlistOrder = shuffle(playlistItems.map((_, index) => index));
}

function playNextSequentialVideo() {
  if (!playlistItems.length) return;
  const nextIndex = currentVideoIndex >= 0
    ? (currentVideoIndex + 1) % playlistItems.length
    : 0;
  playVideoAt(nextIndex);
}

function playNextRandomVideo() {
  if (!playlistItems.length) return;
  if (!playlistOrder.length) buildRandomOrder();
  let nextIndex = playlistOrder.shift();
  // Con 2 o más videos, nunca repetir el mismo video inmediatamente.
  if (playlistItems.length > 1 && nextIndex === currentVideoIndex) {
    if (!playlistOrder.length) buildRandomOrder();
    const alternate = playlistOrder.find((idx) => idx !== currentVideoIndex);
    if (alternate !== undefined) {
      playlistOrder = playlistOrder.filter((idx) => idx !== alternate);
      playlistOrder.unshift(nextIndex);
      nextIndex = alternate;
    } else {
      nextIndex = (currentVideoIndex + 1) % playlistItems.length;
    }
  }
  playVideoAt(nextIndex);
}

function initPlaylist(videos = [], remoteState = null) {
  configureVideoElementForTv();
  playlistItems = videos;
  syncedVideoState = remoteState || null;
  if (!playlistItems.length) {
    elements.playlistStatus.textContent = 'Zona de reproducción';
    setVideoFallback('No hay videos cargados para la sala de espera.');
    return;
  }
  if (syncedVideoState?.currentVideoUrl) {
    applyRemoteVideoState(syncedVideoState);
    return;
  }
  buildRandomOrder();
  playNextRandomVideo();
}

function queueByModule(queue = [], moduleId) {
  return queue.filter((item) => item.moduleId === moduleId).sort(byCodeOrder);
}

function renderStats(queue = []) {
  const waiting = queue.filter((item) => item.status === 'waiting');
  elements.totalWaiting.textContent = waiting.length;
  elements.countOptometria.textContent = queueByModule(waiting, 'optometria').length;
  elements.countExamenes.textContent = queueByModule(waiting, 'examenes').length;
  elements.countConsultorio.textContent = queueByModule(waiting, 'consultorio').length;
  if (elements.countImagenes) elements.countImagenes.textContent = queueByModule(waiting, 'imagenes').length;
  if (elements.countIpl) elements.countIpl.textContent = queueByModule(waiting, 'ipl').length;
  if (elements.countCirugia) elements.countCirugia.textContent = queueByModule(waiting, 'cirugia').length;
}

function renderModules(state) {
  const queue = state.queue || [];
  const waitingQueue = queue.filter((item) => item.status === 'waiting');
  const publicFixedModules = ['optometria', 'consultorio'];
  const conditionalModules = ['ipl', 'cirugia'];
  const modulesToShow = (TURNERO_CONFIG.modules || []).filter((module) => {
    const waiting = queueByModule(waitingQueue, module.id);
    const activeCall = state.currentCalls?.[module.id];
    if (publicFixedModules.includes(module.id)) return true;
    if (conditionalModules.includes(module.id)) return waiting.length > 0 || !!activeCall;
    return waiting.length > 0 || !!activeCall;
  });

  elements.moduleColumns.innerHTML = modulesToShow.map((module) => {
    const waiting = queueByModule(waitingQueue, module.id);
    const activeCall = state.currentCalls?.[module.id];
    const moduleMetrics = state.moduleMetrics?.[module.id] || {};
    return `
      <article class="module-card ${module.id}" data-module="${escapeHtml(module.id)}">
        <div class="module-card-head">
          <div>
            <p>${escapeHtml(module.label)}</p>
            <h4>${escapeHtml(module.room)}</h4>
          </div>
          <span class="module-count">${waiting.length}</span>
        </div>
        <div class="module-live ${activeCall ? 'live' : ''}">
          <span>Último llamado</span>
          <strong>${activeCall ? escapeHtml(activeCall.code) : '---'}</strong>
          <small>${activeCall ? escapeHtml(activeCall.displayName) : 'Sin atención activa'}</small>
          <small>${activeCall ? escapeHtml(activeCall.doctorName || '') : `Prom. atención ${formatSeconds(moduleMetrics.averageAttentionSeconds || 0)}`}</small>
        </div>
        <div class="mini-queue">
          ${waiting.length ? waiting.map((item, idx) => `
            <div class="mini-queue-item">
              <span>${idx + 1}</span>
              <div>
                ${renderAttentionCodeBadge(item.code, item.doctorName, 'mini-code')}
                <small><span class="${item.isReferred || item.referred ? 'referral-name-glow' : ''}">${escapeHtml(item.firstName)} ${escapeHtml(item.lastName)}</span> · ${escapeHtml(item.doctorName || '')}</small>
              </div>
            </div>`).join('') : '<div class="empty-state small">Sin pacientes en espera</div>'}
        </div>
      </article>
    `;
  }).join('');
}

function renderHistory(history = []) {
  if (!history.length) {
    elements.historyList.innerHTML = '<div class="empty-state small">Aún no hay historial de llamados.</div>';
    return;
  }

  elements.historyList.innerHTML = history.slice(0, 12).map((item) => `
    <article class="history-item full-row-history ${item.isReferred || item.referred ? 'referred-history-item' : ''}">
      <div>
        <h4><span class="${item.isReferred || item.referred ? 'referral-name-glow' : ''}">${escapeHtml(item.displayName || `${item.firstName} ${item.lastName}`)}</span></h4>
        <p class="muted">${escapeHtml(item.moduleLabel || getModuleMeta(item.moduleId).label)} · ${escapeHtml(item.area || 'Módulo')} · ${escapeHtml(item.doctorName || '')}</p>
      </div>
      <div class="history-meta">
        ${renderAttentionCodeBadge(item.code, item.doctorName, 'mini-code')}
        <span class="muted">${formatTime(item.calledAt)}</span>
      </div>
    </article>
  `).join('');
}

function renderCurrent(currentCall) {
  if (!currentCall) {
    elements.emptyCall.classList.remove('hidden');
    elements.currentCallContent.classList.add('hidden');
    elements.currentModuleChip.textContent = 'Sin llamado';
    elements.currentModuleChip.className = 'module-chip';
    elements.currentCard.classList.remove('announce');
    elements.currentCard.classList.remove('referred-live');
    if (elements.currentName) elements.currentName.className = '';
    return;
  }

  elements.emptyCall.classList.add('hidden');
  elements.currentCallContent.classList.remove('hidden');
  elements.currentCode.outerHTML = renderAttentionCodeBadge(currentCall.code, currentCall.doctorName, 'code-pill xl').replace('<span ', '<span id="currentCode" ');
  elements.currentCode = document.getElementById('currentCode') || elements.currentCode;
  elements.currentName.textContent = currentCall.displayName || `${currentCall.firstName} ${currentCall.lastName}`;
  elements.currentName.className = currentCall.isReferred || currentCall.referred ? 'referral-name-glow' : '';
  elements.currentArea.textContent = `Pase a: ${currentCall.area} · ${currentCall.doctorName || ''}`;
  elements.currentTime.textContent = `Hora: ${formatTime(currentCall.calledAt)} · Operador: ${currentCall.operatorName || 'Asignado'}`;
  const moduleLabel = currentCall.moduleLabel || getModuleMeta(currentCall.moduleId).label;
  elements.currentModuleText.textContent = moduleLabel;
  elements.currentModuleChip.textContent = moduleLabel;
  elements.currentModuleChip.className = `module-chip ${currentCall.moduleId || ''}`;
  elements.currentCard.classList.toggle('referred-live', Boolean(currentCall.isReferred || currentCall.referred));
}


function render(state) {
  currentState = state;
  const fallbackCurrent = state.currentCall || Object.values(state.currentCalls || {}).filter(Boolean).sort((a, b) => new Date(b.calledAt || 0) - new Date(a.calledAt || 0))[0] || null;
  renderCurrent(fallbackCurrent);
  renderModules(state);
  renderHistory(state.callHistory || []);
  renderStats(state.queue || []);
}

function animateAnnouncement() {
  elements.currentCard.classList.remove('announce');
  void elements.currentCard.offsetWidth;
  elements.currentCard.classList.add('announce');
}

socket.on('state:update', render);
socket.on('patient:called', (payload) => {
  render({
    ...currentState,
    currentCall: payload,
    currentCalls: { ...(currentState?.currentCalls || {}), [payload.moduleId]: payload },
    callHistory: [payload, ...(currentState?.callHistory || [])],
    queue: currentState?.queue || []
  });

  if (payload?.id && payload.calledAt && `${payload.id}-${payload.calledAt}` !== lastAnnouncedId) {
    animateAnnouncement();
    announcementQueue.push(payload);
    processAnnouncementQueue();
    lastAnnouncedId = `${payload.id}-${payload.calledAt}`;
  }
});

socket.on('staff:announcement', (payload = {}) => {
  if (!payload?.id) return;
  const announcementKey = `staff-${payload.id}-${payload.createdAt || ''}`;
  if (announcementKey === lastAnnouncedId) return;
  animateAnnouncement();
  announcementQueue.push({
    ...payload,
    announcementAt: payload.announcementAt || new Date(Date.now() + 500).toISOString(),
    displayName: payload.targetName || 'LLAMADO DE APOYO',
    code: 'APOYO',
    area: payload.message || 'ACERCARSE AL ÁREA SOLICITADA',
    doctorName: payload.originLabel || '',
    moduleId: payload.originModuleId || 'apoyo',
    moduleLabel: 'LLAMADO DE APOYO',
    operatorName: payload.requestedBy || 'SISTEMA',
    calledAt: payload.createdAt || new Date().toISOString(),
    announcementText: payload.announcementText,
    isInternalAnnouncement: true
  });
  processAnnouncementQueue();
  lastAnnouncedId = announcementKey;
});


socket.on('video:sync', (payload) => {
  pendingVideoSyncState = payload || null;
  if (!playlistItems.length) return;
  applyRemoteVideoState(payload || {});
});

if (elements.waitingVideo) {
  configureVideoElementForTv();
  elements.waitingVideo.addEventListener('ended', () => {
    if (isVlcExternalMode()) return;
    if (suppressEndedAutoplay) return;
    if (playlistItems.length <= 1) return;
    if (syncedVideoState?.managedByAdmin) {
      playNextSequentialVideo();
      return;
    }
    playNextRandomVideo();
  });
}

function updateClock() {
  const now = new Date();
  elements.clock.textContent = new Intl.DateTimeFormat('es-PE', {
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).format(now);
  elements.todayDate.textContent = new Intl.DateTimeFormat('es-PE', {
    weekday: 'long', day: '2-digit', month: 'long'
  }).format(now);
}

window.speechSynthesis?.addEventListener?.('voiceschanged', () => {
  getVoices();
  window.setTimeout(getVoices, 120);
  window.setTimeout(getVoices, 650);
});
getVoices();
window.setTimeout(getVoices, 120);
window.setTimeout(getVoices, 300);
window.setTimeout(getVoices, 1200);

(async function init() {
  syncViewportScale();
  window.addEventListener('resize', syncViewportScale);
  configureVideoElementForTv();
  const config = await loadConfig().catch(() => ({ videos: [], videoSyncState: null }));
  initPlaylist(config.videos || [], pendingVideoSyncState || config.videoSyncState || null);
  applyExternalVlcUiMode();
  updateClock();
  setInterval(updateClock, 1000);
  const state = await api('/api/state').catch(() => ({ queue: [], currentCalls: {}, callHistory: [] }));
  render(state);
})();

socket.on('audio:settings', (payload = {}) => {
  audioEnabled = payload.enabled !== false;
  if (Number.isFinite(Number(payload.volume))) {
    const nextVolume = Math.max(0, Math.min(1, Number(payload.volume)));
    syncedVideoState = {
      ...(syncedVideoState || {}),
      volume: nextVolume
    };
    if (!manualVideoAudioState.hasManualPreference) {
      manualVideoAudioState = {
        hasManualPreference: false,
        volume: nextVolume,
        muted: typeof payload.muted === 'boolean' ? payload.muted === true : manualVideoAudioState.muted
      };
    }
  }
  if (typeof payload.muted === 'boolean') {
    syncedVideoState = {
      ...(syncedVideoState || {}),
      muted: payload.muted === true
    };
  }
  if (elements.waitingVideo) {
    enforceVideoAudioState(0);
    safePlayVideo(elements.waitingVideo).catch(() => {});
  }
});

/* =========================================================
   TV FINAL: muestra pacientes registrados/referidos en Optometría y Consultorio.
   Mantiene colores existentes. La lógica de reproducción queda activa para audio.
   ========================================================= */
(function qnFinalTvFix(){
  const VOL_KEY = 'qhali_media_volume_preference_v1';
  function saveMediaVolume(event){
    const video = elements.waitingVideo; if (!video) return;
    if (event && event.isTrusted !== true) return;
    try { localStorage.setItem(VOL_KEY, JSON.stringify({ volume: video.volume })); } catch {}
  }
  function restoreMediaVolume(){
    const video = elements.waitingVideo; if (!video) return;
    try {
      const data = JSON.parse(localStorage.getItem(VOL_KEY) || '{}');
      if (Number.isFinite(Number(data.volume))) video.volume = Math.max(0, Math.min(1, Number(data.volume)));
    } catch {}
  }
  elements.waitingVideo?.addEventListener('volumechange', saveMediaVolume);
  window.setTimeout(restoreMediaVolume, 300);

  function patientVisibleInList(item){
    return ['waiting','called','attended'].includes(String(item.status || '').toLowerCase());
  }
  function miniStatus(item){
    const st = String(item.status || '').toLowerCase();
    if (st === 'called') return 'LLAMANDO';
    if (st === 'attended') return 'PRESENTE';
    if (item.isReferred || item.referred) return 'REFERIDO';
    return 'EN ESPERA';
  }
  renderModules = function qnRenderTvModules(state){
    const queue = state.queue || [];
    const modulesToShow = ['optometria','consultorio'].map(getModuleMeta);
    elements.moduleColumns.innerHTML = modulesToShow.map((module)=>{
      const list = queue.filter((item)=> item.moduleId === module.id && patientVisibleInList(item)).sort(byCodeOrder);
      const activeCall = state.currentCalls?.[module.id] || list.find((p)=>p.status==='called') || null;
      return `<article class="module-card ${module.id}" data-module="${escapeHtml(module.id)}">
        <div class="module-card-head"><div><h4>${escapeHtml(module.room || module.label)}</h4></div></div>
        <div class="mini-queue">
          ${list.length ? list.map((item, idx)=>`<div class="mini-queue-item">
            <span>${idx + 1}</span><div>${renderAttentionCodeBadge(item.code, item.doctorName, 'mini-code')}<small><span class="${item.isReferred || item.referred ? 'referral-name-glow' : ''}">${escapeHtml(item.displayName || `${item.firstName || ''} ${item.lastName || ''}`.trim())}</span> · ${escapeHtml(item.doctorName || miniStatus(item))}</small></div>
          </div>`).join('') : '<div class="empty-state small">Sin pacientes en espera</div>'}
        </div>
        <div class="module-live ${activeCall ? 'live' : ''}"><span>Último llamado</span><strong>${activeCall ? escapeHtml(activeCall.code) : '---'}</strong><small>${activeCall ? escapeHtml(activeCall.displayName || `${activeCall.firstName || ''} ${activeCall.lastName || ''}`.trim()) : 'Sin atención activa'}</small></div>
      </article>`;
    }).join('');
  };
  const oldRenderCurrent = renderCurrent;
  renderCurrent = function(currentCall){
    oldRenderCurrent(currentCall);
    if (!currentCall && elements.currentCard) {
      const title = elements.currentCard.querySelector('.card-title');
      if (title) title.textContent = 'LLAMADO DE PACIENTES';
    }
  };
})();

/* MONITORES TV - títulos limpios solo Optometría y Consultorio */
(function qnTvOnlyTwoListsCleanTitles(){
  function patientVisibleInTv(item){
    return ['waiting','called','attended'].includes(String(item.status || '').toLowerCase());
  }
  function miniStatusTv(item){
    const st = String(item.status || '').toLowerCase();
    if (st === 'called') return 'LLAMANDO';
    if (st === 'attended') return 'PRESENTE';
    if (item.isReferred || item.referred) return 'REFERIDO';
    return 'EN ESPERA';
  }
  renderModules = function qnRenderTvTwoColumns(state){
    const queue = state.queue || [];
    const modulesToShow = ['optometria','consultorio'].map(getModuleMeta);
    elements.moduleColumns.innerHTML = modulesToShow.map((module)=>{
      const list = queue.filter((item)=> item.moduleId === module.id && patientVisibleInTv(item)).sort(byCodeOrder);
      const activeCall = state.currentCalls?.[module.id] || list.find((p)=>p.status==='called') || null;
      const cleanTitle = module.id === 'optometria' ? 'Optometría' : 'Consultorio';
      return `<article class="module-card ${module.id}" data-module="${escapeHtml(module.id)}">
        <div class="module-card-head"><div><h4>${cleanTitle}</h4></div></div>
        <div class="mini-queue">
          ${list.length ? list.map((item, idx)=>`<div class="mini-queue-item">
            <span>${idx + 1}</span><div>${renderAttentionCodeBadge(item.code, item.doctorName, 'mini-code')}<small><span class="${item.isReferred || item.referred ? 'referral-name-glow' : ''}">${escapeHtml(item.displayName || `${item.firstName || ''} ${item.lastName || ''}`.trim())}</span> · ${escapeHtml(item.doctorName || miniStatusTv(item))}</small></div>
          </div>`).join('') : '<div class="empty-state small">Sin pacientes en espera</div>'}
        </div>
        <div class="module-live ${activeCall ? 'live' : ''}"><span>Último llamado</span><strong>${activeCall ? escapeHtml(activeCall.code) : '---'}</strong><small>${activeCall ? escapeHtml(activeCall.displayName || `${activeCall.firstName || ''} ${activeCall.lastName || ''}`.trim()) : 'Sin atención activa'}</small></div>
      </article>`;
    }).join('');
  };
})();

/* TV MONITORES - datos limpios y presentación profesional */
(function qnTvProfessionalHeaderAndCards(){
  const previousRenderCurrent = renderCurrent;
  renderCurrent = function qnRenderCurrentProfessional(currentCall){
    previousRenderCurrent(currentCall);
    const title = elements.currentCard?.querySelector('.card-title');
    if (title) title.textContent = 'LLAMADO DEL PACIENTE';
    if (!currentCall) {
      if (elements.currentModuleChip) elements.currentModuleChip.textContent = 'En espera';
      if (elements.emptyCall) elements.emptyCall.textContent = 'Esperando próximo llamado de paciente.';
      return;
    }
    const moduleLabel = currentCall.moduleLabel || getModuleMeta(currentCall.moduleId).label || 'Módulo';
    const doctor = String(currentCall.doctorName || '').trim();
    if (elements.currentArea) elements.currentArea.textContent = doctor ? `${moduleLabel} · ${doctor}` : moduleLabel;
    if (elements.currentModuleText) elements.currentModuleText.textContent = moduleLabel;
    if (elements.currentTime) elements.currentTime.textContent = `Hora: ${formatTime(currentCall.calledAt)} · Código: ${currentCall.code || ''}`;
  };

  function visibleInMonitor(item){
    return ['waiting','called','attended'].includes(String(item.status || '').toLowerCase());
  }
  function monitorStatus(item){
    const st = String(item.status || '').toLowerCase();
    if (st === 'called') return 'LLAMANDO';
    if (st === 'attended') return 'PRESENTE';
    if (item.isReferred || item.referred) return 'REFERIDO';
    return 'EN ESPERA';
  }
  renderModules = function qnRenderMonitorCardsProfessional(state){
    const queue = Array.isArray(state.queue) ? state.queue : [];
    const modulesToShow = [
      { id: 'optometria', title: 'Optometría' },
      { id: 'consultorio', title: 'Consultorio' }
    ];
    elements.moduleColumns.innerHTML = modulesToShow.map((module)=>{
      const list = queue
        .filter((item)=> item.moduleId === module.id && visibleInMonitor(item))
        .sort(byCodeOrder);
      const activeCall = state.currentCalls?.[module.id] || list.find((p)=> String(p.status || '').toLowerCase() === 'called') || null;
      return `<article class="module-card ${module.id}" data-module="${escapeHtml(module.id)}">
        <div class="module-card-head"><div><h4>${module.title}</h4></div></div>
        <div class="mini-queue">
          ${list.length ? list.map((item, idx)=>{
            const fullName = escapeHtml(item.displayName || `${item.firstName || ''} ${item.lastName || ''}`.trim());
            const detail = escapeHtml(item.doctorName || monitorStatus(item));
            return `<div class="mini-queue-item">
              <span>${idx + 1}</span>
              ${renderAttentionCodeBadge(item.code, item.doctorName, 'mini-code')}
              <small><span class="${item.isReferred || item.referred ? 'referral-name-glow' : ''}">${fullName}</span> · ${detail}</small>
            </div>`;
          }).join('') : '<div class="empty-state small">Sin pacientes en espera</div>'}
        </div>
        <div class="module-live ${activeCall ? 'live' : ''}">
          <span>Último llamado</span>
          <strong>${activeCall ? escapeHtml(activeCall.code) : '---'}</strong>
          <small>${activeCall ? escapeHtml(activeCall.displayName || `${activeCall.firstName || ''} ${activeCall.lastName || ''}`.trim()) : 'Sin atención activa'}</small>
        </div>
      </article>`;
    }).join('');
  };
})();

/* =========================================================
   AJUSTE FINAL TV SOLICITADO - SOLO PANTALLA DE MONITORES
   No toca operador/admin. Corrige distribución, numeración
   solo con registros reales y llamado superior sin montarse.
   ========================================================= */
(function qnTvReferenceLayoutFinal(){
  const MAX_VISIBLE = 10;

  function fullName(item = {}) {
    return String(item.displayName || `${item.firstName || ''} ${item.lastName || ''}`.trim() || 'PACIENTE SIN NOMBRE').trim();
  }

  function visiblePatient(item = {}) {
    const st = String(item.status || '').toLowerCase();
    return ['waiting', 'called', 'attended'].includes(st);
  }

  function datePe(value) {
    const d = value ? new Date(value) : new Date();
    const safe = Number.isNaN(d.getTime()) ? new Date() : d;
    return new Intl.DateTimeFormat('es-PE', { weekday: 'long', day: '2-digit', month: 'long' }).format(safe);
  }

  function moduleTitle(id) {
    return id === 'consultorio' ? 'Consultorio' : 'Optometría';
  }

  function rowHtml(item, index) {
    const code = item.code || '';
    const name = fullName(item);
    const detail = item.moduleId === 'consultorio' && item.doctorName ? ` · ${escapeHtml(item.doctorName)}` : '';
    return `<div class="qn-tv-patient-row ${item.isReferred || item.referred ? 'referred-history-item' : ''}">
      <span class="qn-tv-position">${index + 1}</span>
      ${renderAttentionCodeBadge(code, item.doctorName, 'mini-code')}
      <span class="qn-tv-patient-name ${item.isReferred || item.referred ? 'referral-name-glow' : ''}">${escapeHtml(name)}${detail}</span>
    </div>`;
  }

  renderCurrent = function qnRenderCurrentReference(currentCall) {
    if (!elements.currentCard) return;
    const content = document.getElementById('currentCallContent');
    const empty = document.getElementById('emptyCall');
    const chip = document.getElementById('currentModuleChip');
    const codeHolder = document.getElementById('currentCode');
    const name = document.getElementById('currentName');
    const area = document.getElementById('currentArea');
    const time = document.getElementById('currentTime');
    const date = document.getElementById('todayDate');
    const moduleText = document.getElementById('currentModuleText');

    if (!currentCall) {
      empty?.classList.remove('hidden');
      content?.classList.add('hidden');
      if (chip) chip.textContent = 'Sin llamado';
      elements.currentCard.classList.remove('announce', 'referred-live');
      return;
    }

    empty?.classList.add('hidden');
    content?.classList.remove('hidden');

    const mod = moduleTitle(currentCall.moduleId);
    if (chip) {
      chip.textContent = mod;
      chip.className = `module-chip ${currentCall.moduleId || ''}`;
    }
    if (codeHolder) {
      codeHolder.outerHTML = renderAttentionCodeBadge(currentCall.code || '', currentCall.doctorName, 'attention-code code-pill xl').replace('<span ', '<span id="currentCode" ');
      elements.currentCode = document.getElementById('currentCode') || elements.currentCode;
    }
    if (name) {
      name.textContent = fullName(currentCall);
      name.className = `qn-tv-current-name ${currentCall.isReferred || currentCall.referred ? 'referral-name-glow' : ''}`;
    }
    if (area) area.textContent = currentCall.doctorName ? `${mod} · ${currentCall.doctorName}` : mod;
    if (time) time.textContent = `Hora: ${formatTime(currentCall.calledAt || new Date().toISOString())}`;
    if (date) date.textContent = datePe(currentCall.calledAt || new Date().toISOString());
    if (moduleText) moduleText.textContent = mod;
    elements.currentCard.classList.toggle('referred-live', Boolean(currentCall.isReferred || currentCall.referred));
  };

  renderModules = function qnRenderModulesReference(state = {}) {
    const queue = Array.isArray(state.queue) ? state.queue : [];
    const groups = ['optometria', 'consultorio'].map((id) => {
      const list = queue
        .filter((item) => item.moduleId === id && visiblePatient(item))
        .sort(byCodeOrder)
        .slice(0, MAX_VISIBLE);
      return { id, title: moduleTitle(id), list };
    });

    elements.moduleColumns.innerHTML = groups.map((group) => `<article class="module-card qn-tv-column-card ${group.id}" data-module="${group.id}">
      <h2 class="qn-tv-column-title">${group.title}</h2>
      <div class="qn-tv-patient-list">
        ${group.list.length ? group.list.map(rowHtml).join('') : '<div class="qn-tv-empty-list">Sin pacientes en espera</div>'}
      </div>
    </article>`).join('');
  };

  render = function qnRenderReference(state = {}) {
    currentState = state;
    const fallbackCurrent = state.currentCall || Object.values(state.currentCalls || {})
      .filter(Boolean)
      .sort((a, b) => new Date(b.calledAt || 0) - new Date(a.calledAt || 0))[0] || null;
    renderCurrent(fallbackCurrent);
    renderModules(state);
    renderHistory(state.callHistory || []);
    renderStats(state.queue || []);
  };

  window.setTimeout(() => {
    if (currentState) render(currentState);
  }, 250);
})();
