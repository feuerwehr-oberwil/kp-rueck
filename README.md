# KP Rück

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Next.js](https://img.shields.io/badge/Next.js-15-black)](https://nextjs.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-async-009688)](https://fastapi.tiangolo.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)](https://www.typescriptlang.org/)
[![Python](https://img.shields.io/badge/Python-3.12+-blue)](https://www.python.org/)

A tactical operations dashboard for firefighting command posts. Digital replacement for the physical magnet board system used to track personnel, vehicles, and incidents during emergency operations.

**Developed by Demo Fire Department BL** - A volunteer fire department in Switzerland.

## Screenshots

| Operations Dashboard | Interactive Map |
|---------------------|-----------------|
| ![Dashboard](docs/images/dashboard.png) | ![Map View](docs/images/map-view.png) |

## Why KP Rück?

Fire departments often manage operations using physical magnet boards - moving magnetic tokens to track which personnel and vehicles are assigned to which incidents. This works, but:

- Only visible at the command post
- No history or audit trail
- Easy to lose track during busy multi-incident scenarios
- Can't be updated remotely

**KP Rück** digitizes this workflow while keeping the familiar Kanban-style interface that commanders are used to.

## Features

**Operations Board**
- Kanban-style drag-and-drop incident management
- Real-time sync across multiple devices
- Visual status columns: Incoming → Reko → Dispatched → Completed

**Resource Management**
- Track personnel with roles and certifications (Offiziere, Wachtmeister, Korporal, Mannschaft)
- Manage vehicles and equipment assignments
- Visual warnings for resource conflicts

**Interactive Map**
- Leaflet-based map with incident markers
- GPS vehicle tracking (via Traccar integration)
- Offline map tile support for areas without internet

**Field Operations**
- Reconnaissance (Reko) forms with photo upload
- Mobile-friendly interface for field teams
- QR code quick access

**Training Mode**
- Separate training scenarios from live operations
- Auto-generate realistic training incidents from templates
- Same interface, isolated data

**Integrations**
- Divera247 alarm webhook support
- Traccar GPS vehicle tracking
- Thermal printer support for dispatch slips

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 15, React 19, TypeScript, Tailwind CSS 4 |
| Backend | FastAPI (Python), SQLAlchemy 2.0 (async) |
| Database | PostgreSQL 16 |
| Maps | Leaflet + OpenStreetMap |
| Deployment | Docker Compose, Railway |

## Quick Start

### Using Docker (Recommended)

```bash
# Clone the repository
git clone https://github.com/feuerwehr-oberwil/kp-rueck.git
cd kp-rueck

# Start development environment
docker-compose -f docker-compose.dev.yml up

# Or use just (if installed)
just dev
```

The application will be available at:
- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:8000
- **API Docs**: http://localhost:8000/docs

### Local Development

**Prerequisites**: Node.js 20+, pnpm, Python 3.12+, uv

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

### Default Login

After seeding, use the admin credentials shown in the terminal output. In development mode, a random secure password is generated.

## Configuration

### Environment Variables

**Backend** (`.env`):
```env
DATABASE_URL=postgresql+asyncpg://kprueck:kprueck@localhost:5433/kprueck
CORS_ORIGINS=http://localhost:3000
SECRET_KEY=your-secret-key-here  # Auto-generated in dev
```

**Frontend** (`.env.local`):
```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

See the `.env.example` files in each directory for all options.

### Production Deployment (Oberwil)

For Demo Fire Department's production deployment on Railway, set:

```env
OBERWIL_PRODUCTION=true
```

This enables:
- Real personnel roster
- Oberwil-specific training locations and coordinates
- Proper firestation settings

### Customization for Other Departments

To customize for your organization:

1. Modify `backend/app/seed.py` with your personnel, vehicles, and materials
2. Update `backend/app/seed_training.py` with your geographic area bounds
3. Configure your firestation location via the Settings page
4. Or create your own `seed_yourdepartment.py` following the pattern in `seed_oberwil.py`

## Project Structure

```
kp-rueck/
├── frontend/           # Next.js 15 application
│   ├── app/           # App Router pages
│   ├── components/    # React components + shadcn/ui
│   └── lib/           # Utilities, contexts, API client
├── backend/           # FastAPI application
│   ├── app/           # Main application
│   │   ├── api/       # API routes
│   │   ├── services/  # Business logic
│   │   ├── seed.py    # Database seeding (demo data)
│   │   ├── seed_oberwil.py  # Oberwil production data
│   │   └── models.py  # SQLAlchemy models
│   └── alembic/       # Database migrations
├── docker-compose.yml     # Production setup
├── docker-compose.dev.yml # Development with hot reload
└── justfile              # Common dev commands
```

## Deployment

KP Rück is designed to run on any Docker-compatible platform. See [RAILWAY.md](RAILWAY.md) for deployment instructions on Railway.

**Production checklist:**
- Set strong `SECRET_KEY` and `ADMIN_SEED_PASSWORD`
- Configure `DATABASE_URL` for production database
- Set `CORS_ORIGINS` to your frontend domain
- Set `OBERWIL_PRODUCTION=true` for Demo Fire Department deployment
- Consider enabling offline map tiles for field reliability

## Documentation

- [RAILWAY.md](RAILWAY.md) - Deployment guide
- [OFFLINE_MAPS.md](OFFLINE_MAPS.md) - Offline map tiles setup
- [CONFIGURATION_SETTINGS.md](CONFIGURATION_SETTINGS.md) - System settings reference
- [CONTRIBUTING.md](CONTRIBUTING.md) - Contribution guidelines
- [backend/README.md](backend/README.md) - Backend API documentation

## Contributing

Contributions are welcome! This project was originally developed for Demo Fire Department but is designed to be adaptable for fire departments worldwide.

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

**Ways to contribute:**
- Report bugs or suggest features via [Issues](https://github.com/feuerwehr-oberwil/kp-rueck/issues)
- Improve documentation or add translations
- Add integrations (CAD systems, alerting platforms)
- Submit pull requests

## Terminology

This project uses Swiss German firefighting terminology:

| Term | English |
|------|---------|
| Einsatz | Operation/Deployment |
| Reko | Reconnaissance |
| Disponiert | Dispatched |
| Eingegangen | Incoming |
| Abschluss | Completed |
| Magazin | Equipment storage |
| KP Rück | Command Post (Rückwärtiger Dienst - rear services) |
| Offiziere | Officers |
| Wachtmeister | Sergeants |
| Korporal | Corporals |
| Mannschaft | Firefighters |

## License

MIT License - see [LICENSE](LICENSE) for details.

## Acknowledgments

- **Demo Fire Department BL** - Original development and real-world testing
- Built with assistance from Claude (Anthropic)
- UI components from [shadcn/ui](https://ui.shadcn.com/)
- Maps powered by [OpenStreetMap](https://www.openstreetmap.org/)

---

**Questions?** Open an [issue](https://github.com/feuerwehr-oberwil/kp-rueck/issues)
