const fs = require('fs');
const path = require('path');

function clone(obj) { return JSON.parse(JSON.stringify(obj)); }
function todayKey(d = new Date()) { return d.toISOString().slice(0, 10); }
function safeJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return clone(fallback);
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return clone(fallback);
  }
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
}

function writeJsonAsync(file, value) {
  return fs.promises.mkdir(path.dirname(file), { recursive: true })
    .then(() => fs.promises.writeFile(file, JSON.stringify(value, null, 2), 'utf8'));
}
function compactStatePayload(value = {}) {
  const payload = { ...value };
  if (Array.isArray(payload.callHistory) && payload.callHistory.length > 50000) payload.callHistory = payload.callHistory.slice(0, 50000);
  if (Array.isArray(payload.audit) && payload.audit.length > 100000) payload.audit = payload.audit.slice(0, 100000);
  if (Array.isArray(payload.queue) && payload.queue.length > 50000) payload.queue = payload.queue.slice(-50000);
  return payload;
}

function createStore(rootDir, defaults) {
  const DATA_DIR = path.join(rootDir, 'data');
  const STATE_FILE = path.join(DATA_DIR, 'state.json');
  const USERS_FILE = path.join(DATA_DIR, 'users.json');
  const HISTORY_FILE = path.join(DATA_DIR, 'historial_diario.json');

  function ensureFiles() {
    for (const dir of [DATA_DIR]) {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(STATE_FILE)) writeJson(STATE_FILE, defaults.defaultState);
    if (!fs.existsSync(USERS_FILE)) writeJson(USERS_FILE, defaults.defaultUsers);
    if (!fs.existsSync(HISTORY_FILE)) writeJson(HISTORY_FILE, {});
  }

  function readState() {
    return defaults.normalizeState(safeJson(STATE_FILE, defaults.defaultState));
  }

  let pendingStatePayload = null;
  let stateFlushTimer = null;
  let stateFlushPromise = Promise.resolve();

  function flushStateToDisk(payload) {
    stateFlushPromise = stateFlushPromise
      .then(async () => {
        const history = safeJson(HISTORY_FILE, {});
        history[todayKey()] = payload;
        await Promise.all([
          writeJsonAsync(STATE_FILE, payload),
          writeJsonAsync(HISTORY_FILE, history)
        ]);
      })
      .catch(() => {});
    return stateFlushPromise;
  }

  function scheduleStateFlush(payload) {
    pendingStatePayload = payload;
    if (stateFlushTimer) clearTimeout(stateFlushTimer);
    stateFlushTimer = setTimeout(() => {
      const snapshot = pendingStatePayload;
      pendingStatePayload = null;
      stateFlushTimer = null;
      flushStateToDisk(snapshot);
    }, 25);
  }

  function saveState(nextState) {
    const payload = defaults.normalizeState(compactStatePayload({ ...nextState, updatedAt: new Date().toISOString() }));
    scheduleStateFlush(payload);
    return payload;
  }

  function readUsers() {
    const rows = safeJson(USERS_FILE, defaults.defaultUsers);
    return Array.isArray(rows) ? rows : clone(defaults.defaultUsers);
  }

  function saveUsers(users) {
    writeJson(USERS_FILE, users);
    return users;
  }

  return {
    DATA_DIR,
    STATE_FILE,
    USERS_FILE,
    HISTORY_FILE,
    ensureFiles,
    readState,
    saveState,
    readUsers,
    saveUsers,
    flushStateNow: () => {
      if (stateFlushTimer) {
        clearTimeout(stateFlushTimer);
        stateFlushTimer = null;
      }
      const snapshot = pendingStatePayload;
      pendingStatePayload = null;
      return snapshot ? flushStateToDisk(snapshot) : stateFlushPromise;
    },
    safeJson,
    writeJson,
    todayKey,
    clone
  };
}

module.exports = { createStore, clone, todayKey, safeJson, writeJson };
