# ADR-004: La conciliación diaria corre dentro de la API

**Estado:** Aceptada

## Contexto

Cada mañana hay que descargar el listado del banco y conciliarlo (ADR-003). No hay nadie de guardia: si algo falla de noche, se arregla al otro día. Por lo tanto, la conciliación tiene que reintentar sola y ponerse al día cuando el banco vuelve, sin perder ni duplicar pagos. El NFR de simplicidad pide la menor cantidad de piezas posible.

## Decisión

Vamos a ejecutar la conciliación como una **tarea programada dentro del proceso de la API**:

1. Cada mañana, después de una hora configurada, concilia los días pendientes, del más viejo al más nuevo.
2. Si el banco falla, registra el error y reintenta más tarde, sin saltear días.
3. Reintentar nunca duplica nada: cada operación del banco se procesa una sola vez.
4. El administrador también puede disparar una conciliación a mano (`POST /v1/conciliaciones`).

## Alternativas

| Alternativa | Por qué se descartó |
|---|---|
| Un contenedor aparte (*worker*) | Aísla la conciliación de la API, pero suma un contenedor que construir, desplegar y vigilar, sin un beneficio claro a esta escala |
| Una tarea programada del sistema operativo (cron) | Queda fuera del compose y puede fallar sin que nadie se entere. Si la máquina estaba apagada a esa hora, ese día no se concilia |
| Un broker de mensajes con reintentos | Es la ventaja del estilo orientado a eventos, pero obliga a operar un broker (descartado en ADR-001) |
| Solo conciliación manual | Depende de que alguien se acuerde todos los días |

## Consecuencias

- (+) Ninguna pieza extra que operar: la conciliación viaja con la API.
- (+) Se pone al día sola después de una falla del banco o de un reinicio.
- (−) Si la API está caída, tampoco se concilia. Al volver, recupera los días pendientes.
- (−) La API y la conciliación comparten recursos. Con unas pocas decenas de cobranzas por día, no es un problema.
- (−) Si en el futuro hubiera varias instancias de la API, habría que asegurar que no concilien dos a la vez.

## Confirmación

- La conciliación automática imputa sola, reintenta sola cuando el banco vuelve y se pone al día con los días atrasados, en orden: [pruebas 9, 10 y 11](../verificacion.md).
- Reintentar no duplica nada: [prueba 10](../verificacion.md) (el reintento imputa una sola vez).

## NFRs

- **Favorece:** simplicidad, recuperación sin guardia y consistencia (reintentos sin duplicados).
- **Perjudica:** aislamiento entre la API y el proceso batch, poco relevante a esta escala.
