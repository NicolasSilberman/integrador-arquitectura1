# ADR-009: Planificador interno con puesta al día automática (sin guardia)

- **Estado:** Aceptado
- **Fecha:** 22/10/2026

## Contexto
La conciliación debe correr cada mañana y **nadie vigila el sistema**: si falla de noche se arregla al día siguiente. Por lo tanto, el sistema debe recuperarse solo de fallas del banco, caídas del proceso o reinicios.

## Decisión
- **El planificador vive dentro del proceso de la API** (`scheduler.js`): no hay cron externo, cola ni worker.
- Cada minuto revisa si ya pasó la hora configurada (07:00, zona `America/Argentina/Buenos_Aires`, calculada con `Intl`) y si hay días sin conciliar.
- **Catch-up:** concilia, del más viejo al más nuevo, desde el día siguiente al último conciliado con éxito hasta ayer, con un **tope de 7 días hacia atrás**.
- **Orden estricto:** si un día falla, se detiene y se reintenta luego; no se saltea.
- **Reintento cada 30 minutos**, medido con el **reloj de la base** (el mismo que registra el intento) para no mezclar relojes.
- Al arrancar se marcan como `ERROR` ("interrumpida") las corridas que quedaron `EN_CURSO` por una caída.
- Convive con la ejecución manual gracias al candado `pg_try_advisory_lock` (ADR-004) y a la idempotencia.

## Alternativas consideradas
| Alternativa | Por qué no |
|---|---|
| Cron del sistema operativo / contenedor aparte | Otra pieza que operar y que puede fallar en silencio. |
| Cola de trabajos (BullMQ/Redis, etc.) | Infraestructura adicional sin necesidad a esta escala. |
| Sólo ejecución manual | Depende de que alguien se acuerde cada día. |
| Ejecutar a una hora fija sin catch-up | Si la API está caída a esa hora, ese día no se concilia jamás. |

## Consecuencias
- (+) Cero infraestructura extra y recuperación automática, verificada con tests con instantes fijos (corre antes de la hora → no hace nada; falla → reintenta; se pone al día tras varios días caídos).
- (−) Si se escalara a varias instancias de la API, todas intentarían conciliar. Mitigado por el candado y la idempotencia, pero habría que revisarlo.
- (−) Si el sistema está caído más de 7 días, los días anteriores deben conciliarse manualmente (`POST /v1/conciliaciones` con la fecha).
- (−) No hay alerta activa: se asume que el administrador mira el estado de las corridas. Un aviso por correo queda como mejora.

## NFR relacionados
Operabilidad sin guardia, resiliencia, simplicidad.
