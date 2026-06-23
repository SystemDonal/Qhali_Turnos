# Qhali Ñawi - Preparado para GitHub y Railway

## Cambios aplicados en esta versión

- Se eliminó `node_modules/` del entregable.
- Se agregó `.gitignore` para evitar subir dependencias, backups, logs, `.env` y datos locales.
- Se limpió `config/postgresql.json`, `config/sqlserver.json`, `config/reniec.json` y `config/vlc.json` para no exponer contraseñas ni tokens.
- Se agregó `.env.example` con las variables necesarias.
- Se agregó `railway.json` para despliegue con Nixpacks.
- El sistema ahora puede leer PostgreSQL desde `DATABASE_URL` o desde `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`.
- La clave inicial del usuario `admin` ahora depende de `DEFAULT_ADMIN_PASSWORD`.

## Comandos locales

```bash
npm install
npm start
```

Abrir:

```txt
http://localhost:3000
```

## Variables para Railway

En el servicio web de Railway configurar:

```env
NODE_ENV=production
PORT=3000
DATABASE_URL=${{Postgres.DATABASE_URL}}
PGSSL=false
DEFAULT_ADMIN_PASSWORD=COLOCA_UNA_CLAVE_SEGURA
RENIEC_ENABLED=false
RENIEC_TOKEN=
```

Si el servicio PostgreSQL tiene otro nombre, cambia `Postgres` por el nombre exacto del servicio de base de datos en Railway.

## Base de datos

El sistema incluye el script:

```txt
database/POSTGRESQL_SCHEMA.sql
```

La aplicación intenta crear el esquema automáticamente cuando se conecta a PostgreSQL. Si deseas cargarlo manualmente, ejecútalo en Railway usando Query/psql.
