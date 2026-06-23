const crypto = require('crypto');
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { Server } = require('socket.io');
const { MODULES, normalizeModule, getModuleMeta, getDefaultDoctor } = require('./src/config/modules');
const { createStore } = require('./src/services/fs-store');
const { createSqlService } = require('./src/services/sqlserver');
const { createPostgresService } = require('./src/services/postgres');

const app = express();
app.disable('x-powered-by');
const server = http.createServer(app);
const io = new Server(server, {
  transports: ['websocket', 'polling'],
  allowUpgrades: true,
  perMessageDeflate: false,
  httpCompression: false,
  pingInterval: 10000,
  pingTimeout: 5000
});

const PORT = process.env.PORT || 3000;
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;
server.on('connection', (socket) => {
  try {
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 10000);
  } catch {}
});
const ROOT = __dirname;
const MEDIA_CONFIG_FILE = path.join(ROOT, 'config', 'media.json');
const DEFAULT_VIDEO_DIR = path.join(ROOT, 'public', 'media', 'videos');
function getMediaConfig() {
  const fallback = { videoDirectory: DEFAULT_VIDEO_DIR, randomPlayback: true };
  try {
    if (!fs.existsSync(MEDIA_CONFIG_FILE)) return fallback;
    const parsed = JSON.parse(fs.readFileSync(MEDIA_CONFIG_FILE, 'utf8'));
    return { ...fallback, ...(parsed || {}) };
  } catch {
    return fallback;
  }
}
function resolveVideoDirectory() {
  const cfg = getMediaConfig();
  const rawDir = String(cfg.videoDirectory || '').trim();
  if (!rawDir) return DEFAULT_VIDEO_DIR;
  return path.resolve(path.isAbsolute(rawDir) ? rawDir : path.join(ROOT, rawDir));
}
const VIDEO_DIR = resolveVideoDirectory();
const SAFE_VIDEO_EXTENSIONS = new Set([
  '.mp4', '.m4v', '.mov', '.webm', '.ogv', '.ogg',
  '.mp3', '.wav', '.m4a', '.aac', '.flac', '.opus',
  '.avi', '.mkv', '.wmv', '.mpeg', '.mpg', '.3gp', '.3g2', '.ts', '.m2ts', '.mts', '.vob', '.divx', '.asf'
]);
const HTML5_MEDIA_EXTENSIONS = new Set([
  '.mp4', '.m4v', '.webm', '.ogv', '.ogg',
  '.mp3', '.wav', '.m4a', '.aac', '.opus'
]);
const SQL_CONFIG_FILE = path.join(ROOT, 'config', 'sqlserver.json');
const POSTGRES_CONFIG_FILE = path.join(ROOT, 'config', 'postgresql.json');
const RENIEC_CONFIG_FILE = path.join(ROOT, 'config', 'reniec.json');
const VLC_CONFIG_FILE = path.join(ROOT, 'config', 'vlc.json');
const DOCTORS_DATA_FILE = path.join(ROOT, 'data', 'doctors.json');

const SESSION_COOKIE_NAME = 'qhali_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const LOGIN_WINDOW_MS = 1000 * 60 * 10;
const MAX_LOGIN_ATTEMPTS = 10;
const activeSessions = new Map();
const loginAttemptTracker = new Map();

function hashPassword(password) {
  const normalized = String(password || '');
  return crypto.pbkdf2Sync(normalized, 'qhali-nahui-app-salt-v2', 120000, 64, 'sha512').toString('hex');
}
function isLegacySha256Hash(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}
function verifyPassword(password, user) {
  const incoming = String(password || '');
  const storedHash = String(user?.passwordHash || '').trim();
  if (storedHash) {
    const nextHash = hashPassword(incoming);
    if (storedHash === nextHash) return true;
    if (isLegacySha256Hash(storedHash)) {
      const legacy = crypto.createHash('sha256').update(incoming).digest('hex');
      if (legacy === storedHash) return true;
    }
  }
  return String(user?.password || '').trim() !== '' && String(user.password) === incoming;
}
function sanitizeUser(user) {
  if (!user) return null;
  const { password, passwordHash, sessionToken, ...safe } = user;
  return safe;
}
function normalizeUser(user) {
  const rawPassword = String(user.password || '').trim();
  const passwordHash = user.passwordHash || hashPassword(rawPassword || '1234');
  return {
    id: user.id,
    username: String(user.username || '').trim(),
    passwordHash,
    fullName: String(user.fullName || '').trim(),
    role: String(user.role || 'OPERADOR').trim().toUpperCase(),
    moduleId: user.moduleId ? normalizeModule(user.moduleId) : null,
    doctorName: String(user.doctorName || '').trim(),
    isActive: user.isActive !== false,
    lastLoginAt: user.lastLoginAt || null,
    createdAt: user.createdAt || new Date().toISOString()
  };
}
function parseCookies(req) {
  const raw = String(req.headers.cookie || '');
  const result = {};
  raw.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx <= 0) return;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    result[key] = decodeURIComponent(value);
  });
  return result;
}
function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secure ? '; Secure' : ''}`);
}
function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === 'production';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`);
}
function createSessionForUser(user, req) {
  const token = crypto.randomBytes(32).toString('hex');
  activeSessions.set(token, {
    username: String(user.username || '').toLowerCase(),
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL_MS,
    ip: req.ip,
    userAgent: String(req.headers['user-agent'] || '')
  });
  return token;
}
function getSessionUserFromRequest(req) {
  const headerToken = String(req.headers['x-qhali-session'] || '').trim();
  const ignoreCookie = String(req.headers['x-qhali-ignore-cookie'] || '').trim() === '1';
  const cookies = ignoreCookie ? {} : parseCookies(req);
  const token = headerToken || cookies[SESSION_COOKIE_NAME];
  if (!token) return null;
  const session = activeSessions.get(token);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    activeSessions.delete(token);
    return null;
  }
  const requestUserAgent = String(req.headers['user-agent'] || '');
  const baseSessionAgent = String(session.userAgent || '').split(' ')[0];
  const baseRequestAgent = requestUserAgent.split(' ')[0];
  if (baseSessionAgent && baseRequestAgent && baseSessionAgent !== baseRequestAgent) {
    activeSessions.delete(token);
    return null;
  }
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  const user = readUsers().find((item) => String(item.username || '').toLowerCase() === session.username && item.isActive !== false);
  if (!user) {
    activeSessions.delete(token);
    return null;
  }
  return { token, user };
}
function requireAuth(req, res, next) {
  const sessionInfo = getSessionUserFromRequest(req);
  if (!sessionInfo) return res.status(401).json({ ok: false, message: 'Debe iniciar sesiÃ³n para continuar.' });
  req.auth = sessionInfo;
  return next();
}
function requireRoles(...allowedRoles) {
  const normalized = allowedRoles.map((item) => String(item || '').toUpperCase());
  return (req, res, next) => {
    const role = String(req.auth?.user?.role || '').toUpperCase();
    if (!normalized.includes(role)) return res.status(403).json({ ok: false, message: 'No tiene permisos para esta operaciÃ³n.' });
    return next();
  };
}
function requireModuleScope(req, res, next) {
  const user = req.auth?.user;
  const role = String(user?.role || '').toUpperCase();
  if (role !== 'OPERADOR') return next();
  const moduleId = normalizeModule(req.params.moduleId || req.body?.moduleId || req.body?.targetModuleId || req.query?.moduleId || user.moduleId);
  if (moduleId !== normalizeModule(user.moduleId)) {
    return res.status(403).json({ ok: false, message: 'Su sesiÃ³n no tiene acceso a otro mÃ³dulo.' });
  }
  return next();
}
function getActorUsername(req, fallback = 'sistema') {
  return String(req.auth?.user?.username || fallback).trim();
}
function normalizeTextField(value) {
  return String(value || '').trim().toLocaleUpperCase('es-PE');
}
function registerFailedLogin(key) {
  const now = Date.now();
  const row = loginAttemptTracker.get(key) || { count: 0, firstAt: now, blockedUntil: 0 };
  if ((now - row.firstAt) > LOGIN_WINDOW_MS) {
    row.count = 0;
    row.firstAt = now;
    row.blockedUntil = 0;
  }
  row.count += 1;
  if (row.count >= MAX_LOGIN_ATTEMPTS) row.blockedUntil = now + LOGIN_WINDOW_MS;
  loginAttemptTracker.set(key, row);
  return row;
}
function clearFailedLogin(key) {
  loginAttemptTracker.delete(key);
}
function isLoginBlocked(key) {
  const row = loginAttemptTracker.get(key);
  if (!row) return false;
  if (row.blockedUntil && row.blockedUntil > Date.now()) return true;
  if ((Date.now() - row.firstAt) > LOGIN_WINDOW_MS) {
    loginAttemptTracker.delete(key);
    return false;
  }
  return false;
}

const defaultUsers = [
  normalizeUser({ id: 'USR-001', username: 'admin', password: DEFAULT_ADMIN_PASSWORD, fullName: 'Administrador General', role: 'ADMIN', moduleId: null, doctorName: '', isActive: true, createdAt: '2026-03-12T00:00:00.000Z' }),
  normalizeUser({ id: 'USR-002', username: 'recepcion', password: DEFAULT_ADMIN_PASSWORD, fullName: 'RecepciÃ³n Principal', role: 'RECEPCION', moduleId: null, doctorName: '', isActive: true, createdAt: '2026-03-12T00:00:00.000Z' }),
  normalizeUser({ id: 'USR-003', username: 'optometria1', password: DEFAULT_ADMIN_PASSWORD, fullName: 'Operador OptometrÃ­a 1', role: 'OPERADOR', moduleId: 'optometria', doctorName: getDefaultDoctor('optometria', 0), isActive: true, createdAt: '2026-03-12T00:00:00.000Z' }),
  normalizeUser({ id: 'USR-004', username: 'examenes1', password: DEFAULT_ADMIN_PASSWORD, fullName: 'Operador ExÃ¡menes 1', role: 'OPERADOR', moduleId: 'examenes', doctorName: getDefaultDoctor('examenes', 0), isActive: true, createdAt: '2026-03-12T00:00:00.000Z' }),
  normalizeUser({ id: 'USR-005', username: 'consultorio1', password: DEFAULT_ADMIN_PASSWORD, fullName: 'Operador Consultorio 1', role: 'OPERADOR', moduleId: 'consultorio', doctorName: getDefaultDoctor('consultorio', 0), isActive: true, createdAt: '2026-03-12T00:00:00.000Z' }),
  normalizeUser({ id: 'USR-006', username: 'imagenes1', password: DEFAULT_ADMIN_PASSWORD, fullName: 'Operador ImÃ¡genes 1', role: 'OPERADOR', moduleId: 'imagenes', doctorName: getDefaultDoctor('imagenes', 0), isActive: true, createdAt: '2026-03-12T00:00:00.000Z' }),
  normalizeUser({ id: 'USR-007', username: 'ipl1', password: DEFAULT_ADMIN_PASSWORD, fullName: 'Operador IPL 1', role: 'OPERADOR', moduleId: 'ipl', doctorName: getDefaultDoctor('ipl', 0), isActive: true, createdAt: '2026-03-12T00:00:00.000Z' }),
  normalizeUser({ id: 'USR-008', username: 'cirugia1', password: DEFAULT_ADMIN_PASSWORD, fullName: 'Operador CirugÃ­a 1', role: 'OPERADOR', moduleId: 'cirugia', doctorName: getDefaultDoctor('cirugia', 0), isActive: true, createdAt: '2026-03-12T00:00:00.000Z' })
];

const defaultState = {
  queue: [],
  currentCalls: { optometria: null, examenes: null, consultorio: null, imagenes: null, ipl: null, cirugia: null },
  currentCall: null,
  callHistory: [],
  counters: { optometria: 0, examenes: 0, consultorio: 0, imagenes: 0, ipl: 0, cirugia: 0 },
  audit: [],
  moduleMetrics: {
    optometria: { totalCalls: 0, totalArrivals: 0, averageWaitSeconds: 0, averageAttentionSeconds: 0, lastCallAt: null },
    examenes: { totalCalls: 0, totalArrivals: 0, averageWaitSeconds: 0, averageAttentionSeconds: 0, lastCallAt: null },
    consultorio: { totalCalls: 0, totalArrivals: 0, averageWaitSeconds: 0, averageAttentionSeconds: 0, lastCallAt: null },
    imagenes: { totalCalls: 0, totalArrivals: 0, averageWaitSeconds: 0, averageAttentionSeconds: 0, lastCallAt: null },
    ipl: { totalCalls: 0, totalArrivals: 0, averageWaitSeconds: 0, averageAttentionSeconds: 0, lastCallAt: null },
    cirugia: { totalCalls: 0, totalArrivals: 0, averageWaitSeconds: 0, averageAttentionSeconds: 0, lastCallAt: null }
  },
  settings: {
    clinicName: 'QHALI Ã‘AHUI',
    systemName: 'Sistema ClÃ­nico PRO QHALI REAL',
    ticketPolicy: 'Ticket automÃ¡tico por orden de llegada',
    lookAndFeel: 'Futurista clÃ­nico seguro',
    audioEnabled: true,
    mediaVolume: 0.55,
    mediaMuted: false
  },
  sequences: { patient: 0, call: 0, event: 0 },
  internalAnnouncements: [],
  workDate: localDayKey(),
  updatedAt: new Date().toISOString()
};

function clone(obj) { return JSON.parse(JSON.stringify(obj)); }
function localDayKey(value = new Date()) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
function fullName(person) { return [person.firstName, person.lastName].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim(); }
function diffSeconds(start, end) {
  if (!start || !end) return 0;
  return Math.max(0, Math.round((new Date(end) - new Date(start)) / 1000));
}
function diffMinutes(start, end) {
  if (!start || !end) return 0;
  return Math.max(0, Math.round((new Date(end) - new Date(start)) / 60000));
}

function isSameCalendarDay(left, right = new Date()) {
  if (!left) return false;
  const a = new Date(left);
  const b = new Date(right);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function getPatientSearchStatusWeight(status = '') {
  const normalized = String(status || '').toLowerCase();
  return ({ waiting: 1, called: 2, attended: 3, dilating: 4, absent: 5, referred_out: 6, completed: 7, cancelled: 8 })[normalized] || 99;
}

function normalizeSearchText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('es-PE');
}

