# Verificación manual de los NFRs

Guía de pruebas manuales sobre el sistema levantado con `docker compose`. Cada prueba indica qué NFR verifica, los pasos, el resultado esperado y el obtenido. Las capturas están en [`verificacion/`](verificacion/), con el número de la prueba al principio del nombre (por ejemplo `01-pago-exacto.png`).

## Resumen

| # | NFR | Prueba | Responsable | Resultado |
|---|---|---|---|---|
| 1 | ★1 Consistencia | Pago con el monto exacto: la expensa queda pagada | Nicolás | |
| 2 | ★1 Consistencia | Reprocesar el mismo día no duplica nada | Nicolás | |
| 3 | ★1 Consistencia | Monto distinto: la cobranza queda observada | Nicolás | |
| 4 | ★1 Consistencia | Código inexistente: la cobranza queda observada | Nicolás | |
| 5 | ★1 Consistencia | Dos pagos de la misma expensa: el segundo queda observado | Nicolás | |
| 6 | ★1 Consistencia | Varias conciliaciones al mismo tiempo | Nicolás | |
| 7 | ★1b Liquidación cuadra | El total de la expensa es la suma de sus conceptos | Nicolás | |
| 8 | 3 Recuperación sin guardia | Banco caído en una conciliación manual, y reintento | Nicolás | |
| 9 | 3 Recuperación sin guardia | La conciliación automática imputa sola | Fernando | |
| 10 | 3 Recuperación sin guardia | La conciliación automática reintenta sola si el banco falla | Fernando | |
| 11 | 3 Recuperación sin guardia | Después de días sin conciliar, se pone al día sola | Fernando | |
| 12 | 4 Seguridad | Pedido sin token | Fernando | |
| 13 | 4 Seguridad | Token adulterado | Fernando | |
| 14 | 4 Seguridad | Un propietario intenta conciliar | Fernando | |
| 15 | 4 Seguridad | Un propietario pide una expensa ajena | Fernando | |
| 16 | 4 Seguridad | Un cliente intenta hacerse pasar por otro usuario | Fernando | |
| 17 | 4 Seguridad | La API no se alcanza directo y su usuario de base no puede borrar | Fernando | |
| 18 | ★2 Simplicidad · 5 Costo | Cantidad de contenedores y consumo de memoria | Fernando | |

## Preparación

| Qué | Dónde |
|---|---|
| Swagger UI (para llamar a la API) | http://localhost:8080 |
| Gateway (para las pruebas con `curl.exe`) | http://localhost:8000 |
| Consola del banco simulado (cargar pagos y simular caídas) | http://localhost:8090 |

**Usuarios:** `paula` / `paula123` y `pablo` / `pablo123` (propietarios), `adriana` / `adriana123` (administradora).

**Datos usados:**

| Expensa | Propietario | Código de pago | Total |
|---|---|---|---|
| 1 (consorcio 1, 2B) | paula | `00000000018` | $50.020,01 (`5020001` centavos) |
| 51 (consorcio 3, 1A) | paula | `00000000513` | según `GET /v1/expensas/51` |
| 26 (consorcio 2, 4C) | pablo | `00000000265` | — |

**Importes:** la API informa los montos en centavos; la consola del banco los pide en pesos con coma (`5020001` centavos → `50020,01`).

**Token para `curl.exe`:** en Swagger, después de *Authorize* y de ejecutar cualquier pedido, el comando *Curl* que muestra Swagger trae `Authorization: Bearer <token>`. Se copia el token en una variable de PowerShell (dura 5 minutos):

```powershell
$T = "<token>"
```

**Arranque desde cero** (cuando la prueba lo indica): borra la base y los pagos del banco simulado.

```powershell
docker compose down -v
docker compose up -d --build
```

---

## Pruebas 1 a 8 · Consistencia, liquidación y banco caído

Se hacen en orden y sobre el mismo arranque desde cero. Las conciliaciones manuales usan la **fecha de hoy**, para no mezclarse con la conciliación automática, que concilia hasta ayer.

### Prueba 1 · Pago con el monto exacto

**NFR:** ★1 Consistencia

