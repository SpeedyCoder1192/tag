#!/bin/sh
# Test build (with the test hooks) for the local server.
cd "$(dirname "$0")/.." && node --check src/bot.js && node --check src/splash.js && TEST=1 python3 -I tools/assemble.py site/tag.html "$@"
