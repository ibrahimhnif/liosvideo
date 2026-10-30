#!/bin/sh
# liosvideo CLI installer
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/ibrahimhnif/liosvideo/main/install.sh | sh
#   curl -fsSL https://raw.githubusercontent.com/ibrahimhnif/liosvideo/main/install.sh | sh -s -- --version v0.1.1

set -eu

REPO="${LIOSVIDEO_REPO:-ibrahimhnif/liosvideo}"
VERSION="${LIOSVIDEO_VERSION:-latest}"
INSTALL_DIR="${LIOSVIDEO_INSTALL_DIR:-}"
RELEASE_BASE_URL="${LIOSVIDEO_RELEASE_BASE_URL:-https://github.com/${REPO}/releases}"

usage() {
  cat <<EOF
liosvideo CLI installer

Usage:
  sh install.sh [OPTIONS]
  curl -fsSL https://raw.githubusercontent.com/${REPO}/main/install.sh | sh
  curl -fsSL https://raw.githubusercontent.com/${REPO}/main/install.sh | sh -s -- [OPTIONS]

Options:
  -v, --version <VERSION>      Release tag to install (default: latest, e.g. v0.1.1)
  -d, --install-dir <DIR>      Directory to install the binary into
  -h, --help                   Show this help message

Environment Variables:
  LIOSVIDEO_VERSION            Release tag to install (default: latest)
  LIOSVIDEO_INSTALL_DIR        Target installation directory (default: /usr/local/bin or ~/.local/bin)
  LIOSVIDEO_REPO               GitHub repository (default: ibrahimhnif/liosvideo)
EOF
}

log_info() {
  printf "\033[1;34m==>\033[0m %s\n" "$*"
}

log_success() {
  printf "\033[1;32m==>\033[0m %s\n" "$*"
}

log_warn() {
  printf "\033[1;33mWarning:\033[0m %s\n" "$*" >&2
}

log_error() {
  printf "\033[1;31mError:\033[0m %s\n" "$*" >&2
  exit 1
}

while [ $# -gt 0 ]; do
  case "$1" in
    -v|--version)
      [ $# -ge 2 ] || log_error "Missing value for $1"
      VERSION="$2"
      shift 2
      ;;
    -d|--install-dir)
      [ $# -ge 2 ] || log_error "Missing value for $1"
      INSTALL_DIR="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      log_error "Unknown option: $1 (run with --help for usage)"
      ;;
  esac
done

OS_RAW="${LIOSVIDEO_OS:-$(uname -s)}"
ARCH_RAW="${LIOSVIDEO_ARCH:-$(uname -m)}"

BIN_NAME="liosvideo"
case "$OS_RAW" in
  Darwin)
    case "$ARCH_RAW" in
      x86_64|amd64|arm64|aarch64)
        ASSET_NAME="liosvideo-cli-macos.tar.gz"
        ;;
      *)
        log_error "Unsupported macOS architecture: ${ARCH_RAW}"
        ;;
    esac
    ;;
  Linux)
    case "$ARCH_RAW" in
      x86_64|amd64)
        ASSET_NAME="liosvideo-cli-linux-x64.tar.gz"
        ;;
      *)
        log_error "Unsupported Linux architecture: ${ARCH_RAW} (prebuilt binaries are currently available for x86_64)"
        ;;
    esac
    ;;
  MINGW*|MSYS*|CYGWIN*|Windows_NT)
    case "$ARCH_RAW" in
      x86_64|amd64)
        ASSET_NAME="liosvideo-cli-windows-x64.tar.gz"
        BIN_NAME="liosvideo.exe"
        ;;
      *)
        log_error "Unsupported Windows architecture: ${ARCH_RAW}"
        ;;
    esac
    ;;
  *)
    log_error "Unsupported operating system: ${OS_RAW}"
    ;;
esac

if [ -z "$INSTALL_DIR" ]; then
  if [ -d "/usr/local/bin" ] && [ -w "/usr/local/bin" ]; then
    INSTALL_DIR="/usr/local/bin"
  else
    INSTALL_DIR="${HOME}/.local/bin"
  fi
fi

if [ "$VERSION" = "latest" ]; then
  DOWNLOAD_URL="${RELEASE_BASE_URL}/latest/download/${ASSET_NAME}"
else
  case "$VERSION" in
    v*) TAG="$VERSION" ;;
    *)  TAG="v${VERSION}" ;;
  esac
  DOWNLOAD_URL="${RELEASE_BASE_URL}/download/${TAG}/${ASSET_NAME}"
fi

download_file() {
  url="$1"
  dest="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$dest"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$dest" "$url"
  else
    log_error "Neither 'curl' nor 'wget' was found. Please install curl or wget and try again."
  fi
}

command -v tar >/dev/null 2>&1 || log_error "'tar' is required to extract the release archive."

TMP_DIR="$(mktemp -d 2>/dev/null || mktemp -d -t liosvideo-install)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT INT TERM

ARCHIVE_PATH="${TMP_DIR}/${ASSET_NAME}"

log_info "Downloading ${ASSET_NAME} (${VERSION}) from ${DOWNLOAD_URL}..."
if ! download_file "$DOWNLOAD_URL" "$ARCHIVE_PATH"; then
  log_error "Failed to download ${DOWNLOAD_URL}. Check that version '${VERSION}' exists and has CLI release assets."
fi

log_info "Extracting ${BIN_NAME}..."
tar -xzf "$ARCHIVE_PATH" -C "$TMP_DIR"

EXTRACTED_BIN="${TMP_DIR}/${BIN_NAME}"
[ -f "$EXTRACTED_BIN" ] || log_error "Archive did not contain expected binary '${BIN_NAME}'."

chmod +x "$EXTRACTED_BIN"
mkdir -p "$INSTALL_DIR"

TARGET_BIN="${INSTALL_DIR}/${BIN_NAME}"
mv "$EXTRACTED_BIN" "$TARGET_BIN"

log_success "Successfully installed liosvideo to ${TARGET_BIN}"

case ":${PATH}:" in
  *":${INSTALL_DIR}:"*)
    ;;
  *)
    log_warn "${INSTALL_DIR} is not in your PATH."
    printf "Add it to your shell profile:\n\n"
    printf "  export PATH=\"%s:\$PATH\"\n\n" "$INSTALL_DIR"
    ;;
esac

if "$TARGET_BIN" --version >/dev/null 2>&1; then
  INSTALLED_VER="$("$TARGET_BIN" --version 2>/dev/null || true)"
  [ -n "$INSTALLED_VER" ] && log_info "Verified: ${INSTALLED_VER}"
fi
