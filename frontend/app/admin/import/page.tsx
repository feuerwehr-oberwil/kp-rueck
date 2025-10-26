'use client';

/**
 * Excel Import/Export Page
 * Allows bulk import and export of Personnel, Vehicles, and Materials
 * Only accessible to users with Editor role
 */

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/contexts/auth-context';
import { useEvent } from '@/lib/contexts/event-context';
import { apiClient, type ApiExcelImportPreview, type ApiExcelImportResult } from '@/lib/api-client';
import { ProtectedRoute } from '@/components/protected-route';
import { PageNavigation } from '@/components/page-navigation';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ArrowLeft, Upload, Download, FileSpreadsheet, AlertCircle, CheckCircle, X } from 'lucide-react';
import Link from 'next/link';

export default function ImportExportPage() {
  const { isEditor } = useAuth();
  const { selectedEvent } = useEvent();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // State
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ApiExcelImportPreview | null>(null);
  const [importMode, setImportMode] = useState<'replace' | 'append'>('replace');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ApiExcelImportResult | null>(null);

  // Redirect non-editors
  useEffect(() => {
    if (!isEditor) {
      router.push('/');
    }
  }, [isEditor, router]);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setPreview(null);
      setError(null);
      setSuccess(null);
      setImportResult(null);
    }
  };

  const handlePreview = async () => {
    if (!selectedFile) return;

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const result = await apiClient.previewExcelImport(selectedFile);
      setPreview(result);
    } catch (err) {
      console.error('Preview failed:', err);
      const errorMessage = err instanceof Error ? err.message : 'Vorschau fehlgeschlagen';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async () => {
    if (!selectedFile) return;

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const result = await apiClient.executeExcelImport(selectedFile, importMode);
      setImportResult(result);
      setSuccess(
        `Import erfolgreich! ${result.counts.personnel} Personal, ${result.counts.vehicles} Fahrzeuge, ${result.counts.materials} Materialien importiert.`
      );
      setSelectedFile(null);
      setPreview(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (err) {
      console.error('Import failed:', err);
      const errorMessage = err instanceof Error ? err.message : 'Import fehlgeschlagen';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadTemplate = async () => {
    setLoading(true);
    setError(null);

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
    } catch (err) {
      console.error('Template download failed:', err);
      const errorMessage = err instanceof Error ? err.message : 'Template-Download fehlgeschlagen';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async () => {
    setLoading(true);
    setError(null);

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
      setSuccess('Export erfolgreich!');
    } catch (err) {
      console.error('Export failed:', err);
      const errorMessage = err instanceof Error ? err.message : 'Export fehlgeschlagen';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const resetImport = () => {
    setSelectedFile(null);
    setPreview(null);
    setError(null);
    setSuccess(null);
    setImportResult(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  if (!isEditor) {
    return null;
  }

  return (
    <ProtectedRoute>
      <div className="flex h-screen flex-col bg-background text-foreground">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-border/50 bg-card/50 backdrop-blur-sm px-6 py-4">
          <div className="flex items-center gap-4">
            <Link href="/">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-green-600 to-emerald-600 text-2xl shadow-lg">
                <FileSpreadsheet className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight">Daten Import/Export</h1>
                <p className="text-sm text-muted-foreground">
                  Massenverwaltung von Personal, Fahrzeugen und Materialien
                </p>
              </div>
            </div>
          </div>

          <PageNavigation currentPage="settings" hasSelectedEvent={!!selectedEvent} />
        </header>

        {/* Content */}
        <main className="flex-1 overflow-auto p-6">
          <div className="max-w-5xl mx-auto space-y-6">
            {/* Notifications */}
            {error && (
              <Card className="p-4 border-destructive bg-destructive/10">
                <div className="flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 text-destructive mt-0.5" />
                  <div className="flex-1">
                    <p className="font-medium text-destructive">Fehler</p>
                    <p className="text-sm text-destructive/90 mt-1">{error}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => setError(null)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </Card>
            )}

            {success && (
              <Card className="p-4 border-green-600 bg-green-600/10">
                <div className="flex items-start gap-3">
                  <CheckCircle className="h-5 w-5 text-green-600 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-medium text-green-600">Erfolg</p>
                    <p className="text-sm text-green-600/90 mt-1">{success}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => setSuccess(null)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </Card>
            )}

            {/* Export Section */}
            <Card className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <Download className="h-5 w-5 text-blue-600" />
                <h2 className="text-xl font-semibold">Daten Exportieren</h2>
              </div>
              <p className="text-sm text-muted-foreground mb-4">
                Exportieren Sie alle Personal-, Fahrzeug- und Materialdaten als Excel-Datei.
              </p>
              <Button onClick={handleExport} disabled={loading} className="gap-2">
                <Download className="h-4 w-4" />
                Alle Daten Exportieren
              </Button>
            </Card>

            {/* Import Section */}
            <Card className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <Upload className="h-5 w-5 text-green-600" />
                <h2 className="text-xl font-semibold">Daten Importieren</h2>
              </div>

              {/* Download Template */}
              <div className="mb-6">
                <p className="text-sm text-muted-foreground mb-3">
                  Laden Sie zuerst die Excel-Vorlage herunter und füllen Sie sie mit Ihren Daten aus.
                </p>
                <Button
                  variant="outline"
                  onClick={handleDownloadTemplate}
                  disabled={loading}
                  className="gap-2"
                >
                  <FileSpreadsheet className="h-4 w-4" />
                  Excel-Vorlage Herunterladen
                </Button>
              </div>

              {/* File Upload */}
              <div className="mb-6">
                <label className="block text-sm font-medium mb-2">Excel-Datei auswählen</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleFileSelect}
                  className="block w-full text-sm text-muted-foreground
                    file:mr-4 file:py-2 file:px-4
                    file:rounded-md file:border-0
                    file:text-sm file:font-semibold
                    file:bg-primary file:text-primary-foreground
                    hover:file:bg-primary/90
                    cursor-pointer"
                />
              </div>

              {selectedFile && (
                <>
                  {/* Import Mode */}
                  <div className="mb-6">
                    <label className="block text-sm font-medium mb-2">Import-Modus</label>
                    <Select value={importMode} onValueChange={(val) => setImportMode(val as 'replace' | 'append')}>
                      <SelectTrigger className="w-full max-w-md">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="replace">
                          <div>
                            <div className="font-medium">Ersetzen</div>
                            <div className="text-xs text-muted-foreground">
                              Alle bestehenden Daten löschen und neue Daten importieren
                            </div>
                          </div>
                        </SelectItem>
                        <SelectItem value="append">
                          <div>
                            <div className="font-medium">Anhängen</div>
                            <div className="text-xs text-muted-foreground">
                              Bestehende Daten behalten und neue Daten hinzufügen
                            </div>
                          </div>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-3">
                    <Button onClick={handlePreview} disabled={loading || !!preview} className="gap-2">
                      <FileSpreadsheet className="h-4 w-4" />
                      Vorschau Anzeigen
                    </Button>
                    {preview && (
                      <Button onClick={handleImport} disabled={loading} className="gap-2">
                        <Upload className="h-4 w-4" />
                        Import Ausführen
                      </Button>
                    )}
                    <Button onClick={resetImport} variant="outline" disabled={loading}>
                      Zurücksetzen
                    </Button>
                  </div>
                </>
              )}
            </Card>

            {/* Preview */}
            {preview && (
              <Card className="p-6">
                <h3 className="text-lg font-semibold mb-4">Import Vorschau (Erste 10 Zeilen)</h3>

                {/* Personnel Preview */}
                {preview.personnel_total > 0 && (
                  <div className="mb-6">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="font-medium flex items-center gap-2">
                        👤 Personal
                        <Badge variant="secondary">{preview.personnel_total} gesamt</Badge>
                      </h4>
                    </div>
                    <div className="rounded-lg border overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Name</TableHead>
                            <TableHead>Rolle</TableHead>
                            <TableHead>Divera ID</TableHead>
                            <TableHead>Telefon</TableHead>
                            <TableHead>Verfügbarkeit</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {preview.personnel_preview.map((row, idx) => (
                            <TableRow key={idx}>
                              <TableCell>{row.name}</TableCell>
                              <TableCell>{row.role || '-'}</TableCell>
                              <TableCell>{row.divera_alarm_id || '-'}</TableCell>
                              <TableCell>{row.phone_number || '-'}</TableCell>
                              <TableCell>
                                <Badge variant="outline">{row.availability_status}</Badge>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}

                {/* Vehicles Preview */}
                {preview.vehicles_total > 0 && (
                  <div className="mb-6">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="font-medium flex items-center gap-2">
                        🚒 Fahrzeuge
                        <Badge variant="secondary">{preview.vehicles_total} gesamt</Badge>
                      </h4>
                    </div>
                    <div className="rounded-lg border overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Name</TableHead>
                            <TableHead>Typ</TableHead>
                            <TableHead>Reihenfolge</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Funkrufname</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {preview.vehicles_preview.map((row, idx) => (
                            <TableRow key={idx}>
                              <TableCell>{row.name}</TableCell>
                              <TableCell>
                                <Badge variant="outline">{row.type}</Badge>
                              </TableCell>
                              <TableCell>{row.display_order}</TableCell>
                              <TableCell>
                                <Badge variant="outline">{row.status}</Badge>
                              </TableCell>
                              <TableCell>{row.radio_call_sign}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}

                {/* Materials Preview */}
                {preview.materials_total > 0 && (
                  <div className="mb-6">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="font-medium flex items-center gap-2">
                        🔧 Materialien
                        <Badge variant="secondary">{preview.materials_total} gesamt</Badge>
                      </h4>
                    </div>
                    <div className="rounded-lg border overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Name</TableHead>
                            <TableHead>Typ</TableHead>
                            <TableHead>Standort</TableHead>
                            <TableHead>Beschreibung</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {preview.materials_preview.map((row, idx) => (
                            <TableRow key={idx}>
                              <TableCell>{row.name}</TableCell>
                              <TableCell>
                                <Badge variant="outline">{row.type}</Badge>
                              </TableCell>
                              <TableCell>{row.location}</TableCell>
                              <TableCell>{row.description || '-'}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}
              </Card>
            )}
          </div>
        </main>
      </div>
    </ProtectedRoute>
  );
}
