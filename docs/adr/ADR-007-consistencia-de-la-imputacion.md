# ADR-007: Consistencia de la imputación y código de pago

**Estado:** Aceptada

## Contexto

La consigna pone dos reglas que no se negocian: **nunca se puede cobrar dos veces la misma expensa** y **cada pago tiene que quedar imputado a la unidad correcta**. Es el NFR estrella (consistencia). El banco informa las cobranzas en un listado diario (ADR-003) y la conciliación corre sola cada mañana, con reintentos, y también a mano (ADR-004). Por lo tanto, la misma operación del banco puede llegar más de una vez (reintentos, reprocesos del mismo día) y dos conciliaciones podrían coincidir en el tiempo. Además, el propietario necesita un código para pagar en el banco, y puede pedirlo más de una vez.

## Decisión

**Conciliación:**

1. Cada cobranza se registra por el **identificador de la operación en el banco**, que es único en la base. Si ya existía, se cuenta como "ya procesada" y no se vuelve a imputar.
2. Cada cobranza se procesa en **su propia transacción**, con la **expensa bloqueada** mientras se imputa.
3. Solo se imputa si el código corresponde a una expensa impaga y el **monto es exacto**. Si no, la cobranza queda **observada** con su motivo (código desconocido, pago duplicado, monto distinto) para que la revise el administrador.
4. Un **candado en la base** permite **una sola conciliación a la vez**: una segunda solicitud simultánea recibe 409.
5. La base tiene un **índice único** que admite a lo sumo una cobranza imputada por expensa, como última barrera.

**Código de pago:**

6. Se **deriva del id** de la expensa (10 dígitos) más un **dígito verificador**: es siempre el mismo para cada expensa y permite detectar errores de tipeo. Se guarda en la base la primera vez que se pide.
7. Se obtiene con **`PUT`**, que es idempotente: 201 la primera vez, 200 con el mismo código las siguientes, 409 si la expensa ya está pagada.

## Alternativas

| Alternativa | Por qué se descartó |
|---|---|
| Verificar en el código "si ya existe" antes de insertar la cobranza | Entre la verificación y la inserción, otra conciliación puede hacer lo mismo: solo una restricción de la base es atómica |
| Una sola transacción para todo el listado del día | Una cobranza con problemas revertiría el día completo |
| Imputar pagos con diferencias (parciales o de más) | Fuera del alcance del escenario; imputar mal es peor que dejar el pago para revisión |
| Código de pago aleatorio | Hay que guardarlo y buscarlo, y existe riesgo de colisiones; el derivado del id es único por construcción |
| `POST` para obtener el código | No es idempotente: un reintento del cliente podría generar un código distinto |

## Consecuencias

- (+) Reintentar o reprocesar una conciliación siempre es seguro: es la condición para operar sin guardia.
- (+) El invariante "una expensa se cobra a lo sumo una vez" lo protege la base, aunque el código tenga un error.
- (+) El propietario recibe siempre el mismo código, aunque lo pida varias veces.
- (−) Los pagos que no cuadran requieren intervención del administrador (resolverlos está diseñado, pero fuera del corte).
- (−) Mientras corre una conciliación, una segunda tiene que esperar o se rechaza.
- (−) El código expone el id interno de la expensa. Se acepta: no da acceso a nada, porque consultar una expensa requiere login y pertenencia.

## NFRs

- **Favorece:** consistencia (estrella), recuperación sin guardia.
- **Perjudica:** comodidad del administrador ante pagos que no cuadran; concurrencia de conciliaciones (irrelevante a esta escala).
