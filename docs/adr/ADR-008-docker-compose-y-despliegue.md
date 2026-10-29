# ADR-008: Despliegue con Docker Compose, un único comando

- **Estado:** Aceptado
- **Fecha:** 22/10/2026

## Contexto
La consigna exige que un solo comando (`docker compose up`) levante todo. El hosting es barato (una máquina chica) y lo opera una sola persona.

## Decisión
- **Docker Compose** con cinco servicios: `db` (PostgreSQL), `api`, `keycloak`, `banco-mock`, `swagger-ui`. Nombre de proyecto fijo (`expensas`).
- **La base no publica puerto** al host: sólo la API la alcanza, por la red interna. Datos en volumen con nombre (`pgdata`) y `healthcheck`; la API arranca cuando la base está sana.
- **Dos redes** (`backend`, `identidad`) y descubrimiento por nombre de servicio.
- **Configuración por `.env`** con valores por defecto (`${VAR:-default}`) para que funcione sin tocar nada; el `.env` real no se versiona (`.env.example` sí).
- **Dockerfile multi-etapa** (`base` → `pruebas` → `produccion`); la imagen de producción sólo lleva dependencias de producción y es la etapa por defecto.
- `restart: unless-stopped` en la API: si el proceso cae de noche, se levanta solo (clave sin guardia).
- Pruebas ejecutables en Docker: `docker-compose.test.yml` (usa una base descartable dentro del mismo Postgres).

## Alternativas consideradas
| Alternativa | Por qué no |
|---|---|
| Kubernetes | Sobredimensionado para 150 unidades y un freelancer. |
| Instalación directa en el servidor | No reproducible; "en mi máquina funciona". |
| PaaS administrado | Costo y dependencia; la consigna pide compose. |

## Consecuencias
- (+) Entorno reproducible; un comando levanta todo, incluido el realm y los datos de ejemplo.
- (+) Superficie expuesta mínima (la base no sale del host).
- (−) Secretos de demo con valores por defecto: **en producción deben cambiarse** y no vivir en el repo.
- (−) Sin backups automatizados en el corte; para producción habría que programar `pg_dump` periódico y copiarlo fuera del servidor. **Es un riesgo abierto.**
- (−) **No pudimos ejecutar `docker compose up` en el entorno de desarrollo del asistente** (sin demonio Docker): los archivos están validados con `docker compose config`, pero la primera corrida real debe hacerla el grupo.

## NFR relacionados
Simplicidad operativa, costo, portabilidad, disponibilidad.
