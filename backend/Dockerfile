FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    postgresql-client \
    bash \
    && rm -rf /var/lib/apt/lists/*

# Copy dependency files
COPY pyproject.toml uv.lock ./

# Install dependencies using uv
RUN uv sync --frozen --no-dev

# Copy application code
COPY . .

# Make start scripts executable
RUN chmod +x start.sh start-dev.sh

# Expose port (Railway will set PORT env var)
EXPOSE ${PORT:-8000}

# Run the startup script
CMD ["./start.sh"]
