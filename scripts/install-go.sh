#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(cat "$ROOT_DIR/.go-version")"
INSTALL_DIR="${GO_INSTALL_DIR:-$HOME/.local/go}"
ARCH="$(uname -m)"

case "$ARCH" in
  x86_64) GOARCH="amd64" ;;
  aarch64|arm64) GOARCH="arm64" ;;
  *) echo "Unsupported architecture: $ARCH" >&2; exit 1 ;;
esac

if [[ -x "$INSTALL_DIR/bin/go" ]]; then
  INSTALLED="$("$INSTALL_DIR/bin/go" version | awk '{print $3}')"
  if [[ "$INSTALLED" == "go$VERSION" ]]; then
    echo "Go $VERSION already installed at $INSTALL_DIR"
    exit 0
  fi
fi

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/hitman-go.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

ARCHIVE="go$VERSION.linux-$GOARCH.tar.gz"
URL="https://go.dev/dl/$ARCHIVE"
echo "Downloading $URL"
curl -fsSL "$URL" -o "$TMP_DIR/$ARCHIVE"

echo "Looking up the official checksum"
CHECKSUM="$(curl -fsSL 'https://go.dev/dl/?mode=json&include=all' | node -e '
  let data = "";
  process.stdin.on("data", (chunk) => (data += chunk));
  process.stdin.on("end", () => {
    const tracks = JSON.parse(data);
    for (const track of tracks) {
      for (const file of track.files ?? []) {
        if (file.filename === process.argv[1]) {
          process.stdout.write(file.sha256);
          return;
        }
      }
    }
    process.exit(2);
  });
' "$ARCHIVE")"

echo "$CHECKSUM  $TMP_DIR/$ARCHIVE" | sha256sum -c - >/dev/null

mkdir -p "$INSTALL_DIR"
rm -rf "$INSTALL_DIR/go"
tar -C "$TMP_DIR" -xzf "$TMP_DIR/$ARCHIVE"
rm -rf "$INSTALL_DIR"
mv "$TMP_DIR/go" "$INSTALL_DIR"

echo "Installed Go $VERSION to $INSTALL_DIR"
echo "Add this to your shell profile if it is not already present:"
echo "  export PATH=\"$INSTALL_DIR/bin:\$PATH\""
