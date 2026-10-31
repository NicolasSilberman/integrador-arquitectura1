-- Esquema de la base del sistema de expensas.
-- Corre automáticamente solo la PRIMERA vez que se crea el volumen pgdata (para volver a correrlo:
-- docker compose down -v && docker compose up -d --build).
--
-- Una sola base (ADR-002), con las tablas separadas por módulo. Cada módulo es el único que lee y
-- escribe sus tablas (propiedad de los datos). Por eso las claves foráneas solo existen DENTRO de un
-- módulo: las referencias a tablas de otro módulo son ids que valida el módulo dueño.
--
-- Los importes se guardan en centavos (BIGINT), nunca con decimales.
-- Los totales no se guardan: se calculan sumando conceptos o gastos.

-- ===========================================================================
-- Módulo PADRÓN: consorcios, unidades funcionales y propietarios
-- ===========================================================================
CREATE TABLE consorcios (
  id         SERIAL PRIMARY KEY,
  nombre     TEXT NOT NULL,
  direccion  TEXT NOT NULL
);

CREATE TABLE unidades (
  id                   SERIAL PRIMARY KEY,
  consorcio_id         INTEGER NOT NULL REFERENCES consorcios(id),
  codigo               TEXT NOT NULL,                       -- "1A", "2B"...
  propietario_usuario  TEXT,                                -- usuario del proveedor de identidad (29/10)
  porcentual           NUMERIC(6,3) NOT NULL CHECK (porcentual > 0 AND porcentual <= 100),
  UNIQUE (consorcio_id, codigo)
);

