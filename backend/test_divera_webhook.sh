#!/bin/bash
# Test script for Divera webhook using curl
# Usage:
#   ./test_divera_webhook.sh                    # Test locally
#   ./test_divera_webhook.sh production         # Test on Railway
#   ./test_divera_webhook.sh http://custom-url  # Custom URL

set -e

# Determine backend URL
if [ "$1" = "production" ]; then
    BASE_URL="${PRODUCTION_URL:?Set PRODUCTION_URL environment variable}"
elif [ -n "$1" ]; then
    BASE_URL="$1"
else
    BASE_URL="http://localhost:8000"
fi

WEBHOOK_URL="${BASE_URL}/api/divera/webhook"

echo "🔧 Testing Divera Webhook"
echo "Target: $WEBHOOK_URL"
echo ""

# Test payload matching actual Divera PRO webhook format
PAYLOAD=$(cat <<EOF
{
  "id": 999001,
  "number": "E-TEST-001",
  "title": "FEUER3 - Testnotfall Gebäudebrand",
  "text": "Dies ist ein Testnotfall. Brand in Wohnhaus mit Menschenrettung.",
  "address": "Musterstrasse 123, 4410 Liestal",
  "lat": 47.4859,
  "lng": 7.7342,
  "priority": 2,
  "cluster": ["Liestal"],
  "group": ["Zug 1", "Zug 2"],
  "vehicle": ["TLF-1", "DLK-1", "MTW-1"],
  "ts_create": $(date +%s),
  "ts_update": $(date +%s)
}
EOF
)

echo "Sending test webhook..."
echo ""

# Send webhook
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD")

# Extract status code (last line)
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
# Extract body (all but last line)
BODY=$(echo "$RESPONSE" | sed '$d')

echo "Status Code: $HTTP_CODE"
echo "Response:"
echo "$BODY" | python3 -m json.tool 2>/dev/null || echo "$BODY"
echo ""

if [ "$HTTP_CODE" = "200" ]; then
    echo "✅ Webhook test successful!"
    exit 0
else
    echo "❌ Webhook test failed!"
    exit 1
fi
