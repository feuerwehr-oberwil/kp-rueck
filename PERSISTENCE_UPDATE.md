# Database Persistence Update

## Overview

All frontend state changes now properly persist to the database, ensuring that operations, personnel assignments, and material assignments are maintained across page reloads.

## Changes Made

### 1. New Context Functions

Added two new functions to `frontend/lib/contexts/operations-context.tsx`:

#### `assignPersonToOperation(personId, personName, operationId)`
- Assigns a person to an operation's crew
- Updates both the operation's crew list and the person's status to "assigned"
- Persists both changes to the database via API calls

#### `assignMaterialToOperation(materialId, operationId)`
- Assigns material to an operation
- Updates both the operation's materials list and the material's status to "assigned"
- Persists both changes to the database via API calls

### 2. Updated Drag-and-Drop Handlers

Modified `frontend/app/page.tsx` to ensure all drag-and-drop interactions persist:

- **Person drag-and-drop**: Now calls `assignPersonToOperation()` instead of directly manipulating state
- **Material drag-and-drop**: Now calls `assignMaterialToOperation()` instead of directly manipulating state
- **Operation status changes**: All drag-and-drop status changes now call `updateOperation()` to persist to DB:
  - Operation dragged to different column
  - Operation dropped on column header
  - Operation dropped on another operation card in different column

### 3. Keyboard Shortcut Persistence

- **Vehicle assignments (keys 1-5)**: Now call `updateOperation()` to persist vehicle changes
- **Operation moves (< > arrow keys)**: Now call `updateOperation()` to persist status changes

## What's Persisted

All of the following now persist across page reloads:

✅ Person assignments to operations (crew)
✅ Material assignments to operations
✅ Operation status changes (via drag-and-drop or keyboard)
✅ Vehicle assignments (via keyboard shortcuts)
✅ Operation properties (location, notes, contact, priority, etc.)
✅ Person status (available/assigned)
✅ Material status (available/assigned)

## Technical Details

### Database Updates

All mutations follow this pattern:
1. Update local React state for immediate UI feedback
2. Call API client to persist change to database
3. Handle errors gracefully (log to console, don't break UI)

### Debouncing

The `updateOperation()` function includes built-in debouncing (500ms) to prevent excessive API calls when users make rapid changes.

### Documentation

Added comprehensive JSDoc documentation to:
- `OperationsContextType` interface
- `assignPersonToOperation()` function
- `assignMaterialToOperation()` function

## Testing

To verify persistence:

1. Start the backend: `cd backend && uv run uvicorn app.main:app --host 0.0.0.0 --port 8000`
2. Start the frontend: `cd frontend && pnpm dev`
3. Make changes via:
   - Drag-and-drop personnel to operations
   - Drag-and-drop materials to operations
   - Drag operations between columns
   - Use keyboard shortcuts (1-5 for vehicles, < > for moves)
4. Reload the page (Ctrl+R / Cmd+R)
5. Verify all changes persist

## API Endpoints Used

- `PUT /api/operations/{id}` - Update operation properties
- `PUT /api/personnel/{id}` - Update person status
- `PUT /api/materials/{id}` - Update material status

## Commit

Commit: `d46346d` - "Ensure all card/assignment state persists to database"