function buildPatientDaySearchPool() {
  const bucket = new Map();
  const remember = (item, sourceOrder = 0) => {
    if (!item || !item.id) return;
    const enriched = {
      ...item,
      moduleLabel: getModuleMeta(item.moduleId).label || item.moduleLabel || item.moduleId || '',
      _sourceOrder: sourceOrder
    };
    const previous = bucket.get(item.id);
    if (!previous) {
      bucket.set(item.id, enriched);
      return;
    }
    const previousWeight = getPatientSearchStatusWeight(previous.status);
    const nextWeight = getPatientSearchStatusWeight(enriched.status);
    const previousDate = new Date(previous.updatedAt || previous.completedAt || previous.arrivedAt || previous.calledAt || previous.createdAt || 0).getTime();
    const nextDate = new Date(enriched.updatedAt || enriched.completedAt || enriched.arrivedAt || enriched.calledAt || enriched.createdAt || 0).getTime();
    if (nextWeight < previousWeight || (nextWeight === previousWeight && nextDate >= previousDate)) {
      bucket.set(item.id, { ...previous, ...enriched });
    }
  };

  (state.queue || []).forEach((item) => remember(item, 1));
  Object.values(state.currentCalls || {}).filter(Boolean).forEach((item) => remember(item, 2));
  (state.callHistory || []).forEach((item) => remember(item, 3));
  (state.audit || []).forEach((item) => {
    if (!item?.patientId) return;
    remember({
      id: item.patientId,
      code: item.patientCode,
      firstName: item.patientFirstName,
      lastName: item.patientLastName,
      displayName: item.patientName,
      dni: item.patientDni,
      moduleId: item.moduleId,
      area: item.area || item.moduleLabel,
      doctorName: item.doctorName,
      status: item.completedAt ? 'completed' : item.arrivedAt ? 'attended' : item.calledAt ? 'called' : 'waiting',
      createdAt: item.createdAt || item.calledAt || item.arrivedAt,
      calledAt: item.calledAt || null,
      arrivedAt: item.arrivedAt || null,
      completedAt: item.completedAt || null,
      updatedAt: item.completedAt || item.arrivedAt || item.calledAt || item.createdAt || null,
      isReferred: item.isReferred === true,
      referred: item.isReferred === true
    }, 4);
  });
  return Array.from(bucket.values());
}
function normalizeState(parsed = {}) {
  return {
    ...clone(defaultState),
    ...parsed,
    queue: Array.isArray(parsed.queue) ? parsed.queue.map((item) => ({
      ...item,
      status: ({ en_espera: 'waiting', llamado: 'called', atendido: 'attended', finalizado: 'completed', cancelado: 'cancelled', referido: 'referred_out' }[item.status] || item.status || 'waiting'),
      derivationHistory: Array.isArray(item.derivationHistory) ? item.derivationHistory : [],
      referralNote: String(item.referralNote || item.notes || '').trim()
    })) : [],
    callHistory: Array.isArray(parsed.callHistory) ? parsed.callHistory.slice(0, 50000) : [],
    audit: Array.isArray(parsed.audit) ? parsed.audit.slice(0, 100000) : [],
    currentCalls: { ...clone(defaultState.currentCalls), ...(parsed.currentCalls || {}) },
    counters: { ...clone(defaultState.counters), ...(parsed.counters || {}) },
    moduleMetrics: { ...clone(defaultState.moduleMetrics), ...(parsed.moduleMetrics || {}) },
    settings: { ...clone(defaultState.settings), ...(parsed.settings || {}) },
    sequences: { ...clone(defaultState.sequences), ...(parsed.sequences || {}) },
    internalAnnouncements: Array.isArray(parsed.internalAnnouncements) ? parsed.internalAnnouncements.slice(0, 60) : [],
    workDate: String(parsed.workDate || '').trim() || localDayKey()
  };
}

function dailyRecordDate(item = {}) {
  return item.updatedAt || item.completedAt || item.arrivedAt || item.calledAt || item.announcementAt || item.referredAt || item.createdAt || item.registeredAt || null;
}

function isTodayOperationalRecord(item = {}) {
  return isSameCalendarDay(dailyRecordDate(item));
}

function cleanStateForCurrentWorkday(nextState = {}) {
  const normalized = normalizeState(nextState);
  const today = localDayKey();
  const queue = Array.isArray(normalized.queue) ? normalized.queue : [];
  const callHistory = Array.isArray(normalized.callHistory) ? normalized.callHistory : [];
  const audit = Array.isArray(normalized.audit) ? normalized.audit : [];
  const announcements = Array.isArray(normalized.internalAnnouncements) ? normalized.internalAnnouncements : [];
  const currentCallsEntries = Object.entries(normalized.currentCalls || {});
  const operationalRows = [
    ...queue,
    ...callHistory,
    ...audit,
    ...announcements,
    ...currentCallsEntries.map(([, value]) => value).filter(Boolean),
    normalized.currentCall
  ].filter(Boolean);
  const hasTodayRows = operationalRows.some(isTodayOperationalRecord);
  const hasOldRows = operationalRows.some((item) => !isTodayOperationalRecord(item));
  const savedDate = String(normalized.workDate || '').trim();
  const dateChanged = Boolean(savedDate && savedDate !== today);
  const onlyOldRowsFromLegacyState = !savedDate && hasOldRows && !hasTodayRows;
  const mustResetDailyCounters = dateChanged || onlyOldRowsFromLegacyState;
  let changed = dateChanged || hasOldRows || !savedDate;

  const cleaned = {
    ...normalized,
    queue: queue.filter(isTodayOperationalRecord),
    callHistory: callHistory.filter(isTodayOperationalRecord),
    audit: audit.filter(isTodayOperationalRecord),
    internalAnnouncements: announcements.filter(isTodayOperationalRecord),
    currentCalls: Object.fromEntries(currentCallsEntries.map(([key, value]) => [key, value && isTodayOperationalRecord(value) ? value : null])),
    currentCall: normalized.currentCall && isTodayOperationalRecord(normalized.currentCall) ? normalized.currentCall : null,
    counters: mustResetDailyCounters ? clone(defaultState.counters) : normalized.counters,
    workDate: today,
    updatedAt: new Date().toISOString()
  };
  cleaned.moduleMetrics = Object.fromEntries(Object.keys(defaultState.moduleMetrics).map((moduleId) => [
    moduleId,
    summarizeModuleMetrics(cleaned.audit, moduleId)
  ]));
  syncCurrentCallFromModulesForState(cleaned);

  if (
    cleaned.queue.length !== queue.length ||
    cleaned.callHistory.length !== callHistory.length ||
    cleaned.audit.length !== audit.length ||
    cleaned.internalAnnouncements.length !== announcements.length
  ) changed = true;

  return { state: cleaned, changed };
}

function syncCurrentCallFromModulesForState(targetState = state) {
  const activeCalls = Object.values(targetState.currentCalls || {}).filter(Boolean).sort((a, b) => new Date(b.calledAt || 0) - new Date(a.calledAt || 0));
  targetState.currentCall = activeCalls[0] || null;
  return targetState.currentCall;
}

const store = createStore(ROOT, { defaultState, defaultUsers, normalizeState, normalizeUser });
const pgProbeConfig = (() => { try { return JSON.parse(fs.readFileSync(POSTGRES_CONFIG_FILE, 'utf8')); } catch { return { enabled:false }; } })();
const sqlService = pgProbeConfig.enabled === true ? createPostgresService(POSTGRES_CONFIG_FILE) : createSqlService(SQL_CONFIG_FILE);
const sqlServerProbeService = createSqlService(SQL_CONFIG_FILE);

const CONSULTORIO_BASELINE_DOCTORS = [
  { name: 'ESPINOZA HUMAREDA IVAN', specialty: 'CATARATA', enabled: true, order: 1 },
  { name: 'JUAN CARLOS MARTÃNEZ QUIJANDRIA', specialty: 'CATARATA', enabled: true, order: 2 },
  { name: 'JUAN ALBERTO GISMONDI ALEGRE', specialty: 'VIA LAGRIMAL', enabled: true, order: 3 },
  { name: 'MARIO NICOLAS BECERRA', specialty: 'GLAUCOMA', enabled: true, order: 4 },
  { name: 'FERNANDO RAMON OTRERAS', specialty: 'RETINA', enabled: true, order: 5 },
  { name: 'MARY ESTEFANIA ESCOBAR LOPEZ', specialty: 'OFTALMOLOGIA GENERAL', enabled: true, order: 6 },
  { name: 'EDWARD VALDERRAMA GUEVARA', specialty: 'OFTALMOLOGIA GENERAL', enabled: true, order: 7 },
  { name: 'YORDALIS RODRIGUEZ CARBALLO', specialty: 'OFTALMOLOGIA GENERAL', enabled: true, order: 8 },
  { name: 'ANTHONY MARTINEZ APAZA', specialty: 'CORNEA', enabled: true, order: 9 },
  { name: 'ILSE LOPEZ', specialty: 'CORNEA', enabled: true, order: 10 }
];

function isLegacyConsultorioDoctorName(name = '') {
  return /^M[Ã‰E]DICO\s+\d+$/i.test(normalizeTextField(name));
}

function normalizeDoctorRow(row = {}, idx = 0, moduleIdFallback = 'consultorio') {
  const moduleId = normalizeModule(row.moduleId || row.id_modulo || moduleIdFallback || 'consultorio');
  const name = normalizeTextField(row.name || row.nombre || row.nombre_medico || row.doctorName || `MÃ‰DICO ${idx + 1}`);
  return {
    id: String(row.id || `${moduleId}-${name}`).replace(/\s+/g, '-'),
    moduleId,
    name,
    specialty: normalizeTextField(row.specialty || row.especialidad || getModuleMeta(moduleId).label || 'CONSULTORIO'),
    enabled: row.enabled !== false && row.disponible !== false,
    order: Number(row.order || row.orden || idx + 1) || (idx + 1),
    createdAt: row.createdAt || new Date().toISOString()
  };
}
function defaultDoctorsRows() {
  const rows = [];
  Object.values(MODULES).forEach((module) => {
    (module.doctors || []).forEach((name, idx) => rows.push(normalizeDoctorRow({ moduleId: module.id, name, specialty: module.label, enabled: true, order: idx + 1 }, idx, module.id)));
  });
  return rows;
}
function readDoctorsData() {
  try {
    if (!fs.existsSync(DOCTORS_DATA_FILE)) {
      const defaults = defaultDoctorsRows();
      fs.mkdirSync(path.dirname(DOCTORS_DATA_FILE), { recursive: true });
      fs.writeFileSync(DOCTORS_DATA_FILE, JSON.stringify(defaults, null, 2), 'utf8');
      return defaults;
    }
    const parsed = JSON.parse(fs.readFileSync(DOCTORS_DATA_FILE, 'utf8'));
    const rows = Array.isArray(parsed) ? parsed : [];
    const normalizedRows = rows.map((row, idx) => normalizeDoctorRow(row, idx, row.moduleId || 'consultorio'));
    const consultorioRows = normalizedRows.filter((row) => row.moduleId === 'consultorio');
    const onlyLegacyConsultorio = consultorioRows.length > 0 && consultorioRows.every((row) => isLegacyConsultorioDoctorName(row.name));
    if (consultorioRows.length === 0 || onlyLegacyConsultorio) {
      const migrated = normalizedRows.filter((row) => row.moduleId !== 'consultorio');
      CONSULTORIO_BASELINE_DOCTORS.forEach((doctor, idx) => {
        migrated.push(normalizeDoctorRow({ moduleId: 'consultorio', ...doctor }, idx, 'consultorio'));
      });
      return saveDoctorsData(migrated);
    }
    return normalizedRows;
  } catch {
    return defaultDoctorsRows();
  }
}
function saveDoctorsData(rows = []) {
  const clean = rows.map((row, idx) => normalizeDoctorRow(row, idx, row.moduleId || 'consultorio'));
  fs.mkdirSync(path.dirname(DOCTORS_DATA_FILE), { recursive: true });
  fs.writeFileSync(DOCTORS_DATA_FILE, JSON.stringify(clean, null, 2), 'utf8');
  return clean;
}
function getEnabledDoctorsByModule(moduleId) {
  const normalized = normalizeModule(moduleId);
  return readDoctorsData()
    .filter((row) => row.moduleId === normalized && row.enabled !== false)
    .sort((a, b) => (a.order || 999) - (b.order || 999))
    .map((row) => row.name);
}
function isEnabledDoctorName(moduleId, name = '') {
  const needle = normalizeSearchText(name);
  return getEnabledDoctorsByModule(moduleId).some((doctor) => normalizeSearchText(doctor) === needle);
}
function getEnabledDoctorRow(moduleId, name = '') {
  const needle = normalizeSearchText(name);
  return readDoctorsData()
    .filter((row) => row.moduleId === normalizeModule(moduleId) && row.enabled !== false)
    .find((row) => normalizeSearchText(row.name) === needle) || null;
}
function formatDoctorCareLabel(patient = {}) {
  if (!patient?.doctorName) return '';
  if (normalizeModule(patient.moduleId) !== 'consultorio') return patient.doctorName;
  const doctor = getEnabledDoctorRow('consultorio', patient.doctorName);
  const specialty = normalizeTextField(doctor?.specialty || patient.doctorSpecialty || patient.referralSpecialty || '');
  if (normalizeSearchText(specialty).includes('general')) return `MÃ©dico oftalmÃ³logo: ${patient.doctorName}`;
  return specialty ? `MÃ©dico oftalmÃ³logo ${specialty}: ${patient.doctorName}` : `MÃ©dico oftalmÃ³logo: ${patient.doctorName}`;
}
function enrichPatientForClient(item = {}) {
  if (!item || typeof item !== 'object') return item;
  const doctor = item.doctorName ? getEnabledDoctorRow(item.moduleId, item.doctorName) : null;
  const next = { ...item, doctorSpecialty: item.doctorSpecialty || doctor?.specialty || '' };
  next.doctorCareLabel = item.doctorCareLabel || formatDoctorCareLabel(next);
  return next;
}

function isConsultorioModuleValue(value = '') {
  const raw = normalizeSearchText(value);
  return ['3', 'consultorio', 'consultorios', 'consultorio1'].includes(raw);
}

function referralOriginDoctorName(patient = {}) {
  const direct = normalizeTextField(patient.referralOriginDoctorName || '');
  if (direct && getEnabledDoctorRow('consultorio', direct)) return getEnabledDoctorRow('consultorio', direct).name;
  const history = Array.isArray(patient.derivationHistory) ? patient.derivationHistory : [];
  const fromConsultorio = history.find((row) => isConsultorioModuleValue(row?.fromModuleId || '') && getEnabledDoctorRow('consultorio', row?.fromDoctorName || row?.doctorName || ''));
  const historyDoctor = normalizeTextField(fromConsultorio?.fromDoctorName || fromConsultorio?.doctorName || '');
  if (historyDoctor) return getEnabledDoctorRow('consultorio', historyDoctor)?.name || historyDoctor;
  return direct;
}

function isOptometryReferralFromConsultorio(patient = {}) {
  if (normalizeModule(patient.moduleId) !== 'optometria') return false;
  if (isConsultorioModuleValue(patient.referralOriginModuleId || '')) return true;
  return Boolean(referralOriginDoctorName(patient));
}

function consultorioPatientCategory(patient = {}) {
  const raw = normalizeSearchText(`${patient.referralSpecialty || ''} ${patient.doctorName || ''} ${patient.area || ''}`);
  if (raw.includes('control')) return 'controles';
  if (raw.includes('nuevo') || raw.includes('oftalmologia general') || raw.includes('general')) return 'nuevo';
  return 'especialidad';
}
function consultorioDoctorGroup(doctor = {}) {
  const raw = normalizeSearchText(`${doctor.name || ''} ${doctor.specialty || ''}`);
  if (
    raw.includes('especialista') ||
    raw.includes('glaucoma') ||
    raw.includes('retina') ||
    raw.includes('cornea') ||
    raw.includes('lagrimal') ||
    raw.includes('catarata') ||
    raw.includes('refractiva')
  ) return 'especialista';
  return 'general';
}
function isConsultorioDoctorAllowedForPatient(patient = {}, doctorName = '') {
  if (normalizeModule(patient.moduleId) !== 'consultorio') return true;
  const doctor = getEnabledDoctorRow('consultorio', doctorName);
  if (!doctor) return false;
  const category = consultorioPatientCategory(patient);
  const group = consultorioDoctorGroup(doctor);
  if (category === 'especialidad') return group === 'especialista';
  return group === 'general';
}
function pickRandomEnabledDoctor(moduleId = 'consultorio') {
  const doctors = getEnabledDoctorsByModule(moduleId);
  return doctors[Math.floor(Math.random() * doctors.length)] || '';
}

