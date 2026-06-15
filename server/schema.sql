-- Genesis City — esquema PostgreSQL
-- Snapshots completos (JSONB) + tabelas relacionais para consulta analítica.

CREATE TABLE IF NOT EXISTS snapshots (
  id          BIGSERIAL PRIMARY KEY,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  sim_tick    BIGINT NOT NULL,
  seed        BIGINT NOT NULL,
  population  INTEGER NOT NULL,
  payload     JSONB NOT NULL
);

-- Espelho analítico dos cidadãos (atualizado a cada save)
CREATE TABLE IF NOT EXISTS citizens (
  snapshot_id   BIGINT REFERENCES snapshots(id) ON DELETE CASCADE,
  citizen_id    INTEGER NOT NULL,
  name          TEXT NOT NULL,
  sex           CHAR(1) NOT NULL,
  age           INTEGER NOT NULL,
  money         NUMERIC NOT NULL,
  happiness     REAL NOT NULL,
  health        REAL NOT NULL,
  profession    TEXT,
  education     TEXT,
  company_id    INTEGER,
  partner_id    INTEGER,
  alive         BOOLEAN NOT NULL,
  PRIMARY KEY (snapshot_id, citizen_id)
);

CREATE TABLE IF NOT EXISTS companies (
  snapshot_id   BIGINT REFERENCES snapshots(id) ON DELETE CASCADE,
  company_id    INTEGER NOT NULL,
  name          TEXT NOT NULL,
  sector        TEXT NOT NULL,
  capital       NUMERIC NOT NULL,
  employees     INTEGER NOT NULL,
  bankrupt      BOOLEAN NOT NULL,
  PRIMARY KEY (snapshot_id, company_id)
);

CREATE TABLE IF NOT EXISTS city_stats (
  id            BIGSERIAL PRIMARY KEY,
  snapshot_id   BIGINT REFERENCES snapshots(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  population    INTEGER,
  gdp           NUMERIC,
  unemployment  REAL,
  avg_happiness REAL,
  avg_education REAL,
  inflation     REAL
);

CREATE INDEX IF NOT EXISTS idx_citizens_name ON citizens (snapshot_id, name);
CREATE INDEX IF NOT EXISTS idx_companies_sector ON companies (snapshot_id, sector);
CREATE INDEX IF NOT EXISTS idx_snapshots_created ON snapshots (created_at DESC);
