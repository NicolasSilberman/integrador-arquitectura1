# ADR-004: Garantías de consistencia: idempotencia y "no imputar dos veces"

- **Estado:** Aceptado
- **Fecha:** 22/10/2026

## Contexto
La consistencia es el NFR estrella. Los riesgos concretos: (a) procesar dos veces la misma operación del banco (reintentos, dos conciliaciones a la vez, reproceso manual); (b) imputar dos pagos a la misma expensa; (c) pagos que no cuadran (código desconocido, monto distinto).

## Decisión
Los invariantes se garantizan **en la base de datos**, no sólo en el código, en capas:

1. **Una operación del banco se procesa una sola vez**: `cobranzas.banco_ref` es `UNIQUE`; se reclama con `INSERT … ON CONFLICT DO NOTHING`. Si ya existía, se cuenta como `yaProcesadas`.
2. **Una sola imputación por expensa**: índice único parcial `una_imputacion_por_expensa ON cobranzas(expensa_id) WHERE estado='IMPUTADA'`. Aunque el código tuviera un error, la base lo rechaza.
3. **Bloqueo de fila**: la imputación hace `SELECT … FOR UPDATE` sobre la expensa dentro de la transacción.
4. **Una transacción por cobranza**: una cobranza problemática no arrastra a las demás.
5. **Pagos que no cuadran no se fuerzan**: quedan `OBSERVADA` con motivo (`CODIGO_DESCONOCIDO`, `PAGO_DUPLICADO`, `MONTO_DISTINTO`) para que el administrador los resuelva. Se imputa sólo si el monto es **exacto**.
6. **Código de pago idempotente**: un código por expensa, derivado del id (10 dígitos con ceros + dígito verificador Luhn); `PUT /v1/expensas/{id}/codigo-pago` devuelve 201 la primera vez, 200 las siguientes con el mismo código, 409 si la expensa ya está pagada.
7. **Una sola conciliación a la vez**: `pg_try_advisory_lock`; una segunda solicitud simultánea recibe 409.

## Alternativas consideradas
| Alternativa | Por qué no |
|---|---|
| Verificar "si ya existe" en el código antes de insertar | Condición de carrera entre dos procesos: sólo la restricción de la base es atómica. |
| Una transacción para todo el lote | Un error en una cobranza revierte el día completo. |
| Imputar pagos parciales / con diferencia | Fuera del alcance del escenario; se deja observada para decisión humana. |

## Consecuencias
- (+) **Verificado con tests contra Postgres real**: 6 conciliaciones simultáneas producen una sola imputación; reejecutar el mismo día no duplica; el índice parcial rechaza una segunda imputación por SQL directo.
- (+) Reintentar siempre es seguro, condición clave para operar sin guardia.
- (−) Pagos con monto distinto requieren intervención manual. Es deliberado: es preferible observar a imputar mal.
- (−) La resolución de pagos observados queda diseñada pero no implementada en el corte.

## NFR relacionados
Consistencia (estrella), resiliencia, operabilidad sin guardia.