for (const dir of [VIDEO_DIR]) if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
function mergeEssentialUsers(users = []) {
  const byUsername = new Map((users || []).map((user) => [String(user.username || '').trim().toLowerCase(), normalizeUser(user)]));
  for (const seed of defaultUsers) {
    const key = String(seed.username || '').trim().toLowerCase();
    if (!byUsername.has(key)) {
      byUsername.set(key, normalizeUser(seed));
      continue;
    }
    const current = byUsername.get(key);
    byUsername.set(key, normalizeUser({
      ...seed,
      ...current,
      role: current.role || seed.role,
      moduleId: current.role === 'OPERADOR' ? normalizeModule(current.moduleId || seed.moduleId) : null,
      doctorName: String(current.doctorName || '').trim() || (current.role === 'OPERADOR' ? seed.doctorName : ''),
      isActive: current.isActive !== false
    }));
  }
  return Array.from(byUsername.values()).sort((a, b) => String(a.id || '').localeCompare(String(b.id || '')));
}

store.ensureFiles();
let storedUsers = mergeEssentialUsers((store.readUsers() || []).map(normalizeUser));
store.saveUsers(storedUsers);
const initialDailyState = cleanStateForCurrentWorkday(store.readState());
let state = initialDailyState.changed ? store.saveState(initialDailyState.state) : initialDailyState.state;
let videoSyncState = {
  managedByAdmin: false,
  currentVideoUrl: null,
  currentVideoName: null,
  currentTime: 0,
  isPlaying: true,
  volume: Math.max(0, Math.min(1, Number(state.settings?.mediaVolume ?? 0.55))),
  muted: state.settings?.mediaMuted === true,
  playbackRate: 1,
  loop: false,
  controlsVisible: false,
  engine: getDesiredVideoEngine(),
  updatedAt: new Date().toISOString()
};

function getEffectiveVideoSyncState(baseState = videoSyncState, now = Date.now()) {
  const safeBase = { ...(baseState || {}) };
  const updatedAtMs = safeBase.updatedAt ? new Date(safeBase.updatedAt).getTime() : now;
  const playbackRate = Math.max(0.5, Math.min(2, Number(safeBase.playbackRate || 1)));
  const elapsedSeconds = safeBase.isPlaying !== false && Number.isFinite(updatedAtMs)
    ? Math.max(0, (now - updatedAtMs) / 1000) * playbackRate
    : 0;
  return {
    ...safeBase,
    engine: safeBase.engine || getDesiredVideoEngine(),
    currentTime: Math.max(0, Number(safeBase.currentTime || 0) + elapsedSeconds)
  };
}
function freezeVideoSyncState() {
  videoSyncState = {
    ...getEffectiveVideoSyncState(videoSyncState),
    updatedAt: new Date().toISOString()
  };
  return videoSyncState;
}
function broadcastVideoState() { io.emit('video:sync', getEffectiveVideoSyncState(videoSyncState)); }

function buildClientStateSnapshot() {
  ensureActiveWorkday();
  const enrich = (item) => enrichPatientForClient(item);
  const queue = Array.isArray(state.queue) ? state.queue.slice(-10000).map(enrich) : [];
  const callHistory = Array.isArray(state.callHistory) ? state.callHistory.slice(0, 200).map(enrich) : [];
  const audit = Array.isArray(state.audit) ? state.audit.slice(0, 5000) : [];
  const currentCalls = Object.fromEntries(Object.entries(state.currentCalls || {}).map(([key, value]) => [key, value ? enrich(value) : value]));
  return {
    queue,
    currentCalls,
    currentCall: state.currentCall ? enrich(state.currentCall) : null,
    callHistory,
    audit,
    counters: state.counters || {},
    moduleMetrics: state.moduleMetrics || {},
    settings: state.settings || {},
    internalAnnouncements: state.internalAnnouncements || [],
    workDate: state.workDate,
    updatedAt: state.updatedAt
  };
}
let diagnosticsCache = { value: null, at: 0 };
function invalidateDiagnosticsCache() { diagnosticsCache = { value: null, at: 0 }; }
async function getDiagnosticsCached() {
  const now = Date.now();
  if (diagnosticsCache.value && (now - diagnosticsCache.at) < 10000) return diagnosticsCache.value;
  const value = await getDiagnostics();
  diagnosticsCache = { value, at: now };
  return value;
}

function saveUsers(nextUsers) {
  storedUsers = nextUsers.map(normalizeUser);
  store.saveUsers(storedUsers);
  return storedUsers;
}
function readUsers() {
  return storedUsers.map((user) => ({ ...user }));
}
function saveState(nextState) {
  state = store.saveState(nextState);
  return state;
}
function ensureActiveWorkday() {
  const result = cleanStateForCurrentWorkday(state);
  if (!result.changed) return false;
  state = store.saveState(result.state);
  return true;
}
let stateEmitTimer = null;
let lastStateEmitAt = 0;
function emitStateNow() {
  lastStateEmitAt = Date.now();
  io.emit('state:update', buildClientStateSnapshot());
}
function broadcastState(force = false) {
  if (force) {
    if (stateEmitTimer) {
      clearTimeout(stateEmitTimer);
      stateEmitTimer = null;
    }
    emitStateNow();
    return;
  }
  const elapsed = Date.now() - lastStateEmitAt;
  if (elapsed > 45) {
    emitStateNow();
    return;
  }
  if (stateEmitTimer) return;
  stateEmitTimer = setTimeout(() => {
    stateEmitTimer = null;
    emitStateNow();
  }, 45);
}
let sqlQueue = Promise.resolve();
function deferSqlWork(label, work) {
  sqlQueue = sqlQueue
    .then(() => new Promise((resolve) => setTimeout(resolve, 0)))
    .then(() => work())
    .catch((error) => console.error(`[QHALI SQL ${label}]`, error?.message || error));
  return sqlQueue;
}
async function withTimeout(promiseFactory, timeoutMs, fallbackValue) {
  let timer = null;
  try {
    return await Promise.race([
      Promise.resolve().then(promiseFactory),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(fallbackValue), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
function asyncRoute(handler) { return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next); }
function normalizeHumanName(name) { return String(name || '').replace(/\s+/g, ' ').trim(); }
function normalizeDni(value) { return String(value || '').replace(/\D/g, '').trim(); }
function sameDateKey(value) { return String(value || '').slice(0, 10); }
function readJsonFile(file, fallback = {}) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}
function getReniecConfig() {
  const fallback = { enabled: false, provider: 'apisperu', token: '', timeoutMs: 12000, providers: {} };
  const cfg = readJsonFile(RENIEC_CONFIG_FILE, fallback);
  const merged = { ...fallback, ...cfg, providers: { ...(fallback.providers || {}), ...(cfg.providers || {}) } };
  if (process.env.RENIEC_TOKEN) merged.token = process.env.RENIEC_TOKEN;
  if (process.env.RENIEC_ENABLED !== undefined) merged.enabled = String(process.env.RENIEC_ENABLED).toLowerCase() === 'true';
  return merged;
}
function replaceRequestPlaceholders(value, replacements = {}) {
  return Object.entries(replacements).reduce((acc, [key, replacement]) => {
    return acc.replaceAll(`{${key}}`, String(replacement ?? ''));
  }, String(value || ''));
}
function buildReniecRequest(provider, cfg, cleanDni) {
  const replacements = { dni: cleanDni, numero: cleanDni, token: cfg.token || '' };
  const rawUrl = replaceRequestPlaceholders(provider.baseUrl || '', replacements);
  const url = new URL(rawUrl);
  const query = provider.query || provider.queryParams || {};
  Object.entries(query).forEach(([key, value]) => {
    url.searchParams.set(key, replaceRequestPlaceholders(value, replacements));
  });
  const headers = Object.fromEntries(
    Object.entries(provider.headers || {}).map(([key, value]) => [key, replaceRequestPlaceholders(value, replacements)])
  );
  return { url: url.toString(), headers };
}


function getVlcConfig() {
  const fallback = {
    enabled: false,
    host: '127.0.0.1',
    port: 8081,
    password: process.env.VLC_PASSWORD || '',
    autoStart: false,
    executablePath: process.env.VLC_PATH || '',
    extraArgs: [],
    windowTitle: 'Qhali VLC Pro',
    preferredFullscreen: true
  };
  const cfg = readJsonFile(VLC_CONFIG_FILE, fallback);
  return {
    ...fallback,
    ...(cfg || {}),
    extraArgs: Array.isArray(cfg?.extraArgs) ? cfg.extraArgs : fallback.extraArgs
  };
}

let vlcProcess = null;
let vlcAutoStartAttemptedAt = 0;

function normalizeHttpMediaUrl(urlPath = '') {
  const basePort = Number(PORT) || 3000;
  if (/^https?:\/\//i.test(String(urlPath || '').trim())) return String(urlPath || '').trim();
  const normalized = String(urlPath || '').startsWith('/') ? String(urlPath || '') : `/${String(urlPath || '').replace(/^\/+/, '')}`;
  return `http://127.0.0.1:${basePort}${normalized}`;
}

function buildVlcStatusUrl(command = '', params = {}) {
  const cfg = getVlcConfig();
  const url = new URL(`http://${cfg.host}:${cfg.port}/requests/status.json`);
  if (command) url.searchParams.set('command', command);
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    url.searchParams.set(key, String(value));
  });
  return url;
}

function vlcAuthorizationHeader() {
  const cfg = getVlcConfig();
  const raw = Buffer.from(`:${cfg.password || ''}`).toString('base64');
  return `Basic ${raw}`;
}

async function callVlc(command = '', params = {}) {
  const cfg = getVlcConfig();
  if (!cfg.enabled) return { ok: false, disabled: true, message: 'La integraciÃ³n VLC estÃ¡ desactivada en config/vlc.json.' };
  const url = buildVlcStatusUrl(command, params);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Authorization: vlcAuthorizationHeader() }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { ok: false, status: response.status, data, message: data?.error || 'VLC respondiÃ³ con error.' };
    }
    return { ok: true, data };
  } catch (error) {
    return { ok: false, message: error.message };
  }
}

function resolveVlcExecutable() {
  const cfg = getVlcConfig();
  const candidates = [
    cfg.executablePath,
    process.env.VLC_PATH,
    'C:\Program Files\VideoLAN\VLC\vlc.exe',
    'C:\Program Files (x86)\VideoLAN\VLC\vlc.exe'
  ].filter(Boolean);
  return candidates.find((candidate) => {
    try { return fs.existsSync(candidate); } catch { return false; }
  }) || null;
}

function spawnVlcForTurnero() {
  const cfg = getVlcConfig();
  if (!cfg.enabled || !cfg.autoStart) return { ok: false, message: 'VLC autoStart estÃ¡ desactivado.' };
  if (vlcProcess && !vlcProcess.killed) return { ok: true, alreadyRunning: true };
  const executable = resolveVlcExecutable();
  if (!executable) return { ok: false, message: 'No se encontrÃ³ vlc.exe. Configure executablePath en config/vlc.json.' };

  const args = [
    '--extraintf=http',
    '--http-host', String(cfg.host || '127.0.0.1'),
    '--http-port', String(cfg.port || 8081),
    '--http-password', String(cfg.password || ''),
    '--network-caching=250',
    '--file-caching=250',
    '--disc-caching=250',
    '--no-video-title-show',
    '--qt-minimal-view',
    '--no-embedded-video',
    '--one-instance',
    '--playlist-autostart'
  ];
  if (cfg.preferredFullscreen !== false) args.push('--fullscreen');
  if (Array.isArray(cfg.extraArgs) && cfg.extraArgs.length) args.push(...cfg.extraArgs.map((item) => String(item)));
  try {
    vlcProcess = spawn(executable, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: false
    });
    vlcProcess.unref();
    vlcAutoStartAttemptedAt = Date.now();
    return { ok: true, started: true, executable };
  } catch (error) {
    return { ok: false, message: error.message };
  }
}

async function ensureVlcReady() {
  const cfg = getVlcConfig();
  if (!cfg.enabled) return { ok: false, disabled: true, message: 'VLC desactivado.' };
  let status = await callVlc();
  if (status.ok) return status;
  const now = Date.now();
  if (cfg.autoStart && (now - vlcAutoStartAttemptedAt) > 12000) {
    spawnVlcForTurnero();
    await new Promise((resolve) => setTimeout(resolve, 2200));
    status = await callVlc();
    if (status.ok) return status;
  }
  return status;
}

function getDesiredVideoEngine() {
  const cfg = getVlcConfig();
  const preferred = String(cfg.defaultEngine || 'html5').trim().toLowerCase();
  if (preferred === 'vlc_external' && cfg.enabled === true) return 'vlc_external';
  return 'html5';
}

async function syncVlcWithVideoState(nextState = videoSyncState) {
  const cfg = getVlcConfig();
  if (cfg.enabled !== true) return { ok: false, skipped: true, message: 'VLC no estÃ¡ activo.' };
  const effective = getEffectiveVideoSyncState(nextState);
  const ready = await ensureVlcReady();
  if (!ready.ok) return ready;

  const desiredUrl = normalizeHttpMediaUrl(effective.currentVideoUrl || '');
  const status = ready.data || {};
  const currentInfo = status.information?.category?.meta || {};
  const currentFilename = String(currentInfo.filename || '');
  const desiredFilename = decodeURIComponent(String((effective.currentVideoUrl || '').split('/').pop() || ''));
  const currentVolumePercent = Math.max(0, Math.min(100, Math.round(Number(effective.volume || 0) * 100)));

  if (desiredUrl && currentFilename !== desiredFilename) {
    const playResult = await callVlc('in_play', { input: desiredUrl });
    if (!playResult.ok) return playResult;
    if (effective.currentTime > 0.5) {
      await callVlc('seek', { val: Math.floor(Number(effective.currentTime || 0)) });
    }
  } else if (effective.currentTime > 0.5 && desiredUrl) {
    await callVlc('seek', { val: Math.floor(Number(effective.currentTime || 0)) });
  }

  if (effective.isPlaying === false) {
    const fresh = await callVlc();
    if (fresh.ok && fresh.data?.state === 'playing') await callVlc('pl_pause');
  } else {
    const fresh = await callVlc();
    if (fresh.ok && fresh.data?.state !== 'playing') await callVlc('pl_play');
  }

  await callVlc('volume', { val: effective.muted === true ? 0 : currentVolumePercent });
  return { ok: true, engine: 'vlc_external', currentVideoUrl: effective.currentVideoUrl };
}

