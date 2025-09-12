async def ingest_cells(path: Path) -> int:
  data = _read_geojson(path)
  rows = 0
  logger.info(f"Ingesting cells from {path.name} ({len(data.get('features', []))} features)")
  insert_sql = (
    "INSERT INTO maps_cells (id, biome, type, population, state, culture, religion, height, geom) "
    "VALUES ($1,$2,$3,$4,$5,$6,$7,$8, ST_SetSRID(ST_Multi(ST_GeomFromGeoJSON($9)), 4326)) "
    "ON CONFLICT (id) DO UPDATE SET biome=EXCLUDED.biome, type=EXCLUDED.type, population=EXCLUDED.population, "
    "state=EXCLUDED.state, culture=EXCLUDED.culture, religion=EXCLUDED.religion, height=EXCLUDED.height, geom=EXCLUDED.geom"
  )
  async with db_manager.transaction() as conn:
    for f in data.get("features", []):
      p = f.get("properties", {})
      g = f.get("geometry")
      await conn.execute(
        insert_sql,
        int(p.get("id")),
        int(p.get("biome", 0)),
        str(p.get("type", "")),
        int(p.get("population", 0)),
        int(p.get("state", 0)),
        int(p.get("culture", 0)),
        int(p.get("religion", 0)),
        int(p.get("height", 0)),
        json.dumps(g),
      )
      rows += 1
  return rows


async def ingest_burgs(path: Path) -> int:
  data = _read_geojson(path)
  rows = 0
  logger.info(f"Ingesting burgs from {path.name} ({len(data.get('features', []))} features)")
  sql = (
    "INSERT INTO maps_burgs (id,name,state,statefull,province,provincefull,culture,religion,population,populationraw,"
    "elevation,temperature,temperaturelikeness,capital,port,citadel,walls,plaza,temple,shanty,xworld,yworld,xpixel,ypixel,cell,emblem,geom) "
    "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,"
    "ST_SetSRID(ST_GeomFromGeoJSON($27),4326)) "
    "ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,state=EXCLUDED.state,statefull=EXCLUDED.statefull,"
    "province=EXCLUDED.province,provincefull=EXCLUDED.provincefull,culture=EXCLUDED.culture,religion=EXCLUDED.religion,"
    "population=EXCLUDED.population,populationraw=EXCLUDED.populationraw,elevation=EXCLUDED.elevation,"
    "temperature=EXCLUDED.temperature,temperaturelikeness=EXCLUDED.temperaturelikeness,capital=EXCLUDED.capital,"
    "port=EXCLUDED.port,citadel=EXCLUDED.citadel,walls=EXCLUDED.walls,plaza=EXCLUDED.plaza,temple=EXCLUDED.temple,shanty=EXCLUDED.shanty,"
    "xworld=EXCLUDED.xworld,yworld=EXCLUDED.yworld,xpixel=EXCLUDED.xpixel,ypixel=EXCLUDED.ypixel,cell=EXCLUDED.cell,"
    "emblem=EXCLUDED.emblem,geom=EXCLUDED.geom"
  )
  async with db_manager.transaction() as conn:
    for f in data.get("features", []):
      p = f.get("properties", {})
      g = f.get("geometry")
      await conn.execute(
        sql,
        int(p.get("id")),
        _safe_str(p.get("name")),
        _safe_str(p.get("state")),
        _safe_str(p.get("stateFull")),
        _safe_str(p.get("province")),
        _safe_str(p.get("provinceFull")),
        _safe_str(p.get("culture")),
        _safe_str(p.get("religion")),
        int(p.get("population", 0)),
        float(p.get("populationRaw", 0.0)),
        int(p.get("elevation", 0)),
        _safe_str(p.get("temperature")),
        _safe_str(p.get("temperatureLikeness")),
        bool(p.get("capital", False)),
        bool(p.get("port", False)),
        bool(p.get("citadel", False)),
        bool(p.get("walls", False)),
        bool(p.get("plaza", False)),
        bool(p.get("temple", False)),
        bool(p.get("shanty", False)),
        int(p.get("xWorld", 0)),
        int(p.get("yWorld", 0)),
        float(p.get("xPixel", 0.0)),
        float(p.get("yPixel", 0.0)),
        int(p.get("cell", 0)),
        json.dumps(p.get("emblem")) if p.get("emblem") is not None else None,
        json.dumps(g),
      )
      rows += 1
  return rows


