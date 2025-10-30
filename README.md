# KP Rück Dashboard

A digital operations board for tactical firefighting command posts, replacing traditional physical magnet boards with a modern web-based solution.

## What is this?

KP Rück Dashboard is a real-time incident management system designed for fire departments. It provides:

- **Kanban-style incident tracking** - Drag-and-drop operations board with status columns
- **Interactive map view** - Visualize all active incidents on OpenStreetMap
- **Resource management** - Track personnel, vehicles, and equipment assignments
- **Multi-user support** - Editor and viewer roles for command post and field personnel
- **Training mode** - Simulate operations for exercises without affecting live data
- **Field reconnaissance** - Mobile-friendly forms for incident reporting with photo uploads

## Development Approach

This application was **vibecoded** (AI-assisted development) and extensively tested with real-world workflows from **Feuerwehr Oberwil** (Switzerland). While it's tailored to their specific operational needs, the codebase is flexible and can be adapted to other fire departments or emergency services.

**Interested in using or adapting this system?** Feel free to reach out or open an issue. I'm planning to open-source this project to help other volunteer fire departments modernize their operations.

## Tech Stack

- **Frontend**: Next.js 15 + React 19 + TypeScript + Tailwind CSS
- **Backend**: FastAPI (Python) + PostgreSQL
- **Deployment**: Docker containers via Railway
- **Maps**: Leaflet + OpenStreetMap

## Quick Start

```bash
# Start everything with Docker Compose
make dev

# Or manually:
docker-compose -f docker-compose.dev.yml up
```

The app will be available at:
- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:8000
- **API Docs**: http://localhost:8000/docs

For detailed setup instructions, see:
- [Backend README](backend/README.md)
- [Railway Deployment Guide](RAILWAY.md)
- [Claude Code Development Guide](CLAUDE.md)

## Documentation

- `ARCHITECTURE.md` - System architecture and technical design
- `CLAUDE.md` - Development guidelines for contributors
- `RAILWAY.md` - Deployment guide for Railway cloud platform
- `CONFIGURATION_SETTINGS.md` - System configuration and settings management
- `Makefile` - Quick reference for common development commands

## License

[TBD - Will add license before open-sourcing]

## Contact

If you're interested in using this system for your fire department or have questions about adapting it to your needs, please open an issue or reach out.
