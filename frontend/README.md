# KP Rück Frontend

Next.js frontend for the KP Rück firefighting operations dashboard.

## Stack

- **Next.js 15** - React framework with App Router
- **React 19** - UI library
- **TypeScript** - Type safety
- **Tailwind CSS 4** + **shadcn/ui** - Styling and UI components
- **Pragmatic drag and drop** (`@atlaskit/pragmatic-drag-and-drop`) - Drag and drop on the board
- **MapLibre GL** - Map visualization (vector tiles offline, raster XYZ online)
- **next-intl** - German (canonical) and French UI, catalogues in `messages/`
- **Socket.IO client** - Real-time updates, with polling as the fallback

## Setup

### Prerequisites

- Node.js 22 or newer
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
- `pnpm test` - Run Vitest unit tests
- `pnpm test:watch` - Vitest in watch mode
- `pnpm test:e2e` - Run Playwright E2E tests
- `pnpm test:e2e:ui` - Playwright UI mode

## Environment Variables

- `NEXT_PUBLIC_API_URL` - Backend API URL for local development (default: `http://localhost:8000`)
- `API_URL` - Runtime backend URL the server-side `/backend-api` proxy forwards to; the published
  image is built without `NEXT_PUBLIC_API_URL`, so production sets only this
- `CARTO_API_KEY` - Runtime browser key for CARTO Voyager and Dark Matter raster tiles

## Features

- **Operations Management** - Kanban-style board for managing fire operations
- **Drag & Drop** - Assign personnel, vehicles and materials to incidents via drag and drop
- **Real-time Map** - Incident locations, vehicle GPS and the weather layer on an interactive map
- **Search & Filter** - Filter incidents by vehicle, priority, and incident type
- **Command palette** - ⌘K for commands, search and type-to-dispatch (`14 tlf meier`)
- **Keyboard Shortcuts** - Quick navigation and assignment
- **Footer sheets** - Links & QR, Fahrzeuge, Aufträge, Rapporte, Tagebuch, Drucken, Ansicht;
  Kennzahlen (`Z`) open from the user menu
- **Field and display pages** - `/feld`, `/reko`, `/check-in`, `/alarm`, and the wall displays
  under `/display`
- **Responsive Design** - Desktop, tablet and phone

## Project Structure

- `app/` - Next.js App Router pages
  - `page.tsx` - Main dashboard with Kanban board
  - `map/page.tsx` - Map view
  - `layout.tsx` - Root layout with providers
- `components/` - Reusable UI components
  - `ui/` - shadcn/ui components
  - `map-view.tsx` - MapLibre GL map component
- `lib/` - Utilities and business logic
  - `contexts/` - React contexts
    - `operations-context.tsx` - State management with API sync
  - `api-client.ts` - Backend API client
  - `utils.ts` - Utility functions
  - `hooks/` - Custom React hooks
- `messages/` - next-intl catalogues (`de.json` canonical, `fr.json`, `it.json` stub)
- `public/` - Static assets

## Data Synchronization

The frontend automatically synchronizes state with the backend:
- On load: Fetches the selected Ereignis's incidents, personnel, vehicles and materials from the API
- On change: Updates are sent to the backend via REST API, with optimistic UI updates
- From other devices: Socket.IO pushes changes (`lib/websocket-client.ts`); polling every few
  seconds is the fallback when the socket is down
- Debouncing: Updates are debounced to avoid excessive API calls
