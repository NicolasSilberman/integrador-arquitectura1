# Clase 10 — Guía práctica: Docker, docker-compose y APIs

**Arquitectura de Software 1 · UNAHUR**

Esta guía es la parte práctica de la Clase 10. Vas a levantar, con **un solo comando**, un sistema chico de cuatro contenedores: una base de datos, una API REST, un BFF para una app mobile y la documentación de la API generada a partir de su contrato OpenAPI.

- **Tiempo estimado:** 60 a 90 minutos.
- **No se entrega.** Es para practicar a tu ritmo y para usar este repo como esqueleto del TP.
- **Requisito:** Docker Desktop (o Podman Desktop) instalado y funcionando.
- **Dudas:** por el foro del campus.

---

## Qué vas a levantar

```
                     TU COMPUTADORA (host)
     navegador / curl / Postman
        │ localhost:8080        │ localhost:3000          │ localhost:3001
        ▼                       ▼                         ▼
 ┌──────────────┐        ┌──────────────┐   http://api:3000   ┌──────────────┐
 │  swagger-ui  │        │     api      │◄────────────────────│  bff-mobile  │
 │ (doc. desde  │        │ (API REST de │                     │ (adapta datos│
 │ openapi.yaml)│        │   cursos)    │                     │ para mobile) │
 └──────────────┘        └──────┬───────┘                     └──────────────┘
                                │ db:5432
                                ▼
                         ┌──────────────┐
                         │      db      │──► volumen "pgdata"
                         │ (PostgreSQL) │    (los datos sobreviven)
                         └──────────────┘

   Red "backend": db, api, bff-mobile        swagger-ui: fuera de esa red
```

| Carpeta / archivo | Qué es |
|---|---|
| `docker-compose.yml` | La definición **declarativa** de todo el sistema |
| `openapi.yaml` | El **contrato** de la API (lo que vimos en la Clase 9) |
| `api/` | API REST en Node.js + Express, con su `Dockerfile` |
| `bff-mobile/` | Backend For Frontend para una app mobile, con su `Dockerfile` |
| `db/init.sql` | Crea la tabla y carga 3 cursos de ejemplo la primera vez |

No hace falta saber Node.js: el código es corto y está comentado, pero el foco de la clase es **cómo se arma y se conecta el sistema**, no el lenguaje.

---

## Paso 0 · Verificar la instalación

Abrí una terminal (en Windows: PowerShell o la terminal de VS Code) y corré:

```bash
docker --version
docker compose version
docker run --rm hello-world
```

El último comando baja una imagen mínima, crea un contenedor, imprime un saludo y lo borra (`--rm`). Si ves *"Hello from Docker!"*, está todo listo.

> **¿Usás Podman?** Reemplazá `docker` por `podman` en todos los comandos (`podman compose up -d --build`). Podman Desktop te ofrece instalar el soporte de compose la primera vez.

Después descomprimí el `.zip` de esta clase (o cloná el repo) y **ubicá la terminal dentro de la carpeta** `clase10-practica`:

```bash
cd ruta/a/clase10-practica
```

---

## Paso 1 · Levantar todo con un solo comando

```bash
docker compose up -d --build
```

- `up` crea las redes, los volúmenes y los contenedores, y los arranca.
- `-d` (*detached*) los deja corriendo en segundo plano y te devuelve la terminal.
- `--build` construye las imágenes de `api` y `bff-mobile` a partir de sus `Dockerfile`.

La primera vez tarda un par de minutos, porque baja las imágenes base (`postgres`, `node`, `swagger-ui`). Las siguientes veces es casi instantáneo, porque quedan en la caché local.

Verificá que estén los cuatro corriendo:

```bash
docker compose ps
```

Tenés que ver `db` como **healthy** y los otros tres como **running**. Si alguno no aparece o se reinicia, mirá sus logs:

```bash
docker compose logs api
docker compose logs -f api      # -f sigue mostrando en vivo; se sale con Ctrl+C
```

🔎 **Para pensar:** en `docker compose ps`, ¿por qué `db` no muestra ningún puerto publicado y `api` muestra `0.0.0.0:3000->3000/tcp`?

