#!/usr/bin/env python3
"""
Test script for Divera webhook integration.

This script allows testing the Divera webhook endpoint without triggering
the actual Divera API. It sends test webhook payloads to the local or
production backend.

Usage:
    # Test locally (default: http://localhost:8000)
    python test_divera_webhook.py

    # Test on Railway production
    python test_divera_webhook.py --production

    # Custom URL
    python test_divera_webhook.py --url https://your-backend.railway.app

    # Send multiple test emergencies
    python test_divera_webhook.py --count 3
"""

import argparse
import json
import os
import sys
from datetime import datetime

import requests

# Sample test payloads matching actual Divera PRO webhook format
SAMPLE_PAYLOADS = [
    {
        "id": 999001,
        "number": "E-TEST-001",
        "title": "FEUER3 - Gebäudebrand",
        "text": "Testnotfall: Brand in Wohnhaus, mehrere Personen vermisst. Starke Rauchentwicklung.",
        "address": "Musterstrasse 123, 4410 Liestal",
        "lat": 47.4859,
        "lng": 7.7342,
        "priority": 2,  # High priority
        "cluster": ["Liestal"],
        "group": ["Zug 1", "Zug 2"],
        "vehicle": ["TLF-1", "DLK-1", "MTW-1"],
        "ts_create": int(datetime.now().timestamp()),
        "ts_update": int(datetime.now().timestamp()),
    },
    {
        "id": 999002,
        "number": "E-TEST-002",
        "title": "VU - Verkehrsunfall mit eingeklemmter Person",
        "text": "Testnotfall: Schwerer Verkehrsunfall auf Hauptstrasse, 2 Fahrzeuge, 1 Person eingeklemmt.",
        "address": "Rheinstrasse 45, 4410 Liestal",
        "lat": 47.4822,
        "lng": 7.7389,
        "priority": 2,  # High priority
        "cluster": ["Liestal"],
        "group": ["Zug 1"],
        "vehicle": ["TLF-1", "RW-1"],
        "ts_create": int(datetime.now().timestamp()),
        "ts_update": int(datetime.now().timestamp()),
    },
    {
        "id": 999003,
        "number": "E-TEST-003",
        "title": "THL - Baum auf Strasse",
        "text": "Testnotfall: Umgestürzter Baum blockiert Fahrbahn.",
        "address": "Waldweg 7, 4410 Liestal",
        "lat": 47.4901,
        "lng": 7.7412,
        "priority": 0,  # Low priority
        "cluster": ["Liestal"],
        "group": ["Zug 1"],
        "vehicle": ["TLF-1"],
        "ts_create": int(datetime.now().timestamp()),
        "ts_update": int(datetime.now().timestamp()),
    },
    {
        "id": 999004,
        "number": "E-TEST-004",
        "title": "BMA - Brandmeldeanlage",
        "text": "Testnotfall: Brandmeldeanlage ausgelöst in Bürogebäude.",
        "address": "Industriestrasse 88, 4410 Liestal",
        "lat": 47.4777,
        "lng": 7.7301,
        "priority": 1,  # Medium priority
        "cluster": ["Liestal"],
        "group": ["Zug 1"],
        "vehicle": ["TLF-1", "MTW-1"],
        "ts_create": int(datetime.now().timestamp()),
        "ts_update": int(datetime.now().timestamp()),
    },
    {
        "id": 999005,
        "number": "E-TEST-005",
        "title": "ÖLWEHR - Ölspur auf Strasse",
        "text": "Testnotfall: Grössere Ölspur auf Kantonsstrasse.",
        "address": "Hauptstrasse 234, 4410 Liestal",
        "lat": 47.4833,
        "lng": 7.7356,
        "priority": 1,  # Medium priority
        "cluster": ["Liestal"],
        "group": ["Zug 1"],
        "vehicle": ["TLF-1"],
        "ts_create": int(datetime.now().timestamp()),
        "ts_update": int(datetime.now().timestamp()),
    },
]


