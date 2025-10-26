# Task 11.1: Dashboard Notification System

**Priority:** P2 (High - Improves situational awareness)
**Complexity:** Medium
**Estimated Effort:** 4-6 hours
**Dependencies:** None
**Status:** Specification Complete - Not Implemented

---

## 1. Overview

Implement a real-time notification system on the dashboard to alert users of critical events, status changes, resource assignments, and system updates without requiring manual page refreshes.

### Business Value
- Immediate awareness of critical incident status changes
- Real-time alerts for resource assignments/releases
- Visibility into concurrent user actions
- Reduced cognitive load from constant monitoring

### User Stories
1. **As an operator**, I want to see notifications when incidents change status so I can respond quickly
2. **As a commander**, I want to be alerted when resources are assigned/released so I can track availability
3. **As a viewer**, I want to see when other users make changes so I stay informed
4. **As an admin**, I want to see system alerts (sync errors, API failures) so I can troubleshoot issues

---

## 2. Technical Specification

### 2.1 Architecture

```
┌─────────────────────────────────────────────────────────────┐
│              Notification Architecture                       │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  Frontend (React)                Backend (FastAPI)           │
│  ┌────────────────┐              ┌────────────────┐         │
│  │ Notification   │              │ Notification   │         │
│  │ Context        │ ←── Poll ─── │ Endpoint       │         │
│  │                │              │ /api/notify/   │         │
│  └────────┬───────┘              └────────┬───────┘         │
│           │                               │                  │
│           │                               │                  │
│  ┌────────▼───────┐              ┌───────▼────────┐         │
│  │ Notification   │              │ Notification   │         │
│  │ Toast/Banner   │              │ Queue (Redis)  │         │
│  │ Component      │              │ or In-Memory   │         │
│  └────────────────┘              └────────────────┘         │
│                                                               │
│  Notification Types:                                         │
│  - Incident status change                                    │
│  - Resource assigned/released                                │
│  - User action (concurrent edit)                             │
│  - System alert (error, warning)                             │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Notification Types

```python
# backend/app/schemas.py

from enum import Enum
from datetime import datetime
from typing import Optional
from pydantic import BaseModel

class NotificationLevel(str, Enum):
    """Notification severity level."""
    INFO = "info"
    SUCCESS = "success"
    WARNING = "warning"
    ERROR = "error"

class NotificationType(str, Enum):
    """Notification event type."""
    INCIDENT_STATUS_CHANGE = "incident_status_change"
    RESOURCE_ASSIGNED = "resource_assigned"
    RESOURCE_RELEASED = "resource_released"
    INCIDENT_CREATED = "incident_created"
    INCIDENT_DELETED = "incident_deleted"
    CONCURRENT_EDIT = "concurrent_edit"
    SYSTEM_ALERT = "system_alert"

class Notification(BaseModel):
    """Notification schema."""
    id: str  # UUID
    type: NotificationType
    level: NotificationLevel
    title: str
    message: str
    resource_type: Optional[str] = None  # incident, personnel, etc.
    resource_id: Optional[str] = None  # UUID
    user_id: Optional[str] = None  # Who triggered the action
    created_at: datetime
    expires_at: Optional[datetime] = None  # Auto-dismiss time
    read: bool = False
    metadata: Optional[dict] = None  # Additional context
```

### 2.3 Backend Implementation

**File: `backend/app/services/notifications.py`**

```python
"""
Notification service for real-time dashboard alerts.
"""

from typing import List, Optional
from datetime import datetime, timedelta
from uuid import uuid4
import asyncio
from collections import deque

from ..schemas import Notification, NotificationLevel, NotificationType

