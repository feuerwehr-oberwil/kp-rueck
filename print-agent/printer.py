"""ESC/POS thermal printer wrapper for Epson thermal printer.

This module provides a simple interface to the thermal printer
using python-escpos over network connection (80mm paper, Font B, WPC1252).
"""

import logging
import os

from escpos.printer import Network

logger = logging.getLogger(__name__)


class ThermalPrinter:
    """Wrapper for Epson TM-T20II/III thermal printer."""

    def __init__(self, ip: str = None, port: int = None):
        """Initialize printer connection settings."""
        self.ip = ip or os.getenv("PRINTER_IP", "")
        self.port = port or int(os.getenv("PRINTER_PORT", "9100"))
        self._printer = None

    def connect(self) -> Network:
        """Connect to the printer."""
        if self._printer is None:
            self._printer = Network(self.ip, port=self.port)
            # Printer uses CP437 by default — text encoding handled by callers
            self._printer.set(font="b")
        return self._printer

    def disconnect(self):
        """Disconnect from the printer."""
        if self._printer:
            try:
                self._printer.close()
            except Exception:
                pass
            self._printer = None

    def __enter__(self):
        """Context manager entry."""
        return self.connect()

    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit."""
        self.disconnect()
        return False

    def test_connection(self) -> bool:
        """Test if printer is reachable."""
        try:
            with self:
                return True
        except Exception as e:
            logger.warning(f"Printer connection test failed: {e}")
            return False

    def print_text(self, text: str, cut: bool = True):
        """Print plain text and optionally cut."""
        with self as p:
            p.text(text + "\n")
            if cut:
                p.cut()

    def print_centered_header(self, text: str, double_size: bool = True):
        """Print centered header text."""
        with self as p:
            p.set(font="b", align="center", bold=True, double_height=double_size, double_width=double_size)
            p.text(f"{text}\n")
            p.set(font="b", align="left", bold=False, double_height=False, double_width=False)

    def print_separator(self, char: str = "-"):
        """Print a separator line (64 chars for 80mm paper with Font B)."""
        with self as p:
            p.text(char * 64 + "\n")

    def feed_and_cut(self):
        """Feed paper and cut."""
        with self as p:
            p.cut()


def get_printer(ip: str = None, port: int = None) -> ThermalPrinter:
    """Get a printer instance with specified or default settings."""
    return ThermalPrinter(ip=ip, port=port)
