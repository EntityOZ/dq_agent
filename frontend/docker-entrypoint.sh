#!/bin/sh
set -e

# ──────────────────────────────────────────────────────────
# Meridian Frontend — Docker Entrypoint
#
# INTERNAL_API_URL is a server-side env var read by next.config.ts
# at startup to set the rewrite destination. It never touches the
# browser bundle, so no placeholder replacement is needed.
#
# The Next.js rewrite handles all /api/* proxying internally:
#   Browser → Nginx → Next.js :3000 → (rewrite) → FastAPI :8000
#
# The browser never talks to port 8000 directly.
# ──────────────────────────────────────────────────────────

exec node server.js
