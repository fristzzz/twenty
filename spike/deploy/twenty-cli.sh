#!/bin/bash
# Run the Twenty app CLI inside node:24 (corepack yarn 4) with a persistent HOME.
# Args are forwarded verbatim so JSON payloads keep their quotes.
set -uo pipefail
docker run --rm -u "$(id -u):$(id -g)" --network host \
  -v "$HOME/app/twenty-spike:/work" \
  -e HOME=/work/.home -e COREPACK_HOME=/work/.home/corepack -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
  -e YARN_ENABLE_IMMUTABLE_INSTALLS=false \
  -w /work/tapdata-crm node:24 sh -lc "corepack yarn \"\$@\"" sh "$@"
