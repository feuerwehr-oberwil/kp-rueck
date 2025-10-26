# Task 13.1: Comprehensive Help Documentation

**Priority:** P3 (Nice to have - User experience enhancement)
**Complexity:** Medium
**Estimated Effort:** 6-8 hours
**Dependencies:** None
**Status:** Specification Complete - Not Implemented

---

## 1. Overview

Create comprehensive in-app help system with searchable documentation, interactive tutorials, keyboard shortcuts reference, and context-sensitive help tooltips. Help users quickly learn the system and discover advanced features.

### Business Value
- Faster user onboarding and reduced training time
- Self-service support reduces support burden
- Better feature discoverability
- Increased user confidence and productivity
- Professional appearance with polished UX

### User Stories

**As a new user**, I want:
- Step-by-step tutorials to learn basic operations
- Searchable help documentation to find answers quickly
- Tooltips explaining what each UI element does
- Keyboard shortcuts reference to work more efficiently

**As an administrator**, I want:
- Import/export documentation for bulk operations
- Troubleshooting guides for common issues
- Best practices for system management

**As a field responder**, I want:
- Quick reference for Reko form fields
- Mobile-friendly help accessible on tablets
- Offline help documentation

---

## 2. Technical Specification

### 2.1 Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Help System Architecture                 │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  Frontend Components:                                         │
│  ┌──────────────────┐  ┌──────────────────┐                 │
│  │ HelpButton       │  │ HelpPanel        │                 │
│  │ (? icon in nav)  │  │ (slide-over)     │                 │
│  └──────────────────┘  └──────────────────┘                 │
│                                                               │
│  ┌──────────────────┐  ┌──────────────────┐                 │
│  │ SearchHelp       │  │ TooltipProvider  │                 │
│  │ (fuzzy search)   │  │ (context help)   │                 │
│  └──────────────────┘  └──────────────────┘                 │
│                                                               │
│  ┌──────────────────┐  ┌──────────────────┐                 │
│  │ KeyboardShortcuts│  │ InteractiveTour  │                 │
│  │ (modal dialog)   │  │ (step-by-step)   │                 │
│  └──────────────────┘  └──────────────────┘                 │
│                                                               │
│  Backend (Optional):                                          │
│  ┌──────────────────┐  ┌──────────────────┐                 │
│  │ Help Articles DB │  │ Search Index     │                 │
│  │ (future)         │  │ (future)         │                 │
│  └──────────────────┘  └──────────────────┘                 │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Help Content Structure

**Static Markdown Documentation:**

```typescript
// frontend/content/help/index.ts

export interface HelpArticle {
  id: string
  title: string
  category: 'getting-started' | 'incidents' | 'resources' | 'admin' | 'troubleshooting'
  tags: string[]
  content: string  // Markdown
  keywords: string[]  // For search
  relatedArticles: string[]  // Article IDs
  lastUpdated: string
}

export const helpArticles: HelpArticle[] = [
  {
    id: 'quick-start',
    title: 'Quick Start Guide',
    category: 'getting-started',
    tags: ['beginner', 'tutorial'],
    content: `
# Quick Start Guide

Welcome to KP Rück! This guide will help you get started in 5 minutes.

## 1. Understanding the Dashboard

The main dashboard shows all active incidents organized by status...

## 2. Creating Your First Incident

Click the "New Incident" button...
    `,
    keywords: ['start', 'begin', 'introduction', 'basics'],
    relatedArticles: ['create-incident', 'assign-resources'],
    lastUpdated: '2025-10-26',
  },
  {
    id: 'create-incident',
    title: 'Creating and Managing Incidents',
    category: 'incidents',
    tags: ['incident', 'create', 'edit'],
    content: `
# Creating and Managing Incidents

## Creating a New Incident

1. Click "New Incident" button in the top navigation
2. Fill in required fields:
   - **Title**: Brief description (e.g., "Brand Wohnhaus")
   - **Type**: Select incident category
   - **Location**: Street address or coordinates
   - **Crew**: Initial crew assignment
3. Optional fields:
   - **Alarm Time**: Auto-filled with current time
   - **Materials**: Initial equipment needs
4. Click "Create Incident"

## Editing Incidents

- Click on any incident card to open details
- Update fields as needed
- Changes save automatically

## Status Workflow

