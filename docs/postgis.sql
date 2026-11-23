-- ---------------------------------------------------------------------------
-- lintasJB NMS — skema PostGIS opsional
--
-- Aplikasi default memakai JSON store (data/db.json). Skrip ini untuk tim yang
-- ingin mereplikasi/menganalisis data jaringan di PostgreSQL + PostGIS.
-- Jalankan pada database khusus (bukan database legacy ftth-monitoring).
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE SCHEMA IF NOT EXISTS nms;
SET search_path = nms, public;

-- Project / workspace -------------------------------------------------------------

CREATE TABLE IF NOT EXISTS projects (
  id            text PRIMARY KEY,
  name          text NOT NULL,
  code          text,
  description   text,
  center_lat    double precision,
  center_lng    double precision,
  zoom          smallint DEFAULT 10,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Node aset FTTH ----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS nodes (
  id              text PRIMARY KEY,
  project_id      text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_id       text REFERENCES nodes(id) ON DELETE SET NULL,
  name            text NOT NULL,
  code            text,
  type            text NOT NULL CHECK (type IN
                    ('pop','router','server','olt','odc','odp','ont','jc')),
  status          text NOT NULL DEFAULT 'planned' CHECK (status IN
                    ('online','offline','warning','critical','maintenance','planned')),
  lat             double precision NOT NULL,
  lng             double precision NOT NULL,
  geom            geometry(Point, 4326)
                    GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lng, lat), 4326)) STORED,
  address         text,
  capacity        integer DEFAULT 0,
  used_ports      integer DEFAULT 0,
  vendor          text,
  model           text,
  serial          text,
  genieacs_serial text,
  olt_id          text,
  notes           text,
  properties      jsonb DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS nodes_project_idx ON nodes (project_id);
CREATE INDEX IF NOT EXISTS nodes_type_idx    ON nodes (type);
CREATE INDEX IF NOT EXISTS nodes_status_idx  ON nodes (status);
CREATE INDEX IF NOT EXISTS nodes_geom_idx    ON nodes USING gist (geom);
CREATE UNIQUE INDEX IF NOT EXISTS nodes_project_code_uidx
  ON nodes (project_id, lower(code)) WHERE code IS NOT NULL AND code <> '';

-- Kabel / rute fiber ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cables (
  id               text PRIMARY KEY,
  project_id       text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  from_node_id     text REFERENCES nodes(id) ON DELETE SET NULL,
  to_node_id       text REFERENCES nodes(id) ON DELETE SET NULL,
  name             text NOT NULL,
  code             text,
  type             text NOT NULL CHECK (type IN
                     ('backbone','feeder','distribution','drop')),
  status           text NOT NULL DEFAULT 'active' CHECK (status IN
                     ('active','fault','maintenance','planned','inactive')),
  fiber_count      integer NOT NULL DEFAULT 12,
  used_cores       integer NOT NULL DEFAULT 0,
  length_m         double precision NOT NULL DEFAULT 0,
  color            text,
  animation        text DEFAULT 'flow',
  geom             geometry(LineString, 4326),
  notes            text,
  properties       jsonb DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cables_two_ends CHECK (from_node_id IS DISTINCT FROM to_node_id)
);

CREATE INDEX IF NOT EXISTS cables_project_idx ON cables (project_id);
CREATE INDEX IF NOT EXISTS cables_type_idx    ON cables (type);
CREATE INDEX IF NOT EXISTS cables_status_idx  ON cables (status);
CREATE INDEX IF NOT EXISTS cables_geom_idx    ON cables USING gist (geom);

-- Gangguan & alarm --------------------------------------------------------------

CREATE TABLE IF NOT EXISTS faults (
  id                text PRIMARY KEY,
  project_id        text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  cable_id          text REFERENCES cables(id) ON DELETE SET NULL,
  node_id           text REFERENCES nodes(id) ON DELETE SET NULL,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active','resolved')),
  severity          text NOT NULL DEFAULT 'critical' CHECK (severity IN
                      ('critical','major','warning','info')),
  source            text,
  title             text NOT NULL,
  description       text,
  distance_m        double precision,
  along_m           double precision,
  ratio             double precision,
  lat               double precision,
  lng               double precision,
  geom              geometry(Point, 4326)
                      GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lng, lat), 4326)) STORED,
  affected_node_ids text[] DEFAULT '{}',
  detected_at       timestamptz NOT NULL DEFAULT now(),
  resolved_at       timestamptz,
  notes             text
);

