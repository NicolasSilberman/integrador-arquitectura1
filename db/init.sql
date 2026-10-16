-- Corre automáticamente solo la PRIMERA vez que se crea el volumen pgdata.
CREATE TABLE IF NOT EXISTS cursos (
  id          SERIAL PRIMARY KEY,
  nombre      TEXT        NOT NULL,
  cupo        INTEGER     NOT NULL CHECK (cupo > 0),
  docente     TEXT,
  descripcion TEXT,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO cursos (nombre, cupo, docente, descripcion) VALUES
  ('Arquitectura de Software 1', 40, 'Equipo docente', 'Estilos, decisiones y atributos de calidad'),
  ('Bases de Datos',             35, 'Equipo docente', 'Modelo relacional y SQL'),
  ('Redes de Computadoras',      30, 'Equipo docente', 'Protocolos, capas y servicios de red');
