#!/usr/bin/env python3
"""
Import Azgaar's Fantasy Map Generator GeoJSON files into PostgreSQL database.
This script creates a new world entry and imports all associated map data.

Usage: python import_geojson.py --world <world_name>
"""

import argparse
import json
import logging
import sys
from pathlib import Path
from typing import Dict, Any, Optional, List, Tuple
import uuid

import asyncpg


logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


class DatabaseManager:
    def __init__(self, database_url: str):
        self.database_url = database_url
        self._connection_pool = None
    
    async def connect(self):
        """Initialize connection pool"""
        self._connection_pool = await asyncpg.create_pool(self.database_url)
        logger.info("Database connection pool established")
    
    async def close(self):
        """Close connection pool"""
        if self._connection_pool:
            await self._connection_pool.close()
            logger.info("Database connection pool closed")
    
    def transaction(self):
        """Get a database transaction context"""
        return self._connection_pool.acquire()


# Global database manager instance
db_manager = DatabaseManager("postgresql://localhost/questables")


def _read_geojson(path: Path) -> Dict[str, Any]:
    """Read and parse a GeoJSON file"""
    try:
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        logger.debug(f"Successfully read {path.name}")
        return data
    except Exception as e:
        logger.error(f"Failed to read {path}: {e}")
        raise


def _safe_str(value: Any) -> Optional[str]:
    """Safely convert value to string, handling None and encoding issues"""
    if value is None:
        return None
    try:
        # Convert to string and handle unicode surrogates
        text = str(value)
        # Remove or replace problematic unicode surrogates
        text = text.encode('utf-8', 'ignore').decode('utf-8')
        return text
    except Exception:
        return None


def _calculate_bounds(all_features: List[Dict[str, Any]]) -> Dict[str, float]:
    """Calculate bounding box from all map features"""
    min_lat = min_lng = float('inf')
    max_lat = max_lng = float('-inf')
    
    for feature in all_features:
        geom = feature.get('geometry', {})
        coords = geom.get('coordinates', [])
        
        if geom.get('type') == 'Point':
            lng, lat = coords
            min_lng, max_lng = min(min_lng, lng), max(max_lng, lng)
            min_lat, max_lat = min(min_lat, lat), max(max_lat, lat)
        elif geom.get('type') in ['LineString', 'MultiLineString']:
            # Handle line geometries
            if geom.get('type') == 'LineString':
                coords = [coords]
            for line in coords:
                for point in line:
                    lng, lat = point[:2]  # Handle 2D/3D coordinates
                    min_lng, max_lng = min(min_lng, lng), max(max_lng, lng)
                    min_lat, max_lat = min(min_lat, lat), max(max_lat, lat)
        elif geom.get('type') in ['Polygon', 'MultiPolygon']:
            # Handle polygon geometries
            if geom.get('type') == 'Polygon':
                coords = [coords]
            for polygon in coords:
                for ring in polygon:
                    for point in ring:
                        lng, lat = point[:2]  # Handle 2D/3D coordinates
                        min_lng, max_lng = min(min_lng, lng), max(max_lng, lng)
                        min_lat, max_lat = min(min_lat, lat), max(max_lat, lat)
    
    return {
        "north": max_lat,
        "south": min_lat,
        "east": max_lng,
        "west": min_lng
    }


async def create_world_entry(world_name: str, all_features: List[Dict[str, Any]]) -> str:
    """Create a new maps_world entry and return its UUID"""
    bounds = _calculate_bounds(all_features)
    
    # First try to find existing world
    select_sql = "SELECT id FROM public.maps_world WHERE name = $1"
    
    async with db_manager.transaction() as conn:
        existing = await conn.fetchrow(select_sql, world_name)
        
        if existing:
            world_id = str(existing['id'])
            # Update existing world
            update_sql = """
                UPDATE public.maps_world 
                SET description = $2, bounds = $3, updated_at = NOW() 
                WHERE id = $1
            """
            await conn.execute(
                update_sql,
                world_id,
                f"Imported world map: {world_name}",
                json.dumps(bounds)
            )
            logger.info(f"Updated existing world '{world_name}' with ID: {world_id}")
        else:
            # Create new world
            world_id = str(uuid.uuid4())
            insert_sql = """
                INSERT INTO public.maps_world (id, name, description, bounds, is_active) 
                VALUES ($1, $2, $3, $4, $5)
            """
            await conn.execute(
                insert_sql,
                world_id,
                world_name,
                f"Imported world map: {world_name}",
                json.dumps(bounds),
                True
            )
            logger.info(f"Created new world '{world_name}' with ID: {world_id}")
        
        return world_id


