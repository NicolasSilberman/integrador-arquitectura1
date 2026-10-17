# ADR-002: Una sola base relacional (PostgreSQL), con el dinero en centavos

**Estado:** Aceptada

## Contexto

El NFR estrella es la consistencia: una expensa no se puede cobrar dos veces y cada pago tiene que quedar imputado a la unidad correcta. Además, la liquidación prorratea importes entre unidades y la suma tiene que cuadrar al centavo. El sistema es un monolito modular (ADR-001) y tiene que correr en un hosting barato.

## Decisión

1. Vamos a usar **una sola base relacional PostgreSQL** para los tres módulos. Cada módulo tiene sus propias tablas y es el único que las lee y escribe.
2. Los importes se guardan como **enteros en centavos** y se manejan como el value object Dinero. Nunca como números con decimales.
3. Las reglas que pueda garantizar la base también se declaran en la base (restricciones de unicidad, montos positivos, estados válidos), además de en el código.

## Alternativas

| Alternativa | Por qué se descartó |
|---|---|
| Una base por módulo | Separaría transacciones que hoy son una sola (por ejemplo, imputar un pago y marcar la expensa como pagada) y sumaría bases que operar |
| Base no relacional (documental) | Sin transacciones entre varias entidades ni restricciones declarativas, la consistencia quedaría solo en manos del código |
| Importes con decimales (punto flotante) | Producen errores de redondeo, inaceptables con dinero y con un prorrateo que tiene que cuadrar al centavo |

## Consecuencias

- (+) Las transacciones y las restricciones de la base protegen las reglas aunque el código tenga un error.
- (+) Una sola base que respaldar y operar.
- (+) La aritmética con enteros es exacta.
- (−) Hay que convertir los importes a un formato legible en los bordes (la API y la integración con el banco).
- (−) Todos los módulos dependen de la misma base: si se cae, se cae todo el sistema. Se acepta por la escala y porque no hay requisito de alta disponibilidad.

## NFRs

- **Favorece:** consistencia, simplicidad y costo.
- **Perjudica:** disponibilidad (punto único de falla) y escalabilidad, ninguno prioritario en el escenario.
