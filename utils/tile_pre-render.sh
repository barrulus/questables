#!/usr/bin/env bash

set -euo pipefail

# This script renders tiles directly from SVG at each zoom level
# No upsampling = no blur!

SOURCE_SVG=${SOURCE_SVG:-snoopia_states.svg}
TILE_SIZE=${TILE_SIZE:-256}
MAX_ZOOM=${MAX_ZOOM:-14}
START_ZOOM=${START_ZOOM:-0}
OUTPUT_DIR=${OUTPUT_DIR:-tiles-states}

SVG_DIR=$(dirname "${SOURCE_SVG}")
SVG_BASENAME=$(basename "${SOURCE_SVG}" .svg)
# Derive world name by dropping the trailing layer suffix (e.g. _states)
WORLD_NAME=${WORLD_NAME:-$(echo "$SVG_BASENAME" | sed -E 's/_[^_]+$//')}
MAP_METADATA=${MAP_METADATA:-${SVG_DIR}/${WORLD_NAME}_mapinfo.json}

if [ ! -f "$MAP_METADATA" ]; then
  # Fall back to the common GeoJSON directory one level deeper
  ALT_METADATA="${SVG_DIR}/geoJSON/${WORLD_NAME}_mapinfo.json"
  if [ -f "$ALT_METADATA" ]; then
    MAP_METADATA="$ALT_METADATA"
  else
    echo "Error: metadata file not found for world '$WORLD_NAME'." >&2
    echo "Checked: $MAP_METADATA" >&2
    [ "$MAP_METADATA" = "$ALT_METADATA" ] || echo "           $ALT_METADATA" >&2
    exit 1
  fi
fi

echo "Direct SVG tile rendering for OpenLayers"
echo "Source: $SOURCE_SVG"
echo "Zoom levels: $START_ZOOM to $MAX_ZOOM"

# Check dependencies
check_deps() {
  local missing=0

  if ! command -v inkscape >/dev/null 2>&1; then
    echo "Error: inkscape not found. Install with: sudo apt install inkscape" >&2
    missing=1
  fi

  if ! command -v bc >/dev/null 2>&1; then
    echo "Error: bc not found. Install with: sudo apt install bc" >&2
    missing=1
  fi

  if ! command -v convert >/dev/null 2>&1; then
    echo "Warning: ImageMagick convert not found. Install with: sudo apt install imagemagick" >&2
  fi

  if ! command -v jq >/dev/null 2>&1; then
    echo "Error: jq not found. Install with: sudo apt install jq" >&2
    missing=1
  fi

  return $missing
}

check_deps || exit 1

echo "Loading map metadata from $MAP_METADATA"
WIDTH_PIXELS=$(jq -r '.width_pixels' "$MAP_METADATA")
HEIGHT_PIXELS=$(jq -r '.height_pixels' "$MAP_METADATA")
METERS_PER_PIXEL=$(jq -r '.meters_per_pixel' "$MAP_METADATA")
BOUND_WEST=$(jq -r '.bounds.west' "$MAP_METADATA")
BOUND_EAST=$(jq -r '.bounds.east' "$MAP_METADATA")
BOUND_NORTH=$(jq -r '.bounds.north' "$MAP_METADATA")
BOUND_SOUTH=$(jq -r '.bounds.south' "$MAP_METADATA")

if [ "$WIDTH_PIXELS" = "null" ] || [ -z "$WIDTH_PIXELS" ]; then
  echo "Error: width_pixels missing from metadata" >&2
  exit 1
fi

if [ "$HEIGHT_PIXELS" = "null" ] || [ -z "$HEIGHT_PIXELS" ]; then
  echo "Error: height_pixels missing from metadata" >&2
  exit 1
fi

if [ "$METERS_PER_PIXEL" = "null" ] || [ -z "$METERS_PER_PIXEL" ]; then
  echo "Error: meters_per_pixel missing from metadata" >&2
  exit 1
fi

