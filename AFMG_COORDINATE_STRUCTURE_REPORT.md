# Azgaar's Fantasy Map Generator - Coordinate Structure Report

## Overview

This document provides a comprehensive analysis of the coordinate systems used in Azgaar's Fantasy Map Generator (AFMG), particularly focusing on the GeoJSON export functionality found in `modules/io/export.js`.

## Coordinate Systems

AFMG employs **four distinct coordinate representations** to provide maximum flexibility and compatibility across different use cases:

### 1. GeoJSON Geometry Coordinates (Standard Geographic)
- **Format**: `[longitude, latitude]` array
- **Standard**: WGS84 (EPSG:4326)
- **Source Function**: `pixelsToLonLat(x, y, 6)`
- **Precision**: 6 decimal places (~0.1 meter accuracy)
- **Range**: 
  - Longitude: ±180°
  - Latitude: ±90°
- **Usage**: All `geometry.coordinates` fields in GeoJSON exports
- **Y-axis**: North = positive (standard geographic convention)

### 2. Pixel Coordinates (Internal Map Space)
- **Format**: `{xPixel, yPixel}` properties
- **Origin**: Top-left corner (0,0)
- **Units**: Pixels
- **Range**: 0 to `graphWidth` (X), 0 to `graphHeight` (Y)
- **Y-axis**: Downward = positive (computer graphics convention)
- **Usage**: Reference coordinates for internal map operations

### 3. World Coordinates (Projected Meters)
- **Format**: `{xWorld, yWorld}` properties
- **Origin**: Top-left corner (0,0) in meters
- **Calculation**: 
  - `xWorld = x * metersPerPixel`
  - `yWorld = -y * metersPerPixel` (note negative Y)
- **Y-axis**: Upward = positive (cartographic convention)
- **Usage**: Burgs and Regiments exports for metric measurements

### 4. Base Coordinates (Military Units Only)
- **Format**: `{baseXWorld, baseYWorld, baseXPixel, baseYPixel, baseCoordinates}`
- **Purpose**: Home base location for military regiments
- **Systems**: Combines pixel, world, and geographic coordinates for base location
- **Usage**: Regiment exports only

## Export-Specific Coordinate Implementation

### Burgs Export (`buildGeoJsonBurgs()`)
**File Location**: `modules/io/export.js:989-1053`

```javascript
// GeoJSON standard
geometry: {
  type: "Point", 
  coordinates: [longitude, latitude]  // WGS84
}

// Properties include comprehensive coordinate data
properties: {
  // World coordinates (meters from top-left, Y-flipped)
  xWorld: rn(b.x * metersPerPixel, 2),
  yWorld: rn(-b.y * metersPerPixel, 2),
  
  // Original pixel coordinates
  xPixel: b.x,
  yPixel: b.y,
  
  // Sky burgs additional altitude
  skyAltitude: b.flying ? (b.altitude ?? 1000) : null,
  
  // Standard geographic properties
  elevation: parseInt(getHeight(pack.cells.h[b.cell])),
  // ... other properties
}
```

### Regiments Export (`buildGeoJsonRegiments()`)
**File Location**: `modules/io/export.js:1061-1131`

```javascript
geometry: {
  type: "Point", 
  coordinates: [longitude, latitude]  // Current position
}

properties: {
  // Current position in all coordinate systems
  xWorld: rn(r.x * metersPerPixel, 2),
  yWorld: rn(-r.y * metersPerPixel, 2),
  xPixel: r.x,
  yPixel: r.y,
  
  // Home base position in all coordinate systems
  baseXWorld: rn(r.bx * metersPerPixel, 2),
  baseYWorld: rn(-r.by * metersPerPixel, 2),
  baseXPixel: r.bx,
  baseYPixel: r.by,
  baseCoordinates: [baseLongitude, baseLatitude],
  
  // Military unit data
  units: {...},
  totalUnits: r.a,
  // ... other properties
}
```

### Rivers Export (`buildGeoJsonRivers()`)
**File Location**: `modules/io/export.js:907-936`

