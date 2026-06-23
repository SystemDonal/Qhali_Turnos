const fs = require('fs');
const path = require('path');
let sql = null;
try { sql = require('mssql'); } catch { sql = null; }

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
function bool(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true','1','yes','si','sí'].includes(normalized)) return true;
    if (['false','0','no'].includes(normalized)) return false;
  }
  return fallback;
}
function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function normalizeServerAndInstance(raw = {}) {
  let server = clean(raw.server || raw.host || 'localhost');
  let instanceName = clean(raw.instanceName || raw.options?.instanceName || '');
  if (server.includes('\\')) {
    const parts = server.split('\\');
    server = clean(parts[0] || 'localhost');
    instanceName = clean(parts.slice(1).join('\\') || instanceName);
  }
  return { server, instanceName };
}
function asDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
function toIso(value) { const d = asDate(value); return d ? d.toISOString() : null; }
function statusToSql(status = '') {
  return ({ waiting: 'en_espera', called: 'llamado', attended: 'atendido', dilating: 'dilatando', completed: 'finalizado', cancelled: 'cancelado', referred_out: 'finalizado' })[String(status).toLowerCase()] || 'en_espera';
}
function statusFromSql(status = '') {
  return ({ en_espera: 'waiting', llamado: 'called', atendido: 'attended', dilatando: 'dilating', finalizado: 'completed', cancelado: 'cancelled' })[String(status).toLowerCase()] || 'waiting';
}
function normalizeConfig(raw = {}) {
  const serverInfo = normalizeServerAndInstance(raw);
  const port = numberOrNull(raw.port);
  const options = {
    encrypt: bool(raw.options?.encrypt, false),
    trustServerCertificate: bool(raw.options?.trustServerCertificate, true),
    enableArithAbort: true
  };
  if (serverInfo.instanceName) options.instanceName = serverInfo.instanceName;
  const cfg = {
    enabled: raw.enabled === true,
    server: serverInfo.server,
    database: clean(raw.database || 'TurneroQhaliNahui'),
    user: clean(raw.user || raw.username || 'sa'),
    password: String(process.env.SQLSERVER_PASSWORD || raw.password || ''),
    options,
    createDatabaseIfMissing: raw.createDatabaseIfMissing !== false,
    pool: { max: Number(raw.pool?.max || 25), min: 0, idleTimeoutMillis: 30000 },
    requestTimeout: Number(raw.requestTimeout || 20000),
    connectionTimeout: Number(raw.connectionTimeout || 20000)
  };
  if (!serverInfo.instanceName) cfg.port = port || 1433;
  return cfg;
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
    isReferred: row.es_referido === true || row.es_referido === 1,
    referred: row.es_referido === true || row.es_referido === 1,
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

function createSqlService(configFile) {
  let cfg = normalizeConfig(readJson(configFile, { enabled: false }));
  let poolPromise = null;
  let schemaReady = false;
  let databaseReady = false;
  let lastError = null;

  function reloadConfig() {
    const nextCfg = normalizeConfig(readJson(configFile, { enabled: false }));
    const changed = JSON.stringify({ ...cfg, password: cfg.password ? '***' : '' }) !== JSON.stringify({ ...nextCfg, password: nextCfg.password ? '***' : '' });
    cfg = nextCfg;
    if (changed) { poolPromise = null; schemaReady = false; databaseReady = false; }
    return cfg;
  }
  function getConfig() { return { ...cfg, password: cfg.password ? '********' : '' }; }
  function disabled(reason = 'SQL Server desactivado o no configurado') { return { ok: false, persisted: false, reason }; }
  async function ensureDatabaseExists() {
    if (databaseReady || cfg.createDatabaseIfMissing === false) return;
    const dbName = clean(cfg.database, 'TurneroQhaliNahui');
    const masterCfg = { ...cfg, database: 'master', pool: { max: 3, min: 0, idleTimeoutMillis: 10000 } };
    delete masterCfg.createDatabaseIfMissing;
    const masterPool = new sql.ConnectionPool(masterCfg);
    try {
      await masterPool.connect();
      const exists = await masterPool.request().input('db', sql.NVarChar(128), dbName).query('SELECT DB_ID(@db) AS id;');
      if (!exists.recordset?.[0]?.id) {
        const safeDbName = dbName.replace(/]/g, ']]');
        await masterPool.request().batch(`CREATE DATABASE [${safeDbName}];`);
      }
      databaseReady = true;
    } finally {
      await masterPool.close().catch(() => null);
    }
  }
  async function getPool() {
    if (!cfg.enabled) throw new Error('SQL Server desactivado en config/sqlserver.json');
    if (!sql) throw new Error('Dependencia mssql no disponible. Ejecute npm install.');
    if (!poolPromise) {
      poolPromise = (async () => {
        await ensureDatabaseExists();
        return new sql.ConnectionPool(cfg).connect();
      })().catch((error) => {
        poolPromise = null;
        lastError = error;
        throw error;
      });
    }
    return poolPromise;
  }
  async function run(fn, fallback) {
    if (!cfg.enabled) return disabled();
    try {
      const pool = await getPool();
      if (!schemaReady) await ensureSchema(pool);
      return await fn(pool);
    } catch (error) {
      lastError = error;
      return { ok: false, persisted: false, reason: error.message, ...(fallback || {}) };
    }
  }
  async function ensureSchema(pool) {
    await pool.request().batch(`
IF OBJECT_ID('dbo.modulos_atencion','U') IS NULL
BEGIN
CREATE TABLE dbo.modulos_atencion(
 id VARCHAR(40) NOT NULL CONSTRAINT PK_modulos_atencion PRIMARY KEY,
 nombre_modulo NVARCHAR(100) NOT NULL,
 prefijo_ticket VARCHAR(10) NOT NULL,
 ambiente NVARCHAR(120) NOT NULL,
 nombre_medico NVARCHAR(120) NOT NULL CONSTRAINT DF_modulos_nombre_medico DEFAULT N'Médico asignado',
 activo BIT NOT NULL CONSTRAINT DF_modulos_activo DEFAULT 1,
 fecha_creacion DATETIME2(0) NOT NULL CONSTRAINT DF_modulos_fecha_creacion DEFAULT SYSDATETIME(),
 fila_version ROWVERSION NOT NULL
);
END;
IF OBJECT_ID('dbo.usuarios_sistema','U') IS NULL
BEGIN
CREATE TABLE dbo.usuarios_sistema(
 id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_usuarios_sistema PRIMARY KEY,
 usuario NVARCHAR(60) NOT NULL CONSTRAINT UQ_usuarios_sistema_usuario UNIQUE,
 clave_hash NVARCHAR(255) NOT NULL,
 nombre_completo NVARCHAR(120) NOT NULL,
 rol NVARCHAR(40) NOT NULL,
 id_modulo VARCHAR(40) NULL,
 nombre_medico NVARCHAR(120) NOT NULL CONSTRAINT DF_usuarios_nombre_medico DEFAULT N'',
 activo BIT NOT NULL CONSTRAINT DF_usuarios_activo DEFAULT 1,
 ultimo_acceso DATETIME2(0) NULL,
 fecha_creacion DATETIME2(0) NOT NULL CONSTRAINT DF_usuarios_fecha_creacion DEFAULT SYSDATETIME(),
 fila_version ROWVERSION NOT NULL
);
END;
IF OBJECT_ID('dbo.pacientes','U') IS NULL
BEGIN
CREATE TABLE dbo.pacientes(
 id VARCHAR(40) NOT NULL CONSTRAINT PK_pacientes PRIMARY KEY,
 codigo_ticket VARCHAR(20) NOT NULL,
 dni VARCHAR(8) NOT NULL,
 nombres NVARCHAR(100) NOT NULL,
 apellidos NVARCHAR(100) NOT NULL,
 id_modulo VARCHAR(40) NOT NULL,
 area_destino NVARCHAR(120) NOT NULL,
 nombre_medico NVARCHAR(120) NOT NULL CONSTRAINT DF_pacientes_nombre_medico DEFAULT N'Médico asignado',
 observaciones NVARCHAR(400) NOT NULL CONSTRAINT DF_pacientes_observaciones DEFAULT N'',
 estado VARCHAR(20) NOT NULL CONSTRAINT DF_pacientes_estado DEFAULT 'en_espera',
 fecha_registro DATETIME2(0) NOT NULL CONSTRAINT DF_pacientes_fecha_registro DEFAULT SYSDATETIME(),
 fecha_dia AS CONVERT(date, fecha_registro) PERSISTED,
 fecha_llamado DATETIME2(0) NULL,
 fecha_atencion DATETIME2(0) NULL,
 fecha_cierre DATETIME2(0) NULL,
 registrado_por VARCHAR(60) NOT NULL CONSTRAINT DF_pacientes_registrado_por DEFAULT 'sistema',
 actualizado_por VARCHAR(60) NOT NULL CONSTRAINT DF_pacientes_actualizado_por DEFAULT 'sistema',
 es_referido BIT NOT NULL CONSTRAINT DF_pacientes_es_referido DEFAULT 0,
 id_paciente_origen VARCHAR(40) NULL,
 modulo_origen_referencia VARCHAR(40) NULL,
 area_origen_referencia NVARCHAR(120) NOT NULL CONSTRAINT DF_pacientes_area_origen_referencia DEFAULT N'',
 medico_origen_referencia NVARCHAR(120) NOT NULL CONSTRAINT DF_pacientes_medico_origen_referencia DEFAULT N'',
 codigo_origen_referencia VARCHAR(20) NOT NULL CONSTRAINT DF_pacientes_codigo_origen_referencia DEFAULT '',
 referido_por VARCHAR(60) NULL,
 fecha_referencia DATETIME2(0) NULL,
 observacion_referencia NVARCHAR(400) NOT NULL CONSTRAINT DF_pacientes_observacion_referencia DEFAULT N'',
 fila_version ROWVERSION NOT NULL
);
END;
IF OBJECT_ID('dbo.eventos_llamado','U') IS NULL
BEGIN
CREATE TABLE dbo.eventos_llamado(
 id VARCHAR(80) NOT NULL CONSTRAINT PK_eventos_llamado PRIMARY KEY,
 id_paciente VARCHAR(40) NOT NULL,
 id_modulo VARCHAR(40) NOT NULL,
 texto_llamado NVARCHAR(300) NOT NULL,
 fecha_llamado DATETIME2(0) NOT NULL CONSTRAINT DF_eventos_fecha_llamado DEFAULT SYSDATETIME(),
 llamado_por VARCHAR(60) NOT NULL CONSTRAINT DF_eventos_llamado_por DEFAULT '',
 nombre_operador NVARCHAR(120) NOT NULL CONSTRAINT DF_eventos_nombre_operador DEFAULT N'',
 nombre_medico NVARCHAR(120) NOT NULL CONSTRAINT DF_eventos_nombre_medico DEFAULT N'',
 tipo_llamado VARCHAR(20) NOT NULL CONSTRAINT DF_eventos_tipo_llamado DEFAULT 'normal',
 fila_version ROWVERSION NOT NULL
);
END;
IF OBJECT_ID('dbo.auditoria_llamados','U') IS NULL
BEGIN
CREATE TABLE dbo.auditoria_llamados(
 id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_auditoria_llamados PRIMARY KEY,
 id_llamado VARCHAR(80) NOT NULL,
 id_paciente VARCHAR(80) NOT NULL,
 codigo_paciente VARCHAR(40) NOT NULL,
 nombre_paciente NVARCHAR(200) NOT NULL,
 id_modulo VARCHAR(40) NOT NULL,
 nombre_modulo NVARCHAR(120) NOT NULL,
 nombre_medico NVARCHAR(200) NOT NULL CONSTRAINT DF_auditoria_nombre_medico DEFAULT N'',
 usuario_operador VARCHAR(120) NULL,
 nombre_operador NVARCHAR(200) NULL,
 fecha_registro DATETIME2(0) NOT NULL,
 fecha_llamado DATETIME2(0) NOT NULL,
 fecha_atencion DATETIME2(0) NULL,
 fecha_cierre DATETIME2(0) NULL,
 minutos_espera INT NOT NULL CONSTRAINT DF_auditoria_minutos_espera DEFAULT 0,
 minutos_atencion INT NOT NULL CONSTRAINT DF_auditoria_minutos_atencion DEFAULT 0,
 minutos_entre_llamados INT NULL,
 cantidad_rellamadas INT NOT NULL CONSTRAINT DF_auditoria_cantidad_rellamadas DEFAULT 0,
 es_rellamada BIT NOT NULL CONSTRAINT DF_auditoria_es_rellamada DEFAULT 0,
 fecha_creacion DATETIME2(0) NOT NULL CONSTRAINT DF_auditoria_fecha_creacion DEFAULT SYSUTCDATETIME(),
 fila_version ROWVERSION NOT NULL
);
END;
IF OBJECT_ID('dbo.comunicados_internos','U') IS NULL
BEGIN
CREATE TABLE dbo.comunicados_internos(
 id VARCHAR(80) NOT NULL CONSTRAINT PK_comunicados_internos PRIMARY KEY,
 tipo VARCHAR(30) NOT NULL CONSTRAINT DF_comunicados_tipo DEFAULT 'internal',
 destinatario NVARCHAR(160) NOT NULL,
 mensaje NVARCHAR(400) NOT NULL CONSTRAINT DF_comunicados_mensaje DEFAULT N'',
 id_modulo_origen VARCHAR(40) NULL,
 nombre_modulo_origen NVARCHAR(120) NOT NULL CONSTRAINT DF_comunicados_modulo DEFAULT N'',
 solicitado_por VARCHAR(60) NOT NULL CONSTRAINT DF_comunicados_solicitado DEFAULT 'sistema',
 texto_llamado NVARCHAR(500) NOT NULL,
 repeticiones INT NOT NULL CONSTRAINT DF_comunicados_repeticiones DEFAULT 1,
 fecha_creacion DATETIME2(0) NOT NULL CONSTRAINT DF_comunicados_fecha DEFAULT SYSDATETIME(),
 fila_version ROWVERSION NOT NULL
);
END;
MERGE dbo.modulos_atencion AS t
USING (VALUES
('optometria',N'Optometría','OPT',N'Optometría',N'Exámenes / Imágenes / Lentes',1),
('examenes',N'Exámenes','EXA',N'Exámenes',N'Equipo de Exámenes',0),
('consultorio',N'Consultorio','CON',N'Consultorio',N'Equipo de Consultorio',1),
('imagenes',N'Imágenes','IMG',N'Imágenes',N'Equipo de Imágenes',0),
('ipl',N'IPL','IPL',N'IPL',N'Equipo de IPL',1),
('cirugia',N'Cirugía','CIR',N'Cirugía',N'Cirugía General',1)
) AS s(id,nombre_modulo,prefijo_ticket,ambiente,nombre_medico,activo) ON t.id=s.id
WHEN MATCHED THEN UPDATE SET nombre_modulo=s.nombre_modulo,prefijo_ticket=s.prefijo_ticket,ambiente=s.ambiente,nombre_medico=s.nombre_medico,activo=s.activo
WHEN NOT MATCHED THEN INSERT(id,nombre_modulo,prefijo_ticket,ambiente,nombre_medico,activo) VALUES(s.id,s.nombre_modulo,s.prefijo_ticket,s.ambiente,s.nombre_medico,s.activo);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_pacientes_dni_fecha' AND object_id=OBJECT_ID('dbo.pacientes'))
CREATE INDEX IX_pacientes_dni_fecha ON dbo.pacientes(dni, fecha_registro DESC);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_pacientes_modulo_estado_fecha' AND object_id=OBJECT_ID('dbo.pacientes'))
CREATE INDEX IX_pacientes_modulo_estado_fecha ON dbo.pacientes(id_modulo, estado, fecha_registro);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_eventos_paciente_fecha' AND object_id=OBJECT_ID('dbo.eventos_llamado'))
CREATE INDEX IX_eventos_paciente_fecha ON dbo.eventos_llamado(id_paciente, fecha_llamado DESC);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_auditoria_modulo_fecha_llamado' AND object_id=OBJECT_ID('dbo.auditoria_llamados'))
CREATE INDEX IX_auditoria_modulo_fecha_llamado ON dbo.auditoria_llamados(id_modulo, fecha_llamado DESC);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_comunicados_fecha' AND object_id=OBJECT_ID('dbo.comunicados_internos'))
CREATE INDEX IX_comunicados_fecha ON dbo.comunicados_internos(fecha_creacion DESC);
IF OBJECT_ID('dbo.vw_kpi_turnero_diario','V') IS NULL
EXEC('CREATE VIEW dbo.vw_kpi_turnero_diario AS
SELECT
 CONVERT(date, p.fecha_registro) AS fecha,
 p.id_modulo,
 COUNT(DISTINCT CASE WHEN NULLIF(LTRIM(RTRIM(p.dni)), '''') IS NOT NULL THEN CONCAT(''DNI:'', LTRIM(RTRIM(p.dni))) ELSE CONCAT(''ID:'', p.id) END) AS pacientes_unicos,
 COUNT(*) AS registros_modulo,
 SUM(CASE WHEN p.estado = ''en_espera'' THEN 1 ELSE 0 END) AS en_espera,
 SUM(CASE WHEN p.estado = ''llamado'' THEN 1 ELSE 0 END) AS llamados_actuales,
 SUM(CASE WHEN p.estado = ''atendido'' THEN 1 ELSE 0 END) AS en_atencion,
 SUM(CASE WHEN p.estado = ''finalizado'' THEN 1 ELSE 0 END) AS finalizados,
 SUM(CASE WHEN p.es_referido = 1 THEN 1 ELSE 0 END) AS referencias_recibidas
FROM dbo.pacientes p
GROUP BY CONVERT(date, p.fecha_registro), p.id_modulo');
IF OBJECT_ID('dbo.vw_auditoria_llamados_diaria','V') IS NULL
EXEC('CREATE VIEW dbo.vw_auditoria_llamados_diaria AS
SELECT
 CONVERT(date, fecha_llamado) AS fecha_auditoria,
 id_modulo,
 nombre_modulo,
 nombre_medico,
 COUNT(*) AS total_llamados,
 AVG(CAST(minutos_espera AS DECIMAL(18,2))) AS promedio_minutos_espera,
 AVG(CAST(minutos_atencion AS DECIMAL(18,2))) AS promedio_minutos_atencion,
 AVG(CAST(ISNULL(minutos_entre_llamados, 0) AS DECIMAL(18,2))) AS promedio_minutos_entre_llamados,
 SUM(CASE WHEN es_rellamada = 1 THEN 1 ELSE 0 END) AS total_rellamadas
FROM dbo.auditoria_llamados
GROUP BY CONVERT(date, fecha_llamado), id_modulo, nombre_modulo, nombre_medico');
`);
    schemaReady = true;
  }

  async function upsertPatient(patient = {}) {
    return run(async (pool) => {
      const r = pool.request();
      r.input('id', sql.VarChar(40), clean(patient.id));
      r.input('codigo', sql.VarChar(20), clean(patient.code));
      r.input('dni', sql.VarChar(8), clean(patient.dni));
      r.input('nombres', sql.NVarChar(100), clean(patient.firstName));
      r.input('apellidos', sql.NVarChar(100), clean(patient.lastName));
      r.input('modulo', sql.VarChar(40), clean(patient.moduleId, 'optometria'));
      r.input('area', sql.NVarChar(120), clean(patient.area, patient.moduleId || 'Módulo'));
      r.input('medico', sql.NVarChar(120), clean(patient.doctorName, ''));
      r.input('obs', sql.NVarChar(400), clean(patient.notes || patient.referralNote, ''));
      r.input('estado', sql.VarChar(20), statusToSql(patient.status));
      r.input('fechaRegistro', sql.DateTime2(0), asDate(patient.createdAt) || new Date());
      r.input('fechaLlamado', sql.DateTime2(0), asDate(patient.calledAt));
      r.input('fechaAtencion', sql.DateTime2(0), asDate(patient.arrivedAt));
      r.input('fechaCierre', sql.DateTime2(0), asDate(patient.completedAt));
      r.input('registradoPor', sql.VarChar(60), clean(patient.registeredBy, 'sistema'));
      r.input('actualizadoPor', sql.VarChar(60), clean(patient.lastUpdatedBy, patient.registeredBy || 'sistema'));
      r.input('esReferido', sql.Bit, patient.isReferred === true || patient.referred === true);
      r.input('origenId', sql.VarChar(40), patient.referralSourcePatientId || null);
      r.input('origenModulo', sql.VarChar(40), patient.referralOriginModuleId || null);
      r.input('origenArea', sql.NVarChar(120), clean(patient.referralOriginArea, ''));
      r.input('origenMedico', sql.NVarChar(120), clean(patient.referralOriginDoctorName, ''));
      r.input('origenCodigo', sql.VarChar(20), clean(patient.referralOriginCode, ''));
      r.input('referidoPor', sql.VarChar(60), patient.referredBy || null);
      r.input('fechaReferencia', sql.DateTime2(0), asDate(patient.referredAt));
      r.input('obsReferencia', sql.NVarChar(400), clean(patient.referralNote, ''));
      await r.query(`
MERGE dbo.pacientes AS target
USING (SELECT @id AS id) AS src ON target.id = src.id
WHEN MATCHED THEN UPDATE SET
 codigo_ticket=@codigo,dni=@dni,nombres=@nombres,apellidos=@apellidos,id_modulo=@modulo,area_destino=@area,nombre_medico=@medico,
 observaciones=@obs,estado=@estado,fecha_llamado=@fechaLlamado,fecha_atencion=@fechaAtencion,fecha_cierre=@fechaCierre,actualizado_por=@actualizadoPor,
 es_referido=@esReferido,id_paciente_origen=@origenId,modulo_origen_referencia=@origenModulo,area_origen_referencia=@origenArea,
 medico_origen_referencia=@origenMedico,codigo_origen_referencia=@origenCodigo,referido_por=@referidoPor,fecha_referencia=@fechaReferencia,observacion_referencia=@obsReferencia
WHEN NOT MATCHED THEN INSERT(id,codigo_ticket,dni,nombres,apellidos,id_modulo,area_destino,nombre_medico,observaciones,estado,fecha_registro,fecha_llamado,fecha_atencion,fecha_cierre,registrado_por,actualizado_por,es_referido,id_paciente_origen,modulo_origen_referencia,area_origen_referencia,medico_origen_referencia,codigo_origen_referencia,referido_por,fecha_referencia,observacion_referencia)
VALUES(@id,@codigo,@dni,@nombres,@apellidos,@modulo,@area,@medico,@obs,@estado,@fechaRegistro,@fechaLlamado,@fechaAtencion,@fechaCierre,@registradoPor,@actualizadoPor,@esReferido,@origenId,@origenModulo,@origenArea,@origenMedico,@origenCodigo,@referidoPor,@fechaReferencia,@obsReferencia);`);
      return { ok: true, persisted: true, patient };
    }, { patient });
  }

  async function findPatientByDniToday(dni) {
    return run(async (pool) => {
      const result = await pool.request().input('dni', sql.VarChar(8), clean(dni)).query(`
SELECT TOP 1 * FROM dbo.pacientes
WHERE dni=@dni AND CONVERT(date, fecha_registro)=CONVERT(date, SYSDATETIME()) AND estado <> 'cancelado'
ORDER BY es_referido ASC, fecha_registro ASC;`);
      return { ok: true, patient: result.recordset[0] ? patientFromSql(result.recordset[0]) : null };
    }, { patient: null });
  }

  async function searchPatients(term = '') {
    return run(async (pool) => {
      const q = `%${clean(term).replace(/[%_]/g, '')}%`;
      const result = await pool.request().input('q', sql.NVarChar(120), q).query(`
SELECT TOP 80 * FROM dbo.pacientes
WHERE CONVERT(date, fecha_registro)=CONVERT(date, SYSDATETIME())
AND (dni LIKE @q OR nombres LIKE @q OR apellidos LIKE @q OR codigo_ticket LIKE @q)
ORDER BY fecha_registro DESC;`);
      return { ok: true, patients: result.recordset.map(patientFromSql) };
    }, { patients: [] });
  }

  async function persistCallEvent(event = {}) {
    return run(async (pool) => {
      const r = pool.request();
      r.input('id', sql.VarChar(80), clean(event.id));
      r.input('paciente', sql.VarChar(40), clean(event.patientId));
      r.input('modulo', sql.VarChar(40), clean(event.moduleId));
      r.input('texto', sql.NVarChar(300), clean(event.callText));
      r.input('fecha', sql.DateTime2(0), asDate(event.calledAt) || new Date());
      r.input('por', sql.VarChar(60), clean(event.calledBy, ''));
      r.input('operador', sql.NVarChar(120), clean(event.operatorName, ''));
      r.input('medico', sql.NVarChar(120), clean(event.doctorName, ''));
      const mappedCallType = ({ repeat: 'repetir', repeated: 'repetir', derive: 'derivar', derivar: 'derivar', next: 'siguiente', siguiente: 'siguiente', normal: 'normal' })[clean(event.callType, 'normal').toLowerCase()] || 'normal';
      r.input('tipo', sql.VarChar(20), mappedCallType);
      await r.query(`
IF NOT EXISTS (SELECT 1 FROM dbo.eventos_llamado WHERE id=@id)
INSERT INTO dbo.eventos_llamado(id,id_paciente,id_modulo,texto_llamado,fecha_llamado,llamado_por,nombre_operador,nombre_medico,tipo_llamado)
VALUES(@id,@paciente,@modulo,@texto,@fecha,@por,@operador,@medico,@tipo);`);
      return { ok: true, persisted: true };
    });
  }

  async function persistAudit(row = {}) {
    return run(async (pool) => {
      const r = pool.request();
      bindAudit(r, row);
      await r.query(`
IF NOT EXISTS (SELECT 1 FROM dbo.auditoria_llamados WHERE id_llamado=@callId)
INSERT INTO dbo.auditoria_llamados(id_llamado,id_paciente,codigo_paciente,nombre_paciente,id_modulo,nombre_modulo,nombre_medico,usuario_operador,nombre_operador,fecha_registro,fecha_llamado,fecha_atencion,fecha_cierre,minutos_espera,minutos_atencion,minutos_entre_llamados,cantidad_rellamadas,es_rellamada)
VALUES(@callId,@patientId,@patientCode,@patientName,@moduleId,@moduleLabel,@doctorName,@operatorUsername,@operatorName,@registeredAt,@calledAt,@arrivedAt,@completedAt,@waitMinutes,@attentionMinutes,@gapMinutes,@repeatCount,@isRepeat);`);
      return { ok: true, persisted: true };
    });
  }
  function bindAudit(r, row = {}) {
    r.input('callId', sql.VarChar(80), clean(row.callId));
    r.input('patientId', sql.VarChar(80), clean(row.patientId));
    r.input('patientCode', sql.VarChar(40), clean(row.patientCode));
    r.input('patientName', sql.NVarChar(200), clean(row.patientName));
    r.input('moduleId', sql.VarChar(40), clean(row.moduleId));
    r.input('moduleLabel', sql.NVarChar(120), clean(row.moduleLabel, row.moduleId));
    r.input('doctorName', sql.NVarChar(200), clean(row.doctorName, ''));
    r.input('operatorUsername', sql.VarChar(120), row.operatorUsername || null);
    r.input('operatorName', sql.NVarChar(200), row.operatorName || null);
    r.input('registeredAt', sql.DateTime2(0), asDate(row.registeredAt) || new Date());
    r.input('calledAt', sql.DateTime2(0), asDate(row.calledAt) || new Date());
    r.input('arrivedAt', sql.DateTime2(0), asDate(row.arrivedAt));
    r.input('completedAt', sql.DateTime2(0), asDate(row.completedAt));
    r.input('waitMinutes', sql.Int, Number(row.waitMinutes || 0));
    r.input('attentionMinutes', sql.Int, Number(row.attentionMinutes || 0));
    r.input('gapMinutes', sql.Int, row.nextCallGapMinutes == null ? null : Number(row.nextCallGapMinutes || 0));
    r.input('repeatCount', sql.Int, Number(row.repeatCount || 0));
    r.input('isRepeat', sql.Bit, row.isRepeat === true || Number(row.repeatCount || 0) > 0);
  }
  async function updateAuditArrival(row = {}) {
    return run(async (pool) => {
      const r = pool.request();
      r.input('patientId', sql.VarChar(80), clean(row.patientId));
      r.input('arrivedAt', sql.DateTime2(0), asDate(row.arrivedAt));
      r.input('attentionMinutes', sql.Int, Number(row.attentionMinutes || 0));
      await r.query(`UPDATE dbo.auditoria_llamados SET fecha_atencion=@arrivedAt, minutos_atencion=@attentionMinutes WHERE id_paciente=@patientId AND fecha_cierre IS NULL;`);
      return { ok: true, persisted: true };
    });
  }
  async function updateAuditCompletion(row = {}) {
    return run(async (pool) => {
      const r = pool.request();
      r.input('patientId', sql.VarChar(80), clean(row.patientId));
      r.input('arrivedAt', sql.DateTime2(0), asDate(row.arrivedAt));
      r.input('completedAt', sql.DateTime2(0), asDate(row.completedAt) || new Date());
      r.input('attentionMinutes', sql.Int, Number(row.attentionMinutes || 0));
      await r.query(`UPDATE dbo.auditoria_llamados SET fecha_atencion=ISNULL(fecha_atencion,@arrivedAt), fecha_cierre=@completedAt, minutos_atencion=@attentionMinutes WHERE id_paciente=@patientId AND fecha_cierre IS NULL;`);
      return { ok: true, persisted: true };
    });
  }
  async function updateAuditRepeat(row = {}) {
    return run(async (pool) => {
      const r = pool.request();
      r.input('patientId', sql.VarChar(80), clean(row.patientId));
      r.input('repeatCount', sql.Int, Number(row.repeatCount || 1));
      await r.query(`UPDATE dbo.auditoria_llamados SET cantidad_rellamadas=@repeatCount, es_rellamada=1 WHERE id_paciente=@patientId AND fecha_cierre IS NULL;`);
      return { ok: true, persisted: true };
    });
  }
  async function deletePatient(id) {
    return run(async (pool) => {
      await pool.request().input('id', sql.VarChar(40), clean(id)).query(`UPDATE dbo.pacientes SET estado='cancelado', fecha_cierre=ISNULL(fecha_cierre,SYSDATETIME()) WHERE id=@id;`);
      return { ok: true, persisted: true };
    });
  }
  async function upsertSystemUser(user = {}) {
    return run(async (pool) => {
      const r = pool.request();
      r.input('usuario', sql.NVarChar(60), clean(user.username).toLowerCase());
      r.input('clave', sql.NVarChar(255), clean(user.passwordHash || user.password || ''));
      r.input('nombre', sql.NVarChar(120), clean(user.fullName, user.username));
      r.input('rol', sql.NVarChar(40), clean(user.role, 'OPERADOR').toUpperCase());
      r.input('modulo', sql.VarChar(40), user.moduleId || null);
      r.input('medico', sql.NVarChar(120), clean(user.doctorName, ''));
      r.input('activo', sql.Bit, user.isActive !== false);
      await r.query(`
MERGE dbo.usuarios_sistema AS t
USING (SELECT @usuario AS usuario) AS s ON t.usuario=s.usuario
WHEN MATCHED THEN UPDATE SET clave_hash=@clave,nombre_completo=@nombre,rol=@rol,id_modulo=@modulo,nombre_medico=@medico,activo=@activo
WHEN NOT MATCHED THEN INSERT(usuario,clave_hash,nombre_completo,rol,id_modulo,nombre_medico,activo) VALUES(@usuario,@clave,@nombre,@rol,@modulo,@medico,@activo);`);
      return { ok: true, persisted: true, user };
    }, { user });
  }
  async function syncUsers(users = []) {
    if (!Array.isArray(users)) return { ok: false, persisted: false, reason: 'Lista de usuarios inválida' };
    let count = 0; let errors = [];
    for (const user of users) {
      const r = await upsertSystemUser(user);
      if (r.ok) count += 1; else errors.push(r.reason);
    }
    return { ok: errors.length === 0, persisted: count > 0, count, errors };
  }

  async function persistInternalAnnouncement(row = {}) {
    return run(async (pool) => {
      const r = pool.request();
      r.input('id', sql.VarChar(80), clean(row.id));
      r.input('tipo', sql.VarChar(30), clean(row.type, 'internal'));
      r.input('destinatario', sql.NVarChar(160), clean(row.targetName));
      r.input('mensaje', sql.NVarChar(400), clean(row.message, ''));
      r.input('modulo', sql.VarChar(40), row.originModuleId || null);
      r.input('moduloNombre', sql.NVarChar(120), clean(row.originLabel, ''));
      r.input('solicitadoPor', sql.VarChar(60), clean(row.requestedBy, 'sistema'));
      r.input('texto', sql.NVarChar(500), clean(row.announcementText));
      r.input('repeticiones', sql.Int, Math.max(1, Number(row.repeatCount || 1)));
      r.input('fecha', sql.DateTime2(0), asDate(row.createdAt) || new Date());
      await r.query(`
IF NOT EXISTS (SELECT 1 FROM dbo.comunicados_internos WHERE id=@id)
INSERT INTO dbo.comunicados_internos(id,tipo,destinatario,mensaje,id_modulo_origen,nombre_modulo_origen,solicitado_por,texto_llamado,repeticiones,fecha_creacion)
VALUES(@id,@tipo,@destinatario,@mensaje,@modulo,@moduloNombre,@solicitadoPor,@texto,@repeticiones,@fecha);`);
      return { ok: true, persisted: true };
    });
  }

  async function syncDoctors(rows = []) {
    if (!Array.isArray(rows)) return { ok: false, persisted: false, reason: 'Lista de médicos inválida' };
    return { ok: true, persisted: false, count: rows.length, reason: 'Médicos gestionados localmente para SQL Server.' };
  }

  async function syncFullState(snapshot = {}, users = []) {
    if (!cfg.enabled) return disabled();
    const summary = { patients: 0, calls: 0, audit: 0, users: 0, announcements: 0, errors: [] };
    const userResult = await syncUsers(users);
    if (userResult?.count) summary.users = userResult.count;
    if (Array.isArray(userResult?.errors) && userResult.errors.length) summary.errors.push(...userResult.errors);

    for (const patient of (Array.isArray(snapshot.queue) ? snapshot.queue : [])) {
      const r = await upsertPatient(patient);
      if (r?.ok) summary.patients += 1; else summary.errors.push(r?.reason || 'Error sincronizando paciente');
    }
    for (const item of (Array.isArray(snapshot.callHistory) ? snapshot.callHistory : [])) {
      const eventId = clean(item.eventId || `hist-${item.id || 'paciente'}-${item.calledAt || item.announcementAt || Date.now()}`).slice(0, 80);
      const r = await persistCallEvent({
        id: eventId,
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
    if (!cfg.enabled) return { ok: false, enabled: false, connected: false, status: 'disabled', message: 'SQL Server desactivado en config/sqlserver.json' };
    if (!sql) return { ok: false, enabled: true, connected: false, status: 'missing_mssql', message: 'Paquete mssql no disponible.' };
    try {
      const pool = await getPool();
      if (!schemaReady) await ensureSchema(pool);
      const ping = await pool.request().query(`
SELECT
 (SELECT COUNT(DISTINCT CASE WHEN NULLIF(LTRIM(RTRIM(dni)), '') IS NOT NULL THEN CONCAT('DNI:', LTRIM(RTRIM(dni))) ELSE CONCAT('ID:', id) END) FROM dbo.pacientes WHERE CONVERT(date,fecha_registro)=CONVERT(date,SYSDATETIME())) AS pacientesHoy,
 (SELECT COUNT(*) FROM dbo.eventos_llamado WHERE CONVERT(date,fecha_llamado)=CONVERT(date,SYSDATETIME())) AS llamadosHoy,
 (SELECT COUNT(*) FROM dbo.auditoria_llamados WHERE CONVERT(date,fecha_llamado)=CONVERT(date,SYSDATETIME())) AS auditoriaHoy,
 (SELECT COUNT(*) FROM dbo.pacientes) AS totalPacientes,
 (SELECT COUNT(*) FROM dbo.eventos_llamado) AS totalEventos,
 (SELECT COUNT(*) FROM dbo.auditoria_llamados) AS totalAuditoria,
 (SELECT COUNT(*) FROM dbo.usuarios_sistema) AS totalUsuarios,
 (SELECT COUNT(*) FROM dbo.modulos_atencion) AS totalModulos,
 (SELECT COUNT(*) FROM dbo.comunicados_internos) AS totalComunicados;`);
      lastError = null;
      return { ok: true, enabled: true, connected: true, status: 'connected', database: cfg.database, ...ping.recordset[0] };
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

module.exports = { createSqlService };