async def ingest_cells(path: Path, world_id: str) -> int:
    """Import cells data aligned with database schema"""
    data = _read_geojson(path)
    rows = 0
    logger.info(f"Ingesting cells from {path.name} ({len(data.get('features', []))} features)")
    
    insert_sql = """
        INSERT INTO public.maps_cells (id, world_id, cell_id, biome, type, population, state, culture, religion, height, geom) 
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, ST_SetSRID(ST_Multi(ST_GeomFromGeoJSON($11)), 4326))
        ON CONFLICT (world_id, cell_id) DO UPDATE SET 
            biome=EXCLUDED.biome, type=EXCLUDED.type, population=EXCLUDED.population,
            state=EXCLUDED.state, culture=EXCLUDED.culture, religion=EXCLUDED.religion, 
            height=EXCLUDED.height, geom=EXCLUDED.geom
    """
    
    async with db_manager.transaction() as conn:
        for f in data.get("features", []):
            p = f.get("properties", {})
            g = f.get("geometry")
            
            await conn.execute(
                insert_sql,
                str(uuid.uuid4()),                    # id (UUID)
                world_id,                             # world_id (UUID)
                int(p.get("id")),                     # cell_id (INTEGER)
                int(p.get("biome", 0)),               # biome (INTEGER)
                _safe_str(p.get("type")),             # type (TEXT)
                int(p.get("population", 0)),          # population (INTEGER)
                int(p.get("state", 0)),               # state (INTEGER)
                int(p.get("culture", 0)),             # culture (INTEGER)
                int(p.get("religion", 0)),            # religion (INTEGER)
                int(p.get("height", 0)),              # height (INTEGER)
                json.dumps(g),                        # geom (geometry)
            )
            rows += 1
    
    return rows


async def ingest_burgs(path: Path, world_id: str) -> int:
    """Import burgs data aligned with database schema"""
    data = _read_geojson(path)
    rows = 0
    logger.info(f"Ingesting burgs from {path.name} ({len(data.get('features', []))} features)")
    
    sql = """
        INSERT INTO public.maps_burgs (id, world_id, burg_id, name, state, statefull, province, provincefull, 
            culture, religion, population, populationraw, elevation, temperature, temperaturelikeness, 
            capital, port, citadel, walls, plaza, temple, shanty, xworld, yworld, xpixel, ypixel, 
            cell, emblem, geom) 
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, 
            $20, $21, $22, $23, $24, $25, $26, $27, $28, ST_SetSRID(ST_GeomFromGeoJSON($29), 4326))
        ON CONFLICT (world_id, burg_id) DO UPDATE SET 
            name=EXCLUDED.name, state=EXCLUDED.state, statefull=EXCLUDED.statefull,
            province=EXCLUDED.province, provincefull=EXCLUDED.provincefull, culture=EXCLUDED.culture,
            religion=EXCLUDED.religion, population=EXCLUDED.population, populationraw=EXCLUDED.populationraw,
            elevation=EXCLUDED.elevation, temperature=EXCLUDED.temperature, 
            temperaturelikeness=EXCLUDED.temperaturelikeness, capital=EXCLUDED.capital,
            port=EXCLUDED.port, citadel=EXCLUDED.citadel, walls=EXCLUDED.walls, plaza=EXCLUDED.plaza,
            temple=EXCLUDED.temple, shanty=EXCLUDED.shanty, xworld=EXCLUDED.xworld, yworld=EXCLUDED.yworld,
            xpixel=EXCLUDED.xpixel, ypixel=EXCLUDED.ypixel, cell=EXCLUDED.cell, emblem=EXCLUDED.emblem,
            geom=EXCLUDED.geom
    """
    
    async with db_manager.transaction() as conn:
        for f in data.get("features", []):
            p = f.get("properties", {})
            g = f.get("geometry")
            
            await conn.execute(
                sql,
                str(uuid.uuid4()),                           # id (UUID)
                world_id,                                    # world_id (UUID)
                int(p.get("id")),                            # burg_id (INTEGER)
                _safe_str(p.get("name")),                    # name (TEXT)
                _safe_str(p.get("state")),                   # state (TEXT)
                _safe_str(p.get("stateFull")),               # statefull (TEXT)
                _safe_str(p.get("province")),                # province (TEXT)
                _safe_str(p.get("provinceFull")),            # provincefull (TEXT)
                _safe_str(p.get("culture")),                 # culture (TEXT)
                _safe_str(p.get("religion")),                # religion (TEXT)
                int(p.get("population", 0)),                 # population (INTEGER)
                float(p.get("populationRaw", 0.0)),          # populationraw (DOUBLE PRECISION)
                int(p.get("elevation", 0)),                  # elevation (INTEGER)
                _safe_str(p.get("temperature")),             # temperature (TEXT)
                _safe_str(p.get("temperatureLikeness")),     # temperaturelikeness (TEXT)
                bool(p.get("capital", False)),               # capital (BOOLEAN)
                bool(p.get("port", False)),                  # port (BOOLEAN)
                bool(p.get("citadel", False)),               # citadel (BOOLEAN)
                bool(p.get("walls", False)),                 # walls (BOOLEAN)
                bool(p.get("plaza", False)),                 # plaza (BOOLEAN)
                bool(p.get("temple", False)),                # temple (BOOLEAN)
                bool(p.get("shanty", False)),                # shanty (BOOLEAN)
                int(p.get("xWorld", 0)),                     # xworld (INTEGER)
                int(p.get("yWorld", 0)),                     # yworld (INTEGER)
                float(p.get("xPixel", 0.0)),                 # xpixel (DOUBLE PRECISION)
                float(p.get("yPixel", 0.0)),                 # ypixel (DOUBLE PRECISION)
                int(p.get("cell", 0)),                       # cell (INTEGER)
                json.dumps(p.get("emblem")) if p.get("emblem") is not None else None,  # emblem (JSONB)
                json.dumps(g),                               # geom (geometry)
            )
            rows += 1
    
    return rows


