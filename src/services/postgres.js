const fs = require('fs');
const path = require('path');
let pg = null;
try { pg = require('pg'); } catch { pg = null; }

function readJson(file, fallback = {}) {
  try {
    if (!file || !fs.existsSync(file)) return { ...fallback };
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : { ...fallback };
  } catch (error) {
    return { ...fallback, enabled: false, _readError: error.message };
  }
}

function clean(value, fallback = '') { return String(value ?? fallback).trim(); }
function asDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
function toIso(value) {
  const d = asDate(value);
  return d ? d.toISOString() : null;
}
function statusToSql(status = '') {
  return ({ waiting: 'waiting', called: 'called', attended: 'attended', dilating: 'dilating', completed: 'completed', cancelled: 'cancelled', referred_out: 'referred_out', absent: 'absent' })[String(status).toLowerCase()] || 'waiting';
}
function statusFromSql(status = '') {
  return ({ en_espera: 'waiting', llamado: 'called', atendido: 'attended', dilatando: 'dilating', finalizado: 'completed', cancelado: 'cancelled' })[String(status).toLowerCase()] || String(status || 'waiting').toLowerCase();
}
function normalizeConfig(raw = {}) {
  const env = process.env || {};
  const connectionString = clean(env.DATABASE_URL || raw.connectionString || raw.databaseUrl || '');
  const sslEnabled = String(env.PGSSL ?? raw.ssl ?? '').toLowerCase() === 'true';
  return {
    enabled: raw.enabled === true || Boolean(connectionString) || Boolean(env.PGHOST),
    connectionString,
    host: clean(env.PGHOST || raw.host || raw.server || 'localhost'),
    port: Number(env.PGPORT || raw.port || 5432),
    database: clean(env.PGDATABASE || raw.database || 'turnero_qhali_nawi'),
    user: clean(env.PGUSER || raw.user || raw.username || 'postgres'),
    password: String(env.PGPASSWORD || raw.password || ''),
    ssl: sslEnabled ? { rejectUnauthorized: false } : false,
    createSchemaIfMissing: raw.createSchemaIfMissing !== false,
    createDatabaseIfMissing: connectionString ? false : raw.createDatabaseIfMissing === true,
    max: Number(raw.pool?.max || raw.max || 15),
    idleTimeoutMillis: Number(raw.pool?.idleTimeoutMillis || 30000),
    connectionTimeoutMillis: Number(raw.connectionTimeoutMillis || 8000)
  };
}
function buildPoolOptions(cfg) {
  if (cfg.connectionString) {
    return {
      connectionString: cfg.connectionString,
      ssl: cfg.ssl,
      max: cfg.max,
      idleTimeoutMillis: cfg.idleTimeoutMillis,
      connectionTimeoutMillis: cfg.connectionTimeoutMillis
    };
  }
  return { ...cfg };
}
function patientFromSql(row = {}) {
  return {
    id: clean(row.id),
    code: clean(row.codigo_ticket),
    dni: clean(row.dni),
    firstName: clean(row.nombres),
    lastName: clean(row.apellidos),
    moduleId: clean(row.id_modulo),
    area: clean(row.area_destino),
    doctorName: clean(row.nombre_medico),
    notes: clean(row.observaciones),
    status: statusFromSql(row.estado),
    createdAt: toIso(row.fecha_registro),
    calledAt: toIso(row.fecha_llamado),
    arrivedAt: toIso(row.fecha_atencion),
    completedAt: toIso(row.fecha_cierre),
    registeredBy: clean(row.registrado_por, 'sistema'),
    lastUpdatedBy: clean(row.actualizado_por, 'sistema'),
    isReferred: row.es_referido === true,
    referred: row.es_referido === true,
    referralSourcePatientId: row.id_paciente_origen || null,
    referralOriginModuleId: row.modulo_origen_referencia || null,
    referralOriginArea: row.area_origen_referencia || null,
    referralOriginDoctorName: row.medico_origen_referencia || '',
    referralOriginCode: row.codigo_origen_referencia || '',
    referredBy: row.referido_por || null,
    referredAt: toIso(row.fecha_referencia),
    referralNote: clean(row.observacion_referencia)
  };
}