async def ingest_routes(path: Path) -> int:
  data = _read_geojson(path)
  rows = 0
  logger.info(f"Ingesting routes from {path.name} ({len(data.get('features', []))} features)")
  sql = (
    "INSERT INTO maps_routes (id,name,type,feature,geom) "
    "VALUES ($1,$2,$3,$4, ST_SetSRID(ST_Multi(ST_GeomFromGeoJSON($5)),4326)) "
    "ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,type=EXCLUDED.type,feature=EXCLUDED.feature,geom=EXCLUDED.geom"
  )
  async with db_manager.transaction() as conn:
    for f in data.get("features", []):
      p = f.get("properties", {})
      g = f.get("geometry")
      await conn.execute(
        sql,
        int(p.get("id")),
        p.get("name"),
        p.get("type"),
        int(p.get("feature", 0)),
        json.dumps(g),
      )
      rows += 1
  return rows


async def ingest_rivers(path: Path) -> int:
  data = _read_geojson(path)
  rows = 0
  logger.info(f"Ingesting rivers from {path.name} ({len(data.get('features', []))} features)")
  sql = (
    "INSERT INTO maps_rivers (id,name,type,discharge,length,width,geom) "
    "VALUES ($1,$2,$3,$4,$5,$6, ST_SetSRID(ST_Multi(ST_GeomFromGeoJSON($7)),4326)) "
    "ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,type=EXCLUDED.type,discharge=EXCLUDED.discharge,"
    "length=EXCLUDED.length,width=EXCLUDED.width,geom=EXCLUDED.geom"
  )
  async with db_manager.transaction() as conn:
    for f in data.get("features", []):
      p = f.get("properties", {})
      g = f.get("geometry")
      await conn.execute(
        sql,
        int(p.get("id")),
        p.get("name"),
        p.get("type"),
        float(p.get("discharge", 0.0)) if p.get("discharge") is not None else None,
        float(p.get("length", 0.0)) if p.get("length") is not None else None,
        float(p.get("width", 0.0)) if p.get("width") is not None else None,
        json.dumps(g),
      )
      rows += 1
  return rows


async def ingest_markers(path: Path) -> int:
  data = _read_geojson(path)
  rows = 0
  logger.info(f"Ingesting markers from {path.name} ({len(data.get('features', []))} features)")
  sql = (
    "INSERT INTO maps_markers (id,type,icon,x_px,y_px,note,geom) "
    "VALUES ($1,$2,$3,$4,$5,$6, ST_SetSRID(ST_GeomFromGeoJSON($7),4326)) "
    "ON CONFLICT (id) DO UPDATE SET type=EXCLUDED.type,icon=EXCLUDED.icon,x_px=EXCLUDED.x_px,y_px=EXCLUDED.y_px,note=EXCLUDED.note,geom=EXCLUDED.geom"
  )
  async with db_manager.transaction() as conn:
    for f in data.get("features", []):
      p = f.get("properties", {})
      g = f.get("geometry")
      await conn.execute(
        sql,
        int(p.get("id")),
        p.get("type"),
        _safe_str(p.get("icon")),
        float(p.get("x_px", 0.0)) if p.get("x_px") is not None else None,
        float(p.get("y_px", 0.0)) if p.get("y_px") is not None else None,
        _safe_str(p.get("note")),
        json.dumps(g),
      )
      rows += 1
  return rows