async def ingest_routes(path: Path, world_id: str) -> int:
    """Import routes data aligned with database schema"""
    data = _read_geojson(path)
    rows = 0
    logger.info(f"Ingesting routes from {path.name} ({len(data.get('features', []))} features)")
    
    sql = """
        INSERT INTO public.maps_routes (id, world_id, route_id, name, type, feature, geom) 
        VALUES ($1, $2, $3, $4, $5, $6, ST_SetSRID(ST_Multi(ST_GeomFromGeoJSON($7)), 4326))
        ON CONFLICT (world_id, route_id) DO UPDATE SET 
            name=EXCLUDED.name, type=EXCLUDED.type, feature=EXCLUDED.feature, geom=EXCLUDED.geom
    """
    
    async with db_manager.transaction() as conn:
        for f in data.get("features", []):
            p = f.get("properties", {})
            g = f.get("geometry")
            
            await conn.execute(
                sql,
                str(uuid.uuid4()),                    # id (UUID)
                world_id,                             # world_id (UUID)
                int(p.get("id")),                     # route_id (INTEGER)
                _safe_str(p.get("name")),             # name (TEXT)
                _safe_str(p.get("type")),             # type (TEXT)
                int(p.get("feature", 0)),             # feature (INTEGER)
                json.dumps(g),                        # geom (geometry)
            )
            rows += 1
    
    return rows


async def ingest_rivers(path: Path, world_id: str) -> int:
    """Import rivers data aligned with database schema"""
    data = _read_geojson(path)
    rows = 0
    logger.info(f"Ingesting rivers from {path.name} ({len(data.get('features', []))} features)")
    
    sql = """
        INSERT INTO public.maps_rivers (id, world_id, river_id, name, type, discharge, length, width, geom) 
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, ST_SetSRID(ST_Multi(ST_GeomFromGeoJSON($9)), 4326))
        ON CONFLICT (world_id, river_id) DO UPDATE SET 
            name=EXCLUDED.name, type=EXCLUDED.type, discharge=EXCLUDED.discharge,
            length=EXCLUDED.length, width=EXCLUDED.width, geom=EXCLUDED.geom
    """
    
    async with db_manager.transaction() as conn:
        for f in data.get("features", []):
            p = f.get("properties", {})
            g = f.get("geometry")
            
            await conn.execute(
                sql,
                str(uuid.uuid4()),                                                      # id (UUID)
                world_id,                                                               # world_id (UUID)
                int(p.get("id")),                                                       # river_id (INTEGER)
                _safe_str(p.get("name")),                                               # name (TEXT)
                _safe_str(p.get("type")),                                               # type (TEXT)
                float(p.get("discharge", 0.0)) if p.get("discharge") is not None else None,  # discharge (DOUBLE PRECISION)
                float(p.get("length", 0.0)) if p.get("length") is not None else None,        # length (DOUBLE PRECISION)
                float(p.get("width", 0.0)) if p.get("width") is not None else None,          # width (DOUBLE PRECISION)
                json.dumps(g),                                                          # geom (geometry)
            )
            rows += 1
    
    return rows


