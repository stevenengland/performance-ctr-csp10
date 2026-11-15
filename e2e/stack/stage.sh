#!/bin/sh
# Lays out a built artifact as the webspace for the e2e stack:
#   e2e/stack/stage.sh <artifact dir> <stack root> <site url>
set -eu
artifact=$1
root=$2
site_url=$3
rm -rf "$root"
mkdir -p "$root"
cp -R "$artifact/web" "$root/site"
cp -R "$artifact/app" "$root/app"
cp "$(dirname "$0")/config.php" "$root/config.php"
node "$(dirname "$0")/../../deploy/cli.ts" render-htaccess "$site_url" > "$root/site/.htaccess"