---

## Paso 2 · La documentación sale del contrato (Swagger UI)

Abrí en el navegador: **http://localhost:8080**

Esa página no la escribió nadie a mano: el contenedor `swagger-ui` lee el archivo `openapi.yaml` y genera la documentación interactiva. Probá:

1. **GET /cursos** → *Try it out* → *Execute*. Deberías ver los 3 cursos de ejemplo.
2. **POST /cursos** → *Try it out* → usá el ejemplo → *Execute*. Fijate en el código **201** y en el header **`location`**.
3. **GET /cursos/{id}** con `id = 99`. Fijate en el **404** y en el `content-type: application/problem+json`: es Problem Details, lo mismo que vimos en la Clase 9.
4. **POST /cursos** con el body `{"nombre": ""}`. ¿Qué código devuelve? ¿Qué dice el `detail`?

También podés llamar a la API directamente, sin Swagger: **http://localhost:3000/cursos**

🔎 **Para pensar:** cuando apretás *Execute*, ¿quién hace el pedido HTTP a la API: el contenedor `swagger-ui` o tu navegador? (Pista: mirá la URL del pedido que muestra Swagger.)

---

## Paso 3 · Service discovery: los servicios se encuentran por nombre

Dentro de la red de compose, **el nombre del servicio funciona como hostname**: Docker trae un DNS interno que resuelve `db`, `api` y `bff-mobile` a la IP del contenedor que corresponda. Por eso en el `docker-compose.yml` la API tiene `DB_HOST: db` y el BFF tiene `API_URL: http://api:3000`.

Probalo ejecutando comandos **dentro** de los contenedores con `docker compose exec`:

```bash
# Desde el BFF, llamar a la API por su nombre de servicio
docker compose exec bff-mobile wget -qO- http://api:3000/cursos

# Desde el BFF, intentar lo mismo con localhost
docker compose exec bff-mobile wget -qO- http://localhost:3000/cursos

# Desde la API, ver a qué IP resuelve "db"
docker compose exec api ping -c 2 db

# Desde swagger-ui (que NO está en la red backend), intentar llegar a la API
docker compose exec swagger-ui wget -qO- http://api:3000/health
```

🔎 **Para pensar:**
- ¿Por qué el segundo comando falla si la API está andando y desde tu navegador `localhost:3000` funciona?
- ¿Por qué falla el último? ¿Qué tendrías que cambiar en el `docker-compose.yml` para que funcione? ¿Te conviene hacerlo?

---

## Paso 4 · Volúmenes: ¿qué pasa con los datos?

1. Desde Swagger UI, creá un curso nuevo (POST) y verificá que aparezca en `GET /cursos`.
2. Bajá todo y volvé a levantarlo:

   ```bash
   docker compose down
   docker compose up -d
   ```

   `down` **borra los contenedores** (y la red). ¿Sigue estando tu curso?

3. Ahora bajá todo **borrando también los volúmenes**:

   ```bash
   docker compose down -v
   docker compose up -d
   ```

   ¿Y ahora? ¿Cuántos cursos hay?

🔎 **Para pensar:** en el `docker-compose.yml` hay dos tipos de montaje en el servicio `db`: `pgdata:/var/lib/postgresql/data` y `./db/init.sql:/docker-entrypoint-initdb.d/init.sql`. ¿Cuál es un **volumen con nombre** y cuál un **bind mount**? ¿Por qué `init.sql` corrió de nuevo recién después del `down -v`?

---

## Paso 5 · El contrato está vivo: editá el `openapi.yaml`

1. Abrí `openapi.yaml` con VS Code y cambiá el `title` de `info` (por ejemplo, `API de Cursos — mi versión`).
2. Recargá **http://localhost:8080**. No hizo falta reconstruir nada.

🔎 **Para pensar:** ¿por qué el cambio se ve al instante? (Pista: mirá cómo llega el `openapi.yaml` al contenedor `swagger-ui`.) Y una pregunta más incómoda: si cambiás el contrato pero no el código de la API, ¿qué pasa con los clientes que confían en la documentación?

---

## Paso 6 · El BFF: la misma API, adaptada a un cliente

