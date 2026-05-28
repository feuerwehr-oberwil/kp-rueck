"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

export interface UnsavedChangesGuard {
  /** Wire to Dialog.onOpenChange. Intercepts close when dirty. */
  handleOpenChange: (open: boolean) => void;
  /** Wire to Cancel-button onClick. Same interception logic. */
  requestClose: () => void;
  /** Props for the matching <UnsavedChangesDialog />. */
  dialogProps: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onConfirm: () => void;
  };
}

/**
 * Guards a dialog/form against silent discard of unsaved changes:
 * - blocks tab close / refresh via beforeunload while dirty + open
 * - intercepts dialog close attempts and surfaces a confirm dialog
 *
 * The caller is responsible for rendering <UnsavedChangesDialog {...dialogProps} />.
 */
export function useUnsavedChangesWarning({
  isDirty,
  isOpen,
  onClose,
}: {
  isDirty: boolean;
  isOpen: boolean;
  onClose: () => void;
}): UnsavedChangesGuard {
  const [isConfirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (!isDirty || !isOpen) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty, isOpen]);

  const requestClose = useCallback(() => {
    if (isDirty) {
      setConfirmOpen(true);
      return;
    }
    onClose();
  }, [isDirty, onClose]);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (open) return;
      requestClose();
    },
    [requestClose],
  );

  const confirmDiscard = useCallback(() => {
    setConfirmOpen(false);
    onClose();
  }, [onClose]);

  const dialogProps = useMemo(
    () => ({
      open: isConfirmOpen,
      onOpenChange: setConfirmOpen,
      onConfirm: confirmDiscard,
    }),
    [isConfirmOpen, confirmDiscard],
  );

  return { handleOpenChange, requestClose, dialogProps };
}