Incidents move through these statuses:
- **Eingehend**: Just created, awaiting dispatch
- **Unterwegs**: Crew dispatched, en route
- **Am Ziel**: Arrived on scene
- **Abgeschlossen**: Operation completed

Drag and drop incident cards to change status.
    `,
    keywords: ['create', 'new', 'incident', 'alarm', 'edit', 'update', 'status'],
    relatedArticles: ['assign-resources', 'reko-form', 'status-workflow'],
    lastUpdated: '2025-10-26',
  },
  {
    id: 'assign-resources',
    title: 'Assigning Personnel and Vehicles',
    category: 'resources',
    tags: ['personnel', 'vehicles', 'assignment'],
    content: `
# Assigning Resources to Incidents

## Personnel Assignment

1. Open incident details
2. Click "Assign Personnel" button
3. Select available personnel from dropdown
4. Assign roles (e.g., Kommandant, Atemschutz)
5. Personnel status changes to "Eingesetzt"

## Vehicle Assignment

1. In incident details, click "Assign Vehicle"
2. Select from available vehicles (TLF, DLK, MTW)
3. Vehicle status changes to "Im Einsatz"

## Resource Conflicts

⚠️ If a resource is already assigned:
- System shows warning: "Already assigned to [Incident]"
- You can reassign (removes from previous incident)
- Or cancel and choose different resource

## Bulk Assignment

For large incidents:
1. Use Reko form to specify needed resources
2. System suggests optimal assignments
3. Review and approve suggested assignments
    `,
    keywords: ['assign', 'personnel', 'vehicle', 'resource', 'crew', 'equipment'],
    relatedArticles: ['create-incident', 'resource-management'],
    lastUpdated: '2025-10-26',
  },
  {
    id: 'reko-form',
    title: 'Field Reconnaissance (Reko) Forms',
    category: 'incidents',
    tags: ['reko', 'reconnaissance', 'photos'],
    content: `
# Field Reconnaissance (Reko) Forms

Reko forms capture on-scene assessment and resource needs.

## Creating a Reko Report

1. Navigate to incident details
2. Click "Create Reko" tab
3. Fill in assessment:
   - **Situation**: Description of scene
   - **Needed Resources**: Personnel, vehicles, materials
   - **Photos**: Upload up to 10 photos
4. Submit report

## Photo Upload

- Supports: JPG, PNG, HEIC
- Max size: 10MB per photo
- Recommended: Take photos in landscape mode
- Photos are compressed automatically

## Viewing Reko Reports

- All Reko reports appear in incident timeline
- Photos display in gallery view
- Click photo to view full size
- Reports are included in PDF exports
    `,
    keywords: ['reko', 'reconnaissance', 'photos', 'assessment', 'field'],
    relatedArticles: ['create-incident', 'photo-upload'],
    lastUpdated: '2025-10-26',
  },
  {
    id: 'keyboard-shortcuts',
    title: 'Keyboard Shortcuts Reference',
    category: 'getting-started',
    tags: ['shortcuts', 'keyboard', 'productivity'],
    content: `
# Keyboard Shortcuts

## Global Shortcuts

- **?**: Show keyboard shortcuts dialog
- **Ctrl/Cmd + K**: Open search
- **Ctrl/Cmd + N**: Create new incident
- **Esc**: Close dialogs/panels

## Navigation

- **G then D**: Go to Dashboard
- **G then M**: Go to Map
- **G then P**: Go to Personnel
- **G then V**: Go to Vehicles

## Incident Actions

- **E**: Edit selected incident
- **R**: Create Reko for selected incident
- **Ctrl/Cmd + S**: Save changes
- **Ctrl/Cmd + Enter**: Submit form

## Admin (Editors Only)

- **Ctrl/Cmd + I**: Import data
- **Ctrl/Cmd + E**: Export data
    `,
    keywords: ['keyboard', 'shortcuts', 'hotkeys', 'productivity'],
    relatedArticles: ['quick-start'],
    lastUpdated: '2025-10-26',
  },
  {
    id: 'import-export',
    title: 'Importing and Exporting Data',
    category: 'admin',
    tags: ['import', 'export', 'excel', 'admin'],
    content: `
# Importing and Exporting Data

**Note**: Import/export features require Editor role.

## Downloading Import Template