class NotificationManager:
    """
    Manages in-memory notification queue.

    For production, this should be replaced with Redis or similar
    persistent storage to handle multiple server instances.
    """

    def __init__(self, max_size: int = 100, default_ttl: int = 300):
        """
        Args:
            max_size: Maximum notifications to keep in queue
            default_ttl: Default time-to-live in seconds (5 minutes)
        """
        self.notifications: deque = deque(maxlen=max_size)
        self.default_ttl = default_ttl
        self._lock = asyncio.Lock()

    async def add(
        self,
        type: NotificationType,
        level: NotificationLevel,
        title: str,
        message: str,
        resource_type: Optional[str] = None,
        resource_id: Optional[str] = None,
        user_id: Optional[str] = None,
        metadata: Optional[dict] = None,
        ttl: Optional[int] = None,
    ) -> Notification:
        """Add notification to queue."""
        async with self._lock:
            notification = Notification(
                id=str(uuid4()),
                type=type,
                level=level,
                title=title,
                message=message,
                resource_type=resource_type,
                resource_id=resource_id,
                user_id=user_id,
                created_at=datetime.utcnow(),
                expires_at=datetime.utcnow() + timedelta(seconds=ttl or self.default_ttl),
                read=False,
                metadata=metadata,
            )

            self.notifications.append(notification)
            return notification

    async def get_recent(
        self,
        since: Optional[datetime] = None,
        limit: int = 50,
    ) -> List[Notification]:
        """Get recent notifications."""
        async with self._lock:
            # Filter expired notifications
            now = datetime.utcnow()
            active = [
                n for n in self.notifications
                if n.expires_at is None or n.expires_at > now
            ]

            # Filter by timestamp
            if since:
                active = [n for n in active if n.created_at > since]

            # Sort by created_at descending
            active.sort(key=lambda n: n.created_at, reverse=True)

            return active[:limit]

    async def mark_read(self, notification_id: str):
        """Mark notification as read."""
        async with self._lock:
            for notification in self.notifications:
                if notification.id == notification_id:
                    notification.read = True
                    break

    async def clear_expired(self):
        """Remove expired notifications."""
        async with self._lock:
            now = datetime.utcnow()
            self.notifications = deque(
                (n for n in self.notifications if n.expires_at is None or n.expires_at > now),
                maxlen=self.notifications.maxlen,
            )

# Global notification manager instance
notification_manager = NotificationManager()
```

**File: `backend/app/api/notifications.py`**

```python
"""Notification API endpoints."""

from typing import Optional
from datetime import datetime
from fastapi import APIRouter, Query
from ..auth.dependencies import CurrentUser
from ..services.notifications import notification_manager
from ..schemas import Notification

router = APIRouter(prefix="/notifications", tags=["notifications"])

@router.get("/", response_model=list[Notification])
async def get_notifications(
    current_user: CurrentUser,
    since: Optional[datetime] = Query(None, description="Get notifications since this timestamp"),
    limit: int = Query(50, le=100, description="Maximum notifications to return"),
):
    """
    Get recent notifications.

    Long-polling endpoint - frontend polls this every ~3-5 seconds.
    """
    notifications = await notification_manager.get_recent(since=since, limit=limit)
    return notifications

@router.post("/{notification_id}/read")
async def mark_notification_read(
    notification_id: str,
    current_user: CurrentUser,
):
    """Mark notification as read."""
    await notification_manager.mark_read(notification_id)
    return {"success": True}
```

### 2.4 Triggering Notifications

**Integrate into existing endpoints:**

```python
# backend/app/api/incidents.py

from ..services.notifications import notification_manager
from ..schemas import NotificationLevel, NotificationType

@router.post("/{incident_id}/status", response_model=schemas.IncidentResponse)
async def update_incident_status(
    incident_id: UUID,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentEditor,
    status_change: schemas.StatusTransitionCreate,
):
    """Update incident status with notification."""

    # Update status
    incident = await crud.update_incident_status(
        db, incident_id, status_change, str(current_user.id)
    )

    # Trigger notification
    await notification_manager.add(
        type=NotificationType.INCIDENT_STATUS_CHANGE,
        level=NotificationLevel.INFO,
        title=f"Einsatz Status: {status_change.to_status}",
        message=f"{incident.title} → {status_change.to_status}",
        resource_type="incident",
        resource_id=str(incident.id),
        user_id=str(current_user.id),
        metadata={
            "from_status": status_change.from_status,
            "to_status": status_change.to_status,
        },
    )

    return incident
```

**Example notifications for different actions:**

```python
# Resource assignment
await notification_manager.add(
    type=NotificationType.RESOURCE_ASSIGNED,
    level=NotificationLevel.SUCCESS,
    title="Ressource zugewiesen",
    message=f"{resource.name} zu {incident.title} zugewiesen",
    resource_type="assignment",
    resource_id=str(assignment.id),
    user_id=str(current_user.id),
)

# Resource release
await notification_manager.add(
    type=NotificationType.RESOURCE_RELEASED,
    level=NotificationLevel.INFO,
    title="Ressource freigegeben",
    message=f"{resource.name} von {incident.title} freigegeben",
    resource_type="assignment",
    resource_id=str(assignment.id),
    user_id=str(current_user.id),
)

