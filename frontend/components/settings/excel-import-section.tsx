"use client";

import { useTranslations } from 'next-intl';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle,
  Download,
  FileSpreadsheet,
  Lock,
  Package,
  Plus,
  Trash2,
  Truck,
  Upload,
  Users,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DemoLock } from '@/components/settings/demo-lock';
import { ImportBalanceCard } from '@/components/settings/import-balance-card';
import { IMPORT_RESOURCES, buildImportBalance, emptySheetNotices } from '@/components/settings/import-balance';
import { SettingCard } from '@/components/settings/setting-row';
import type { ExcelImport } from '@/components/settings/use-excel-import';

/**
 * «Import / Export»: export everything, then import in three steps — mode
 * first, template, file — with the balance and the parsed rows below.
 *
 * The JSX of the settings page's `import` section, moved verbatim
 * (2026-09-23); the state and handlers come from `useExcelImport`.
 */
export function ExcelImportSection({ importer, demoMode }: { importer: ExcelImport; demoMode: boolean }) {
  const t = useTranslations('settings');
  const {
    preview,
    stock,
    importMode,
    selectImportMode,
    importError,
    setImportError,
    importSuccess,
    setImportSuccess,
    handleExport,
    importLoading,
    handleDownloadTemplate,
    selectedFile,
    fileInputRef,
    handleFileSelect,
    handlePreview,
    setReplaceConfirmOpen,
    handleImport,
    resetImport,
    previewRef,
  } = importer;
  // The preview is the balance: it carries the deletion figures, which are the
  // half that must never be missing. The stock counts are handed in as the
  // second-best source they are – the balance uses them only where the preview
  // says nothing (`append`) and labels the result. A failed stock fetch
  // therefore costs the «nachher» column, not the whole card.
  // `selectImportMode` drops the preview whenever the mode changes, so
  // `preview.mode` and `importMode` cannot drift.
  const balance = preview ? buildImportBalance(preview, stock) : null;
  const isReplace = importMode === 'replace';
  // Above zero the backend answers 409. Saying so here, with the number,
  // beats letting the operator find out from a rejected POST. Read off the
  // preview rather than the balance on purpose: the gate has to hold even
  // when the stock counts failed to load and there is no balance to show.
  const activeOrphans = preview?.deletions.active_incident_assignments ?? 0;
  const replaceBlocked = preview?.mode === 'replace' && activeOrphans > 0;
  const emptySheets = preview ? emptySheetNotices(preview) : [];
  const switchToAppend = () => selectImportMode('append');

  return (
    <div className="space-y-6">
      {/* Notifications */}
      {importError && (
        <SettingCard className="border-destructive bg-destructive/10">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-destructive mt-0.5" />
            <div className="flex-1">
              <p className="text-sm text-destructive/90">{importError}</p>
            </div>
            <Button variant="ghost" size="icon-xs" onClick={() => setImportError(null)}>
              <X className="size-3.5" />
            </Button>
          </div>
        </SettingCard>
      )}

      {importSuccess && (
        <SettingCard className="border-success bg-success/10">
          <div className="flex items-start gap-3">
            <CheckCircle className="h-5 w-5 text-success mt-0.5" />
            <div className="flex-1">
              <p className="text-sm text-success">{importSuccess}</p>
            </div>
            <Button variant="ghost" size="icon-xs" onClick={() => setImportSuccess(null)}>
              <X className="size-3.5" />
            </Button>
          </div>
        </SettingCard>
      )}

      {/* Export - Simple one-click action. Titel, Untertitel und die eine
          Aktion sind genau der Kartenkopf, den `SettingCard` mitbringt. */}
      <SettingCard
        title={t('page.import.exportTitle')}
        subtitle={t('page.import.exportDescription')}
        action={
          <Button onClick={handleExport} disabled={importLoading}>
            <Download className="size-4" />
            {t('page.import.exportButton')}
          </Button>
        }
      />


      {/* Import – mode first, then the file.
          The mode, not the file, decides what the import costs: the same
          workbook either adds two recruits or deletes the whole station and
          then adds two recruits. Choosing it last, tucked below the upload,
          made the expensive half of that sentence the easy thing to skip. */}
      <DemoLock active={demoMode}>
      {/* Das Symbol wandert in den Titel, das Abzeichen in den Aktionsplatz –
          derselbe Kartenkopf wie überall, nur dass er hier mit dem Modus die
          Farbe wechselt. */}
      <SettingCard
        className={isReplace ? 'border-destructive/40' : undefined}
        title={
          <span className="flex items-center gap-2">
            {isReplace
              ? <Trash2 className="size-4 shrink-0 text-destructive" aria-hidden="true" />
              : <Plus className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
            {isReplace ? t('page.import.importTitleReplace') : t('page.import.importTitleAppend')}
          </span>
        }
        subtitle={isReplace ? t('page.import.importDescriptionReplace') : t('page.import.importDescriptionAppend')}
        action={
          isReplace ? (
            <Badge variant="destructive">
              <Trash2 aria-hidden="true" />
              {t('page.import.badgeDataLoss')}
            </Badge>
          ) : (
            <Badge variant="outline" className="border-success/40 text-success">
              <CheckCircle aria-hidden="true" />
              {t('page.import.badgeNoDeletion')}
            </Badge>
          )
        }
      >
        <div className="space-y-5">
          {/* Step 1: Mode – with its price in the station's own numbers. */}
          <div className="p-3 bg-muted/50 rounded-lg space-y-3">
            <div className="flex items-center gap-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-sm font-medium">1</div>
              <div>
                <p className="text-sm font-medium">{t('page.import.step3Title')}</p>
                <p className="text-xs text-muted-foreground">{t('page.import.modeStepHint')}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 ml-12">
              {([
                { mode: 'replace' as const, icon: Trash2 },
                { mode: 'append' as const, icon: Plus },
              ]).map(({ mode, icon: ModeIcon }) => {
                const selected = importMode === mode;
                const destructive = mode === 'replace';
                return (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => selectImportMode(mode)}
                    className={`rounded-lg border-2 p-3 text-left transition-all ${
                      selected
                        ? destructive ? 'border-destructive bg-destructive/5' : 'border-primary bg-primary/5'
                        : 'border-border hover:border-primary/50'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <ModeIcon className={`size-4 shrink-0 ${destructive ? 'text-destructive' : 'text-muted-foreground'}`} aria-hidden="true" />
                      <span className="font-medium text-sm">
                        {destructive ? t('page.import.modeReplace') : t('page.import.modeAppend')}
                      </span>
                      {selected && (
                        <Badge variant={destructive ? 'destructive' : 'secondary'} className="ml-auto">
                          {t('page.import.modeChosen')}
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {destructive ? t('page.import.modeReplaceHint') : t('page.import.modeAppendHint')}
                    </p>
                    {/* The cost, before any file exists: `replace` deletes the
                        whole stock, `append` deletes nothing. */}
                    {stock && (
                      <div className="mt-2 border-t pt-2">
                        <p className="text-xs font-semibold text-muted-foreground">
                          {t('page.import.modeCostHeading')}
                        </p>
                        <dl className="mt-1 space-y-0.5 text-xs tabular-nums">
                          {IMPORT_RESOURCES.map((resource) => {
                            const count = destructive ? stock[resource] : 0;
                            return (
                              <div key={resource} className="flex items-baseline justify-between gap-2">
                                <dt className="text-muted-foreground">{t(`page.sections.${resource}`)}</dt>
                                <dd className={count > 0 ? 'font-semibold text-destructive' : 'text-muted-foreground'}>
                                  {count}
                                </dd>
                              </div>
                            );
                          })}
                        </dl>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Step 2: Template */}
          <div className="flex items-center gap-4 p-3 bg-muted/50 rounded-lg">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-sm font-medium">2</div>
            <div className="flex-1">
              <p className="text-sm font-medium">{t('page.import.step1Title')}</p>
              <p className="text-xs text-muted-foreground">{t('page.import.step1Description')}</p>
            </div>
            <Button onClick={handleDownloadTemplate} disabled={importLoading} variant="outline" size="sm">
              <FileSpreadsheet className="size-3.5" />
              {t('page.import.templateButton')}
            </Button>
          </div>

          {/* Step 3: File selection */}
          <div className="flex items-center gap-4 p-3 bg-muted/50 rounded-lg">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-sm font-medium">3</div>
            <div className="flex-1">
              <p className="text-sm font-medium">{t('page.import.step2Title')}</p>
              {selectedFile && (
                <p className="text-xs text-muted-foreground truncate max-w-[200px]">{selectedFile.name}</p>
              )}
            </div>
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileSelect}
                className="hidden"
                id="file-upload"
              />
              <label
                htmlFor="file-upload"
                className="inline-flex items-center gap-2 px-3 py-2 rounded-md border bg-background hover:bg-accent cursor-pointer text-sm"
              >
                <Upload className="h-4 w-4" />
                {selectedFile ? t('page.import.changeFile') : t('page.import.chooseFile')}
              </label>
            </div>
          </div>

          {/* Step 4: Actions (only if file selected) */}
          {selectedFile && (
            <div className={`flex items-center gap-3 pt-3 border-t ${isReplace ? 'border-destructive/30' : ''}`}>
              <Button onClick={handlePreview} disabled={importLoading || !!preview} variant="outline">
                {t('page.import.showPreview')}
              </Button>
              {preview && (
                replaceBlocked ? (
                  <>
                    <Button variant="destructive" disabled title={t('page.import.replaceBlockedTooltip', { count: activeOrphans })}>
                      <Lock className="size-4" aria-hidden="true" />
                      {t('page.import.importReplaceAction')}
                    </Button>
                    <Button variant="outline" onClick={switchToAppend}>
                      {t('page.import.switchToAppend')}
                      <ArrowRight className="size-4" aria-hidden="true" />
                    </Button>
                  </>
                ) : (
                  <Button
                    variant={isReplace ? 'destructive' : 'default'}
                    onClick={() => {
                      if (isReplace) {
                        setReplaceConfirmOpen(true);
                      } else {
                        handleImport();
                      }
                    }}
                    disabled={importLoading}
                  >
                    {isReplace && <Trash2 className="size-4" aria-hidden="true" />}
                    {isReplace ? t('page.import.importReplaceAction') : t('page.import.importNow')}
                  </Button>
                )
              )}
              <Button onClick={resetImport} variant="ghost" size="sm" className="ml-auto">
                <X className="size-3.5" />
                {t('common.reset')}
              </Button>
            </div>
          )}
        </div>
      </SettingCard>
      </DemoLock>

      {/* The balance: what the station looks like before and after, and what
          the import costs on the way. Renders above the parsed rows because
          the parsed rows are the reassuring half. */}
      {balance && <div ref={previewRef}><ImportBalanceCard balance={balance} /></div>}

      {/* Preview */}
      {preview && (
        <div ref={balance ? undefined : previewRef}>
        {/* `space-y-4` on the INNER wrapper, not on the card: SettingCard
            renders its children into one div, so a card-level space-y only
            ever separated the header from the body — and the Mannschaft /
            Fahrzeuge / Material tables inside sat flush against each other. */}
        <SettingCard title={t('page.import.previewTitle')}>
        <div className="space-y-4">

          {/* A sheet with a header row and nothing under it used to render as
              absolutely nothing – indistinguishable from a sheet the file does
              not contain, which is the case `replace` refuses outright. Neither
              is visible in the payload (it carries totals, not a `present`
              flag), so name the row and both of its possible outcomes. */}
          {emptySheets.length > 0 && (
            <ul className="space-y-1 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
              {emptySheets.map(({ resource, ambiguous }) => (
                <li key={resource}>
                  {ambiguous
                    ? t('page.import.sheetEmptyAmbiguous', { resource: t(`page.sections.${resource}`) })
                    : t('page.import.sheetEmpty', { resource: t(`page.sections.${resource}`) })}
                </li>
              ))}
            </ul>
          )}

          {preview.personnel_total > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Users className="h-4 w-4" />
                <span className="font-medium text-sm">{t('page.sections.personnel')}</span>
                <Badge variant="secondary">{preview.personnel_total}</Badge>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('common.name')}</TableHead>
                    <TableHead>{t('common.role')}</TableHead>
                    <TableHead>{t('common.status')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.personnel_preview.map((row, idx) => (
                    <TableRow key={idx}>
                      <TableCell>{row.name}</TableCell>
                      <TableCell>{row.role || '-'}</TableCell>
                      <TableCell>{row.status}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {preview.vehicles_total > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Truck className="h-4 w-4" />
                <span className="font-medium text-sm">{t('page.sections.vehicles')}</span>
                <Badge variant="secondary">{preview.vehicles_total}</Badge>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('common.name')}</TableHead>
                    <TableHead>{t('common.type')}</TableHead>
                    <TableHead>{t('common.radioCallSign')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.vehicles_preview.map((row, idx) => (
                    <TableRow key={idx}>
                      <TableCell>{row.name}</TableCell>
                      <TableCell>{row.type}</TableCell>
                      <TableCell>{row.radio_call_sign || '-'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {preview.materials_total > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Package className="h-4 w-4" />
                <span className="font-medium text-sm">{t('page.sections.materials')}</span>
                <Badge variant="secondary">{preview.materials_total}</Badge>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('common.name')}</TableHead>
                    <TableHead>{t('common.type')}</TableHead>
                    <TableHead>{t('common.location')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.materials_preview.map((row, idx) => (
                    <TableRow key={idx}>
                      <TableCell>{row.name}</TableCell>
                      <TableCell>{row.type}</TableCell>
                      <TableCell>{row.location || '-'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
        </SettingCard>
        </div>
      )}
    </div>
  );
}
