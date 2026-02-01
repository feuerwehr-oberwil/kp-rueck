#!/usr/bin/env python3
"""
Print Agent for KP Rueck Thermal Printer Integration.

This agent runs on the command post computer and:
1. Fetches printer configuration from the backend
2. Polls the backend for pending print jobs
3. Claims and prints each job
4. Reports completion status back to the backend

Environment Variables:
    BACKEND_URL: Backend API URL (default: http://localhost:8000)
    POLL_INTERVAL: Seconds between polls (default: 2)
    DRY_RUN: Set to "true" to simulate printing without a real printer
    LOG_LEVEL: Logging level (default: INFO)

Usage:
    python agent.py
    # or with uv:
    uv run python agent.py

    # Dry run mode (no printer needed):
    DRY_RUN=true uv run python agent.py
"""

import asyncio
import json
import logging
import os
import signal
import sys
from datetime import datetime

import httpx

# Configuration from environment
BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:8000")
POLL_INTERVAL = int(os.getenv("POLL_INTERVAL", "2"))
DRY_RUN = os.getenv("DRY_RUN", "false").lower() == "true"
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")

# Setup logging
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL.upper()),
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

# Global shutdown flag
shutdown_event = asyncio.Event()


def signal_handler(signum, frame):
    """Handle shutdown signals gracefully."""
    logger.info("Shutdown signal received, stopping...")
    shutdown_event.set()