# Concurrent edit warning
await notification_manager.add(
    type=NotificationType.CONCURRENT_EDIT,
    level=NotificationLevel.WARNING,
    title="Gleichzeitige Bearbeitung",
    message=f"{other_user.username} bearbeitet diesen Einsatz",
    resource_type="incident",
    resource_id=str(incident.id),
    user_id=str(other_user.id),
)

# System error
await notification_manager.add(
    type=NotificationType.SYSTEM_ALERT,
    level=NotificationLevel.ERROR,
    title="Systemfehler",
    message="Fehler beim Speichern der Daten. Bitte erneut versuchen.",
    metadata={"error": str(exception)},
)
```

### 2.5 Frontend Implementation

**File: `frontend/lib/contexts/notification-context.tsx`**

```typescript
'use client';

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { apiClient } from '../api-client';

export interface Notification {
  id: string;
  type: string;
  level: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message: string;
  resource_type?: string;
  resource_id?: string;
  user_id?: string;
  created_at: string;
  expires_at?: string;
  read: boolean;
  metadata?: Record<string, any>;
}

interface NotificationContextValue {
  notifications: Notification[];
  unreadCount: number;
  markAsRead: (notificationId: string) => void;
  clearAll: () => void;
}

const NotificationContext = createContext<NotificationContextValue | undefined>(undefined);

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [lastFetch, setLastFetch] = useState<Date>(new Date());

  // Poll for new notifications every 3 seconds
  useEffect(() => {
    const fetchNotifications = async () => {
      try {
        const newNotifications = await apiClient.getNotifications(lastFetch);

        if (newNotifications.length > 0) {
          setNotifications((prev) => {
            // Merge new notifications, avoiding duplicates
            const existingIds = new Set(prev.map((n) => n.id));
            const toAdd = newNotifications.filter((n) => !existingIds.has(n.id));
            return [...toAdd, ...prev].slice(0, 50); // Keep max 50
          });
          setLastFetch(new Date());

          // Show toast for new notifications
          newNotifications.forEach((notification) => {
            showToast(notification);
          });
        }
      } catch (error) {
        console.error('Failed to fetch notifications:', error);
      }
    };

    // Initial fetch
    fetchNotifications();

    // Poll every 3 seconds
    const interval = setInterval(fetchNotifications, 3000);

    return () => clearInterval(interval);
  }, [lastFetch]);

  const markAsRead = useCallback(async (notificationId: string) => {
    try {
      await apiClient.markNotificationRead(notificationId);
      setNotifications((prev) =>
        prev.map((n) => (n.id === notificationId ? { ...n, read: true } : n))
      );
    } catch (error) {
      console.error('Failed to mark notification as read:', error);
    }
  }, []);

  const clearAll = useCallback(() => {
    setNotifications([]);
  }, []);

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount,
        markAsRead,
        clearAll,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotifications must be used within NotificationProvider');
  }
  return context;
}

function showToast(notification: Notification) {
  // Implementation using react-hot-toast or similar library
  // toast[notification.level](notification.message, {
  //   duration: 4000,
  //   icon: getIconForLevel(notification.level),
  // });
}
```

**File: `frontend/lib/api-client.ts`** (add methods)

```typescript
// Add to ApiClient class

async getNotifications(since?: Date): Promise<Notification[]> {
  const params = new URLSearchParams();
  if (since) {
    params.append('since', since.toISOString());
  }
  return this.request<Notification[]>(`/api/notifications/?${params.toString()}`);
}

async markNotificationRead(notificationId: string): Promise<void> {
  return this.request<void>(`/api/notifications/${notificationId}/read`, {
    method: 'POST',
  });
}
```

**File: `frontend/components/notification-center.tsx`**

```typescript
'use client';

import { useNotifications } from '@/lib/contexts/notification-context';
import { Bell } from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from './ui/popover';

