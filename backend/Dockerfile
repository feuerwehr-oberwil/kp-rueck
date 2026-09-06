FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

WORKDIR /app

# Install system dependencies.
#
# postgresql-client comes from PGDG, not from Debian, and the major version is PINNED. Debian
# bookworm ships client 15; production runs Postgres 17.x, and pg_dump 15 does not dump a 17
# server — it refuses with "aborting because of server version mismatch". That would make
# start.sh's pre-migration snapshot fail exactly when it is needed, so the client is pinned one
# major AHEAD of the compose database (16) and level with production (17). A newer client
# against an older server is supported; the reverse is not. Raise this before raising the
# server, never after.
ARG PG_CLIENT_MAJOR=17
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl gnupg bash gosu \
    && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
       | gpg --dearmor -o /usr/share/keyrings/pgdg.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/pgdg.gpg] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
       > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update && apt-get install -y --no-install-recommends \
       "postgresql-client-${PG_CLIENT_MAJOR}" \
    && apt-get purge -y gnupg && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

# Copy dependency files
COPY pyproject.toml uv.lock ./

# Install dependencies using uv
RUN uv sync --frozen --no-dev

# Create non-root user for security with home directory
RUN groupadd -r appuser && useradd -r -g appuser -m appuser

# Create uv cache directory with proper permissions
RUN mkdir -p /home/appuser/.cache/uv && \
    chown -R appuser:appuser /home/appuser

# Copy application code
COPY . .

# Create photo storage mount point with correct ownership (for Railway volumes)
RUN mkdir -p /mnt/data/photos && chown -R appuser:appuser /mnt/data

# Make scripts executable and set ownership
RUN chmod +x start.sh start-dev.sh entrypoint.sh && \
    chown -R appuser:appuser /app

# Set environment variable for uv cache
ENV UV_CACHE_DIR=/home/appuser/.cache/uv
# Dependencies are frozen into the image. Startup must never resolve packages or fetch
# development tools, including when the station boots without an internet connection.
ENV UV_NO_SYNC=true

# Expose port (Railway will set PORT env var)
EXPOSE ${PORT:-8000}

# Entrypoint fixes volume permissions then drops to appuser via gosu
ENTRYPOINT ["./entrypoint.sh"]

# Run the startup script
CMD ["./start.sh"]
