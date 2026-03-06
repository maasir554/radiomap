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
  ./anchor.sh --id BLUEPOINT-01 --x 0 --y 5
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

validate_meter_value() {
  local value="$1"
  [[ "${value}" =~ ^-?[0-9]+([.][0-9]+)?$ ]]
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

prompt_coordinates() {
  local x_input=""
  local y_input=""

  printf "Enter X coordinate in meters (blank to skip): "
  read -r x_input
  if [[ -z "${x_input}" ]]; then
    echo ""
    return 0
  fi
  validate_meter_value "${x_input}" || { echo "Invalid X coordinate."; return 1; }

  printf "Enter Y coordinate in meters: "
  read -r y_input
  validate_meter_value "${y_input}" || { echo "Invalid Y coordinate."; return 1; }

  echo "${x_input},${y_input}"
}

ANCHOR_ID=""
BUILD_ONLY=0
COORD_X=""
COORD_Y=""

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
    --x)
      [[ $# -ge 2 ]] || { echo "Missing value for --x"; usage; exit 2; }
      COORD_X="$2"
      validate_meter_value "${COORD_X}" || { echo "Invalid X coordinate: ${COORD_X}"; exit 2; }
      shift 2
      ;;
    --y)
      [[ $# -ge 2 ]] || { echo "Missing value for --y"; usage; exit 2; }
      COORD_Y="$2"
      validate_meter_value "${COORD_Y}" || { echo "Invalid Y coordinate: ${COORD_Y}"; exit 2; }
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

if [[ -n "${COORD_X}" && -z "${COORD_Y}" ]] || [[ -z "${COORD_X}" && -n "${COORD_Y}" ]]; then
  echo "Both --x and --y must be provided together."
  exit 2
fi

if [[ -z "${COORD_X}" && -z "${COORD_Y}" ]]; then
  coord_pair="$(prompt_coordinates || true)"
  if [[ -n "${coord_pair}" ]]; then
    COORD_X="${coord_pair%%,*}"
    COORD_Y="${coord_pair##*,}"
  fi
fi

echo "Starting advertiser for ${ANCHOR_ID}..."
if [[ -n "${COORD_X}" ]]; then
  echo "Using coordinates: x=${COORD_X}m, y=${COORD_Y}m"
  "${BINARY_PATH}" --id "${ANCHOR_ID}" --x "${COORD_X}" --y "${COORD_Y}"
else
  "${BINARY_PATH}" --id "${ANCHOR_ID}"
fi