export function NotificationCenter() {
  const { notifications, unreadCount, markAsRead, clearAll } = useNotifications();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -top-1 -right-1 h-5 w-5 rounded-full p-0 flex items-center justify-center text-xs"
            >
              {unreadCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="font-semibold">Benachrichtigungen</h3>
          {notifications.length > 0 && (
            <Button variant="ghost" size="sm" onClick={clearAll}>
              Alle löschen
            </Button>
          )}
        </div>
        <div className="max-h-96 overflow-auto">
          {notifications.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              Keine Benachrichtigungen
            </div>
          ) : (
            <div className="divide-y">
              {notifications.map((notification) => (
                <button
                  key={notification.id}
                  className={`w-full text-left p-4 hover:bg-accent transition-colors ${
                    notification.read ? 'opacity-60' : ''
                  }`}
                  onClick={() => markAsRead(notification.id)}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`mt-1 h-2 w-2 rounded-full ${
                        notification.level === 'error'
                          ? 'bg-destructive'
                          : notification.level === 'warning'
                          ? 'bg-yellow-500'
                          : notification.level === 'success'
                          ? 'bg-green-500'
                          : 'bg-blue-500'
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm">{notification.title}</p>
                      <p className="text-sm text-muted-foreground mt-1">
                        {notification.message}
                      </p>
                      <p className="text-xs text-muted-foreground mt-2">
                        {new Date(notification.created_at).toLocaleTimeString('de-DE')}
                      </p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
```

---

## 3. Implementation Checklist

### Phase 1: Backend (2-3 hours)
- [ ] Create `backend/app/services/notifications.py` with NotificationManager
- [ ] Create `backend/app/api/notifications.py` with endpoints
- [ ] Add notification schemas to `schemas.py`
- [ ] Register notifications router in `main.py`
- [ ] Add notification triggers to incident status updates
- [ ] Add notification triggers to resource assignments

### Phase 2: Frontend (2-3 hours)
- [ ] Create `frontend/lib/contexts/notification-context.tsx`
- [ ] Add notification methods to API client
- [ ] Create `frontend/components/notification-center.tsx`
- [ ] Add NotificationProvider to app layout
- [ ] Add NotificationCenter to header
- [ ] Install and configure toast library (react-hot-toast)

---

## 4. Testing Strategy

### 4.1 Backend Tests

```python
# tests/services/test_notifications.py

async def test_add_notification():
    """Test adding notification to queue."""
    manager = NotificationManager()
    notification = await manager.add(
        type=NotificationType.INCIDENT_STATUS_CHANGE,
        level=NotificationLevel.INFO,
        title="Test",
        message="Test message",
    )
    assert notification.id is not None
    assert notification.title == "Test"

async def test_get_recent_notifications():
    """Test retrieving recent notifications."""
    manager = NotificationManager()
    # Add multiple notifications
    # Get recent
    # Verify count and order
```

### 4.2 Frontend Tests

```typescript
// tests/contexts/notification-context.test.tsx

it('polls for new notifications', async () => {
  // Mock API response
  // Render provider
  // Wait for poll interval
  // Verify notifications updated
});

it('marks notifications as read', async () => {
  // Render with notifications
  // Click notification
  // Verify API called
  // Verify state updated
});
```

---

## 5. Future Enhancements

### 5.1 WebSocket Real-Time
Replace polling with WebSocket connections for instant notifications:

```python
# backend/app/services/notifications.py (WebSocket version)

from fastapi import WebSocket

class NotificationManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def broadcast(self, notification: Notification):
        """Send notification to all connected clients."""
        for connection in self.active_connections:
            await connection.send_json(notification.dict())
```

### 5.2 Persistent Storage
Use Redis or PostgreSQL for notification persistence across server restarts:

```python
# Store in Redis with TTL
await redis.setex(
    f"notification:{notification.id}",
    ttl,
    notification.json(),
)
```

### 5.3 User Preferences
Allow users to configure notification preferences:

```python
class NotificationPreferences(BaseModel):
    incident_status_change: bool = True
    resource_assigned: bool = True
    resource_released: bool = False
    concurrent_edit: bool = True
    system_alert: bool = True
```

### 5.4 Sound Alerts
Play sound for critical notifications:

```typescript
function playNotificationSound(level: string) {
  if (level === 'error' || level === 'warning') {
    const audio = new Audio('/sounds/alert.mp3');
    audio.play();
  }
}
```

---

## Acceptance Criteria

✅ **Must Have:**
- [ ] Backend notification queue and API endpoints
- [ ] Frontend notification context with polling
- [ ] Notification center UI component in header
- [ ] Notifications for incident status changes
- [ ] Notifications for resource assignments/releases
- [ ] Toast/banner display for new notifications
- [ ] Mark as read functionality

🎯 **Should Have:**
- [ ] Auto-dismiss after TTL
- [ ] Visual distinction by severity level
- [ ] Click notification to navigate to resource
- [ ] Clear all notifications button

💡 **Nice to Have:**
- [ ] WebSocket real-time updates (vs. polling)
- [ ] Notification sound alerts
- [ ] User notification preferences
- [ ] Persistent notification history in database
