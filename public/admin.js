const currentUser = requireSession(['ADMIN','RECEPCION']);
attachSessionHeader();
const userForm = document.getElementById('userForm');
const usersList = document.getElementById('usersList');
const usersSummary = document.getElementById('usersSummary');
const diagnosticsBox = document.getElementById('diagnosticsBox');
const form = document.getElementById('patientForm');
const formMessage = document.getElementById('formMessage');
const adminQueue = document.getElementById('adminQueue');
const historyAdmin = document.getElementById('historyAdmin');
const currentCallsAdmin = document.getElementById('currentCallsAdmin');
const quickModuleActions = document.getElementById('quickModuleActions');
const resetAllBtn = document.getElementById('resetAll');
const clearAllCallsBtn = document.getElementById('clearAllCalls');
const moduleSelect = document.getElementById('moduleId');
const areaInput = document.getElementById('areaInput');
const doctorSelect = document.getElementById('doctorName');
const moduleLauncher = document.getElementById('moduleLauncher');
const auditAdmin = document.getElementById('auditAdmin');
const immediateReferralModuleSelect = document.getElementById('immediateReferralModuleId');
const immediateReferralDoctorSelect = document.getElementById('immediateReferralDoctorName');
const userModuleSelect = document.getElementById('userModuleId');
const userDoctorSelect = document.getElementById('userDoctorName');
const dniInput = document.getElementById('dniInput');
const firstNameInput = document.getElementById('firstNameInput');
const lastNameInput = document.getElementById('lastNameInput');
const lookupDniAdmin = document.getElementById('lookupDniAdmin');
const lookupPatientAdmin = document.getElementById('lookupPatientAdmin');
const enableGlobalAudioBtn = document.getElementById('enableGlobalAudio');
const disableGlobalAudioBtn = document.getElementById('disableGlobalAudio');
const videoSyncList = document.getElementById('videoSyncList');
const pauseVideoSyncBtn = document.getElementById('pauseVideoSync');
const resumeVideoSyncBtn = document.getElementById('resumeVideoSync');
const globalVolumeRange = document.getElementById('globalVolumeRange');
const globalPlaybackRate = document.getElementById('globalPlaybackRate');
const globalSeekSeconds = document.getElementById('globalSeekSeconds');
const applyVideoControlsBtn = document.getElementById('applyVideoControls');
const muteVideoSyncBtn = document.getElementById('muteVideoSync');
const unmuteVideoSyncBtn = document.getElementById('unmuteVideoSync');
const toggleLoopVideoSyncBtn = document.getElementById('toggleLoopVideoSync');
const toggleNativeControlsBtn = document.getElementById('toggleNativeControls');
let lastVideoSyncState = {};
const internalAnnouncementForm = document.getElementById('internalAnnouncementForm');
const internalAnnouncementHistory = document.getElementById('internalAnnouncementHistory');
const kpiBoard = document.getElementById('kpiBoard');
let latestAdminState = null;

function normalizeTextPayload(payload = {}) {
  const next = { ...payload };
  ['firstName', 'lastName', 'area', 'notes', 'code', 'fullName'].forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(next, key) && typeof next[key] === 'string') {
      next[key] = toUppercaseValue(next[key]);
    }
  });
  return next;
}


async function refreshAdminState() {
  const freshState = await api('/api/state');
  render(freshState);
  return freshState;
}

async function runAdminAction(action, options = {}) {
  const result = await action();
  if (options.refreshSupport === true) await refreshSupportPanels();
  if (options.message) showMessage(options.message);
  return result;
}



function getActiveAdminPatientForFamilyCall() {
  const currentCalls = latestAdminState?.currentCalls || {};
  const directCurrent = latestAdminState?.currentCall;
  if (directCurrent?.id) return directCurrent;
  const activeFromCalls = Object.values(currentCalls).find((item) => item && ['called', 'attended'].includes(String(item.status || '').toLowerCase()));
  if (activeFromCalls?.id) return activeFromCalls;
  const queue = Array.isArray(latestAdminState?.queue) ? latestAdminState.queue : [];
  const activeFromQueue = queue
    .filter((item) => item && ['called', 'attended'].includes(String(item.status || '').toLowerCase()))
    .sort((a, b) => new Date(b.calledAt || b.arrivedAt || b.updatedAt || b.createdAt || 0) - new Date(a.calledAt || a.arrivedAt || a.updatedAt || a.createdAt || 0))[0];
  return activeFromQueue || null;
}

function ensureFamilyCallButton() {
  if (!internalAnnouncementForm || document.getElementById('callFamilyBtn')) return;
  const actions = internalAnnouncementForm.querySelector('.actions');
  if (!actions) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'callFamilyBtn';
  button.className = 'ghost-btn';
  button.textContent = 'Llamar familiar del paciente actual';
  button.disabled = true;
  actions.insertBefore(button, actions.firstChild);
  button.addEventListener('click', async () => {
    const activeCall = getActiveAdminPatientForFamilyCall();
    if (!activeCall) {
      showMessage('No hay un paciente activo para llamar a su familiar.', true);
      return;
    }
    const patientName = toUppercaseValue(activeCall.displayName || `${activeCall.firstName || ''} ${activeCall.lastName || ''}`.trim());
    const moduleLabel = toUppercaseValue(activeCall.moduleLabel || getModuleMeta(activeCall.moduleId || '').label || 'EL ÁREA CLÍNICA');
    try {
      await api('/api/internal-announcements', {
        method: 'POST',
        body: JSON.stringify({
          targetName: `FAMILIAR DE ${patientName}`,
          message: `ACERCARSE A ${moduleLabel}`,
          repeatCount: 2,
          originLabel: 'ADMINISTRACIÓN',
          requestedBy: currentUser?.username || 'administracion'
        })
      });
      showMessage('Llamado al familiar emitido correctamente.');
    } catch (error) {
      showMessage(error.message, true);
    }
  });
}