-- ===========================================================================
-- Módulo LIQUIDACIÓN: liquidaciones, gastos, expensas y sus conceptos
-- ===========================================================================
CREATE TABLE liquidaciones (
  id            SERIAL PRIMARY KEY,
  consorcio_id  INTEGER NOT NULL,                           -- referencia al Padrón
  periodo       TEXT NOT NULL CHECK (periodo ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  estado        TEXT NOT NULL DEFAULT 'BORRADOR' CHECK (estado IN ('BORRADOR', 'EMITIDA')),
  UNIQUE (consorcio_id, periodo)                            -- una liquidación por consorcio y mes
);

CREATE TABLE gastos (
  id              SERIAL PRIMARY KEY,
  liquidacion_id  INTEGER NOT NULL REFERENCES liquidaciones(id),
  rubro           TEXT NOT NULL,
  descripcion     TEXT NOT NULL,
  monto_centavos  BIGINT NOT NULL CHECK (monto_centavos > 0)
);

CREATE TABLE expensas (
  id              SERIAL PRIMARY KEY,
  liquidacion_id  INTEGER NOT NULL REFERENCES liquidaciones(id),
  unidad_id       INTEGER NOT NULL,                         -- referencia al Padrón
  periodo         TEXT NOT NULL CHECK (periodo ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  vencimiento     DATE NOT NULL,
  estado          TEXT NOT NULL DEFAULT 'EMITIDA' CHECK (estado IN ('EMITIDA', 'PAGADA')),
  codigo_pago     TEXT UNIQUE,                              -- se genera cuando el propietario lo pide
  UNIQUE (unidad_id, periodo)                               -- una expensa por unidad y mes
);

CREATE TABLE expensa_conceptos (
  id              SERIAL PRIMARY KEY,
  expensa_id      INTEGER NOT NULL REFERENCES expensas(id),
  tipo            TEXT NOT NULL CHECK (tipo IN ('ORDINARIA', 'EXTRAORDINARIA', 'FONDO_RESERVA')),
  descripcion     TEXT NOT NULL,
  monto_centavos  BIGINT NOT NULL CHECK (monto_centavos > 0)
);

-- ===========================================================================
-- Módulo COBRANZAS: corridas de conciliación y cobranzas informadas por el banco
-- ===========================================================================
CREATE TABLE conciliaciones (
  id               SERIAL PRIMARY KEY,
  fecha_cobranzas  DATE NOT NULL,
  origen           TEXT NOT NULL CHECK (origen IN ('AUTOMATICA', 'MANUAL')),
  estado           TEXT NOT NULL CHECK (estado IN ('EN_CURSO', 'OK', 'ERROR')),
  leidas           INTEGER NOT NULL DEFAULT 0,
  imputadas        INTEGER NOT NULL DEFAULT 0,
  observadas       INTEGER NOT NULL DEFAULT 0,
  ya_procesadas    INTEGER NOT NULL DEFAULT 0,
  error            TEXT,
  iniciada_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
  finalizada_en    TIMESTAMPTZ
);

CREATE TABLE cobranzas (
  id               SERIAL PRIMARY KEY,
  banco_ref        TEXT NOT NULL UNIQUE,                    -- cada operación del banco se procesa UNA sola vez
  conciliacion_id  INTEGER NOT NULL REFERENCES conciliaciones(id),
  codigo_pago      TEXT NOT NULL,
  monto_centavos   BIGINT NOT NULL CHECK (monto_centavos > 0),
  fecha_pago       DATE NOT NULL,
  estado           TEXT NOT NULL CHECK (estado IN ('IMPUTADA', 'OBSERVADA')),
  motivo           TEXT CHECK (motivo IN ('CODIGO_DESCONOCIDO', 'PAGO_DUPLICADO', 'MONTO_DISTINTO')),
  expensa_id       INTEGER,                                 -- referencia a Liquidación
  procesada_en     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (estado <> 'IMPUTADA'  OR (expensa_id IS NOT NULL AND motivo IS NULL)),
  CHECK (estado <> 'OBSERVADA' OR motivo IS NOT NULL)
);

-- Nunca se cobra dos veces la misma expensa: a lo sumo UNA cobranza imputada por expensa.
-- Lo garantiza la base, aunque el código tuviera un error.
CREATE UNIQUE INDEX una_imputacion_por_expensa ON cobranzas (expensa_id) WHERE estado = 'IMPUTADA';

-- ===========================================================================
-- Datos de ejemplo: 6 consorcios con 25 unidades cada uno (150 unidades, la escala del escenario)
-- ===========================================================================
INSERT INTO consorcios (nombre, direccion) VALUES
  ('Edificio Av. Vergara 1200',  'Av. Vergara 1200, Hurlingham'),
  ('Torre Pedro Díaz 450',       'Pedro Díaz 450, Hurlingham'),
  ('Edificio Jauretche 870',     'Jauretche 870, Hurlingham'),
  ('Edificio Roca 2300',         'Av. Roca 2300, Hurlingham'),
  ('Edificio Tate 155',          'Tate 155, Hurlingham'),
  ('Edificio Santa Rosa 990',    'Santa Rosa 990, Hurlingham');

-- 25 unidades por consorcio (pisos 1 a 5, departamentos A a E), cada una con el 4 % de los gastos
INSERT INTO unidades (consorcio_id, codigo, porcentual)
SELECT c.id, piso || depto, 4.000
FROM consorcios c
CROSS JOIN generate_series(1, 5) AS piso
CROSS JOIN unnest(ARRAY['A', 'B', 'C', 'D', 'E']) AS depto;

-- Algunos propietarios con usuario (se usan cuando haya login, el 29/10)
UPDATE unidades SET propietario_usuario = 'paula' WHERE (consorcio_id, codigo) IN ((1, '2B'), (3, '1A'));
UPDATE unidades SET propietario_usuario = 'pablo' WHERE (consorcio_id, codigo) = (2, '4C');

-- Liquidación de octubre 2026 de cada consorcio, con sus gastos
INSERT INTO liquidaciones (consorcio_id, periodo, estado)
SELECT id, '2026-10', 'EMITIDA' FROM consorcios;

INSERT INTO gastos (liquidacion_id, rubro, descripcion, monto_centavos)
SELECT l.id, g.rubro, g.descripcion, g.monto + l.consorcio_id * 1000007   -- montos distintos por consorcio
FROM liquidaciones l
CROSS JOIN (VALUES
  ('Sueldos y cargas sociales', 'Encargado del edificio', 60000000),
  ('Servicios públicos',        'Luz y agua de espacios comunes', 18000000),
  ('Mantenimiento',             'Abono de ascensores y limpieza', 32000000)
) AS g(rubro, descripcion, monto);

-- Emisión: una expensa por unidad, con vencimiento el 10 del mes siguiente
INSERT INTO expensas (liquidacion_id, unidad_id, periodo, vencimiento)
SELECT l.id, u.id, l.periodo, DATE '2026-11-10'
FROM liquidaciones l
JOIN unidades u ON u.consorcio_id = l.consorcio_id;

-- Prorrateo: cada unidad paga su porcentual del total de gastos, en centavos enteros.
-- Los centavos que sobran por redondeo se reparten de a uno entre las primeras unidades,
-- así la suma de las expensas es EXACTAMENTE el total liquidado.
WITH totales AS (
  SELECT liquidacion_id, SUM(monto_centavos) AS total FROM gastos GROUP BY liquidacion_id
),
base AS (
  SELECT e.id AS expensa_id, e.liquidacion_id, t.total,
         FLOOR(t.total * u.porcentual / 100)::BIGINT AS monto,
         ROW_NUMBER() OVER (PARTITION BY e.liquidacion_id ORDER BY u.id) AS orden
  FROM expensas e
  JOIN unidades u ON u.id = e.unidad_id
  JOIN totales t ON t.liquidacion_id = e.liquidacion_id
),
sobrante AS (
  SELECT liquidacion_id, MAX(total) - SUM(monto) AS centavos FROM base GROUP BY liquidacion_id
)
INSERT INTO expensa_conceptos (expensa_id, tipo, descripcion, monto_centavos)
SELECT b.expensa_id, 'ORDINARIA', 'Expensas ordinarias',
       b.monto + CASE WHEN b.orden <= s.centavos THEN 1 ELSE 0 END
FROM base b
JOIN sobrante s ON s.liquidacion_id = b.liquidacion_id;

-- Fondo de reserva: un monto fijo por unidad
INSERT INTO expensa_conceptos (expensa_id, tipo, descripcion, monto_centavos)
SELECT id, 'FONDO_RESERVA', 'Fondo de reserva', 500000 FROM expensas;

-- Para verificar que el prorrateo cuadra (debe devolver 0 filas):
--   SELECT g.liquidacion_id FROM (SELECT liquidacion_id, SUM(monto_centavos) t FROM gastos GROUP BY 1) g
--   JOIN (SELECT e.liquidacion_id, SUM(c.monto_centavos) t FROM expensas e
--         JOIN expensa_conceptos c ON c.expensa_id = e.id AND c.tipo = 'ORDINARIA' GROUP BY 1) x
--     ON x.liquidacion_id = g.liquidacion_id WHERE x.t <> g.t;
