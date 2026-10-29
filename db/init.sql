-- Esquema y datos de ejemplo del sistema de expensas (escenario 5A).
-- Corre automáticamente SOLO la primera vez que se crea el volumen "pgdata".
-- Cada módulo de la API es dueño exclusivo de sus tablas (ver ADR-001):
--   padron        -> consorcios, unidades
--   liquidaciones -> expensas, expensa_conceptos
--   cobranzas     -> conciliaciones, cobranzas

-- =====================================================================
-- Módulo PADRÓN: edificios, unidades funcionales y quién es su propietario
-- =====================================================================
CREATE TABLE consorcios (
  id        SERIAL PRIMARY KEY,
  nombre    TEXT NOT NULL,
  direccion TEXT NOT NULL
);

CREATE TABLE unidades (
  id                  SERIAL PRIMARY KEY,
  consorcio_id        INTEGER NOT NULL REFERENCES consorcios(id),
  codigo              TEXT    NOT NULL,          -- piso y departamento, ej. "3B"
  propietario_usuario TEXT    NOT NULL,          -- username del propietario en el proveedor de identidad (Keycloak)
  propietario_nombre  TEXT    NOT NULL,
  UNIQUE (consorcio_id, codigo)
);
CREATE INDEX unidades_por_propietario ON unidades (propietario_usuario);

-- =====================================================================
-- Módulo LIQUIDACIONES: la expensa mensual de cada unidad
-- El total NO se guarda: siempre es la suma de sus conceptos.
-- Así el invariante "total = suma de conceptos" se cumple por construcción.
-- =====================================================================
CREATE TABLE expensas (
  id          SERIAL PRIMARY KEY,
  unidad_id   INTEGER NOT NULL REFERENCES unidades(id),
  periodo     TEXT    NOT NULL CHECK (periodo ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),   -- "2026-10"
  vencimiento DATE    NOT NULL,
  estado      TEXT    NOT NULL DEFAULT 'EMITIDA' CHECK (estado IN ('EMITIDA', 'PAGADA')),
  codigo_pago TEXT    UNIQUE,                                                    -- se genera a pedido del propietario
  UNIQUE (unidad_id, periodo)                                                    -- una sola expensa por unidad y período
);

CREATE TABLE expensa_conceptos (
  id             SERIAL PRIMARY KEY,
  expensa_id     INTEGER NOT NULL REFERENCES expensas(id) ON DELETE CASCADE,
  descripcion    TEXT    NOT NULL,
  monto_centavos BIGINT  NOT NULL CHECK (monto_centavos > 0)    -- dinero siempre en centavos enteros, nunca en decimales
);
CREATE INDEX conceptos_por_expensa ON expensa_conceptos (expensa_id);

-- =====================================================================
-- Módulo COBRANZAS: lo que informa el banco y cómo se imputó
-- =====================================================================
CREATE TABLE conciliaciones (
  id              SERIAL PRIMARY KEY,
  fecha_cobranzas DATE    NOT NULL,                                       -- día de cobranzas que se descargó del banco
  origen          TEXT    NOT NULL CHECK (origen IN ('AUTOMATICA', 'MANUAL')),
  solicitada_por  TEXT,
  estado          TEXT    NOT NULL CHECK (estado IN ('EN_CURSO', 'OK', 'ERROR')),
  leidas          INTEGER NOT NULL DEFAULT 0,
  imputadas       INTEGER NOT NULL DEFAULT 0,
  observadas      INTEGER NOT NULL DEFAULT 0,
  ya_procesadas   INTEGER NOT NULL DEFAULT 0,
  error           TEXT,
  iniciada_en     TIMESTAMPTZ NOT NULL DEFAULT now(),
  finalizada_en   TIMESTAMPTZ
);
CREATE INDEX conciliaciones_por_fecha ON conciliaciones (fecha_cobranzas, estado);

