#!/bin/bash
set -e

# Fix volume mount permissions for non-root user (Railway mounts as root)
if [ -d "/mnt/data" ]; then
    chown -R appuser:appuser /mnt/data 2>/dev/null || true
fi

# Drop to non-root user and exec the CMD
exec gosu appuser "$@"
