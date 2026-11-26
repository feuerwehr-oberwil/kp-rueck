"""Log a background loop's failure once, with its traceback – not on every tick, and not never.

A loop that runs every few seconds (the Traccar poll, the GPS automation) must not break on an
error, and must not fill the log with the same one either. Catching it at DEBUG did both wrong:
production logs at INFO, so cards stopped moving and no line said why.
"""

import logging
import traceback


class FailureLatch:
    """One per loop. Call `failed(exc)` in its ``except`` and `ok()` after a round that worked.

    A failure is logged at ERROR, with its traceback, the first time it happens, and again only
    when a different one follows (another type, or raised from another line). After a good
    round the latch says «recovered» once and arms again.
    """

    def __init__(self, logger: logging.Logger, what: str) -> None:
        self._logger = logger
        self._what = what
        self._last: tuple[str, str, int | None] | None = None

    def failed(self, exc: BaseException) -> None:
        frames = traceback.extract_tb(exc.__traceback__)
        key = (type(exc).__name__, frames[-1].filename, frames[-1].lineno) if frames else (type(exc).__name__, "", None)
        if key == self._last:
            return
        self._last = key
        self._logger.error("%s failed (logged once until it recovers)", self._what, exc_info=exc)

    def ok(self) -> None:
        if self._last is not None:
            self._last = None
            self._logger.info("%s recovered", self._what)
