# ADR-006: El token se valida en un gateway, que reenvía la identidad a la API

**Estado:** Aceptada

## Contexto

Con el login delegado en un proveedor de identidad (ADR-005), cada pedido a la API llega con un token de acceso que hay que validar: la firma, el emisor (`iss`), la audiencia (`aud`) y el vencimiento (`exp`). Después hay que aplicar los permisos de cada rol (matriz de permisos, sección 9.3) y una regla fina que el rol no alcanza a expresar: cada propietario solo ve y paga sus expensas. Esa regla depende de los datos del Padrón, que son de la API.

## Decisión

Vamos a poner un **gateway** delante de la API, como **única puerta de entrada**:

1. El gateway valida el token y aplica los permisos **por rol**. Si falla la autenticación responde 401; si el rol no alcanza, 403; los dos en Problem Details.
2. Si el pedido pasa, lo reenvía a la API agregando la identidad del usuario en los encabezados `X-Usuario` y `X-Roles`. Antes **borra esos encabezados si los mandó el cliente**.
3. La API **no publica su puerto**: solo se la alcanza por la red interna, a través del gateway. Por eso confía en los encabezados de identidad.
4. La API resuelve la **regla fina**, porque es la que conoce de quién es cada unidad.

## Alternativas

| Alternativa | Por qué se descartó |
|---|---|
| Validar el token en la API, sin gateway | Ahorra un contenedor, pero mezcla la seguridad transversal con la lógica del dominio. Con el gateway, las reglas por rol quedan en un solo lugar y se leen como una tabla |
| Validar en el gateway **y** en la API (el gateway reenvía el token y la API lo vuelve a validar) | Es defensa en profundidad: protege aunque alguien llegue a la API por otro camino. Pero duplica la validación y la configuración, y a esta escala, con la API sin puerto publicado, no se justifica |
| Que la regla fina la resuelva el gateway | El gateway tendría que conocer el Padrón (de quién es cada unidad), que es un dato del dominio. Se rompería la propiedad de los datos de la API |

## Consecuencias

- (+) Las reglas por rol están en un solo lugar, separadas de la lógica de negocio.
- (+) La API no expone su puerto: hay una sola puerta que vigilar.
- (+) Si en el futuro hubiera más servicios, el gateway ya los protegería a todos.
- (−) Es **un contenedor más** que construir y operar (en tensión con el NFR de simplicidad).
- (−) Es un **punto único de falla**: si el gateway se cae, la API queda inaccesible.
- (−) **La API confía en la red interna.** Asumimos a conciencia la falacia "la red es segura": si alguien alcanzara la API por otro camino, podría hacerse pasar por cualquier usuario con los encabezados de identidad. Lo mitiga que la API no publique su puerto ni esté en otra red que la interna.
- (−) La autorización queda repartida: los permisos por rol en el gateway y la regla fina en la API.

## NFRs

- **Favorece:** seguridad (un único punto de entrada controlado), mantenibilidad (reglas por rol en un solo lugar).
- **Perjudica:** simplicidad y costo (un contenedor más), disponibilidad (punto único de falla).
