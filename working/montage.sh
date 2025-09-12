# This ensures correct order: A1-A16, then B1-B16, etc.
montage $(for r in {A..P}; do for c in {1..16}; do echo "${r}${c}.svg"; done; done) \
  -tile 16x16 \
  -geometry 300x150+0+0 \
  -background none \
  full_map.png