function getDoctorsByModule(moduleId) {
  const module = getModuleMeta(moduleId);
  const configured = readDoctorsData()
    .filter((row) => row.moduleId === module.id && row.enabled !== false)
    .sort((a, b) => (a.order || 999) - (b.order || 999))
    .map((row) => row.name);
  return [...new Set(configured)];
}
function getModulesForClient() {
  return Object.values(MODULES).filter((module) => module.hiddenFromClient !== true).map((module) => ({ ...module, doctors: getDoctorsByModule(module.id) }));
}
function validateDni(dni) {
  return /^\d{8}$/.test(normalizeDni(dni));
}
function findPatientsByDniToday(dni, { excludePatientId = null, moduleId = null, includeCompleted = true, includeReferredOut = true } = {}) {
  const cleanDni = normalizeDni(dni);
  const today = sameDateKey(new Date().toISOString());
  return (state.queue || []).filter((item) => {
    if (normalizeDni(item.dni) !== cleanDni) return false;
    if (sameDateKey(item.createdAt) !== today) return false;
    if (item.id === excludePatientId) return false;
    if (moduleId && normalizeModule(item.moduleId) !== normalizeModule(moduleId)) return false;
    const status = String(item.status || '').toLowerCase();
    if (status === 'cancelled') return false;
    if (!includeCompleted && status === 'completed') return false;
    if (!includeReferredOut && status === 'referred_out') return false;
    return true;
  }).sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
}
function findPatientByDniToday(dni, { excludePatientId = null } = {}) {
  const matches = findPatientsByDniToday(dni, { excludePatientId, includeCompleted: true, includeReferredOut: true });
  if (!matches.length) return null;
  return matches.find((item) => item.isReferred !== true && item.referred !== true) || matches[0] || null;
}
function findPatientInModuleByDniToday(dni, moduleId, { excludePatientId = null, includeCompleted = true } = {}) {
  const matches = findPatientsByDniToday(dni, { excludePatientId, moduleId, includeCompleted, includeReferredOut: false });
  if (!matches.length) return null;
  return matches[0] || null;
}
function isOpenPatientStatus(status = '') {
  return ['waiting', 'called', 'attended', 'absent', 'dilating', 'referred_out'].includes(String(status || '').toLowerCase());
}
function findOpenPatientByDniToday(dni, { excludePatientId = null } = {}) {
  return findPatientsByDniToday(dni, { excludePatientId, includeCompleted: false, includeReferredOut: true })
    .find((item) => isOpenPatientStatus(item.status)) || null;
}
function ensurePersisted(result, fallbackMessage = 'No se pudo persistir en SQL Server.') {
  if (result?.persisted || result?.ok || result?.patient) return result || {};
  const reason = String(result?.reason || '').trim();
  if (reason) console.error('[QHALI SQL]', reason);
  return { ...(result || {}), persisted: false, warning: reason || fallbackMessage };
}
async function lookupReniecByDni(dni) {
  const cleanDni = normalizeDni(dni);
  if (!validateDni(cleanDni)) {
    return { ok: false, status: 400, message: 'El DNI debe tener 8 dÃ­gitos.' };
  }
  const cfg = getReniecConfig();
  if (!cfg.enabled) {
    return { ok: false, status: 503, message: 'La integraciÃ³n RENIEC estÃ¡ desactivada en config/reniec.json.' };
  }
  const provider = (cfg.providers || {})[cfg.provider];
  if (!provider?.baseUrl || !cfg.token || String(cfg.token).includes('PEGAR_TOKEN_AQUI')) {
    return { ok: false, status: 503, message: 'Falta configurar provider y token de RENIEC en config/reniec.json.' };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(cfg.timeoutMs) || 12000);
  try {
    const { url, headers } = buildReniecRequest(provider, cfg, cleanDni);
    const response = await fetch(url, { method: provider.method || 'GET', headers, signal: controller.signal });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { ok: false, status: response.status, message: json.message || json.respuesta || 'No fue posible consultar RENIEC.' };
    }
    const data = json.data || json.result || json.persona || json.datos || json;
    const firstName = normalizeHumanName(data.nombres || data.nombres_pre || data.firstName || '');
    const lastName = normalizeHumanName([data.apellido_paterno || data.apellidoPaterno || data.first_last_name || '', data.apellido_materno || data.apellidoMaterno || data.second_last_name || ''].filter(Boolean).join(' '));
    if (!firstName && !lastName) {
      return { ok: false, status: 404, message: json.message || json.respuesta || 'No se encontraron datos para el DNI consultado.' };
    }
    return { ok: true, status: 200, patient: { dni: cleanDni, firstName, lastName, raw: data } };
  } catch (error) {
    return { ok: false, status: error.name === 'AbortError' ? 504 : 500, message: error.name === 'AbortError' ? 'La consulta RENIEC excediÃ³ el tiempo de espera.' : error.message };
  } finally {
    clearTimeout(timeout);
  }
}
function parseDoctorIdentity(name) {
  const clean = normalizeHumanName(name);
  if (!clean) {
    return { gender: 'unknown', bareName: '', displayName: 'MÃ©dico asignado', articleTitle: 'su mÃ©dico' };
  }
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
  const title = gender === 'female' ? 'Doctora' : gender === 'male' ? 'Doctor' : 'MÃ©dico';
  return {
    gender,
    bareName: bareName || clean,
    displayName: `${title} ${bareName || clean}`.trim(),
    articleTitle: gender === 'female'
      ? `la doctora ${bareName || clean}`
      : gender === 'male'
        ? `el doctor ${bareName || clean}`
        : `su mÃ©dico ${bareName || clean}`
  };
}
function nextSequentialUserId(users) {
  const max = users.reduce((acc, user) => {
    const n = Number(String(user.id || '').replace(/\D/g, ''));
    return Number.isFinite(n) ? Math.max(acc, n) : acc;
  }, 0);
  return `USR-${String(max + 1).padStart(3, '0')}`;
}
function nextPatientId() {
  state.sequences.patient = Number(state.sequences.patient || 0) + 1;
  return `PAC-${String(state.sequences.patient).padStart(6, '0')}`;
}
function nextCallId() {
  state.sequences.call = Number(state.sequences.call || 0) + 1;
  return `CALL-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(state.sequences.call).padStart(6, '0')}`;
}
function nextEventId() {
  state.sequences.event = Number(state.sequences.event || 0) + 1;
  return `EVT-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(state.sequences.event).padStart(6, '0')}`;
}
function formatDestination(moduleId, area) {
  const meta = getModuleMeta(moduleId);
  const label = normalizeHumanName(meta.label);
  const room = normalizeHumanName(area || meta.room);
  if (['optometria', 'consultorio', 'cirugia', 'ipl', 'examenes', 'imagenes'].includes(meta.id)) {
    return label || room || 'su mÃ³dulo';
  }
  if (label && room && label.toLowerCase() !== room.toLowerCase()) return `${label}, ${room}`;
  return room || label || 'su mÃ³dulo';
}
function syncCurrentCallFromModules() {
  syncCurrentCallFromModulesForState(state);
}
function generateCode(moduleId) {
  const meta = getModuleMeta(moduleId);
  state.counters[moduleId] = (Number(state.counters[moduleId]) || 0) + 1;
  return `${meta.prefix}-${String(state.counters[moduleId]).padStart(3, '0')}`;
}
function findAssignedOperator(moduleId, operatorUsername) {
  const users = readUsers();
  if (operatorUsername) {
    return users.find((user) => user.role === 'OPERADOR' && user.username === operatorUsername && user.isActive !== false) || null;
  }
  return users.find((user) => user.role === 'OPERADOR' && user.moduleId === moduleId && user.isActive !== false) || null;
}
function createPatient(payload) {
  const moduleId = normalizeModule(payload.moduleId || payload.area);
  const meta = getModuleMeta(moduleId);
  const doctorName = moduleId === 'optometria' && payload.isReferred !== true
    ? String(payload.doctorName || '').trim()
    : String(payload.doctorName || (moduleId === 'consultorio' ? pickRandomEnabledDoctor('consultorio') : getDefaultDoctor(moduleId))).trim();
  const code = String(payload.code || '').trim().toUpperCase() || generateCode(moduleId);
  const derivationHistory = Array.isArray(payload.derivationHistory) ? payload.derivationHistory : [];
  return {
    id: nextPatientId(),
    code,
    dni: normalizeDni(payload.dni),
    firstName: normalizeTextField(payload.firstName),
    lastName: normalizeTextField(payload.lastName),
    moduleId,
    area: normalizeTextField(payload.area || meta.room) || meta.room,
    doctorName,
    notes: normalizeTextField(payload.notes),
    referralNote: normalizeTextField(payload.referralNote || payload.notes),
    status: 'waiting',
    createdAt: new Date().toISOString(),
    calledAt: null,
    arrivedAt: null,
    attentionStartedAt: null,
    registeredBy: String(payload.registeredBy || 'recepcion').trim() || 'recepcion',
    lastUpdatedBy: String(payload.registeredBy || 'recepcion').trim() || 'recepcion',
    isReferred: payload.isReferred === true,
    referred: payload.referred === true,
    hasReferralOpen: payload.hasReferralOpen === true,
    referralSourcePatientId: payload.referralSourcePatientId || null,
    referralOriginModuleId: payload.referralOriginModuleId || null,
    referralOriginArea: payload.referralOriginArea || null,
    referralOriginDoctorName: payload.referralOriginDoctorName || '',
    referralOriginCode: payload.referralOriginCode || '',
    referredBy: payload.referredBy || null,
    referredAt: payload.referredAt || null,
    derivationHistory
  };
}

function buildReferredPatient(originPatient, derivationRow) {
  const targetModuleId = normalizeModule(derivationRow.toModuleId);
  const targetMeta = getModuleMeta(targetModuleId);
  return {
    id: nextPatientId(),
    code: generateCode(targetModuleId),
    dni: normalizeDni(originPatient.dni),
    firstName: String(originPatient.firstName || '').trim(),
    lastName: String(originPatient.lastName || '').trim(),
    moduleId: targetModuleId,
    area: normalizeTextField(derivationRow.toArea || targetMeta.room) || targetMeta.room,
    doctorName: String(derivationRow.toDoctorName || getDefaultDoctor(targetModuleId)).trim(),
    notes: normalizeTextField(derivationRow.notes || originPatient.notes),
    referralNote: normalizeTextField(derivationRow.notes || originPatient.referralNote || originPatient.notes),
    status: 'waiting',
    createdAt: new Date().toISOString(),
    calledAt: null,
    arrivedAt: null,
    attentionStartedAt: null,
    registeredBy: String(derivationRow.derivedBy || originPatient.lastUpdatedBy || originPatient.registeredBy || 'sistema').trim(),
    lastUpdatedBy: String(derivationRow.derivedBy || originPatient.lastUpdatedBy || originPatient.registeredBy || 'sistema').trim(),
    isReferred: true,
    referred: true,
    hasReferralOpen: false,
    referralSourcePatientId: originPatient.id,
    referralOriginModuleId: originPatient.moduleId,
    referralOriginArea: originPatient.area,
    referralOriginDoctorName: originPatient.doctorName || '',
    referralOriginCode: originPatient.code || '',
    referredBy: String(derivationRow.derivedBy || originPatient.lastUpdatedBy || originPatient.registeredBy || 'sistema').trim(),
    referredAt: derivationRow.derivedAt,
    derivationHistory: [derivationRow]
  };
}

