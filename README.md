# KP Rück Dashboard

Tactical dashboard for managing personnel, materials, and incidents during firefighting operations.

## Architecture

This project uses a modern **containerized microservices** architecture:

- **Frontend**: Next.js 15 + React 19 + TypeScript
- **Backend**: FastAPI (Python) + PostgreSQL
- **Database**: PostgreSQL 16

```
kp-rueck/
├── frontend/           # Next.js application
├── backend/            # FastAPI application
├── docker-compose.yml  # Production setup
└── docker-compose.dev.yml  # Development setup with hot reload
```

## 🚀 Quick Start

### Prerequisites

- **Docker** and **Docker Compose**
- OR for local development:
  - Node.js 20.15+, pnpm 9.x (frontend)
  - Python 3.12+, uv (backend)

### Option 1: Docker Compose (Recommended)

**Start everything with one command:**

```bash
# Production mode
docker-compose up

# Development mode (with hot reload)
docker-compose -f docker-compose.dev.yml up
```

**Or use the Makefile:**

```bash
# Development with hot reload
make dev

# Production
make prod

# Initialize and seed database
make init-db seed-db

# View logs
make logs
```

The application will be available at:
- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:8000
- **API Docs**: http://localhost:8000/docs

### Option 2: Local Development (Without Docker)

#### 1. Start PostgreSQL

```bash
docker-compose up -d postgres
```

#### 2. Start Backend

```bash
cd backend
uv sync
cp .env.example .env
uv run python -m app.init_db  # Create tables
uv run python -m app.seed     # Seed data
uv run uvicorn app.main:app --reload
```

Backend: http://localhost:8000

#### 3. Start Frontend

```bash
cd frontend
pnpm install
cp .env.local.example .env.local
pnpm dev
```

Frontend: http://localhost:3000

## 📦 Docker Services

### Production (`docker-compose.yml`)

- **postgres**: PostgreSQL 16 database (port 5433)
- **backend**: FastAPI with uv (port 8000)
- **frontend**: Next.js production build (port 3000)

### Development (`docker-compose.dev.yml`)

Same services with:
- Hot reload for backend and frontend
- Source code mounted as volumes
- Development optimizations

## 🎯 Features

- **Operations Management**: Kanban-style board with drag-and-drop
- **Personnel Management**: Track availability and assignments
- **Material Management**: Manage equipment and resources
- **Map View**: Interactive map with operation locations
- **Real-time Sync**: Backend persistence with multi-user support
- **Search & Filters**: Filter by vehicle, priority, incident type
- **Keyboard Shortcuts**: Fast navigation and vehicle assignment

## 🛠️ Development

### Using Makefile

```bash
make help              # Show all available commands

# Development
make dev               # Start dev environment
make dev-detached      # Start in background
make logs              # View all logs
make logs-backend      # View backend logs only

# Database
make init-db           # Create database tables
make seed-db           # Seed initial data
make shell-db          # Open PostgreSQL shell

# Code Quality
make lint-backend      # Lint backend code
make format-backend    # Format backend code
make lint-frontend     # Lint frontend code

# Cleanup
make stop              # Stop all services
make clean             # Remove volumes and data
```

### Manual Commands

```bash
# Backend development
cd backend
uv run uvicorn app.main:app --reload
uv run python -m app.seed
uv run ruff check .

# Frontend development
cd frontend
pnpm dev
pnpm build
pnpm test
pnpm lint

# Database access
docker-compose exec postgres psql -U kprueck -d kprueck
```

## 🚢 Deployment

### Railway (Recommended Cloud Platform)

Railway automatically deploys each service separately with managed PostgreSQL.

**Quick Deploy:**

1. **Create Railway project:**
   ```bash
   # Install Railway CLI
   npm install -g @railway/cli

   # Login and initialize
   railway login
   railway init
   ```

2. **Add services:**
   - Database: Add PostgreSQL from Railway dashboard
   - Backend: Deploy from `/backend` directory
   - Frontend: Deploy from `/frontend` directory

3. **Set environment variables:**
   - Backend: `DATABASE_URL`, `CORS_ORIGINS`
   - Frontend: `NEXT_PUBLIC_API_URL`

**See [RAILWAY.md](RAILWAY.md) for detailed deployment guide.**

### Other Platforms

The application can be deployed to:
- **AWS ECS/Fargate**: Using Docker images
- **Google Cloud Run**: Container-based deployment
- **Azure Container Apps**: Microservices deployment
- **DigitalOcean App Platform**: Docker Compose support
- **Fly.io**: Multi-region deployment

