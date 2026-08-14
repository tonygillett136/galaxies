#!/usr/bin/env bash
# Assemble the deployable static bundle.
#
# Only what the browser needs. The test suite, benchmarks, the CPU reference and
# the raw Galaxy Zoo parameter archives stay out: they are development and
# science-tier assets, and Cloudflare Pages has a 25 MiB per-file limit that the
# larger archives would break anyway.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
DIST="$HERE/dist"

rm -rf "$DIST"
mkdir -p "$DIST/data/targets"

cp "$HERE/index.html" "$DIST/"
cp -R "$HERE/src" "$DIST/src"
cp "$HERE/data/targets/targets.json" "$DIST/data/targets/"
cp -R "$HERE/data/targets/images" "$DIST/data/targets/images"

# Long-cache the images (content never changes); never cache the code.
cat > "$DIST/_headers" <<'EOF'
/data/targets/images/*
  Cache-Control: public, max-age=31536000, immutable

/src/*
  Cache-Control: no-cache

/index.html
  Cache-Control: no-cache
EOF

echo "bundle:  $(du -sh "$DIST" | cut -f1)"
echo "files:   $(find "$DIST" -type f | wc -l | tr -d ' ')"
echo "largest: $(find "$DIST" -type f -exec du -k {} + | sort -rn | head -1 | awk '{printf "%d KiB  %s", $1, $2}')"
echo
echo "deploy with:"
echo "  npx wrangler pages deploy $DIST --project-name galaxy-collisions"