**Pasos:**
1. Arranque desde cero.
2. Como paula: `PUT /v1/expensas/1/codigo-pago`.
3. En la consola del banco: código `00000000018`, importe `50020,01`, fecha de hoy.
4. Como adriana: `POST /v1/conciliaciones` con `{"fecha": "<hoy>"}`.
5. Como paula: `GET /v1/expensas/1`.

**Resultado esperado:** el paso 2 responde 201 con el código `00000000018` (repetirlo responde 200 con el mismo código). La conciliación responde 201 con `leidas: 1`, `imputadas: 1`. La expensa queda `PAGADA` y `pagoImputado` muestra la operación del banco.

**Resultado obtenido:**

**Captura:**

### Prueba 2 · Reprocesar el mismo día

**NFR:** ★1 Consistencia

**Pasos:**
1. Como adriana: repetir `POST /v1/conciliaciones` con la misma fecha.
2. Como adriana: `GET /v1/cobranzas`.

**Resultado esperado:** 201 con `leidas: 1`, `imputadas: 0`, `yaProcesadas: 1`. En `/v1/cobranzas` sigue habiendo una sola cobranza imputada.

**Resultado obtenido:**

**Captura:**

### Prueba 3 · Monto distinto

**NFR:** ★1 Consistencia

**Pasos:**
1. Como paula: `PUT /v1/expensas/51/codigo-pago`.
2. En la consola del banco: código `00000000513`, importe `1000,00`, fecha de hoy.
3. Como adriana: `POST /v1/conciliaciones` con la fecha de hoy.
4. Como adriana: `GET /v1/cobranzas?estado=OBSERVADA`.
5. Como paula: `GET /v1/expensas/51`.

**Resultado esperado:** la corrida da `observadas: 1`, `yaProcesadas: 1`. La cobranza queda `OBSERVADA` con motivo `MONTO_DISTINTO`. La expensa 51 sigue `EMITIDA`.

**Resultado obtenido:**

**Captura:**

### Prueba 4 · Código inexistente

**NFR:** ★1 Consistencia

**Pasos:**
1. En la consola del banco: código `00000000017` (el de la expensa 1 con el último dígito cambiado), importe `50020,01`, fecha de hoy.
2. Como adriana: `POST /v1/conciliaciones` con la fecha de hoy.
3. Como adriana: `GET /v1/cobranzas?estado=OBSERVADA`.

**Resultado esperado:** la corrida da `observadas: 1`, `yaProcesadas: 2`. La nueva cobranza queda `OBSERVADA` con motivo `CODIGO_DESCONOCIDO` y sin expensa asociada.

**Resultado obtenido:**

**Captura:**

### Prueba 5 · Dos pagos de la misma expensa

**NFR:** ★1 Consistencia

**Pasos:**
1. En la consola del banco: otra vez código `00000000018`, importe `50020,01`, fecha de hoy.
2. Como adriana: `POST /v1/conciliaciones` con la fecha de hoy.
3. Como adriana: `GET /v1/cobranzas`.

**Resultado esperado:** la corrida da `observadas: 1`, `yaProcesadas: 3`. La segunda cobranza queda `OBSERVADA` con motivo `PAGO_DUPLICADO`. La expensa 1 sigue con un solo pago imputado.

**Resultado obtenido:**

**Captura:**

### Prueba 6 · Varias conciliaciones al mismo tiempo

**NFR:** ★1 Consistencia

**Pasos:**
1. Con el token de adriana en `$T`, desde la carpeta del repo:

```powershell
'{"fecha":"<hoy>"}' | Out-File -Encoding ascii fecha.json
curl.exe -s --parallel --parallel-immediate -w "  -> HTTP %{http_code}`n" -X POST -H "Authorization: Bearer $T" -H "Content-Type: application/json" -d "@fecha.json" http://localhost:8000/v1/conciliaciones http://localhost:8000/v1/conciliaciones http://localhost:8000/v1/conciliaciones http://localhost:8000/v1/conciliaciones http://localhost:8000/v1/conciliaciones
Remove-Item fecha.json
```

2. Como adriana: `GET /v1/cobranzas`.

**Resultado esperado:** los pedidos que coinciden con otra conciliación en curso reciben 409 (*Conciliación en curso*). Los que corren reciben 201 con `imputadas: 0`. En `/v1/cobranzas` no aparece ninguna cobranza nueva y la expensa 1 sigue con un solo pago imputado.

**Resultado obtenido:**

**Captura:**

### Prueba 7 · El total es la suma de los conceptos

**NFR:** ★1b Liquidación cuadra

**Pasos:**
1. Como paula: `GET /v1/expensas/1`.

**Resultado esperado:** `total.centavos` es igual a la suma de los `monto.centavos` de `conceptos` (4.520.001 + 500.000 = 5.020.001).

**Resultado obtenido:**

**Captura:**

### Prueba 8 · Banco caído en una conciliación manual, y reintento

**NFR:** 3 Recuperación sin guardia

**Pasos:**
1. En la consola del banco: *Simular caída*.
2. Como adriana: `POST /v1/conciliaciones` con la fecha de hoy.
3. Como adriana: `GET /v1/conciliaciones/{id}` con el id que figura en el mensaje de error.
4. En la consola del banco: *Restablecer el servicio*.
5. Como adriana: repetir `POST /v1/conciliaciones` con la fecha de hoy.

**Resultado esperado:** el paso 2 responde 502 *Banco no disponible*, indicando que la corrida quedó registrada con error. En el paso 3 la corrida figura `ERROR` con el motivo. El reintento responde 201 `OK`, sin imputaciones nuevas.

**Resultado obtenido:**

**Captura:**

---

## Pruebas 9 a 11 · Conciliación automática

La conciliación automática corre dentro de la API desde la hora `CONCILIACION_HORA` (07:00 por defecto) y concilia hasta ayer. Para probarla sin esperar se cambian sus variables desde PowerShell; al terminar se restablecen:

```powershell
Remove-Item Env:CONCILIACION_AUTOMATICA, Env:CONCILIACION_HORA, Env:CONCILIACION_REINTENTO_MIN -ErrorAction SilentlyContinue
docker compose up -d api
```

### Prueba 9 · La conciliación automática imputa sola

**NFR:** 3 Recuperación sin guardia

**Pasos:**
1. Arranque desde cero con la automática apagada:
   ```powershell
   docker compose down -v
   $env:CONCILIACION_AUTOMATICA="false"; docker compose up -d --build
   ```
2. Como paula: `PUT /v1/expensas/1/codigo-pago`.
3. En la consola del banco: código `00000000018`, importe `50020,01`, **fecha de ayer**.
4. Encender la automática con una hora ya pasada:
   ```powershell
   $env:CONCILIACION_AUTOMATICA="true"; $env:CONCILIACION_HORA="00:00"; docker compose up -d api
   docker compose logs api
   ```
5. Como adriana: `GET /v1/conciliaciones/1`. Como paula: `GET /v1/expensas/1`.

**Resultado esperado:** el log muestra `[conciliación automática] <ayer>: corrida 1 OK (1 imputadas, 0 observadas)`. La corrida tiene `origen: AUTOMATICA` y la expensa queda `PAGADA`.

**Resultado obtenido:**

**Captura:**

### Prueba 10 · La conciliación automática reintenta sola si el banco falla

**NFR:** 3 Recuperación sin guardia

**Pasos:**
1. Repetir los pasos 1 a 3 de la prueba 9.
2. En la consola del banco: *Simular caída*.
3. Encender la automática con reintento cada 1 minuto:
   ```powershell
   $env:CONCILIACION_AUTOMATICA="true"; $env:CONCILIACION_HORA="00:00"; $env:CONCILIACION_REINTENTO_MIN="1"; docker compose up -d api
   docker compose logs api
   ```
4. En la consola del banco: *Restablecer el servicio*.
5. Esperar 2 minutos y volver a mirar `docker compose logs api`.

**Resultado esperado:** primero el log muestra el error del banco y `Se reintenta en 1 minutos`. Después de restablecer el banco, sin intervención, aparece `corrida 2 OK (1 imputadas, 0 observadas)`. La corrida 1 queda `ERROR` y la 2 `OK`, ambas con `origen: AUTOMATICA`.

**Resultado obtenido:**

**Captura:**

### Prueba 11 · Después de días sin conciliar, se pone al día sola

**NFR:** 3 Recuperación sin guardia

**Pasos:**
1. Arranque desde cero con la automática apagada (paso 1 de la prueba 9).
2. Como adriana: `POST /v1/conciliaciones` con la fecha de **hace 4 días** (se obtiene con `(Get-Date).AddDays(-4).ToString('yyyy-MM-dd')`). Simula que la última conciliación fue ese día.
3. Encender la automática con una hora ya pasada (paso 4 de la prueba 9) y mirar `docker compose logs api`.

**Resultado esperado:** la automática concilia los 3 días que faltan, del más viejo a ayer, en ese orden: `corrida 2 OK`, `corrida 3 OK`, `corrida 4 OK`.

**Resultado obtenido:**

**Captura:**

---

## Pruebas 12 a 18 · Seguridad, simplicidad y costo

### Prueba 12 · Pedido sin token

**NFR:** 4 Seguridad

**Pasos:**

```powershell
curl.exe -i http://localhost:8000/v1/expensas
```

**Resultado esperado:** 401, con el detalle del error en formato Problem Details.

**Resultado obtenido:**

**Captura:**

### Prueba 13 · Token adulterado

**NFR:** 4 Seguridad

**Pasos:** con el token de paula en `$T`, se cambian los últimos caracteres (la firma):

```powershell
$T2 = $T.Substring(0, $T.Length - 4) + "AAAA"
curl.exe -i -H "Authorization: Bearer $T2" http://localhost:8000/v1/expensas
curl.exe -i -H "Authorization: Bearer $T" http://localhost:8000/v1/expensas
```

**Resultado esperado:** con el token adulterado, 401. Con el original, 200.

**Resultado obtenido:**

**Captura:**

### Prueba 14 · Un propietario intenta conciliar

**NFR:** 4 Seguridad

**Pasos:**
1. Como paula: `POST /v1/conciliaciones` con la fecha de hoy.

**Resultado esperado:** 403. El pedido lo frena el gateway y no llega a la API.

**Resultado obtenido:**

**Captura:**

### Prueba 15 · Un propietario pide una expensa ajena

**NFR:** 4 Seguridad

**Pasos:**
1. Como paula: `GET /v1/expensas/26` (es de pablo) y `PUT /v1/expensas/26/codigo-pago`.
2. Como paula: `GET /v1/expensas/1` (es suya).

**Resultado esperado:** 403 en los pedidos sobre la expensa 26; 200 en la expensa 1. Esta regla la aplica la API, porque depende de quién es el propietario de cada unidad.

**Resultado obtenido:**

**Captura:**

### Prueba 16 · Un cliente intenta hacerse pasar por otro usuario

**NFR:** 4 Seguridad

**Pasos:** con el token de pablo en `$T`, se pide la expensa de paula mandando además los headers de identidad:

```powershell
curl.exe -i -H "Authorization: Bearer $T" -H "X-Usuario: paula" -H "X-Roles: administrador" http://localhost:8000/v1/expensas/1
```

**Resultado esperado:** 403. El gateway descarta los `X-Usuario` y `X-Roles` que manda el cliente y pone los del token (pablo).

**Resultado obtenido:**

**Captura:**

### Prueba 17 · La API no se alcanza directo y su usuario de base no puede borrar

**NFR:** 4 Seguridad

**Pasos:**

```powershell
curl.exe http://localhost:3000/health
docker compose exec db psql -U api_expensas -d expensas -c "DELETE FROM cobranzas;"
docker compose exec db psql -U api_expensas -d expensas -c "SELECT count(*) FROM cobranzas;"
```

**Resultado esperado:** el primer comando no puede conectarse (la API no publica su puerto). El `DELETE` falla con `permission denied for table cobranzas`. El `SELECT` funciona.

**Resultado obtenido:**

**Captura:**

### Prueba 18 · Cantidad de contenedores y consumo de memoria

**NFR:** ★2 Simplicidad · 5 Costo

**Pasos:**

```powershell
docker compose ps
docker stats --no-stream
```

**Resultado esperado:** 6 contenedores en ejecución (db, api, gateway, keycloak, banco-mock, swagger-ui). Se anota la memoria de cada uno y el total.

**Resultado obtenido:**

**Captura:**