```javascript
// Enhanced with meandering for realistic appearance
const meanderedPoints = Rivers.addMeandering(cells, points);
const coordinates = meanderedPoints.map(([x, y]) => pixelsToLonLat(x, y, 6));

geometry: {
  type: "LineString", 
  coordinates: [[lon, lat], [lon, lat], ...]  // WGS84 only
}

// Note: Rivers do not include pixel or world coordinates in properties
```

### Routes Export (`buildGeoJsonRoutes()`)
**File Location**: `modules/io/export.js:851-899`

```javascript
const coordinates = points.map(([x, y]) => pixelsToLonLat(x, y, 6));

geometry: {
  type: "LineString", 
  coordinates: [[lon, lat], [lon, lat], ...]  // WGS84 only
}

properties: {
  // Multi-unit length measurements
  length_px: lengthPx,           // Original pixel length
  length_units: lengthUnits,     // In map's distance scale units
  length_meters: lengthMeters,   // Converted to meters
  unit: unitLabel,               // Distance unit name
  // ... other route properties
}
```

### Polygonal Features (States, Provinces, Cultures, Religions, Zones)
**File Location**: Various functions in `modules/io/export.js`

```javascript
// Built from cell vertices, converted to geographic coordinates
geometry: {
  type: "MultiPolygon", 
  coordinates: [
    [[[lon, lat], [lon, lat], ...]], // Outer ring
    // ... additional polygons
  ]
}

// Uses helper functions:
// - getCellPolygonCoordinates() -> pixelsToLonLat()
// - buildMultiPolygonFromCells()
```

### Markers Export (`buildGeoJsonMarkers()`)
**File Location**: `modules/io/export.js:944-981`

```javascript
geometry: {
  type: "Point", 
  coordinates: [longitude, latitude]  // WGS84
}

properties: {
  // Preserves original pixel coordinates only
  x_px: x,
  y_px: y,
  size: size,
  // Note: No world coordinates included
  // ... other marker properties
}
```

## Coordinate Transformation Functions

### Core Transformation: `pixelsToLonLat()`
**File Location**: `modules/io/export.js:691-703`

```javascript
function pixelsToLonLat(x, y, decimals = 6) {
  const {lat0, lon0, dppX, dppY} = computeWgs84Transform();
  
  // Convert from pixel offset to geographic coordinates
  const lon = lon0 + (x - graphWidth / 2) * dppX;
  const lat = lat0 - (y - graphHeight / 2) * dppY;
  
  // Handle coordinate bounds and precision
  const wrapLon = ((((lon + 180) % 360) + 360) % 360) - 180;  // ±180°
  const clampLat = Math.max(-90, Math.min(90, lat));          // ±90°
  
  return [
    Math.round(wrapLon * Math.pow(10, decimals)) / Math.pow(10, decimals),
    Math.round(clampLat * Math.pow(10, decimals)) / Math.pow(10, decimals)
  ];
}
```

### Projection Parameters: `computeWgs84Transform()`
**File Location**: `modules/io/export.js:662-676`

```javascript
function computeWgs84Transform() {
  const mpp = getMetersPerPixel();  // Based on distance scale and units
  const lat0 = +latitudeOutput.value || 0;   // Map center latitude
  const lon0 = +longitudeOutput.value || 0;  // Map center longitude
  
  // Earth's approximation: degrees per meter
  const degPerMeterLat = 1 / 110574;  // ~110.574 km per degree latitude
  const degPerMeterLon = 1 / (111320 * Math.cos((lat0 * Math.PI) / 180));
  
  return {
    lat0, lon0,
    dppX: mpp * degPerMeterLon,  // degrees per pixel (longitude)
    dppY: mpp * degPerMeterLat   // degrees per pixel (latitude)
  };
}
```

## Distance Unit Support

AFMG supports multiple distance units with automatic conversion:

### Supported Units (`getMetersPerPixel()`)
**File Location**: `modules/io/export.js:629-658`

| Unit | Conversion to Meters |
|------|---------------------|
| km | `distanceScale * 1000` |
| m, meter, meters | `distanceScale` |
| mi, mile, miles | `distanceScale * 1609.344` |
| yd, yard, yards | `distanceScale * 0.9144` |
| ft, foot, feet | `distanceScale * 0.3048` |
| league, leagues | `distanceScale * 4828.032` |

