# ADR-002: PostgreSQL como única base y dinero en centavos enteros

- **Estado:** Aceptado
- **Fecha:** 15/10/2026

## Contexto
El NFR estrella es la consistencia: una expensa no puede quedar mal liquidada ni pagada dos veces. Se manejan importes en pesos (ARS) y el cálculo de totales es el corazón del negocio.

## Decisión
1. **PostgreSQL 16** como única base: transacciones ACID, restricciones (`UNIQUE`, `CHECK`, FK), índices parciales y bloqueo de filas (`SELECT … FOR UPDATE`) son las herramientas que garantizan los invariantes (ver ADR-004).
2. **El dinero se guarda como entero en centavos** (`BIGINT`) y se modela como Value Object `Dinero` (`centavos`, `moneda: ARS`). Nunca se usa `float`.
3. **El total de una expensa no se almacena**: se calcula como `SUM` de sus conceptos. Así no puede quedar desincronizado: el invariante se cumple por construcción.
4. Las reglas viven también en la base (`CHECK monto_centavos > 0`, `periodo` con formato válido, estados acotados), no sólo en el código.

## Alternativas consideradas
| Alternativa | Por qué no |
|---|---|
| `NUMERIC(12,2)` | Es correcto, pero obliga a cuidar la conversión en JS (donde el número es `float`). Con enteros, la aritmética es exacta en ambos lados. |
| `float` / `double` | Error de redondeo en dinero: inaceptable. |
| Guardar el total en la expensa | Dos fuentes de verdad; riesgo de inconsistencia. |
| NoSQL | Sin transacciones multi-fila ni restricciones, se traslada la consistencia a la aplicación. |

## Consecuencias
- (+) Aritmética exacta; el total es siempre la suma real de los conceptos.
- (+) La base rechaza datos inválidos aunque falle el código.
- (−) Hay que convertir a/desde formato legible en los bordes (API y banco). Se hace en un solo lugar (el traductor del banco y el serializador de la API).
- (−) Calcular el total en cada consulta cuesta un `SUM`. Medido: GET de 150 expensas p95 ≈ 9 ms (ver verificación de NFR), sin problema a esta escala.

## NFR relacionados
Consistencia, mantenibilidad.