function updateFamilyCallButton() {
  ensureFamilyCallButton();
  const button = document.getElementById('callFamilyBtn');
  if (!button) return;
  const activeCall = getActiveAdminPatientForFamilyCall();
  button.disabled = !activeCall;
  button.textContent = activeCall
    ? `Llamar familiar de ${toUppercaseValue(activeCall.displayName || `${activeCall.firstName || ''} ${activeCall.lastName || ''}`.trim())}`
    : 'Llamar familiar del paciente actual';
}

function renderInternalAnnouncements(items = []) {
  if (!internalAnnouncementHistory) return;
  if (!items.length) {
    internalAnnouncementHistory.innerHTML = '<div class="empty-state small">No hay comunicados internos recientes.</div>';
    return;
  }
  internalAnnouncementHistory.innerHTML = items.slice(0, 10).map((item) => `
    <article class="admin-row compact">
      <div>
        <div class="row-badges"><span class="mini-code">INTERNO</span></div>
        <h4>${escapeHtml(item.targetName || '')}</h4>
        <p class="muted">${escapeHtml(item.message || 'ACERCARSE AL ÁREA SOLICITADA')}</p>
        <p class="muted">${escapeHtml(item.originLabel || 'Administración')} · ${escapeHtml(formatDateTime(item.createdAt))}</p>
      </div>
      <div class="row-actions">
        <button type="button" class="ghost-btn small-btn" data-repeat-announcement="${escapeHtml(item.id)}">Repetir llamado</button>
      </div>
    </article>
  `).join('');
}

function showMessage(message, isError = false) {
  formMessage.textContent = message;
  formMessage.classList.toggle('error', isError);
}

function paintModuleOptions() {
  const registrationModules = (TURNERO_CONFIG.modules || []).filter((module) => !['examenes', 'imagenes'].includes(module.id));
  const options = registrationModules.map((module) => `<option value="${module.id}" data-room="${module.room}">${module.label}</option>`).join('');
  moduleSelect.innerHTML = options;
  if (userModuleSelect) userModuleSelect.innerHTML = `<option value="">Sin área clínica</option>${options}`;
  syncAreaByModule();
  syncDoctorOptions();
  syncImmediateReferralOptions();
  syncUserDoctorOptions();
}

function syncAreaByModule() {
  const selected = getModuleMeta(moduleSelect.value);
  areaInput.value = selected.room || selected.label || 'Área clínica';
}

function getImmediateReferralTargets(originModuleId = '') {
  return (TURNERO_CONFIG.modules || []).filter((module) => module.id !== originModuleId);
}

function syncDoctorOptions() {
  const selected = getModuleMeta(moduleSelect.value || 'consultorio');
  if (selected.id === 'optometria') {
    doctorSelect.innerHTML = '<option value="">Optometría general</option>';
    doctorSelect.value = '';
    return;
  }
  doctorSelect.innerHTML = buildModuleDoctorOptions(selected.id, doctorSelect.value || selected.doctors?.[0] || '', 'Seleccione especialidad / subárea');
  if (!doctorSelect.value && selected.doctors?.[0]) doctorSelect.value = selected.doctors[0];
}

function syncImmediateReferralOptions() {
  if (!immediateReferralModuleSelect || !immediateReferralDoctorSelect) return;
  const currentModuleId = moduleSelect.value || '';
  const targets = getImmediateReferralTargets(currentModuleId);
  const previous = immediateReferralModuleSelect.value;
  immediateReferralModuleSelect.innerHTML = `<option value="">Sin referencia inmediata</option>${targets.map((module) => `<option value="${module.id}">${escapeHtml(module.label)}</option>`).join('')}`;
  if (targets.some((item) => item.id === previous)) immediateReferralModuleSelect.value = previous;
  syncImmediateReferralDoctors();
}

function syncImmediateReferralDoctors() {
  if (!immediateReferralDoctorSelect) return;
  const targetId = immediateReferralModuleSelect?.value || '';
  if (!targetId) {
    immediateReferralDoctorSelect.innerHTML = '<option value="">Especialidad automática del módulo</option>';
    return;
  }
  immediateReferralDoctorSelect.innerHTML = buildModuleDoctorOptions(targetId, immediateReferralDoctorSelect.value || '', 'Especialidad automática del módulo');
}

function syncUserDoctorOptions() {
  if (!userDoctorSelect || !userModuleSelect) return;
  const selected = getModuleMeta(userModuleSelect.value || 'consultorio');
  userDoctorSelect.innerHTML = `<option value="">Sin especialidad fija</option>${(selected.doctors || []).map((doctor) => `<option value="${escapeHtml(doctor)}">${escapeHtml(doctor)}</option>`).join('')}`;
}

function rowButtons(item) {
  return `
    <div class="row-actions">
      <button class="primary-btn small-btn" data-action="call" data-id="${item.id}">Llamar</button>
      <button class="ghost-btn small-btn" data-action="waiting" data-id="${item.id}">En espera</button>
      <button class="ghost-btn small-btn danger" data-action="delete" data-id="${item.id}">Eliminar</button>
    </div>
  `;
}

function renderQuickButtons() {
  quickModuleActions.innerHTML = (TURNERO_CONFIG.modules || []).map((module) => `
    <button class="primary-btn module-quick-btn ${module.id}" data-module-id="${module.id}">
      Llamar siguiente · ${module.label}
    </button>
  `).join('');

  moduleLauncher.innerHTML = (TURNERO_CONFIG.modules || []).map((module) => `
    <article class="highlight-card compact module-highlight ${module.id}">
      <div>
        <p class="section-kicker compact">${escapeHtml(module.label)}</p>
        <h3>${escapeHtml(module.label)}</h3>
        <p class="muted">Ingreso seguro con usuario y contraseña propia para esta área clínica</p>
      </div>
      <div class="row-actions">
        <a class="ghost-btn small-btn link-btn" target="_blank" href="/login.html?module=${module.id}&area=${encodeURIComponent(module.label)}&next=${encodeURIComponent(`/operator.html?module=${module.id}`)}">Iniciar sesión</a>
      </div>
    </article>
  `).join('');
}

