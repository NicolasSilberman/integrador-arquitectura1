# ADR-005: Autenticación delegada a Keycloak (OIDC) con dos roles

- **Estado:** Aceptado
- **Fecha:** 29/10/2026

## Contexto
La consigna exige autenticación con un proveedor de identidad y al menos dos roles. Escribir un sistema propio de usuarios y contraseñas es riesgoso y no aporta valor al negocio (subdominio genérico).

## Decisión
- **Keycloak 26.2.5** como proveedor OIDC, con un **realm `expensas` versionado en el repo** (`keycloak/realm-expensas.json`), que se importa al arrancar.
- Roles de realm: **`propietario`** (ve y paga sus expensas) y **`administrador`** (liquida, concilia, ve todo).
- Cliente público `swagger-ui` con **Authorization Code + PKCE (S256)**, redirect URI exacta, y un *audience mapper* para que los tokens incluyan `aud = api-expensas`.
- Usuarios de prueba: `paula` y `pablo` (propietarios), `adriana` (administradora).
- Token de acceso de **5 minutos**.
- El vínculo propietario↔usuario se hace por **`preferred_username`** (no por `sub`), con `editUsernameAllowed: false` para que no pueda cambiarse. Razón: el `sub` es generado por Keycloak y cambiaría si se recrea el realm; el username es estable y legible en el seed.

## Alternativas consideradas
| Alternativa | Por qué no |
|---|---|
| Usuarios/contraseñas propios en la API | Riesgo de seguridad y trabajo sin valor de negocio. |
| Proveedor SaaS (Auth0, Cognito…) | Dependencia externa y costo; la consigna pide que todo levante con un comando. |
| Implicit flow / password grant | Obsoletos e inseguros; PKCE es lo recomendado para clientes públicos. |

## Consecuencias
- (+) Contraseñas, sesiones y estándares de seguridad fuera de nuestro código.
- (+) Realm reproducible: cualquier integrante levanta el mismo entorno.
- (−) **Limitación conocida:** Keycloak corre en `start-dev` **sin persistencia**: los usuarios creados desde la consola se pierden al recrear el contenedor. La fuente de verdad es el JSON del realm. En producción haría falta volumen o base propia, modo `start` y HTTPS.
- (−) **Consumo de RAM** (~700 MB estimados) en tensión con "hosting barato". No medido en este trabajo. Es el costo más alto de esta decisión y debe discutirse en la defensa; una alternativa más liviana sería un IdP más chico, a costa de más trabajo propio.
- (−) Las credenciales de prueba están en el repo: **sólo para demo**.

## NFR relacionados
Seguridad, simplicidad (no operamos un sistema de usuarios), costo.