function buildCallPayload(patient, operator) {
  const meta = getModuleMeta(patient.moduleId);
  const doctor = parseDoctorIdentity(patient.doctorName);
  const destinationText = formatDestination(patient.moduleId, patient.area);
  const syncDelayMs = 900;
  return {
    ...patient,
    eventId: nextEventId(),
    moduleLabel: meta.label,
    displayName: fullName(patient),
    operatorUsername: operator?.username || null,
    operatorName: operator?.fullName || null,
    doctorAnnouncement: doctor.displayName,
    doctorGender: doctor.gender,
    doctorBareName: doctor.bareName,
    doctorCareLabel: formatDoctorCareLabel(patient),
    destinationText,
    announcementText: `Paciente ${fullName(patient)}, acercarse a ${meta.label} para su atenciÃ³n.`,
    announcementAt: new Date(Date.now() + syncDelayMs).toISOString(),
    syncDelayMs
  };
}
function getVideos() {
  try {
    const mediaCfg = getMediaConfig();
    const allowed = SAFE_VIDEO_EXTENSIONS;
    const audioExts = new Set(['.mp3', '.wav', '.m4a', '.aac', '.flac', '.opus']);
    const videos = fs.readdirSync(VIDEO_DIR)
      .filter((file) => allowed.has(path.extname(file).toLowerCase()))
      .sort((a, b) => a.localeCompare(b, 'es'))
      .map((file) => {
        const ext = path.extname(file).toLowerCase();
        return {
          name: file,
          url: `/media/videos/${encodeURIComponent(file)}`,
          type: audioExts.has(ext) ? 'audio' : 'video',
          extension: ext,
          html5Compatible: HTML5_MEDIA_EXTENSIONS.has(ext),
          playbackMode: HTML5_MEDIA_EXTENSIONS.has(ext) ? 'html5' : 'vlc_external'
        };
      });
    if (mediaCfg.randomPlayback === false) return videos;
    for (let i = videos.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [videos[i], videos[j]] = [videos[j], videos[i]];
    }
    return videos;
  } catch {
    return [];
  }
}
function summarizeModuleMetrics(auditRows, moduleId) {
  const rows = auditRows.filter((row) => row.moduleId === moduleId);
  const arrivals = rows.filter((row) => row.arrivedAt);
  const avg = (values) => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
  return {
    totalCalls: rows.length,
    totalArrivals: arrivals.length,
    averageWaitMinutes: avg(rows.map((row) => row.waitMinutes || 0)),
    averageAttentionMinutes: avg(arrivals.map((row) => row.attentionMinutes || 0)),
    averageWaitSeconds: avg(rows.map((row) => (row.waitMinutes || 0) * 60)),
    averageAttentionSeconds: avg(arrivals.map((row) => (row.attentionMinutes || 0) * 60)),
    lastCallAt: rows[0]?.calledAt || null
  };
}
async function registerAuditFromCall(callPayload) {
  const moduleRows = state.audit.filter((row) => row.moduleId === callPayload.moduleId).sort((a, b) => new Date(b.calledAt) - new Date(a.calledAt));
  const lastModuleCall = moduleRows[0];
  const auditRow = {
    callId: nextCallId(),
    patientId: callPayload.id,
    patientCode: callPayload.code,
    patientName: callPayload.displayName,
    moduleId: callPayload.moduleId,
    moduleLabel: callPayload.moduleLabel,
    doctorName: callPayload.doctorName,
    operatorUsername: callPayload.operatorUsername,
    operatorName: callPayload.operatorName,
    registeredAt: callPayload.createdAt,
    calledAt: callPayload.calledAt,
    arrivedAt: null,
    waitMinutes: diffMinutes(callPayload.createdAt, callPayload.calledAt),
    attentionMinutes: 0,
    nextCallGapMinutes: lastModuleCall ? diffMinutes(lastModuleCall.calledAt, callPayload.calledAt) : null,
    repeatCount: 0,
    isRepeat: false
  };
  state.audit.unshift(auditRow);
  state.moduleMetrics[callPayload.moduleId] = summarizeModuleMetrics(state.audit, callPayload.moduleId);
  await sqlService.persistAudit(auditRow);
}
function updateAuditArrival(patient) {
  const auditRow = state.audit.find((row) => row.patientId === patient.id && !row.arrivedAt);
  if (!auditRow) return null;
  auditRow.arrivedAt = patient.arrivedAt;
  auditRow.attentionMinutes = diffMinutes(patient.calledAt, patient.arrivedAt);
  state.moduleMetrics[patient.moduleId] = summarizeModuleMetrics(state.audit, patient.moduleId);
  return auditRow;
}
function markAuditRepeat(patientId) {
  const auditRow = state.audit.find((row) => row.patientId === patientId && !row.arrivedAt);
  if (!auditRow) return null;
  auditRow.repeatCount = Number(auditRow.repeatCount || 0) + 1;
  auditRow.isRepeat = true;
  return auditRow;
}
function updateAuditCompletion(patient) {
  const auditRow = state.audit.find((row) => row.patientId === patient.id && !row.completedAt);
  if (!auditRow) return null;
  auditRow.arrivedAt = patient.arrivedAt || auditRow.arrivedAt || null;
  auditRow.completedAt = patient.completedAt || new Date().toISOString();
  if (auditRow.arrivedAt) {
    auditRow.attentionMinutes = diffMinutes(auditRow.arrivedAt, auditRow.completedAt);
  } else if (patient.calledAt) {
    auditRow.attentionMinutes = diffMinutes(patient.calledAt, auditRow.completedAt);
  }
  state.moduleMetrics[patient.moduleId] = summarizeModuleMetrics(state.audit, patient.moduleId);
  return auditRow;
}
async function getDiagnostics() {
  const sqlInfo = await sqlService.diagnose();
  const sqlServerInfo = await sqlServerProbeService.diagnose();
  const users = readUsers();
  const databaseEngine = pgProbeConfig.enabled === true ? 'postgresql' : 'sqlserver';
  const databaseConfigFile = databaseEngine === 'postgresql' ? POSTGRES_CONFIG_FILE : SQL_CONFIG_FILE;
  return {
    databaseConfigured: Boolean(sqlService.getConfig().enabled),
    databaseEngine,
    databaseStatus: sqlInfo.status,
    databaseMessage: sqlInfo.message,
    databaseConfigFile: path.relative(ROOT, databaseConfigFile),
    reniecConfigured: Boolean(getReniecConfig().enabled),
    sqlServerStatus: sqlServerInfo.status,
    sqlServerMessage: sqlServerInfo.message,
    sqlServerConfigFile: path.relative(ROOT, SQL_CONFIG_FILE),
    stateFile: path.relative(ROOT, store.STATE_FILE),
    stateFileExists: fs.existsSync(store.STATE_FILE),
    historyFile: path.relative(ROOT, store.HISTORY_FILE),
    historyFileExists: fs.existsSync(store.HISTORY_FILE),
    userCount: users.length,
    operatorCount: users.filter((u) => u.role === 'OPERADOR').length,
    queueCount: state.queue.length,
    waitingCount: state.queue.filter((x) => x.status === 'waiting').length,
    calledCount: state.queue.filter((x) => x.status === 'called').length,
    historyCount: state.callHistory.length,
    auditCount: state.audit.length,
    hasVideos: getVideos().length > 0,
    updatedAt: new Date().toISOString(),
    warnings: [
      !getReniecConfig().enabled ? 'La integraciÃ³n RENIEC estÃ¡ desactivada; configure config/reniec.json para bÃºsqueda por DNI.' : null,
      sqlInfo.ok ? null : sqlInfo.message,
      null,
      !fs.existsSync(path.join(ROOT, 'public', 'media', 'branding', 'qhali-logo.svg')) ? 'No se encontrÃ³ el logo principal.' : null
    ].filter(Boolean)
  };
}

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(self), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  next();
});
app.use(express.json({ limit: '1mb' }));
app.get('/', (_req, res) => res.redirect('/index.html'));
app.get('/login.html', (_req, res) => res.sendFile(path.join(ROOT, 'public', 'login.html')));
app.get('/admin.html', (req, res, next) => {
  const sessionInfo = getSessionUserFromRequest(req);
  if (!sessionInfo || !['ADMIN', 'RECEPCION'].includes(String(sessionInfo.user.role || '').toUpperCase())) {
    return res.redirect('/login.html?next=' + encodeURIComponent('/admin.html'));
  }
  req.auth = sessionInfo;
  return next();
}, (_req, res) => res.sendFile(path.join(ROOT, 'public', 'admin.html')));
app.get('/operator.html', (req, res, next) => {
  const sessionInfo = getSessionUserFromRequest(req);
  if (!sessionInfo || !['ADMIN', 'OPERADOR'].includes(String(sessionInfo.user.role || '').toUpperCase())) {
    return res.redirect('/login.html?next=' + encodeURIComponent('/operator.html'));
  }
  req.auth = sessionInfo;
  return next();
}, (_req, res) => res.sendFile(path.join(ROOT, 'public', 'operator.html')));
app.use('/media/videos', express.static(VIDEO_DIR, {
  etag: true,
  maxAge: '7d',
  setHeaders(res, filePath) {
    if (SAFE_VIDEO_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    }
  }
}));
app.use('/media', express.static(path.join(ROOT, 'public', 'media'), {
  etag: true,
  maxAge: '7d',
  setHeaders(res, filePath) {
    if (/\.(mp4|m4v|webm|ogg|mov)$/i.test(filePath)) {
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    }
  }
}));
app.use(express.static(path.join(ROOT, 'public'), { etag: true, maxAge: 0 }));

app.get('/api/session', (req, res) => {
  const sessionInfo = getSessionUserFromRequest(req);
  if (!sessionInfo) return res.status(401).json({ ok: false, message: 'SesiÃ³n no disponible.' });
  return res.json({ ok: true, user: sanitizeUser(sessionInfo.user) });
});
app.get('/api/config', (_req, res) => {
  const vlcCfg = getVlcConfig();
  return res.json({
    modules: getModulesForClient(),
    settings: state.settings,
    videos: getVideos(),
    videoSyncState: getEffectiveVideoSyncState(videoSyncState),
    media: getMediaConfig(),
    mediaEngine: getDesiredVideoEngine(),
    vlc: {
      enabled: vlcCfg.enabled === true,
      host: vlcCfg.host,
      port: vlcCfg.port,
      autoStart: vlcCfg.autoStart === true
    }
  });
});
app.get('/api/state', (_req, res) => res.json(buildClientStateSnapshot()));
app.get('/api/users', requireAuth, requireRoles('ADMIN','RECEPCION'), (_req, res) => res.json(readUsers().map(sanitizeUser)));

app.get('/api/doctors', requireAuth, requireRoles('ADMIN','OPERADOR','RECEPCION'), (req, res) => {
  const moduleId = req.query.moduleId ? normalizeModule(req.query.moduleId) : null;
  const doctors = readDoctorsData()
    .filter((row) => !moduleId || row.moduleId === moduleId)
    .sort((a, b) => (a.moduleId || '').localeCompare(b.moduleId || '') || (a.order || 999) - (b.order || 999));
  res.json({ ok: true, doctors });
});
app.post('/api/doctors', requireAuth, requireRoles('ADMIN'), asyncRoute(async (req, res) => {
  const rows = readDoctorsData();
  const moduleId = normalizeModule(req.body?.moduleId || 'consultorio');
  const name = normalizeTextField(req.body?.name || req.body?.doctorName || '');
  if (!name) return res.status(400).json({ ok:false, message:'Ingrese el nombre del mÃ©dico.' });
  const exists = rows.find((row) => row.moduleId === moduleId && row.name === name);
  if (exists) {
    exists.enabled = req.body?.enabled !== false;
    exists.specialty = normalizeTextField(req.body?.specialty || exists.specialty || getModuleMeta(moduleId).label);
    exists.order = Number(req.body?.order || exists.order || rows.length + 1);
  } else {
    rows.push(normalizeDoctorRow({ moduleId, name, specialty:req.body?.specialty || getModuleMeta(moduleId).label, enabled:req.body?.enabled !== false, order:req.body?.order || rows.filter(r=>r.moduleId===moduleId).length + 1 }, rows.length, moduleId));
  }
  const saved = saveDoctorsData(rows);
  deferSqlWork('SYNC_DOCTORS_ADMIN_SAVE', async () => { await sqlService.syncDoctors(saved); });
  broadcastState();
  res.json({ ok:true, doctors:saved.filter((row)=>row.moduleId===moduleId) });
}));
app.post('/api/doctors/:id/status', requireAuth, requireRoles('ADMIN'), asyncRoute(async (req, res) => {
  const rows = readDoctorsData();
  const target = rows.find((row) => String(row.id) === String(req.params.id));
  if (!target) return res.status(404).json({ ok:false, message:'MÃ©dico no encontrado.' });
  target.enabled = req.body?.enabled !== false;
  const saved = saveDoctorsData(rows);
  deferSqlWork('SYNC_DOCTORS_ADMIN_STATUS', async () => { await sqlService.syncDoctors(saved); });
  broadcastState();
  res.json({ ok:true, doctor: target, doctors:saved });
}));
app.get('/api/diagnostics', requireAuth, requireRoles('ADMIN'), asyncRoute(async (_req, res) => res.json(await getDiagnosticsCached())));
app.get('/api/audit', requireAuth, requireRoles('ADMIN','RECEPCION'), (_req, res) => {
  ensureActiveWorkday();
  return res.json(state.audit || []);
});
app.get('/api/operators', requireAuth, requireRoles('ADMIN','RECEPCION'), (req, res) => {
  const moduleId = req.query.moduleId ? normalizeModule(req.query.moduleId) : null;
  const users = readUsers().filter((u) => u.role === 'OPERADOR' && u.isActive !== false)
    .filter((u) => !moduleId || u.moduleId === moduleId);
  res.json(users.map(sanitizeUser));
});
app.get('/api/search', requireAuth, requireRoles('ADMIN','RECEPCION','OPERADOR'), asyncRoute(async (req, res) => {
  const term = String(req.query.q || req.query.term || '').trim();
  if (!term) return res.json({ ok: true, results: [] });
  const cleanDni = normalizeDni(term);
  const lower = term.toLowerCase();
  const localMatches = (state.queue || []).filter((item) => {
    const full = `${item.firstName || ''} ${item.lastName || ''}`.toLowerCase();
    return (cleanDni && normalizeDni(item.dni) === cleanDni) || full.includes(lower);
  }).map((item) => ({ source: 'memoria', patient: item }));
  const sqlMatches = [];
  const sqlSearch = localMatches.length
    ? { ok: true, patients: [] }
    : await withTimeout(() => sqlService.searchPatients(term), 250, { ok: false, patients: [], reason: 'timeout' });
  for (const patient of (sqlSearch?.patients || [])) {
    sqlMatches.push({ source: 'sql', patient });
  }
  let reniec = null;
  if (cleanDni && validateDni(cleanDni)) {
    const reniecResult = await lookupReniecByDni(cleanDni);
    if (reniecResult.ok) reniec = { source: 'reniec', patient: reniecResult.patient };
  }
  return res.json({ ok: true, results: [...localMatches, ...sqlMatches, ...(reniec ? [reniec] : [])] });
}));

app.get('/api/patients/day-search', requireAuth, requireRoles('ADMIN','RECEPCION','OPERADOR'), asyncRoute(async (req, res) => {
  const term = String(req.query.q || req.query.term || '').trim();
  const moduleId = req.query.moduleId ? normalizeModule(req.query.moduleId) : null;
  const limit = Math.max(1, Math.min(50, Number(req.query.limit || 30)));
  const cleanDni = normalizeDni(term);
  const lowered = normalizeSearchText(term);
  const authUser = req.auth?.user || {};
  const operatorModuleId = String(authUser.role || '').toUpperCase() === 'OPERADOR' ? normalizeModule(authUser.moduleId || '') : null;

  const results = buildPatientDaySearchPool()
    .filter((item) => isSameCalendarDay(item.createdAt || item.updatedAt || item.calledAt || item.arrivedAt || item.completedAt || new Date()))
    .filter((item) => !moduleId || normalizeModule(item.moduleId) === moduleId)
    .map((item) => ({
      ...item,
      moduleLabel: item.moduleLabel || getModuleMeta(item.moduleId).label,
      canCall: ['waiting', 'called', 'absent', 'dilating'].includes(String(item.status || '').toLowerCase())
        && (String(authUser.role || '').toUpperCase() === 'ADMIN' || !operatorModuleId || operatorModuleId === normalizeModule(item.moduleId))
    }))
    .filter((item) => {
      if (!lowered && !cleanDni) return true;
      const full = normalizeSearchText(`${item.firstName || ''} ${item.lastName || ''}`);
      const inverted = normalizeSearchText(`${item.lastName || ''} ${item.firstName || ''}`);
      const display = normalizeSearchText(item.displayName || '');
      return Boolean(
        (cleanDni && normalizeDni(item.dni) === cleanDni)
        || full.includes(lowered)
        || inverted.includes(lowered)
        || display.includes(lowered)
        || normalizeSearchText(String(item.code || '')).includes(lowered)
      );
    })
    .sort((a, b) => {
      const statusDiff = getPatientSearchStatusWeight(a.status) - getPatientSearchStatusWeight(b.status);
      if (statusDiff !== 0) return statusDiff;
      return new Date(b.updatedAt || b.completedAt || b.arrivedAt || b.calledAt || b.createdAt || 0) - new Date(a.updatedAt || a.completedAt || a.arrivedAt || a.calledAt || a.createdAt || 0);
    })
    .slice(0, limit);

  return res.json({ ok: true, results });
}));

