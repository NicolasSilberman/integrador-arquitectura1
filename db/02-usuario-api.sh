#!/bin/bash
# Crea el usuario con el que se conecta la API (ADR-008: mínimo privilegio).
# Lo ejecuta Postgres automáticamente la PRIMERA vez que se crea el volumen, después de 01-esquema.sql.
# La contraseña llega por la variable API_DB_PASSWORD (definida en .env): no queda escrita en el repositorio.
set -e   # (sin -u: el entrypoint de Postgres puede ejecutar este archivo con "source")
: "${API_DB_PASSWORD:?Falta API_DB_PASSWORD: agregala a tu .env (ver .env.example)}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
     -v api_pass="$API_DB_PASSWORD" -v base="$POSTGRES_DB" <<'SQL'
-- Usuario propio de la API: NO es superusuario
CREATE ROLE api_expensas LOGIN PASSWORD :'api_pass';

GRANT CONNECT ON DATABASE :"base" TO api_expensas;
GRANT USAGE ON SCHEMA public TO api_expensas;

-- Solo leer, insertar y actualizar: no puede borrar filas ni crear, modificar o borrar tablas.
-- Las cobranzas y las corridas de conciliación son historial: nunca se borran.
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO api_expensas;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO api_expensas;   -- para los ids (SERIAL)
SQL

echo "Usuario api_expensas creado con permisos mínimos."
