# ADR-003: Integración con el banco: descarga diaria por SOAP con capa anticorrupción

**Estado:** Aceptada

## Contexto

El banco no cobra en línea: el propietario paga con un código y cada mañana el sistema tiene que descargar el listado de cobranzas del día anterior y conciliarlas. El banco expone un servicio SOAP heredado, con un formato propio que no controlamos (sus importes, fechas y códigos de error). Para el trabajo, el banco se simula con un mock.

## Decisión

1. Vamos a **descargar el listado una vez por día** (el sistema pide, el banco responde) y conciliarlo.
2. Vamos a encapsular la integración en una **capa anticorrupción** dentro de la API: un cliente SOAP y un traductor que convierte el formato del banco al modelo propio. El dominio nunca ve el formato del banco.
3. El banco se simula con un servicio `banco-mock` que expone el mismo contrato SOAP.

## Alternativas

| Alternativa | Por qué se descartó |
|---|---|
| Que el banco nos avise de cada pago | El banco no lo ofrece: la restricción del escenario dice que se descarga el listado del día anterior |
| Consultar al banco varias veces por día | No aporta nada: el listado se publica una vez por día |
| Usar el formato del banco directamente en el dominio | Cada particularidad del sistema heredado se metería en las reglas de negocio, y cambiar de banco (o pasar del mock al real) obligaría a tocarlas |
| Un bus de integración (ESB) | Es infraestructura pensada para muchos sistemas que integrar; acá hay uno solo |

## Consecuencias

- (+) Los cambios del banco, o el paso del mock al banco real, quedan aislados en un solo lugar.
- (+) La conciliación trabaja con el modelo propio, más fácil de entender y probar.
- (−) El estado de un pago se actualiza recién al día siguiente. Es una restricción del negocio, no del diseño.
- (−) La capa anticorrupción es una pieza más que mantener.
- (−) El mock reproduce lo que sabemos del banco; el banco real podría comportarse distinto.

## NFRs

- **Favorece:** consistencia (el dominio no depende de un formato ajeno), mantenibilidad y recuperación (una falla del banco queda contenida en la integración).
- **Perjudica:** inmediatez del estado de pago, que la restricción del escenario ya descarta.