CREATE TABLE cobranzas (
  id              SERIAL PRIMARY KEY,
  banco_ref       TEXT    NOT NULL UNIQUE,      -- id de la operación en el banco: una cobranza se procesa UNA sola vez
  conciliacion_id INTEGER NOT NULL REFERENCES conciliaciones(id),
  codigo_pago     TEXT    NOT NULL,
  monto_centavos  BIGINT  NOT NULL,
  fecha_pago      DATE    NOT NULL,
  estado          TEXT    NOT NULL CHECK (estado IN ('PROCESANDO', 'IMPUTADA', 'OBSERVADA')),
  motivo          TEXT,                         -- si quedó observada: CODIGO_DESCONOCIDO | PAGO_DUPLICADO | MONTO_DISTINTO
  expensa_id      INTEGER REFERENCES expensas(id),
  procesada_en    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (estado <> 'IMPUTADA'  OR expensa_id IS NOT NULL),
  CHECK (estado <> 'OBSERVADA' OR motivo IS NOT NULL)
);
-- "Nunca se cobra dos veces la misma expensa": a lo sumo UNA cobranza imputada por expensa.
-- La garantía vive en la base, no solo en el código.
CREATE UNIQUE INDEX una_imputacion_por_expensa ON cobranzas (expensa_id) WHERE estado = 'IMPUTADA';
CREATE INDEX cobranzas_por_estado ON cobranzas (estado);

-- =====================================================================
-- DATOS DE EJEMPLO: 6 edificios x 25 unidades = 150 unidades
-- =====================================================================
INSERT INTO consorcios (nombre, direccion) VALUES
  ('Edificio Alvear',    'Av. Alvear 1450'),
  ('Edificio Belgrano',  'Belgrano 820'),
  ('Edificio Cervantes', 'Cervantes 233'),
  ('Edificio Dorrego',   'Dorrego 1990'),
  ('Edificio Esmeralda', 'Esmeralda 77'),
  ('Edificio Funes',     'Funes 3105');

INSERT INTO unidades (consorcio_id, codigo, propietario_usuario, propietario_nombre)
SELECT c.id,
       p.piso || d.letra,
       'sin-cuenta-' || c.id || '-' || p.piso || d.letra,     -- propietarios que todavía no tienen usuario en el sistema
       'Propietario ' || c.id || '-' || p.piso || d.letra
FROM consorcios c
CROSS JOIN generate_series(1, 5) AS p(piso)
CROSS JOIN (VALUES ('A'), ('B'), ('C'), ('D'), ('E')) AS d(letra);

-- Propietarios con usuario de prueba (ver keycloak/realm-expensas.json)
UPDATE unidades SET propietario_usuario = 'paula', propietario_nombre = 'Paula Gómez' WHERE (consorcio_id, codigo) IN ((1, '1A'), (3, '2B'));
UPDATE unidades SET propietario_usuario = 'pablo', propietario_nombre = 'Pablo Ríos'  WHERE (consorcio_id, codigo) = (2, '4C');

-- Liquidación de octubre 2026 para todas las unidades
INSERT INTO expensas (unidad_id, periodo, vencimiento)
SELECT id, '2026-10', DATE '2026-11-10' FROM unidades;

INSERT INTO expensa_conceptos (expensa_id, descripcion, monto_centavos)
SELECT e.id, 'Expensas ordinarias', 4500000 + (u.id % 5) * 300000          -- $45.000 a $57.000
FROM expensas e JOIN unidades u ON u.id = e.unidad_id;

INSERT INTO expensa_conceptos (expensa_id, descripcion, monto_centavos)
SELECT e.id, 'Fondo de reserva', 450000 + (u.id % 5) * 30000
FROM expensas e JOIN unidades u ON u.id = e.unidad_id;

INSERT INTO expensa_conceptos (expensa_id, descripcion, monto_centavos)
SELECT e.id, 'Reparación de ascensor (cuota 3 de 6)', 1200000
FROM expensas e JOIN unidades u ON u.id = e.unidad_id
WHERE u.consorcio_id = 2;