## 🏗️ Project Structure

### Backend

```
backend/
├── app/
│   ├── main.py          # FastAPI app with lifespan events
│   ├── config.py        # Pydantic settings management
│   ├── database.py      # Async SQLAlchemy configuration
│   ├── models.py        # Database models
│   ├── schemas.py       # Pydantic request/response schemas
│   ├── crud.py          # Async CRUD operations
│   ├── init_db.py       # Database initialization script
│   ├── seed.py          # Database seeding script
│   └── api/routes.py    # API endpoints
├── pyproject.toml       # uv project configuration
├── Dockerfile           # Production container
├── start.sh             # Railway startup script
└── railway.json         # Railway deployment config
```

### Frontend

```
frontend/
├── app/                 # Next.js App Router pages
│   ├── page.tsx         # Main dashboard with Kanban board
│   ├── map/page.tsx     # Map view
│   └── layout.tsx       # Root layout with providers
├── components/          # Reusable UI components
│   ├── ui/              # shadcn/ui components
│   └── map-view.tsx     # Leaflet map component
├── lib/                 # Utilities and business logic
│   ├── contexts/        # React contexts
│   │   └── operations-context.tsx  # State + API sync
│   ├── api-client.ts    # Backend API client
│   └── utils.ts         # Utility functions
├── Dockerfile           # Production container
├── Dockerfile.dev       # Development container
└── railway.json         # Railway deployment config
```

## 🔌 API Endpoints

### Operations
- `GET /api/operations` - List all operations
- `POST /api/operations` - Create operation
- `GET /api/operations/{id}` - Get operation
- `PUT /api/operations/{id}` - Update operation
- `DELETE /api/operations/{id}` - Delete operation

### Personnel
- `GET /api/personnel` - List all personnel
- `POST /api/personnel` - Create person
- `PUT /api/personnel/{id}` - Update person

### Materials
- `GET /api/materials` - List all materials
- `POST /api/materials` - Create material
- `PUT /api/materials/{id}` - Update material

**Full API documentation:** http://localhost:8000/docs

## 📊 Database Schema

- **operations**: Fire operations with location, crew, materials, status
- **personnel**: Firefighters with roles and availability
- **materials**: Equipment and resources with availability

## 🧪 Testing

```bash
# Backend tests
cd backend
uv run pytest

# Frontend tests
cd frontend
pnpm test
pnpm test:ui  # Playwright UI mode

# Run tests in Docker
docker-compose exec backend uv run pytest
docker-compose exec frontend pnpm test
```

## 🔧 Environment Variables

### Backend

```env
DATABASE_URL=postgresql+asyncpg://kprueck:kprueck@localhost:5433/kprueck
CORS_ORIGINS=http://localhost:3000,http://localhost:3001
API_V1_PREFIX=/api
PROJECT_NAME=KP Rück API
HOST=0.0.0.0
PORT=8000
```

### Frontend

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

## 📚 Technology Stack

### Frontend
- Next.js 15 (App Router)
- React 19
- TypeScript
- Tailwind CSS 4
- @dnd-kit (Drag & Drop)
- Leaflet (Maps)
- shadcn/ui (Components)

### Backend
- FastAPI (Async Python web framework)
- SQLAlchemy 2.0 (Async ORM)
- PostgreSQL (Database)
- Pydantic (Validation)
- uvicorn (ASGI server)
- uv (Package manager)

### Infrastructure
- Docker & Docker Compose
- Railway (Cloud platform)
- PostgreSQL 16

## 🤝 Contributing

1. Create a feature branch
2. Make your changes
3. Test thoroughly (`make test-backend test-frontend`)
4. Lint your code (`make lint-backend lint-frontend`)
5. Submit a pull request

## 📝 License

[Add your license here]

## 🆘 Support

- **Issues**: [GitHub Issues](https://github.com/your-repo/issues)
- **Docs**: See `backend/README.md` and `frontend/README.md`
- **Railway Help**: See [RAILWAY.md](RAILWAY.md)

## 🎯 Best Practices

This project follows modern best practices:

✅ **Backend**: [FastAPI Best Practices](https://github.com/zhanymkanov/fastapi-best-practices)
- Async all the way
- Pydantic settings
- Proper dependency injection
- Type hints everywhere
- uv for package management

✅ **Frontend**: Next.js 15 best practices
- App Router
- Server components where possible
- Optimized images and fonts
- Proper error boundaries

✅ **DevOps**:
- Multi-stage Docker builds
- Development and production configs
- Health checks
- Proper logging
- Environment-based configuration
