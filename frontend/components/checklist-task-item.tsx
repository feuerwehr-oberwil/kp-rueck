'use client'

import Link from 'next/link'
import { CheckCircle, Circle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { ChecklistTaskState } from '@/lib/checklist-tasks'

interface ChecklistTaskItemProps {
  task: ChecklistTaskState
  onComplete?: () => void
}

const priorityConfig = {
  critical: {
    badge: <Badge variant="destructive" className="text-xs">Erforderlich</Badge>,
    borderClass: 'border-destructive/30'
  },
  recommended: {
    badge: <Badge variant="secondary" className="text-xs">Empfohlen</Badge>,
    borderClass: 'border-yellow-200 dark:border-yellow-800'
  },
  optional: {
    badge: <Badge variant="outline" className="text-xs">Optional</Badge>,
    borderClass: 'border-border'
  }
}

export function ChecklistTaskItem({ task, onComplete }: ChecklistTaskItemProps) {
  const config = priorityConfig[task.priority]

  return (
    <div
      className={cn(
        "flex items-start gap-3 p-4 rounded-lg border transition-all",
        task.completed && "bg-success/10 border-success/30",
        !task.completed && config.borderClass
      )}
    >
      {/* Checkbox icon */}
      <div className="flex-shrink-0 mt-0.5">
        {task.completed ? (
          <CheckCircle className="h-5 w-5 text-success" />
        ) : (
          <Circle className="h-5 w-5 text-muted-foreground" />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Title row */}
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <task.icon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <span className={cn(
            "font-medium",
            task.completed && "text-muted-foreground line-through"
          )}>
            {task.title}
          </span>
          {config.badge}

          {/* Metadata badge */}
          {task.metadata?.details && (
            <Badge variant="secondary" className="text-xs font-normal">
              {task.metadata.details}
            </Badge>
          )}
        </div>

        {/* Description */}
        <p className="text-sm text-muted-foreground mb-3">
          {task.description}
        </p>

        {/* Action buttons - only show if not completed */}
        {!task.completed && task.actionButtons && task.actionButtons.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {task.actionButtons.map((action, index) => (
              action.href ? (
                <Button
                  key={index}
                  variant={action.variant}
                  size="sm"
                  asChild
                >
                  <Link href={action.href}>
                    <action.icon className="h-4 w-4 mr-2" />
                    {action.label}
                  </Link>
                </Button>
              ) : (
                <Button
                  key={index}
                  variant={action.variant}
                  size="sm"
                  onClick={action.onClick}
                >
                  <action.icon className="h-4 w-4 mr-2" />
                  {action.label}
                </Button>
              )
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