function renderAdminQueue(queue = []) {
  if (!queue.length) {
    adminQueue.innerHTML = '<div class="empty-state small">No hay pacientes registrados.</div>';
    return;
  }

  adminQueue.innerHTML = [...queue].sort(byCodeOrder).map((item) => {
    const module = getModuleMeta(item.moduleId);
    return `
      <article class="admin-row">
        <div>
          <div class="row-badges">
            ${renderAttentionCodeBadge(item.code, item.doctorName, 'mini-code')}
            <span class="tag-module ${escapeHtml(item.moduleId)}">${escapeHtml(module.label)}</span>
          </div>
          <h3>${escapeHtml(item.firstName)} ${escapeHtml(item.lastName)}</h3>
          <p class="muted">DNI: ${escapeHtml(item.dni || '-')} · Destino: ${escapeHtml(item.area || module.room)} · Especialidad: ${escapeHtml(item.doctorName || '')}</p>
          <p class="muted">Estado: ${escapeHtml(item.status)} · Registrado: ${formatDateTime(item.createdAt)}</p>
        </div>
        ${rowButtons(item)}
      </article>
    `;
  }).join('');
}

function normalizeKpiPatientKey(item = {}) {
  const dni = String(item.dni || item.patientDni || '').replace(/\D/g, '').trim();
  if (dni) return 'DNI:' + dni;
  const source = item.referralSourcePatientId || item.patientId || item.id || '';
  return 'ID:' + String(source).trim();
}

function uniqueByPatient(rows = []) {
  const map = new Map();
  rows.forEach((row) => {
    const key = normalizeKpiPatientKey(row);
    if (!key || key === 'ID:') return;
    if (!map.has(key)) map.set(key, row);
  });
  return [...map.values()];
}

function averagePatientMinutes(auditRows = [], field = 'waitMinutes', options = {}) {
  const grouped = new Map();
  auditRows.forEach((row) => {
    const key = normalizeKpiPatientKey(row);
    if (!key || key === 'ID:') return;
    const value = Number(row[field]);
    if (!Number.isFinite(value)) return;
    if (options.positiveOnly === true && value <= 0) return;
    const previous = grouped.get(key);
    if (previous === undefined || value < previous) grouped.set(key, value);
  });
  const values = [...grouped.values()];
  return values.length ? Math.round(values.reduce((s, v) => s + v, 0) / values.length) : 0;
}

function buildAdminKpis(state = {}) {
  const queue = Array.isArray(state.queue) ? state.queue : [];
  const audit = Array.isArray(state.audit) ? state.audit : [];
  const history = Array.isArray(state.callHistory) ? state.callHistory : [];
  const uniquePatients = uniqueByPatient(queue);
  const waiting = uniqueByPatient(queue.filter((item) => item.status === 'waiting'));
  const inRoom = uniqueByPatient(queue.filter((item) => item.status === 'attended'));
  const referredPending = uniqueByPatient(queue.filter((item) => item.status === 'waiting' && (item.isReferred || item.referred)));
  const completed = uniqueByPatient(queue.filter((item) => item.status === 'completed'));
  const callsById = new Set(history.map((item) => item.eventId || item.callId || String(item.id || item.patientId || '') + '-' + String(item.calledAt || item.announcementAt || '')).filter(Boolean));
  const totalCalls = callsById.size || history.length;
  const repeated = uniqueByPatient(audit.filter((item) => Number(item.repeatCount || 0) > 0)).length;
  const arrivedAudit = audit.filter((item) => item.arrivedAt || item.completedAt);
  const completedAudit = audit.filter((item) => item.completedAt);
  const avgWait = averagePatientMinutes(audit, 'waitMinutes');
  const avgAttention = averagePatientMinutes(completedAudit, 'attentionMinutes', { positiveOnly: true });
  const attendedPatients = uniqueByPatient(completedAudit).length;
  return [
    { label: 'Pacientes del día', value: uniquePatients.length, note: waiting.length + ' únicos en espera', tone: 'accent-blue' },
    { label: 'Llamados emitidos', value: totalCalls, note: repeated + ' pacientes con rellamado', tone: 'accent-green' },
    { label: 'Pacientes en sala', value: inRoom.length, note: completed.length + ' pacientes cerrados', tone: 'accent-purple' },
    { label: 'Referencias activas', value: referredPending.length, note: 'Pacientes únicos pendientes', tone: 'accent-gold' },
    { label: 'Espera promedio', value: formatMinutes(avgWait), note: 'Promedio por paciente único', tone: 'accent-blue' },
    { label: 'Atención promedio', value: formatMinutes(avgAttention), note: attendedPatients + ' pacientes atendidos', tone: 'accent-red' }
  ];
}

function renderKpis(state = {}) {
  if (!kpiBoard) return;
  const items = buildAdminKpis(state);
  kpiBoard.innerHTML = items.map((item) => `
    <article class="kpi-card ${item.tone || ''}">
      <span>${escapeHtml(item.label)}</span>
      <strong>${escapeHtml(item.value)}</strong>
      <small>${escapeHtml(item.note || '')}</small>
    </article>
  `).join('');
}

function renderCurrentCalls(currentCalls = {}, metrics = {}) {
  currentCallsAdmin.innerHTML = (TURNERO_CONFIG.modules || []).map((module) => {
    const item = currentCalls[module.id];
    const metric = metrics[module.id] || {};
    return `
      <article class="highlight-card module-highlight ${module.id}">
        <div>
          <p class="section-kicker compact">${escapeHtml(module.label)}</p>
          <h3>${item ? escapeHtml(item.displayName) : 'Sin llamado actual'}</h3>
          <p class="muted">${item ? `${escapeHtml(item.code)} · ${escapeHtml(item.area)} · ${escapeHtml(item.doctorName || '')}` : escapeHtml(module.room)}</p>
          <p class="muted">Prom. espera ${formatMinutes(metric.averageWaitMinutes || 0)} · Prom. atención ${formatMinutes(metric.averageAttentionMinutes || 0)}</p>
        </div>
        <button class="ghost-btn small-btn" data-action="clear-module-call" data-module-id="${module.id}">Limpiar</button>
      </article>
    `;
  }).join('');
}

