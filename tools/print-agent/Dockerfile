# kp-print-agent — KP Rück's thermal print agent (ESC/POS over the LAN).
#
# The image installs the ESC/POS extra, because a containerised agent is how the thermal
# printer is run.
FROM python:3.14-slim

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app

COPY pyproject.toml ./
RUN uv pip install --system --no-cache ".[escpos]"

COPY . .

# Runs as a non-root user; printing is over the network (ESC/POS), so no local device access
# is needed.
RUN useradd -r -u 10001 -s /usr/sbin/nologin kpprint
USER 10001

# Point at a mounted config for multi-backend operation:
#   -v /etc/kp-print-agent.json:/config.json  KP_PRINT_AGENT_CONFIG=/config.json
# or keep using the single-backend variables (BACKEND_URL + AGENT_TOKEN).
ENV BACKEND_URL=http://backend:8000 \
    LOG_LEVEL=INFO

CMD ["python3", "agent.py"]
