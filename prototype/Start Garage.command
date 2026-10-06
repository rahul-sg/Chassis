#!/bin/zsh
set -e
cd -- "${0:A:h}"
if ! command -v node >/dev/null 2>&1; then
  print 'Node.js is required. Install Node, then run this launcher again.'
  read '?Press Return to close.'
  exit 1
fi
print 'Starting Garage 360 locally. Open http://localhost:4311 in your browser.'
node server.mjs