class PrintAgent:
    """Print agent that polls for and processes print jobs."""

    def __init__(self, backend_url: str, dry_run: bool = False):
        self.backend_url = backend_url.rstrip("/")
        self.dry_run = dry_run
        self.client = httpx.AsyncClient(timeout=30.0, http2=False)
        self.printer_ip = None
        self.printer_port = 9100
        self.printer_enabled = False
        self.jobs_processed = 0
        self.errors = 0

    async def close(self):
        """Close HTTP client."""
        await self.client.aclose()

    async def fetch_printer_config(self) -> bool:
        """Fetch printer configuration from backend."""
        try:
            response = await self.client.get(
                f"{self.backend_url}/api/print/config/"
            )
            if response.status_code == 200:
                config = response.json()
                self.printer_enabled = config.get("enabled", False)
                self.printer_ip = config.get("ip", "")
                self.printer_port = config.get("port", 9100)
                logger.info(f"Fetched config: enabled={self.printer_enabled}, ip={self.printer_ip}, port={self.printer_port}")
                return True
            else:
                logger.warning(f"Failed to fetch config: HTTP {response.status_code}")
                return False
        except httpx.ConnectError as e:
            logger.error(f"Cannot connect to backend at {self.backend_url}: {e}")
            return False
        except Exception as e:
            logger.error(f"Error fetching config: {type(e).__name__}: {e}")
            return False

    async def check_backend_health(self) -> bool:
        """Check if backend is reachable."""
        try:
            response = await self.client.get(f"{self.backend_url}/health")
            return response.status_code == 200
        except Exception as e:
            logger.warning(f"Backend health check failed: {e}")
            return False

    def check_printer_health(self) -> bool:
        """Check if printer is reachable."""
        if self.dry_run:
            return True
        if not self.printer_ip:
            return False
        try:
            import socket
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(2)
            result = sock.connect_ex((self.printer_ip, self.printer_port))
            sock.close()
            return result == 0
        except Exception as e:
            logger.warning(f"Printer health check failed: {e}")
            return False

    async def fetch_pending_jobs(self) -> list[dict]:
        """Fetch pending print jobs from backend."""
        try:
            response = await self.client.get(
                f"{self.backend_url}/api/print/jobs/pending/",
                params={"limit": 10}
            )
            if response.status_code == 200:
                return response.json()
            else:
                logger.warning(f"Failed to fetch jobs: HTTP {response.status_code} - {response.text}")
                return []
        except httpx.ConnectError as e:
            logger.error(f"Cannot connect to backend at {self.backend_url}: {e}")
            return []
        except Exception as e:
            logger.error(f"Error fetching jobs: {type(e).__name__}: {e}")
            return []

    async def claim_job(self, job_id: str) -> bool:
        """Claim a print job."""
        try:
            response = await self.client.patch(
                f"{self.backend_url}/api/print/jobs/{job_id}/claim/"
            )
            if response.status_code == 200:
                logger.info(f"Claimed job {job_id}")
                return True
            else:
                logger.warning(f"Failed to claim job {job_id}: {response.status_code}")
                return False
        except Exception as e:
            logger.error(f"Error claiming job {job_id}: {e}")
            return False

    async def complete_job(self, job_id: str, success: bool, error_message: str = None):
        """Report job completion."""
        try:
            status = "completed" if success else "failed"
            response = await self.client.patch(
                f"{self.backend_url}/api/print/jobs/{job_id}/complete/",
                json={
                    "status": status,
                    "error_message": error_message
                }
            )
            if response.status_code == 200:
                logger.info(f"Reported job {job_id} as {status}")
            else:
                logger.warning(f"Failed to report job completion: {response.status_code}")
        except Exception as e:
            logger.error(f"Error reporting job completion: {e}")

    def print_job_dry_run(self, job: dict) -> tuple[bool, str | None]:
        """Simulate printing a job (dry run mode)."""
        job_type = job.get("job_type")
        payload = job.get("payload", {})

        logger.info("=" * 40)
        logger.info(f"[DRY RUN] Would print {job_type}:")
        logger.info("=" * 40)

        if job_type == "assignment":
            logger.info(f"  Title: {payload.get('title', 'N/A')}")
            logger.info(f"  Type: {payload.get('type', 'N/A')}")
            logger.info(f"  Location: {payload.get('location', 'N/A')}")
            logger.info(f"  Description: {payload.get('description', 'N/A')[:50]}...")
            logger.info(f"  Crew: {len(payload.get('crew', []))} members")
            logger.info(f"  Vehicles: {len(payload.get('vehicles', []))} assigned")
            logger.info(f"  Materials: {len(payload.get('materials', []))} items")
        elif job_type == "board":
            logger.info(f"  Event: {payload.get('event_name', 'N/A')}")
            logger.info(f"  Incidents: {len(payload.get('incidents', []))}")
            logger.info(f"  Vehicles: {len(payload.get('vehicle_status', []))}")
            personnel = payload.get('personnel_summary', {})
            logger.info(f"  Personnel: {personnel.get('present', 0)}/{personnel.get('total', 0)}")

        logger.info("=" * 40)
        return True, None

    def print_job(self, job: dict) -> tuple[bool, str | None]:
        """
        Print a job.

        Returns (success, error_message).
        """
        if self.dry_run:
            return self.print_job_dry_run(job)

        job_type = job.get("job_type")
        payload = job.get("payload", {})

        try:
            from escpos.printer import Network
            from formatters import format_assignment_slip, format_board_snapshot

            # Create new connection for each job
            p = Network(self.printer_ip, port=self.printer_port)

            if job_type == "assignment":
                format_assignment_slip(p, payload)
                logger.info(f"Printed assignment slip: {payload.get('title', 'unknown')}")
            elif job_type == "board":
                format_board_snapshot(p, payload)
                logger.info(f"Printed board snapshot: {payload.get('event_name', 'unknown')}")
            else:
                logger.warning(f"Unknown job type: {job_type}")
                p.close()
                return False, f"Unknown job type: {job_type}"

            p.close()
            return True, None

        except Exception as e:
            error_msg = str(e)
            logger.error(f"Print error: {error_msg}")
            return False, error_msg

    async def process_job(self, job: dict):
        """Process a single print job."""
        job_id = job.get("id")
        job_type = job.get("job_type")

        logger.info(f"Processing {job_type} job {job_id}")

        # Claim the job
        if not await self.claim_job(job_id):
            return

        # Print it
        success, error_message = self.print_job(job)

        # Report completion
        await self.complete_job(job_id, success, error_message)

        if success:
            self.jobs_processed += 1
        else:
            self.errors += 1

    async def run(self):
        """Main polling loop."""
        logger.info("=" * 50)
        logger.info("KP Rueck Print Agent Starting")
        logger.info("=" * 50)
        logger.info(f"Backend URL: {self.backend_url}")
        if self.dry_run:
            logger.info("Mode: DRY RUN (no actual printing)")
        logger.info(f"Poll interval: {POLL_INTERVAL}s")
        logger.info("=" * 50)

        # Fetch printer config from backend
        logger.info("Fetching printer configuration from backend...")
        config_ok = await self.fetch_printer_config()

        if not config_ok:
            logger.error("Failed to fetch printer config - will retry")
        elif not self.printer_enabled and not self.dry_run:
            logger.warning("Printer is disabled in settings - enable it in the settings page")

        # Health checks
        backend_ok = await self.check_backend_health()
        if not backend_ok:
            logger.warning("Backend health check failed - will retry")
        else:
            logger.info("Backend connection: OK")

        if not self.dry_run:
            printer_ok = self.check_printer_health()
            if not printer_ok:
                logger.warning(f"Printer at {self.printer_ip}:{self.printer_port} is not reachable")
            else:
                logger.info(f"Printer connection: OK ({self.printer_ip}:{self.printer_port})")

        logger.info("Starting poll loop...")

        poll_count = 0
        config_refresh_interval = 30  # Refresh config every 30 polls (~1 minute)

        while not shutdown_event.is_set():
            try:
                # Periodically refresh printer config
                if poll_count > 0 and poll_count % config_refresh_interval == 0:
                    await self.fetch_printer_config()

                # Skip polling if printer is disabled (unless dry run)
                if not self.printer_enabled and not self.dry_run:
                    if poll_count % 30 == 0:  # Log every minute
                        logger.info("Printer disabled - waiting for it to be enabled in settings...")
                else:
                    # Fetch pending jobs
                    jobs = await self.fetch_pending_jobs()

                    if jobs:
                        logger.info(f"Found {len(jobs)} pending job(s)")
                        for job in jobs:
                            if shutdown_event.is_set():
                                break
                            await self.process_job(job)

                # Wait for next poll interval
                try:
                    await asyncio.wait_for(
                        shutdown_event.wait(),
                        timeout=POLL_INTERVAL
                    )
                except asyncio.TimeoutError:
                    pass

                poll_count += 1
                # Log stats periodically (every 30 polls = ~1 minute at 2s interval)
                if poll_count % 30 == 0 and (self.printer_enabled or self.dry_run):
                    logger.info(
                        f"Stats: {self.jobs_processed} jobs printed, "
                        f"{self.errors} errors"
                    )

            except Exception as e:
                logger.error(f"Error in poll loop: {e}")
                # Wait before retrying
                await asyncio.sleep(5)

        logger.info("Print agent stopped")
        logger.info(f"Final stats: {self.jobs_processed} jobs, {self.errors} errors")


async def main():
    """Main entry point."""
    # Setup signal handlers
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    agent = PrintAgent(
        backend_url=BACKEND_URL,
        dry_run=DRY_RUN,
    )

    try:
        await agent.run()
    finally:
        await agent.close()


if __name__ == "__main__":
    asyncio.run(main())
