# ADR-003: Conciliación diaria por lotes contra el banco (pull SOAP) con capa anticorrupción

- **Estado:** Aceptado
- **Fecha:** 15/10/2026

## Contexto
El banco **no cobra online**: el propietario paga con un código (ventanilla o homebanking) y el banco publica la lista de cobranzas del día anterior. El sistema debe descargarla cada mañana y conciliar. El banco expone un servicio **SOAP heredado**, con formatos propios: importes `"52000,50"`, fechas `DDMMAAAA` y errores de negocio dentro de un HTTP 200 (`CodigoRetorno ≠ "00"`).

## Decisión
1. **Modelo pull por lotes**: una vez por día el sistema consulta `ConsultarCobranzasDelDia` y concilia.
2. **Capa anticorrupción (ACL)** en `integraciones/banco/`: `clienteSoap.js` habla SOAP; `traductor.js` convierte el modelo del banco al del dominio (importes a centavos **sin pasar por float**, fechas a ISO, códigos de error a excepciones propias `BancoNoDisponible` / `BancoRespuestaInvalida`). El dominio nunca ve el formato del banco.
3. El banco real se **simula con un mock** (`banco-mock/`) que expone el mismo contrato SOAP, un endpoint para cargar pagos de demo y uno para simular caídas.
4. La conciliación se registra como **corrida** (`conciliaciones`: estado, contadores, error). Se puede disparar automáticamente (ADR-009) o manualmente (`POST /v1/conciliaciones`).

## Alternativas consideradas
| Alternativa | Por qué no |
|---|---|
| Webhook / notificación del banco | El banco no lo ofrece; el escenario establece descarga diaria. |
| Llamar al banco desde la lógica de negocio directamente | Acopla el dominio al formato heredado: cada rareza del banco contaminaría el código. |
| Polling frecuente | Sin valor: la información sólo cambia una vez por día. |

## Consecuencias
- (+) Cambios del banco (o pasar del mock al real) quedan aislados en un solo directorio.
- (+) Una caída del banco no rompe el sistema: la corrida queda en `ERROR` y se reintenta (ADR-009).
- (−) El estado de pago tiene hasta un día de demora. Aceptado: es una restricción del negocio, no del diseño.
- (−) El mock reproduce lo que sabemos del banco; el comportamiento real podría diferir. Se mitiga con el traductor testeado de forma aislada (`traductor.test.js`).

## NFR relacionados
Consistencia, resiliencia ante fallas del externo, mantenibilidad.
