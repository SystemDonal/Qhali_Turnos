SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

IF DB_ID(N'TurneroQhaliNahui') IS NULL
BEGIN
    CREATE DATABASE TurneroQhaliNahui;
END
GO

USE TurneroQhaliNahui;
GO

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
END
GO

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
END
GO

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
END
GO

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
END
GO

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
END
GO


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
END
GO

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
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_pacientes_dni_fecha' AND object_id=OBJECT_ID('dbo.pacientes'))
CREATE INDEX IX_pacientes_dni_fecha ON dbo.pacientes(dni, fecha_registro DESC);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_pacientes_modulo_estado_fecha' AND object_id=OBJECT_ID('dbo.pacientes'))
CREATE INDEX IX_pacientes_modulo_estado_fecha ON dbo.pacientes(id_modulo, estado, fecha_registro);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_eventos_paciente_fecha' AND object_id=OBJECT_ID('dbo.eventos_llamado'))
CREATE INDEX IX_eventos_paciente_fecha ON dbo.eventos_llamado(id_paciente, fecha_llamado DESC);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_auditoria_modulo_fecha_llamado' AND object_id=OBJECT_ID('dbo.auditoria_llamados'))
CREATE INDEX IX_auditoria_modulo_fecha_llamado ON dbo.auditoria_llamados(id_modulo, fecha_llamado DESC);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_comunicados_fecha' AND object_id=OBJECT_ID('dbo.comunicados_internos'))
CREATE INDEX IX_comunicados_fecha ON dbo.comunicados_internos(fecha_creacion DESC);
GO

CREATE OR ALTER VIEW dbo.vw_kpi_turnero_diario AS
SELECT
 CONVERT(date, p.fecha_registro) AS fecha,
 p.id_modulo,
 COUNT(DISTINCT CASE WHEN NULLIF(LTRIM(RTRIM(p.dni)), '') IS NOT NULL THEN CONCAT('DNI:', LTRIM(RTRIM(p.dni))) ELSE CONCAT('ID:', p.id) END) AS pacientes_unicos,
 COUNT(*) AS registros_modulo,
 SUM(CASE WHEN p.estado = 'en_espera' THEN 1 ELSE 0 END) AS en_espera,
 SUM(CASE WHEN p.estado = 'llamado' THEN 1 ELSE 0 END) AS llamados_actuales,
 SUM(CASE WHEN p.estado = 'atendido' THEN 1 ELSE 0 END) AS en_atencion,
 SUM(CASE WHEN p.estado = 'finalizado' THEN 1 ELSE 0 END) AS finalizados,
 SUM(CASE WHEN p.es_referido = 1 THEN 1 ELSE 0 END) AS referencias_recibidas
FROM dbo.pacientes p
GROUP BY CONVERT(date, p.fecha_registro), p.id_modulo;
GO

CREATE OR ALTER VIEW dbo.vw_auditoria_llamados_diaria AS
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
GROUP BY CONVERT(date, fecha_llamado), id_modulo, nombre_modulo, nombre_medico;
GO

SELECT 'OK SQL CONEXION + KPI: no se borraron datos' AS resultado;
GO