function renderHistory(history = []) {
  if (!history.length) {
    historyAdmin.innerHTML = '<div class="empty-state small">No hay historial todavía.</div>';
    return;
  }

  historyAdmin.innerHTML = history.slice(0, 20).map((item) => `
    <article class="admin-row compact">
      <div>
        <div class="row-badges">
          ${renderAttentionCodeBadge(item.code, item.doctorName, 'mini-code')}
          <span class="tag-module ${escapeHtml(item.moduleId)}">${escapeHtml(item.moduleLabel || getModuleMeta(item.moduleId).label)}</span>
        </div>
        <h3>${escapeHtml(item.displayName || `${item.firstName} ${item.lastName}`)}</h3>
        <p class="muted">${escapeHtml(item.area || 'Módulo')} · ${escapeHtml(item.doctorName || '')} · ${formatDateTime(item.calledAt)}</p>
      </div>
      <div class="row-actions">
        <button class="ghost-btn small-btn danger" data-action="delete-history" data-id="${item.id}">Eliminar</button>
      </div>
    </article>
  `).join('');
}

function renderAudit(rows = []) {
  if (!auditAdmin) return;
  if (!rows.length) {
    auditAdmin.innerHTML = '<div class="empty-state small">Aún no hay auditoría diaria. Se llena desde el primer llamado del día y se reinicia con un nuevo día de trabajo.</div>';
    return;
  }
  auditAdmin.innerHTML = rows.slice(0, 20).map((item) => `
    <article class="admin-row compact">
      <div>
        <div class="row-badges">
          <span class="mini-code">${escapeHtml(item.patientCode)}</span>
          <span class="tag-module ${escapeHtml(item.moduleId)}">${escapeHtml(item.moduleLabel)}</span>
        </div>
        <h3>${escapeHtml(item.patientName)}</h3>
        <p class="muted">${escapeHtml(item.doctorName || '')} · Operador: ${escapeHtml(item.operatorName || item.operatorUsername || 'Asignado')}</p>
        <p class="muted">Espera ${formatSeconds(item.waitSeconds)} · Atención ${formatSeconds(item.attentionSeconds)} · Gap ${formatSeconds(item.nextCallGapSeconds || 0)}</p>
      </div>
      <div class="row-actions"><span class="muted">${formatDateTime(item.calledAt)}</span></div>
    </article>
  `).join('');
}

function render(state) {
  latestAdminState = state || latestAdminState;

  renderAdminQueue(state.queue || []);
  renderInternalAnnouncements(state.internalAnnouncements || []);
  updateFamilyCallButton();
  renderCurrentCalls(state.currentCalls || {}, state.moduleMetrics || {});
  renderKpis(state);
  renderHistory(state.callHistory || []);
  renderAudit(state.audit || []);
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const payload = normalizeTextPayload(Object.fromEntries(new FormData(form).entries()));
  payload.registeredBy = currentUser.username;
  try {
    const created = await api('/api/patients', { method: 'POST', body: JSON.stringify(payload) });
    const targetModuleId = String(payload.immediateReferralModuleId || '').trim();
    if (targetModuleId && created?.patient?.id) {
      const targetMeta = getModuleMeta(targetModuleId);
      const targetDoctor = String(payload.immediateReferralDoctorName || '').trim() || targetMeta.doctors?.[0] || '';
      await api(`/api/patients/${created.patient.id}/derive`, {
        method: 'POST',
        body: JSON.stringify({
          moduleId: targetModuleId,
          area: ['consultorio', 'ipl', 'cirugia'].includes(targetMeta.id) ? (targetDoctor || targetMeta.room) : targetMeta.room,
          doctorName: targetDoctor,
          notes: payload.notes || 'REFERENCIA INMEDIATA DESDE REGISTRO',
          immediate: true,
          operatorUsername: currentUser.username,
          operatorName: currentUser.fullName,
          derivedBy: currentUser.username
        })
      });
    }
    form.reset();
    paintModuleOptions();
    showMessage(targetModuleId ? 'Paciente registrado y referido de inmediato correctamente.' : 'Paciente registrado correctamente.');
  } catch (error) {
    showMessage(error.message, true);
  }
});

moduleSelect.addEventListener('change', () => {
  syncAreaByModule();
  syncDoctorOptions();
  syncImmediateReferralOptions();
});
immediateReferralModuleSelect?.addEventListener('change', syncImmediateReferralDoctors);
userModuleSelect?.addEventListener('change', syncUserDoctorOptions);

adminQueue.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const { action, id } = button.dataset;

  try {
    if (action === 'call') await api(`/api/call/${id}`, { method: 'POST' });
    if (action === 'waiting') await api(`/api/patients/${id}/status`, { method: 'POST', body: JSON.stringify({ status: 'waiting' }) });
    if (action === 'delete') await api(`/api/patients/${id}`, { method: 'DELETE' });
  } catch (error) {
    showMessage(error.message, true);
  }
});

historyAdmin.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action="delete-history"]');
  if (!button) return;
  try {
    await api(`/api/history/${button.dataset.id}`, { method: 'DELETE' });
  } catch (error) {
    showMessage(error.message, true);
  }
});

currentCallsAdmin.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action="clear-module-call"]');
  if (!button) return;
  try {
    await api(`/api/current-call/${button.dataset.moduleId}`, { method: 'DELETE' });
  } catch (error) {
    showMessage(error.message, true);
  }
});

quickModuleActions.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-module-id]');
  if (!button) return;
  try {
    await runAdminAction(() => api(`/api/call-next/${button.dataset.moduleId}`, { method: 'POST', body: JSON.stringify({ operatorUsername: currentUser.username, operatorName: currentUser.fullName }) }), { message: 'Siguiente paciente llamado correctamente.', refreshState: true, refreshSupport: false });
  } catch (error) {
    showMessage(error.message, true);
  }
});

clearAllCallsBtn.addEventListener('click', async () => {
  try {
    await api('/api/current-call', { method: 'DELETE' });
    showMessage('Llamados limpiados correctamente.');
  } catch (error) {
    showMessage(error.message, true);
  }
});

