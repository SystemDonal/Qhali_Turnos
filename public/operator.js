const currentUser = requireSession(['ADMIN', 'OPERADOR']);
attachSessionHeader();
const operatorModulesBoard = document.getElementById('operatorModulesBoard');
const operatorTitle = document.getElementById('operatorTitle');
const operatorSubcopy = document.getElementById('operatorSubcopy');
const operatorSummary = document.getElementById('operatorSummary');
const operatorPatientForm = document.getElementById('operatorPatientForm');
const operatorFormMessage = document.getElementById('operatorFormMessage');
const operatorModuleSelect = document.getElementById('operatorModuleId');
const operatorAreaInput = document.getElementById('operatorAreaInput');
const operatorDoctorSelect = document.getElementById('operatorDoctorName');
const operatorImmediateReferralModuleSelect = document.getElementById('operatorImmediateReferralModuleId');
const operatorImmediateReferralDoctorSelect = document.getElementById('operatorImmediateReferralDoctorName');
const lookupDniBtn = document.getElementById('lookupDniBtn');
const lookupPatientBtn = document.getElementById('lookupPatientBtn');
const operatorDniInput = document.getElementById('operatorDni');
const operatorFirstNameInput = document.getElementById('operatorFirstName');
const operatorLastNameInput = document.getElementById('operatorLastName');
const referralModal = document.getElementById('referralModal');
const referralModalPatient = document.getElementById('referralModalPatient');
const referralTargetSelect = document.getElementById('referralTargetSelect');
const referralDoctorSelect = document.getElementById('referralDoctorSelect');
const referralNotes = document.getElementById('referralNotes');
const referralConfirmBtn = document.getElementById('referralConfirmBtn');
const referralSaveFinalBtn = document.getElementById('referralSaveFinalBtn');
const referralCancelBtn = document.getElementById('referralCancelBtn');
const operatorRegistrationSection = document.getElementById('operatorRegistrationSection');
const operatorRegistrationBlocked = document.getElementById('operatorRegistrationBlocked');
const internalAnnouncementForm = document.getElementById('internalAnnouncementForm');
const internalAnnouncementHistory = document.getElementById('internalAnnouncementHistory');

const queryModuleId = getQueryParam('module');
const operatorRoles = ['OPERADOR'];
const MODULE_ALIAS = { optometria: '1', examenes: '2', consultorio: '3', imagenes: '4', ipl: '5', cirugia: '6' };
const CONSULTORIO_RETURN_PROCEDURES = ['PROCEDIMIENTOS', 'PROTOCOLOS', 'MEIBOGRAFIA', 'IMAGENES', 'LENTES', 'TEST DE AGUDEZA VISUAL'];
const fixedModuleId = operatorRoles.includes(currentUser.role) ? (currentUser.moduleId || queryModuleId) : queryModuleId;
const fixedDoctorName = currentUser.role === 'OPERADOR'
  ? null
  : getQueryParam('doctor');
const fixedOperatorUsername = operatorRoles.includes(currentUser.role) ? currentUser.username : getQueryParam('operator');
let operatorActionBusy = false;

let pendingArrivalPatient = null;
let latestOperatorState = null;

function alignOptometryRegisterButton() {
  if (!operatorPatientForm) return;
  const notesField = operatorPatientForm.querySelector('textarea[name="notes"]')?.closest('label');
  const actions = operatorPatientForm.querySelector('.actions');
  if (!notesField || !actions) return;
  actions.classList.add('qn-register-actions');
  if (notesField.nextElementSibling !== actions) {
    notesField.insertAdjacentElement('afterend', actions);
  }
}

alignOptometryRegisterButton();

function removeOperatorGhostNavigation() {
  document.querySelectorAll('.operator-logo-sidebar .compact-nav-links').forEach((node) => node.remove());
}

removeOperatorGhostNavigation();

function ensureConsultorioFloatingBrand() {
  let widget = document.getElementById('qnConsultorioFloatingBrand');
  if (!widget) {
    widget = document.createElement('div');
    widget.id = 'qnConsultorioFloatingBrand';
    widget.className = 'qn-floating-brand hidden';
    document.body.appendChild(widget);
  }
  widget.innerHTML = `
    <div class="qn-floating-brand-handle" title="Mover logo">
      <img src="/media/branding/qhali-logo.svg" alt="Qhali Ñawi" />
      <span>Consultorio</span>
    </div>
    <div class="qn-floating-brand-actions">
      <button type="button" data-action="logout">Salir</button>
    </div>
  `;
  attachSessionHeader('#sessionLabel', '#qnConsultorioFloatingBrand [data-action="logout"]');

  const saved = (() => {
    try { return JSON.parse(localStorage.getItem('qnConsultorioFloatingBrandPosition') || 'null'); } catch { return null; }
  })();
  const applyPosition = (x, y) => {
    const maxX = Math.max(12, window.innerWidth - widget.offsetWidth - 12);
    const maxY = Math.max(12, window.innerHeight - widget.offsetHeight - 12);
    widget.style.left = `${Math.min(Math.max(12, x), maxX)}px`;
    widget.style.top = `${Math.min(Math.max(12, y), maxY)}px`;
    widget.style.right = 'auto';
  };
  window.setTimeout(() => {
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) applyPosition(saved.x, saved.y);
    else applyPosition(window.innerWidth - widget.offsetWidth - 22, 18);
  }, 0);

  const handle = widget.querySelector('.qn-floating-brand-handle');
  let drag = null;
  handle?.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    drag = {
      startX: event.clientX,
      startY: event.clientY,
      left: widget.offsetLeft,
      top: widget.offsetTop
    };
    handle.setPointerCapture?.(event.pointerId);
    widget.classList.add('dragging');
  });
  handle?.addEventListener('pointermove', (event) => {
    if (!drag) return;
    applyPosition(drag.left + event.clientX - drag.startX, drag.top + event.clientY - drag.startY);
  });
  const endDrag = () => {
    if (!drag) return;
    drag = null;
    widget.classList.remove('dragging');
    try {
      localStorage.setItem('qnConsultorioFloatingBrandPosition', JSON.stringify({ x: widget.offsetLeft, y: widget.offsetTop }));
    } catch {}
  };
  handle?.addEventListener('pointerup', endDrag);
  handle?.addEventListener('pointercancel', endDrag);
  window.addEventListener('resize', () => applyPosition(widget.offsetLeft || 18, widget.offsetTop || 18));
  return widget;
}

function setConsultorioFloatingBrandVisible(visible) {
  const widget = ensureConsultorioFloatingBrand();
  widget.classList.toggle('hidden', !visible);
}

function buildReferralTargets(patient) {
  const currentModuleId = patient?.moduleId || fixedModuleId || queryModuleId;
  if (currentModuleId === 'consultorio') {
    return (TURNERO_CONFIG.modules || []).filter((module) => module.id === 'optometria');
  }
  return (TURNERO_CONFIG.modules || []).filter((module) => {
    if (module.id !== currentModuleId) return true;
    return ['consultorio', 'ipl', 'cirugia'].includes(module.id);
  });
}


const canRegisterPatientsInThisSession = true;
const consultorioSpecialties = getModuleMeta('consultorio').doctors || [];

function applyRegistrationPermissions() {
  if (!operatorPatientForm) return;
  const blockedMessage = 'Solo Administraci?n y Optometr?a pueden registrar pacientes.';
  const fields = operatorPatientForm.querySelectorAll('input, select, textarea, button');
  fields.forEach((field) => {
    if (field.id === 'lookupPatientBtn' || field.id === 'lookupDniBtn') return;
    field.disabled = !canRegisterPatientsInThisSession;
  });
  if (operatorRegistrationSection) operatorRegistrationSection.classList.toggle('hidden', !canRegisterPatientsInThisSession);
  if (operatorRegistrationBlocked) operatorRegistrationBlocked.classList.toggle('hidden', canRegisterPatientsInThisSession);
  if (!canRegisterPatientsInThisSession) {
    operatorPatientForm.classList.add('form-disabled');
    showMessage(blockedMessage, true);
  } else {
    operatorPatientForm.classList.remove('form-disabled');
  }
}

function normalizeTextPayload(payload = {}) {
  const next = { ...payload };
  ['firstName', 'lastName', 'area', 'notes', 'code'].forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(next, key) && typeof next[key] === 'string') {
      next[key] = toUppercaseValue(next[key]);
    }
  });
  return next;
}

function fillReferralDoctors(moduleId) {
  if (!referralDoctorSelect) return;
  const module = getModuleMeta(moduleId || '');
  if (pendingArrivalPatient?.moduleId === 'consultorio' && module.id === 'optometria') {
    referralDoctorSelect.innerHTML = `<option value="">Seleccione procedimiento de retorno</option>${CONSULTORIO_RETURN_PROCEDURES.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('')}`;
    return;
  }
  const placeholder = ['consultorio', 'ipl', 'cirugia', 'optometria'].includes(module.id)
    ? 'Seleccione especialidad / sub?rea de destino'
    : 'Especialidad autom?tica del m?dulo';
  referralDoctorSelect.innerHTML = buildModuleDoctorOptions(module.id, referralDoctorSelect.value || '', placeholder);
}

function openReferralModal(patient) {
  pendingArrivalPatient = patient;
  if (!referralModal) return;
  const targets = buildReferralTargets(patient);
  referralModalPatient.textContent = `${patient.firstName} ${patient.lastName} ? ${patient.code}. Elija si pasa a otro m?dulo o si se guardar? al final de este m?dulo.`;
  setModulePageTitle(patient.moduleId || fixedModuleId || queryModuleId, 'Qhali Ñahui');
  referralTargetSelect.innerHTML = `<option value="">Guardar al final de esta ?rea</option>${targets.map((module) => `<option value="${module.id}">${escapeHtml(module.label)}</option>`).join('')}`;
  referralNotes.value = '';
  fillReferralDoctors('');
  referralModal.classList.remove('hidden');
}

function closeReferralModal() {
  pendingArrivalPatient = null;
  if (!referralModal) return;
  referralModal.classList.add('hidden');
  referralTargetSelect.innerHTML = '<option value="">Guardar al final de esta ?rea</option>'; 
  fillReferralDoctors('');
  referralNotes.value = '';
}


async function refreshOperatorBoard() {
  const freshState = await api('/api/state');
  renderOperatorModules(freshState);
  return freshState;
}

function openReferralModal(patient) {
  pendingArrivalPatient = patient;
  if (!referralModal) return;
  const targets = buildReferralTargets(patient);
  const isConsultorioFlow = patient.moduleId === 'consultorio';
  referralModalPatient.textContent = isConsultorioFlow
    ? `${patient.firstName} ${patient.lastName} - ${patient.code}. Finalice la atención médica o derive a Optometría para procedimiento.`
    : `${patient.firstName} ${patient.lastName} ? ${patient.code}. Elija si pasa a otro modulo o si se guardara al final de este modulo.`;
  setModulePageTitle(patient.moduleId || fixedModuleId || queryModuleId, 'Qhali Ñahui');
  referralTargetSelect.innerHTML = `<option value="">${isConsultorioFlow ? 'Finalizar atención médica' : 'Guardar al final de esta área'}</option>${targets.map((module) => `<option value="${module.id}">${escapeHtml(module.label)}</option>`).join('')}`;
  if (isConsultorioFlow && targets.some((module) => module.id === 'optometria')) referralTargetSelect.value = 'optometria';
  referralNotes.value = '';
  fillReferralDoctors(referralTargetSelect.value || '');
  referralModal.classList.remove('hidden');
}

async function runOperatorAction(action) {
  if (operatorActionBusy) return;
  operatorActionBusy = true;
  try {
    const result = await action();
    return result;
  } finally {
    operatorActionBusy = false;
  }
}


