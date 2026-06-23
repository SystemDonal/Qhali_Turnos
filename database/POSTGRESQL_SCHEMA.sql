-- QHALI ÑAWI - PostgreSQL sin pérdida de datos
-- Ejecutar sobre una base nueva o existente. Usa IF NOT EXISTS y no borra registros.
CREATE SCHEMA IF NOT EXISTS public;

CREATE TABLE IF NOT EXISTS modulos_atencion (
  id VARCHAR(40) PRIMARY KEY,
  nombre_modulo VARCHAR(100) NOT NULL,
  prefijo_ticket VARCHAR(10) NOT NULL,
  ambiente VARCHAR(120) NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  fecha_creacion TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS medicos_disponibles (
  id BIGSERIAL PRIMARY KEY,
  id_modulo VARCHAR(40) NOT NULL REFERENCES modulos_atencion(id),
  nombre_medico VARCHAR(120) NOT NULL,
  especialidad VARCHAR(120) NOT NULL DEFAULT 'CONSULTORIO',
  disponible BOOLEAN NOT NULL DEFAULT TRUE,
  orden INTEGER NOT NULL DEFAULT 1,
  UNIQUE(id_modulo, nombre_medico)
);

CREATE TABLE IF NOT EXISTS pacientes (
  id VARCHAR(40) PRIMARY KEY,
  codigo_ticket VARCHAR(20) NOT NULL,
  dni VARCHAR(8) NOT NULL,
  nombres VARCHAR(100) NOT NULL,
  apellidos VARCHAR(100) NOT NULL,
  id_modulo VARCHAR(40) NOT NULL REFERENCES modulos_atencion(id),
  area_destino VARCHAR(120) NOT NULL,
  nombre_medico VARCHAR(120) NOT NULL DEFAULT 'MÉDICO ASIGNADO',
  observaciones VARCHAR(500) NOT NULL DEFAULT '',
  estado VARCHAR(30) NOT NULL DEFAULT 'waiting',
  fecha_registro TIMESTAMP NOT NULL DEFAULT NOW(),
  fecha_llamado TIMESTAMP NULL,
  fecha_atencion TIMESTAMP NULL,
  fecha_cierre TIMESTAMP NULL,
  registrado_por VARCHAR(60) NOT NULL DEFAULT 'sistema',
  actualizado_por VARCHAR(60) NOT NULL DEFAULT 'sistema',
  es_referido BOOLEAN NOT NULL DEFAULT FALSE,
  id_paciente_origen VARCHAR(40) NULL,
  modulo_origen_referencia VARCHAR(40) NULL,
  area_origen_referencia VARCHAR(120) NOT NULL DEFAULT '',
  medico_origen_referencia VARCHAR(120) NOT NULL DEFAULT '',
  codigo_origen_referencia VARCHAR(20) NOT NULL DEFAULT '',
  referido_por VARCHAR(60) NULL,
  fecha_referencia TIMESTAMP NULL,
  observacion_referencia VARCHAR(500) NOT NULL DEFAULT ''
);

DROP INDEX IF EXISTS ux_paciente_dni_dia_modulo;
CREATE INDEX IF NOT EXISTS ix_paciente_dni_dia_modulo
ON pacientes(dni, id_modulo, (fecha_registro::date));
CREATE INDEX IF NOT EXISTS ix_pacientes_estado_modulo ON pacientes(id_modulo, estado, fecha_registro);

CREATE TABLE IF NOT EXISTS eventos_llamado (
  id VARCHAR(50) PRIMARY KEY,
  id_paciente VARCHAR(40) REFERENCES pacientes(id),
  id_modulo VARCHAR(40) REFERENCES modulos_atencion(id),
  texto_llamado TEXT NOT NULL,
  llamado_por VARCHAR(60),
  nombre_operador VARCHAR(120),
  nombre_medico VARCHAR(120),
  tipo_llamado VARCHAR(40) NOT NULL DEFAULT 'normal',
  fecha_llamado TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auditoria_llamados (
  id BIGSERIAL PRIMARY KEY,
  id_llamado VARCHAR(80) NOT NULL UNIQUE,
  id_paciente VARCHAR(80) NOT NULL,
  codigo_paciente VARCHAR(40) NOT NULL DEFAULT '',
  nombre_paciente VARCHAR(200) NOT NULL DEFAULT '',
  id_modulo VARCHAR(40) NOT NULL,
  nombre_modulo VARCHAR(120) NOT NULL DEFAULT '',
  nombre_medico VARCHAR(200) NOT NULL DEFAULT '',
  usuario_operador VARCHAR(120),
  nombre_operador VARCHAR(200),
  fecha_registro TIMESTAMP NOT NULL DEFAULT NOW(),
  fecha_llamado TIMESTAMP NOT NULL DEFAULT NOW(),
  fecha_atencion TIMESTAMP NULL,
  fecha_cierre TIMESTAMP NULL,
  minutos_espera INTEGER NOT NULL DEFAULT 0,
  minutos_atencion INTEGER NOT NULL DEFAULT 0,
  minutos_entre_llamados INTEGER NULL,
  cantidad_rellamadas INTEGER NOT NULL DEFAULT 0,
  es_rellamada BOOLEAN NOT NULL DEFAULT FALSE,
  fecha_creacion TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_auditoria_modulo_fecha_llamado
ON auditoria_llamados(id_modulo, fecha_llamado DESC);

CREATE INDEX IF NOT EXISTS ix_auditoria_paciente_abierta
ON auditoria_llamados(id_paciente, fecha_cierre);

CREATE TABLE IF NOT EXISTS usuarios_sistema (
  usuario VARCHAR(60) PRIMARY KEY,
  clave_hash VARCHAR(255) NOT NULL DEFAULT '',
  nombre_completo VARCHAR(120) NOT NULL DEFAULT '',
  rol VARCHAR(40) NOT NULL DEFAULT 'OPERADOR',
  id_modulo VARCHAR(40) NULL,
  nombre_medico VARCHAR(120) NOT NULL DEFAULT '',
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  fecha_creacion TIMESTAMP NOT NULL DEFAULT NOW(),
  fecha_actualizacion TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS comunicados_internos (
  id VARCHAR(80) PRIMARY KEY,
  tipo VARCHAR(30) NOT NULL DEFAULT 'internal',
  destinatario VARCHAR(160) NOT NULL DEFAULT '',
  mensaje VARCHAR(400) NOT NULL DEFAULT '',
  id_modulo_origen VARCHAR(40) NULL,
  nombre_modulo_origen VARCHAR(120) NOT NULL DEFAULT '',
  solicitado_por VARCHAR(60) NOT NULL DEFAULT 'sistema',
  texto_llamado VARCHAR(500) NOT NULL DEFAULT '',
  repeticiones INTEGER NOT NULL DEFAULT 1,
  fecha_creacion TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE VIEW vw_auditoria_llamados_diaria AS
SELECT
  fecha_llamado::date AS fecha_auditoria,
  id_modulo,
  nombre_modulo,
  COUNT(*) AS total_llamados,
  COUNT(fecha_atencion) AS total_atendidos,
  ROUND(AVG(minutos_espera))::integer AS promedio_minutos_espera,
  ROUND(AVG(NULLIF(minutos_atencion, 0)))::integer AS promedio_minutos_atencion,
  SUM(cantidad_rellamadas) AS total_rellamadas
FROM auditoria_llamados
GROUP BY fecha_llamado::date, id_modulo, nombre_modulo;

CREATE OR REPLACE VIEW vw_kpi_turnero_diario AS
SELECT
  CURRENT_DATE AS fecha_kpi,
  (SELECT COUNT(DISTINCT COALESCE(NULLIF(dni,''), id)) FROM pacientes WHERE fecha_registro::date = CURRENT_DATE) AS pacientes_hoy,
  (SELECT COUNT(*) FROM eventos_llamado WHERE fecha_llamado::date = CURRENT_DATE) AS llamados_hoy,
  (SELECT COUNT(*) FROM auditoria_llamados WHERE fecha_llamado::date = CURRENT_DATE) AS auditoria_hoy,
  (SELECT COUNT(*) FROM auditoria_llamados WHERE fecha_llamado::date = CURRENT_DATE AND fecha_atencion IS NOT NULL) AS atendidos_hoy,
  (SELECT COALESCE(ROUND(AVG(minutos_espera))::integer, 0) FROM auditoria_llamados WHERE fecha_llamado::date = CURRENT_DATE) AS promedio_minutos_espera,
  (SELECT COALESCE(ROUND(AVG(NULLIF(minutos_atencion, 0)))::integer, 0) FROM auditoria_llamados WHERE fecha_llamado::date = CURRENT_DATE) AS promedio_minutos_atencion,
  (SELECT COALESCE(SUM(cantidad_rellamadas), 0) FROM auditoria_llamados WHERE fecha_llamado::date = CURRENT_DATE) AS total_rellamadas;

INSERT INTO modulos_atencion(id,nombre_modulo,prefijo_ticket,ambiente) VALUES
('optometria','OPTOMETRÍA','OPT','Optometría'),
('consultorio','CONSULTORIO','CON','Consultorio'),
('examenes','EXÁMENES','EXA','Exámenes'),
('imagenes','IMÁGENES','IMG','Imágenes'),
('ipl','IPL','IPL','IPL'),
('cirugia','CIRUGÍA','CIR','Cirugía')
ON CONFLICT (id) DO UPDATE SET nombre_modulo=EXCLUDED.nombre_modulo, ambiente=EXCLUDED.ambiente;

INSERT INTO medicos_disponibles(id_modulo,nombre_medico,especialidad,orden) VALUES
('optometria','OFTALMOLOGÍA GENERAL','OPTOMETRÍA',1),
('optometria','GLAUCOMA','OPTOMETRÍA',2),
('optometria','RETINA','OPTOMETRÍA',3),
('optometria','CÓRNEA','OPTOMETRÍA',4),
('optometria','CIRUGÍA REFRACTIVA','OPTOMETRÍA',5),
('consultorio','ESPINOZA HUMAREDA IVAN','CATARATA',1),
('consultorio','JUAN CARLOS MARTÍNEZ QUIJANDRIA','CATARATA',2),
('consultorio','JUAN ALBERTO GISMONDI ALEGRE','VIA LAGRIMAL',3),
('consultorio','MARIO NICOLAS BECERRA','GLAUCOMA',4),
('consultorio','FERNANDO RAMON OTRERAS','RETINA',5),
('consultorio','MARY ESTEFANIA ESCOBAR LOPEZ','OFTALMOLOGIA GENERAL',6),
('consultorio','EDWARD VALDERRAMA GUEVARA','OFTALMOLOGIA GENERAL',7),
('consultorio','YORDALIS RODRIGUEZ CARBALLO','OFTALMOLOGIA GENERAL',8),
('consultorio','ANTHONY MARTINEZ APAZA','CORNEA',9),
('consultorio','ILSE LOPEZ','CORNEA',10)
ON CONFLICT (id_modulo,nombre_medico) DO UPDATE SET disponible=TRUE, orden=EXCLUDED.orden;