MAP_WIDTH_METERS=$(echo "scale=6; $BOUND_EAST - $BOUND_WEST" | bc)
MAP_HEIGHT_METERS=$(echo "scale=6; $BOUND_NORTH - $BOUND_SOUTH" | bc)

echo "World: $WORLD_NAME"
echo "Pixels: ${WIDTH_PIXELS}x${HEIGHT_PIXELS}" \
  " | Extent (m): $(printf '%.2f' "$MAP_WIDTH_METERS") x $(printf '%.2f' "${MAP_HEIGHT_METERS#-}")" \
  " | Scale: ${METERS_PER_PIXEL}m/px"

# Get SVG dimensions and aspect ratio
echo "Getting SVG dimensions..."
# Primary: parse viewBox or width/height from the SVG file itself (no external tools)
extract_viewbox_dims() {
  local file="$1"
  local svg_tag=$(grep -oE '<svg[^>]*>' "$file" | head -n1)
  if [ -z "$svg_tag" ]; then
    return 1
  fi
  local vb=$(echo "$svg_tag" | sed -nE 's/.*viewBox="([^"]+)".*/\1/p')
  if [ -n "$vb" ]; then
    echo "$vb" | awk '{print $3, $4}'
    return 0
  fi
  return 1
}

extract_wh_attrs() {
  local file="$1"
  local svg_tag=$(grep -oE '<svg[^>]*>' "$file" | head -n1)
  if [ -z "$svg_tag" ]; then
    return 1
  fi
  local w=$(echo "$svg_tag" | sed -nE 's/.*width="([^"]+)".*/\1/p')
  local h=$(echo "$svg_tag" | sed -nE 's/.*height="([^"]+)".*/\1/p')
  if [ -n "$w" ] && [ -n "$h" ]; then
    w=${w//[^0-9.]/}
    h=${h//[^0-9.]/}
    if [ -n "$w" ] && [ -n "$h" ]; then
      echo "$w $h"
      return 0
    fi
  fi
  return 1
}

read -r SVG_WIDTH SVG_HEIGHT < <(extract_viewbox_dims "$SOURCE_SVG" || extract_wh_attrs "$SOURCE_SVG")

# Fallback to inkscape queries if file parsing failed
if [ -z "${SVG_WIDTH:-}" ] || [ -z "${SVG_HEIGHT:-}" ]; then
  SVG_WIDTH=$(inkscape --query-width "$SOURCE_SVG" 2>/dev/null || echo "1600")
  SVG_HEIGHT=$(inkscape --query-height "$SOURCE_SVG" 2>/dev/null || echo "800")
fi

echo "SVG size: ${SVG_WIDTH}x${SVG_HEIGHT}"
SVG_ASPECT_RATIO=$(echo "scale=6; $SVG_WIDTH / $SVG_HEIGHT" | bc -l)

# Ensure SVG matches metadata expectations to avoid drift
if [ "$(printf '%.0f' "$SVG_WIDTH")" -ne "$WIDTH_PIXELS" ] || [ "$(printf '%.0f' "$SVG_HEIGHT")" -ne "$HEIGHT_PIXELS" ]; then
  echo "Error: SVG dimensions (${SVG_WIDTH}x${SVG_HEIGHT}) do not match metadata (${WIDTH_PIXELS}x${HEIGHT_PIXELS})." >&2
  exit 1
fi

ASPECT_RATIO=$(echo "scale=6; $WIDTH_PIXELS / $HEIGHT_PIXELS" | bc -l)
echo "Aspect ratio detected: SVG=$SVG_ASPECT_RATIO, metadata=$ASPECT_RATIO"

mkdir -p "$OUTPUT_DIR"

# Function to render a single tile directly from SVG
render_tile() {
  local z=$1
  local x=$2
  local y=$3

  local output="$OUTPUT_DIR/$z/$x/$y.png"

  # Make sure output directory exists
  mkdir -p "$(dirname "$output")"

  # Calculate how many tiles at this zoom, based on the SVG's actual dimensions
  # We want the *map* to span from 0 to N_TILES_X and 0 to N_TILES_Y
  # The "number of tiles" for a zoom level traditionally refers to a square grid, say 2^z x 2^z
  # However, our SVG might not be square. We adapt the *number of vertical tiles*
  # to match the SVG's aspect ratio, keeping the horizontal tiles at 2^z.
  local n_tiles_x=$((2 ** z))
  local n_tiles_y=$(echo "scale=0; $n_tiles_x / $ASPECT_RATIO" | bc -l | xargs printf %.0f)

  # Ensure minimum of 1 tile vertically, and if SVG is very wide, this ensures we have at least one row
  if [ "$n_tiles_y" -eq 0 ]; then
    n_tiles_y=1
  fi

  # If the current tile's y-coordinate is beyond the calculated vertical tile limit for the SVG's aspect ratio,
  # render a transparent tile. This correctly handles non-square SVGs that don't fill a square tile grid.
  if [ "$y" -ge "$n_tiles_y" ]; then
    if command -v magick >/dev/null 2>&1; then
      magick -size ${TILE_SIZE}x${TILE_SIZE} xc:transparent "$output" 2>/dev/null
    elif command -v convert >/dev/null 2>&1; then
      convert -size ${TILE_SIZE}x${TILE_SIZE} xc:transparent "$output" 2>/dev/null
    else
      # Fallback for systems without imagemagick/magick, creates an empty file
      : > "$output"
    fi
    return 0
  fi

  # Calculate the viewport in SVG coordinates
  # Each tile covers a portion of the SVG_WIDTH and SVG_HEIGHT
  local tile_w_svg=$(echo "scale=10; $SVG_WIDTH / $n_tiles_x" | bc)
  local tile_h_svg=$(echo "scale=10; $SVG_HEIGHT / $n_tiles_y" | bc)

  local x_pos=$(echo "scale=10; $tile_w_svg * $x" | bc)
  local y_pos=$(echo "scale=10; $tile_h_svg * $y" | bc)

  local x_end=$(echo "scale=10; $x_pos + $tile_w_svg" | bc)
  local y_end=$(echo "scale=10; $y_pos + $tile_h_svg" | bc)

  # Use inkscape to export just this portion of the SVG
  inkscape "$SOURCE_SVG" \
    --export-area="${x_pos}:${y_pos}:${x_end}:${y_end}" \
    --export-width=$TILE_SIZE \
    --export-height=$TILE_SIZE \
    --export-filename="$output" \
    --export-background-opacity=0 \
    >/dev/null 2>&1 || {
      echo "    Warning: Failed to render tile $z/$x/$y"
      # Create error tile (red)
      if command -v magick >/dev/null 2>&1; then
        magick -size ${TILE_SIZE}x${TILE_SIZE} xc:'rgba(255,0,0,0.5)' "$output" 2>/dev/null
      elif command -v convert >/dev/null 2>&1; then
        convert -size ${TILE_SIZE}x${TILE_SIZE} xc:'rgba(255,0,0,0.5)' "$output" 2>/dev/null
      else
        # Fallback for systems without imagemagick/magick, creates an empty file
        : > "$output"
      fi
    }
}

# Process tiles sequentially to avoid the xargs/environment issues
echo ""
for z in $(seq $START_ZOOM $MAX_ZOOM); do
  # Determine grid dimensions based on aspect ratio for this zoom level
  # No 'local' here because this is in the main script body, not a function.
  n_tiles_x=$((2 ** z))
  n_tiles_y=$(echo "scale=0; $n_tiles_x / $ASPECT_RATIO" | bc -l | xargs printf %.0f)

  # Ensure minimum of 1 tile vertically
  if [ "$n_tiles_y" -eq 0 ]; then
    n_tiles_y=1
  fi

  echo "Rendering zoom level $z (grid: ${n_tiles_x}x${n_tiles_y})..."

  tile_count=0

  # Use a simple progress indicator
  for x in $(seq 0 $((n_tiles_x - 1))); do
    echo -n "  Row $x/$((n_tiles_x - 1)): "

    # Iterate up to n_tiles_y to cover the SVG's vertical extent
    for y in $(seq 0 $((n_tiles_y - 1))); do
      render_tile "$z" "$x" "$y"
      tile_count=$((tile_count + 1))

      # Show progress dots
      if [ $((tile_count % 10)) -eq 0 ]; then
        echo -n "."
      fi
    done
    echo " done"
  done

  # Count actual non-empty tiles
  actual_tiles=$(find "$OUTPUT_DIR/$z" -name "*.png" -size +100c 2>/dev/null | wc -l)
  echo "  Created $actual_tiles non-empty tiles for zoom $z"
  echo ""
done

GENERATED_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
cat > "$OUTPUT_DIR/tileset.json" <<EOF
{
  "world": "$WORLD_NAME",
  "generated_at": "$GENERATED_AT",
  "tile_size": $TILE_SIZE,
  "min_zoom": $START_ZOOM,
  "max_zoom": $MAX_ZOOM,
  "map": {
    "width_pixels": $WIDTH_PIXELS,
    "height_pixels": $HEIGHT_PIXELS,
    "meters_per_pixel": $METERS_PER_PIXEL,
    "bounds": {
      "west": $BOUND_WEST,
      "south": $BOUND_SOUTH,
      "east": $BOUND_EAST,
      "north": $BOUND_NORTH
    },
    "width_meters": $MAP_WIDTH_METERS,
    "height_meters": $MAP_HEIGHT_METERS
  },
  "source": {
    "svg": "$SOURCE_SVG",
    "metadata": "$MAP_METADATA"
  }
}
EOF

# Create OpenLayers viewer
cat > viewer.html << EOF
<!DOCTYPE html>
<html>
<head>
  <title>Deep Zoom Map - No Blur!</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/ol@v7.5.2/ol.css">
  <style>
    html, body, #map { margin: 0; padding: 0; width: 100%; height: 100%; }
    #info {
      position: absolute;
      top: 10px;
      right: 50px;
      background: rgba(255,255,255,0.95);
      padding: 10px 15px;
      border-radius: 5px;
      font-family: 'Courier New', monospace;
      font-size: 12px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.2);
    }
    .quality {
      font-weight: bold;
      color: #4CAF50;
    }
  </style>
  <script src="https://cdn.jsdelivr.net/npm/ol@v7.5.2/dist/ol.js"></script>
</head>
<body>
  <div id="map"></div>
  <div id="info">
    <div>Zoom: <span id="zoom">2</span> / $MAX_ZOOM</div>
    <div>Quality: <span class="quality">PERFECT</span></div>
    <div>Each tile rendered from SVG</div>
  </div>

  <script>
    const map = new ol.Map({
      target: 'map',
      layers: [
        new ol.layer.Tile({
          source: new ol.source.XYZ({
            url: '$OUTPUT_DIR/{z}/{x}/{y}.png',
            minZoom: $START_ZOOM,
            maxZoom: $MAX_ZOOM,
            tilePixelRatio: 1
          })
        })
      ],
      view: new ol.View({
        center: [0, 0],
        zoom: 2,
        minZoom: $START_ZOOM,
        maxZoom: $MAX_ZOOM
      })
    });

    map.getView().on('change:resolution', () => {
      document.getElementById('zoom').textContent = map.getView().getZoom().toFixed(1);
    });
  </script>
</body>
</html>
EOF

echo "=== Rendering Complete ==="
echo "Total tiles: $(find $OUTPUT_DIR -name "*.png" 2>/dev/null | wc -l)"
echo "Total size: $(du -sh $OUTPUT_DIR 2>/dev/null | cut -f1)"
echo ""
echo "View your map: open viewer.html"
echo ""
echo "NOTE: Each tile is rendered directly from the SVG at the exact"
echo "      resolution needed. No upsampling = no blur at any zoom level!"
