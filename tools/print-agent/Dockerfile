# kp-print-agent — one agent for KP Front (PDF via CUPS) and KP Rück (ESC/POS thermal).
#
# The image installs the ESC/POS extra, because a containerised agent is how the thermal
# printer is run; the bare-Pi CUPS install needs no packages at all and does not use this
# image. cups-client provides `lp`/`lpstat` so a single container can serve both backends.
FROM python:3.15-slim

COPY --from=ghcr.io/astral-sh/uv:0.9.26 /uv /usr/local/bin/uv

# hadolint ignore=DL3008
RUN apt-get update \
    && apt-get install --no-install-recommends -y cups-client \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Exactly the versions in uv.lock, into the image's own Python (no venv). `--locked` stops the
# build when pyproject.toml and uv.lock disagree, so the lockfile cannot go stale unnoticed.
ENV UV_PROJECT_ENVIRONMENT=/usr/local
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --extra escpos --no-dev --no-cache

COPY . .

# Runs as a non-root user; printing is over the network (ESC/POS) or via cups-client to a
# remote CUPS server, so no local device access is needed.
RUN useradd -r -u 10001 -s /usr/sbin/nologin kpprint
USER 10001

# Point at a mounted config for multi-backend operation:
#   -v /etc/kp-print-agent.json:/config.json  KP_PRINT_AGENT_CONFIG=/config.json
# or keep using the single-backend variables the previous agents used (BACKEND_URL +
# AGENT_TOKEN for KP Rück, KP_BASE_URL + KP_PRINT_AGENT_SECRET + KP_PRINTER for KP Front).
ENV BACKEND_URL=http://backend:8000 \
    LOG_LEVEL=INFO

CMD ["python3", "agent.py"]