def send_webhook(base_url: str, payload: dict, verbose: bool = True) -> bool:
    """
    Send a test webhook payload to the backend.

    Args:
        base_url: Backend base URL (e.g., "http://localhost:8000")
        payload: Divera webhook payload dictionary
        verbose: Print detailed information

    Returns:
        True if successful, False otherwise
    """
    url = f"{base_url}/api/divera/webhook"

    if verbose:
        print(f"\n{'=' * 60}")
        print(f"Sending webhook to: {url}")
        print(f"Emergency ID: {payload['id']}")
        print(f"Number: {payload.get('number', 'N/A')}")
        print(f"Title: {payload['title']}")
        print(f"Priority: {payload['priority']} (0=low, 1=medium, 2=high)")
        print(f"{'=' * 60}")

    try:
        response = requests.post(
            url,
            json=payload,
            headers={"Content-Type": "application/json"},
            timeout=10,
        )

        if verbose:
            print(f"Status Code: {response.status_code}")
            print(f"Response: {json.dumps(response.json(), indent=2)}")

        if response.status_code == 200:
            if verbose:
                print("✅ Webhook accepted successfully!")
            return True
        else:
            if verbose:
                print(f"❌ Webhook failed with status {response.status_code}")
            return False

    except requests.exceptions.ConnectionError:
        print(f"❌ Connection failed. Is the backend running at {base_url}?")
        return False
    except requests.exceptions.Timeout:
        print("❌ Request timed out")
        return False
    except Exception as e:
        print(f"❌ Error: {e}")
        return False


def main():
    """Main entry point for test script."""
    parser = argparse.ArgumentParser(
        description="Test Divera webhook integration without triggering real API",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Test locally
  python test_divera_webhook.py

  # Test on production
  python test_divera_webhook.py --production

  # Send 3 test emergencies
  python test_divera_webhook.py --count 3

  # Use custom payload
  python test_divera_webhook.py --payload '{"id": 12345, "title": "Test", ...}'
        """,
    )

    parser.add_argument(
        "--url",
        type=str,
        help="Backend URL (default: http://localhost:8000)",
    )
    parser.add_argument(
        "--production",
        action="store_true",
        help="Use production URL from PRODUCTION_URL env var",
    )
    parser.add_argument(
        "--count",
        type=int,
        default=1,
        help="Number of test emergencies to send (default: 1, max: 5)",
    )
    parser.add_argument(
        "--payload",
        type=str,
        help="Custom JSON payload (overrides --count)",
    )
    parser.add_argument(
        "-q",
        "--quiet",
        action="store_true",
        help="Quiet mode - minimal output",
    )

    args = parser.parse_args()

    # Determine backend URL
    if args.production:
        base_url = os.environ.get("PRODUCTION_URL", "").rstrip("/")
        if not base_url:
            print("Error: Set PRODUCTION_URL environment variable for --production mode")
            sys.exit(1)
    elif args.url:
        base_url = args.url.rstrip("/")
    else:
        base_url = "http://localhost:8000"

    verbose = not args.quiet

    if verbose:
        print("🔧 Divera Webhook Test Script")
        print(f"Target: {base_url}")
        print()

    # Handle custom payload
    if args.payload:
        try:
            payload = json.loads(args.payload)
            success = send_webhook(base_url, payload, verbose)
            sys.exit(0 if success else 1)
        except json.JSONDecodeError as e:
            print(f"❌ Invalid JSON payload: {e}")
            sys.exit(1)

    # Send test payloads
    count = min(args.count, len(SAMPLE_PAYLOADS))
    successes = 0
    failures = 0

    for i in range(count):
        payload = SAMPLE_PAYLOADS[i].copy()
        # Ensure unique IDs by adding timestamp offset
        payload["id"] = payload["id"] + i
        payload["ts_create"] = int(datetime.now().timestamp()) + i
        payload["ts_update"] = payload["ts_create"]

        if send_webhook(base_url, payload, verbose):
            successes += 1
        else:
            failures += 1

    # Summary
    if verbose:
        print(f"\n{'=' * 60}")
        print(f"Summary: {successes} succeeded, {failures} failed")
        print(f"{'=' * 60}")

    sys.exit(0 if failures == 0 else 1)


if __name__ == "__main__":
    main()