app.get('/api/reniec/:dni', requireAuth, requireRoles('ADMIN','RECEPCION','OPERADOR'), asyncRoute(async (req, res) => {
  const result = await lookupReniecByDni(req.params.dni);
  if (!result.ok) return res.status(result.status || 500).json({ ok: false, message: result.message });
  return res.json({ ok: true, patient: result.patient });
}));
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const normalizedUsername = String(username || '').trim().toLowerCase();
  const loginKey = `${req.ip}:${normalizedUsername}`;
  if (isLoginBlocked(loginKey)) {
    return res.status(429).json({ ok: false, message: 'Demasiados intentos. Espere unos minutos antes de volver a intentar.' });
  }
  const users = readUsers();
  const candidate = users.find((item) => String(item.username || '').trim().toLowerCase() === normalizedUsername && item.isActive !== false);
  const valid = candidate && verifyPassword(password, candidate);
  if (!valid) {
    registerFailedLogin(loginKey);
    return res.status(401).json({ ok: false, message: 'Usuario o clave incorrectos.' });
  }
  clearFailedLogin(loginKey);
  candidate.passwordHash = hashPassword(password);
  candidate.lastLoginAt = new Date().toISOString();
  saveUsers(users);
  deferSqlWork('SYNC_USERS_LOGIN', async () => { await sqlService.syncUsers(readUsers()); });

  const redirect = candidate.role === 'OPERADOR'
    ? `/operator.html?module=${encodeURIComponent(candidate.moduleId || '')}&operator=${encodeURIComponent(candidate.username)}`
    : candidate.role === 'ADMIN' || candidate.role === 'RECEPCION'
      ? '/admin.html'
      : '/login.html';
  const token = createSessionForUser(candidate, req);
  setSessionCookie(res, token);
  return res.json({ ok: true, user: sanitizeUser(candidate), redirect, sessionToken: token });
});
app.post('/api/logout', requireAuth, (req, res) => {
  activeSessions.delete(req.auth.token);
  clearSessionCookie(res);
  return res.json({ ok: true });
});
app.post('/api/users', requireAuth, requireRoles('ADMIN'), asyncRoute(async (req, res) => {
  const payload = req.body || {};
  if (!payload.username || !payload.password || !payload.fullName) return res.status(400).json({ ok: false, message: 'Debe ingresar usuario, clave y nombre completo.' });
  if (String(payload.password || '').trim().length < 4) return res.status(400).json({ ok: false, message: 'La clave debe tener al menos 4 caracteres.' });
  const users = readUsers();
  if (users.some((u) => String(u.username).toLowerCase() === String(payload.username).toLowerCase())) return res.status(409).json({ ok: false, message: 'El usuario ya existe.' });
  const normalizedUsername = String(payload.username || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,30}$/i.test(normalizedUsername)) return res.status(400).json({ ok: false, message: 'El usuario solo puede contener letras, nÃºmeros, punto, guion o guion bajo.' });
  const role = String(payload.role || 'OPERADOR').trim().toUpperCase();
  if (!['ADMIN', 'RECEPCION', 'OPERADOR'].includes(role)) return res.status(400).json({ ok: false, message: 'Rol invÃ¡lido.' });
  const moduleId = payload.moduleId ? normalizeModule(payload.moduleId) : null;
  const doctorName = role === 'OPERADOR' ? String(payload.doctorName || '').trim() || getDefaultDoctor(moduleId || 'consultorio', 0) : '';
  const next = normalizeUser({
    id: nextSequentialUserId(users),
    username: normalizedUsername,
    password: payload.password,
    fullName: normalizeTextField(payload.fullName),
    role,
    moduleId,
    doctorName,
    isActive: true,
    lastLoginAt: null,
    createdAt: new Date().toISOString()
  });
  if (role === 'OPERADOR' && !moduleId) return res.status(400).json({ ok: false, message: 'Debe seleccionar el Ã¡rea para el usuario.' });
  if (role !== 'OPERADOR') {
    next.moduleId = null;
    next.doctorName = '';
  }
  const sqlConfig = sqlService.getConfig ? sqlService.getConfig() : { enabled: false };
  if (sqlConfig.enabled) {
    const sqlResult = await sqlService.upsertSystemUser(next);
    if (!sqlResult?.persisted) {
      return res.status(500).json({ ok: false, message: sqlResult?.reason || 'No se pudo guardar el usuario en SQL Server.' });
    }
  }
  users.push(next);
  saveUsers(users);
  invalidateDiagnosticsCache();
  return res.json({ ok: true, user: sanitizeUser(next), users: users.map(sanitizeUser) });
}));
app.post('/api/users/:username/status', requireAuth, requireRoles('ADMIN'), asyncRoute(async (req, res) => {
  const username = String(req.params.username || '').trim().toLowerCase();
  const users = readUsers();
  const target = users.find((u) => String(u.username || '').toLowerCase() === username);
  if (!target) return res.status(404).json({ ok: false, message: 'Usuario no encontrado.' });
  if (String(target.role || '').toUpperCase() !== 'OPERADOR') {
    return res.status(400).json({ ok: false, message: 'Solo los usuarios de Ã¡rea pueden cambiar de estado desde este panel.' });
  }
  target.isActive = req.body?.isActive !== false;
  saveUsers(users);
  invalidateDiagnosticsCache();
  deferSqlWork('UPSERT_USER_STATUS', async () => { await sqlService.upsertSystemUser(target); });
  return res.json({ ok: true, user: sanitizeUser(target) });
}));
app.post('/api/patients', requireAuth, requireRoles('ADMIN','OPERADOR'), asyncRoute(async (req, res) => {
  const authUser = req.auth.user;
  const { firstName, lastName, dni } = req.body || {};
  const userRole = String(authUser.role || '').toUpperCase();
  const userModuleId = normalizeModule(authUser.moduleId || '');
  const cleanDni = normalizeDni(dni);
  if (!validateDni(cleanDni)) return res.status(400).json({ ok: false, message: 'Debe ingresar un DNI vÃ¡lido de 8 dÃ­gitos.' });
  if (!firstName || !lastName) return res.status(400).json({ ok: false, message: 'Debe ingresar nombre y apellido.' });

  const forcedModuleId = userRole === 'OPERADOR' ? userModuleId : (req.body?.moduleId || null);
  const nextModuleId = normalizeModule(forcedModuleId || req.body?.moduleId || 'optometria');
  if (userRole === 'OPERADOR' && !nextModuleId) {
    return res.status(403).json({ ok: false, message: 'El operador no tiene un mÃ³dulo asignado.' });
  }

  const duplicateInMemory = findOpenPatientByDniToday(cleanDni);
  const duplicateInSql = duplicateInMemory
    ? null
    : await withTimeout(() => sqlService.findPatientByDniToday(cleanDni), 350, { ok: false, patient: null, reason: 'timeout' });
  const duplicatePatient = duplicateInMemory || duplicateInSql?.patient || null;
  if (duplicatePatient && isOpenPatientStatus(duplicatePatient.status)) {
    return res.status(409).json({
      ok: false,
      code: 'PATIENT_ALREADY_OPEN',
      message: `El DNI ya tiene un registro activo hoy en ${getModuleMeta(duplicatePatient.moduleId).label || duplicatePatient.moduleId}. Use buscar paciente, llamar, marcar presente o referir; no cree otro registro.`,
      patient: duplicatePatient
    });
  }

  const basePatient = createPatient({ ...(req.body || {}), dni: cleanDni, moduleId: nextModuleId });
  const isDirectOptometriaRegistration = nextModuleId === 'optometria';
  const registrationArea = isDirectOptometriaRegistration
    ? (getModuleMeta('optometria').room || 'OptometrÃ­a')
    : normalizeTextField(req.body?.area || basePatient.area || getModuleMeta(nextModuleId).room || 'MÃ³dulo');
  const registrationDoctor = isDirectOptometriaRegistration
    ? String(req.body?.doctorName || 'Nuevo').trim()
    : String(req.body?.doctorName || basePatient.doctorName || (nextModuleId === 'consultorio' ? pickRandomEnabledDoctor('consultorio') : getDefaultDoctor(nextModuleId))).trim();
  const patient = {
    ...basePatient,
    ...req.body,
    id: basePatient.id,
    code: basePatient.code,
    dni: cleanDni,
    firstName: normalizeTextField(firstName),
    lastName: normalizeTextField(lastName),
    moduleId: nextModuleId,
    area: registrationArea,
    doctorName: registrationDoctor,
    notes: normalizeTextField(req.body?.notes || basePatient.notes || ''),
    status: 'waiting',
    lastUpdatedBy: getActorUsername(req)
  };

  const savedPatient = patient;
  state.queue = state.queue.filter((item) => item.id !== savedPatient.id);
  state.queue.push(savedPatient);
  state = saveState(state);
  broadcastState();
  deferSqlWork('UPSERT_PATIENT_REGISTER', async () => {
    const persisted = ensurePersisted(await sqlService.upsertPatient(savedPatient), 'No se pudo guardar el paciente en SQL Server');
    if (persisted?.warning) console.warn('[QHALI SQL UPSERT_PATIENT_REGISTER]', persisted.warning);
  });
  return res.json({ ok: true, patient: savedPatient, state, duplicateResolved: false, persistedDeferred: true });
}));

app.post('/api/patients/:id/derive', requireAuth, requireRoles('ADMIN','OPERADOR'), asyncRoute(async (req, res) => {
  const patient = state.queue.find((item) => item.id === req.params.id);
  if (!patient) return res.status(404).json({ ok: false, message: 'Paciente no encontrado.' });
  const authUser = req.auth.user;
  if (['OPERADOR'].includes(String(authUser.role || '').toUpperCase()) && normalizeModule(patient.moduleId) !== normalizeModule(authUser.moduleId)) return res.status(403).json({ ok: false, message: 'No puede operar pacientes de otro mÃ³dulo.' });

  const canDeriveImmediately = ['waiting', 'absent', 'attended'].includes(String(patient.status || '').toLowerCase()) || Boolean(patient.arrivedAt);
  if (!canDeriveImmediately) {
    return res.status(400).json({ ok: false, message: 'Solo se puede referir a un paciente activo del mÃ³dulo.' });
  }

  const rawTargetModule = req.body?.moduleId || req.body?.targetModuleId || req.body?.area;
  const targetModuleId = normalizeModule(rawTargetModule);
  const targetMeta = getModuleMeta(targetModuleId);
  const originMeta = getModuleMeta(patient.moduleId);

  if (!rawTargetModule || !targetMeta?.id) {
    return res.status(400).json({ ok: false, message: 'Debe seleccionar un mÃ³dulo de destino vÃ¡lido.' });
  }

  if (patient.moduleId === targetModuleId && String(patient.area || '').trim() === String(req.body?.area || targetMeta.room).trim()) {
    return res.status(400).json({ ok: false, message: 'El paciente ya se encuentra en esa Ã¡rea.' });
  }

  const derivedBy = getActorUsername(req);
  const requestedDoctorName = normalizeTextField(req.body?.doctorName || '');
  const mustReturnToOriginDoctor = targetModuleId === 'consultorio' && isOptometryReferralFromConsultorio(patient);
  if (mustReturnToOriginDoctor) {
    const originDoctor = referralOriginDoctorName(patient);
    if (!originDoctor) {
      return res.status(400).json({ ok: false, message: 'No se encontró el médico de origen para la contrarreferencia.' });
    }
    if (!getEnabledDoctorRow('consultorio', originDoctor)) {
      return res.status(400).json({ ok: false, message: `El médico ${originDoctor} no está activo en Admin. Active ese médico para contrarreferir.` });
    }
    if (requestedDoctorName && normalizeSearchText(requestedDoctorName) !== normalizeSearchText(originDoctor)) {
      return res.status(400).json({ ok: false, message: 'La contrarreferencia debe volver al mismo médico que originó la referencia.' });
    }
  }
  const targetDoctorName = mustReturnToOriginDoctor
    ? referralOriginDoctorName(patient)
    : requestedDoctorName || (targetModuleId === 'consultorio' ? pickRandomEnabledDoctor('consultorio') : getDefaultDoctor(targetModuleId));
  const derivationRow = {
    id: nextEventId(),
    fromModuleId: patient.moduleId,
    fromModuleLabel: originMeta.label,
    toModuleId: targetModuleId,
    toModuleLabel: targetMeta.label,
    fromArea: patient.area,
    toArea: normalizeTextField(req.body?.area || targetMeta.room) || targetMeta.room,
    fromDoctorName: patient.doctorName || null,
    toDoctorName: String(targetDoctorName || '').trim(),
    notes: normalizeTextField(req.body?.notes),
    referralNote: normalizeTextField(req.body?.notes),
    derivedBy,
    derivedAt: new Date().toISOString()
  };

  patient.derivationHistory = Array.isArray(patient.derivationHistory) ? patient.derivationHistory : [];
  patient.derivationHistory.unshift(derivationRow);
  patient.referralNote = derivationRow.referralNote || derivationRow.notes || patient.referralNote || patient.notes || '';
  patient.hasReferralOpen = true;
  patient.status = 'referred_out';
  patient.referredOutAt = derivationRow.derivedAt;
  patient.referredToModuleId = targetModuleId;
  patient.referredToModuleLabel = targetMeta.label;
  patient.lastUpdatedBy = derivedBy;
  patient.completedAt = null;

  const existingTargetPatient = findPatientInModuleByDniToday(patient.dni, targetModuleId, { includeCompleted: true });
  const referredPatient = existingTargetPatient
    ? {
        ...existingTargetPatient,
        dni: normalizeDni(patient.dni),
        firstName: normalizeTextField(patient.firstName),
        lastName: normalizeTextField(patient.lastName),
        moduleId: targetModuleId,
        area: normalizeTextField(derivationRow.toArea || targetMeta.room) || targetMeta.room,
        doctorName: String(derivationRow.toDoctorName || existingTargetPatient.doctorName || getDefaultDoctor(targetModuleId)).trim(),
        notes: normalizeTextField(derivationRow.notes || patient.notes || existingTargetPatient.notes || ''),
        referralNote: normalizeTextField(derivationRow.referralNote || derivationRow.notes || patient.referralNote || patient.notes || existingTargetPatient.referralNote || existingTargetPatient.notes || ''),
        status: 'waiting',
        calledAt: null,
        arrivedAt: null,
        attentionStartedAt: null,
        completedAt: null,
        lastUpdatedBy: derivedBy,
        isReferred: true,
        referred: true,
        hasReferralOpen: false,
        referralSourcePatientId: patient.id,
        referralOriginModuleId: patient.moduleId,
        referralOriginArea: patient.area,
        referralOriginDoctorName: patient.doctorName || '',
        referralOriginCode: patient.code || '',
        referredBy: derivedBy,
        referredAt: derivationRow.derivedAt,
        derivationHistory: [derivationRow, ...((Array.isArray(existingTargetPatient.derivationHistory) ? existingTargetPatient.derivationHistory : []).filter((row) => row?.id !== derivationRow.id))]
      }
    : buildReferredPatient(patient, derivationRow);
  state.queue = state.queue.filter((item) => item.id !== referredPatient.id);
  state.queue.push(referredPatient);

  const currentOriginCall = state.currentCalls[originMeta.id];
  if (currentOriginCall?.id === patient.id) {
    state.currentCalls[originMeta.id] = null;
  }

  syncCurrentCallFromModules();

  deferSqlWork('DERIVE', async () => {
    await sqlService.upsertPatient(patient);
    await sqlService.upsertPatient(referredPatient);
    await sqlService.persistCallEvent({
      id: derivationRow.id,
      patientId: referredPatient.id,
      moduleId: targetModuleId,
      callText: `Referencia de ${originMeta.label} a ${targetMeta.label}`,
      calledAt: derivationRow.derivedAt,
      calledBy: derivedBy,
      operatorName: derivedBy,
      doctorName: referredPatient.doctorName,
      callType: 'derive'
    });
  });

  state = saveState(state);
  broadcastState();
  return res.json({ ok: true, patient, referredPatient, state, derivation: derivationRow });
}));

