# ADR-011: Interfaz web estática, en su propio contenedor

**Estado:** Aceptada

## Contexto

Hasta ahora la única forma de usar el sistema era Swagger UI, que sirve para documentar y probar la API pero no para el uso diario: el propietario tiene que saber qué endpoint llamar y leer JSON. La consigna no exige una interfaz, pero el caso de uso (consultar la expensa, pedir el código de pago, conciliar) se entiende y se demuestra mucho mejor con pantallas pensadas para cada rol.

El NFR de simplicidad pesa: el freelancer tiene que entender y levantar el sistema sin ayuda, y sobredimensionar un sistema chico es un error. Además, la interfaz corre en el navegador, así que no puede guardar un secreto (igual que Swagger UI, ADR-005).

## Decisión

Vamos a sumar una **interfaz web sencilla**:

1. **Páginas estáticas en HTML y JavaScript, sin framework ni compilación.** El login usa la librería oficial del proveedor de identidad (`keycloak-js`), incluida en el repositorio.
2. **En su propio contenedor** (`web`), servidas por nginx sin root (ADR-008) en el puerto 3001.
3. **Es un cliente más de la API:** inicia sesión con Authorization Code + PKCE como cliente público (`web-expensas`) y llama al gateway con el token, igual que Swagger UI. No tiene acceso a la API ni a la base por la red interna.
4. El gateway acepta pedidos del navegador desde los dos orígenes (Swagger UI y la interfaz).

## Alternativas

| Alternativa | Por qué se descartó |
|---|---|
| Quedarse solo con Swagger UI | Cero piezas nuevas, pero no es una interfaz para el propietario ni para el administrador: la demo del caso de uso depende de saber qué endpoint llamar |
| Que el gateway sirva también las páginas | Un contenedor menos y sin CORS, pero el gateway pasa a tener dos responsabilidades (seguridad y presentación) y cada cambio de pantalla obliga a reconstruirlo |
| Un framework (React, Vue) con compilación | Más ordenado para una aplicación grande, pero agrega Node, dependencias y un paso de build para unas pocas pantallas |
| Renderizar las páginas en la API (server-side) | Mezcla presentación con el monolito y obliga a manejar sesiones en la API, que hoy no tiene estado |

## Consecuencias

- (+) El caso de uso se demuestra de punta a punta con pantallas por rol.
- (+) No cambia la API ni el gateway: la interfaz usa el mismo contrato y la misma seguridad que cualquier cliente.
- (+) Sin build: se edita el HTML y se recarga.
- (−) Un contenedor más que levantar (siete en total) y un cliente más que mantener en el proveedor de identidad.
- (−) El gateway tiene que mantener la lista de orígenes permitidos (CORS).
- (−) Sin framework, si la interfaz creciera mucho habría que reorganizarla.
- (−) El token vive en la memoria del navegador, como en cualquier cliente público; se mitiga con su vencimiento corto (5 minutos).

## Confirmación

- Cada rol ve sus pantallas y puede hacer el caso de uso de punta a punta desde la interfaz: [prueba 21](../verificacion.md).
- La interfaz no agrega piezas a la API: usa el mismo contrato y los mismos permisos que Swagger UI (las pruebas 14 a 16 rigen igual para la interfaz).

## NFRs

- **Favorece:** usabilidad para los dos roles, demostrabilidad del caso de uso, simplicidad (sin build, sin cambios en la API).
- **Perjudica:** simplicidad operativa (un contenedor más), costo (marginal: nginx usa unos pocos MiB).
