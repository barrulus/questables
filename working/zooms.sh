#!/bin/bash

# For each zoom level
for zoom in 0 1 2 3 4 5; do
  # Calculate resolution multiplier
  multiplier=$((2 ** zoom))
  tile_width=$((300 * multiplier))
  tile_height=$((150 * multiplier))

  echo "Generating zoom level $zoom (${tile_width}x${tile_height} per tile)..."

  mkdir -p "tiles/$zoom"

  # Convert each SVG directly to its tile position
  for r in {A..P}; do
    for c in {1..16}; do
      row_idx=$(($(printf "%d" "'$r") - 65))
      col_idx=$((c - 1))

      # Generate tile at correct resolution
      rsvg-convert -w "$tile_width" -h "$tile_height" -f png \
        -o "tiles/$zoom/${col_idx}_${row_idx}.png" \
        "${r}${c}.svg"
    done
  done
done