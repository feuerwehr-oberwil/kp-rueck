'use client';

/**
 * Role Badge Component
 * Displays the current user's role (Editor/Viewer) in the navigation
 * Always visible to inform users of their permission level
 * Enhanced with delightful micro-interactions and personality
 */

import { useAuth } from '@/lib/contexts/auth-context';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Eye, Shield, Sparkles } from 'lucide-react';

export function RoleBadge() {
  const { user, isEditor } = useAuth();

  // Don't show badge if no user is logged in
  if (!user) {
    return null;
  }

  const roleName = isEditor ? 'Editor' : 'Viewer';
  const RoleIcon = isEditor ? Shield : Eye;

  // Enhanced tooltip with personality
  const tooltipText = isEditor
    ? 'Sie sind Editor - Ihre Superkraft ist das Erstellen und Bearbeiten von Einsätzen'
    : 'Sie sind Viewer - Ihr Überblick hält das Team informiert';

  const proTip = isEditor
    ? 'Tipp: Mit Drag & Drop können Sie Ressourcen schnell zuweisen'
    : 'Tipp: Sie sehen alle Einsätze in Echtzeit';

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant={isEditor ? 'default' : 'secondary'}
          className="cursor-help gap-1.5 animate-scale-in hover:scale-105 transition-transform"
        >
          <RoleIcon className="h-3 w-3" />
          {/* Show text on desktop, icon-only on mobile */}
          <span className="hidden sm:inline-block">{roleName}</span>
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-[250px]">
        <div className="space-y-2">
          <p className="font-semibold flex items-center gap-2">
            <Sparkles className="h-3 w-3 text-primary" />
            {tooltipText}
          </p>
          <p className="text-xs text-muted-foreground">{proTip}</p>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
