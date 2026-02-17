#!/bin/bash
VERSION=$(grep '"version"' manifest.json | cut -d'"' -f 4)
sed -i -E "s/\"version\": \"v[^\"]+\"/\"version\": \"v$VERSION\"/g" .zenodo.json
sed -i -E "s/v[0-9]+\.[0-9]+\.[0-9]+/v$VERSION/g" popup/interface.html
zip -r zeeschuimer-v$VERSION.zip . -x "*.DS_Store" "__MACOSX" js/mitm.js js/ponyfill-2.0.2.js js/streamsaver-2.0.3.js js/webtorrent.min.js -x "*.git*" -x "*.idea*" -x "create-zip.sh" -x "*.zip" -x "*.xpi" -x "tests*" -x "images/zeeschuimer-full.png" -x "images/chirico-full.png" -x "images/example_screenshot.png"
