#!/bin/bash
# DATABASE SAFETY SCANNER
# Run this before deploying to scan for dangerous database patterns.
# Usage: bash scripts/db-safety-check.sh
#
# This script exists because the production database was deleted 4 times
# due to code that accidentally renamed/deleted the .db file during deployment.

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "=== Database Safety Scanner ==="
echo ""

ISSUES=0

# Scan all TypeScript/JavaScript files (excluding node_modules, dist)
FILES=$(find . -type f \( -name "*.ts" -o -name "*.js" \) -not -path "*/node_modules/*" -not -path "*/dist/*" -not -path "*/.git/*" -not -path "*/scripts/*")

for FILE in $FILES; do
  # Check for unlinkSync on DB files
  if grep -nE 'unlinkSync.*aimailpilot\.db|unlinkSync.*DB_PATH' "$FILE" 2>/dev/null; then
    echo -e "${RED}DANGER:${NC} $FILE — unlinkSync on database file"
    ISSUES=$((ISSUES + 1))
  fi

  # Check for renameSync on DB files
  if grep -nE 'renameSync.*aimailpilot\.db|renameSync.*DB_PATH' "$FILE" 2>/dev/null; then
    echo -e "${RED}DANGER:${NC} $FILE — renameSync on database file"
    ISSUES=$((ISSUES + 1))
  fi

  # Check for integrity_check pragma
  if grep -nE "pragma.*integrity_check|integrity_check.*pragma" "$FILE" 2>/dev/null; then
    echo -e "${RED}DANGER:${NC} $FILE — integrity_check pragma (fails on Azure CIFS)"
    ISSUES=$((ISSUES + 1))
  fi

  # Check for database recreation
  if grep -nE 'resetDatabase|wipeDatabase|dropAllTables|deleteDatabase' "$FILE" 2>/dev/null; then
    # Exclude the disabled resetCorruptDatabase that just returns an error
    if ! grep -B2 "GUARDRAIL\|REMOVED\|disabled\|NEVER" "$FILE" 2>/dev/null | grep -q "$(grep -nE 'resetDatabase|wipeDatabase' "$FILE" 2>/dev/null | head -1 | cut -d: -f1)"; then
      echo -e "${YELLOW}WARNING:${NC} $FILE — database reset/delete/wipe pattern found"
      ISSUES=$((ISSUES + 1))
    fi
  fi

  # Check for rmSync/rimraf on data directory
  if grep -nE 'rmSync.*data|rimraf.*data' "$FILE" 2>/dev/null; then
    echo -e "${RED}DANGER:${NC} $FILE — recursive delete on data directory"
    ISSUES=$((ISSUES + 1))
  fi
done

echo ""
if [ $ISSUES -eq 0 ]; then
  echo -e "${GREEN}All clear! No dangerous database patterns found.${NC}"
else
  echo -e "${RED}Found $ISSUES potential issue(s). Review before deploying!${NC}"
fi

# Also check that guardrails are still in place
echo ""
echo "=== Guardrail Verification ==="
if grep -q "DB-GUARDRAIL" server/storage.ts 2>/dev/null; then
  echo -e "${GREEN}OK:${NC} Runtime file protection guardrail is in place"
else
  echo -e "${RED}MISSING:${NC} Runtime file protection guardrail NOT found in server/storage.ts"
fi

if grep -q "GUARDRAIL.*resetCorruptDatabase\|REMOVED.*resetCorruptDatabase" server/storage.ts 2>/dev/null; then
  echo -e "${GREEN}OK:${NC} resetCorruptDatabase is disabled"
else
  echo -e "${YELLOW}WARNING:${NC} Cannot verify resetCorruptDatabase is disabled"
fi

if grep -q "NEVER.*delete.*rename\|NEVER.*rename.*delete" server/storage.ts 2>/dev/null; then
  echo -e "${GREEN}OK:${NC} Safety comments are present in storage.ts"
else
  echo -e "${YELLOW}WARNING:${NC} Safety comments may be missing from storage.ts"
fi

exit $ISSUES