async function handleCall(patient, operatorUsername, callType = 'normal') {
  if (patient.moduleId === 'consultorio' && (patient.isReferred === true || patient.referred === true) && !isEnabledDoctorName('consultorio', patient.doctorName)) {
    patient.referralSpecialty = patient.referralSpecialty || patient.doctorName || patient.area || 'NUEVO';
  }
  patient.status = 'called';
  patient.calledAt = new Date().toISOString();
  patient.attentionStartedAt = patient.calledAt;
  const operator = findAssignedOperator(patient.moduleId, operatorUsername);
  const callPayload = buildCallPayload(patient, operator);
  state.currentCalls[patient.moduleId] = callPayload;
  syncCurrentCallFromModules();
  state.callHistory.unshift({ ...callPayload, callIndex: state.callHistory.length + 1, callType });
  deferSqlWork('CALL_FLOW', async () => {
    await registerAuditFromCall(callPayload);
    await sqlService.upsertPatient(patient);
    await sqlService.persistCallEvent({
      id: callPayload.eventId,
      patientId: patient.id,
      moduleId: patient.moduleId,
      callText: callPayload.announcementText,
      calledAt: patient.calledAt,
      calledBy: operator?.username || null,
      operatorName: operator?.fullName || null,
      doctorName: patient.doctorName || null,
      callType
    });
  });
  state = saveState(state);
  io.emit('patient:called', callPayload);
  broadcastState(true);
  return callPayload;
}
app.post('/api/call/:id', requireAuth, requireRoles('ADMIN','OPERADOR'), asyncRoute(async (req, res) => {
  const patient = state.queue.find((item) => item.id === req.params.id);
  if (!patient) return res.status(404).json({ ok: false, message: 'Paciente no encontrado.' });
  const authUser = req.auth.user;
  if (['OPERADOR'].includes(String(authUser.role || '').toUpperCase()) && normalizeModule(patient.moduleId) !== normalizeModule(authUser.moduleId)) return res.status(403).json({ ok: false, message: 'No puede llamar pacientes de otro mÃ³dulo.' });
  if (!['waiting', 'absent', 'dilating', 'called'].includes(String(patient.status || '').toLowerCase())) {
    return res.status(400).json({ ok: false, message: 'Solo se puede llamar pacientes en espera, ausentes, en dilataciÃ³n o ya llamados.' });
  }
  const currentModuleCall = state.currentCalls[patient.moduleId];
  if (currentModuleCall?.id === patient.id && patient.status === 'called') {
    return res.json({ ok: true, currentCall: currentModuleCall, state });
  }
  const currentCall = await handleCall(patient, getActorUsername(req), 'normal');
  return res.json({ ok: true, currentCall, state });
}));
app.post('/api/call-next/:moduleId', requireAuth, requireRoles('ADMIN','OPERADOR'), requireModuleScope, asyncRoute(async (req, res) => {
  const moduleId = normalizeModule(req.params.moduleId);
  const doctorName = req.body?.doctorName ? String(req.body.doctorName) : null;
  const nextPatient = state.queue
    .filter((item) => item.moduleId === moduleId && ['waiting','absent'].includes(String(item.status || '').toLowerCase()))
    .filter((item) => !doctorName || item.doctorName === doctorName)
    .sort((a, b) => new Date(a.referredAt || a.createdAt || 0) - new Date(b.referredAt || b.createdAt || 0))[0];
  if (!nextPatient) return res.status(404).json({ ok: false, message: 'No hay pacientes en espera para este mÃ³dulo.' });
  const currentCall = await handleCall(nextPatient, getActorUsername(req), 'next');
  return res.json({ ok: true, currentCall, state });
}));
app.post('/api/patients/:id/status', requireAuth, requireRoles('ADMIN','OPERADOR'), asyncRoute(async (req, res) => {
  const patient = state.queue.find((item) => item.id === req.params.id);
  if (!patient) return res.status(404).json({ ok: false, message: 'Paciente no encontrado.' });
  const authUser = req.auth.user;
  if (['OPERADOR'].includes(String(authUser.role || '').toUpperCase()) && normalizeModule(patient.moduleId) !== normalizeModule(authUser.moduleId)) {
    return res.status(403).json({ ok: false, message: 'No puede operar pacientes de otro mÃ³dulo.' });
  }
  const allowedStatuses = new Set(['waiting', 'called', 'attended', 'completed', 'absent', 'dilating', 'cancelled', 'referred_out']);
  const nextStatus = String(req.body?.status || patient.status || '').toLowerCase();
  if (!allowedStatuses.has(nextStatus)) return res.status(400).json({ ok: false, message: 'Estado de paciente no vÃ¡lido.' });
  patient.status = nextStatus;
  patient.lastUpdatedBy = getActorUsername(req, patient.lastUpdatedBy || patient.registeredBy || 'sistema');
  deferSqlWork('STATUS_UPDATE', async () => { await sqlService.upsertPatient(patient); });
  state = saveState(state);
  broadcastState();
  return res.json({ ok: true, patient, state });
}));
app.delete('/api/patients/:id', requireAuth, requireRoles('ADMIN','RECEPCION'), asyncRoute(async (req, res) => {
  const originalLength = state.queue.length;
  const patient = state.queue.find((item) => item.id === req.params.id);
  state.queue = state.queue.filter((item) => item.id !== req.params.id);
  if (patient && state.currentCalls[patient.moduleId]?.id === patient.id) state.currentCalls[patient.moduleId] = null;
  if (state.currentCall?.id === req.params.id) state.currentCall = null;
  if (state.queue.length === originalLength) return res.status(404).json({ ok: false, message: 'No se encontrÃ³ el registro.' });
  syncCurrentCallFromModules();
  deferSqlWork('DELETE_PATIENT', async () => { await sqlService.deletePatient(req.params.id); });
  state = saveState(state);
  broadcastState();
  return res.json({ ok: true, state });
}));
app.delete('/api/current-call/:moduleId?', requireAuth, requireRoles('ADMIN'), (req, res) => {
  const moduleId = req.params.moduleId ? normalizeModule(req.params.moduleId) : null;
  if (moduleId) {
    state.currentCalls[moduleId] = null;
    syncCurrentCallFromModules();
  } else {
    state.currentCalls = clone(defaultState.currentCalls);
    state.currentCall = null;
  }
  state = saveState(state);
  broadcastState();
  return res.json({ ok: true, state });
});
app.delete('/api/history/:id', requireAuth, requireRoles('ADMIN'), (req, res) => {
  const before = state.callHistory.length;
  state.callHistory = state.callHistory.filter((item) => item.id !== req.params.id || item.calledAt !== req.query.calledAt);
  if (before === state.callHistory.length) state.callHistory = state.callHistory.filter((item) => item.id !== req.params.id);
  state = saveState(state);
  broadcastState();
  return res.json({ ok: true, state });
});
app.post('/api/repeat-call/:moduleId', requireAuth, requireRoles('ADMIN','OPERADOR'), requireModuleScope, asyncRoute(async (req, res) => {
  const moduleId = normalizeModule(req.params.moduleId);
  const activeCall = state.currentCalls[moduleId];
  if (!activeCall) return res.status(404).json({ ok: false, message: 'No hay un llamado activo en este mÃ³dulo.' });
  const actorUsername = getActorUsername(req, activeCall.operatorUsername);
  const repeated = { ...activeCall, calledAt: new Date().toISOString(), announcementAt: new Date(Date.now() + 900).toISOString(), eventId: nextEventId(), operatorUsername: actorUsername, operatorName: req.auth?.user?.fullName || activeCall.operatorName };
  state.currentCalls[moduleId] = repeated;
  syncCurrentCallFromModules();
  state.callHistory.unshift({ ...repeated, callIndex: state.callHistory.length + 1, repeated: true });
  const auditRow = markAuditRepeat(repeated.id);
  deferSqlWork('REPEAT_CALL', async () => {
    await sqlService.persistCallEvent({
      id: repeated.eventId,
      patientId: repeated.id,
      moduleId: repeated.moduleId,
      callText: repeated.announcementText,
      calledAt: repeated.calledAt,
      calledBy: repeated.operatorUsername,
      operatorName: repeated.operatorName,
      doctorName: repeated.doctorName,
      callType: 'repeat'
    });
    if (auditRow) await sqlService.updateAuditRepeat(auditRow);
  });
  state = saveState(state);
  io.emit('patient:called', repeated);
  broadcastState(true);
  return res.json({ ok: true, currentCall: repeated, state });
}));

app.post('/api/repeat-patient/:id', requireAuth, requireRoles('ADMIN','OPERADOR'), asyncRoute(async (req, res) => {
  const patient = state.queue.find((item) => item.id === req.params.id);
  if (!patient) return res.status(404).json({ ok: false, message: 'Paciente no encontrado.' });
  const authUser = req.auth.user;
  if (['OPERADOR'].includes(String(authUser.role || '').toUpperCase()) && normalizeModule(patient.moduleId) !== normalizeModule(authUser.moduleId)) {
    return res.status(403).json({ ok: false, message: 'No puede repetir llamados de otro mÃ³dulo.' });
  }
  if (String(patient.status || '').toLowerCase() !== 'called') {
    return res.status(400).json({ ok: false, message: 'Solo se puede repetir llamado de un paciente llamado que aÃºn no estÃ¡ presente.' });
  }
  const actorUsername = getActorUsername(req, patient.operatorUsername || patient.registeredBy || 'sistema');
  patient.calledAt = new Date().toISOString();
  patient.lastUpdatedBy = actorUsername;
  const operator = findAssignedOperator(patient.moduleId, actorUsername);
  const repeated = {
    ...buildCallPayload(patient, operator),
    announcementAt: new Date(Date.now() + 900).toISOString(),
    eventId: nextEventId(),
    operatorUsername: actorUsername,
    operatorName: req.auth?.user?.fullName || operator?.fullName || patient.operatorName
  };
  state.currentCalls[patient.moduleId] = repeated;
  syncCurrentCallFromModules();
  state.callHistory.unshift({ ...repeated, callIndex: state.callHistory.length + 1, repeated: true });
  const auditRow = markAuditRepeat(repeated.id);
  deferSqlWork('REPEAT_PATIENT_CALL', async () => {
    await sqlService.upsertPatient(patient);
    await sqlService.persistCallEvent({
      id: repeated.eventId,
      patientId: repeated.id,
      moduleId: repeated.moduleId,
      callText: repeated.announcementText,
      calledAt: repeated.calledAt,
      calledBy: repeated.operatorUsername,
      operatorName: repeated.operatorName,
      doctorName: repeated.doctorName,
      callType: 'repeat'
    });
    if (auditRow) await sqlService.updateAuditRepeat(auditRow);
  });
  state = saveState(state);
  io.emit('patient:called', repeated);
  broadcastState(true);
  return res.json({ ok: true, currentCall: repeated, state });
}));

app.post('/api/arrive/:moduleId', requireAuth, requireRoles('ADMIN','OPERADOR'), requireModuleScope, asyncRoute(async (req, res) => {
  const moduleId = normalizeModule(req.params.moduleId);
  const activeCall = state.currentCalls[moduleId];
  if (!activeCall) return res.status(404).json({ ok: false, message: 'No hay un llamado activo en este mÃ³dulo.' });
  const patient = state.queue.find((item) => item.id === activeCall.id);
  let auditRow = null;
  if (patient) {
    patient.status = 'attended';
    patient.arrivedAt = new Date().toISOString();
    patient.lastUpdatedBy = getActorUsername(req, patient.lastUpdatedBy || 'sistema');
    auditRow = updateAuditArrival(patient);
    deferSqlWork('ARRIVE', async () => {
      await sqlService.upsertPatient(patient);
      if (auditRow) await sqlService.updateAuditArrival(auditRow);
    });
    state.currentCalls[moduleId] = {
      ...activeCall,
      ...patient,
      status: 'attended',
      arrivedAt: patient.arrivedAt
    };
  }
  syncCurrentCallFromModules();
  state = saveState(state);
  broadcastState();
  return res.json({ ok: true, state, patient });
}));


app.post('/api/patients/:id/dilate', requireAuth, requireRoles('ADMIN','OPERADOR'), asyncRoute(async (req, res) => {
  const patient = state.queue.find((item) => item.id === req.params.id);
  if (!patient) return res.status(404).json({ ok: false, message: 'Paciente no encontrado.' });
  const authUser = req.auth.user;
  if (['OPERADOR'].includes(String(authUser.role || '').toUpperCase()) && normalizeModule(patient.moduleId) !== normalizeModule(authUser.moduleId)) {
    return res.status(403).json({ ok: false, message: 'No puede operar pacientes de otro mÃ³dulo.' });
  }
  if (!['called', 'attended'].includes(String(patient.status || '').toLowerCase())) {
    return res.status(400).json({ ok: false, message: 'Solo se puede enviar a dilataciÃ³n un paciente llamado o presente.' });
  }
  const now = new Date().toISOString();
  patient.status = 'dilating';
  patient.dilationStartedAt = now;
  patient.dilationReturnDoctorName = patient.doctorName || '';
  patient.dilationNote = String(req.body?.notes || 'Paciente en dilataciÃ³n').trim();
  patient.lastUpdatedBy = getActorUsername(req, patient.lastUpdatedBy || 'sistema');
  if (state.currentCalls[patient.moduleId]?.id === patient.id) state.currentCalls[patient.moduleId] = null;
  syncCurrentCallFromModules();
  deferSqlWork('PATIENT_DILATING', async () => { await sqlService.upsertPatient(patient); });
  state = saveState(state);
  broadcastState();
  return res.json({ ok: true, patient, state });
}));




app.post('/api/patients/:id/absent', requireAuth, requireRoles('ADMIN','OPERADOR'), asyncRoute(async (req, res) => {
  const patient = state.queue.find((item) => item.id === req.params.id);
  if (!patient) return res.status(404).json({ ok: false, message: 'Paciente no encontrado.' });
  const authUser = req.auth.user;
  if (['OPERADOR'].includes(String(authUser.role || '').toUpperCase()) && normalizeModule(patient.moduleId) !== normalizeModule(authUser.moduleId)) {
    return res.status(403).json({ ok: false, message: 'No puede operar pacientes de otro mÃ³dulo.' });
  }
  patient.status = 'absent';
  patient.absentAt = new Date().toISOString();
  patient.lastUpdatedBy = getActorUsername(req, patient.lastUpdatedBy || 'sistema');
  if (state.currentCalls[patient.moduleId]?.id === patient.id) state.currentCalls[patient.moduleId] = null;
  syncCurrentCallFromModules();
  deferSqlWork('PATIENT_ABSENT', async () => { await sqlService.upsertPatient(patient); });
  state = saveState(state);
  broadcastState();
  return res.json({ ok: true, patient, state });
}));

app.post('/api/patients/:id/present', requireAuth, requireRoles('ADMIN','OPERADOR'), asyncRoute(async (req, res) => {
  const patient = state.queue.find((item) => item.id === req.params.id);
  if (!patient) return res.status(404).json({ ok: false, message: 'Paciente no encontrado.' });
  const authUser = req.auth.user;
  if (['OPERADOR'].includes(String(authUser.role || '').toUpperCase()) && normalizeModule(patient.moduleId) !== normalizeModule(authUser.moduleId)) {
    return res.status(403).json({ ok: false, message: 'No puede operar pacientes de otro mÃ³dulo.' });
  }
  const currentStatus = String(patient.status || '').toLowerCase();
  const allowedPresentStatuses = normalizeModule(patient.moduleId) === 'optometria'
    ? ['waiting', 'absent', 'called', 'attended', 'completed']
    : ['called', 'attended', 'completed'];
  if (!allowedPresentStatuses.includes(currentStatus)) {
    return res.status(400).json({ ok: false, message: 'Solo se puede marcar presente a un paciente llamado o ya atendido.' });
  }
  patient.status = 'attended';
  patient.arrivedAt = patient.arrivedAt || new Date().toISOString();
  patient.lastUpdatedBy = getActorUsername(req, patient.lastUpdatedBy || 'sistema');
  let auditRow = updateAuditArrival(patient);
  if (state.currentCalls[patient.moduleId]?.id === patient.id) {
    state.currentCalls[patient.moduleId] = {
      ...state.currentCalls[patient.moduleId],
      ...patient,
      status: 'attended',
      arrivedAt: patient.arrivedAt
    };
  }
  syncCurrentCallFromModules();
  deferSqlWork('PATIENT_PRESENT', async () => {
    await sqlService.upsertPatient(patient);
    if (auditRow) await sqlService.updateAuditArrival(auditRow);
  });
  state = saveState(state);
  broadcastState();
  return res.json({ ok: true, patient, state });
}));