resetAllBtn.addEventListener('click', async () => {
  if (!window.confirm('Esto borrará cola, llamados e historial. ¿Desea continuar?')) return;
  try {
    await api('/api/reset', { method: 'POST' });
    showMessage('Sistema reiniciado correctamente.');
  } catch (error) {
    showMessage(error.message, true);
  }
});

socket.on('state:update', render);
socket.on('video:sync', (payload = {}) => {
  TURNERO_CONFIG.videoSyncState = payload;
  renderVideoSyncPanel(TURNERO_CONFIG);
});
socket.on('staff:announcement', (payload = {}) => {
  if (payload.targetName) showMessage(`Llamado de apoyo enviado al panel principal: ${payload.targetName}`);
});

function renderUserSummary(users = []) {
  if (!usersSummary) return;
  const roles = ['ADMIN', 'RECEPCION', 'OPERADOR'];
  usersSummary.innerHTML = roles.map((role) => {
    const items = users.filter((user) => String(user.role || '').toUpperCase() === role);
    const active = items.filter((user) => user.isActive !== false).length;
    return `
      <article class="highlight-card compact">
        <div>
          <p class="section-kicker compact">${escapeHtml(role)}</p>
          <h3>${items.length}</h3>
          <p class="muted">${active} activos · ${Math.max(0, items.length - active)} inactivos</p>
        </div>
      </article>
    `;
  }).join('');
}

function renderUsers(users = []) {
  if (!usersList) return;
  if (!users.length) {
    usersList.innerHTML = '<div class="empty-state small">No hay usuarios registrados.</div>';
    return;
  }
  renderUserSummary(users);
  usersList.innerHTML = users.map((item) => {
    const role = String(item.role || 'OPERADOR').toLowerCase();
    const canDeactivate = item.role === 'OPERADOR';
    return `
      <article class="admin-row compact">
        <div>
          <div class="row-badges">
            <span class="mini-code">${escapeHtml(item.id || '')}</span>
            <span class="tag-module user-role-badge ${escapeHtml(role)}">${escapeHtml((item.role || 'OPERADOR') === 'OPERADOR' ? 'USUARIO DE ÁREA' : (item.role || 'OPERADOR'))}</span>
          </div>
          <h3>${escapeHtml(item.fullName)}</h3>
          <p class="muted">${escapeHtml(item.username)} · ${item.isActive === false ? 'Inactivo' : 'Activo'}${item.lastLoginAt ? ` · Último acceso ${formatDateTime(item.lastLoginAt)}` : ''}</p>
          <p class="muted">${escapeHtml(getModuleMeta(item.moduleId || 'consultorio').label || item.moduleId || 'General')} · ${escapeHtml(item.doctorName || 'Sin especialidad fija')}</p>
        </div>
        <div class="row-actions">
          <span class="muted">${formatDateTime(item.createdAt)}</span>
          ${canDeactivate ? `<button class="ghost-btn small-btn ${item.isActive === false ? '' : 'danger'}" data-user-toggle="${escapeHtml(item.username)}" data-next-active="${item.isActive === false ? 'true' : 'false'}">${item.isActive === false ? 'Reactivar' : 'Desactivar'}</button>` : ''}
        </div>
      </article>
    `;
  }).join('');
}

function renderVideoSyncPanel(config = TURNERO_CONFIG) {
  if (!videoSyncList) return;
  const videos = config.videos || [];
  const syncState = config.videoSyncState || {};
  lastVideoSyncState = syncState;
  if (globalVolumeRange && !isAdjustingAdminVolume) globalVolumeRange.value = String(Math.round(Number(syncState.volume ?? 0.55) * 100));
  if (globalPlaybackRate) globalPlaybackRate.value = String(Number(syncState.playbackRate || 1));
  if (globalSeekSeconds) globalSeekSeconds.value = String(Math.floor(Number(syncState.currentTime || 0)));
  if (toggleLoopVideoSyncBtn) toggleLoopVideoSyncBtn.textContent = 'Loop desactivado';
  if (toggleNativeControlsBtn) toggleNativeControlsBtn.textContent = syncState.controlsVisible === false ? 'Mostrar controles' : 'Ocultar controles';
  if (!videos.length) {
    videoSyncList.innerHTML = '<div class="empty-state small">No hay videos en public/media/videos.</div>';
    return;
  }
  videoSyncList.innerHTML = videos.map((video, index) => `
    <article class="video-admin-row ${syncState.currentVideoUrl === video.url ? 'active' : ''}">
      <div>
        <div class="row-badges"><span class="mini-code">TV ${index + 1 <= 3 ? 'LAN' : index + 1}</span></div>
        <h3>${escapeHtml(video.name)}</h3>
        <p class="muted">${syncState.currentVideoUrl === video.url ? `Activo · segundo ${Math.floor(syncState.currentTime || 0)}` : 'Disponible para enviar a los 3 televisores'} · ${video.html5Compatible === false ? 'VLC externo' : 'Reproductor interno'}</p>
      </div>
      <div class="row-actions">
        <button type="button" class="primary-btn small-btn" data-video-url="${escapeHtml(video.url)}" data-video-name="${escapeHtml(video.name)}" data-video-engine="${escapeHtml(video.playbackMode || 'html5')}">Reproducir en TVs</button>
      </div>
    </article>
  `).join('');
}


async function pushVideoControlPatch(patch, successMessage) {
  await api('/api/video-sync/control', { method: 'POST', body: JSON.stringify(patch) });
  await refreshSupportPanels();
  if (successMessage) showMessage(successMessage);
}

let volumePatchTimer = null;
let isAdjustingAdminVolume = false;

