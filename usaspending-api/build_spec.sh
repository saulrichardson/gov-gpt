#!/usr/bin/env bash
#!/usr/bin/env bash
# =============================================================================
# build_spec.sh – Convert API-Blueprint contracts to a bundled OpenAPI spec.
# =============================================================================

set -euo pipefail

# --------------------------- default settings --------------------------------
# Path for bundled spec
OUTFILE="build/usaspending.yaml"
RUN_LINT=true
FORCE_LINT=false

# --------------------------- helper functions -------------------------------
die() { echo "❌  $*" >&2; exit 1; }

need() { command -v "$1" >/dev/null 2>&1 || die "$1 not found on PATH"; }

# required external tools
need apib2swagger
need swagger2openapi
need swagger-cli

if ! command -v spectral >/dev/null 2>&1; then
  RUN_LINT=false
  echo "⚠️  spectral not found – skipping lint"
fi

has_ruleset() {
  [ -f .spectral.yaml ] || [ -f .spectral.yml ] || \
  [ -f .spectral.json ] || [ -f .spectral.js ]
}

# --------------------------- parse arguments ---------------------------------
while [ $# -gt 0 ]; do
  case $1 in
    --out)          OUTFILE=${2:-}; shift ;;
    --skip-lint)    RUN_LINT=false ;;
    --force-lint)   RUN_LINT=true; FORCE_LINT=true ;;
    -h|--help)
      cat <<EOF
Usage: $0 [options]

Options
  --out <file>        Output bundle path (default: build/usaspending.yaml)
  --skip-lint         Skip Spectral lint step
  --force-lint        Run Spectral even if no ruleset is found
  -h, --help          Show this help and exit
EOF
      exit 0 ;;
    *) die "Unknown option: $1" ;;
  esac
  shift
done

if $RUN_LINT && ! has_ruleset && ! $FORCE_LINT; then
  echo "ℹ️  No Spectral ruleset detected – skipping lint"
  RUN_LINT=false
fi

# --------------------------- prepare build dirs ------------------------------
rm -rf build
mkdir -p build/swagger build/spec

# --------------------------- gather Markdown files ---------------------------
# Root path containing all contract markdown files
FIND_PATH="usaspending_api/api_contracts"

# --------- collect files into FILES array (portable across Bash versions) ----
FILES=()
while IFS= read -r -d '' f; do
  FILES+=("$f")
done < <(find "$FIND_PATH" -type f -name '*.md' -print0)

TOTAL=${#FILES[@]}
[ "$TOTAL" -eq 0 ] && die "No contracts found for scope '$SCOPE'"

# --------------------------- convert each contract ---------------------------
echo "🔄  Converting $TOTAL contract(s)…"

ok=0; bad=0; n=0
for f in "${FILES[@]}"; do
  ((n++))
  base=$(basename "$f" .md)
  printf "[%3d/%3d] %-70s " "$n" "$TOTAL" "${f#usaspending_api/}"

  if apib2swagger "$f" -o "build/swagger/${base}.yaml" 2>/dev/null && \
     swagger2openapi "build/swagger/${base}.yaml" -o "build/spec/${base}.yaml" -y >/dev/null; then
    ((ok++)); echo "✓"
  else
    ((bad++)); echo "✗"
  fi
done

echo "✅  Converted: $ok   ❌  Failed: $bad"

[ "$ok" -eq 0 ] && die "No contracts converted successfully – aborting"

# --------------------------- bundle -----------------------------------------
echo "📦  Bundling $ok spec fragment(s)…"
swagger-cli bundle build/spec/*.yaml -o "$OUTFILE"

# --------------------------- lint -------------------------------------------
if $RUN_LINT; then
  echo "🔍  Linting with Spectral…"
  spectral lint "$OUTFILE"
fi

echo "🎉  Done – bundled spec at $OUTFILE"
