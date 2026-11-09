# ADR-010: Autenticación con el banco mediante API key

**Estado:** Aceptada

## Contexto

La API descarga cada mañana el listado de cobranzas del banco (ADR-003). En esa llamada no hay ningún usuario del otro lado: es una comunicación entre servicios. Hoy la API llama al banco sin ninguna credencial, así que cualquiera que llegara al servicio podría pedir el listado, y la API tampoco demuestra quién es. El banco es un sistema heredado con un servicio SOAP: no tiene un proveedor de identidad compartido con nosotros.

## Decisión

1. La API se autentica ante el banco con una **API key** que viaja en un encabezado HTTP de cada pedido SOAP.
2. La clave vive en el **`.env`** (fuera del repositorio) y se pasa por variable de entorno a la API y, en la demo, al banco simulado.
3. El banco simulado **rechaza** los pedidos sin la clave o con una clave incorrecta.

## Alternativas

| Alternativa | Por qué se descartó |
|---|---|
| Sin autenticación | El listado de cobranzas quedaría abierto a cualquiera que llegue al servicio |
| Client Credentials (token OAuth de corta duración) | Vence solo y lleva permisos, pero requiere que el banco valide tokens de un proveedor de identidad, y un sistema heredado no lo tiene |
| TLS mutuo (certificado del cliente) | Da identidad criptográfica, pero exige una autoridad de certificación y renovar certificados: un costo alto para un freelancer |
| Usuario y contraseña dentro del mensaje SOAP (WS-Security) | Es el estándar de SOAP, pero es una credencial fija igual que la API key, con más complejidad |

## Consecuencias

- (+) Solo la API puede pedir el listado de cobranzas.
- (+) Es simple de implementar y de operar: una sola variable.
- (−) La clave **no vence**: si se filtra, sirve hasta que alguien la cambie, y cambiarla requiere coordinar con el banco.
- (−) Da acceso total al servicio del banco (es todo o nada).
- (−) Sin TLS, la clave viaja a la vista; en producción la conexión con el banco tiene que ir cifrada (ADR-009).
- (−) En la demo, la misma clave está en el `.env` de la API y del banco simulado.

## Confirmación

- Todas las conciliaciones de las [pruebas 1 a 11](../verificacion.md) funcionan con la clave del `.env`.
- Con una clave incorrecta en `BANCO_API_KEY`, el banco simulado responde 401 y la conciliación responde 502 sin imputar nada.

## NFRs

- **Favorece:** seguridad de la integración (confidencialidad del listado de cobranzas).
- **Perjudica:** levemente la simplicidad (un secreto más que administrar y rotar).