function createPostgresService(configFile) {
  let cfg = normalizeConfig(readJson(configFile, { enabled: false }));
  let pool = null;
  let schemaReady = false;
  let databaseReady = false;
  let lastError = null;
  const root = path.resolve(path.dirname(configFile || ''), '..');
  const schemaFile = path.join(root, 'database', 'POSTGRESQL_SCHEMA.sql');

  function reloadConfig() {
    const next = normalizeConfig(readJson(configFile, { enabled: false }));
    const changed = JSON.stringify({ ...cfg, password: cfg.password ? '***' : '' }) !== JSON.stringify({ ...next, password: next.password ? '***' : '' });
    cfg = next;
    if (changed) {
      if (pool) pool.end().catch(() => null);
      pool = null;
      schemaReady = false;
      databaseReady = false;
    }
    return cfg;
  }
  function getConfig() { return { ...cfg, password: cfg.password ? '********' : '' }; }
  function disabled(reason = 'PostgreSQL desactivado o no configurado') { return { ok: false, persisted: false, reason }; }

  async function ensureDatabaseExists() {
    if (databaseReady || cfg.createDatabaseIfMissing !== true) return;
    const adminPool = new pg.Pool({ ...buildPoolOptions(cfg), database: 'postgres', max: 1 });
    try {
      const exists = await adminPool.query('SELECT 1 FROM pg_database WHERE datname = $1 LIMIT 1;', [cfg.database]);
      if (!exists.rowCount) {
        const safeName = cfg.database.replace(/"/g, '""');
        await adminPool.query(`CREATE DATABASE "${safeName}" ENCODING 'UTF8';`);
      }
      databaseReady = true;
    } finally {
      await adminPool.end().catch(() => null);
    }
  }

  async function getPool() {
    if (!cfg.enabled) throw new Error('PostgreSQL desactivado en config/postgresql.json');
    if (!pg) throw new Error('Dependencia pg no disponible. Ejecute npm install.');
    if (!pool) {
      await ensureDatabaseExists();
      pool = new pg.Pool(buildPoolOptions(cfg));
      pool.on('error', (error) => { lastError = error; });
    }
    return pool;
  }

  async function ensureSchema(client) {
    if (schemaReady || cfg.createSchemaIfMissing === false) return;
    if (fs.existsSync(schemaFile)) {
      await client.query(fs.readFileSync(schemaFile, 'utf8'));
    }
    await client.query(`
CREATE OR REPLACE VIEW vw_kpi_turnero_diario AS
SELECT
  CURRENT_DATE AS fecha_kpi,
  (SELECT COUNT(DISTINCT COALESCE(NULLIF(dni,''), id)) FROM pacientes WHERE fecha_registro::date = CURRENT_DATE) AS pacientes_hoy,
  (SELECT COUNT(*) FROM eventos_llamado WHERE fecha_llamado::date = CURRENT_DATE) AS llamados_hoy,
  (SELECT COUNT(*) FROM auditoria_llamados WHERE fecha_llamado::date = CURRENT_DATE) AS auditoria_hoy,
  (SELECT COUNT(*) FROM auditoria_llamados WHERE fecha_llamado::date = CURRENT_DATE AND fecha_atencion IS NOT NULL) AS atendidos_hoy,
  (SELECT COALESCE(ROUND(AVG(minutos_espera))::integer, 0) FROM auditoria_llamados WHERE fecha_llamado::date = CURRENT_DATE) AS promedio_minutos_espera,
  (SELECT COALESCE(ROUND(AVG(NULLIF(minutos_atencion,0)))::integer, 0) FROM auditoria_llamados WHERE fecha_llamado::date = CURRENT_DATE) AS promedio_minutos_atencion,
  (SELECT COALESCE(SUM(cantidad_rellamadas), 0) FROM auditoria_llamados WHERE fecha_llamado::date = CURRENT_DATE) AS total_rellamadas;`);
    schemaReady = true;
  }

  async function run(fn, fallback) {
    if (!cfg.enabled) return disabled();
    try {
      const client = await getPool();
      await ensureSchema(client);
      return await fn(client);
    } catch (error) {
      lastError = error;
      return { ok: false, persisted: false, reason: error.message, ...(fallback || {}) };
    }
  }

  async function upsertPatient(patient = {}) {
    return run(async (client) => {
      const values = [
        clean(patient.id), clean(patient.code), clean(patient.dni), clean(patient.firstName), clean(patient.lastName),
        clean(patient.moduleId), clean(patient.area), clean(patient.doctorName, 'MÉDICO ASIGNADO'), clean(patient.notes),
        statusToSql(patient.status), asDate(patient.createdAt) || new Date(), asDate(patient.calledAt), asDate(patient.arrivedAt), asDate(patient.completedAt),
        clean(patient.registeredBy, 'sistema'), clean(patient.lastUpdatedBy, 'sistema'), patient.isReferred === true || patient.referred === true,
        patient.referralSourcePatientId || null, patient.referralOriginModuleId || null, clean(patient.referralOriginArea), clean(patient.referralOriginDoctorName),
        clean(patient.referralOriginCode), patient.referredBy || null, asDate(patient.referredAt), clean(patient.referralNote)
      ];
      await client.query(`
INSERT INTO pacientes(id,codigo_ticket,dni,nombres,apellidos,id_modulo,area_destino,nombre_medico,observaciones,estado,fecha_registro,fecha_llamado,fecha_atencion,fecha_cierre,registrado_por,actualizado_por,es_referido,id_paciente_origen,modulo_origen_referencia,area_origen_referencia,medico_origen_referencia,codigo_origen_referencia,referido_por,fecha_referencia,observacion_referencia)
VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
ON CONFLICT (id) DO UPDATE SET
codigo_ticket=EXCLUDED.codigo_ticket,dni=EXCLUDED.dni,nombres=EXCLUDED.nombres,apellidos=EXCLUDED.apellidos,id_modulo=EXCLUDED.id_modulo,area_destino=EXCLUDED.area_destino,nombre_medico=EXCLUDED.nombre_medico,observaciones=EXCLUDED.observaciones,estado=EXCLUDED.estado,fecha_llamado=EXCLUDED.fecha_llamado,fecha_atencion=EXCLUDED.fecha_atencion,fecha_cierre=EXCLUDED.fecha_cierre,actualizado_por=EXCLUDED.actualizado_por,es_referido=EXCLUDED.es_referido,id_paciente_origen=EXCLUDED.id_paciente_origen,modulo_origen_referencia=EXCLUDED.modulo_origen_referencia,area_origen_referencia=EXCLUDED.area_origen_referencia,medico_origen_referencia=EXCLUDED.medico_origen_referencia,codigo_origen_referencia=EXCLUDED.codigo_origen_referencia,referido_por=EXCLUDED.referido_por,fecha_referencia=EXCLUDED.fecha_referencia,observacion_referencia=EXCLUDED.observacion_referencia;`, values);
      return { ok: true, persisted: true, patient };
    }, { patient });
  }

  async function findPatientByDniToday(dni) {
    return run(async (client) => {
      const result = await client.query(`SELECT * FROM pacientes WHERE dni=$1 AND fecha_registro::date=CURRENT_DATE AND estado NOT IN ('cancelled','cancelado') ORDER BY es_referido ASC, fecha_registro ASC LIMIT 1;`, [clean(dni)]);
      return { ok: true, patient: result.rows[0] ? patientFromSql(result.rows[0]) : null };
    }, { patient: null });
  }

  async function searchPatients(term = '') {
    return run(async (client) => {
      const q = `%${clean(term).replace(/[%_]/g, '')}%`;
      const result = await client.query(`SELECT * FROM pacientes WHERE fecha_registro::date=CURRENT_DATE AND (dni ILIKE $1 OR nombres ILIKE $1 OR apellidos ILIKE $1 OR codigo_ticket ILIKE $1) ORDER BY fecha_registro DESC LIMIT 80;`, [q]);
      return { ok: true, patients: result.rows.map(patientFromSql) };
    }, { patients: [] });
  }

  async function persistCallEvent(event = {}) {
    return run(async (client) => {
      const mappedCallType = ({ repeat: 'repetir', repeated: 'repetir', derive: 'derivar', derivar: 'derivar', next: 'siguiente', siguiente: 'siguiente', normal: 'normal' })[clean(event.callType, 'normal').toLowerCase()] || 'normal';
      await client.query(`
INSERT INTO eventos_llamado(id,id_paciente,id_modulo,texto_llamado,fecha_llamado,llamado_por,nombre_operador,nombre_medico,tipo_llamado)
VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
ON CONFLICT (id) DO NOTHING;`, [
        clean(event.id), clean(event.patientId), clean(event.moduleId), clean(event.callText), asDate(event.calledAt) || new Date(),
        clean(event.calledBy), clean(event.operatorName), clean(event.doctorName), mappedCallType
      ]);
      return { ok: true, persisted: true };
    });
  }

  function auditValues(row = {}) {
    return [
      clean(row.callId), clean(row.patientId), clean(row.patientCode), clean(row.patientName), clean(row.moduleId), clean(row.moduleLabel, row.moduleId),
      clean(row.doctorName), row.operatorUsername || null, row.operatorName || null, asDate(row.registeredAt) || new Date(), asDate(row.calledAt) || new Date(),
      asDate(row.arrivedAt), asDate(row.completedAt), Number(row.waitMinutes || 0), Number(row.attentionMinutes || 0),
      row.nextCallGapMinutes == null ? null : Number(row.nextCallGapMinutes || 0), Number(row.repeatCount || 0), row.isRepeat === true || Number(row.repeatCount || 0) > 0
    ];
  }

  async function persistAudit(row = {}) {
    return run(async (client) => {
      await client.query(`
INSERT INTO auditoria_llamados(id_llamado,id_paciente,codigo_paciente,nombre_paciente,id_modulo,nombre_modulo,nombre_medico,usuario_operador,nombre_operador,fecha_registro,fecha_llamado,fecha_atencion,fecha_cierre,minutos_espera,minutos_atencion,minutos_entre_llamados,cantidad_rellamadas,es_rellamada)
VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
ON CONFLICT (id_llamado) DO NOTHING;`, auditValues(row));
      return { ok: true, persisted: true };
    });
  }

  async function updateAuditArrival(row = {}) {
    return run(async (client) => {
      await client.query(`UPDATE auditoria_llamados SET fecha_atencion=$2, minutos_atencion=$3 WHERE id_paciente=$1 AND fecha_cierre IS NULL;`, [clean(row.patientId), asDate(row.arrivedAt), Number(row.attentionMinutes || 0)]);
      return { ok: true, persisted: true };
    });
  }

  async function updateAuditCompletion(row = {}) {
    return run(async (client) => {
      await client.query(`UPDATE auditoria_llamados SET fecha_atencion=COALESCE(fecha_atencion,$2), fecha_cierre=$3, minutos_atencion=$4 WHERE id_paciente=$1 AND fecha_cierre IS NULL;`, [clean(row.patientId), asDate(row.arrivedAt), asDate(row.completedAt) || new Date(), Number(row.attentionMinutes || 0)]);
      return { ok: true, persisted: true };
    });
  }

  async function updateAuditRepeat(row = {}) {
    return run(async (client) => {
      await client.query(`UPDATE auditoria_llamados SET cantidad_rellamadas=$2, es_rellamada=TRUE WHERE id_paciente=$1 AND fecha_cierre IS NULL;`, [clean(row.patientId), Number(row.repeatCount || 1)]);
      return { ok: true, persisted: true };
    });
  }

  async function deletePatient(id) {
    return run(async (client) => {
      await client.query(`UPDATE pacientes SET estado='cancelled', fecha_cierre=COALESCE(fecha_cierre,NOW()) WHERE id=$1;`, [clean(id)]);
      return { ok: true, persisted: true };
    });
  }

  async function upsertSystemUser(user = {}) {
    return run(async (client) => {
      await client.query(`
INSERT INTO usuarios_sistema(usuario,clave_hash,nombre_completo,rol,id_modulo,nombre_medico,activo,fecha_actualizacion)
VALUES($1,$2,$3,$4,$5,$6,$7,NOW())
ON CONFLICT (usuario) DO UPDATE SET clave_hash=EXCLUDED.clave_hash,nombre_completo=EXCLUDED.nombre_completo,rol=EXCLUDED.rol,id_modulo=EXCLUDED.id_modulo,nombre_medico=EXCLUDED.nombre_medico,activo=EXCLUDED.activo,fecha_actualizacion=NOW();`, [
        clean(user.username).toLowerCase(), clean(user.passwordHash || user.password), clean(user.fullName, user.username),
        clean(user.role, 'OPERADOR').toUpperCase(), user.moduleId || null, clean(user.doctorName), user.isActive !== false
      ]);
      return { ok: true, persisted: true, user };
    }, { user });
  }

  async function syncUsers(users = []) {
    if (!Array.isArray(users)) return { ok: false, persisted: false, reason: 'Lista de usuarios inválida' };
    let count = 0; const errors = [];
    for (const user of users) {
      const r = await upsertSystemUser(user);
      if (r.ok) count += 1; else errors.push(r.reason);
    }
    return { ok: errors.length === 0, persisted: count > 0, count, errors };
  }

  async function persistInternalAnnouncement(row = {}) {
    return run(async (client) => {
      await client.query(`
INSERT INTO comunicados_internos(id,tipo,destinatario,mensaje,id_modulo_origen,nombre_modulo_origen,solicitado_por,texto_llamado,repeticiones,fecha_creacion)
VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
ON CONFLICT (id) DO NOTHING;`, [
        clean(row.id), clean(row.type, 'internal'), clean(row.targetName), clean(row.message), row.originModuleId || null,
        clean(row.originLabel), clean(row.requestedBy, 'sistema'), clean(row.announcementText), Math.max(1, Number(row.repeatCount || 1)), asDate(row.createdAt) || new Date()
      ]);
      return { ok: true, persisted: true };
    });
  }

  async function syncDoctors(rows = []) {
    if (!Array.isArray(rows)) return { ok: false, persisted: false, reason: 'Lista de médicos inválida' };
    return run(async (client) => {
      let count = 0;
      for (const row of rows) {
        await client.query(`
INSERT INTO medicos_disponibles(id_modulo,nombre_medico,especialidad,disponible,orden)
VALUES($1,$2,$3,$4,$5)
ON CONFLICT (id_modulo,nombre_medico) DO UPDATE SET
  especialidad=EXCLUDED.especialidad,
  disponible=EXCLUDED.disponible,
  orden=EXCLUDED.orden;`, [
          clean(row.moduleId || row.id_modulo || 'consultorio'),
          clean(row.name || row.nombre_medico || row.doctorName),
          clean(row.specialty || row.especialidad || 'CONSULTORIO'),
          row.enabled !== false && row.disponible !== false,
          Number(row.order || row.orden || count + 1) || (count + 1)
        ]);
        count += 1;
      }
      return { ok: true, persisted: true, count };
    }, { count: 0 });
  }

  async function syncFullState(snapshot = {}, users = []) {
    if (!cfg.enabled) return disabled();
    const summary = { patients: 0, calls: 0, audit: 0, users: 0, announcements: 0, errors: [] };
    const userResult = await syncUsers(users);
    if (userResult?.count) summary.users = userResult.count;
    if (Array.isArray(userResult?.errors)) summary.errors.push(...userResult.errors);
    for (const patient of (Array.isArray(snapshot.queue) ? snapshot.queue : [])) {
      const r = await upsertPatient(patient);
      if (r?.ok) summary.patients += 1; else summary.errors.push(r?.reason || 'Error sincronizando paciente');
    }
    for (const item of (Array.isArray(snapshot.callHistory) ? snapshot.callHistory : [])) {
      const r = await persistCallEvent({
        id: clean(item.eventId || `hist-${item.id || 'paciente'}-${item.calledAt || item.announcementAt || Date.now()}`).slice(0, 80),
        patientId: item.id,
        moduleId: item.moduleId,
        callText: item.announcementText || `Paciente ${item.firstName || ''} ${item.lastName || ''}`.trim(),
        calledAt: item.calledAt || item.announcementAt || item.createdAt,
        calledBy: item.operatorUsername || item.registeredBy || 'sistema',
        operatorName: item.operatorName || item.operatorUsername || 'sistema',
        doctorName: item.doctorName || '',
        callType: item.callType || (item.repeated ? 'repeat' : 'normal')
      });
      if (r?.ok) summary.calls += 1; else summary.errors.push(r?.reason || 'Error sincronizando llamado');
    }
    for (const row of (Array.isArray(snapshot.audit) ? snapshot.audit : [])) {
      const r = await persistAudit(row);
      if (r?.ok) summary.audit += 1; else summary.errors.push(r?.reason || 'Error sincronizando auditoría');
    }
    for (const row of (Array.isArray(snapshot.internalAnnouncements) ? snapshot.internalAnnouncements : [])) {
      const r = await persistInternalAnnouncement(row);
      if (r?.ok) summary.announcements += 1; else summary.errors.push(r?.reason || 'Error sincronizando comunicado interno');
    }
    return { ok: summary.errors.length === 0, persisted: true, ...summary };
  }

  async function diagnose() {
    reloadConfig();
    if (!cfg.enabled) return { ok: false, enabled: false, connected: false, status: 'disabled', message: 'PostgreSQL desactivado en config/postgresql.json' };
    if (!pg) return { ok: false, enabled: true, connected: false, status: 'missing_pg', message: 'Paquete pg no disponible.' };
    try {
      const client = await getPool();
      await ensureSchema(client);
      const ping = await client.query(`
SELECT
 (SELECT COUNT(DISTINCT COALESCE(NULLIF(dni,''), id)) FROM pacientes WHERE fecha_registro::date=CURRENT_DATE) AS "pacientesHoy",
 (SELECT COUNT(*) FROM eventos_llamado WHERE fecha_llamado::date=CURRENT_DATE) AS "llamadosHoy",
 (SELECT COUNT(*) FROM auditoria_llamados WHERE fecha_llamado::date=CURRENT_DATE) AS "auditoriaHoy",
 (SELECT COUNT(*) FROM pacientes) AS "totalPacientes",
 (SELECT COUNT(*) FROM eventos_llamado) AS "totalEventos",
 (SELECT COUNT(*) FROM auditoria_llamados) AS "totalAuditoria",
 (SELECT COUNT(*) FROM usuarios_sistema) AS "totalUsuarios",
 (SELECT COUNT(*) FROM modulos_atencion) AS "totalModulos",
 (SELECT COUNT(*) FROM medicos_disponibles) AS "totalMedicos",
 (SELECT COUNT(*) FROM comunicados_internos) AS "totalComunicados";`);
      lastError = null;
      return { ok: true, enabled: true, connected: true, status: 'connected', database: cfg.database, ...ping.rows[0] };
    } catch (error) {
      lastError = error;
      return { ok: false, enabled: true, connected: false, status: 'error', database: cfg.database, message: error.message };
    }
  }

  return {
    getConfig,
    diagnose,
    upsertPatient,
    findPatientByDniToday,
    searchPatients,
    persistCallEvent,
    persistAudit,
    updateAuditArrival,
    updateAuditCompletion,
    updateAuditRepeat,
    deletePatient,
    upsertSystemUser,
    syncUsers,
    persistInternalAnnouncement,
    syncDoctors,
    syncFullState,
    _getLastError: () => lastError
  };
}

module.exports = { createPostgresService };
