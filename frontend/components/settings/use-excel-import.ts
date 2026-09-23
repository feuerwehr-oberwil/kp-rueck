"use client";

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { apiClient, type ApiExcelImportPreview } from '@/lib/api-client';
import type { ImportStock } from '@/components/settings/import-balance';

/**
 * The Excel import/export of the resource tables — its state and its handlers.
 *
 * Moved out of `app/settings/page.tsx` verbatim (2026-09-23). The page renders
 * `<ExcelImportSection>` with this and keeps the «Ersetzen» confirmation, which
 * sits outside the section. ⚠️ `setImportError` is also what the audit export
 * reports its failures through — kept that way on purpose in a pure move, see
 * the note in the page.
 */
export function useExcelImport(activeSection: string, isEditor: boolean) {
  const t = useTranslations('settings');
  // Import/Export state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ApiExcelImportPreview | null>(null);
  // `append` is the default on purpose. On a first-run board – the only board where
  // nobody has yet learned what these two words cost – the two modes do exactly the
  // same thing, because there is nothing to replace. On a board that has been in use
  // for a year they differ by the whole roster. So the safe default is free where it
  // is indistinguishable and priceless where it is not.
  const [importMode, setImportMode] = useState<'replace' | 'append'>('append');
  // What the three tables hold right now. `deletions` only reports the stock in
  // `replace` mode, and the mode buttons have to state their price before a file is
  // even chosen – so the counts are fetched rather than inferred from the preview.
  const [stock, setStock] = useState<ImportStock | null>(null);
  const [replaceConfirmOpen, setReplaceConfirmOpen] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);

  // Current stock, loaded when the import section opens and refreshed after an
  // import so the balance never quotes a "Bestand heute" the import just changed.
  const fetchStock = async () => {
    try {
      const [personnel, vehicles, materials] = await Promise.all([
        apiClient.getAllPersonnel(),
        apiClient.getVehicles(),
        apiClient.getAllMaterials(),
      ]);
      setStock({ personnel: personnel.length, vehicles: vehicles.length, materials: materials.length });
    } catch (err) {
      console.error('Failed to count existing resources:', err);
      setStock(null);
    }
  };

  useEffect(() => {
    if (activeSection === 'import' && isEditor) {
      fetchStock();
    }
  }, [activeSection, isEditor]);

  // Import/Export handlers
  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setPreview(null);
      setImportError(null);
      setImportSuccess(null);
    }
  };

  // Changing the mode invalidates the preview. The preview now reports how many existing rows
  // the import would DELETE, and that number is mode-specific – `Anhängen` deletes nothing.
  // Leaving a stale preview on screen would show the operator the deletion figures for a mode
  // they just navigated away from, which is the exact number this whole surface exists to get
  // right. The preview button is disabled while a preview is loaded, so clearing it is also
  // what re-enables it.
  const selectImportMode = (mode: 'replace' | 'append') => {
    setImportMode(mode);
    setPreview(null);
  };

  const handlePreview = async () => {
    if (!selectedFile) return;
    setImportLoading(true);
    setImportError(null);
    try {
      // Pass the selected mode: the preview now reports how many rows the import would
      // DELETE, and that number is only meaningful for the mode about to be executed.
      //
      // The stock is re-counted alongside it. In `append` the balance has nothing else
      // to build «Bestand nachher» from, and a count from when the section was opened
      // is a count from before lunch. Fetching both together does not make them one
      // answer – the balance still marks the `append` total as an estimate – but it
      // shrinks the window in which they can disagree to the length of one request.
      const [result] = await Promise.all([
        apiClient.previewExcelImport(selectedFile, importMode),
        fetchStock(),
      ]);
      setPreview(result);
      setTimeout(() => {
        previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : t('page.errors.previewFailed'));
    } finally {
      setImportLoading(false);
    }
  };

  const handleImport = async () => {
    if (!selectedFile) return;
    setImportLoading(true);
    setImportError(null);
    try {
      const result = await apiClient.executeExcelImport(selectedFile, importMode);
      setImportSuccess(
        t('page.import.importSuccess', {
          personnel: result.counts.personnel,
          vehicles: result.counts.vehicles,
          materials: result.counts.materials,
        })
      );
      setSelectedFile(null);
      setPreview(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      fetchStock();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : t('page.errors.importFailed'));
    } finally {
      setImportLoading(false);
    }
  };

  const handleExport = async () => {
    setImportLoading(true);
    setImportError(null);
    try {
      const blob = await apiClient.exportAllData();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      a.download = `kprueck_export_${timestamp}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast.success(t('page.toasts.exportSuccess'));
    } catch (err) {
      setImportError(err instanceof Error ? err.message : t('page.errors.exportFailed'));
    } finally {
      setImportLoading(false);
    }
  };

  const handleDownloadTemplate = async () => {
    setImportLoading(true);
    try {
      const blob = await apiClient.downloadImportTemplate();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'kprueck_import_template.xlsx';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch {
      toast.error(t('page.toasts.templateDownloadFailed'));
    } finally {
      setImportLoading(false);
    }
  };

  const resetImport = () => {
    setSelectedFile(null);
    setPreview(null);
    setImportError(null);
    setImportSuccess(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return {
    fileInputRef,
    previewRef,
    selectedFile,
    preview,
    importMode,
    stock,
    replaceConfirmOpen,
    setReplaceConfirmOpen,
    importLoading,
    importError,
    setImportError,
    importSuccess,
    setImportSuccess,
    handleFileSelect,
    selectImportMode,
    handlePreview,
    handleImport,
    handleExport,
    handleDownloadTemplate,
    resetImport,
  };
}

export type ExcelImport = ReturnType<typeof useExcelImport>;