function getCurrentOperatorActiveCall() {
  const moduleId = fixedModuleId || queryModuleId || currentUser.moduleId || '';
  const directCurrent = latestOperatorState?.currentCalls?.[moduleId] || latestOperatorState?.currentCall || null;
  if (directCurrent?.id) return directCurrent;
  const queue = Array.isArray(latestOperatorState?.queue) ? latestOperatorState.queue : [];
  const fallback = queue
    .filter((item) => String(item.moduleId || '') === String(moduleId || '') && ['called', 'attended'].includes(String(item.status || '').toLowerCase()))
    .sort((a, b) => new Date(b.calledAt || b.arrivedAt || b.updatedAt || b.createdAt || 0) - new Date(a.calledAt || a.arrivedAt || a.updatedAt || a.createdAt || 0))[0];
  return fallback || null;
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
    const activeCall = getCurrentOperatorActiveCall();
    if (!activeCall) {
      showMessage('No hay un paciente activo para llamar a su familiar.', true);
      return;
    }
    const patientName = toUppercaseValue(activeCall.displayName || `${activeCall.firstName || ''} ${activeCall.lastName || ''}`.trim());
    const moduleLabel = toUppercaseValue(activeCall.moduleLabel || getModuleMeta(activeCall.moduleId || '').label || 'EL ?REA CL?NICA');
    try {
      await runOperatorAction(() => api('/api/internal-announcements', {
        method: 'POST',
        body: JSON.stringify({
          targetName: `FAMILIAR DE ${patientName}`,
          message: `ACERCARSE A ${moduleLabel}`,
          repeatCount: 2,
          moduleId: fixedModuleId || queryModuleId || currentUser.moduleId,
          originLabel: getModuleMeta(fixedModuleId || queryModuleId || currentUser.moduleId || '').label || 'MÓDULO',
          requestedBy: fixedOperatorUsername || currentUser?.username || 'operador'
        })
      }));
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
  const activeCall = getCurrentOperatorActiveCall();
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
        <p class="muted">${escapeHtml(item.message || 'ACERCARSE AL ?REA SOLICITADA')}</p>
        <p class="muted">${escapeHtml(item.originLabel || 'M?dulo')} ? ${escapeHtml(formatDateTime(item.createdAt))}</p>
      </div>
      <div class="row-actions">
        <button type="button" class="ghost-btn small-btn" data-repeat-announcement="${escapeHtml(item.id)}">Repetir llamado</button>
      </div>
    </article>
  `).join('');
}

function showMessage(message, isError = false) {
  if (!operatorFormMessage) return;
  operatorFormMessage.textContent = message;
  operatorFormMessage.classList.toggle('error', isError);
}

function queueByModule(queue = [], moduleId, doctorName) {
  return queue
    .filter((item) => item.moduleId === moduleId)
    .filter((item) => !doctorName || item.doctorName === doctorName)
    .sort((a, b) => new Date(a.referredAt || a.createdAt || 0) - new Date(b.referredAt || b.createdAt || 0));
}

function visibleModules() {
  if (currentUser.role === 'OPERADOR' && fixedModuleId) {
    const module = getModuleMeta(fixedModuleId);
    return module.id ? [module] : [];
  }
  if (!fixedModuleId) return TURNERO_CONFIG.modules || [];
  const module = getModuleMeta(fixedModuleId);
  return module.id ? [module] : [];
}

function fillModuleOptions() {
  const modules = visibleModules();
  operatorModuleSelect.innerHTML = modules.map((module) => `<option value="${module.id}">${module.label}</option>`).join('');
  if (fixedModuleId) operatorModuleSelect.value = fixedModuleId;
  operatorModuleSelect.disabled = Boolean(fixedModuleId && currentUser.role === 'OPERADOR');
  syncOperatorArea();
  syncOperatorDoctors();
  syncOperatorImmediateReferralOptions();
}

function syncOperatorArea() {
  const selected = getModuleMeta(operatorModuleSelect.value || fixedModuleId || 'consultorio');
  operatorAreaInput.value = selected.room || selected.label || '?rea cl?nica';
}

function syncOperatorDoctors() {
  const selected = getModuleMeta(operatorModuleSelect.value || fixedModuleId || 'optometria');
  if (selected.id === 'optometria' && !fixedDoctorName) {
    operatorDoctorSelect.innerHTML = '<option value="">Optometr?a general</option>';
    operatorDoctorSelect.value = '';
    return;
  }
  operatorDoctorSelect.innerHTML = buildModuleDoctorOptions(selected.id, operatorDoctorSelect.value || selected.doctors?.[0] || '', 'Seleccione especialidad / sub?rea');
  if (fixedDoctorName) operatorDoctorSelect.value = fixedDoctorName;
  else if (!operatorDoctorSelect.value && selected.doctors?.[0]) operatorDoctorSelect.value = selected.doctors[0];
}

function syncOperatorImmediateReferralOptions() {
  if (!operatorImmediateReferralModuleSelect || !operatorImmediateReferralDoctorSelect) return;
  const currentModuleId = operatorModuleSelect.value || fixedModuleId || '';
  const targets = (TURNERO_CONFIG.modules || []).filter((module) => module.id !== currentModuleId);
  const previous = operatorImmediateReferralModuleSelect.value;
  operatorImmediateReferralModuleSelect.innerHTML = `<option value="">Sin referencia inmediata</option>${targets.map((module) => `<option value="${module.id}">${escapeHtml(module.label)}</option>`).join('')}`;
  if (targets.some((item) => item.id === previous)) operatorImmediateReferralModuleSelect.value = previous;
  syncOperatorImmediateReferralDoctors();
}

function syncOperatorImmediateReferralDoctors() {
  if (!operatorImmediateReferralDoctorSelect) return;
  const targetId = operatorImmediateReferralModuleSelect?.value || '';
  if (!targetId) {
    operatorImmediateReferralDoctorSelect.innerHTML = '<option value="">Especialidad autom?tica del m?dulo</option>';
    return;
  }
  operatorImmediateReferralDoctorSelect.innerHTML = buildModuleDoctorOptions(targetId, operatorImmediateReferralDoctorSelect.value || '', 'Especialidad autom?tica del m?dulo');
}

function renderModuleCoverageText(moduleId, waitingCount = 0) {
  const selected = getModuleMeta(moduleId || fixedModuleId || 'consultorio');
  if (['consultorio', 'optometria'].includes(selected.id)) {
    const specialtyCount = (selected.doctors || []).length;
    return `${specialtyCount} especialidades activas ? ${waitingCount} pacientes visibles en cola`;
  }
  return fixedDoctorName ? escapeHtml(fixedDoctorName) : 'Atenci?n por cola general del ?rea';
}

function applyOperatorBoardLayout(moduleCount = 0) {
  if (!operatorModulesBoard) return;
  operatorModulesBoard.classList.toggle('single-module-view', moduleCount <= 1);
}

function renderSummary(state = {}) {
  const queue = state.queue || [];
  const waiting = queue.filter((item) => item.status === 'waiting');
  const myWaiting = fixedModuleId ? queueByModule(waiting, fixedModuleId, fixedDoctorName) : waiting;
  const activeCall = fixedModuleId ? state.currentCalls?.[fixedModuleId] : null;
  const moduleLabel = fixedModuleId ? getModuleMeta(fixedModuleId).label : 'Todas las ?reas';

  operatorSummary.innerHTML = `
    <article class="highlight-card compact">
      <div>
        <p class="section-kicker compact">Usuario activo</p>
        <h3>${escapeHtml(currentUser.fullName || currentUser.username)}</h3>
        <p class="muted">${escapeHtml(currentUser.role)} · ${escapeHtml(fixedOperatorUsername || currentUser.username)}${currentUser.lastLoginAt ? ` · Último acceso ${formatDateTime(currentUser.lastLoginAt)}` : ''}</p>
      </div>
    </article>
    <article class="highlight-card compact">
      <div>
        <p class="section-kicker compact">Cobertura del m?dulo</p>
        <h3>${escapeHtml(moduleLabel)}</h3>
        <p class="muted">${renderModuleCoverageText(fixedModuleId, myWaiting.length)}</p>
      </div>
    </article>
    <article class="highlight-card compact">
      <div>
        <p class="section-kicker compact">Pacientes en espera</p>
        <h3>${myWaiting.length}</h3>
        <p class="muted">${activeCall ? `Atenci?n activa: ${escapeHtml(activeCall.code)}` : 'Sin atenci?n activa por ahora'}</p>
      </div>
    </article>
  `;
}

function doctorBreakdown(module, waiting) {
  const counts = {};
  waiting.forEach((item) => { counts[item.doctorName || 'Sin m?dico'] = (counts[item.doctorName || 'Sin m?dico'] || 0) + 1; });
  return (module.doctors || []).map((doctorName) => `
    <div class="mini-queue-item doctor-chip-line">
      <span>${counts[doctorName] || 0}</span>
      <div><strong>${escapeHtml(doctorName)}</strong><small>Pacientes pendientes</small></div>
    </div>
  `).join('');
}

function derivationOptions(currentModuleId) {
  return (TURNERO_CONFIG.modules || [])
    .filter((module) => module.id !== currentModuleId)
    .map((module) => `<option value="${module.id}">${escapeHtml(module.label)}</option>`)
    .join('');
}


function renderReferenceBadge(item) {
  if (!item?.isReferred && !item?.referred) return '';
  return `<span class="ghost-btn small-btn" style="pointer-events:none;">REFERIDO</span>`;
}

function renderReferralOriginMeta(item) {
  if (!item?.isReferred && !item?.referred) return '';
  const originModuleId = item.referralOriginModuleId || '';
  const originModule = getModuleMeta(originModuleId).label || originModuleId || 'M?dulo previo';
  const originType = item.referralOriginDoctorName || '';
  const parts = [
    `<strong>Origen:</strong> ${escapeHtml(originModule)}`,
    item.referralOriginCode ? `C?digo ${escapeHtml(item.referralOriginCode)}` : '',
    originType ? renderAttentionTypeTag(originType, 'attention-type-tag') : ''
  ].filter(Boolean);
  return `<div class="row-badges referral-route-note"><span class="referral-origin-chip ${escapeHtml(originModuleId)}">${parts.join(' ? ')}</span></div>`;
}

function renderPatientName(item, extraClass = '') {
  const baseClass = `${item?.isReferred || item?.referred ? 'referral-name-glow' : ''} ${extraClass}`.trim();
  return `<span class="${baseClass}">${escapeHtml(item?.firstName || '')} ${escapeHtml(item?.lastName || '')}</span>`;
}

function renderReferralObservation(item) {
  const note = String(item?.referralNote || item?.notes || item?.derivationHistory?.[0]?.referralNote || item?.derivationHistory?.[0]?.notes || '').trim();
  if (!note) return '';
  return `<p class="muted"><strong>Observaci?n de referencia:</strong> ${escapeHtml(note)}</p>`;
}

function renderActiveDerivationControls(item) {
  if (!item) return '';
  if (item.moduleId === 'consultorio') {
    return `
      <div class="inline-actions mobile-stack">
        <button class="primary-btn small-btn" data-consultorio-attention-id="${item.id}">Atención</button>
      </div>
    `;
  }
  return `
    <div class="inline-actions mobile-stack">
      <select data-derive-module-id="${item.id}" class="ghost-btn small-btn">
        <option value="">Referir a...</option>
        ${derivationOptions(item.moduleId)}
      </select>
      <button class="ghost-btn small-btn" data-derive-patient-id="${item.id}">Referir</button>
      <button class="ghost-btn small-btn" data-complete-patient-id="${item.id}">Cerrar atenci?n</button>
    </div>
  `;
}


function renderDoctorAssignment(item, module) {
  const doctors = module.doctors || [];
  if (!doctors.length) return '';
  return `
    <div class="doctor-assignment-inline">
      <select class="doctor-inline-select" data-doctor-select-patient-id="${item.id}">
        ${doctors.map((doctor) => `<option value="${escapeHtml(doctor)}" ${doctor === item.doctorName ? 'selected' : ''}>${escapeHtml(doctor)}</option>`).join('')}
      </select>
      <button class="ghost-btn small-btn" data-assign-doctor-patient-id="${item.id}">Asignar especialidad</button>
    </div>
  `;
}

function renderCalledPatientCard(item, module) {
  const consultorioAssigned = module.id === 'consultorio' && item.doctorName;
  return `
    <article class="admin-row operator-row compact live-call-row">
      <div>
        <div class="row-badges">
          ${renderAttentionCodeBadge(item.code, item.doctorName, 'mini-code')}
          ${renderReferenceBadge(item)}
          <span class="ghost-btn small-btn" style="pointer-events:none;">LLAMADO</span>
        </div>
        <h4>${renderPatientName(item)}</h4>
        <p class="muted">DNI ${escapeHtml(item.dni || '-')} ? ${escapeHtml(item.area || module.room)} ? ${escapeHtml(item.doctorName || '')}</p>
        <p class="muted">Llamado ${escapeHtml(formatDateTime(item.calledAt || item.createdAt))}</p>
        ${module.id === 'consultorio' ? renderDoctorAssignment(item, module) : ''}
      </div>
      <div class="row-actions stacked mobile-stack">
        ${consultorioAssigned
          ? `<button class="primary-btn small-btn" data-consultorio-start-attention-id="${item.id}">Atención</button>
             <button class="ghost-btn small-btn" data-id="${item.id}">Repetir llamado</button>`
          : `<button class="primary-btn small-btn" data-id="${item.id}">Volver a llamar</button>
             <button class="success-btn small-btn" data-present-patient-id="${item.id}">Paciente presente</button>`}
      </div>
    </article>
  `;
}

function renderOperatorModules(state = {}) {
  latestOperatorState = state || latestOperatorState;
  const queue = state.queue || [];
  const waitingQueue = queue.filter((item) => item.status === 'waiting');
  const calledQueue = queue.filter((item) => item.status === 'called');
  const inRoomQueue = queue.filter((item) => item.status === 'attended');
  const completedQueue = queue.filter((item) => item.status === 'completed');
  const referredOutQueue = queue.filter((item) => item.status === 'referred_out');
  const currentCalls = state.currentCalls || {};
  const modules = visibleModules();

  if (fixedModuleId) {
    const module = getModuleMeta(fixedModuleId);
    setModulePageTitle(module.id);
    operatorTitle.textContent = `${module.label}`;
    operatorSubcopy.textContent = fixedDoctorName
      ? `Atenci?n dedicada para ${fixedDoctorName}. El llamado queda filtrado por m?dico y m?dulo.`
      : canRegisterPatientsInThisSession
        ? `Atenci?n dedicada de ${module.label}. Este m?dulo puede registrar, llamar, confirmar presencia, referir pacientes y conservar el cierre final del flujo cl?nico.`
        : `Atenci?n dedicada de ${module.label}. Este m?dulo recibe referencias, llama pacientes, confirma presencia y conserva el cierre final del flujo cl?nico.`;
  }

  renderSummary(state);
  renderInternalAnnouncements(state.internalAnnouncements || []);
  updateFamilyCallButton();
  applyOperatorBoardLayout(modules.length);

  operatorModulesBoard.innerHTML = modules.map((module) => {
    const activeCall = currentCalls[module.id];
    const waiting = queueByModule(waitingQueue, module.id, fixedDoctorName);
    const referredWaiting = waiting.filter((item) => item.isReferred || item.referred);
    const regularWaiting = waiting.filter((item) => !item.isReferred && !item.referred);
    const calledPatients = queueByModule(calledQueue, module.id, fixedDoctorName).sort((a, b) => new Date(b.calledAt || b.createdAt || 0) - new Date(a.calledAt || a.createdAt || 0));
    const inRoomPatients = queueByModule(inRoomQueue, module.id, fixedDoctorName).sort((a, b) => new Date(b.arrivedAt || 0) - new Date(a.arrivedAt || 0));
    const completedPatients = queueByModule(completedQueue, module.id, fixedDoctorName).sort((a, b) => new Date(b.completedAt || b.arrivedAt || 0) - new Date(a.completedAt || a.arrivedAt || 0));
    const referredOutPatients = queueByModule(referredOutQueue, module.id, fixedDoctorName).sort((a, b) => new Date(b.referredOutAt || b.arrivedAt || 0) - new Date(a.referredOutAt || a.arrivedAt || 0));
    const moduleMetrics = state.moduleMetrics?.[module.id] || {};
    return `
      <article class="operator-module-card glass ${module.id}">
        <div class="operator-module-head">
          <div>
            <p class="section-kicker compact">${escapeHtml(module.label)}</p>
            <h3>${escapeHtml(module.label)}</h3>
            <p class="muted">Prom. espera ${formatMinutes(moduleMetrics.averageWaitMinutes || 0)} ? Prom. atenci?n ${formatMinutes(moduleMetrics.averageAttentionMinutes || 0)} ? Referidos ${referredWaiting.length}</p>
          </div>
          <span class="module-count">${waiting.length}</span>
        </div>

        <div class="operator-active-box ${activeCall ? 'live' : ''}">
          <div class="operator-active-title">Atenci?n activa</div>
          ${activeCall ? `
            <div class="row-badges">
              ${renderAttentionCodeBadge(activeCall.code, activeCall.doctorName, 'code-pill')}
              ${renderAttentionTypeTag(activeCall.doctorName, 'attention-type-tag')}
              <span class="tag-module ${escapeHtml(module.id)}">${escapeHtml(module.label)}</span>
            </div>
            <h4><span class="${activeCall.isReferred || activeCall.referred ? 'referral-name-glow' : ''}">${escapeHtml(activeCall.displayName || `${activeCall.firstName || ''} ${activeCall.lastName || ''}`.trim())}</span></h4>
            <p class="muted">DNI ${escapeHtml(activeCall.dni || '-')} ? ${escapeHtml(activeCall.area || module.room)} ? ${escapeHtml(activeCall.doctorName || '')}</p>
            <p class="muted">Operador: ${escapeHtml(activeCall.operatorName || activeCall.operatorUsername || currentUser.fullName || 'Asignado')}</p>
            ${renderReferralOriginMeta(activeCall)}
            ${renderReferralObservation(activeCall)}
            <div class="row-badges">
              ${renderReferenceBadge(activeCall)}
              ${activeCall.status === 'attended' ? '<span class="success-btn small-btn" style="pointer-events:none;">PACIENTE PRESENTE</span>' : ''}
              ${activeCall.status === 'completed' ? '<span class="ghost-btn small-btn" style="pointer-events:none;">GUARDADO AL FINAL</span>' : ''}
              ${activeCall.hasReferralOpen ? '<span class="ghost-btn small-btn" style="pointer-events:none;">REFERENCIA GENERADA</span>' : ''}
            </div>
            <div class="row-actions stacked mobile-stack">
              ${activeCall.status === 'attended'
                ? renderActiveDerivationControls(activeCall)
                : module.id === 'consultorio' && activeCall.doctorName
                  ? `<button class="primary-btn" data-consultorio-start-attention-id="${activeCall.id}">Atención</button>
                     <button class="ghost-btn" data-repeat-module-id="${module.id}">Repetir llamado</button>`
                  : `<button class="primary-btn" data-repeat-module-id="${module.id}">Repetir llamado</button>
                     <button class="success-btn" data-arrive-module-id="${module.id}">Paciente presente</button>`}
            </div>
          ` : '<div class="empty-state small">Sin atenci?n activa en este m?dulo.</div>'}
        </div>

        <div class="operator-queue-box live-calls-box">
          <div class="operator-subtitle">Pacientes llamados del m?dulo</div>
          <div class="operator-queue-list">
            ${calledPatients.length ? calledPatients.map((item) => renderCalledPatientCard(item, module)).join('') : '<div class="empty-state small">No hay pacientes llamados en este m?dulo.</div>'}
          </div>
        </div>

        <div class="operator-queue-box">
          <div class="operator-subtitle">Pacientes en espera del m?dulo</div>
          <div class="operator-queue-list">
            ${regularWaiting.length ? regularWaiting.map((item, idx) => `
              <article class="admin-row operator-row compact">
                <div>
                  <div class="row-badges">
                    ${renderAttentionCodeBadge(item.code, item.doctorName, 'mini-code')}
                    <span class="muted">#${idx + 1}</span>
                  </div>
                  <h4>${renderPatientName(item)}</h4>
                  <p class="muted">DNI ${escapeHtml(item.dni || '-')} ? ${escapeHtml(item.area || module.room)} ? ${escapeHtml(item.doctorName || '')}</p>
                  ${renderReferralObservation(item)}
                </div>
                <div class="row-actions stacked mobile-stack">
                  <button class="primary-btn" data-id="${item.id}">Llamar</button>
                </div>
              </article>
            `).join('') : '<div class="empty-state small">Sin pacientes en espera normal.</div>'}
          </div>
          <div class="row-actions operator-footer-actions">
            <button class="ghost-btn" data-module-id="${module.id}">Llamar siguiente ${escapeHtml(module.label)}</button>
          </div>
        </div>

        <div class="operator-queue-box referred-box">
          <div class="operator-subtitle">Pacientes referidos entre m?dulos</div>
          <div class="operator-queue-list">
            ${referredWaiting.length ? referredWaiting.map((item, idx) => `
              <article class="admin-row operator-row compact referred-row">
                <div>
                  <div class="row-badges">
                    ${renderAttentionCodeBadge(item.code, item.doctorName, 'mini-code')}
                    ${renderAttentionTypeTag(item.doctorName, 'attention-type-tag')}
                    <span class="ghost-btn small-btn" style="pointer-events:none;">REFERIDO #${idx + 1}</span>
                  </div>
                  <h4>${renderPatientName(item)}</h4>
                  ${renderReferralOriginMeta(item)}
                  <p class="muted"><strong>Aviso:</strong> paciente referido desde ${escapeHtml(getModuleMeta(item.referralOriginModuleId || '').label || item.referralOriginModuleId || 'M?dulo previo')}</p>
                  <p class="muted">Destino: ${escapeHtml(item.area || module.room)} ? Especialidad: ${escapeHtml(item.doctorName || '')} ${item.referralOriginDoctorName ? `? Referencia desde ${escapeHtml(item.referralOriginDoctorName)}` : ''}</p>
                  ${renderReferralObservation(item)}
                </div>
                <div class="row-actions stacked mobile-stack">
                  <button class="success-btn" data-id="${item.id}">Llamar referido</button>
                </div>
              </article>
            `).join('') : '<div class="empty-state small">No hay pacientes referidos pendientes.</div>'}
          </div>
        </div>

        <div class="operator-queue-box">
          <div class="operator-subtitle">Pacientes atendidos en sala</div>
          <div class="operator-queue-list">
            ${inRoomPatients.length ? inRoomPatients.map((item) => `
              <article class="admin-row operator-row compact">
                <div>
                  <div class="row-badges">
                    ${renderAttentionCodeBadge(item.code, item.doctorName, 'mini-code')}
                    ${renderReferenceBadge(item)}
                    <span class="success-btn small-btn" style="pointer-events:none;">EN SALA</span>
                    ${item.hasReferralOpen ? '<span class="ghost-btn small-btn" style="pointer-events:none;">REFERENCIA GENERADA</span>' : ''}
                  </div>
                  <h4>${renderPatientName(item)}</h4>
                  <p class="muted">DNI ${escapeHtml(item.dni || '-')} ? ${escapeHtml(item.area || module.room)} ? ${escapeHtml(item.doctorName || '')}</p>
                  ${renderReferralObservation(item)}
                </div>
                <div class="row-actions stacked mobile-stack">
                  ${renderActiveDerivationControls(item)}
                </div>
              </article>
            `).join('') : '<div class="empty-state small">Sin pacientes presentes en sala.</div>'}
          </div>
        </div>


        <div class="operator-queue-box">
          <div class="operator-subtitle">Pacientes atendidos guardados al final</div>
          <div class="operator-queue-list">
            ${completedPatients.length ? completedPatients.map((item) => `
              <article class="admin-row operator-row compact">
                <div>
                  <div class="row-badges">
                    ${renderAttentionCodeBadge(item.code, item.doctorName, 'mini-code')}
                    <span class="ghost-btn small-btn" style="pointer-events:none;">FINALIZADO</span>
                    ${renderReferenceBadge(item)}
                  </div>
                  <h4>${renderPatientName(item)}</h4>
                  <p class="muted">DNI ${escapeHtml(item.dni || '-')} ? ${escapeHtml(item.area || module.room)} ? ${escapeHtml(item.doctorName || '')}</p>
                  <p class="muted">Cierre ${escapeHtml(formatDateTime(item.completedAt || item.arrivedAt || item.calledAt))}</p>
                </div>
                <div class="row-actions stacked mobile-stack">
                  <button class="primary-btn small-btn" data-id="${item.id}">Volver a llamar</button>
                </div>
              </article>
            `).join('') : '<div class="empty-state small">No hay pacientes finalizados en este m?dulo.</div>'}
          </div>
        </div>

        <div class="operator-queue-box doctor-breakdown-box">
          <div class="operator-subtitle">Carga por especialidad</div>
          <div class="operator-queue-list">${doctorBreakdown(module, queueByModule(waitingQueue, module.id)) || '<div class="empty-state small">Sin doctores configurados.</div>'}</div>
        </div>
      </article>
    `;
  }).join('');
}

operatorModulesBoard.addEventListener('click', async (event) => {
  const callButton = event.target.closest('button[data-id]');
  const nextButton = event.target.closest('button[data-module-id]');
  const arriveButton = event.target.closest('button[data-arrive-module-id]');
  const repeatButton = event.target.closest('button[data-repeat-module-id]');
  const presentButton = event.target.closest('button[data-present-patient-id]');
  const assignDoctorButton = event.target.closest('button[data-assign-doctor-patient-id]');
  const deriveButton = event.target.closest('button[data-derive-patient-id]');
  const completeButton = event.target.closest('button[data-complete-patient-id]');
  const consultorioAttentionButton = event.target.closest('button[data-consultorio-attention-id]');
  const consultorioStartAttentionButton = event.target.closest('button[data-consultorio-start-attention-id]');

  try {
    if (consultorioStartAttentionButton) {
      const patientId = consultorioStartAttentionButton.dataset.consultorioStartAttentionId;
      let patient = (latestOperatorState?.queue || []).find((item) => item.id === patientId);
      if (!patient) throw new Error('No se encontró el paciente para iniciar atención.');
      if (patient.status !== 'attended') {
        const presentResult = await runOperatorAction(() => api(`/api/patients/${patientId}/present`, {
          method: 'POST',
          body: JSON.stringify({ operatorUsername: fixedOperatorUsername || currentUser.username, operatorName: currentUser.fullName, updatedBy: fixedOperatorUsername || currentUser.username })
        }));
        patient = presentResult?.patient || patient;
      }
      openReferralModal(patient);
      showMessage('Atención iniciada. Finalice o derive a Optometría para procedimiento.');
      return;
    }
    if (consultorioAttentionButton) {
      const patient = (latestOperatorState?.queue || []).find((item) => item.id === consultorioAttentionButton.dataset.consultorioAttentionId);
      if (!patient) throw new Error('No se encontró el paciente para cerrar o referir.');
      openReferralModal(patient);
      showMessage('Seleccione si finaliza atención o deriva a Optometría para procedimiento.');
      return;
    }
    if (callButton) {
      await runOperatorAction(() => api(`/api/call/${callButton.dataset.id}`, { method: 'POST', body: JSON.stringify({ operatorUsername: fixedOperatorUsername || currentUser.username, operatorName: currentUser.fullName }) }));
      showMessage('Llamado ejecutado correctamente.');
      return;
    }
    if (nextButton) {
      await runOperatorAction(() => api(`/api/call-next/${nextButton.dataset.moduleId}`, { method: 'POST', body: JSON.stringify({ doctorName: fixedDoctorName, operatorUsername: fixedOperatorUsername || currentUser.username, operatorName: currentUser.fullName }) }));
      showMessage('Siguiente paciente llamado correctamente.');
      return;
    }
    if (arriveButton) {
      const arriveResult = await runOperatorAction(() => api(`/api/arrive/${arriveButton.dataset.arriveModuleId}`, { method: 'POST', body: JSON.stringify({ operatorUsername: fixedOperatorUsername || currentUser.username, operatorName: currentUser.fullName, updatedBy: fixedOperatorUsername || currentUser.username }) }));
      const patient = arriveResult?.patient;
      if (patient) {
        openReferralModal(patient);
        showMessage('Paciente marcado presente. Confirme si ser? referido o guardado al final.');
      }
      return;
    }
    if (repeatButton) {
      await runOperatorAction(() => api(`/api/repeat-call/${repeatButton.dataset.repeatModuleId}`, { method: 'POST', body: JSON.stringify({ operatorUsername: fixedOperatorUsername || currentUser.username, operatorName: currentUser.fullName }) }));
      showMessage('Llamado repetido correctamente.');
      return;
    }
    if (presentButton) {
      const presentResult = await runOperatorAction(() => api(`/api/patients/${presentButton.dataset.presentPatientId}/present`, {
        method: 'POST',
        body: JSON.stringify({ operatorUsername: fixedOperatorUsername || currentUser.username, operatorName: currentUser.fullName, updatedBy: fixedOperatorUsername || currentUser.username })
      }));
      const patient = presentResult?.patient;
      if (patient) {
        openReferralModal(patient);
        showMessage('Paciente marcado presente. Confirme si ser? referido o guardado al final.');
      }
      return;
    }
    if (assignDoctorButton) {
      const patientId = assignDoctorButton.dataset.assignDoctorPatientId;
      const select = operatorModulesBoard.querySelector(`select[data-doctor-select-patient-id="${patientId}"]`);
      if (!select?.value) throw new Error('Seleccione el m?dico que atender? al paciente.');
      await runOperatorAction(() => api(`/api/patients/${patientId}/assign-doctor`, {
        method: 'POST',
        body: JSON.stringify({ doctorName: select.value })
      }));
      showMessage('Medico oftalmologo asignado correctamente.');
      return;
    }
    if (completeButton) {
      await runOperatorAction(() => api(`/api/patients/${completeButton.dataset.completePatientId}/complete`, {
        method: 'POST',
        body: JSON.stringify({ completedBy: fixedOperatorUsername || currentUser.username })
      }));
      showMessage('Paciente guardado al final correctamente.');
      return;
    }
    if (deriveButton) {
      const patientId = deriveButton.dataset.derivePatientId;
      const select = operatorModulesBoard.querySelector(`select[data-derive-module-id="${patientId}"]`);
      if (!select?.value) throw new Error('Seleccione el m?dulo de destino para derivar.');
      const targetMeta = getModuleMeta(select.value);
      await runOperatorAction(() => api(`/api/patients/${patientId}/derive`, {
        method: 'POST',
        body: JSON.stringify({
          moduleId: select.value,
          area: targetMeta.room,
          doctorName: targetMeta.doctors?.[0] || '',
          operatorUsername: fixedOperatorUsername || currentUser.username,
          operatorName: currentUser.fullName,
          derivedBy: fixedOperatorUsername || currentUser.username
        })
      }));
      showMessage('Paciente referido correctamente.');
      return;
    }
  } catch (error) {
    showMessage(error.message, true);
  }
});

operatorPatientForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!canRegisterPatientsInThisSession) {
    showMessage('Registro habilitado en este m?dulo.', false);
    return;
  }
  const payload = normalizeTextPayload(Object.fromEntries(new FormData(operatorPatientForm).entries()));
  payload.registeredBy = fixedOperatorUsername || currentUser.username;
  if (fixedModuleId) payload.moduleId = fixedModuleId;
  if (fixedDoctorName) payload.doctorName = fixedDoctorName;
  try {
    const created = await runOperatorAction(() => api('/api/patients', { method: 'POST', body: JSON.stringify(payload) }));
    const targetModuleId = String(payload.immediateReferralModuleId || '').trim();
    if (targetModuleId && created?.patient?.id) {
      const targetMeta = getModuleMeta(targetModuleId);
      const targetDoctor = String(payload.immediateReferralDoctorName || '').trim() || targetMeta.doctors?.[0] || '';
      await runOperatorAction(() => api(`/api/patients/${created.patient.id}/derive`, {
        method: 'POST',
        body: JSON.stringify({
          moduleId: targetModuleId,
          area: ['consultorio', 'ipl', 'cirugia'].includes(targetMeta.id) ? (targetDoctor || targetMeta.room) : targetMeta.room,
          doctorName: targetDoctor,
          notes: payload.notes || 'REFERENCIA INMEDIATA DESDE REGISTRO',
          immediate: true,
          operatorUsername: fixedOperatorUsername || currentUser.username,
          operatorName: currentUser.fullName,
          derivedBy: fixedOperatorUsername || currentUser.username
        })
      }));
    }
    operatorPatientForm.reset();
    fillModuleOptions();
    showMessage(targetModuleId ? 'Paciente registrado y referido de inmediato correctamente.' : 'Paciente registrado correctamente.');
  } catch (error) {
    showMessage(error.message, true);
  }
});

operatorModuleSelect?.addEventListener('change', () => {
  syncOperatorArea();
  syncOperatorDoctors();
  syncOperatorImmediateReferralOptions();
});
operatorImmediateReferralModuleSelect?.addEventListener('change', () => {
  syncOperatorImmediateReferralDoctors();
});

lookupDniBtn?.addEventListener('click', async () => {
  await autoLookupDni({ force: true });
});

let lastAutoLookupDni = '';
let autoLookupDniTimer = null;
let autoLookupDniBusy = false;

async function autoLookupDni(options = {}) {
  const force = options.force === true;
  const dni = String(operatorDniInput?.value || '').replace(/\D/g, '').slice(0, 8);
  if (operatorDniInput && operatorDniInput.value !== dni) operatorDniInput.value = dni;
  if (dni.length !== 8) {
    if (force) showMessage('Ingrese un DNI válido de 8 dígitos.', true);
    return;
  }
  if (!force && (autoLookupDniBusy || lastAutoLookupDni === dni)) return;
  autoLookupDniBusy = true;
  lastAutoLookupDni = dni;
  showMessage('Buscando paciente por DNI...');
  try {
    const result = await api(`/api/search?q=${encodeURIComponent(dni)}`);
    const first = (result.results || [])[0]?.patient;
    if (first?.dni) {
      operatorDniInput.value = first.dni || dni;
      operatorFirstNameInput.value = toUppercaseValue(first.firstName || '');
      operatorLastNameInput.value = toUppercaseValue(first.lastName || '');
      showMessage(`Paciente cargado automáticamente desde ${(result.results || [])[0]?.source || 'sistema'}.`);
      return;
    }
    const response = await api(`/api/reniec/${dni}`);
    operatorFirstNameInput.value = toUppercaseValue(response.patient?.firstName || '');
    operatorLastNameInput.value = toUppercaseValue(response.patient?.lastName || '');
    showMessage('Datos cargados automáticamente desde RENIEC.');
  } catch (error) {
    if (force) showMessage(error.message, true);
    else showMessage('No se encontró el DNI automáticamente. Puede completar nombre y apellido manualmente.', true);
  } finally {
    autoLookupDniBusy = false;
  }
}

operatorDniInput?.addEventListener('input', () => {
  const clean = String(operatorDniInput.value || '').replace(/\D/g, '').slice(0, 8);
  if (operatorDniInput.value !== clean) operatorDniInput.value = clean;
  window.clearTimeout(autoLookupDniTimer);
  if (clean.length < 8) {
    lastAutoLookupDni = '';
    return;
  }
  autoLookupDniTimer = window.setTimeout(() => {
    autoLookupDni().catch((error) => showMessage(error.message, true));
  }, 260);
});


referralTargetSelect?.addEventListener('change', () => {
  fillReferralDoctors(referralTargetSelect.value);
});

referralConfirmBtn?.addEventListener('click', async () => {
  if (!pendingArrivalPatient) return;
  if (!referralTargetSelect?.value) {
    showMessage('Seleccione un m?dulo de destino para referir al paciente.', true);
    return;
  }
  const targetMeta = getModuleMeta(referralTargetSelect.value);
  try {
    const selectedProcedure = referralDoctorSelect?.value || '';
    const isConsultorioProcedureReturn = pendingArrivalPatient.moduleId === 'consultorio' && targetMeta.id === 'optometria';
    await runOperatorAction(() => api(`/api/patients/${pendingArrivalPatient.id}/derive`, {
      method: 'POST',
      body: JSON.stringify({
        moduleId: targetMeta.id,
        area: isConsultorioProcedureReturn
          ? (selectedProcedure || 'PROCEDIMIENTOS')
          : ['consultorio', 'ipl', 'cirugia'].includes(targetMeta.id)
          ? (selectedProcedure || targetMeta.room)
          : targetMeta.room,
        doctorName: isConsultorioProcedureReturn
          ? (selectedProcedure || 'PROCEDIMIENTOS')
          : selectedProcedure || targetMeta.doctors?.[0] || '',
        notes: referralNotes?.value || '',
        operatorUsername: fixedOperatorUsername || currentUser.username,
        operatorName: currentUser.fullName,
        derivedBy: fixedOperatorUsername || currentUser.username
      })
    }));
    closeReferralModal();
    showMessage('Paciente referido correctamente al siguiente m?dulo.');
  } catch (error) {
    showMessage(error.message, true);
  }
});

referralSaveFinalBtn?.addEventListener('click', async () => {
  if (!pendingArrivalPatient) return;
  try {
    await runOperatorAction(() => api(`/api/patients/${pendingArrivalPatient.id}/complete`, {
      method: 'POST',
      body: JSON.stringify({ completedBy: fixedOperatorUsername || currentUser.username })
    }));
    closeReferralModal();
    showMessage('Paciente guardado al final del m?dulo correctamente.');
  } catch (error) {
    showMessage(error.message, true);
  }
});

referralCancelBtn?.addEventListener('click', () => {
  closeReferralModal();
  showMessage('Acci?n cancelada. El paciente permanece en sala hasta confirmar su flujo.');
});

socket.on('state:update', (state) => renderOperatorModules(state));
socket.on('staff:announcement', (payload = {}) => {
  if (payload.targetName) showMessage(`Llamado de apoyo enviado al panel principal: ${payload.targetName}`);
});

(async function init() {
  await loadConfig();
  fillModuleOptions();
  bindUppercaseInputs(document);
  applyRegistrationPermissions();
  if (fixedModuleId || queryModuleId) setModulePageTitle(fixedModuleId || queryModuleId);
  const state = await api('/api/state', { timeoutMs: 3500 });
  renderOperatorModules(state);
})();





internalAnnouncementHistory?.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-repeat-announcement]');
  if (!button) return;
  const announcement = ((latestOperatorState?.internalAnnouncements) || []).find((item) => String(item.id) === String(button.dataset.repeatAnnouncement));
  if (!announcement) {
    showMessage('No se encontr? el comunicado para repetir.', true);
    return;
  }
  try {
    const payload = {
      targetName: announcement.targetName,
      message: announcement.message,
      repeatCount: Math.max(1, Number(announcement.repeatCount || 1)),
      originLabel: announcement.originLabel
    };
    await runOperatorAction(() => api('/api/internal-announcements', {
      method: 'POST',
      body: JSON.stringify({
        ...payload,
        moduleId: fixedModuleId || queryModuleId || currentUser.moduleId,
        requestedBy: fixedOperatorUsername || currentUser?.username || 'operador'
      })
    }));
    showMessage('Comunicado interno repetido correctamente.');
  } catch (error) {
    showMessage(error.message, true);
  }
});

internalAnnouncementForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const payload = normalizeTextPayload(Object.fromEntries(new FormData(internalAnnouncementForm).entries()));
  try {
    await runOperatorAction(() => api('/api/internal-announcements', {
      method: 'POST',
      body: JSON.stringify({
        targetName: payload.targetName,
        message: payload.message,
        moduleId: fixedModuleId || queryModuleId || currentUser.moduleId,
        originLabel: getModuleMeta(fixedModuleId || queryModuleId || currentUser.moduleId || '').label || 'MÓDULO',
        requestedBy: fixedOperatorUsername || currentUser?.username || 'operador'
      })
    }));
    internalAnnouncementForm.reset();
    showMessage('Comunicado interno emitido correctamente.');
  } catch (error) {
    showMessage(error.message, true);
  }
});
lookupPatientBtn?.addEventListener('click', async () => {
  const term = String(operatorDniInput?.value || `${operatorFirstNameInput?.value || ''} ${operatorLastNameInput?.value || ''}`).trim();
  if (!term) { showMessage('Ingrese DNI o nombre para buscar.', true); return; }
  try {
    const result = await api(`/api/search?q=${encodeURIComponent(term)}`);
    const first = (result.results || [])[0]?.patient;
    if (!first) throw new Error('No se encontraron coincidencias en memoria, SQL o RENIEC.');
    operatorDniInput.value = first.dni || operatorDniInput.value;
    operatorFirstNameInput.value = toUppercaseValue(first.firstName || '');
    operatorLastNameInput.value = toUppercaseValue(first.lastName || '');
    showMessage(`Coincidencia cargada desde ${(result.results || [])[0]?.source || 'sistema'}.`);
  } catch (error) {
    showMessage(error.message, true);
  }
});

window.refreshPatientToolHost = refreshOperatorBoard;
window.addEventListener('patient-search:called', () => { refreshOperatorBoard().catch(() => {}); });

/* =========================================================
   Ajuste de distribuci?n visual solicitado: m?dicos laterales
   Mantiene la l?gica, colores, fondo y datos existentes.
   ========================================================= */
function qnRenderDoctorsPanel(state = latestOperatorState || {}) {
  const host = document.getElementById('operatorDoctorsPanel');
  if (!host) return;
  const currentModule = fixedModuleId || queryModuleId || currentUser.moduleId || 'consultorio';
  const module = getModuleMeta(currentModule);
  const doctors = module.doctors?.length ? module.doctors : ['MÉDICO 1','MÉDICO 2','MÉDICO 3','MÉDICO 4','MÉDICO 5','MÉDICO 6'];
  const waiting = (state.queue || []).filter((p) => p.moduleId === currentModule && p.status === 'waiting');
  host.innerHTML = doctors.slice(0, 6).map((doctor, idx) => {
    const count = waiting.filter((p) => (p.doctorName || '') === doctor).length;
    return `<article class="qn-doctor-card" data-qn-doctor="${escapeHtml(doctor)}">
      <div><p class="section-kicker compact">Medico oftalmologo ${idx + 1}</p><h3>${escapeHtml(doctor)}</h3><p>${count} pacientes asignados</p></div>
      <div class="qn-doctor-actions"><button type="button" class="primary-btn small-btn" data-qn-call-doctor="${escapeHtml(doctor)}">Llamar siguiente</button></div>
    </article>`;
  }).join('');
}

function qnMakePatientsDraggable() {
  document.querySelectorAll('#operatorModulesBoard .operator-row').forEach((row) => {
    const callBtn = row.querySelector('button[data-id]');
    if (!callBtn) return;
    row.classList.add('qn-draggable-patient');
    row.setAttribute('draggable', 'true');
    row.dataset.qnPatientId = callBtn.dataset.id;
  });
}

const qnOriginalRenderOperatorModules = renderOperatorModules;
renderOperatorModules = function qnDistributionRenderOperatorModules(state = {}) {
  qnOriginalRenderOperatorModules(state);
  qnRenderDoctorsPanel(state);
  window.setTimeout(qnMakePatientsDraggable, 0);
};

document.addEventListener('dragstart', (event) => {
  const row = event.target.closest?.('[data-qn-patient-id]');
  if (!row) return;
  event.dataTransfer.setData('text/plain', row.dataset.qnPatientId);
});

document.addEventListener('dragover', (event) => {
  const card = event.target.closest?.('.qn-doctor-card');
  if (!card) return;
  event.preventDefault();
  card.classList.add('drag-over');
});

document.addEventListener('dragleave', (event) => {
  const card = event.target.closest?.('.qn-doctor-card');
  if (card) card.classList.remove('drag-over');
});

document.addEventListener('drop', async (event) => {
  const card = event.target.closest?.('.qn-doctor-card');
  if (!card) return;
  event.preventDefault();
  card.classList.remove('drag-over');
  const patientId = event.dataTransfer.getData('text/plain');
  const doctorName = card.dataset.qnDoctor;
  if (!patientId || !doctorName) return;
  if (getDoctorAvailability()[doctorName] === false) { showMessage('Este m?dico no est? marcado como disponible.'); return; }
  try {
    await runOperatorAction(() => api(`/api/patients/${patientId}/assign-doctor`, { method: 'POST', body: JSON.stringify({ doctorName }) }));
    await refreshOperatorBoard();
    showMessage(`Paciente asignado a ${doctorName}.`);
  } catch (error) { showMessage(error.message, true); }
});

document.addEventListener('click', async (event) => {
  const btn = event.target.closest?.('button[data-qn-call-doctor]');
  if (!btn) return;
  const moduleId = fixedModuleId || queryModuleId || currentUser.moduleId || 'consultorio';
  try {
    await runOperatorAction(() => api(`/api/call-next/${moduleId}`, { method: 'POST', body: JSON.stringify({ doctorName: btn.dataset.qnCallDoctor }) }));
    await refreshOperatorBoard();
    showMessage(`Llamando siguiente paciente para ${btn.dataset.qnCallDoctor}.`);
  } catch (error) { showMessage(error.message, true); }
});

window.setTimeout(() => refreshOperatorBoard().catch(() => {}), 600);


/* =========================================================
   AJUSTE FINAL SOLICITADO POR DONATO
   - Registro permitido en los m?dulos.
   - Optometr?a muestra m?dicos de consultorio para arrastrar pacientes.
   - Consultorio muestra 7 m?dicos con check de disponibilidad.
   - Arrastre desde Optometr?a deriva a Consultorio; no solo asigna.
   - Se reducen textos sobrantes y se deja una sola zona de llamado.
   ========================================================= */
(function qnFinalRuntimeFix(){
  const AVAIL_KEY = 'qhali_doctor_availability_v1';
  window.getDoctorAvailability = function getDoctorAvailability(){
    try { return JSON.parse(localStorage.getItem(AVAIL_KEY) || '{}') || {}; } catch { return {}; }
  };
  function setDoctorAvailability(name, enabled){
    const data = window.getDoctorAvailability();
    data[name] = enabled !== false;
    localStorage.setItem(AVAIL_KEY, JSON.stringify(data));
  }
  function availableDoctorsFor(moduleId){
    const module = getModuleMeta(moduleId || 'consultorio');
    const availability = window.getDoctorAvailability();
    return (module.doctors || []).filter((doctor) => availability[doctor] !== false);
  }
  function pickRandomDoctor(moduleId){
    const doctors = availableDoctorsFor(moduleId);
    return doctors[Math.floor(Math.random() * doctors.length)] || getModuleMeta(moduleId).doctors?.[0] || '';
  }
  // Registro habilitado tambi?n para consultorio y otros m?dulos sin bloquear.
  try { window.canRegisterPatientsInThisSession = true; } catch {}

  const oldApply = typeof applyRegistrationPermissions === 'function' ? applyRegistrationPermissions : null;
  if (oldApply) {
    applyRegistrationPermissions = function(){
      if (!operatorPatientForm) return;
      operatorPatientForm.querySelectorAll('input, select, textarea, button').forEach((field)=>{ field.disabled = false; });
      operatorRegistrationSection?.classList.remove('hidden');
      operatorRegistrationBlocked?.classList.add('hidden');
      operatorPatientForm.classList.remove('form-disabled');
    };
  }

  const oldFill = typeof fillModuleOptions === 'function' ? fillModuleOptions : null;
  if (oldFill) {
    fillModuleOptions = function(){
      const moduleId = fixedModuleId || queryModuleId || currentUser.moduleId || 'optometria';
      if (operatorModuleSelect) {
        if (operatorModuleSelect.tagName === 'SELECT') operatorModuleSelect.innerHTML = `<option value="${moduleId}">${getModuleMeta(moduleId).label}</option>`;
        operatorModuleSelect.value = moduleId;
      }
      if (operatorAreaInput) operatorAreaInput.value = getModuleMeta(moduleId).room || getModuleMeta(moduleId).label || '';
      if (operatorDoctorSelect) {
        const val = moduleId === 'consultorio' ? pickRandomDoctor('consultorio') : '';
        operatorDoctorSelect.innerHTML = `<option value="${escapeHtml(val)}">${escapeHtml(val || 'Optometr?a general')}</option>`;
        operatorDoctorSelect.value = val;
      }
      syncOperatorImmediateReferralOptions?.();
    };
  }

  const oldSummary = typeof renderSummary === 'function' ? renderSummary : null;
  if (oldSummary) renderSummary = function(){ if (operatorSummary) operatorSummary.innerHTML = ''; };

  const oldActiveControls = typeof renderActiveDerivationControls === 'function' ? renderActiveDerivationControls : null;
  if (oldActiveControls) renderActiveDerivationControls = function(item){
    return `<div class="inline-actions mobile-stack"><button class="ghost-btn small-btn" data-complete-patient-id="${item.id}">Cerrar atenci?n</button></div>`;
  };

  const oldRenderCalled = typeof renderCalledPatientCard === 'function' ? renderCalledPatientCard : null;
  if (oldRenderCalled) renderCalledPatientCard = function(item, module){
    return `<article class="admin-row operator-row compact live-call-row" draggable="true" data-qn-patient-id="${escapeHtml(item.id)}">
      <div><div class="row-badges">${renderAttentionCodeBadge(item.code, item.doctorName, 'mini-code')}<span class="ghost-btn small-btn" style="pointer-events:none;">LLAMANDO</span></div>
      <h4>${renderPatientName(item)}</h4><p class="muted">DNI ${escapeHtml(item.dni || '-')} ? ${escapeHtml(item.area || module.room)} ? ${escapeHtml(item.doctorName || '')}</p></div>
      <div class="row-actions stacked mobile-stack"><button class="primary-btn small-btn" data-id="${item.id}">Volver a llamar</button><button class="success-btn small-btn" data-present-patient-id="${item.id}">Paciente presente</button></div>
    </article>`;
  };

  const oldDoctors = typeof qnRenderDoctorsPanel === 'function' ? qnRenderDoctorsPanel : null;
  qnRenderDoctorsPanel = function(state = latestOperatorState || {}){
    const host = document.getElementById('operatorDoctorsPanel'); if (!host) return;
    const currentModule = fixedModuleId || queryModuleId || currentUser.moduleId || 'consultorio';
    const targetModule = currentModule === 'optometria' ? 'consultorio' : currentModule;
    const module = getModuleMeta(targetModule);
    const max = currentModule === 'consultorio' ? 7 : 6;
    const doctors = (module.doctors && module.doctors.length ? module.doctors : ['MÉDICO 1','MÉDICO 2','MÉDICO 3','MÉDICO 4','MÉDICO 5','MÉDICO 6','MÉDICO 7']).slice(0,max);
    const availability = window.getDoctorAvailability();
    const waiting = (state.queue || []).filter((p) => p.moduleId === targetModule && p.status === 'waiting');
    host.innerHTML = doctors.map((doctor, idx) => {
      const enabled = availability[doctor] !== false;
      const count = waiting.filter((p) => (p.doctorName || '') === doctor).length;
      return `<article class="qn-doctor-card ${enabled ? '' : 'qn-doctor-disabled'}" data-qn-doctor="${escapeHtml(doctor)}" data-qn-target-module="${targetModule}">
        <label class="qn-doctor-check"><input type="checkbox" data-qn-doctor-available="${escapeHtml(doctor)}" ${enabled ? 'checked' : ''}> Disponible</label>
        <div><p class="section-kicker compact">Medico oftalmologo ${idx + 1}</p><h3>${escapeHtml(doctor)}</h3><p>${count} pacientes asignados</p></div>
        <div class="qn-doctor-actions"><button type="button" class="primary-btn small-btn" data-qn-call-doctor="${escapeHtml(doctor)}" data-qn-call-module="${targetModule}">Llamar siguiente</button></div>
      </article>`;
    }).join('');
  };

  document.addEventListener('change', (event)=>{
    const box = event.target.closest?.('input[data-qn-doctor-available]'); if (!box) return;
    setDoctorAvailability(box.dataset.qnDoctorAvailable, box.checked);
    qnRenderDoctorsPanel(latestOperatorState || {});
  });

  // Captura submit antes del manejador anterior para asignar m?dico aleatorio cuando se registra en consultorio.
  operatorPatientForm?.addEventListener('submit', (event)=>{
    const moduleId = fixedModuleId || queryModuleId || currentUser.moduleId || operatorModuleSelect?.value || 'optometria';
    if (operatorModuleSelect) operatorModuleSelect.value = moduleId;
    if (operatorAreaInput) operatorAreaInput.value = getModuleMeta(moduleId).room || getModuleMeta(moduleId).label;
    if (operatorDoctorSelect && moduleId === 'consultorio' && !operatorDoctorSelect.value) {
      operatorDoctorSelect.innerHTML = `<option value="${escapeHtml(pickRandomDoctor('consultorio'))}">${escapeHtml(pickRandomDoctor('consultorio'))}</option>`;
      operatorDoctorSelect.value = pickRandomDoctor('consultorio');
    }
  }, true);

  // Reemplaza el drop anterior con una acci?n correcta. En optometr?a: derivar a consultorio.
  document.addEventListener('drop', async (event)=>{
    const card = event.target.closest?.('.qn-doctor-card'); if (!card) return;
    event.preventDefault(); event.stopImmediatePropagation();
    card.classList.remove('drag-over');
    const patientId = event.dataTransfer.getData('text/plain');
    const doctorName = card.dataset.qnDoctor; const targetModule = card.dataset.qnTargetModule || 'consultorio';
    if (!patientId || !doctorName) return;
    if (window.getDoctorAvailability()[doctorName] === false) { showMessage('Este m?dico no est? marcado como disponible.', true); return; }
    try {
      const currentModule = fixedModuleId || queryModuleId || currentUser.moduleId || '';
      if (currentModule === 'optometria' && targetModule === 'consultorio') {
        await runOperatorAction(() => api(`/api/patients/${patientId}/derive`, { method:'POST', body: JSON.stringify({ moduleId:'consultorio', area:'Consultorio', doctorName, notes:'REFERIDO DESDE OPTOMETR?A', operatorUsername: fixedOperatorUsername || currentUser.username, operatorName: currentUser.fullName, derivedBy: fixedOperatorUsername || currentUser.username }) }));
        showMessage(`Paciente referido a Consultorio - ${doctorName}.`);
      } else {
        await runOperatorAction(() => api(`/api/patients/${patientId}/assign-doctor`, { method:'POST', body: JSON.stringify({ doctorName }) }));
        const patient = (latestOperatorState?.queue || []).find((x)=>String(x.id)===String(patientId));
        if (!patient || ['waiting', 'absent', 'called'].includes(String(patient.status || '').toLowerCase())) {
          await runOperatorAction(() => api(`/api/call/${patientId}`, { method:'POST', body: JSON.stringify({ operatorUsername: fixedOperatorUsername || currentUser.username, operatorName: currentUser.fullName }) }));
          showMessage(`Paciente asignado y llamado para ${doctorName}.`);
        } else {
          showMessage(`Paciente asignado a ${doctorName}.`);
        }
      }
      await refreshOperatorBoard();
    } catch(error){ showMessage(error.message, true); }
  }, true);

  document.addEventListener('click', async (event)=>{
    const btn = event.target.closest?.('button[data-qn-call-doctor]'); if (!btn) return;
    event.preventDefault(); event.stopImmediatePropagation();
    try {
      await runOperatorAction(() => api(`/api/call-next/${btn.dataset.qnCallModule || 'consultorio'}`, { method:'POST', body: JSON.stringify({ doctorName: btn.dataset.qnCallDoctor, operatorUsername: fixedOperatorUsername || currentUser.username, operatorName: currentUser.fullName }) }));
      await refreshOperatorBoard();
      showMessage(`Llamando siguiente paciente para ${btn.dataset.qnCallDoctor}.`);
    } catch(error){ showMessage(error.message, true); }
  }, true);

  window.setTimeout(()=>{ try { applyRegistrationPermissions(); fillModuleOptions(); refreshOperatorBoard?.(); } catch{} }, 250);
})();

/* =========================================================
   CORRECCIÓN FINAL DE FLUJO OPTOMETRÍA / CONSULTORIO
   - Una sola ventana de llamado activo.
   - Paciente presente en Optometr?a deriva autom?tico a Consultorio.
   - Paciente ausente queda guardado y puede volver a llamarse.
   - Tarjetas de m?dicos compactas y visibles.
   - Arrastre hacia m?dico: Optometr?a deriva a Consultorio; Consultorio asigna m?dico.
   ========================================================= */
(function qnClinicalFlowFinal(){
  let qnDoctorsCache = [];
  const consultorioReturnProceduresFinal = ['PROCEDIMIENTOS', 'PROTOCOLOS', 'MEIBOGRAFIA', 'IMAGENES', 'LENTES', 'TEST DE AGUDEZA VISUAL'];
  function optometrySpecialties() {
    return ['NUEVO', 'CONTROLES', 'GLAUCOMA', 'RETINA', 'CÓRNEA', 'CATARATA', 'CIRUGÍA REFRACTIVA'];
  }
  function pickOptometrySpecialty() {
    const list = optometrySpecialties();
    return list[Math.floor(Math.random() * list.length)] || 'EX?MENES';
  }
  async function loadDoctors(moduleId = 'consultorio') {
    try {
      const res = await api(`/api/doctors?moduleId=${encodeURIComponent(moduleId)}`, { timeoutMs: 3500 });
      qnDoctorsCache = (res.doctors || []).filter((d) => d.enabled !== false).sort((a,b)=>(a.order||999)-(b.order||999));
    } catch {
      qnDoctorsCache = [];
    }
    return qnDoctorsCache;
  }
  function enabledDoctors(moduleId = 'consultorio') {
    const fromCache = qnDoctorsCache.filter((d) => d.moduleId === moduleId && d.enabled !== false).map((d) => d.name);
    return fromCache;
  }
  function consultorioDoctorGroup(doctor = {}) {
    const raw = normalizeClinicalText(`${doctor.name || doctor || ''} ${doctor.specialty || ''}`);
    return (
      raw.includes('ESPECIALISTA') ||
      raw.includes('GLAUCOMA') ||
      raw.includes('RETINA') ||
      raw.includes('CORNEA') ||
      raw.includes('CÓRNEA') ||
      raw.includes('LAGRIMAL') ||
      raw.includes('CATARATA') ||
      raw.includes('REFRACTIVA')
    ) ? 'especialista' : 'general';
  }
  function consultorioAllowedDoctorsForPatient(patient = {}) {
    const category = consultorioCategory(patient);
    const expectedGroup = category === 'especialidad' ? 'especialista' : 'general';
    const rows = qnDoctorsCache
      .filter((doctor) => doctor.moduleId === 'consultorio' && doctor.enabled !== false)
      .sort((a, b) => (a.order || 999) - (b.order || 999));
    const filteredRows = rows.filter((doctor) => consultorioDoctorGroup(doctor) === expectedGroup);
    if (filteredRows.length) return filteredRows.map((doctor) => doctor.name);
    return enabledDoctors('consultorio').filter((doctor) => consultorioDoctorGroup(doctor) === expectedGroup);
  }
  function consultorioAttentionGroupLabel(patient = {}) {
    return consultorioCategory(patient) === 'especialidad' ? 'especialista' : 'médico oftalmólogo';
  }
  function pickDoctor(moduleId = 'consultorio') {
    const list = enabledDoctors(moduleId);
    return list[Math.floor(Math.random() * list.length)] || '';
  }
  function patientFullName(p={}) { return p.displayName || `${p.firstName || ''} ${p.lastName || ''}`.trim(); }
  function normalizeClinicalText(value = '') {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .trim();
  }
  const consultorioCategoryMeta = [
    { id: 'nuevo', title: 'NUEVO', subtitle: 'Pacientes nuevos derivados desde Optometría.' },
    { id: 'especialidad', title: 'ESPECIALIDAD', subtitle: 'Glaucoma, Retina, Córnea, Catarata, Vía lagrimal y Cirugía Refractiva.' },
    { id: 'controles', title: 'CONTROLES', subtitle: 'Pacientes enviados para controles médicos.' }
  ];
  function consultorioCategory(patient = {}) {
    const raw = normalizeClinicalText(`${patient.referralSpecialty || ''} ${patient.doctorName || ''} ${patient.area || ''}`);
    if (raw.includes('CONTROL')) return 'controles';
    if (raw.includes('NUEVO') || raw.includes('OFTALMOLOGIA GENERAL') || raw.includes('GENERAL')) return 'nuevo';
    return 'especialidad';
  }
  function estadoVisible(status = '') {
    const key = String(status || '').toLowerCase();
    const labels = {
      waiting: 'En espera',
      called: 'Llamado',
      attended: 'Presente',
      absent: 'Ausente',
      dilating: 'En dilatación',
      completed: 'Finalizado',
      referred_out: 'Referido'
    };
    return labels[key] || 'En espera';
  }
  function isDoctorAttentionPatient(item = {}) {
    return ['called', 'attended'].includes(String(item.status || '').toLowerCase());
  }
  function getDoctorAttentionPatient(state = {}, doctor = '', moduleId = 'consultorio') {
    return (state.queue || [])
      .filter((p) => p.moduleId === moduleId && String(p.doctorName || '') === String(doctor || '') && isDoctorAttentionPatient(p))
      .sort((a, b) => new Date(b.arrivedAt || b.calledAt || b.updatedAt || 0) - new Date(a.arrivedAt || a.calledAt || a.updatedAt || 0))[0] || null;
  }
  function rowCard(item, module, buttonLabel = 'Llamar', extra = '') {
    const isConsultorioClose = module.id === 'consultorio' && /cerrar|atencion|atenci/i.test(String(buttonLabel || '')) && String(item.status || '').toLowerCase() === 'attended';
    const actionAttr = isConsultorioClose ? `data-qn-doctor-attention-id="${escapeHtml(item.id)}"` : `data-id="${escapeHtml(item.id)}"`;
    const visibleButtonLabel = isConsultorioClose ? 'Atención' : buttonLabel;
    if (module.id === 'consultorio') {
      return `<article class="admin-row operator-row compact qn-patient-row qn-consultorio-mini-row" draggable="true" data-qn-patient-id="${escapeHtml(item.id)}">
        <div class="qn-consultorio-mini-info">
          ${renderAttentionCodeBadge(item.code, item.doctorName, 'mini-code')}
          <h4>${escapeHtml(patientFullName(item))}</h4>
        </div>
        <button class="primary-btn small-btn" ${actionAttr}>${escapeHtml(visibleButtonLabel)}</button>
      </article>`;
    }
    const canReferDirectlyFromOptometry = module.id === 'optometria' && ['waiting', 'absent'].includes(String(item.status || '').toLowerCase());
    const directReferralButton = canReferDirectlyFromOptometry
      ? `<button class="ghost-btn small-btn" data-qn-open-optometry-specialties="${escapeHtml(item.id)}">Referir</button>`
      : '';
    return `<article class="admin-row operator-row compact qn-patient-row" draggable="true" data-qn-patient-id="${escapeHtml(item.id)}">
      <div><div class="row-badges">${renderAttentionCodeBadge(item.code, item.doctorName, 'mini-code')}${item.isReferred || item.referred ? '<span class="ghost-btn small-btn" style="pointer-events:none;">REFERIDO</span>' : ''}</div>
      <h4>${escapeHtml(patientFullName(item))}</h4><p class="muted">DNI ${escapeHtml(item.dni || '-')} - ${escapeHtml(item.area || module.room)}${item.doctorName ? ' - ' + escapeHtml(item.doctorName) : ''}</p>${extra}</div>
      <div class="row-actions stacked mobile-stack"><button class="primary-btn small-btn" ${actionAttr}>${escapeHtml(visibleButtonLabel)}</button>${directReferralButton}</div>
    </article>`;
  }
  function activeCard(activeCall, module) {
    if (!activeCall) return '<div class="empty-state small">Sin atención activa en este módulo.</div>';
    const isPresent = String(activeCall.status || '').toLowerCase() === 'attended';
    const presentActions = module.id === 'optometria'
      ? `<button class="success-btn small-btn" data-complete-patient-id="${escapeHtml(activeCall.id)}">Cerrar atención</button>
         <button class="primary-btn small-btn" data-qn-open-optometry-specialties="${escapeHtml(activeCall.id)}">Referir a Consultorio</button>`
      : `<button class="success-btn small-btn" data-qn-doctor-attention-id="${escapeHtml(activeCall.id)}">Atención</button>`;
    const pendingActions = `<button class="primary-btn small-btn" data-repeat-module-id="${escapeHtml(module.id)}">Repetir llamado</button>
        <button class="success-btn small-btn" data-qn-auto-present="${escapeHtml(activeCall.id)}">Paciente presente</button>
        <button class="ghost-btn small-btn" data-qn-absent="${escapeHtml(activeCall.id)}">Paciente ausente</button>`;
    return `<article class="admin-row operator-row compact qn-active-call-card" draggable="true" data-qn-patient-id="${escapeHtml(activeCall.id)}">
      <div><div class="row-badges">${renderAttentionCodeBadge(activeCall.code, activeCall.doctorName, 'mini-code')}<span class="ghost-btn small-btn" style="pointer-events:none;">${isPresent ? 'PRESENTE' : 'LLAMANDO'}</span></div>
      <h4>${escapeHtml(patientFullName(activeCall))}</h4><p class="muted">DNI ${escapeHtml(activeCall.dni || '-')} - ${escapeHtml(activeCall.area || module.room)}${activeCall.doctorName ? ' - ' + escapeHtml(activeCall.doctorName) : ''}</p></div>
      <div class="row-actions stacked mobile-stack">
        ${isPresent ? presentActions : pendingActions}
      </div>
    </article>`;
  }
  function calledArrivalRow(item, module) {
    if (module.id === 'consultorio') {
      return `<article class="admin-row operator-row compact qn-patient-row qn-called-waiting-row qn-consultorio-called-card" draggable="true" data-qn-patient-id="${escapeHtml(item.id)}">
        <div class="qn-consultorio-called-head">
          ${renderAttentionCodeBadge(item.code, item.doctorName, 'mini-code')}
          <span class="ghost-btn small-btn" style="pointer-events:none;">Llamando</span>
        </div>
        <h4>${escapeHtml(patientFullName(item))}</h4>
        <div class="row-actions qn-consultorio-call-actions">
          <button class="primary-btn small-btn" data-qn-repeat-patient="${escapeHtml(item.id)}">Repetir llamado</button>
          <button class="success-btn small-btn" data-qn-auto-present="${escapeHtml(item.id)}">Paciente presente</button>
          <button class="ghost-btn small-btn" data-qn-absent="${escapeHtml(item.id)}">Paciente ausente</button>
        </div>
      </article>`;
    }
    return `<article class="admin-row operator-row compact qn-patient-row qn-called-waiting-row" draggable="true" data-qn-patient-id="${escapeHtml(item.id)}">
      <div><div class="row-badges">${renderAttentionCodeBadge(item.code, item.doctorName, 'mini-code')}<span class="ghost-btn small-btn" style="pointer-events:none;">Llamando</span></div>
      <h4>${escapeHtml(patientFullName(item))}</h4><p class="muted">DNI ${escapeHtml(item.dni || '-')} - ${escapeHtml(item.area || module.room)}${item.doctorName ? ' - ' + escapeHtml(item.doctorName) : ''}</p></div>
      <div class="row-actions stacked mobile-stack">
        <button class="primary-btn small-btn" data-qn-repeat-patient="${escapeHtml(item.id)}">Repetir llamado</button>
        <button class="success-btn small-btn" data-qn-auto-present="${escapeHtml(item.id)}">Paciente presente</button>
        <button class="ghost-btn small-btn" data-qn-absent="${escapeHtml(item.id)}">Paciente ausente</button>
      </div>
    </article>`;
  }
  function dilatingRow(item, module) {
    return `<article class="admin-row operator-row compact qn-patient-row qn-dilating-row" draggable="true" data-qn-patient-id="${escapeHtml(item.id)}">
      <div>
        <div class="row-badges">${renderAttentionCodeBadge(item.code, item.doctorName, 'mini-code')}<span class="ghost-btn small-btn" style="pointer-events:none;">En dilatación</span></div>
        <h4>${escapeHtml(patientFullName(item))}</h4>
        <p class="muted">DNI ${escapeHtml(item.dni || '-')} - vuelve con ${escapeHtml(item.dilationReturnDoctorName || item.doctorName || 'mismo médico')}</p>
        <p class="muted">Inicio: ${escapeHtml(formatDateTime(item.dilationStartedAt || item.updatedAt || item.arrivedAt || item.calledAt))}</p>
      </div>
      <div class="row-actions stacked mobile-stack">
        <button class="primary-btn small-btn" data-id="${escapeHtml(item.id)}">Llamar mismo médico</button>
        <button class="ghost-btn small-btn" data-qn-doctor-attention-id="${escapeHtml(item.id)}">Decidir acción</button>
      </div>
    </article>`;
  }
  function completedRow(item, module) {
    return `<article class="admin-row operator-row compact qn-patient-row qn-completed-row">
      <div><div class="row-badges">${renderAttentionCodeBadge(item.code, item.doctorName, 'mini-code')}<span class="ghost-btn small-btn" style="pointer-events:none;">FINALIZADO</span></div>
      <h4>${escapeHtml(patientFullName(item))}</h4><p class="muted">DNI ${escapeHtml(item.dni || '-')} - ${escapeHtml(item.area || module.room)}${item.doctorName ? ' - ' + escapeHtml(item.doctorName) : ''}</p></div>
      <div class="row-actions stacked mobile-stack"><span class="muted">Cerrado ${escapeHtml(formatDateTime(item.completedAt || item.updatedAt || item.createdAt))}</span></div>
    </article>`;
  }
  function categoryPatientCount(items = [], categoryId = '') {
    return items.filter((patient) => consultorioCategory(patient) === categoryId).length;
  }
  function renderConsultorioCategorySection(meta, module, queues) {
    const waitItems = queues.waiting.filter((patient) => consultorioCategory(patient) === meta.id);
    const absentItems = queues.absent.filter((patient) => consultorioCategory(patient) === meta.id);
    const calledItems = queues.called.filter((patient) => consultorioCategory(patient) === meta.id);
    const attendedItems = queues.attended.filter((patient) => consultorioCategory(patient) === meta.id);
    const dilatingItems = (queues.dilating || []).filter((patient) => consultorioCategory(patient) === meta.id);
    const pendingTotal = waitItems.length + absentItems.length;
    const activeTotal = calledItems.length + attendedItems.length;
    const patientRows = [
      ...waitItems.map((patient) => rowCard(patient, module, 'Llamar')),
      ...absentItems.map((patient) => rowCard(patient, module, 'Volver a llamar', `<p class="muted">Ausente: ${escapeHtml(formatDateTime(patient.absentAt || patient.calledAt))}</p>`))
    ].join('');
    const activeRows = [
      ...calledItems.map((patient) => calledArrivalRow(patient, module)),
      ...attendedItems.map((patient) => rowCard(patient, module, 'Cerrar atención')),
      ...dilatingItems.map((patient) => dilatingRow(patient, module))
    ].join('');
    return `<section class="qn-consultorio-category qn-consultorio-category-${escapeHtml(meta.id)}">
      <div class="qn-consultorio-category-head">
        <div>
          <p class="section-kicker compact">Consultorio</p>
          <h3>${escapeHtml(meta.title)}</h3>
          <p class="muted">${escapeHtml(meta.subtitle)}</p>
        </div>
        <span class="module-count">${pendingTotal}</span>
      </div>
      <div class="qn-consultorio-scroll">
        ${patientRows || '<div class="empty-state small">Sin pacientes pendientes en esta sección.</div>'}
      </div>
      <div class="qn-consultorio-attending">
        <div class="operator-subtitle">Atención de esta sección</div>
        <div class="operator-queue-list">${activeRows || '<div class="empty-state small">Sin pacientes llamados o en atención.</div>'}</div>
      </div>
    </section>`;
  }
  function renderConsultorioModuleCard(module, queues, completed) {
    const totalPending = consultorioCategoryMeta.reduce((total, meta) => {
      return total + categoryPatientCount(queues.waiting, meta.id) + categoryPatientCount(queues.absent, meta.id);
    }, 0);
    return `<article class="operator-module-card glass ${escapeHtml(module.id)} qn-clean-module qn-consultorio-split-module">
      <div class="operator-module-head qn-min-head">
        <div>
          <p class="section-kicker compact">Consultorio</p>
          <h3>Bandejas de atención</h3>
          <p class="muted qn-module-room">Nuevos, especialidades y controles organizados en columnas independientes.</p>
        </div>
        <span class="module-count">${totalPending}</span>
      </div>
      <div class="qn-consultorio-category-grid qn-consultorio-board">
        ${consultorioCategoryMeta.map((meta) => renderConsultorioCategorySection(meta, module, queues)).join('')}
      </div>
      <div class="operator-queue-box qn-consultorio-completed-box">
        <div class="operator-subtitle">Pacientes atendidos guardados al final</div>
        <div class="operator-queue-list">${completed.length ? completed.map((patient)=>completedRow(patient,module)).join('') : '<div class="empty-state small">No hay pacientes finalizados.</div>'}</div>
      </div>
    </article>`;
  }
  function syncConsultorioLeftPanel(currentModule, module, queues) {
    const leftTitle = document.querySelector('.qn-left-register h2');
    const mainKicker = document.querySelector('.qn-patient-list-panel .qn-clean-head .section-kicker');
    const mainTitle = document.querySelector('.qn-patient-list-panel .qn-clean-head h1');
    let panel = document.getElementById('qnConsultorioLeftPanel');
    if (!panel && operatorRegistrationSection) {
      panel = document.createElement('div');
      panel.id = 'qnConsultorioLeftPanel';
      panel.className = 'qn-consultorio-side-panel hidden';
      operatorRegistrationSection.appendChild(panel);
    }
    if (currentModule !== 'consultorio') {
      document.body.classList.remove('qn-consultorio-mode');
      setConsultorioFloatingBrandVisible(false);
      if (leftTitle) leftTitle.textContent = 'Registro de pacientes';
      if (mainKicker) mainKicker.textContent = 'Lista de pacientes registrados';
      if (mainTitle) mainTitle.textContent = 'Pacientes para atención';
      operatorPatientForm?.classList.remove('hidden');
      panel?.classList.add('hidden');
      return;
    }
    document.body.classList.add('qn-consultorio-mode');
    setConsultorioFloatingBrandVisible(true);
    if (leftTitle) leftTitle.textContent = 'Nuevos';
    if (mainKicker) mainKicker.textContent = 'Consultorio';
    if (mainTitle) mainTitle.textContent = 'Bandejas de atención';
    if (operatorSubcopy) operatorSubcopy.textContent = 'Pacientes nuevos enviados desde Optometría.';
    if (operatorFormMessage) operatorFormMessage.textContent = '';
    operatorPatientForm?.classList.add('hidden');
    operatorRegistrationBlocked?.classList.add('hidden');
    if (panel) {
      panel.innerHTML = '';
      panel.classList.remove('hidden');
    }
  }
  window.qnRenderDoctorsPanelFinal = async function(state = latestOperatorState || {}) {
    const host = document.getElementById('operatorDoctorsPanel'); if (!host) return;
    const currentModule = fixedModuleId || queryModuleId || currentUser.moduleId || 'consultorio';
    const targetModule = currentModule === 'optometria' ? 'consultorio' : currentModule;
    if (currentModule === 'optometria') {
      const sidebarHead = document.querySelector('.qn-doctors-sidebar .section-head div');
      if (sidebarHead) {
        sidebarHead.innerHTML = '<p class="section-kicker">Referencias de Consultorio</p><h2>Pacientes referidos</h2><p class="muted">Aquí se ordenan los pacientes enviados por cualquier médico o especialista de Consultorio. Se llaman según el orden de referencia.</p>';
      }
      const consultorioRefs = (state.queue || [])
        .filter((patient) => patient.moduleId === 'optometria')
        .filter((patient) => patient.isReferred || patient.referred)
        .filter((patient) => String(patient.referralOriginModuleId || '').toLowerCase() === 'consultorio')
        .filter((patient) => ['waiting', 'called', 'attended', 'absent'].includes(String(patient.status || '').toLowerCase()))
        .sort((a, b) => new Date(a.referredAt || a.createdAt || 0) - new Date(b.referredAt || b.createdAt || 0));
      host.innerHTML = `
        <section class="qn-referrals-panel">
          <div class="qn-referrals-head">
            <div>
              <p class="section-kicker compact">Orden de referencia</p>
              <h3>${consultorioRefs.length} paciente${consultorioRefs.length === 1 ? '' : 's'} pendiente${consultorioRefs.length === 1 ? '' : 's'}</h3>
            </div>
          </div>
          <div class="qn-referrals-list qn-referrals-list-compact" role="list">
            ${consultorioRefs.length ? `
              <div class="qn-referral-table-head" aria-hidden="true">
                <span>N°</span>
                <span>Número de paciente</span>
                <span>Nombre del paciente</span>
                <span>Llamar</span>
              </div>
            ` : ''}
            ${consultorioRefs.length ? consultorioRefs.map((patient, idx) => `
              <article class="qn-referral-card qn-referral-compact-row" draggable="true" data-qn-patient-id="${escapeHtml(patient.id)}" role="listitem">
                <span class="qn-referral-order">${idx + 1}</span>
                <span class="qn-referral-number">${escapeHtml(patient.code || String(idx + 1))}</span>
                <strong class="qn-referral-name">${escapeHtml(patientFullName(patient))}</strong>
                <button type="button" class="primary-btn small-btn" data-qn-call-referral-id="${escapeHtml(patient.id)}">Llamar</button>
              </article>
            `).join('') : '<div class="empty-state small">Sin referencias pendientes desde Consultorio.</div>'}
          </div>
        </section>`;
      return;
    }
    if (currentModule === 'consultorio') {
      const module = getModuleMeta('consultorio');
      const sidebarHead = document.querySelector('.qn-doctors-sidebar .section-head div');
      if (sidebarHead) {
        sidebarHead.innerHTML = '<p class="section-kicker">Consultorio</p><h2>Controles</h2><p class="muted">Pacientes derivados para control. Los médicos se asignan recién cuando el paciente está presente.</p>';
      }
      const queues = {
        waiting: queueByModule((state.queue || []).filter((p)=>p.status==='waiting'), 'consultorio', fixedDoctorName),
        called: queueByModule((state.queue || []).filter((p)=>p.status==='called'), 'consultorio', fixedDoctorName),
        absent: queueByModule((state.queue || []).filter((p)=>p.status==='absent'), 'consultorio', fixedDoctorName),
        dilating: queueByModule((state.queue || []).filter((p)=>p.status==='dilating'), 'consultorio', fixedDoctorName),
        attended: queueByModule((state.queue || []).filter((p)=>p.status==='attended'), 'consultorio', fixedDoctorName)
      };
      const controlesMeta = consultorioCategoryMeta.find((item) => item.id === 'controles');
      host.innerHTML = `<div class="qn-consultorio-side-panel">${renderConsultorioCategorySection(controlesMeta, module, queues)}</div>`;
      return;
    }
    const sidebarHead = document.querySelector('.qn-doctors-sidebar .section-head div');
    if (sidebarHead) {
      sidebarHead.innerHTML = '<p class="section-kicker">Consultorio</p><h2>Médicos activos</h2><p class="muted">Seleccione el médico disponible para llamar o continuar la atención del paciente.</p>';
    }
    await loadDoctors(targetModule);
    const doctors = enabledDoctors(targetModule).slice(0, targetModule === 'consultorio' ? 7 : 6);
    const waiting = (state.queue || []).filter((p) => p.moduleId === targetModule && ['waiting','absent'].includes(String(p.status || '').toLowerCase()));
    if (!doctors.length) {
      host.innerHTML = '<div class="empty-state small">No hay médicos activos. Active médicos desde Admin para asignar y llamar pacientes.</div>';
      return;
    }
    host.innerHTML = doctors.map((doctor, idx) => {
      const count = waiting.filter((p) => (p.doctorName || '') === doctor).length;
      const active = getDoctorAttentionPatient(state, doctor, targetModule);
      if (active) {
        const isPresent = String(active.status || '').toLowerCase() === 'attended';
        if (!isPresent) {
          return `<article class="qn-doctor-card qn-doctor-card-compact qn-doctor-calling" data-qn-doctor="${escapeHtml(doctor)}" data-qn-target-module="${escapeHtml(targetModule)}">
            <div><p class="section-kicker compact">Médico ${idx + 1}</p><h3>${escapeHtml(doctor)}</h3><p>Llamando ${escapeHtml(active.code || '')} - ${escapeHtml(patientFullName(active))}</p></div>
            <div class="qn-doctor-card-actions">
              <button type="button" class="primary-btn small-btn" data-qn-repeat-patient="${escapeHtml(active.id)}">Repetir llamado</button>
              <button type="button" class="success-btn small-btn" data-qn-auto-present="${escapeHtml(active.id)}">Paciente presente</button>
              <button type="button" class="ghost-btn small-btn" data-qn-absent="${escapeHtml(active.id)}">Ausente</button>
            </div>
          </article>`;
        }
        return `<article class="qn-doctor-card qn-doctor-card-compact qn-doctor-in-attention" data-qn-doctor="${escapeHtml(doctor)}" data-qn-target-module="${escapeHtml(targetModule)}">
          <div><p class="section-kicker compact">Médico ${idx + 1}</p><h3>${escapeHtml(doctor)}</h3><p>Atendiendo ${escapeHtml(active.code || '')} - ${escapeHtml(patientFullName(active))}</p></div>
          <button type="button" class="success-btn small-btn" data-qn-doctor-attention-id="${escapeHtml(active.id)}">Atención</button>
        </article>`;
      }
      return `<article class="qn-doctor-card qn-doctor-card-compact" data-qn-doctor="${escapeHtml(doctor)}" data-qn-target-module="${escapeHtml(targetModule)}">
        <div><p class="section-kicker compact">Médico ${idx + 1}</p><h3>${escapeHtml(doctor)}</h3><p>${count} pacientes</p></div>
        <button type="button" class="primary-btn small-btn" data-qn-call-doctor="${escapeHtml(doctor)}" data-qn-call-module="${escapeHtml(targetModule)}">Llamar</button>
      </article>`;
    }).join('');
  };

  const oldRender = renderOperatorModules;
  renderOperatorModules = function qnCleanRender(state = {}) {
    latestOperatorState = state || latestOperatorState;
    const queue = state.queue || [];
    const modules = visibleModules();
    if (!modules.some((module) => module.id === 'consultorio')) {
      syncConsultorioLeftPanel(modules[0]?.id || '', modules[0] || getModuleMeta(fixedModuleId || queryModuleId || 'optometria'), { waiting: [], called: [], absent: [], attended: [] });
    }
    if (fixedModuleId) { const module = getModuleMeta(fixedModuleId); operatorTitle.textContent = module.label; operatorSubcopy.textContent = ''; }
    if (operatorSummary) operatorSummary.innerHTML = '';
    renderInternalAnnouncements(state.internalAnnouncements || []);
    updateFamilyCallButton();
    applyOperatorBoardLayout(modules.length);
    operatorModulesBoard.innerHTML = modules.map((module) => {
      const active = state.currentCalls?.[module.id] || null;
      const waiting = queueByModule(queue.filter((p)=>p.status==='waiting'), module.id, fixedDoctorName);
      const called = queueByModule(queue.filter((p)=>p.status==='called'), module.id, fixedDoctorName);
      const absent = queueByModule(queue.filter((p)=>p.status==='absent'), module.id, fixedDoctorName);
      const dilating = queueByModule(queue.filter((p)=>p.status==='dilating'), module.id, fixedDoctorName);
      const attendedAll = queueByModule(queue.filter((p)=>p.status==='attended'), module.id, fixedDoctorName);
      const attended = module.id === 'consultorio' ? attendedAll : attendedAll.filter((p)=>!active || p.id !== active.id);
      const completed = queueByModule(queue.filter((p)=>p.status==='completed'), module.id, fixedDoctorName).slice(-8).reverse();
      if (module.id === 'consultorio') {
        syncConsultorioLeftPanel('consultorio', module, { waiting, called, absent, dilating, attended });
        return renderConsultorioModuleCard(module, { waiting, called, absent, dilating, attended }, completed);
      }
      const activeBlock = module.id === 'consultorio' && active
        ? ''
        : `<div class="operator-active-box ${active ? 'live' : ''}"><div class="operator-active-title">Llamado activo en ${escapeHtml(module.label)}</div>${activeCard(active, module)}</div>`;
      return `<article class="operator-module-card glass ${escapeHtml(module.id)} qn-clean-module">
        <div class="operator-module-head qn-min-head"><div><p class="section-kicker compact">Módulo de atención</p><h3>${escapeHtml(module.label)}</h3><p class="muted qn-module-room">Destino: ${escapeHtml(module.room || module.label || 'Consultorio')}</p></div><span class="module-count">${waiting.length + absent.length}</span></div>
        ${activeBlock}
        <div class="operator-queue-box"><div class="operator-subtitle">Pacientes en espera - ${escapeHtml(module.label)}</div><div class="operator-queue-list">${waiting.length ? waiting.map((p)=>rowCard(p,module,'Llamar')).join('') : '<div class="empty-state small">Sin pacientes en espera.</div>'}</div><div class="row-actions operator-footer-actions"><button class="ghost-btn" data-module-id="${escapeHtml(module.id)}">Llamar siguiente ${escapeHtml(module.label)}</button></div></div>
        <div class="operator-queue-box qn-called-waiting-box"><div class="operator-subtitle">Pacientes llamados / esperando llegada</div><div class="operator-queue-list">${called.length ? called.map((p)=>calledArrivalRow(p,module)).join('') : '<div class="empty-state small">No hay pacientes llamados esperando llegada.</div>'}</div></div>
        <div class="operator-queue-box qn-absent-box"><div class="operator-subtitle">Pacientes ausentes para volver a llamar</div><div class="operator-queue-list">${absent.length ? absent.map((p)=>rowCard(p,module,'Volver a llamar', `<p class="muted">Ausente: ${escapeHtml(formatDateTime(p.absentAt || p.calledAt))}</p>`)).join('') : '<div class="empty-state small">No hay pacientes ausentes.</div>'}</div></div>
        <div class="operator-queue-box"><div class="operator-subtitle">Pacientes presentes / en sala</div><div class="operator-queue-list">${attended.length ? attended.map((p)=>rowCard(p,module,'Cerrar atención')).join('') : '<div class="empty-state small">Sin pacientes presentes en sala.</div>'}</div></div>
        <div class="operator-queue-box"><div class="operator-subtitle">Pacientes atendidos guardados al final</div><div class="operator-queue-list">${completed.length ? completed.map((p)=>completedRow(p,module)).join('') : '<div class="empty-state small">No hay pacientes finalizados.</div>'}</div></div>
      </article>`;
    }).join('');
    qnRenderDoctorsPanelFinal(state).catch(()=>{});
    window.setTimeout(qnMakePatientsDraggable, 0);
  };

  function ensureOptometrySpecialtyPicker() {
    let overlay = document.getElementById('qnOptometrySpecialtyPicker');
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'qnOptometrySpecialtyPicker';
    overlay.className = 'qn-floating-specialty-overlay hidden';
    overlay.innerHTML = `
      <div class="qn-floating-specialty-card glass">
        <div class="section-head compact-modal-head">
          <div>
            <p class="section-kicker">Paciente presente</p>
            <h3>Seleccionar especialidad</h3>
            <p class="muted" id="qnSpecialtyPatientLabel">Seleccione la especialidad para continuar.</p>
          </div>
          <button type="button" class="ghost-btn small-btn" data-qn-close-specialty>Cancelar</button>
        </div>
        <div id="qnSpecialtyOptions" class="qn-floating-specialty-grid"></div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay || event.target.closest('[data-qn-close-specialty]')) {
        closeOptometrySpecialtyPicker();
      }
    });
    return overlay;
  }

  function closeOptometrySpecialtyPicker() {
    const overlay = document.getElementById('qnOptometrySpecialtyPicker');
    if (!overlay) return;
    overlay.classList.add('hidden');
    overlay.dataset.patientId = '';
  }

  function openOptometrySpecialtyPicker(patient) {
    const overlay = ensureOptometrySpecialtyPicker();
    const label = overlay.querySelector('#qnSpecialtyPatientLabel');
    const options = overlay.querySelector('#qnSpecialtyOptions');
    const patientId = patient?.id || '';
    overlay.dataset.patientId = patientId;
    if (label) {
      label.textContent = `${patientFullName(patient)} - ${patient?.code || ''}. Elija una especialidad y el paciente pasará directo a Consultorio sin llamada previa.`;
    }
    const specialties = optometrySpecialties();
    options.innerHTML = specialties.map((specialty, idx) => `
      <button type="button" class="qn-floating-specialty-option" data-qn-specialty-choice="${escapeHtml(specialty)}">
        <span>Destino ${idx + 1}</span>
        <strong>${escapeHtml(specialty)}</strong>
        <small>${['NUEVO', 'CONTROLES'].includes(normalizeClinicalText(specialty)) ? 'Referencia a Consultorio' : 'Referencia a especialista'}</small>
      </button>
    `).join('');
    overlay.classList.remove('hidden');
  }

  function ensureConsultorioActionPicker() {
    let overlay = document.getElementById('qnConsultorioActionPicker');
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'qnConsultorioActionPicker';
    overlay.className = 'qn-floating-specialty-overlay hidden';
    overlay.innerHTML = `
      <div class="qn-floating-specialty-card glass qn-consultorio-action-card">
        <div class="section-head compact-modal-head">
          <div>
            <p class="section-kicker">Fin de atención</p>
            <h3>Acción del paciente</h3>
            <p class="muted" id="qnConsultorioActionLabel">Seleccione finalizar o referir a Optometría.</p>
          </div>
          <button type="button" class="ghost-btn small-btn" data-qn-close-consultorio-action>Cancelar</button>
        </div>
        <div class="qn-floating-specialty-grid">
          <button type="button" class="qn-floating-specialty-option qn-finalize-option" data-qn-consultorio-finalize>
            <span>Finalizar</span>
            <strong>Finalizar atención</strong>
            <small>Guardar cierre médico</small>
          </button>
          <button type="button" class="qn-floating-specialty-option qn-dilate-option" data-qn-consultorio-dilate>
            <span>Dilatación</span>
            <strong>Enviar a dilatación</strong>
            <small>Vuelve con el mismo médico</small>
          </button>
          ${consultorioReturnProceduresFinal.map((procedure, idx) => `
            <button type="button" class="qn-floating-specialty-option" data-qn-consultorio-procedure="${escapeHtml(procedure)}">
              <span>Referencia ${idx + 1}</span>
              <strong>${escapeHtml(procedure)}</strong>
              <small>Enviar a Optometría</small>
            </button>
          `).join('')}
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay || event.target.closest('[data-qn-close-consultorio-action]')) {
        closeConsultorioActionPicker();
      }
    });
    return overlay;
  }

  function closeConsultorioActionPicker() {
    const overlay = document.getElementById('qnConsultorioActionPicker');
    if (!overlay) return;
    overlay.classList.add('hidden');
    overlay.dataset.patientId = '';
  }

  function openConsultorioActionPicker(patient) {
    const overlay = ensureConsultorioActionPicker();
    overlay.dataset.patientId = patient?.id || '';
    const label = overlay.querySelector('#qnConsultorioActionLabel');
    if (label) {
      label.textContent = `${patientFullName(patient)} - ${patient?.code || ''}. Seleccione la acción final de Consultorio.`;
    }
    overlay.classList.remove('hidden');
  }
  function ensureConsultorioDoctorPicker() {
    let overlay = document.getElementById('qnConsultorioDoctorPicker');
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'qnConsultorioDoctorPicker';
    overlay.className = 'qn-floating-specialty-overlay hidden';
    overlay.innerHTML = `
      <div class="qn-floating-specialty-card glass qn-consultorio-doctor-card">
        <div class="section-head compact-modal-head">
          <div>
            <p class="section-kicker">Referencia de Optometría</p>
            <h3>Asignar médico</h3>
            <p class="muted" id="qnConsultorioDoctorLabel">Seleccione el médico o especialista que atenderá al paciente.</p>
          </div>
          <button type="button" class="ghost-btn small-btn" data-qn-close-consultorio-doctor>Cancelar</button>
        </div>
        <div id="qnConsultorioDoctorOptions" class="qn-floating-specialty-grid"></div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay || event.target.closest('[data-qn-close-consultorio-doctor]')) {
        closeConsultorioDoctorPicker();
      }
    });
    return overlay;
  }
  function closeConsultorioDoctorPicker() {
    const overlay = document.getElementById('qnConsultorioDoctorPicker');
    if (!overlay) return;
    overlay.classList.add('hidden');
    overlay.dataset.patientId = '';
  }
  async function openConsultorioDoctorPicker(patient) {
    await loadDoctors('consultorio');
    const overlay = ensureConsultorioDoctorPicker();
    const label = overlay.querySelector('#qnConsultorioDoctorLabel');
    const options = overlay.querySelector('#qnConsultorioDoctorOptions');
    overlay.dataset.patientId = patient?.id || '';
    const expectedLabel = consultorioAttentionGroupLabel(patient);
    if (label) {
      label.textContent = `${patientFullName(patient)} - ${patient?.code || ''}. Debe atenderse con ${expectedLabel}.`;
    }
    const doctors = consultorioAllowedDoctorsForPatient(patient);
    options.innerHTML = doctors.map((doctor, idx) => `
      <button type="button" class="qn-floating-specialty-option" data-qn-consultorio-doctor-choice="${escapeHtml(doctor)}">
        <span>${escapeHtml(expectedLabel)} ${idx + 1}</span>
        <strong>${escapeHtml(doctor)}</strong>
        <small>Asignar para atención</small>
      </button>
    `).join('') || `<div class="empty-state small">No hay ${escapeHtml(expectedLabel)} activo en Admin.</div>`;
    overlay.classList.remove('hidden');
  }
  async function patientHasAssignedConsultorioDoctor(patient = {}) {
    await loadDoctors('consultorio');
    return consultorioAllowedDoctorsForPatient(patient).some((doctor) => String(doctor) === String(patient.doctorName || ''));
  }

  async function openDoctorAttention(patientId) {
    let patient = (latestOperatorState?.queue || []).find((p) => String(p.id) === String(patientId));
    if (!patient) throw new Error('No se encontró el paciente en atención.');
    if (String(patient.status || '').toLowerCase() === 'dilating') {
      openConsultorioActionPicker(patient);
      return;
    }
    if (String(patient.status || '').toLowerCase() !== 'attended') {
      const presentResult = await runOperatorAction(() => api(`/api/patients/${patientId}/present`, {
        method: 'POST',
        body: JSON.stringify({ operatorUsername: fixedOperatorUsername || currentUser.username, operatorName: currentUser.fullName, updatedBy: fixedOperatorUsername || currentUser.username })
      }));
      patient = presentResult?.patient || patient;
      await refreshOperatorBoard();
    }
    if (patient.moduleId === 'consultorio' && !(await patientHasAssignedConsultorioDoctor(patient))) {
      await openConsultorioDoctorPicker(patient);
      showMessage('Seleccione el médico que atenderá al paciente.');
      return;
    }
    openConsultorioActionPicker(patient);
  }

  async function derivePresentOptometryPatient(patientId, specialty) {
    if (!patientId || !specialty) throw new Error('Seleccione una especialidad válida.');
    await runOperatorAction(() => api(`/api/patients/${patientId}/derive`, {
      method:'POST',
      body: JSON.stringify({
        moduleId:'consultorio',
        area:'Consultorio',
        doctorName: specialty,
        notes:'REFERIDO DESDE OPTOMETRÍA POR PACIENTE PRESENTE',
        operatorUsername: fixedOperatorUsername || currentUser.username,
        operatorName: currentUser.fullName,
        derivedBy: fixedOperatorUsername || currentUser.username
      })
    }));
    closeOptometrySpecialtyPicker();
    showMessage(`Paciente enviado a Consultorio - ${specialty}.`);
    await refreshOperatorBoard();
  }

  async function autoPresent(patientId) {
    const patient = (latestOperatorState?.queue || []).find((p)=>String(p.id)===String(patientId)) || (latestOperatorState?.currentCall?.id===patientId ? latestOperatorState.currentCall : null);
    const moduleId = patient?.moduleId || fixedModuleId || queryModuleId || currentUser.moduleId || '';
    const presentResult = await runOperatorAction(() => api(`/api/patients/${patientId}/present`, { method:'POST', body: JSON.stringify({ operatorUsername: fixedOperatorUsername || currentUser.username, operatorName: currentUser.fullName, updatedBy: fixedOperatorUsername || currentUser.username }) }));
    if (moduleId === 'optometria') {
      const updatedPatient = presentResult?.patient || patient || { id: patientId };
      openOptometrySpecialtyPicker(updatedPatient);
      showMessage('Paciente presente. Seleccione la especialidad para enviarlo a Consultorio.');
    } else if (moduleId === 'consultorio') {
      const updatedPatient = presentResult?.patient || patient || { id: patientId, moduleId };
      await openConsultorioDoctorPicker(updatedPatient);
      showMessage('Paciente presente. Asigne el médico o especialista para su atención.');
    } else {
      showMessage('Paciente marcado presente correctamente.');
      await refreshOperatorBoard();
    }
    return presentResult;
  }

  document.addEventListener('click', async (event) => {
    const sideCallButton = event.target.closest?.('.qn-consultorio-side-panel button[data-id]');
    if (!sideCallButton) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    try {
      await runOperatorAction(() => api(`/api/call/${sideCallButton.dataset.id}`, {
        method: 'POST',
        body: JSON.stringify({ operatorUsername: fixedOperatorUsername || currentUser.username, operatorName: currentUser.fullName })
      }));
      showMessage('Llamado ejecutado correctamente.');
      await refreshOperatorBoard();
    } catch (error) {
      showMessage(error.message, true);
    }
  }, true);

  document.addEventListener('click', async (event) => {
    const optometrySpecialtiesBtn = event.target.closest?.('button[data-qn-open-optometry-specialties]');
    if (!optometrySpecialtiesBtn) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const patient = (latestOperatorState?.queue || []).find((item) => String(item.id) === String(optometrySpecialtiesBtn.dataset.qnOpenOptometrySpecialties));
    if (!patient) {
      showMessage('No se encontró el paciente para referir a Consultorio.', true);
      return;
    }
    openOptometrySpecialtyPicker(patient);
  }, true);

  document.addEventListener('click', async (event) => {
    const doctorChoice = event.target.closest?.('button[data-qn-consultorio-doctor-choice]');
    if (!doctorChoice) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const overlay = document.getElementById('qnConsultorioDoctorPicker');
    const patientId = overlay?.dataset.patientId || '';
    const doctorName = doctorChoice.dataset.qnConsultorioDoctorChoice || '';
    if (!patientId || !doctorName) {
      showMessage('Seleccione un médico válido para asignar.', true);
      return;
    }
    doctorChoice.disabled = true;
    try {
      await runOperatorAction(() => api(`/api/patients/${patientId}/assign-doctor`, {
        method: 'POST',
        body: JSON.stringify({ doctorName })
      }));
      closeConsultorioDoctorPicker();
      showMessage(`Paciente asignado a ${doctorName}.`);
      await refreshOperatorBoard();
    } catch (error) {
      doctorChoice.disabled = false;
      showMessage(error.message, true);
    }
  }, true);

  document.addEventListener('click', async (event) => {
    const choice = event.target.closest?.('button[data-qn-specialty-choice]');
    if (!choice) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const overlay = document.getElementById('qnOptometrySpecialtyPicker');
    const patientId = overlay?.dataset.patientId || '';
    const specialty = choice.dataset.qnSpecialtyChoice || '';
    choice.disabled = true;
    try {
      await derivePresentOptometryPatient(patientId, specialty);
    } catch (error) {
      choice.disabled = false;
      showMessage(error.message, true);
    }
  }, true);

  document.addEventListener('click', async (event) => {
    const attentionBtn = event.target.closest?.('button[data-qn-doctor-attention-id]');
    if (!attentionBtn) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    try {
      await openDoctorAttention(attentionBtn.dataset.qnDoctorAttentionId);
    } catch (error) {
      showMessage(error.message, true);
    }
  }, true);

  document.addEventListener('click', async (event) => {
    const referralCallBtn = event.target.closest?.('button[data-qn-call-referral-id]');
    if (!referralCallBtn) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const patientId = referralCallBtn.dataset.qnCallReferralId;
    const patient = (latestOperatorState?.queue || []).find((item) => String(item.id) === String(patientId));
    if (patient && String(patient.status || '').toLowerCase() === 'attended') {
      showMessage('Este referido ya está presente en Optometría.', true);
      return;
    }
    try {
      await runOperatorAction(() => api(`/api/call/${patientId}`, {
        method: 'POST',
        body: JSON.stringify({ operatorUsername: fixedOperatorUsername || currentUser.username, operatorName: currentUser.fullName })
      }));
      showMessage('Referido llamado correctamente.');
      await refreshOperatorBoard();
    } catch (error) {
      showMessage(error.message, true);
    }
  }, true);

  document.addEventListener('click', async (event) => {
    const finalizeBtn = event.target.closest?.('button[data-qn-consultorio-finalize]');
    const dilateBtn = event.target.closest?.('button[data-qn-consultorio-dilate]');
    const procedureBtn = event.target.closest?.('button[data-qn-consultorio-procedure]');
    if (!finalizeBtn && !dilateBtn && !procedureBtn) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const overlay = document.getElementById('qnConsultorioActionPicker');
    const patientId = overlay?.dataset.patientId || '';
    if (!patientId) {
      showMessage('No se encontró paciente para completar la acción.', true);
      return;
    }
    try {
      if (finalizeBtn) {
        await runOperatorAction(() => api(`/api/patients/${patientId}/complete`, {
          method: 'POST',
          body: JSON.stringify({ completedBy: fixedOperatorUsername || currentUser.username })
        }));
        closeConsultorioActionPicker();
        showMessage('Atención finalizada correctamente.');
      } else if (dilateBtn) {
        await runOperatorAction(() => api(`/api/patients/${patientId}/dilate`, {
          method: 'POST',
          body: JSON.stringify({ notes: 'Paciente enviado a dilatación ocular', updatedBy: fixedOperatorUsername || currentUser.username })
        }));
        closeConsultorioActionPicker();
        showMessage('Paciente enviado a dilatación. Volverá con el mismo médico.');
      } else {
        const procedure = procedureBtn.dataset.qnConsultorioProcedure || 'PROCEDIMIENTOS';
        await runOperatorAction(() => api(`/api/patients/${patientId}/derive`, {
          method: 'POST',
          body: JSON.stringify({
            moduleId: 'optometria',
            area: procedure,
            doctorName: procedure,
            notes: `REFERENCIA DESDE CONSULTORIO A ${procedure}`,
            operatorUsername: fixedOperatorUsername || currentUser.username,
            operatorName: currentUser.fullName,
            derivedBy: fixedOperatorUsername || currentUser.username
          })
        }));
        closeConsultorioActionPicker();
        showMessage(`Paciente referido a Optometría - ${procedure}.`);
      }
      await refreshOperatorBoard();
    } catch (error) {
      showMessage(error.message, true);
    }
  }, true);

  document.addEventListener('click', async (event) => {
    const repeatPatientBtn = event.target.closest?.('button[data-qn-repeat-patient]');
    const presentBtn = event.target.closest?.('button[data-qn-auto-present]');
    const absentBtn = event.target.closest?.('button[data-qn-absent]');
    if (!repeatPatientBtn && !presentBtn && !absentBtn) return;
    event.preventDefault(); event.stopImmediatePropagation();
    try {
      if (repeatPatientBtn) {
        await runOperatorAction(() => api(`/api/repeat-patient/${repeatPatientBtn.dataset.qnRepeatPatient}`, {
          method: 'POST',
          body: JSON.stringify({ operatorUsername: fixedOperatorUsername || currentUser.username, operatorName: currentUser.fullName })
        }));
        showMessage('Llamado repetido para el paciente seleccionado.');
        await refreshOperatorBoard();
      }
      if (presentBtn) await autoPresent(presentBtn.dataset.qnAutoPresent);
      if (absentBtn) {
        await runOperatorAction(() => api(`/api/patients/${absentBtn.dataset.qnAbsent}/absent`, { method:'POST', body: JSON.stringify({ updatedBy: fixedOperatorUsername || currentUser.username }) }));
        showMessage('Paciente guardado como ausente. Puede volver a llamarse después.');
        await refreshOperatorBoard();
      }
    } catch (error) { showMessage(error.message, true); }
  }, true);

  document.addEventListener('drop', async (event)=>{
    const card = event.target.closest?.('.qn-doctor-card'); if (!card) return;
    event.preventDefault(); event.stopImmediatePropagation();
    card.classList.remove('drag-over');
    const patientId = event.dataTransfer.getData('text/plain'); const doctorName = card.dataset.qnDoctor; const targetModule = card.dataset.qnTargetModule || 'consultorio';
    if (!patientId || !doctorName) return;
    try {
      const currentModule = fixedModuleId || queryModuleId || currentUser.moduleId || '';
      if (currentModule === 'optometria' && targetModule === 'consultorio') {
        const p = (latestOperatorState?.queue || []).find((x)=>String(x.id)===String(patientId));
        if (p && String(p.status).toLowerCase() === 'called') {
          await api(`/api/patients/${patientId}/present`, { method:'POST', body: JSON.stringify({ operatorUsername: fixedOperatorUsername || currentUser.username, operatorName: currentUser.fullName }) });
        }
        await runOperatorAction(() => api(`/api/patients/${patientId}/derive`, { method:'POST', body: JSON.stringify({ moduleId:'consultorio', area:'Consultorio', doctorName, notes:'REFERIDO DESDE OPTOMETR?A POR ARRASTRE', operatorUsername: fixedOperatorUsername || currentUser.username, operatorName: currentUser.fullName, derivedBy: fixedOperatorUsername || currentUser.username }) }));
        showMessage(`Paciente referido a Consultorio - ${doctorName}.`);
      } else {
        await runOperatorAction(() => api(`/api/patients/${patientId}/assign-doctor`, { method:'POST', body: JSON.stringify({ doctorName }) }));
        const patient = (latestOperatorState?.queue || []).find((x)=>String(x.id)===String(patientId));
        if (!patient || ['waiting', 'absent', 'called'].includes(String(patient.status || '').toLowerCase())) {
          await runOperatorAction(() => api(`/api/call/${patientId}`, { method:'POST', body: JSON.stringify({ operatorUsername: fixedOperatorUsername || currentUser.username, operatorName: currentUser.fullName }) }));
          showMessage(`Paciente asignado y llamado para ${doctorName}.`);
        } else {
          showMessage(`Paciente asignado a ${doctorName}.`);
        }
      }
      await refreshOperatorBoard();
    } catch(error) { showMessage(error.message, true); }
  }, true);

  window.setTimeout(()=>{ loadDoctors('consultorio').then(()=>refreshOperatorBoard()).catch(()=>{}); }, 450);
})();