function scheduleVolumePatchFromAdmin(immediate = false) {
  if (!globalVolumeRange) return;
  if (volumePatchTimer) {
    clearTimeout(volumePatchTimer);
    volumePatchTimer = null;
  }
  const applyPatch = async () => {
    try {
      const nextVolume = Number(globalVolumeRange.value || 55) / 100;
      await api('/api/settings/audio', { method: 'POST', body: JSON.stringify({ enabled: true, muted: false, volume: nextVolume }) });
      await pushVideoControlPatch({ volume: nextVolume, muted: false }, immediate ? 'Volumen aplicado a las televisiones.' : 'Volumen sincronizado en las televisiones.');
    } catch (error) {
      showMessage(error.message, true);
    }
  };
  if (immediate) {
    applyPatch();
    return;
  }
  volumePatchTimer = window.setTimeout(applyPatch, 180);
}

function renderDiagnostics(data) {
  if (!diagnosticsBox) return;
  const warnings = (data.warnings || []).length
    ? (data.warnings || []).map((w) => `<li>${escapeHtml(w)}</li>`).join('')
    : '<li>Sin observaciones críticas.</li>';
  diagnosticsBox.innerHTML = `
    <article class="admin-row compact">
      <div>
        <h3>Resumen técnico</h3>
        <p class="muted">Estado único: ${escapeHtml(data.stateFile || '-')}</p>
        <p class="muted">Historial agrupado: ${escapeHtml(data.historyFile || '-')}</p>
        <p class="muted">RENIEC: ${data.reniecConfigured ? 'Configurado' : 'Pendiente de configurar'}</p>
        <p class="muted">Config SQL Server: ${escapeHtml(data.sqlServerConfigFile || '-')}</p>
        <p class="muted">Usuarios: ${data.userCount || 0} · Operadores: ${data.operatorCount || 0} · Cola: ${data.queueCount || 0} · Esperando: ${data.waitingCount || 0}</p>
        <p class="muted">SQL: ${escapeHtml(data.sqlServerMessage || '-')}</p>
      </div>
      <div class="row-actions"><span class="mini-code">${escapeHtml((data.sqlServerStatus || 'unknown').toUpperCase())}</span></div>
    </article>
    <article class="admin-row compact"><div><h3>Advertencias</h3><ul class="diag-list">${warnings}</ul></div></article>
  `;
}

async function refreshSupportPanels() {
  try {
    const [config, users, diagnostics, audit] = await Promise.all([
      loadConfig().catch(() => TURNERO_CONFIG),
      api('/api/users', { timeoutMs: 5000 }),
      api('/api/diagnostics', { timeoutMs: 5000 }),
      api('/api/audit', { timeoutMs: 5000 })
    ]);
    if (config) TURNERO_CONFIG = config;
    renderUsers(users || []);
    renderDiagnostics(diagnostics || {});
    renderAudit(audit || []);
    renderVideoSyncPanel(TURNERO_CONFIG);
  } catch (error) {
    if (diagnosticsBox) diagnosticsBox.innerHTML = `<div class="empty-state small">${escapeHtml(error.message)}</div>`;
  }
}

if (userForm) {
  userForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = normalizeTextPayload(Object.fromEntries(new FormData(userForm).entries()));
    try {
      await api('/api/users', { method: 'POST', body: JSON.stringify(payload) });
      userForm.reset();
      if (userModuleSelect) userModuleSelect.value = '';
      syncUserDoctorOptions();
      await refreshSupportPanels();
      showMessage('Usuario creado correctamente.');
    } catch (error) {
      showMessage(error.message, true);
    }
  });
}


usersList?.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-user-toggle]');
  if (!button) return;
  try {
    await api(`/api/users/${encodeURIComponent(button.dataset.userToggle)}/status`, {
      method: 'POST',
      body: JSON.stringify({ isActive: button.dataset.nextActive === 'true' })
    });
    await refreshSupportPanels();
    showMessage('Estado del usuario actualizado correctamente.');
  } catch (error) {
    showMessage(error.message, true);
  }
});

videoSyncList?.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-video-url]');
  if (!button) return;
  try {
    await runAdminAction(() => api('/api/video-sync/play', {
      method: 'POST',
      body: JSON.stringify({ url: button.dataset.videoUrl, name: button.dataset.videoName, currentTime: 0, engine: button.dataset.videoEngine || 'html5' })
    }), { message: 'Video sincronizado para los televisores LAN.', refreshState: false, refreshSupport: true });
  } catch (error) {
    showMessage(error.message, true);
  }
});

pauseVideoSyncBtn?.addEventListener('click', async () => {
  try {
    await runAdminAction(() => api('/api/video-sync/pause', { method: 'POST' }), { message: 'Reproducción pausada en los televisores.', refreshState: false, refreshSupport: true });
  } catch (error) {
    showMessage(error.message, true);
  }
});

resumeVideoSyncBtn?.addEventListener('click', async () => {
  try {
    await runAdminAction(() => api('/api/video-sync/resume', { method: 'POST' }), { message: 'Reproducción reanudada en los televisores.', refreshState: false, refreshSupport: true });
  } catch (error) {
    showMessage(error.message, true);
  }
});


applyVideoControlsBtn?.addEventListener('click', async () => {
  try {
    await pushVideoControlPatch({
      volume: Number(globalVolumeRange?.value || 55) / 100,
      playbackRate: Number(globalPlaybackRate?.value || 1),
      currentTime: Number(globalSeekSeconds?.value || 0),
      isPlaying: true
    }, 'Parámetros completos aplicados a todas las televisiones.');
  } catch (error) {
    showMessage(error.message, true);
  }
});

muteVideoSyncBtn?.addEventListener('click', async () => {
  try {
    await pushVideoControlPatch({ muted: true }, 'Televisores silenciados correctamente.');
  } catch (error) {
    showMessage(error.message, true);
  }
});

unmuteVideoSyncBtn?.addEventListener('click', async () => {
  try {
    await pushVideoControlPatch({ muted: false, volume: Number(globalVolumeRange?.value || 55) / 100 }, 'Audio activado en todas las televisiones.');
  } catch (error) {
    showMessage(error.message, true);
  }
});

toggleLoopVideoSyncBtn?.addEventListener('click', async () => {
  try {
    await pushVideoControlPatch({ loop: false }, 'Loop desactivado: los videos avanzan al siguiente sin repetirse.');
  } catch (error) {
    showMessage(error.message, true);
  }
});