1. Navigate to Admin → Import/Export
2. Click "Download Template"
3. Opens Excel file with three sheets:
   - Personnel
   - Vehicles
   - Materials

## Filling Out Template

### Personnel Sheet
- **name** (required): Full name
- **role**: Kommandant, Atemschutz, etc.
- **divera_alarm_id**: Divera integration ID
- **phone_number**: Contact number
- **availability_status**: verfuegbar, nicht_verfuegbar, krank

### Vehicles Sheet
- **name** (required): Vehicle identifier
- **type** (required): tlf, dlk, mtw, kdow
- **display_order** (required): Sort order (number)
- **status** (required): verfuegbar, im_einsatz, ausser_dienst
- **radio_call_sign** (required): Radio callsign

### Materials Sheet
- **name** (required): Material name
- **type** (required): ausruestung, werkzeug, schlauch, etc.
- **location** (required): Storage location
- **description**: Optional notes

## Import Process

1. Upload filled template
2. Click "Preview Import"
3. Review data (first 10 rows shown)
4. Select import mode:
   - **Replace**: Delete all existing data, import new
   - **Append**: Keep existing data, add new
5. Click "Execute Import"
6. Confirm action

## Exporting Data

1. Navigate to Admin → Import/Export
2. Click "Export All Data"
3. Downloads Excel file with current data
4. Use for backups or analysis

## Common Issues

**Error: "Invalid value for column 'status'"**
- Solution: Check that enum values match exactly (e.g., 'verfuegbar' not 'available')

**Error: "Required column missing"**
- Solution: Ensure all required columns are present (download fresh template)
    `,
    keywords: ['import', 'export', 'excel', 'template', 'bulk', 'admin'],
    relatedArticles: ['troubleshooting'],
    lastUpdated: '2025-10-26',
  },
  {
    id: 'training-mode',
    title: 'Training Mode vs Live Operations',
    category: 'getting-started',
    tags: ['training', 'live', 'mode'],
    content: `
# Training Mode vs Live Operations

The system supports both training exercises and live operations using the same database.

## Understanding Training Flag

- Each incident has a **training_flag** boolean
- **Training = true**: Practice/exercise incident
- **Training = false**: Real emergency

## Switching Modes

Toggle between modes in the top navigation:
- **"Übung" (Training)**: Shows only training incidents
- **"Einsatz" (Live)**: Shows only real incidents

## Best Practices

### During Training
1. Create incidents with training flag enabled
2. Practice workflows without affecting live data
3. Test new features safely
4. Review and delete training data after exercise

### During Live Operations
1. Ensure training mode is OFF
2. All new incidents default to live mode
3. Real incidents never show in training view

## Data Separation

- Training and live incidents never mix in views
- Reports can include or exclude training data
- Exports clearly label training vs live data
    `,
    keywords: ['training', 'live', 'mode', 'exercise', 'practice'],
    relatedArticles: ['quick-start'],
    lastUpdated: '2025-10-26',
  },
  {
    id: 'troubleshooting',
    title: 'Troubleshooting Common Issues',
    category: 'troubleshooting',
    tags: ['troubleshooting', 'errors', 'problems'],
    content: `
# Troubleshooting Common Issues

## Connection Problems

**Symptom**: "Failed to fetch" or "Network error"

**Solutions**:
1. Check internet connection
2. Verify backend is running (Railway status page)
3. Clear browser cache (Ctrl/Cmd + Shift + R)
4. Try different browser

## Login Issues

**Symptom**: Cannot log in or session expires immediately

**Solutions**:
1. Clear cookies for the site
2. Ensure cookies are enabled in browser
3. Check username/password (case-sensitive)
4. Contact administrator to verify account status

## Data Not Updating

**Symptom**: Changes not appearing, stale data

**Solutions**:
1. Refresh page (F5)
2. Check polling status (should update every 5s)
3. Verify you have Editor role for write operations
4. Check browser console for errors (F12)

## Photo Upload Failures

**Symptom**: Photos not uploading or "File too large"

**Solutions**:
1. Ensure file size < 10MB
2. Use supported formats: JPG, PNG, HEIC
3. Compress large photos before upload
4. Check internet connection stability
5. Try uploading one photo at a time

## Import Errors

**Symptom**: Excel import fails with validation errors