async def ingest_markers(path: Path, world_id: str) -> int:
    """Import markers data aligned with database schema"""
    data = _read_geojson(path)
    rows = 0
    logger.info(f"Ingesting markers from {path.name} ({len(data.get('features', []))} features)")
    
    sql = """
        INSERT INTO public.maps_markers (id, world_id, marker_id, type, icon, x_px, y_px, note, geom) 
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, ST_SetSRID(ST_GeomFromGeoJSON($9), 4326))
        ON CONFLICT (world_id, marker_id) DO UPDATE SET 
            type=EXCLUDED.type, icon=EXCLUDED.icon, x_px=EXCLUDED.x_px, y_px=EXCLUDED.y_px,
            note=EXCLUDED.note, geom=EXCLUDED.geom
    """
    
    async with db_manager.transaction() as conn:
        for f in data.get("features", []):
            p = f.get("properties", {})
            g = f.get("geometry")
            
            await conn.execute(
                sql,
                str(uuid.uuid4()),                                                    # id (UUID)
                world_id,                                                             # world_id (UUID)
                int(p.get("id")),                                                     # marker_id (INTEGER)
                _safe_str(p.get("type")),                                             # type (TEXT)
                _safe_str(p.get("icon")),                                             # icon (TEXT)
                float(p.get("x_px", 0.0)) if p.get("x_px") is not None else None,    # x_px (DOUBLE PRECISION)
                float(p.get("y_px", 0.0)) if p.get("y_px") is not None else None,    # y_px (DOUBLE PRECISION)
                _safe_str(p.get("note")),                                             # note (TEXT)
                json.dumps(g),                                                        # geom (geometry)
            )
            rows += 1
    
    return rows


def find_world_files(world_name: str, search_dir: Path = None) -> Dict[str, Path]:
    """Find all GeoJSON files for a given world name"""
    if search_dir is None:
        search_dir = Path.cwd()
    
    pattern = f"{world_name}_*.geojson"
    files = {}
    
    # Map file patterns to their types
    type_patterns = {
        'cells': f"{world_name}_cells.geojson",
        'burgs': f"{world_name}_burgs.geojson", 
        'routes': f"{world_name}_routes.geojson",
        'rivers': f"{world_name}_rivers.geojson",
        'markers': f"{world_name}_markers.geojson",
    }
    
    for file_type, pattern in type_patterns.items():
        file_path = search_dir / pattern
        if file_path.exists():
            files[file_type] = file_path
            logger.info(f"Found {file_type} file: {file_path}")
        else:
            logger.warning(f"Missing {file_type} file: {file_path}")
    
    return files


async def import_world(world_name: str, search_dir: Path = None) -> None:
    """Import all GeoJSON files for a world"""
    logger.info(f"Starting import for world: {world_name}")
    
    # Find all world files
    world_files = find_world_files(world_name, search_dir)
    
    if not world_files:
        logger.error(f"No GeoJSON files found for world '{world_name}'")
        return
    
    # Collect all features for bounds calculation
    all_features = []
    for file_path in world_files.values():
        data = _read_geojson(file_path)
        all_features.extend(data.get('features', []))
    
    # Create world entry
    world_id = await create_world_entry(world_name, all_features)
    
    # Import each file type
    import_functions = {
        'cells': ingest_cells,
        'burgs': ingest_burgs,
        'routes': ingest_routes,
        'rivers': ingest_rivers,
        'markers': ingest_markers,
    }
    
    total_rows = 0
    for file_type, file_path in world_files.items():
        if file_type in import_functions:
            try:
                rows = await import_functions[file_type](file_path, world_id)
                total_rows += rows
                logger.info(f"Imported {rows} {file_type} features")
            except Exception as e:
                logger.error(f"Failed to import {file_type}: {e}")
                raise
    
    logger.info(f"Successfully imported world '{world_name}' with {total_rows} total features")


async def main():
    """Main entry point"""
    parser = argparse.ArgumentParser(
        description="Import Azgaar's Fantasy Map Generator GeoJSON files"
    )
    parser.add_argument(
        "--world", 
        required=True, 
        help="World name (looks for {world}_*.geojson files)"
    )
    parser.add_argument(
        "--dir",
        type=Path,
        default=Path.cwd(),
        help="Directory to search for GeoJSON files (default: current directory)"
    )
    parser.add_argument(
        "--database-url",
        default="postgresql://localhost/questables",
        help="PostgreSQL database URL"
    )
    
    args = parser.parse_args()
    
    # Update database manager with provided URL
    global db_manager
    db_manager = DatabaseManager(args.database_url)
    
    try:
        await db_manager.connect()
        await import_world(args.world, args.dir)
    except Exception as e:
        logger.error(f"Import failed: {e}")
        sys.exit(1)
    finally:
        await db_manager.close()


if __name__ == "__main__":
    import asyncio
    asyncio.run(main())