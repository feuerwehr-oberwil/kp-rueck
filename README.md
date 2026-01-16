# KP Rueck

A tactical operations dashboard for firefighting command posts, designed to replace physical magnet board systems with a modern digital interface.

## About

KP Rueck (Kommandoposten Rueckwaertiger Dienst) is a web application for managing personnel, vehicles, materials, and incidents during firefighting operations. It provides a Kanban-style operations board with drag-and-drop status management, an interactive map view, and real-time data synchronization across multiple users.

**Note:** This project was primarily "vibe coded" with AI assistance (Claude), with periodic code audits for security and reliability.

## Features

- **Kanban Operations Board** - Drag-and-drop incident management with status columns
- **Interactive Map View** - Leaflet-based map with incident locations and GPS tracking
- **Resource Management** - Track personnel, vehicles, and materials with assignments
- **Real-time Sync** - Multi-user support with automatic data synchronization
- **Role-based Access** - Editor (full CRUD) and Viewer (read-only) roles
- **Offline Map Support** - Optional self-hosted tiles for areas without internet
- **Training Mode** - Separate training operations from live incidents
- **Field Reconnaissance** - Digital Reko forms with photo upload
- **Keyboard Shortcuts** - Fast navigation and vehicle assignment

## Architecture

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 15, React 19, TypeScript, Tailwind CSS 4 |
| Backend | FastAPI (Python), SQLAlchemy 2.0 (async) |
| Database | PostgreSQL 16 |
| Maps | Leaflet + OpenStreetMap (optional TileServer GL for offline) |
| Deployment | Docker Compose, Railway |

```
kp-rueck/
├── frontend/           # Next.js application
├── backend/            # FastAPI application
├── scripts/            # Utility scripts (offline maps setup)
├── docker-compose.yml  # Production setup
└── docker-compose.dev.yml  # Development setup with hot reload
```

## Quick Start

### Prerequisites

- Docker and Docker Compose
- OR for local development:
  - Node.js 20+, pnpm 9.x (frontend)
  - Python 3.12+, uv (backend)

### Using Docker (Recommended)

```bash
# Development mode with hot reload
docker-compose -f docker-compose.dev.yml up

# Or use the Makefile
make dev

# Initialize and seed database
make init-db seed-db
```

The application will be available at:
- Frontend: http://localhost:3000
- Backend API: http://localhost:8000
- API Docs: http://localhost:8000/docs

### Local Development

**Backend:**
```bash
cd backend
uv sync
cp .env.example .env
uv run python -m app.seed     # Create tables + seed data
uv run uvicorn app.main:app --reload
```

**Frontend:**
```bash
cd frontend
pnpm install
cp .env.local.example .env.local
pnpm dev
```

## Configuration

### Backend Environment Variables

```env
DATABASE_URL=postgresql+asyncpg://kprueck:kprueck@localhost:5433/kprueck
CORS_ORIGINS=http://localhost:3000
SECRET_KEY=your-secret-key-here
```

### Frontend Environment Variables

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

See `.env.example` files in each directory for all available options.

## Development

```bash
# View all available commands
make help

# Common commands
make dev              # Start development environment
make logs             # View all logs
make logs-backend     # View backend logs only
make stop             # Stop all services
make clean            # Remove volumes and data

# Code quality
cd backend && uv run ruff check . && uv run ruff format .
cd frontend && pnpm lint
```

## Testing

```bash
# Backend tests
cd backend && uv run pytest

# Frontend E2E tests
cd frontend && pnpm test

# Or via Makefile
make test             # Run all E2E tests
make test-ui          # Interactive Playwright UI
```

## Deployment

The application is designed for deployment on Railway but can run on any Docker-compatible platform.

See [RAILWAY.md](RAILWAY.md) for detailed deployment instructions.

## Documentation

- [RAILWAY.md](RAILWAY.md) - Deployment guide
- [OFFLINE_MAPS.md](OFFLINE_MAPS.md) - Offline map tiles setup
- [backend/README.md](backend/README.md) - Backend-specific documentation

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.

## Acknowledgments

- Built with assistance from Claude (Anthropic)
- Designed for Demo Fire Department BL, Switzerland
