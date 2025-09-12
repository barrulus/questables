CREATE EXTENSION IF NOT EXISTS postgis;

  CREATE TABLE IF NOT EXISTS maps_world (
    id         INTEGER PRIMARY KEY,
    name       VARCHAR,
    created    TIMESTAMP,
    modified   TIMESTAMP,
    isActive   BOOLEAN
  );

  CREATE TABLE IF NOT EXISTS maps_cells (
    id           INTEGER PRIMARY KEY,
    world_id     INTEGER NOT NULL REFERENCES maps_world(id),
    biome        INTEGER,
    type         TEXT,
    population   INTEGER,
    state        INTEGER,
    culture      INTEGER,
    religion     INTEGER,
    height       INTEGER,
    geom         geometry(GEOMETRY, 4326)
  );
  CREATE INDEX IF NOT EXISTS maps_cells_geom_gix ON maps_cells USING GIST (geom);

  CREATE TABLE IF NOT EXISTS maps_burgs (
    id                   INTEGER PRIMARY KEY,
    world_id             INTEGER NOT NULL REFERENCES maps_world(id),
    name                 TEXT,
    state                TEXT,
    statefull            TEXT,
    province             TEXT,
    provincefull         TEXT,
    culture              TEXT,
    religion             TEXT,
    population           INTEGER,
    populationraw        DOUBLE PRECISION,
    elevation            INTEGER,
    temperature          TEXT,
    temperaturelikeness  TEXT,
    capital              BOOLEAN,
    port                 BOOLEAN,
    citadel              BOOLEAN,
    walls                BOOLEAN,
    plaza                BOOLEAN,
    temple               BOOLEAN,
    shanty               BOOLEAN,
    xworld               INTEGER,
    yworld               INTEGER,
    xpixel               DOUBLE PRECISION,
    ypixel               DOUBLE PRECISION,
    cell                 INTEGER,
    emblem               JSONB,
    geom                 geometry(Point, 4326)
  );
  CREATE INDEX IF NOT EXISTS maps_burgs_geom_gix ON maps_burgs USING GIST (geom);

  CREATE TABLE IF NOT EXISTS maps_routes (
    id       INTEGER PRIMARY KEY,
    world_id INTEGER NOT NULL REFERENCES maps_world(id),
    name     TEXT,
    type     TEXT,
    feature  INTEGER,
    geom     geometry(MultiLineString, 4326)
  );
  CREATE INDEX IF NOT EXISTS maps_routes_geom_gix ON maps_routes USING GIST (geom);

  CREATE TABLE IF NOT EXISTS maps_rivers (
    id          INTEGER PRIMARY KEY,
    world_id    INTEGER NOT NULL REFERENCES maps_world(id),
    name        TEXT,
    type        TEXT,
    discharge   DOUBLE PRECISION,
    length      DOUBLE PRECISION,
    width       DOUBLE PRECISION,
    geom        geometry(MultiLineString, 4326)
  );
  CREATE INDEX IF NOT EXISTS maps_rivers_geom_gix ON maps_rivers USING GIST (geom);

  CREATE TABLE IF NOT EXISTS maps_markers (
    id     INTEGER PRIMARY KEY,
    world_id INTEGER NOT NULL REFERENCES maps_world(id),
    type   TEXT,
    icon   TEXT,
    x_px   DOUBLE PRECISION,
    y_px   DOUBLE PRECISION,
    note   TEXT,
    geom   geometry(Point, 4326)
  );
  CREATE INDEX IF NOT EXISTS maps_markers_geom_gix ON maps_markers USING GIST (geom);
