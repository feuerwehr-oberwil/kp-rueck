# KP Rück Backend

FastAPI backend for the KP Rück firefighting operations dashboard, following modern best practices.

## Stack

- **FastAPI** - Modern async Python web framework
- **SQLAlchemy 2.0** - Async ORM for PostgreSQL
- **PostgreSQL** - Relational database
- **Pydantic** - Data validation and settings management
- **uv** - Fast Python package manager

## Setup

### Prerequisites

- **uv** (recommended): `curl -LsSf https://astral.sh/uv/install.sh | sh`
- OR Python 3.12+
- PostgreSQL 16+ (or use Docker)

### Using uv (Recommended)

1. Install dependencies:
```bash
uv sync
```

2. Create a `.env` file:
```bash
cp .env.example .env
# Edit .env with your database credentials
```

3. Start PostgreSQL (via Docker):
```bash
docker-compose up -d postgres
```

4. Create database tables and seed data:
```bash
uv run python -m app.seed
```

5. Start the development server:
```bash
uv run uvicorn app.main:app --reload
```

The API will be available at `http://localhost:8000`

### Using Docker

```bash
# From root directory
docker-compose up -d backend

# Seed the database
docker-compose exec backend uv run python -m app.seed
```

## Development

### Running the server

```bash
# Development mode with hot reload
uv run uvicorn app.main:app --reload

# Production mode
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### Code Quality

```bash
# Linting with ruff
uv run ruff check .

# Formatting with ruff
uv run ruff format .

# Type checking with mypy
uv run mypy app/
```

### Database Operations

```bash
# Seed database
uv run python -m app.seed

# Connect to database
psql postgresql://kprueck:kprueck@localhost:5433/kprueck
```

## API Documentation

Once the server is running, visit:
- **Swagger UI**: http://localhost:8000/docs
- **ReDoc**: http://localhost:8000/redoc

## Project Structure

```
backend/
├── app/
│   ├── __init__.py
│   ├── main.py           # FastAPI app with lifespan events
│   ├── config.py         # Settings with pydantic-settings
│   ├── database.py       # Async SQLAlchemy setup
│   ├── models.py         # Database models
│   ├── schemas.py        # Pydantic schemas
│   ├── crud.py           # Async CRUD operations
│   ├── seed.py           # Database seeding script
│   └── api/
│       ├── __init__.py
│       └── routes.py     # API endpoints
├── pyproject.toml        # uv project configuration
├── Dockerfile            # Docker setup with uv
└── .env.example          # Environment variables template
```

## API Endpoints

### Operations
- `GET /api/operations` - List all operations
- `POST /api/operations` - Create a new operation
- `GET /api/operations/{id}` - Get operation details
- `PUT /api/operations/{id}` - Update an operation
- `DELETE /api/operations/{id}` - Delete an operation

### Personnel
- `GET /api/personnel` - List all personnel
- `POST /api/personnel` - Create a new person
- `GET /api/personnel/{id}` - Get person details
- `PUT /api/personnel/{id}` - Update a person

### Materials
- `GET /api/materials` - List all materials
- `POST /api/materials` - Create a new material
- `GET /api/materials/{id}` - Get material details
- `PUT /api/materials/{id}` - Update a material

## Configuration

Environment variables (`.env` file):

```env
DATABASE_URL=postgresql+asyncpg://kprueck:kprueck@localhost:5433/kprueck
CORS_ORIGINS=http://localhost:3000,http://localhost:3001
API_V1_PREFIX=/api
PROJECT_NAME=KP Rück API
HOST=0.0.0.0
PORT=8000
RELOAD=true
```

## Best Practices

This project follows [FastAPI Best Practices](https://github.com/zhanymkanov/fastapi-best-practices):

- ✅ **Async all the way** - Using async/await with AsyncSession
- ✅ **Pydantic settings** - Configuration management
- ✅ **Proper dependency injection** - Database sessions, settings
- ✅ **Lifespan events** - Instead of deprecated startup/shutdown
- ✅ **Modern SQLAlchemy 2.0** - Mapped columns, async engine
- ✅ **Type hints everywhere** - Full type safety
- ✅ **Project structure** - Clear separation of concerns
- ✅ **uv for dependencies** - Fast, reliable package management

## Testing

```bash
# Run tests (when implemented)
uv run pytest

# With coverage
uv run pytest --cov=app --cov-report=html
```

## Deployment

### Production with uv

```bash
# Install dependencies (production only)
uv sync --no-dev

# Run with gunicorn + uvicorn workers
uv run gunicorn app.main:app -w 4 -k uvicorn.workers.UvicornWorker
```

### Docker Production

```bash
docker build -t kprueck-backend .
docker run -p 8000:8000 --env-file .env kprueck-backend
```