CREATE INDEX IF NOT EXISTS faults_project_idx  ON faults (project_id);
CREATE INDEX IF NOT EXISTS faults_status_idx   ON faults (status);
CREATE INDEX IF NOT EXISTS faults_geom_idx     ON faults USING gist (geom);

CREATE TABLE IF NOT EXISTS alarms (
  id           text PRIMARY KEY,
  project_id   text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  fault_id     text REFERENCES faults(id) ON DELETE SET NULL,
  node_id      text REFERENCES nodes(id) ON DELETE SET NULL,
  severity     text NOT NULL DEFAULT 'warning' CHECK (severity IN
                 ('critical','major','warning','info')),
  title        text NOT NULL,
  message      text,
  source       text,
  acknowledged boolean NOT NULL DEFAULT false,
  acknowledged_by text,
  acknowledged_at timestamptz,
  resolved     boolean NOT NULL DEFAULT false,
  resolved_at  timestamptz,
  count        integer NOT NULL DEFAULT 1,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS alarms_project_idx ON alarms (project_id);
CREATE INDEX IF NOT EXISTS alarms_active_idx  ON alarms (project_id)
  WHERE acknowledged = false AND resolved = false;

-- POSGIS: interpolasi titik putus pada kabel -------------------------------------
-- distance_m = jarak OTDR dari sisi A (meter).
-- Mengembalikan koordinat + segmen kabel tempat gangguan berada.

CREATE OR REPLACE FUNCTION posgis_locate(p_cable_id text, p_distance_m double precision)
RETURNS TABLE (
  cable_id   text,
  point      geometry(Point, 4326),
  along_m    double precision,
  total_m    double precision,
  ratio      double precision
)
LANGUAGE sql
STABLE
AS $$
  WITH line AS (
    SELECT c.id,
           c.geom,
           ST_Length(c.geom::geography) AS total_m
    FROM cables c
    WHERE c.id = p_cable_id
      AND c.geom IS NOT NULL
  ),
  clamped AS (
    SELECT id, geom, total_m,
           LEAST(GREATEST(p_distance_m, 0), total_m) AS dist
    FROM line
  )
  SELECT id,
         ST_LineInterpolatePoint(geom, dist / NULLIF(total_m, 0)) AS point,
         dist AS along_m,
         total_m,
         dist / NULLIF(total_m, 0) AS ratio
  FROM clamped;
$$;

-- Contoh pemakaian:
--   SELECT * FROM posgis_locate('cb_odcptr_jc', 200);
--
-- Cari kabel terdekat dari koordinat gangguan lapangan:
--   SELECT c.id, c.name,
--          ST_Distance(c.geom::geography, ST_SetSRID(ST_MakePoint(113.7, -8.16), 4326)::geography) AS jarak_m
--   FROM cables c
--   ORDER BY c.geom <-> ST_SetSRID(ST_MakePoint(113.7, -8.16), 4326)
--   LIMIT 5;

-- View ringkas kesehatan jaringan ------------------------------------------------

CREATE OR REPLACE VIEW v_project_health AS
SELECT p.id AS project_id,
       p.name,
       count(DISTINCT n.id)                                   AS nodes,
       count(DISTINCT c.id)                                   AS cables,
       round(sum(c.length_m)::numeric / 1000, 2)              AS total_km,
       count(DISTINCT f.id) FILTER (WHERE f.status = 'active') AS active_faults,
       count(DISTINCT a.id) FILTER (WHERE a.resolved = false)  AS active_alarms
FROM projects p
LEFT JOIN nodes  n ON n.project_id = p.id
LEFT JOIN cables c ON c.project_id = p.id
LEFT JOIN faults f ON f.project_id = p.id
LEFT JOIN alarms a ON a.project_id = p.id
GROUP BY p.id, p.name;

-- Impor cepat dari GeoJSON (opsional, gunakan ogr2ogr untuk dataset besar):
--   ogr2ogr -f PostgreSQL "PG:dbname=lintasjb" nodes.geojson \
--     -nln nms.nodes_import -lco GEOMETRY_NAME=geom -t_srs EPSG:4326