app.post('/api/patients/:id/assign-doctor', requireAuth, requireRoles('ADMIN','OPERADOR'), asyncRoute(async (req, res) => {
  const patient = state.queue.find((item) => item.id === req.params.id);
  if (!patient) return res.status(404).json({ ok: false, message: 'Paciente no encontrado.' });
  const authUser = req.auth.user;
  if (['OPERADOR'].includes(String(authUser.role || '').toUpperCase()) && normalizeModule(patient.moduleId) !== normalizeModule(authUser.moduleId)) {
    return res.status(403).json({ ok: false, message: 'No puede operar pacientes de otro mÃ³dulo.' });
  }
  const doctorName = String(req.body?.doctorName || '').trim();
  if (!doctorName) return res.status(400).json({ ok: false, message: 'Debe seleccionar un mÃ©dico vÃ¡lido.' });
  if (normalizeModule(patient.moduleId) === 'consultorio' && !isConsultorioDoctorAllowedForPatient(patient, doctorName)) {
    const category = consultorioPatientCategory(patient);
    const expected = category === 'especialidad' ? 'un especialista' : 'un mÃ©dico oftalmÃ³logo';
    return res.status(400).json({ ok: false, message: `Este paciente debe ser asignado a ${expected}.` });
  }
  patient.doctorName = doctorName;
  const assignedDoctor = getEnabledDoctorRow(patient.moduleId, doctorName);
  patient.doctorSpecialty = assignedDoctor?.specialty || patient.doctorSpecialty || '';
  patient.doctorCareLabel = formatDoctorCareLabel(patient);
  patient.lastUpdatedBy = getActorUsername(req, patient.lastUpdatedBy || 'sistema');
  if (state.currentCalls[patient.moduleId]?.id === patient.id) {
    state.currentCalls[patient.moduleId] = { ...state.currentCalls[patient.moduleId], doctorName, doctorSpecialty: patient.doctorSpecialty, doctorCareLabel: patient.doctorCareLabel };
  }
  syncCurrentCallFromModules();
  deferSqlWork('ASSIGN_DOCTOR', async () => { await sqlService.upsertPatient(patient); });
  state = saveState(state);
  broadcastState();
  return res.json({ ok: true, patient, state });
}));

app.post('/api/patients/:id/complete', requireAuth, requireRoles('ADMIN','OPERADOR'), asyncRoute(async (req, res) => {
  const patient = state.queue.find((item) => item.id === req.params.id);
  if (!patient) return res.status(404).json({ ok: false, message: 'Paciente no encontrado.' });
  const authUser = req.auth.user;
  if (['OPERADOR'].includes(String(authUser.role || '').toUpperCase()) && normalizeModule(patient.moduleId) !== normalizeModule(authUser.moduleId)) {
    return res.status(403).json({ ok: false, message: 'No puede cerrar pacientes de otro mÃ³dulo.' });
  }
  patient.status = 'completed';
  patient.completedAt = new Date().toISOString();
  patient.lastUpdatedBy = getActorUsername(req, req.body?.completedBy || patient.lastUpdatedBy || 'sistema');
  const auditRow = updateAuditCompletion(patient);
  if (state.currentCalls[patient.moduleId]?.id === patient.id) {
    state.currentCalls[patient.moduleId] = {
      ...state.currentCalls[patient.moduleId],
      ...patient,
      status: 'completed',
      completedAt: patient.completedAt
    };
  }
  syncCurrentCallFromModules();
  deferSqlWork('COMPLETE_PATIENT', async () => {
    await sqlService.upsertPatient(patient);
    if (auditRow) await sqlService.updateAuditCompletion(auditRow);
  });
  state = saveState(state);
  broadcastState();
  return res.json({ ok: true, patient, state });
}));


app.post('/api/internal-announcements', requireAuth, requireRoles('ADMIN','OPERADOR','RECEPCION'), asyncRoute(async (req, res) => {
  const targetName = normalizeTextField(req.body?.targetName || '');
  const message = normalizeTextField(req.body?.message || '');
  if (!targetName) return res.status(400).json({ ok: false, message: 'Debe indicar el nombre o Ã¡rea interna para el comunicado.' });
  const authUser = req.auth.user || {};
  const originModuleId = normalizeModule(req.body?.moduleId || authUser.moduleId || '');
  const originLabel = normalizeTextField(req.body?.originLabel || getModuleMeta(originModuleId).label || (String(authUser.role || '').toUpperCase() === 'ADMIN' ? 'ADMINISTRACIÃ“N' : 'MÃ“DULO'));
  const cleanMessage = String(message || '').replace(/\.+$/g, '').trim();
  const announcementText = cleanMessage
    ? `${targetName}. ${cleanMessage}.`
    : `${targetName}. ACERCARSE AL ÃREA SOLICITADA.`;
  const row = {
    id: nextEventId(),
    type: 'internal',
    targetName,
    message,
    originModuleId: originModuleId || null,
    originLabel,
    requestedBy: getActorUsername(req),
    createdAt: new Date().toISOString(),
    repeatCount: Math.max(1, Number(req.body?.repeatCount || 1)),
    announcementText
  };
  state.internalAnnouncements = [row, ...(Array.isArray(state.internalAnnouncements) ? state.internalAnnouncements : [])].slice(0, 60);
  deferSqlWork('INTERNAL_ANNOUNCEMENT', async () => { await sqlService.persistInternalAnnouncement(row); });
  state = saveState(state);
  io.emit('staff:announcement', row);
  broadcastState();
  return res.json({ ok: true, announcement: row, state });
}));

app.post('/api/video-sync/play', requireAuth, requireRoles('ADMIN'), asyncRoute(async (req, res) => {
  const url = String(req.body?.url || '').trim();
  const name = String(req.body?.name || '').trim();
  if (!url) return res.status(400).json({ ok: false, message: 'Debe indicar el video a reproducir.' });
  const ext = path.extname(decodeURIComponent(url.split('?')[0] || '')).toLowerCase();
  const requestedEngine = String(req.body?.engine || '').trim().toLowerCase();
  const canUseHtml5 = HTML5_MEDIA_EXTENSIONS.has(ext);
  const autoEngine = canUseHtml5 ? 'html5' : (getVlcConfig().enabled === true ? 'vlc_external' : 'html5');
  const engine = requestedEngine === 'vlc_external' && getVlcConfig().enabled === true
    ? 'vlc_external'
    : requestedEngine === 'html5'
      ? 'html5'
      : autoEngine;
  videoSyncState = {
    ...freezeVideoSyncState(),
    managedByAdmin: true,
    currentVideoUrl: url,
    currentVideoName: name || url.split('/').pop(),
    currentTime: Math.max(0, Number(req.body?.currentTime || 0)),
    isPlaying: true,
    loop: false,
    engine,
    html5Compatible: canUseHtml5,
    updatedAt: new Date().toISOString()
  };
  broadcastVideoState();
  const vlcResult = videoSyncState.engine === 'vlc_external' ? await syncVlcWithVideoState(videoSyncState) : null;
  return res.json({ ok: true, videoSyncState, vlc: vlcResult });
}));
app.post('/api/video-sync/pause', requireAuth, requireRoles('ADMIN'), (req, res) => {
  videoSyncState = { ...freezeVideoSyncState(), managedByAdmin: true, isPlaying: false, updatedAt: new Date().toISOString() };
  broadcastVideoState();
  if (videoSyncState.engine === 'vlc_external') {
    syncVlcWithVideoState(videoSyncState).catch(() => {});
  }
  return res.json({ ok: true, videoSyncState });
});
app.post('/api/video-sync/resume', requireAuth, requireRoles('ADMIN'), (req, res) => {
  videoSyncState = { ...freezeVideoSyncState(), managedByAdmin: true, isPlaying: true, updatedAt: new Date().toISOString() };
  broadcastVideoState();
  if (videoSyncState.engine === 'vlc_external') {
    syncVlcWithVideoState(videoSyncState).catch(() => {});
  }
  return res.json({ ok: true, videoSyncState });
});
app.post('/api/video-sync/control', requireAuth, requireRoles('ADMIN'), asyncRoute(async (req, res) => {
  const patch = {};
  if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'currentTime')) patch.currentTime = Math.max(0, Number(req.body.currentTime || 0));
  if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'volume')) patch.volume = Math.max(0, Math.min(1, Number(req.body.volume)));
  if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'muted')) patch.muted = req.body.muted === true;
  if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'playbackRate')) patch.playbackRate = Math.max(0.5, Math.min(2, Number(req.body.playbackRate || 1)));
  if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'loop')) patch.loop = false; // Loop desactivado permanentemente para evitar repeticiones.
  if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'controlsVisible')) patch.controlsVisible = req.body.controlsVisible === true;
  if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'isPlaying')) patch.isPlaying = req.body.isPlaying !== false;
  videoSyncState = { ...freezeVideoSyncState(), managedByAdmin: true, ...patch, updatedAt: new Date().toISOString() };
  if (Object.prototype.hasOwnProperty.call(patch, 'volume')) state.settings.mediaVolume = videoSyncState.volume;
  if (Object.prototype.hasOwnProperty.call(patch, 'muted')) state.settings.mediaMuted = videoSyncState.muted === true;
  if (Object.prototype.hasOwnProperty.call(patch, 'volume') || Object.prototype.hasOwnProperty.call(patch, 'muted')) {
    state = saveState(state);
  }
  broadcastVideoState();
  if (Object.prototype.hasOwnProperty.call(patch, 'volume') || Object.prototype.hasOwnProperty.call(patch, 'muted')) {
    io.emit('audio:settings', { source: 'media-control', enabled: state.settings.audioEnabled !== false, muted: videoSyncState.muted, volume: videoSyncState.volume });
  }
  const vlcResult = videoSyncState.engine === 'vlc_external' ? await syncVlcWithVideoState(videoSyncState) : null;
  return res.json({ ok: true, videoSyncState, vlc: vlcResult });
}));

app.post('/api/settings/audio', requireAuth, requireRoles('ADMIN'), asyncRoute(async (req, res) => {
  const patch = { ...freezeVideoSyncState() };
  state.settings.audioEnabled = req.body?.enabled !== false;

  if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'volume')) {
    patch.volume = Math.max(0, Math.min(1, Number(req.body.volume)));
    state.settings.mediaVolume = patch.volume;
  }
  if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'muted')) {
    patch.muted = req.body.muted === true;
    state.settings.mediaMuted = patch.muted;
  } else if (state.settings.audioEnabled === false) {
    patch.muted = true;
    state.settings.mediaMuted = true;
  } else if (state.settings.audioEnabled === true) {
    patch.muted = false;
    state.settings.mediaMuted = false;
  }

  videoSyncState = {
    ...patch,
    updatedAt: new Date().toISOString()
  };
  broadcastVideoState();
  state = saveState(state);
  io.emit('audio:settings', { source: 'media-control', enabled: state.settings.audioEnabled, muted: videoSyncState.muted, volume: videoSyncState.volume });
  broadcastState();
  if (videoSyncState.engine === 'vlc_external') {
    await syncVlcWithVideoState(videoSyncState).catch(() => null);
  }
  return res.json({ ok: true, enabled: state.settings.audioEnabled, state, videoSyncState });
}));


app.get('/api/vlc/status', requireAuth, requireRoles('ADMIN'), asyncRoute(async (_req, res) => {
  const status = await ensureVlcReady();
  return res.json({
    ok: status.ok === true,
    engine: getDesiredVideoEngine(),
    enabled: getVlcConfig().enabled === true,
    detail: status.data || null,
    message: status.message || null
  });
}));

app.post('/api/video-sync/engine', requireAuth, requireRoles('ADMIN'), asyncRoute(async (req, res) => {
  const requested = String(req.body?.engine || '').trim().toLowerCase();
  const allowed = new Set(['html5', 'vlc_external']);
  if (!allowed.has(requested)) return res.status(400).json({ ok: false, message: 'Motor de video no vÃ¡lido.' });
  if (requested === 'vlc_external' && getVlcConfig().enabled !== true) {
    return res.status(400).json({ ok: false, message: 'Active VLC en config/vlc.json antes de usar este motor.' });
  }
  videoSyncState = { ...freezeVideoSyncState(), managedByAdmin: true, engine: requested, updatedAt: new Date().toISOString() };
  broadcastVideoState();
  if (requested === 'vlc_external') {
    const vlcResult = await syncVlcWithVideoState(videoSyncState);
    return res.json({ ok: vlcResult.ok === true, videoSyncState, vlc: vlcResult });
  }
  return res.json({ ok: true, videoSyncState });
}));

app.post('/api/reset', requireAuth, requireRoles('ADMIN'), (_req, res) => {
  state = saveState(clone(defaultState));
  broadcastState();
  return res.json({ ok: true, state });
});

app.use((error, _req, res, _next) => {
  console.error('[QHALI ERROR]', error);
  return res.status(500).json({ ok: false, message: error.message || 'Error interno del sistema.' });
});

(async () => {
  try {
    const syncResult = await sqlService.syncFullState(state, readUsers());
    const doctorsSync = await sqlService.syncDoctors(readDoctorsData());
    if (syncResult?.ok) {
      console.log(`[QHALI SQL SYNC] SQL sincronizado: pacientes=${syncResult.patients}, llamados=${syncResult.calls}, auditoria=${syncResult.audit}, usuarios=${syncResult.users}, medicos=${doctorsSync?.count || 0}, comunicados=${syncResult.announcements}`);
    } else if (syncResult?.reason) {
      console.warn('[QHALI SQL SYNC]', syncResult.reason);
    } else if (syncResult?.errors?.length) {
      console.warn('[QHALI SQL SYNC]', syncResult.errors.join(' | '));
    }
  } catch (error) { console.error('[QHALI SQL SYNC]', error.message); }
})();

process.on('uncaughtException', (error) => console.error('[uncaughtException]', error));
process.on('unhandledRejection', (error) => console.error('[unhandledRejection]', error));

io.on('connection', (socket) => {
  socket.emit('state:update', buildClientStateSnapshot());
  socket.emit('video:sync', getEffectiveVideoSyncState(videoSyncState));
  socket.emit('audio:settings', { source: 'initial', enabled: state.settings.audioEnabled !== false, muted: videoSyncState.muted, volume: videoSyncState.volume });
});
setInterval(() => {
  const now = Date.now();
  for (const [token, session] of activeSessions.entries()) {
    if (session.expiresAt < now) activeSessions.delete(token);
  }
}, 1000 * 60 * 15).unref();
setInterval(() => {
  if (!videoSyncState?.currentVideoUrl) return;
  if (videoSyncState.isPlaying === false) return;
  // No reenviar sincronizaciÃ³n HTML5 cada 5 segundos: eso hacÃ­a volver al video anterior
  // cuando el cliente ya habÃ­a avanzado al siguiente de forma natural.
  if (videoSyncState.engine !== 'vlc_external') return;
  broadcastVideoState();
}, 5000).unref();

server.on('error', (error) => {
  if (error?.code === 'EADDRINUSE') {
    console.error(`[QHALI STARTUP] El puerto ${PORT} ya esta en uso. Cierre otra instancia del turnero o cambie la variable PORT.`);
  } else {
    console.error('[QHALI STARTUP]', error?.message || error);
  }
  process.exit(1);
});

server.listen(PORT, () => console.log(`QHALI NAHUI activo en http://localhost:${PORT}`));


process.on('SIGINT', async () => {
  try { await store.flushStateNow?.(); } catch {}
  process.exit(0);
});
process.on('SIGTERM', async () => {
  try { await store.flushStateNow?.(); } catch {}
  process.exit(0);
});

