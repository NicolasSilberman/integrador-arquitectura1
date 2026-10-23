# ADR-005: Autenticación delegada en un proveedor de identidad OIDC (Keycloak)

**Estado:** Aceptada

## Contexto

La consigna pide autenticación delegada en un proveedor de identidad que implemente OpenID Connect, con al menos dos roles con permisos distintos. El sistema tiene dos roles: propietario (ve y paga su expensa) y administrador (liquida y concilia). La autenticación es un subdominio genérico: un problema resuelto y estandarizado, que no es el diferencial del negocio. Lo mantiene un freelancer y corre en un hosting barato.

## Decisión

Vamos a delegar la autenticación en **Keycloak**, como un servicio más del compose:

1. Un realm `expensas`, **versionado en el repositorio** e importado al levantar el sistema.
2. Roles de realm `propietario` y `administrador`, con un usuario de prueba por rol.
3. Swagger UI se registra como **cliente público** con Authorization Code + PKCE y redirect URI exacto.
4. Los tokens de acceso duran **5 minutos** e incluyen la audiencia `api-expensas`.
5. Los usuarios no pueden cambiar su nombre de usuario, porque es el dato que los vincula con sus unidades en el Padrón.

## Alternativas

| Alternativa | Por qué se descartó |
|---|---|
| Login propio con usuarios y contraseñas en una tabla | Es reinventar un subdominio genérico, y es muy fácil hacerlo mal: guardar contraseñas, sesiones, bloqueos |
| Proveedor de identidad en la nube (servicio pago) | Suma una dependencia externa y un costo, y el sistema ya no se levanta completo con un solo comando |
| SAML | Pensado para el ingreso corporativo en aplicaciones web con servidor; no resuelve el acceso a APIs con tokens. La clase recomienda OIDC salvo que haya que integrarse con un proveedor corporativo existente, que no es el caso |

## Consecuencias

- (+) La aplicación nunca ve contraseñas; recibe tokens firmados que puede validar sola.
- (+) El realm versionado hace que todos los integrantes tengan el mismo entorno, con los mismos usuarios y roles.
- (+) Agregar un segundo factor o cambiar la política de contraseñas se configura en el proveedor, sin tocar la aplicación.
- (−) Es **un componente más que operar** para un freelancer.
- (−) Es un **punto único de falla**: si el proveedor se cae, nadie puede iniciar sesión. Los tokens ya emitidos siguen validándose porque las claves públicas quedan en caché, pero vencen a los 5 minutos.
- (−) **Consume bastante memoria** para un hosting barato. Se mide con `docker stats` en la verificación de esta etapa.
- (−) Los tokens no se pueden revocar al instante; por eso duran solo 5 minutos.
- (−) Las contraseñas de los usuarios de prueba están en el realm del repositorio: son solo para la demo.

## NFRs

- **Favorece:** seguridad (confidencialidad), mantenibilidad (no hay código de login propio).
- **Perjudica:** simplicidad operativa y costo (un servicio más y su memoria), disponibilidad del login (punto único de falla).
