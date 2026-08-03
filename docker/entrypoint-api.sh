#!/bin/sh
# porttrack-api entrypoint (US-9.5, PRD FR-8.2/8.3).
#
# Pre-flight only. It verifies the bind-mounted data directory is usable BEFORE
# the process touches the database, because a permissions failure discovered
# halfway through a migration is far harder to diagnose — and far more alarming —
# than one reported at startup with the exact command to fix it.
set -eu

DATA_DIR="${PORTTRACK_DATA_DIR:-/var/lib/porttrack}"

if [ ! -d "$DATA_DIR" ]; then
  echo "portTrack: data directory $DATA_DIR does not exist inside the container." >&2
  echo "  The compose file should bind-mount your host directory to this path." >&2
  exit 1
fi

# The probe is a real write: `test -w` reports the permission bit, which can
# disagree with reality on a bind mount whose host ownership differs.
if ! touch "$DATA_DIR/.porttrack-write-probe" 2>/dev/null; then
  CURRENT_UID="$(id -u)"
  CURRENT_GID="$(id -g)"
  cat >&2 <<EOF
portTrack: cannot write to $DATA_DIR

  The container runs as UID:GID ${CURRENT_UID}:${CURRENT_GID}, but the mounted host
  directory is not writable by that user. Your encrypted vault lives on your own
  disk (ADR-012), so its ownership is yours to set, not the container's.

  Fix it on the HOST with:

      sudo chown -R ${CURRENT_UID}:${CURRENT_GID} <your PORTTRACK_DATA_DIR>

  or set PORTTRACK_UID / PORTTRACK_GID in .env to match your own user
  (find them with: id -u && id -g) and rebuild.
EOF
  exit 1
fi
rm -f "$DATA_DIR/.porttrack-write-probe"

exec "$@"
