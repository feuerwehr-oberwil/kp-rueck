#!/usr/bin/env python3
"""
Manual script to seed Railway database with training data.
Run this if the automatic seeding didn't work during deployment.

Usage:
    python seed_railway.py
"""

import asyncio
import os
from app.seed_training import seed_training_data
from app.database import async_session_maker


async def main():
    print("=" * 70)
    print("MANUAL RAILWAY DATABASE SEEDING")
    print("=" * 70)
    print("\nThis will seed the training emergency templates and locations.")
    print("Checking if DATABASE_URL is set...")

    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        print("\n❌ ERROR: DATABASE_URL environment variable not set!")
        print("   Please set it to your Railway PostgreSQL connection string:")
        print("   export DATABASE_URL='postgresql+asyncpg://...'")
        return

    print(f"✅ DATABASE_URL: {db_url[:50]}...")
    print("\nStarting seeding process (skipping geocoding for speed)...")

    try:
        await seed_training_data(skip_geocoding=True)
        print("\n" + "=" * 70)
        print("✅ SEEDING COMPLETE!")
        print("=" * 70)
        print("\nYou can now use training mode to generate emergencies.")
    except Exception as e:
        print("\n" + "=" * 70)
        print("❌ SEEDING FAILED!")
        print("=" * 70)
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    asyncio.run(main())