/* Optometria: registro con destino y paneles separados de registrados/referidos. */
(function qnOptometryStructuredFlow() {
  const optometryDestinations = [
    { name: 'NUEVO', detail: 'Referencia a Consultorio' },
    { name: 'CONTROLES', detail: 'Referencia a Consultorio' },
    { name: 'GLAUCOMA', detail: 'Referencia a especialista' },
    { name: 'RETINA', detail: 'Referencia a especialista' },
    { name: 'CÓRNEA', detail: 'Referencia a especialista' },
    { name: 'CATARATA', detail: 'Referencia a especialista' },
    { name: 'CIRUGÍA REFRACTIVA', detail: 'Referencia a especialista' }
  ];

  const activeStatuses = ['waiting', 'called', 'absent', 'attended'];
  const operationalStatuses = ['waiting', 'called', 'absent'];

  function qnOptometryModuleId() {
    return String(fixedModuleId || queryModuleId || currentUser?.moduleId || operatorModuleSelect?.value || '').toLowerCase();
  }

  function qnIsOptometrySession() {
    return qnOptometryModuleId() === 'optometria';
  }

  function qnPatientName(patient = {}) {
    return `${patient.firstName || ''} ${patient.lastName || ''}`.replace(/\s+/g, ' ').trim() || 'Paciente sin nombre';
  }

  function qnStatusLabel(patient = {}) {
    const status = String(patient.status || '').toLowerCase();
    if (status === 'called') return 'Llamando';
    if (status === 'absent') return 'Ausente';
    if (status === 'attended') return 'Presente';
    return 'En espera';
  }

  function qnDestination(patient = {}) {
    return String(patient.doctorName || patient.area || 'NUEVO').trim() || 'NUEVO';
  }

  function qnReferralOriginDoctor(patient = {}) {
    const direct = String(patient.referralOriginDoctorName || '').trim();
    const history = Array.isArray(patient.derivationHistory) ? patient.derivationHistory : [];
    const fromConsultorio = history.find((row) => String(row?.fromModuleId || '').toLowerCase() === 'consultorio');
    return direct || String(fromConsultorio?.fromDoctorName || fromConsultorio?.doctorName || '').trim();
  }

  function qnReferralOriginText(patient = {}) {
    const doctor = qnReferralOriginDoctor(patient);
    const area = String(patient.referralOriginArea || '').trim();
    if (doctor && area) return `Referido por ${doctor} · ${area}`;
    if (doctor) return `Referido por ${doctor}`;
    return 'Referido desde Consultorio';
  }

  function qnIsOptometryReferral(patient = {}) {
    return String(patient.moduleId || '').toLowerCase() === 'optometria'
      && (patient.isReferred === true
        || patient.referred === true
        || String(patient.referralOriginModuleId || '').toLowerCase() === 'consultorio'
        || String(patient.referralSourcePatientId || '').trim() !== '');
  }

  function qnQueueSort(a = {}, b = {}) {
    const dateA = Date.parse(a.referredAt || a.createdAt || a.calledAt || 0) || 0;
    const dateB = Date.parse(b.referredAt || b.createdAt || b.calledAt || 0) || 0;
    return dateA - dateB;
  }

  function qnOptometryList(state = {}, referred = false) {
    return (state.queue || [])
      .filter((patient) => String(patient.moduleId || '').toLowerCase() === 'optometria')
      .filter((patient) => activeStatuses.includes(String(patient.status || '').toLowerCase()))
      .filter((patient) => referred ? qnIsOptometryReferral(patient) : !qnIsOptometryReferral(patient))
      .sort(qnQueueSort);
  }

  function qnEnsureRegisterDestinationOverlay() {
    let overlay = document.getElementById('qnOptometryRegisterDestination');
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'qnOptometryRegisterDestination';
    overlay.className = 'qn-floating-specialty-overlay hidden qn-optometry-register-overlay';
    overlay.innerHTML = `
      <div class="qn-floating-specialty-card glass qn-optometry-register-card">
        <div class="section-head compact-modal-head">
          <div>
            <p class="section-kicker">Registro de Optometría</p>
            <h3>Seleccionar destino</h3>
            <p class="muted" id="qnOptometryRegisterPatientLabel">Elija el destino del paciente.</p>
          </div>
          <button type="button" class="ghost-btn small-btn" data-qn-close-register-destination>Cancelar</button>
        </div>
        <div class="qn-floating-specialty-grid qn-optometry-register-grid">
          ${optometryDestinations.map((item, index) => `
            <button type="button" class="qn-floating-specialty-option" data-qn-register-destination="${escapeHtml(item.name)}">
              <span>Destino ${index + 1}</span>
              <strong>${escapeHtml(item.name)}</strong>
              <small>${escapeHtml(item.detail)}</small>
            </button>
          `).join('')}
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay || event.target.closest('[data-qn-close-register-destination]')) {
        overlay.classList.add('hidden');
        overlay.dataset.pendingPayload = '';
      }
    });
    return overlay;
  }

  function qnEnsureOptometryCounterReferralOverlay() {
    let overlay = document.getElementById('qnOptometryCounterReferral');
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'qnOptometryCounterReferral';
    overlay.className = 'qn-floating-specialty-overlay hidden qn-optometry-counter-overlay';
    overlay.innerHTML = `
      <div class="qn-floating-specialty-card glass qn-optometry-counter-card">
        <div class="section-head compact-modal-head">
          <div>
            <p class="section-kicker">Atención en Optometría</p>
            <h3>Finalizar o contrarreferir</h3>
            <p class="muted" id="qnOptometryCounterPatientLabel">Seleccione la acción para el paciente.</p>
          </div>
          <button type="button" class="ghost-btn small-btn" data-qn-close-counter-referral>Cancelar</button>
        </div>
        <div id="qnOptometryCounterOptions" class="qn-floating-specialty-grid qn-optometry-counter-grid"></div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay || event.target.closest('[data-qn-close-counter-referral]')) {
        qnCloseOptometryCounterReferral();
      }
    });
    return overlay;
  }

  function qnCloseOptometryCounterReferral() {
    const overlay = document.getElementById('qnOptometryCounterReferral');
    if (!overlay) return;
    overlay.classList.add('hidden');
    overlay.dataset.patientId = '';
  }

  async function qnFetchConsultorioDoctors() {
    try {
      const response = await api('/api/doctors?moduleId=consultorio', { timeoutMs: 3500 });
      const rows = (response.doctors || [])
        .filter((doctor) => doctor.enabled !== false)
        .sort((a, b) => (a.order || 999) - (b.order || 999));
      return rows;
    } catch {}
    return [];
  }

  async function qnOpenOptometryCounterReferral(patient) {
    const overlay = qnEnsureOptometryCounterReferralOverlay();
    const label = overlay.querySelector('#qnOptometryCounterPatientLabel');
    const options = overlay.querySelector('#qnOptometryCounterOptions');
    overlay.dataset.patientId = patient?.id || '';
    const originDoctor = qnReferralOriginDoctor(patient);
    if (label) {
      label.textContent = `${qnPatientName(patient)} - ${patient?.code || ''}. ${qnReferralOriginText(patient)}. Puede cerrar la atención en Optometría o enviar contrarreferencia a Consultorio.`;
    }
    const activeDoctors = await qnFetchConsultorioDoctors();
    const originKey = normalizeClinicalText(originDoctor);
    const doctors = activeDoctors
      .filter((doctor) => originKey && normalizeClinicalText(doctor.name) === originKey);
    if (!doctors.length) {
      const history = Array.isArray(patient?.derivationHistory) ? patient.derivationHistory : [];
      const historyMatch = history
        .filter((row) => String(row?.fromModuleId || '').toLowerCase() === 'consultorio')
        .map((row) => String(row?.fromDoctorName || row?.doctorName || '').trim())
        .map((name) => activeDoctors.find((doctor) => normalizeClinicalText(doctor.name) === normalizeClinicalText(name)))
        .find(Boolean);
      if (historyMatch) doctors.push(historyMatch);
    }
    options.innerHTML = `
      <button type="button" class="qn-floating-specialty-option qn-finalize-option" data-qn-optometry-finalize>
        <span>Acción 1</span>
        <strong>Finalizar atención</strong>
        <small>Guardar cierre en Optometría</small>
      </button>
      ${doctors.map((doctor, index) => `
        <button type="button" class="qn-floating-specialty-option" data-qn-optometry-counter-doctor="${escapeHtml(doctor.name)}">
          <span>Médico ${index + 1}</span>
          <strong>${escapeHtml(doctor.name)}</strong>
          <small>${escapeHtml(doctor.specialty || 'Contrarreferencia a Consultorio')}</small>
        </button>
      `).join('') || `<div class="empty-state small qn-counter-empty">${originDoctor ? `El médico ${escapeHtml(originDoctor)} no está activo en Admin. Active ese médico para contrarreferir.` : 'No se encontró el médico de origen. Finalice la atención en Optometría o revise la referencia original.'}</div>`}
    `;
    overlay.classList.remove('hidden');
  }

  function qnOpenRegisterDestination(payload) {
    const overlay = qnEnsureRegisterDestinationOverlay();
    const label = overlay.querySelector('#qnOptometryRegisterPatientLabel');
    const name = `${payload.firstName || ''} ${payload.lastName || ''}`.replace(/\s+/g, ' ').trim();
    if (label) label.textContent = `${name || 'Paciente'} - DNI ${payload.dni || ''}. Elija el destino inicial para la cola de Optometría.`;
    overlay.dataset.pendingPayload = JSON.stringify(payload);
    overlay.classList.remove('hidden');
  }

  async function qnRegisterOptometryPatient(payload, destination) {
    const cleanPayload = {
      ...payload,
      moduleId: 'optometria',
      area: 'Optometría',
      doctorName: destination,
      immediateReferralModuleId: '',
      immediateReferralDoctorName: '',
      registeredBy: fixedOperatorUsername || currentUser.username
    };
    await runOperatorAction(() => api('/api/patients', {
      method: 'POST',
      body: JSON.stringify(cleanPayload)
    }));
    operatorPatientForm?.reset();
    fillModuleOptions?.();
    showMessage(`Paciente registrado en Optometría - ${destination}.`);
    await refreshOperatorBoard();
  }

  function qnOptometryActionRow(patient = {}, referred = false) {
    const id = escapeHtml(patient.id || '');
    const code = escapeHtml(patient.code || 'OPT');
    const status = String(patient.status || '').toLowerCase();
    const destination = escapeHtml(qnDestination(patient));
    const originText = referred ? qnReferralOriginText(patient) : '';
    const attendedReferralActions = referred && status === 'attended'
      ? `<div class="qn-optometry-card-actions qn-optometry-attention-actions">
          <button type="button" class="success-btn small-btn" data-qn-optometry-close-attention="${id}">Finalizar atención</button>
          <button type="button" class="primary-btn small-btn" data-qn-optometry-counter-referral="${id}">Contrarreferir a Consultorio</button>
        </div>`
      : '';
    const normalActions = attendedReferralActions ? '' : `
        <div class="qn-optometry-card-actions">
          <button type="button" class="primary-btn small-btn" data-qn-optometry-call="${id}">Llamar paciente</button>
          <button type="button" class="primary-btn small-btn" data-qn-optometry-repeat="${id}">Repetir llamada</button>
          <button type="button" class="success-btn small-btn" data-qn-optometry-present="${id}">Paciente presente</button>
          <button type="button" class="ghost-btn small-btn" data-qn-optometry-absent="${id}">Paciente ausente</button>
        </div>`;
    return `
      <article class="qn-optometry-patient-card ${referred ? 'is-referred' : 'is-registered'} ${escapeHtml(status)}">
        <div class="qn-optometry-card-line">
          <span class="mini-code">${code}</span>
          <span class="qn-optometry-name">${escapeHtml(qnPatientName(patient))}</span>
          <span class="qn-optometry-destination">${destination}</span>
        </div>
        ${originText ? `<div class="qn-optometry-origin-line">${escapeHtml(originText)}</div>` : ''}
        <div class="qn-optometry-status-line">
          <span>${escapeHtml(qnStatusLabel(patient))}</span>
          ${patient.dni ? `<small>DNI ${escapeHtml(patient.dni)}</small>` : ''}
        </div>
        ${normalActions}
        ${attendedReferralActions}
      </article>
    `;
  }

  function qnOptometryPanel(title, subtitle, patients, referred = false) {
    return `
      <article class="operator-module-card glass qn-clean-module qn-optometry-panel ${referred ? 'qn-optometry-referral-panel' : 'qn-optometry-registered-panel'}">
        <div class="operator-module-head qn-min-head qn-optometry-panel-head">
          <div>
            <p class="section-kicker compact">Optometría</p>
            <h3>${escapeHtml(title)}</h3>
            <p class="muted qn-module-room">${escapeHtml(subtitle)}</p>
          </div>
          <span class="module-count">${patients.length}</span>
        </div>
        <div class="operator-queue-box qn-optometry-list-box">
          <div class="operator-queue-list qn-optometry-action-list">
            ${patients.length ? patients.map((patient) => qnOptometryActionRow(patient, referred)).join('') : '<div class="empty-state small">Sin pacientes pendientes en esta sección.</div>'}
          </div>
        </div>
      </article>
    `;
  }

  function qnRenderOptometryPanels(state = {}) {
    latestOperatorState = state;
    document.body.classList.add('qn-optometria-mode');
    document.body.classList.remove('qn-consultorio-mode');
    renderSummary?.(state);
    ensureFamilyCallButton?.();
    updateFamilyCallButton?.();
    renderInternalAnnouncements?.(state.internalAnnouncements || []);
    const centerHead = document.querySelector('.qn-patient-list-panel > .section-head');
    if (centerHead) {
      centerHead.innerHTML = `
        <div>
          <p class="section-kicker">Optometría</p>
          <h1>Pacientes registrados en Optometría</h1>
        </div>
      `;
    }
    const registered = qnOptometryList(state, false).filter((patient) => operationalStatuses.includes(String(patient.status || '').toLowerCase()));
    const referred = qnOptometryList(state, true).filter((patient) => [...operationalStatuses, 'attended'].includes(String(patient.status || '').toLowerCase()));
    operatorModulesBoard.innerHTML = qnOptometryPanel(
      'Pacientes registrados en Optometría',
      'Pacientes creados en registro y ordenados por llegada.',
      registered,
      false
    );
    const sideHead = document.querySelector('.qn-doctors-sidebar .section-head');
    if (sideHead) {
      sideHead.innerHTML = `
        <div>
          <p class="section-kicker">Optometría</p>
          <h2>Pacientes referidos</h2>
          <p class="muted">Referencias enviadas desde Consultorio. Cada tarjeta muestra el médico que realizó la atención y desde aquí se llama, finaliza o contrarrefiere.</p>
        </div>
      `;
    }
    const sidePanel = document.getElementById('operatorDoctorsPanel');
    if (sidePanel) {
      sidePanel.className = 'qn-optometry-side-board';
      sidePanel.innerHTML = qnOptometryPanel(
        'Referidos',
        'Procedimientos, protocolos, imágenes, lentes y pruebas enviados por Consultorio.',
        referred,
        true
      );
    }
  }

  const previousRenderOperatorModules = renderOperatorModules;
  renderOperatorModules = function qnOptometryRenderOperatorModules(state = {}) {
    if (qnIsOptometrySession()) return qnRenderOptometryPanels(state);
    document.body.classList.remove('qn-optometria-mode');
    return previousRenderOperatorModules(state);
  };

  operatorPatientForm?.addEventListener('submit', (event) => {
    if (!qnIsOptometrySession()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!canRegisterPatientsInThisSession) {
      showMessage('Registro habilitado en este módulo.', false);
      return;
    }
    const payload = normalizeTextPayload(Object.fromEntries(new FormData(operatorPatientForm).entries()));
    const cleanDni = String(payload.dni || '').replace(/\D/g, '').slice(0, 8);
    if (cleanDni.length !== 8) {
      showMessage('Ingrese un DNI válido de 8 dígitos.', true);
      return;
    }
    if (!String(payload.firstName || '').trim() || !String(payload.lastName || '').trim()) {
      showMessage('Ingrese nombre y apellido del paciente.', true);
      return;
    }
    payload.dni = cleanDni;
    qnOpenRegisterDestination(payload);
  }, true);

  document.addEventListener('click', async (event) => {
    const registerDestination = event.target.closest?.('button[data-qn-register-destination]');
    const callBtn = event.target.closest?.('button[data-qn-optometry-call]');
    const repeatBtn = event.target.closest?.('button[data-qn-optometry-repeat]');
    const presentBtn = event.target.closest?.('button[data-qn-optometry-present]');
    const absentBtn = event.target.closest?.('button[data-qn-optometry-absent]');
    const closeAttentionBtn = event.target.closest?.('button[data-qn-optometry-close-attention]');
    const counterReferralBtn = event.target.closest?.('button[data-qn-optometry-counter-referral]');
    const finalizeChoice = event.target.closest?.('button[data-qn-optometry-finalize]');
    const counterDoctorChoice = event.target.closest?.('button[data-qn-optometry-counter-doctor]');
    if (!registerDestination && !callBtn && !repeatBtn && !presentBtn && !absentBtn && !closeAttentionBtn && !counterReferralBtn && !finalizeChoice && !counterDoctorChoice) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    try {
      if (registerDestination) {
        const overlay = document.getElementById('qnOptometryRegisterDestination');
        const payload = JSON.parse(overlay?.dataset.pendingPayload || '{}');
        const destination = registerDestination.dataset.qnRegisterDestination || 'NUEVO';
        registerDestination.disabled = true;
        await qnRegisterOptometryPatient(payload, destination);
        overlay?.classList.add('hidden');
        overlay.dataset.pendingPayload = '';
        registerDestination.disabled = false;
        return;
      }
      const patientId = callBtn?.dataset.qnOptometryCall
        || repeatBtn?.dataset.qnOptometryRepeat
        || presentBtn?.dataset.qnOptometryPresent
        || absentBtn?.dataset.qnOptometryAbsent
        || closeAttentionBtn?.dataset.qnOptometryCloseAttention
        || counterReferralBtn?.dataset.qnOptometryCounterReferral
        || document.getElementById('qnOptometryCounterReferral')?.dataset.patientId;
      const patient = (latestOperatorState?.queue || []).find((item) => String(item.id) === String(patientId));
      if (!patient) throw new Error('No se encontró el paciente seleccionado.');
      if (closeAttentionBtn || finalizeChoice) {
        await runOperatorAction(() => api(`/api/patients/${patientId}/complete`, {
          method: 'POST',
          body: JSON.stringify({ completedBy: fixedOperatorUsername || currentUser.username })
        }));
        qnCloseOptometryCounterReferral();
        showMessage('Atención finalizada en Optometría.');
        await refreshOperatorBoard();
        return;
      }
      if (counterReferralBtn) {
        await qnOpenOptometryCounterReferral(patient);
        showMessage('Seleccione el médico de Consultorio para la contrarreferencia.');
        return;
      }
      if (counterDoctorChoice) {
        const doctorName = counterDoctorChoice.dataset.qnOptometryCounterDoctor || '';
        if (!doctorName) throw new Error('Seleccione un médico válido para la contrarreferencia.');
        await runOperatorAction(() => api(`/api/patients/${patientId}/derive`, {
          method: 'POST',
          body: JSON.stringify({
            moduleId: 'consultorio',
            area: 'Consultorio',
            doctorName,
            notes: `CONTRARREFERENCIA DESDE OPTOMETRÍA. Origen: ${qnReferralOriginText(patient)}.`,
            operatorUsername: fixedOperatorUsername || currentUser.username,
            operatorName: currentUser.fullName,
            derivedBy: fixedOperatorUsername || currentUser.username
          })
        }));
        qnCloseOptometryCounterReferral();
        showMessage(`Paciente contrarreferido a Consultorio - ${doctorName}.`);
        await refreshOperatorBoard();
        return;
      }
      if (callBtn) {
        await runOperatorAction(() => api(`/api/call/${patientId}`, {
          method: 'POST',
          body: JSON.stringify({ operatorUsername: fixedOperatorUsername || currentUser.username, operatorName: currentUser.fullName })
        }));
        showMessage('Llamado ejecutado correctamente.');
        await refreshOperatorBoard();
        return;
      }
      if (repeatBtn) {
        const endpoint = String(patient.status || '').toLowerCase() === 'called' ? `/api/repeat-patient/${patientId}` : `/api/call/${patientId}`;
        await runOperatorAction(() => api(endpoint, {
          method: 'POST',
          body: JSON.stringify({ operatorUsername: fixedOperatorUsername || currentUser.username, operatorName: currentUser.fullName })
        }));
        showMessage('Llamado repetido correctamente.');
        await refreshOperatorBoard();
        return;
      }
      if (presentBtn) {
        const presentResult = await runOperatorAction(() => api(`/api/patients/${patientId}/present`, {
          method: 'POST',
          body: JSON.stringify({ operatorUsername: fixedOperatorUsername || currentUser.username, operatorName: currentUser.fullName, updatedBy: fixedOperatorUsername || currentUser.username })
        }));
        const updatedPatient = presentResult?.patient || patient;
        if (qnIsOptometryReferral(updatedPatient)) {
          showMessage('Paciente referido marcado presente en Optometría.');
          await refreshOperatorBoard();
          return;
        }
        const destination = qnDestination(updatedPatient);
        await runOperatorAction(() => api(`/api/patients/${patientId}/derive`, {
          method: 'POST',
          body: JSON.stringify({
            moduleId: 'consultorio',
            area: 'Consultorio',
            doctorName: destination,
            notes: `REFERIDO DESDE OPTOMETRÍA A ${destination}`,
            operatorUsername: fixedOperatorUsername || currentUser.username,
            operatorName: currentUser.fullName,
            derivedBy: fixedOperatorUsername || currentUser.username
          })
        }));
        showMessage(`Paciente enviado a Consultorio - ${destination}.`);
        await refreshOperatorBoard();
        return;
      }
      if (absentBtn) {
        await runOperatorAction(() => api(`/api/patients/${patientId}/absent`, {
          method: 'POST',
          body: JSON.stringify({ updatedBy: fixedOperatorUsername || currentUser.username })
        }));
        showMessage('Paciente guardado como ausente. Puede volver a llamarse después.');
        await refreshOperatorBoard();
      }
    } catch (error) {
      showMessage(error.message, true);
    }
  }, true);
})();