toggleNativeControlsBtn?.addEventListener('click', async () => {
  try {
    await pushVideoControlPatch({ controlsVisible: lastVideoSyncState.controlsVisible === false }, 'Visibilidad de controles actualizada en las televisiones.');
  } catch (error) {
    showMessage(error.message, true);
  }
});

globalVolumeRange?.addEventListener('input', () => {
  isAdjustingAdminVolume = true;
  scheduleVolumePatchFromAdmin(false);
});

globalVolumeRange?.addEventListener('change', () => {
  isAdjustingAdminVolume = false;
  scheduleVolumePatchFromAdmin(true);
});

globalVolumeRange?.addEventListener('mouseup', () => {
  isAdjustingAdminVolume = false;
});

globalVolumeRange?.addEventListener('touchend', () => {
  isAdjustingAdminVolume = false;
});

(async function init() {
  await loadConfig();
  paintModuleOptions();
  bindUppercaseInputs(document);
  renderQuickButtons();
  const state = await api('/api/state', { timeoutMs: 3500 });
  render(state);
  setTimeout(() => { refreshSupportPanels().catch(() => {}); }, 250);
})();

lookupDniAdmin?.addEventListener('click', async () => {
  const dni = String(dniInput?.value || '').replace(/\D/g, '');
  if (dni.length !== 8) { showMessage('Ingrese un DNI válido de 8 dígitos.', true); return; }
  showMessage('Consultando DNI...');
  try {
    const response = await api(`/api/reniec/${dni}`);
    firstNameInput.value = toUppercaseValue(response.patient?.firstName || '');
    lastNameInput.value = toUppercaseValue(response.patient?.lastName || '');
    showMessage('Datos cargados desde RENIEC.');
  } catch (error) {
    showMessage(error.message, true);
  }
});


lookupPatientAdmin?.addEventListener('click', async () => {
  const term = String(dniInput?.value || `${firstNameInput?.value || ''} ${lastNameInput?.value || ''}`).trim();
  if (!term) { showMessage('Ingrese DNI o nombre para buscar.', true); return; }
  try {
    const response = await api(`/api/search?q=${encodeURIComponent(term)}`);
    const first = (response.results || [])[0]?.patient;
    if (!first) throw new Error('No se encontraron coincidencias en memoria, SQL o RENIEC.');
    dniInput.value = first.dni || dniInput.value;
    firstNameInput.value = toUppercaseValue(first.firstName || '');
    lastNameInput.value = toUppercaseValue(first.lastName || '');
    if (first.moduleId) moduleSelect.value = first.moduleId;
    syncAreaByModule();
    syncDoctorOptions();
    syncImmediateReferralOptions();
    if (first.doctorName) doctorSelect.value = first.doctorName;
    showMessage(`Coincidencia cargada desde ${(response.results || [])[0]?.source || 'sistema'}.`);
  } catch (error) {
    showMessage(error.message, true);
  }
});




internalAnnouncementHistory?.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-repeat-announcement]');
  if (!button) return;
  const announcement = ((latestAdminState?.internalAnnouncements) || []).find((item) => String(item.id) === String(button.dataset.repeatAnnouncement));
  if (!announcement) {
    showMessage('No se encontró el comunicado para repetir.', true);
    return;
  }
  try {
    const payload = {
      targetName: announcement.targetName,
      message: announcement.message,
      repeatCount: Math.max(1, Number(announcement.repeatCount || 1)),
      originLabel: announcement.originLabel
    };
    await api('/api/internal-announcements', {
      method: 'POST',
      body: JSON.stringify({
        ...payload,
        requestedBy: currentUser?.username || 'administracion'
      })
    });
    showMessage('Comunicado interno repetido correctamente.');
  } catch (error) {
    showMessage(error.message, true);
  }
});

internalAnnouncementForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const payload = normalizeTextPayload(Object.fromEntries(new FormData(internalAnnouncementForm).entries()));
  try {
    await api('/api/internal-announcements', {
      method: 'POST',
      body: JSON.stringify({
        targetName: payload.targetName,
        message: payload.message,
        originLabel: 'ADMINISTRACIÓN',
        requestedBy: currentUser?.username || 'administracion'
      })
    });
    internalAnnouncementForm.reset();
    showMessage('Comunicado interno emitido correctamente.');
  } catch (error) {
    showMessage(error.message, true);
  }
});
enableGlobalAudioBtn?.addEventListener('click', async () => {
  try {
    await runAdminAction(() => api('/api/settings/audio', {
      method: 'POST',
      body: JSON.stringify({
        enabled: true,
        muted: false,
        volume: Number(globalVolumeRange?.value || 55) / 100
      })
    }), { message: 'Audio habilitado para todas las pantallas.', refreshState: true, refreshSupport: true });
  } catch (error) {
    showMessage(error.message, true);
  }
});

disableGlobalAudioBtn?.addEventListener('click', async () => {
  try {
    await runAdminAction(() => api('/api/settings/audio', {
      method: 'POST',
      body: JSON.stringify({
        enabled: false,
        muted: true
      })
    }), { message: 'Audio silenciado para todas las pantallas.', refreshState: true, refreshSupport: true });
  } catch (error) {
    showMessage(error.message, true);
  }
});

window.refreshPatientToolHost = refreshAdminState;
window.addEventListener('patient-search:called', () => { refreshAdminState().catch(() => {}); });

