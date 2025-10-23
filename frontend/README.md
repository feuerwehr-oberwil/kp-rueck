# KP Rück Frontend

Next.js frontend for the KP Rück firefighting operations dashboard.

## Stack

- **Next.js 15** - React framework with App Router
- **React 19** - UI library
- **TypeScript** - Type safety
- **Tailwind CSS** - Styling
- **@dnd-kit** - Drag and drop functionality
- **Leaflet** - Map visualization

## Setup

### Prerequisites

- Node.js 20.15 or newer
- pnpm 9.x

### Installation

1. Install dependencies:
```bash
pnpm install
```

2. Create `.env.local` file:
```bash
cp .env.local.example .env.local
```

3. Make sure the backend is running (see `../backend/README.md`)

4. Start the development server:
```bash
pnpm dev
```

The application will be available at `http://localhost:3000`

## Development

- `pnpm dev` - Start development server with hot reload
- `pnpm build` - Build for production
- `pnpm start` - Start production server
- `pnpm lint` - Run ESLint
- `pnpm test` - Run Playwright tests
- `pnpm test:ui` - Run Playwright tests with UI

## Environment Variables

- `NEXT_PUBLIC_API_URL` - Backend API URL (default: `http://localhost:8000`)

## Features

- **Operations Management** - Kanban-style board for managing fire operations
- **Drag & Drop** - Assign personnel and materials to operations via drag and drop
- **Real-time Map** - View operation locations on an interactive map
- **Search & Filter** - Filter operations by vehicle, priority, and incident type
- **Keyboard Shortcuts** - Quick navigation and vehicle assignment
- **Responsive Design** - Works on desktop and tablet

## Project Structure

- `app/` - Next.js App Router pages
  - `page.tsx` - Main dashboard with Kanban board
  - `map/page.tsx` - Map view
  - `layout.tsx` - Root layout with providers
- `components/` - Reusable UI components
  - `ui/` - shadcn/ui components
  - `map-view.tsx` - Leaflet map component
- `lib/` - Utilities and business logic
  - `contexts/` - React contexts
    - `operations-context.tsx` - State management with API sync
  - `api-client.ts` - Backend API client
  - `utils.ts` - Utility functions
- `hooks/` - Custom React hooks
- `public/` - Static assets

## Data Synchronization

The frontend automatically synchronizes state with the backend:
- On load: Fetches all operations, personnel, and materials from the API
- On change: Updates are sent to the backend via REST API
- Debouncing: Updates are debounced to avoid excessive API calls
