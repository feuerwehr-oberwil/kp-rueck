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

# Create non-root user for security
RUN groupadd -r appuser && useradd -r -g appuser appuser

# Copy application code
COPY . .

# Make start scripts executable and set ownership
RUN chmod +x start.sh start-dev.sh && \
    chown -R appuser:appuser /app

# Switch to non-root user
USER appuser

# Expose port (Railway will set PORT env var)
EXPOSE ${PORT:-8000}

# Run the startup script
CMD ["./start.sh"]
