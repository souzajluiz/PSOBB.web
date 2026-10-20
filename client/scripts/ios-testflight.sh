#!/usr/bin/env bash
# Builds the iOS app, archives it and uploads it to App Store Connect (TestFlight).
# Needs a Mac with the full Xcode, signed in to the Apple Developer account
# (Xcode > Settings > Accounts), and the app registered in App Store Connect
# with the bundle id app.psobbweb.client (docs/NATIVE.md).
#
#   APPLE_TEAM_ID=ABCDE12345 \
#   VITE_SERVER_ORIGIN=https://psobb.example.com \
#   BUILD_NUMBER=2 \
#   scripts/ios-testflight.sh
#
# BUILD_NUMBER must be higher than the last upload (default: a timestamp).
set -euo pipefail

: "${APPLE_TEAM_ID:?set APPLE_TEAM_ID (developer.apple.com > Membership)}"
: "${VITE_SERVER_ORIGIN:?set VITE_SERVER_ORIGIN (https, no trailing slash)}"
BUILD_NUMBER="${BUILD_NUMBER:-$(date +%y%m%d%H%M)}"

cd "$(dirname "$0")/.."
if ! xcodebuild -version >/dev/null 2>&1; then
  echo "xcodebuild needs the full Xcode: install it, then sudo xcode-select -s /Applications/Xcode.app" >&2
  exit 1
fi

npm ci
VITE_SERVER_ORIGIN="$VITE_SERVER_ORIGIN" npm run app:sync

OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT
cat > "$OUT/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>upload</string>
  <key>teamID</key><string>${APPLE_TEAM_ID}</string>
  <key>signingStyle</key><string>automatic</string>
  <key>uploadSymbols</key><true/>
</dict></plist>
PLIST

cd ios/App
xcodebuild -project App.xcodeproj -scheme App -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$OUT/App.xcarchive" \
  DEVELOPMENT_TEAM="$APPLE_TEAM_ID" CURRENT_PROJECT_VERSION="$BUILD_NUMBER" \
  -allowProvisioningUpdates archive

xcodebuild -exportArchive -archivePath "$OUT/App.xcarchive" \
  -exportOptionsPlist "$OUT/ExportOptions.plist" -allowProvisioningUpdates

echo "Uploaded build $BUILD_NUMBER. It shows in App Store Connect > TestFlight after processing."
