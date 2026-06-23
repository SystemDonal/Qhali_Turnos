<<<<<<< HEAD
# Qhali Ñahui - Turnero clínico

Sistema local para registro, llamado y atención de pacientes por módulos.

## Inicio

1. Ejecutar `iniciar_turnero.bat`.
2. Abrir `http://localhost:3000/index.html`.

## Datos locales

El sistema usa archivos únicos:

- `data/state.json`: estado operativo actual.
- `data/users.json`: usuarios del sistema.
- `data/doctors.json`: médicos y especialidades configurables desde Admin.
- `data/historial_diario.json`: historial agrupado por día.

No se crean archivos diarios separados por fecha.

## Base de datos

PostgreSQL:

- Configuración: `config/postgresql.json`
- Script único: `database/POSTGRESQL_SCHEMA.sql`

SQL Server:

- Configuración: `config/sqlserver.json`
- Script único: `database/SQLSERVER_SCHEMA.sql`

## Rutas

- `/index.html`: panel público principal al iniciar.
- `/login.html`: acceso de operadores y administración.
- `/admin.html`: administración.
- `/operator.html`: panel de operador.
=======
# Qhali_Turnos
Sistema de turnos de la clinica QhaliÑawi
>>>>>>> b184dad8accee5c0dfa9342bd3bb83502dfbed62
