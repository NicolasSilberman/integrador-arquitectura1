# ADR-008: Mínimo privilegio: usuario de base propio y contenedores sin root

**Estado:** Aceptada

## Contexto

Hasta ahora la API se conecta a la base con el usuario que crea Postgres al iniciar, que es **superusuario**, y los contenedores propios (API, gateway, banco simulado) corren como **root**, que es lo que hace Docker por defecto. Si alguien encontrara una falla en la API (por ejemplo, una inyección SQL), heredaría todos esos permisos: podría borrar la base entera o tomar el contenedor. La seguridad no puede depender de una sola capa: el login y el gateway protegen la entrada, pero cada capa tiene que asumir que la anterior puede fallar.

## Decisión

1. **Usuario de base propio para la API (`api_expensas`):** puede leer, insertar y actualizar las tablas del sistema y usar sus secuencias. **No** puede borrar filas, ni crear, modificar o borrar tablas. Se crea al inicializar la base con un script que lee su contraseña del `.env`.
2. El **superusuario** queda solo para inicializar la base (crear el esquema y los datos de ejemplo).
3. Los contenedores propios corren con el **usuario sin privilegios `node`** que trae la imagen oficial, en lugar de root.
4. Se mantienen las imágenes **oficiales con versión fija** y solo se publican los puertos necesarios (la base y la API no publican ninguno).

## Alternativas

| Alternativa | Por qué se descartó |
|---|---|
| Seguir con el superusuario | Una falla en la API comprometería toda la base |
| Un usuario por módulo (Padrón, Liquidación, Cobranzas) | Reforzaría la propiedad de los datos, pero la API es un solo proceso que usa los tres: tendría tres conexiones y tres contraseñas sin una ganancia real a esta escala |
| Darle a la API también permiso de borrar filas | El sistema no borra registros: las cobranzas y las corridas son historial. No darlo acota el daño de un error o de un ataque |
| Escribir la contraseña del usuario en el script SQL | Quedaría en el repositorio |

## Consecuencias

- (+) Una inyección SQL o una falla en la API no puede borrar tablas ni datos.
- (+) Si alguien toma un contenedor, no tiene privilegios de root dentro de él.
- (−) Una variable más en el `.env` (la contraseña de `api_expensas`).
- (−) Cuando el esquema cambie, hay que acordarse de dar permisos sobre las tablas nuevas.
- (−) El script de inicialización corre solo con el volumen vacío: para aplicar el cambio hay que recrear la base (`docker compose down -v`).

## Confirmación

- El usuario de la API en la base puede leer pero no borrar: [prueba 17](../verificacion.md) (`DELETE` rechazado con `permission denied`).
- La base y la API no publican puertos: [prueba 17](../verificacion.md).
- Los contenedores propios corren sin root: `docker compose exec api id -u` y `docker compose exec gateway id -u` devuelven un usuario distinto de 0.

## NFRs

- **Favorece:** seguridad (confidencialidad e integridad).
- **Perjudica:** simplicidad (un usuario y una contraseña más que administrar).