**Solutions**:
1. Download fresh template (don't modify column headers)
2. Check enum values match exactly (case-sensitive)
3. Ensure required fields are filled
4. Remove special characters from text fields
5. Verify data types (numbers for display_order, etc.)

## Performance Issues

**Symptom**: Slow page load, laggy interactions

**Solutions**:
1. Close unnecessary browser tabs
2. Clear browser cache
3. Check network speed
4. Reduce number of open incidents
5. Use Chrome or Firefox (recommended browsers)

## Map Not Loading

**Symptom**: Map shows blank or "Loading..."

**Solutions**:
1. Check internet connection (map tiles load from OpenStreetMap)
2. Disable browser extensions (ad blockers may block tiles)
3. Try incognito/private mode
4. Clear browser cache

## Getting Help

If issues persist:
1. Check browser console for errors (F12 → Console tab)
2. Note exact error message
3. Contact administrator with:
   - What you were trying to do
   - Error message or screenshot
   - Browser and version
   - Steps to reproduce
    `,
    keywords: ['troubleshooting', 'errors', 'problems', 'issues', 'help', 'fix'],
    relatedArticles: ['import-export'],
    lastUpdated: '2025-10-26',
  },
]
```

### 2.3 Frontend Components

#### Help Button Component

```typescript
// frontend/components/help/help-button.tsx

'use client'

import { useState } from 'react'
import { HelpCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { HelpPanel } from './help-panel'

export function HelpButton() {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setIsOpen(true)}
        className="relative"
        title="Help & Documentation (Press ?)"
      >
        <HelpCircle className="h-5 w-5" />
      </Button>

      <HelpPanel isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </>
  )
}
```

#### Help Panel (Slide-over)

```typescript
// frontend/components/help/help-panel.tsx

'use client'

import { useState, useMemo } from 'react'
import { X, Search, Book, Keyboard } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { helpArticles, type HelpArticle } from '@/content/help'
import ReactMarkdown from 'react-markdown'

interface HelpPanelProps {
  isOpen: boolean
  onClose: () => void
}

export function HelpPanel({ isOpen, onClose }: HelpPanelProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedArticle, setSelectedArticle] = useState<HelpArticle | null>(null)

  // Fuzzy search
  const filteredArticles = useMemo(() => {
    if (!searchQuery) return helpArticles

    const query = searchQuery.toLowerCase()
    return helpArticles.filter(article => {
      return (
        article.title.toLowerCase().includes(query) ||
        article.keywords.some(kw => kw.includes(query)) ||
        article.tags.some(tag => tag.includes(query)) ||
        article.content.toLowerCase().includes(query)
      )
    }).sort((a, b) => {
      // Prioritize title matches
      const aScore = a.title.toLowerCase().includes(query) ? 1 : 0
      const bScore = b.title.toLowerCase().includes(query) ? 1 : 0
      return bScore - aScore
    })
  }, [searchQuery])

  // Group by category
  const articlesByCategory = useMemo(() => {
    const groups: Record<string, HelpArticle[]> = {}
    filteredArticles.forEach(article => {
      if (!groups[article.category]) {
        groups[article.category] = []
      }
      groups[article.category].push(article)
    })
    return groups
  }, [filteredArticles])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="absolute inset-y-0 right-0 w-full max-w-2xl bg-background shadow-xl">
        <div className="flex h-full flex-col">
          {/* Header */}
          <div className="flex items-center justify-between border-b p-4">
            <div className="flex items-center gap-2">
              <Book className="h-5 w-5" />
              <h2 className="text-lg font-semibold">Help & Documentation</h2>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="h-5 w-5" />
            </Button>
          </div>

          {/* Search */}
          <div className="border-b p-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search help articles..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-hidden">
            {selectedArticle ? (
              // Article view
              <ScrollArea className="h-full">
                <div className="p-6">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedArticle(null)}
                    className="mb-4"
                  >
                    ← Back to articles
                  </Button>

                  <ReactMarkdown className="prose prose-sm dark:prose-invert max-w-none">
                    {selectedArticle.content}
                  </ReactMarkdown>

                  {/* Related articles */}
                  {selectedArticle.relatedArticles.length > 0 && (
                    <div className="mt-8 border-t pt-4">
                      <h3 className="text-sm font-semibold mb-2">Related Articles</h3>
                      <div className="space-y-1">
                        {selectedArticle.relatedArticles.map(id => {
                          const related = helpArticles.find(a => a.id === id)
                          return related ? (
                            <Button
                              key={id}
                              variant="ghost"
                              size="sm"
                              onClick={() => setSelectedArticle(related)}
                              className="w-full justify-start"
                            >
                              {related.title}
                            </Button>
                          ) : null
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </ScrollArea>
            ) : (
              // Article list
              <ScrollArea className="h-full">
                <div className="p-4 space-y-4">
                  {Object.entries(articlesByCategory).map(([category, articles]) => (
                    <div key={category}>
                      <h3 className="text-sm font-semibold mb-2 capitalize">
                        {category.replace('-', ' ')}
                      </h3>
                      <div className="space-y-1">
                        {articles.map(article => (
                          <Button
                            key={article.id}
                            variant="ghost"
                            className="w-full justify-start"
                            onClick={() => setSelectedArticle(article)}
                          >
                            <div className="text-left">
                              <div className="font-medium">{article.title}</div>
                              <div className="text-xs text-muted-foreground">
                                {article.tags.join(', ')}
                              </div>
                            </div>
                          </Button>
                        ))}
                      </div>
                    </div>
                  ))}

                  {filteredArticles.length === 0 && (
                    <div className="text-center py-8 text-muted-foreground">
                      No articles found matching "{searchQuery}"
                    </div>
                  )}
                </div>
              </ScrollArea>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
```

#### Keyboard Shortcuts Dialog

```typescript
// frontend/components/help/keyboard-shortcuts-dialog.tsx

'use client'

import { useEffect, useState } from 'react'
import { Keyboard, X } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

const shortcuts = [
  {
    category: 'Global',
    items: [
      { keys: ['?'], description: 'Show keyboard shortcuts' },
      { keys: ['Ctrl', 'K'], description: 'Open search' },
      { keys: ['Ctrl', 'N'], description: 'Create new incident' },
      { keys: ['Esc'], description: 'Close dialogs/panels' },
    ],
  },
  {
    category: 'Navigation',
    items: [
      { keys: ['G', 'D'], description: 'Go to Dashboard' },
      { keys: ['G', 'M'], description: 'Go to Map' },
      { keys: ['G', 'P'], description: 'Go to Personnel' },
      { keys: ['G', 'V'], description: 'Go to Vehicles' },
    ],
  },
  {
    category: 'Incident Actions',
    items: [
      { keys: ['E'], description: 'Edit selected incident' },
      { keys: ['R'], description: 'Create Reko' },
      { keys: ['Ctrl', 'S'], description: 'Save changes' },
      { keys: ['Ctrl', 'Enter'], description: 'Submit form' },
    ],
  },
  {
    category: 'Admin (Editors Only)',
    items: [
      { keys: ['Ctrl', 'I'], description: 'Import data' },
      { keys: ['Ctrl', 'E'], description: 'Export data' },
    ],
  },
]

export function KeyboardShortcutsDialog() {
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // Open on ? key
      if (e.key === '?' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        setIsOpen(true)
      }
    }

    document.addEventListener('keydown', handleKeyPress)
    return () => document.removeEventListener('keydown', handleKeyPress)
  }, [])

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="h-5 w-5" />
            Keyboard Shortcuts
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-6">
          {shortcuts.map(section => (
            <div key={section.category}>
              <h3 className="text-sm font-semibold mb-3">{section.category}</h3>
              <div className="space-y-2">
                {section.items.map((item, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{item.description}</span>
                    <div className="flex gap-1">
                      {item.keys.map((key, j) => (
                        <kbd
                          key={j}
                          className="px-2 py-1 bg-muted rounded text-xs font-mono"
                        >
                          {key}
                        </kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

#### Context-Sensitive Tooltips

```typescript
// frontend/components/help/help-tooltip.tsx

'use client'

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { HelpCircle } from 'lucide-react'

interface HelpTooltipProps {
  content: string
  children?: React.ReactNode
}

export function HelpTooltip({ content, children }: HelpTooltipProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          {children || (
            <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
          )}
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <p>{content}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

// Usage example:
// <div className="flex items-center gap-2">
//   <label>Training Flag</label>
//   <HelpTooltip content="Mark this incident as a training exercise. Training incidents are separate from live operations." />
// </div>
```

#### Interactive Tutorial System

```typescript
// frontend/components/help/tutorial-overlay.tsx

'use client'

import { useState, useEffect } from 'react'
import { X, ChevronRight, ChevronLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface TutorialStep {
  target: string  // CSS selector
  title: string
  content: string
  position: 'top' | 'bottom' | 'left' | 'right'
}

const quickStartTutorial: TutorialStep[] = [
  {
    target: '[data-tutorial="new-incident"]',
    title: 'Create New Incident',
    content: 'Click here to create a new incident. You\'ll be prompted to enter details like location and type.',
    position: 'bottom',
  },
  {
    target: '[data-tutorial="incident-card"]',
    title: 'Incident Cards',
    content: 'Each card represents an incident. Drag and drop to change status. Click to view details.',
    position: 'right',
  },
  {
    target: '[data-tutorial="status-column"]',
    title: 'Status Columns',
    content: 'Incidents are organized by status: Eingehend → Unterwegs → Am Ziel → Abgeschlossen',
    position: 'top',
  },
  {
    target: '[data-tutorial="map-link"]',
    title: 'Map View',
    content: 'Switch to map view to see all incidents plotted on OpenStreetMap.',
    position: 'bottom',
  },
]

export function TutorialOverlay() {
  const [isActive, setIsActive] = useState(false)
  const [currentStep, setCurrentStep] = useState(0)
  const [highlightRect, setHighlightRect] = useState<DOMRect | null>(null)

  useEffect(() => {
    // Show tutorial on first visit
    const hasSeenTutorial = localStorage.getItem('hasSeenTutorial')
    if (!hasSeenTutorial) {
      setIsActive(true)
    }
  }, [])

  useEffect(() => {
    if (!isActive) return

    const step = quickStartTutorial[currentStep]
    const element = document.querySelector(step.target)
    if (element) {
      setHighlightRect(element.getBoundingClientRect())
      element.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [currentStep, isActive])

  const handleNext = () => {
    if (currentStep < quickStartTutorial.length - 1) {
      setCurrentStep(currentStep + 1)
    } else {
      handleClose()
    }
  }

  const handlePrevious = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1)
    }
  }

  const handleClose = () => {
    setIsActive(false)
    localStorage.setItem('hasSeenTutorial', 'true')
  }

  if (!isActive || !highlightRect) return null

  const step = quickStartTutorial[currentStep]

  return (
    <div className="fixed inset-0 z-50 pointer-events-none">
      {/* Backdrop with cutout */}
      <div className="absolute inset-0 bg-black/70" />
      <div
        className="absolute bg-background"
        style={{
          left: highlightRect.left - 4,
          top: highlightRect.top - 4,
          width: highlightRect.width + 8,
          height: highlightRect.height + 8,
          boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.7)',
          borderRadius: '0.5rem',
        }}
      />

      {/* Tutorial popup */}
      <div
        className="absolute pointer-events-auto bg-card border rounded-lg shadow-lg p-4 max-w-sm"
        style={{
          left: step.position === 'right' ? highlightRect.right + 20 : highlightRect.left,
          top: step.position === 'bottom' ? highlightRect.bottom + 20 : highlightRect.top,
        }}
      >
        <div className="flex items-start justify-between mb-2">
          <h3 className="font-semibold">{step.title}</h3>
          <Button variant="ghost" size="icon" onClick={handleClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <p className="text-sm text-muted-foreground mb-4">{step.content}</p>

        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {currentStep + 1} of {quickStartTutorial.length}
          </span>

          <div className="flex gap-2">
            {currentStep > 0 && (
              <Button variant="outline" size="sm" onClick={handlePrevious}>
                <ChevronLeft className="h-4 w-4 mr-1" />
                Previous
              </Button>
            )}
            <Button size="sm" onClick={handleNext}>
              {currentStep < quickStartTutorial.length - 1 ? (
                <>
                  Next
                  <ChevronRight className="h-4 w-4 ml-1" />
                </>
              ) : (
                'Finish'
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
```

### 2.4 Integration into App

```typescript
// frontend/app/layout.tsx

import { HelpButton } from '@/components/help/help-button'
import { KeyboardShortcutsDialog } from '@/components/help/keyboard-shortcuts-dialog'
import { TutorialOverlay } from '@/components/help/tutorial-overlay'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body>
        {/* Existing providers */}
        <OperationsProvider>
          {/* Navigation with Help button */}
          <nav className="border-b">
            <div className="flex items-center justify-between p-4">
              {/* ... existing nav items ... */}
              <HelpButton />
            </div>
          </nav>

          {children}

          {/* Global help components */}
          <KeyboardShortcutsDialog />
          <TutorialOverlay />
        </OperationsProvider>
      </body>
    </html>
  )
}
```

---

## 3. Implementation Checklist

### Phase 1: Help Content (2-3 hours)
- [ ] Create help article content structure
- [ ] Write 8+ help articles covering key features
- [ ] Add search keywords and tags
- [ ] Set up related articles linking
- [ ] Create markdown rendering setup

### Phase 2: Help UI Components (2-3 hours)
- [ ] Create HelpButton component
- [ ] Create HelpPanel slide-over with search
- [ ] Implement article list and detail views
- [ ] Add fuzzy search functionality
- [ ] Create KeyboardShortcutsDialog
- [ ] Add context-sensitive HelpTooltip component

### Phase 3: Interactive Tutorials (2 hours)
- [ ] Create TutorialOverlay component
- [ ] Define quick start tutorial steps
- [ ] Implement highlight overlay system
- [ ] Add step navigation (next/previous/skip)
- [ ] Persist tutorial completion state

### Phase 4: Integration (1 hour)
- [ ] Add HelpButton to navigation
- [ ] Add data-tutorial attributes to key elements
- [ ] Implement keyboard shortcut listeners
- [ ] Add tooltips to complex form fields
- [ ] Test help system across all pages

---

## 4. Testing Strategy

### 4.1 Content Testing
- [ ] Verify all help articles render correctly
- [ ] Test markdown formatting (headings, lists, code blocks)
- [ ] Validate related article links
- [ ] Check search returns relevant results

### 4.2 UI Testing
- [ ] Test help panel open/close
- [ ] Verify search filters articles correctly
- [ ] Test article navigation (back button)
- [ ] Test keyboard shortcuts dialog (press ?)
- [ ] Verify tooltips display on hover

### 4.3 Tutorial Testing
- [ ] Test tutorial auto-starts on first visit
- [ ] Verify highlight overlay positions correctly
- [ ] Test step navigation (next/previous)
- [ ] Verify tutorial doesn't show after completion
- [ ] Test skip/close functionality

### 4.4 Accessibility
- [ ] Keyboard navigation works
- [ ] Screen reader announces help content
- [ ] Focus management in dialogs
- [ ] Color contrast meets WCAG standards

---

## 5. Future Enhancements

### 5.1 Backend-Managed Help
```python
# backend/app/api/help.py

@router.get("/articles", response_model=list[schemas.HelpArticle])
async def get_help_articles(
    category: str | None = None,
    search: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Get help articles with optional filtering."""
    query = select(models.HelpArticle)
    if category:
        query = query.where(models.HelpArticle.category == category)
    if search:
        query = query.where(models.HelpArticle.content.ilike(f"%{search}%"))
    result = await db.execute(query)
    return result.scalars().all()
```

### 5.2 Video Tutorials
- Embed video walkthroughs
- Screen recordings of common tasks
- YouTube integration

### 5.3 Interactive Demos
- Sandbox mode with fake data
- Click-through demos
- Guided practice exercises

### 5.4 Contextual Help
- Show relevant help based on current page
- AI-powered help suggestions
- "Getting stuck?" detection

### 5.5 Analytics
- Track most-viewed help articles
- Identify knowledge gaps
- Measure tutorial completion rates

---

## Acceptance Criteria

✅ **Must Have:**
- [ ] Help button in navigation opens help panel
- [ ] At least 8 comprehensive help articles
- [ ] Searchable help with fuzzy matching
- [ ] Keyboard shortcuts dialog (press ?)
- [ ] Context-sensitive tooltips on complex fields
- [ ] Help content renders markdown correctly

🎯 **Should Have:**
- [ ] Interactive quick start tutorial
- [ ] Related articles linking
- [ ] Category-based organization
- [ ] Tutorial completion persistence
- [ ] Mobile-friendly help panel

💡 **Nice to Have:**
- [ ] Video tutorials
- [ ] Keyboard shortcut hints in UI
- [ ] "Was this helpful?" feedback
- [ ] Print-friendly help pages
- [ ] Offline help access