## Key Design Principles

### 1. Multi-System Compatibility
- **GeoJSON Standard**: All exports comply with RFC 7946 GeoJSON specification
- **GIS Integration**: WGS84 coordinates ensure compatibility with major GIS software
- **Game Development**: Pixel and world coordinates support game engine integration
- **Scientific Use**: Metric world coordinates enable precise measurements

### 2. Coordinate Consistency
- All geographic conversions use the same `pixelsToLonLat()` function
- Transformation parameters calculated once via `computeWgs84Transform()`
- Consistent precision across all exports (6 decimal places for coordinates)

### 3. Y-Axis Handling
- **Pixel coordinates**: Computer graphics convention (Y+ = down)
- **World coordinates**: Cartographic convention (Y+ = up, hence negative multiplier)
- **Geographic coordinates**: Standard geographic convention (North = positive latitude)

### 4. Precision and Accuracy
- Geographic coordinates: 6 decimal places (~0.1 meter accuracy at equator)
- World coordinates: 2 decimal places for meter measurements
- Automatic coordinate bounds enforcement (longitude wrapping, latitude clamping)

## Usage Recommendations

### For GIS Applications
- Use the standard `geometry.coordinates` (WGS84 longitude/latitude)
- Leverage the comprehensive metadata in each export for proper scaling

### For Game Development
- Use `xPixel/yPixel` for direct map rendering
- Use `xWorld/yWorld` for metric-based game mechanics
- Sky burgs include `skyAltitude` for 3D positioning

### For Analysis and Measurement
- Use world coordinates for precise metric calculations
- Route exports include pre-calculated lengths in multiple units
- All exports include bounding boxes for spatial extent analysis

### For Military/Strategic Planning
- Regiment exports provide both current and base positions
- Multiple coordinate systems enable flexible tactical mapping
- Unit composition data integrated with positional information

## File Structure and Extensions

All coordinate exports maintain consistent metadata including:
- Map name, dimensions, and scale information
- Distance units and conversion factors
- Export timestamp and generator version
- Bounding box in WGS84 coordinates

This multi-coordinate approach ensures AFMG exports can serve diverse applications while maintaining full traceability between coordinate systems.

## Questable / OpenLayers Integration Notes

With the migration of AFMG data into the Questable platform we now render all spatial content directly in **WGS84 (EPSG:4326)** to avoid mismatches between azgaar-derived GeoJSON and the OpenLayers basemap. Key adjustments implemented in March 2025:

- **Front-end projection alignment** (`components/enhanced-openlayers-map.tsx`)
  - OpenLayers `View` now runs in EPSG:4326 with rotation disabled so geographic lon/lat coordinates line up 1:1 with imported features.
  - Custom `createGeographicTileSource` builds an OpenLayers `XYZ` source backed by a geographic `TileGrid` (origin `[-180, 90]`, resolutions derived from the fantasy tiles). This replaces the previous Web Mercator assumption and keeps pre-rendered AFMG tiles perfectly registered.
  - All interaction helpers (pin placement, fit-to-extent) operate on raw `[lon, lat]` values—no intermediate `fromLonLat`/`toLonLat` conversions remain, eliminating rounding drift.

- **Vector layer ingestion** (`components/map-data-loader.tsx`)
  - GeoJSON features are parsed with both `dataProjection` and `featureProjection` set to EPSG:4326, ensuring Questable never reprojects AFMG geometries on load.
  - Getters for burgs, routes, rivers, cells, and markers now return typed OpenLayers `Feature` objects only when valid geometry is present, preserving server-side precision.

- **Tile set policy**
  - Questable intentionally removed the optional OSM/Web Mercator tiles. All available tilesets must be authored/exported in AFMG's native geographic projection. The UI no longer offers incompatible sources, preventing accidental reprojection.

These updates mean every subsystem (PostGIS, Supabase RPCs, OpenLayers vectors, fantasy raster tiles, and user annotations) consumes the **same lon/lat pairs generated by AFMG's `pixelsToLonLat` pipeline**. The result is a perfectly aligned overlay stack and a clear evolutionary path from the original AFMG coordinate design to the Questable/OpenLayers implementation.
