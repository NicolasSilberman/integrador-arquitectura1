# ADR-006: La API valida el token por sí misma (sin gateway) y aplica autorización

- **Estado:** Aceptado
- **Fecha:** 29/10/2026

## Contexto
Hay que decidir quién valida el JWT y quién decide los permisos. La cátedra muestra un gateway que valida el token delante de la API. En nuestro escenario hay una sola API y se busca la mínima cantidad de piezas que operar.

## Decisión
- **No hay gateway.** La API valida cada token con `jose`: firma (claves públicas JWKS de Keycloak, cacheadas), `iss`, `aud = api-expensas` y `exp`.
- **Autorización en dos niveles:** (1) por **rol** (`requiereRol`): p. ej. sólo `administrador` concilia; (2) por **pertenencia**: un propietario sólo accede a expensas de unidades suyas (`preferred_username`); acceder a la de otro devuelve **403**.
- Códigos: token ausente/inválido/vencido → **401**; sin permiso → **403**; Keycloak inalcanzable **sin claves en caché** → **503**.
- El `issuer` esperado usa la URL pública del navegador (`localhost:8180`) mientras que las claves se leen por la red interna (`keycloak:8080`).

## Alternativas consideradas
| Alternativa | Por qué no |
|---|---|
| API Gateway (Kong/Traefik/propio) | Un contenedor más que operar y configurar, sin beneficio con una sola API. La validación duplicada que evitaría no existe acá. |
| Confiar en un header puesto por un proxy | Si alguien llega directo a la API, se saltea la seguridad. |

## Consecuencias
- (+) Un contenedor menos; la seguridad no depende de que el gateway esté bien configurado.
- (+) Resiliente: con Keycloak caído, los tokens firmados con claves ya cacheadas siguen validando (test incluido).
- (+) Verificado por tests: 401 sin token/vencido/firma inválida/`aud` o `iss` erróneo, 403 por rol y por propiedad, 503 con IdP caído.
- (−) Si en el futuro hubiera varios servicios, habría que repetir la validación o incorporar un gateway. Decisión reversible.

## NFR relacionados
Seguridad, simplicidad, disponibilidad.
