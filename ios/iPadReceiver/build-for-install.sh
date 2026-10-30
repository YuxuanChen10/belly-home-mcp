#!/bin/bash
set -euo pipefail

project_dir="$(cd "$(dirname "$0")" && pwd)"
build_dir="$project_dir/build"
cmp "$project_dir/Receiver/Resources/test-image.png" "$project_dir/Receiver/Resources/test-image-png.data"

xcodebuild \
  -project "$project_dir/iPadReceiver.xcodeproj" \
  -target iPadReceiver \
  -configuration Debug \
  -sdk iphoneos \
  -allowProvisioningUpdates \
  "SYMROOT=$build_dir/Products" \
  "OBJROOT=$build_dir/Intermediates" \
  clean build

app="$build_dir/Products/Debug-iphoneos/iPadReceiver.app"
codesign --verify --deep --strict "$app"
test -f "$app/embedded.mobileprovision"
cmp "$project_dir/Receiver/Resources/test-image.png" "$app/test-image-png.data"
printf 'Install this signed app in Xcode Devices and Simulators: %s\n' "$app"
