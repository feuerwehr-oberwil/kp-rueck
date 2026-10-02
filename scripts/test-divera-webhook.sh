#!/bin/bash
# Manual smoke test for the Divera webhook using curl. NOT part of the test suite (that is
# backend/tests/test_api/test_alarms.py); it lived in backend/ until 2026-09-23, where it sat
# next to the code that ships in the image and looked like one.
#
# ⚠️ It POSTs a FEUER3 alarm. Against a board with an auto-attach event that becomes a real
# incident card, so `production` is for a station that has agreed to it, not for curiosity.
#
# The webhook fails closed without a secret, so pass the station's `alarm_webhook_secret`:
#   WEBHOOK_SECRET=… ./scripts/test-divera-webhook.sh                    # Test locally
#   WEBHOOK_SECRET=… ./scripts/test-divera-webhook.sh production         # $PRODUCTION_URL
#   WEBHOOK_SECRET=… ./scripts/test-divera-webhook.sh http://custom-url  # Custom URL

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
  -H "X-Webhook-Secret: ${WEBHOOK_SECRET:-}" \
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
