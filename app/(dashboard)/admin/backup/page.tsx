'use client';

import React, { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DatabaseBackup, Download, Loader2, ShieldAlert, TriangleAlert, Upload, CheckCircle2 } from 'lucide-react';

const CONFIRMATION_PHRASE = 'RESTAURAR BASE DE DATOS';

interface CurrentUser {
  role: 'user' | 'editor' | 'admin' | 'owner';
}

async function downloadBackup(): Promise<void> {
  const res = await fetch('/api/admin/backup/export');
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error || 'No se pudo generar el backup');
  }
  const blob = await res.blob();
  const disposition = res.headers.get('content-disposition') || '';
  const match = disposition.match(/filename="?([^"]+)"?/);
  const filename = match?.[1] || `backup-veredillas-fm-${new Date().toISOString()}.zip`;

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function BackupPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [user, setUser] = useState<CurrentUser | null>(null);

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const [safetyDownloading, setSafetyDownloading] = useState(false);
  const [safetyDownloaded, setSafetyDownloaded] = useState(false);
  const [safetyError, setSafetyError] = useState<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<{ collections: number; documents: number } | null>(null);

  React.useEffect(() => {
    async function checkAuth() {
      try {
        const res = await fetch('/api/auth/me');
        const data = await res.json().catch(() => null);
        const role = data?.user?.role;
        setUser(res.ok && data?.user && (role === 'admin' || role === 'owner') ? { role } : null);
      } catch {
        setUser(null);
      } finally {
        setAuthChecked(true);
      }
    }
    checkAuth();
  }, []);

  const handleExport = useCallback(async () => {
    setExporting(true);
    setExportError(null);
    try {
      await downloadBackup();
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'No se pudo generar el backup');
    } finally {
      setExporting(false);
    }
  }, []);

  const handleSafetyDownload = useCallback(async () => {
    setSafetyDownloading(true);
    setSafetyError(null);
    try {
      await downloadBackup();
      setSafetyDownloaded(true);
    } catch (err) {
      setSafetyError(err instanceof Error ? err.message : 'No se pudo generar el backup de seguridad');
    } finally {
      setSafetyDownloading(false);
    }
  }, []);

  const canImport = safetyDownloaded && !!file && confirmation === CONFIRMATION_PHRASE;

  const handleImport = useCallback(async () => {
    if (!file) return;
    setImporting(true);
    setImportError(null);
    setImportResult(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('confirmation', confirmation);

      const res = await fetch('/api/admin/backup/import', { method: 'POST', body: formData });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || 'No se pudo restaurar el backup');
      }
      setImportResult({ collections: data.collections, documents: data.documents });
      setFile(null);
      setConfirmation('');
      setSafetyDownloaded(false);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'No se pudo restaurar el backup');
    } finally {
      setImporting(false);
    }
  }, [file, confirmation]);

  if (!authChecked) {
    return (
      <div className="p-8 flex items-center justify-center text-zinc-400">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="p-8 flex flex-col items-center justify-center gap-3 text-zinc-400">
        <ShieldAlert className="w-10 h-10 text-amber-400" />
        <p>Solo los administradores y propietarios pueden acceder a las copias de seguridad.</p>
        <button
          onClick={() => router.push('/')}
          className="rounded-2xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 transition"
        >
          Volver al panel
        </button>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-5xl mx-auto w-full">
      <div className="border-b border-zinc-800/80 pb-6">
        <h1 className="text-xl font-bold text-zinc-100 flex items-center gap-2">
          <DatabaseBackup className="w-5 h-5 text-zinc-400" />
          <span>Copias de Seguridad</span>
        </h1>
        <p className="text-xs text-zinc-400 mt-0.5">
          Exporta toda la base de datos en un ZIP, o restáurala a partir de un backup anterior.
        </p>
      </div>

      <section className="rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-5 space-y-3">
        <h2 className="text-sm font-semibold text-zinc-100">Descargar backup</h2>
        <p className="text-xs text-zinc-400">
          Genera un ZIP con todas las colecciones de la base de datos, tal como están ahora mismo.
        </p>
        <button
          onClick={handleExport}
          disabled={exporting}
          className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 transition disabled:opacity-50"
        >
          {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          Descargar backup
        </button>
        {exportError && <p className="text-xs text-red-400">{exportError}</p>}
      </section>

      {user.role === 'owner' && (
        <section className="rounded-2xl border border-red-900/50 bg-red-950/20 p-5 space-y-4">
          <div className="flex items-start gap-2">
            <TriangleAlert className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <div>
              <h2 className="text-sm font-semibold text-red-300">Restaurar base de datos</h2>
              <p className="text-xs text-red-400/90 mt-1">
                Esta acción <strong>reemplaza por completo</strong> la base de datos actual por el contenido del
                ZIP. No se puede deshacer. Descarga primero un backup de seguridad del estado actual.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <button
              onClick={handleSafetyDownload}
              disabled={safetyDownloading}
              className="inline-flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900/60 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-800 transition disabled:opacity-50"
            >
              {safetyDownloading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : safetyDownloaded ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              ) : (
                <Download className="w-4 h-4" />
              )}
              {safetyDownloaded ? 'Backup de seguridad descargado' : '1. Descargar backup de seguridad'}
            </button>
            {safetyError && <p className="text-xs text-red-400">{safetyError}</p>}
          </div>

          <div className="space-y-2">
            <label className="block text-xs text-zinc-400">2. Selecciona el ZIP a restaurar</label>
            <input
              type="file"
              accept=".zip"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              disabled={!safetyDownloaded}
              className="block w-full text-xs text-zinc-300 file:mr-3 file:rounded-lg file:border-0 file:bg-zinc-800 file:px-3 file:py-1.5 file:text-xs file:text-zinc-200 disabled:opacity-50"
            />
          </div>

          <div className="space-y-2">
            <label className="block text-xs text-zinc-400">
              3. Escribe <code className="text-red-300">{CONFIRMATION_PHRASE}</code> para confirmar
            </label>
            <input
              type="text"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              disabled={!safetyDownloaded}
              placeholder={CONFIRMATION_PHRASE}
              className="w-full bg-zinc-900/60 border border-zinc-800/80 rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-red-700 disabled:opacity-50"
            />
          </div>

          <button
            onClick={handleImport}
            disabled={!canImport || importing}
            className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 transition disabled:opacity-40 disabled:hover:bg-red-600"
          >
            {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            Restaurar base de datos
          </button>

          {importError && <p className="text-xs text-red-400">{importError}</p>}
          {importResult && (
            <p className="text-xs text-emerald-400">
              Restauradas {importResult.collections} colecciones ({importResult.documents} documentos).
            </p>
          )}
        </section>
      )}
    </div>
  );
}
