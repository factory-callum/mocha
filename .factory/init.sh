#!/bin/bash
set -e

cd /home/ec2-user/workspace/mocha

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
  npm install
fi

# Compile TypeScript if tsconfig has emit enabled (not noEmit-only)
if grep -q '"noEmit": true' tsconfig.json 2>/dev/null; then
  echo "TypeScript configured for check-only (noEmit), skipping compilation"
else
  echo "Compiling TypeScript..."
  npx tsc || echo "TypeScript compilation had errors (may be expected during migration)"
fi
