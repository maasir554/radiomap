#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SWIFT_SOURCE="${SCRIPT_DIR}/BLEAnchorAdvertiser.swift"
BUILD_DIR="${SCRIPT_DIR}/.build"
BINARY_PATH="${BUILD_DIR}/ble-anchor"

usage() {
  cat <<'EOF'
Usage:
  ./anchor.sh                 # interactive mode (choose BLUEPOINT-01..04)
  ./anchor.sh --index 3       # starts BLUEPOINT-03
  ./anchor.sh --id BLUEPOINT-07
  ./anchor.sh --build-only

Notes:
  - Requires macOS with BLE peripheral support.
  - Press Ctrl+C to stop advertising.
EOF
}

validate_id() {
  local candidate="$1"
  [[ "${candidate}" =~ ^BLUEPOINT-[0-9]{2}$ ]]
}

resolve_anchor_id_from_index() {
  local idx="$1"
  if ! [[ "${idx}" =~ ^[0-9]+$ ]]; then
    return 1
  fi
  if (( idx < 1 || idx > 99 )); then
    return 1
  fi
  printf "BLUEPOINT-%02d" "${idx}"
}

build_binary_if_needed() {
  mkdir -p "${BUILD_DIR}"

  if [[ ! -f "${BINARY_PATH}" || "${SWIFT_SOURCE}" -nt "${BINARY_PATH}" ]]; then
    echo "Building BLE advertiser binary..."
    swiftc -O "${SWIFT_SOURCE}" -o "${BINARY_PATH}"
    echo "Build complete: ${BINARY_PATH}"
  fi
}

prompt_index() {
  echo "Select Anchor ID:"
  echo "  1) BLUEPOINT-01"
  echo "  2) BLUEPOINT-02"
  echo "  3) BLUEPOINT-03"
  echo "  4) BLUEPOINT-04"
  printf "Enter index (1-4): "
  read -r selected
  resolve_anchor_id_from_index "${selected}"
}

ANCHOR_ID=""
BUILD_ONLY=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --index)
      [[ $# -ge 2 ]] || { echo "Missing value for --index"; usage; exit 2; }
      ANCHOR_ID="$(resolve_anchor_id_from_index "$2" || true)"
      [[ -n "${ANCHOR_ID}" ]] || { echo "Invalid index: $2"; exit 2; }
      shift 2
      ;;
    --id)
      [[ $# -ge 2 ]] || { echo "Missing value for --id"; usage; exit 2; }
      ANCHOR_ID="$(echo "$2" | tr '[:lower:]' '[:upper:]')"
      validate_id "${ANCHOR_ID}" || { echo "Invalid ID: ${ANCHOR_ID}"; exit 2; }
      shift 2
      ;;
    --build-only)
      BUILD_ONLY=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      usage
      exit 2
      ;;
  esac
done

build_binary_if_needed

if (( BUILD_ONLY == 1 )); then
  exit 0
fi

if [[ -z "${ANCHOR_ID}" ]]; then
  ANCHOR_ID="$(prompt_index || true)"
  [[ -n "${ANCHOR_ID}" ]] || { echo "Invalid selection."; exit 2; }
fi

echo "Starting advertiser for ${ANCHOR_ID}..."
"${BINARY_PATH}" "${ANCHOR_ID}"
