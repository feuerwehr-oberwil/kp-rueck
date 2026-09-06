"""Access logs must not turn field links and webhook URLs into credential archives."""

import logging

import pytest

from app.logging_config import AccessLogPrivacyFilter


@pytest.mark.parametrize("query", ["secret=do-not-log", "token=field-credential", "code=oauth-code&state=state"])
def test_access_log_omits_query_credentials(query):
    record = logging.LogRecord(
        "uvicorn.access",
        logging.INFO,
        "",
        0,
        '%s - "%s %s HTTP/%s" %d',
        ("127.0.0.1", "POST", f"/api/endpoint?{query}", "1.1", 200),
        None,
    )
    assert AccessLogPrivacyFilter().filter(record)
    assert record.getMessage() == '127.0.0.1 - "POST /api/endpoint HTTP/1.1" 200'
