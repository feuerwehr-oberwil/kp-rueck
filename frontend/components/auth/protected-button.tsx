'use client';

/**
 * Protected Button Component
 * Wraps buttons that require editor permissions
 * Shows lock icon and helpful tooltip for viewers
 * Enhanced with empathetic messaging and subtle animations
 */

import { ReactNode, useState } from 'react';
import { useAuth } from '@/lib/contexts/auth-context';
import { Button, buttonVariants } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Lock, Info } from 'lucide-react';
import { VariantProps } from 'class-variance-authority';
import * as React from 'react';

interface ProtectedButtonProps
  extends React.ComponentProps<'button'>,
    VariantProps<typeof buttonVariants> {
  requiresEditor?: boolean;
  children: ReactNode;
  asChild?: boolean;
}

/**
 * A button component that shows lock icon and empathetic tooltip when user lacks editor permissions
 *
 * @param requiresEditor - If true, button is disabled for viewers (default: true)
 * @param children - Button content
 * @param disabled - Additional disabled state (combined with permission check)
 * @param props - All other Button props (variant, size, className, etc.)
 */
export function ProtectedButton({
  requiresEditor = true,
  children,
  disabled,
  variant,
  size,
  className,
  asChild = false,
  ...props
}: ProtectedButtonProps) {
  const { isEditor } = useAuth();
  const [wiggle, setWiggle] = useState(false);

  // Button is disabled if explicitly disabled OR if editor required but user is not editor
  const isDisabled = disabled || (requiresEditor && !isEditor);
  const showLockIcon = requiresEditor && !isEditor;

  // Trigger wiggle animation when clicking locked button
  const handleLockedClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (showLockIcon) {
      e.preventDefault();
      setWiggle(true);
      setTimeout(() => setWiggle(false), 300);
    }
    if (props.onClick && !isDisabled) {
      props.onClick(e);
    }
  };

  // If no protection needed or user has permission, render normal button
  if (!requiresEditor || isEditor) {
    return (
      <Button
        disabled={disabled}
        variant={variant}
        size={size}
        className={className}
        asChild={asChild}
        {...props}
      >
        {children}
      </Button>
    );
  }

  // Show protected button with lock icon and supportive tooltip
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          disabled={isDisabled}
          variant={variant}
          size={size}
          className={className}
          asChild={asChild}
          {...props}
          onClick={handleLockedClick}
        >
          <Lock
            className={`h-4 w-4 mr-1 ${wiggle ? 'animate-wiggle' : ''}`}
          />
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent className="max-w-[280px]">
        <div className="space-y-2">
          <p className="font-semibold flex items-center gap-2">
            <Info className="h-3 w-3 text-primary" />
            Diese Funktion ist nur für Editoren verfügbar
          </p>
          <p className="text-xs text-muted-foreground">
            Sie können aber alle Einsätze in Echtzeit verfolgen. Sprechen Sie mit Ihrem Administrator für erweiterte Berechtigungen.
          </p>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
