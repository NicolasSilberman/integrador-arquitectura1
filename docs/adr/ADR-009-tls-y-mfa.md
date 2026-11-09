# ADR-009: TLS y segundo factor: diseñados para producción, desactivados en la demo

**Estado:** Aceptada

## Contexto

En la demo todo corre en `localhost`, así que el tráfico no sale de la máquina. En producción, entre el navegador y el servidor hay redes que no controlamos: sin TLS, cualquiera en el camino podría leer la contraseña del login o el token de cada pedido, y como el token es Bearer, quien lo tiene lo usa.

Además, el único factor de autenticación es la contraseña. El escenario maneja dinero: el administrador concilia los pagos y ve las expensas de todas las unidades. Los propietarios, en cambio, solo ven lo suyo y pagan fuera del sistema, en el banco. Para la demo, el jurado tiene que poder levantar y probar el sistema sin preparar nada más.

## Decisión

**TLS:**

1. En producción, **TLS termina en el gateway** (o en un reverse proxy delante de él), con un certificado de una autoridad pública renovado de forma automática (ACME, por ejemplo Let's Encrypt). El puerto 80 redirige al 443 y se envía **HSTS**.
2. Dentro de la red interna, el tráfico entre el gateway, la API y la base va sin TLS (terminación en el borde).
3. En la demo no hay TLS.

**Segundo factor:**

4. En producción, **TOTP obligatorio para el administrador**, configurado en el proveedor de identidad como acción requerida del usuario. La aplicación no cambia: sigue recibiendo un token.
5. Los propietarios inician sesión solo con contraseña.
6. En la demo, el segundo factor está **desactivado**.

## Alternativas

| Alternativa | Por qué se descartó |
|---|---|
| TLS también en la red interna (re-cifrado) | Requiere una autoridad de certificación interna y certificados para cada servicio; la red interna no sale del servidor |
| TLS de punta a punta sin descifrar en el gateway (passthrough) | El gateway no podría ver el token ni la ruta, y es justamente quien los valida (ADR-006) |
| TLS en la demo con un certificado autofirmado | El navegador muestra advertencias y el jurado tendría que aceptarlas; no aporta a lo que se evalúa |
| Segundo factor para todos los usuarios | Fricción para propietarios que solo consultan y pagan en el banco, que es la mayoría |
| Llaves de acceso (passkeys, WebAuthn) | Resisten el phishing, a diferencia de TOTP, pero fuera de `localhost` exigen HTTPS y dispositivos compatibles. Quedan como mejora para producción |
| SMS como segundo factor | Vulnerable al robo de la línea (SIM swapping); hoy se considera un autenticador restringido |
| Segundo factor activo en la demo | Cada persona que pruebe el sistema tendría que configurar una aplicación autenticadora |

## Consecuencias

- (+) La demo se levanta y se prueba sin pasos extra.
- (+) El diseño para producción queda definido y se activa con configuración, sin cambiar código.
- (+) El segundo factor se pide donde está el riesgo: en la cuenta que concilia el dinero.
- (−) La demo no muestra TLS ni el segundo factor funcionando.
- (−) TOTP se puede robar con una página falsa que reenvía el código en el momento; es una protección parcial.
- (−) Hay que definir cómo recupera el acceso un administrador que pierde su celular (códigos de recuperación de un solo uso), o el segundo factor vale lo mismo que ese proceso.
- (−) Con terminación en el borde, se confía en la red interna (coherente con ADR-006).

## Confirmación

- En la demo no hay TLS ni segundo factor, por decisión: no hay nada que confirmar en `localhost`.
- En producción se confirmaría con `curl -I https://<dominio>` (redirección a HTTPS y encabezado `Strict-Transport-Security`) y entrando como administrador, que tiene que pedir el código TOTP.

## NFRs

- **Favorece:** seguridad en producción (confidencialidad de credenciales y tokens), simplicidad de la demo.
- **Perjudica:** usabilidad del administrador (un paso más al iniciar sesión).