Compará estas dos respuestas en el navegador:

- **http://localhost:3000/cursos**: la API "general", con todos los campos.
- **http://localhost:3001/mobile/cursos**: el BFF de la app mobile.

El BFF no tiene base de datos ni reglas de negocio: le pide los datos a la API (por nombre, `http://api:3000`) y los **recorta y renombra** para lo que necesita la pantalla de la app (menos campos, `titulo` en vez de `nombre`, un `total` listo para mostrar).

Ahora frená solo la API y volvé a pedirle datos al BFF:

```bash
docker compose stop api
```

Abrí de nuevo **http://localhost:3001/mobile/cursos**. ¿Qué código devuelve? Después volvé a levantarla:

```bash
docker compose start api
```

🔎 **Para pensar:** si mañana hay una app web además de la mobile, ¿le agregarías campos a este mismo BFF o crearías otro? ¿Por qué?

---

## Paso 7 · Puertos: host vs. contenedor

En el `docker-compose.yml`, cambiá el puerto de la API de `"3000:3000"` a `"3100:3000"` y aplicá el cambio:

```bash
docker compose up -d
```

(Compose detecta qué cambió y recrea solo ese contenedor.)

1. ¿Responde **http://localhost:3100/cursos**? ¿Y **http://localhost:3000/cursos**?
2. Probá *Execute* en Swagger UI. ¿Funciona? ¿Por qué no? Arreglalo en `openapi.yaml` (sección `servers`).
3. ¿Dejó de andar el BFF (**http://localhost:3001/mobile/cursos**)? ¿Por qué no?

Cuando termines, volvé el puerto a `"3000:3000"` y el `servers` del contrato a `http://localhost:3000`.

---

## Paso 8 · Apagar y limpiar

```bash
docker compose down        # borra contenedores y red; conserva el volumen con los datos
docker compose down -v     # además borra el volumen (empezás de cero la próxima vez)
```

Las imágenes quedan en tu máquina. Para ver cuánto ocupan y liberar espacio:

```bash
docker image ls
docker system df
docker image prune         # borra imágenes que ya no usa ningún contenedor
```

---

## Machete de comandos

| Comando | Para qué |
|---|---|
| `docker compose up -d --build` | Construir y levantar todo en segundo plano |
| `docker compose ps` | Ver el estado de cada servicio |
| `docker compose logs -f <servicio>` | Ver los logs en vivo |
| `docker compose exec <servicio> <comando>` | Ejecutar un comando dentro de un contenedor |
| `docker compose stop` / `start <servicio>` | Frenar o arrancar sin borrar |
| `docker compose down` | Borrar contenedores y red |
| `docker compose down -v` | Lo mismo, y además los volúmenes |
| `docker compose config` | Validar el YAML y ver la configuración final |

---

## Errores comunes

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| `Cannot connect to the Docker daemon` / `error during connect` | Docker Desktop no está abierto | Abrilo y esperá a que diga *Engine running* |
| `port is already allocated` / `address already in use` | Otro programa ya usa el puerto 3000, 3001 o 8080 | Cambiá el puerto **del host** (el de la izquierda), por ejemplo `"3002:3000"` |
| En Windows, Docker Desktop no arranca o pide WSL | Falta WSL 2 o la virtualización está apagada | `wsl --install` en PowerShell como administrador y reiniciar; si sigue, activar la virtualización en la BIOS |
| `docker-compose: command not found` | Estás usando la sintaxis vieja (v1) | Usá `docker compose` (con espacio) |
| Cambié el código de la API y no se ve el cambio | La imagen no se reconstruyó | `docker compose up -d --build` |
| Cambié `init.sql` y no se aplica | Solo corre cuando el volumen está vacío | `docker compose down -v` y volver a levantar |
| Swagger UI muestra `Failed to fetch` | La API está caída, el puerto no coincide con `servers` o hay un problema de CORS | `docker compose ps`, revisá el puerto y el `servers` del contrato |
| `api` se reinicia o loguea `ECONNREFUSED` | No llega a la base | Revisá `DB_HOST` y que `db` esté *healthy* |

---

## Preguntas para autoevaluarte

<details>
<summary>1. ¿Por qué <code>db</code> no publica ningún puerto?</summary>

Porque nadie de afuera necesita hablar con la base: solo la usa la API, que está en la misma red de compose y la encuentra como `db:5432`. No publicarla reduce la superficie de ataque. Si quisieras conectarte con un cliente como DBeaver para mirar los datos, podrías agregar `ports: ["5433:5432"]`, pero en producción no se hace.
</details>

<details>
<summary>2. ¿Por qué <code>localhost</code> no funciona dentro del BFF?</summary>

Dentro de un contenedor, `localhost` es **el propio contenedor**. En el BFF no hay nada escuchando en el puerto 3000. Para llegar a otro servicio hay que usar su nombre (`api`), que resuelve el DNS interno de la red de compose. Desde tu navegador, en cambio, `localhost:3000` funciona porque Docker publica ese puerto en tu máquina.
</details>

<details>
<summary>3. ¿Quién llama a la API cuando usás Swagger UI?</summary>

Tu navegador. `swagger-ui` solo sirve la página web (HTML, JS y el `openapi.yaml`). El JavaScript que corre en tu navegador hace el pedido a `http://localhost:3000`, la URL que dice `servers` en el contrato. Por eso `swagger-ui` no necesita estar en la red `backend`, y por eso la API tiene que habilitar CORS: la página viene de `localhost:8080` y llama a `localhost:3000`, que es otro origen.
</details>

<details>
<summary>4. ¿Volumen con nombre o bind mount?</summary>

`pgdata:/var/lib/postgresql/data` es un **volumen con nombre**: lo administra Docker y sobrevive a los contenedores (solo se borra con `down -v`). `./db/init.sql:...` y `./openapi.yaml:...` son **bind mounts**: montan un archivo de tu máquina dentro del contenedor, así que si lo editás el contenedor ve el cambio al instante. `init.sql` corre solo cuando Postgres arranca con el directorio de datos vacío, o sea con el volumen recién creado.
</details>

<details>
<summary>5. Cambié el puerto a 3100: ¿por qué Swagger dejó de andar y el BFF no?</summary>

`"3100:3000"` cambia solo el puerto **del host**. Dentro de la red, la API sigue escuchando en el 3000, así que el BFF (que usa `http://api:3000`) no se entera. Swagger sí falla, porque tu navegador va por afuera y el contrato sigue diciendo `localhost:3000`. Moraleja: el contrato también documenta dónde vive la API, y eso cambia según el entorno (local, testing, producción).
</details>

<details>
<summary>6. ¿Para qué está el <code>healthcheck</code> en <code>db</code>?</summary>

`depends_on` solo garantiza el **orden de arranque**, no que el servicio esté listo. Postgres tarda unos segundos en aceptar conexiones después de arrancar. Con `condition: service_healthy`, compose espera a que `pg_isready` responda bien antes de arrancar la API.
</details>

---

## Llevalo a tu TP

El avance sugerido para el **22/10** pide *contrato OpenAPI* y *compose levantando todos los contenedores, aunque todavía no hagan nada*. Este repo es exactamente ese esqueleto:

- [ ] Un servicio por cada contenedor de su **C4 de Contenedores** (aunque por ahora sea un "hola mundo").
- [ ] Su `openapi.yaml` con los endpoints del caso de uso, y un servicio `swagger-ui` que lo muestre.
- [ ] La base de datos **sin puerto publicado**, con volumen con nombre y `healthcheck`.
- [ ] Los servicios se hablan **por nombre de servicio**, nunca por `localhost` ni por IP.
- [ ] La configuración por **variables de entorno**. Las contraseñas, en un `.env` que **no** se sube al repo (agregalo al `.gitignore`).
- [ ] Un `README` que diga cómo levantarlo: `docker compose up -d --build`.

La semana que viene (Clase 11) le sumamos a este mismo compose un **proveedor de identidad OIDC (Keycloak)** para tener login. Fijate que, si pasás el `openapi.yaml` por un linter, una de las advertencias es que las operaciones no declaran `security`: lo resolvemos ahí.
