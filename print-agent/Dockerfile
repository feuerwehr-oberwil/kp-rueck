# Print Agent Dockerfile
# Runs the thermal printer agent for local command post installations

FROM python:3.12-slim

# Install uv for fast dependency management
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app

# Copy dependency files first for caching
COPY pyproject.toml .

# Install dependencies
RUN uv sync --no-dev

# Copy application code
COPY *.py .

# Environment defaults (can be overridden)
ENV BACKEND_URL=http://backend:8000
ENV PRINTER_IP=
ENV PRINTER_PORT=9100
ENV POLL_INTERVAL=2
ENV LOG_LEVEL=INFO

# Run the agent
CMD ["uv", "run", "python", "agent.py"]
