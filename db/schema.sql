-- Esquema de PostgreSQL para COIPO_NEXE (visor táctico de flota aérea CONAF).
--
-- Fuente ÚNICA de verdad del DDL: lo ejecutan tal cual, de forma idempotente
-- (CREATE ... IF NOT EXISTS), tanto el backend (backend/app/db/bootstrap.py) como el
-- collector (collector/ingesta.py, que importa el mismo módulo). No agregar
-- Base.metadata.create_all() en backend/app/db/models.py — ese archivo es solo de
-- consulta; este .sql es la única autoridad de esquema. Ninguno de los dos crea la
-- base ni el rol: existen ya en el servidor compartido 172.31.2.40, administrado
-- aparte (ver .env.example).
--
-- Candado de arranque: ambos lados envuelven la ejecución en
--   SELECT pg_advisory_lock(729154033); ... SELECT pg_advisory_unlock(729154033);
-- porque backend y collector arrancan a la vez y crearían las tablas en paralelo.
-- La constante es arbitraria y propia de esta app; debe coincidir con
-- backend/app/db/bootstrap.py::CANDADO_ESQUEMA.
--
-- Convenciones de tiempo: TODO en TIMESTAMPTZ y almacenado en UTC (CLAUDE.md §14.9);
-- la conversión a hora de Chile es exclusivamente de presentación.


-- ─────────────────────────────────────────────────────────────────────────────
-- posicion — toda la telemetría histórica, una fila por reporte GPS.
--
-- La PK natural (esn, pos_time) convierte en restricción de la base el dedupe que
-- CLAUDE.md §8.3 exigía en el cliente: el solapamiento de rangos y los históricos
-- rezagados producen duplicados esperables, y el INSERT ... ON CONFLICT DO NOTHING
-- del collector los descarta sin costo.
--
-- Los nombres de columna son en español (convención del proyecto), pero se conserva
-- el valor CRUDO de Nexe: `velocidad` guarda el `spd` tal como llega, sin convertir
-- (su unidad sigue PENDIENTE de confirmación — CLAUDE.md §2). Convertir en la
-- ingesta obligaría a remigrar la tabla completa el día que Nexe aclare la unidad.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS posicion (
  esn             TEXT             NOT NULL,
  pos_time        TIMESTAMPTZ      NOT NULL,          -- hora del reporte GPS
  data_ctr_time   TIMESTAMPTZ      NOT NULL,          -- llegada al servidor Nexe (cursor, §7.4)
  latitud         DOUBLE PRECISION NOT NULL,          -- geometry.coordinates[1]
  longitud        DOUBLE PRECISION NOT NULL,          -- geometry.coordinates[0]
  altitud         DOUBLE PRECISION,                   -- aún no observada en datos reales (§2)
  velocidad       DOUBLE PRECISION,                   -- `spd` crudo, unidad PENDIENTE (§2)
  rumbo           SMALLINT,                           -- `cog`, 0–359 desde el norte verdadero
  fix_type        TEXT,                               -- `fix`: 3D/2D = config. de la baliza
  src             TEXT,                               -- fuente de la posición ("GPS")
  pdop            DOUBLE PRECISION,
  hdop            DOUBLE PRECISION,
  unit_id         TEXT,
  hg_ext_name     TEXT,                               -- único hg* que /get también trae
  ingerido_en     TIMESTAMPTZ      NOT NULL DEFAULT now(),
  PRIMARY KEY (esn, pos_time)
);

-- Cursor de la ingesta y el "incremental" del visor: ambos filtran por data_ctr_time.
CREATE INDEX IF NOT EXISTS idx_posicion_data_ctr ON posicion (data_ctr_time);
-- Consulta histórica por rango libre (CLAUDE.md §11 Fase 2-7).
CREATE INDEX IF NOT EXISTS idx_posicion_pos_time ON posicion (pos_time DESC);
-- Trazas de un recurso, y el DISTINCT ON que resuelve "última posición por ESN".
CREATE INDEX IF NOT EXISTS idx_posicion_esn_pos_time ON posicion (esn, pos_time DESC);


-- ─────────────────────────────────────────────────────────────────────────────
-- recurso — catálogo por ESN: SOLO metadatos, ninguna posición.
--
-- Los campos hg* (patente, modelo, familia, navstate) llegan EXCLUSIVAMENTE por
-- get_lastpositions (CLAUDE.md §7.3); /get solo trae hg_ext_name. El collector los
-- refresca con ON CONFLICT DO UPDATE usando COALESCE(EXCLUDED.x, recurso.x): un
-- campo que deje de venir no borra el último valor conocido.
--
-- Decisión: la última posición de cada recurso NO se denormaliza aquí. Se resuelve
-- con DISTINCT ON sobre `posicion` (índice idx_posicion_esn_pos_time), que con ~11
-- recursos es inmediato. Denormalizarla obligaría a mantener lat/lon/pos_time
-- consistentes entre dos caminos de escritura (/get y get_lastpositions, que pueden
-- traer posiciones de distinta antigüedad) — una fuente de bugs sin beneficio real.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS recurso (
  esn                 TEXT PRIMARY KEY,
  unit_id             TEXT,
  hg_ext_name         TEXT,          -- alias: la etiqueta por defecto del recurso
  hg_alias            TEXT,
  hg_asset            TEXT,          -- patente/matrícula
  hg_asset_model      TEXT,
  hg_asset_family     TEXT,          -- familia legible ("Ala rotatoria", "Furgonetas")
  hg_family_type      TEXT,          -- familia canónica: people/ground/rotary/fixed
  hg_company          TEXT,
  hg_source           TEXT,          -- proveedor de la baliza
  hg_navstate         SMALLINT,      -- 2 parado · 4 emitiendo en tierra · 5 en ruta
  visto_primera_vez_en TIMESTAMPTZ NOT NULL DEFAULT now(),  -- solo en el INSERT
  actualizado_en      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Filtro por familia del endpoint /api/recursos (el `domain` de Nexe devuelve 500).
CREATE INDEX IF NOT EXISTS idx_recurso_familia ON recurso (hg_family_type);


-- ─────────────────────────────────────────────────────────────────────────────
-- estado_ingesta — cursor persistido y salud del collector. Fila única.
--
-- Es la pieza que hace posible el historial propio: el cursor dataCtrTime vivía en
-- un useRef del navegador y se perdía en cada F5. Persistido, el collector reanuda
-- exactamente donde quedó tras un reinicio o un deploy, y NUNCA retrocede (el
-- UPDATE compara con el valor actual — ver collector/ingesta.py).
--
-- Los contadores de fallo permiten que /api/estado-ingesta distinga "la flota está
-- quieta" de "la ingesta está caída" — hoy indistinguible desde la UI.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS estado_ingesta (
  id                        SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  cursor_data_ctr_time      TIMESTAMPTZ,                 -- NULL = nunca se ingirió nada
  ultima_corrida_en         TIMESTAMPTZ,
  ultima_corrida_ok_en      TIMESTAMPTZ,
  posiciones_ultima_corrida INTEGER NOT NULL DEFAULT 0,
  fallos_consecutivos       INTEGER NOT NULL DEFAULT 0,
  ultimo_error_en           TIMESTAMPTZ,
  ultimo_error_clase        TEXT,                        -- clase de la excepción, nunca el mensaje crudo
  actualizado_en            TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO estado_ingesta (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