/* Gestión simple de médicos de Consultorio por Administrador */
(function qnAdminDoctorsManager(){
  const adminBody = document.querySelector('.workspace') || document.body;
  if (!adminBody || document.getElementById('qnDoctorsAdminPanel')) return;
  const section = document.createElement('section');
  section.id = 'qnDoctorsAdminPanel';
  section.className = 'panel glass';
  section.innerHTML = `<div class="section-head"><div><p class="section-kicker">Consultorio</p><h2>Registro y habilitación de médicos</h2><p class="muted">El administrador puede registrar médicos y activar/desactivar disponibilidad para la distribución automática.</p></div></div>
    <form id="qnDoctorForm" class="grid-form compact-form"><input type="hidden" name="moduleId" value="consultorio" />
      <label>Nombre del médico<input name="name" placeholder="Ej. DR. APELLIDOS NOMBRES" required /></label>
      <label>Especialidad<input name="specialty" placeholder="CONSULTORIO" value="CONSULTORIO" /></label>
      <label>Orden<input name="order" type="number" min="1" value="1" /></label>
      <div class="actions"><button type="submit" class="primary-btn">Guardar médico</button></div>
    </form><div id="qnDoctorsAdminList" class="admin-list"></div>`;
  adminBody.appendChild(section);
  const form = section.querySelector('#qnDoctorForm');
  const list = section.querySelector('#qnDoctorsAdminList');
  async function load(){
    try {
      const res = await api('/api/doctors?moduleId=consultorio');
      const doctors = res.doctors || [];
      list.innerHTML = doctors.length ? doctors.map((d)=>`<article class="admin-row compact"><div><h4>${escapeHtml(d.name)}</h4><p class="muted">${escapeHtml(d.specialty || 'CONSULTORIO')} · Orden ${escapeHtml(d.order || '')}</p></div><div class="row-actions"><button class="ghost-btn small-btn" data-qn-toggle-doctor="${escapeHtml(d.id)}" data-enabled="${d.enabled !== false ? '1':'0'}">${d.enabled !== false ? 'Deshabilitar':'Habilitar'}</button></div></article>`).join('') : '<div class="empty-state small">No hay médicos registrados.</div>';
    } catch { list.innerHTML = '<div class="empty-state small">No se pudo cargar médicos.</div>'; }
  }
  form.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const payload = Object.fromEntries(new FormData(form).entries());
    await api('/api/doctors', { method:'POST', body: JSON.stringify(payload) });
    form.reset(); form.moduleId.value='consultorio'; form.specialty.value='CONSULTORIO'; form.order.value='1';
    await load();
  });
  list.addEventListener('click', async (e)=>{
    const btn = e.target.closest('button[data-qn-toggle-doctor]'); if (!btn) return;
    await api(`/api/doctors/${encodeURIComponent(btn.dataset.qnToggleDoctor)}/status`, { method:'POST', body: JSON.stringify({ enabled: btn.dataset.enabled !== '1' }) });
    await load();
  });
  load();
})();

/* Panel definitivo de medicos activos para Consultorio. Reemplaza el panel simple anterior sin romper compatibilidad. */
(function qnAdminDoctorsManagerFinal(){
  const section = document.getElementById('qnDoctorsAdminPanel');
  if (!section || section.dataset.finalDoctorsPanel === '1') return;
  section.dataset.finalDoctorsPanel = '1';
  section.innerHTML = `<div class="section-head"><div><p class="section-kicker">Consultorio</p><h2>Registro y habilitación de médicos</h2><p class="muted">Marque con check los médicos disponibles. Consultorio reparte aleatoriamente los pacientes referidos solo entre médicos activos.</p></div></div>
    <form id="qnDoctorFormFinal" class="grid-form compact-form"><input type="hidden" name="moduleId" value="consultorio" />
      <label>Nombre del medico<input name="name" placeholder="Ej. DR. APELLIDOS NOMBRES" required /></label>
      <label>Tipo / especialidad<select name="specialty"><option value="OFTALMOLOGIA GENERAL">Medico oftalmologo</option><option value="ESPECIALISTA">Especialista</option><option value="GLAUCOMA">Glaucoma</option><option value="RETINA">Retina</option><option value="CORNEA">Cornea</option><option value="CATARATA">Catarata</option><option value="VIA LAGRIMAL">Via lagrimal</option><option value="CIRUGIA REFRACTIVA">Cirugia refractiva</option></select></label>
      <label>Orden<input name="order" type="number" min="1" value="1" /></label>
      <div class="actions"><button type="submit" class="primary-btn">Guardar medico</button></div>
    </form>
    <div class="doctor-admin-hint">Catalogo de consultorio: active o desactive cada medico segun el turno real.</div>
    <div id="qnDoctorsAdminListFinal" class="admin-list qn-doctors-admin-list"></div>`;
  const form = section.querySelector('#qnDoctorFormFinal');
  const list = section.querySelector('#qnDoctorsAdminListFinal');
  async function load(){
    try {
      const res = await api('/api/doctors?moduleId=consultorio');
      const doctors = res.doctors || [];
      const activeCount = doctors.filter((doctor) => doctor.enabled !== false).length;
      list.innerHTML = doctors.length ? doctors.map((doctor) => `
        <article class="admin-row compact doctor-admin-row ${doctor.enabled !== false ? 'is-active' : 'is-inactive'}">
          <div>
            <h4>${escapeHtml(doctor.name)}</h4>
            <p class="muted">${escapeHtml(doctor.specialty || 'CONSULTORIO')} &middot; Orden ${escapeHtml(doctor.order || '')}</p>
          </div>
          <label class="doctor-active-check">
            <input type="checkbox" data-qn-toggle-doctor="${escapeHtml(doctor.id)}" ${doctor.enabled !== false ? 'checked' : ''} />
            <span>Activo</span>
          </label>
        </article>
      `).join('') + `<div class="doctor-admin-count">${activeCount} medicos activos para llamado aleatorio.</div>` : '<div class="empty-state small">No hay medicos registrados.</div>';
    } catch {
      list.innerHTML = '<div class="empty-state small">No se pudo cargar medicos.</div>';
    }
  }
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(form).entries());
    await api('/api/doctors', { method: 'POST', body: JSON.stringify(payload) });
    form.reset();
    form.moduleId.value = 'consultorio';
    form.specialty.value = 'OFTALMOLOGIA GENERAL';
    form.order.value = '1';
    await load();
  });
  list.addEventListener('change', async (event) => {
    const input = event.target.closest('input[data-qn-toggle-doctor]');
    if (!input) return;
    await api(`/api/doctors/${encodeURIComponent(input.dataset.qnToggleDoctor)}/status`, {
      method: 'POST',
      body: JSON.stringify({ enabled: input.checked })
    });
    await load();
  });
  load();
})();
