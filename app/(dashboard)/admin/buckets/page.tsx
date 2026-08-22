'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  HardDrive,
  Plus,
  Edit3,
  Trash2,
  Star,
  Image as ImageIcon,
  Music,
  Video,
  Film,
  Loader2,
  X,
  Save,
  ShieldAlert,
  Link2,
  PieChart,
  FileType,
  Layers,
  Share2,
} from 'lucide-react';
import BucketFileBrowser from '@/components/BucketFileBrowser';
import { getActiveAlertThreshold, getAlertLevelForThreshold } from '@/lib/storage-alert-levels';

const HARD_MAX_GB = 9.2;
// GB decimal (1000^3), igual que el dashboard de Cloudflare R2 (no GiB/1024^3).
const HARD_MAX_BYTES = Math.floor(HARD_MAX_GB * 1000 ** 3);

type BucketType = 'images' | 'multimedia' | 'clips' | 'social';

interface BucketItem {
  id: string;
  label: string;
  bucketName: string;
  type: BucketType;
  isDefault: boolean;
  isActive: boolean;
  accountId: string;
  accessKeyId: string;
  hasSecret: boolean;
  endpoint: string;
  publicUrlBase: string;
  maxBytes: number;
  lastAlertThreshold: number;
  lastAlertAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ExtensionStat {
  extension: string;
  bytes: number;
  objects: number;
}

interface UsageInfo {
  totalBytes: number;
  totalObjects: number;
  maxBytes: number;
  byExtension: ExtensionStat[];
}

interface BucketFormState {
  label: string;
  bucketName: string;
  type: BucketType;
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint: string;
  publicUrlBase: string;
  maxBytesGb: string;
  isDefault: boolean;
  isActive: boolean;
}

const emptyForm: BucketFormState = {
  label: '',
  bucketName: '',
  type: 'multimedia',
  accountId: '',
  accessKeyId: '',
  secretAccessKey: '',
  endpoint: '',
  publicUrlBase: '',
  maxBytesGb: String(HARD_MAX_GB),
  isDefault: false,
  isActive: true,
};

function formatSize(bytes: number) {
  if (!bytes) return '0 B';
  // Base decimal (1000), igual que el dashboard de Cloudflare R2, para que el uso
  // mostrado aquí coincida con el que Cloudflare reporta (no usar 1024/GiB).
  const k = 1000;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

const EXTENSION_STATS_LIMIT = 8;

function formatExtensionLabel(extension: string) {
  if (extension === 'sin-extension') return 'Sin extensión';
  if (extension === 'otros') return 'Otros';
  return `.${extension}`;
}

function iconForExtension(extension: string) {
  if (/^(png|jpe?g|webp|gif|svg|avif)$/i.test(extension)) {
    return <ImageIcon className="w-3.5 h-3.5 text-indigo-400" />;
  }
  if (/^(mp3|wav|m4a|ogg|flac|aac)$/i.test(extension)) {
    return <Music className="w-3.5 h-3.5 text-indigo-400" />;
  }
  if (/^(mp4|webm|mov|mkv|avi)$/i.test(extension)) {
    return <Video className="w-3.5 h-3.5 text-indigo-400" />;
  }
  return <FileType className="w-3.5 h-3.5 text-zinc-500" />;
}

export default function BucketsAdminPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [authorized, setAuthorized] = useState(false);

  const [buckets, setBuckets] = useState<BucketItem[]>([]);
  const [usage, setUsage] = useState<Record<string, UsageInfo>>({});
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingBucket, setEditingBucket] = useState<BucketItem | null>(null);
  const [form, setForm] = useState<BucketFormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [connectedBucket, setConnectedBucket] = useState<BucketItem | null>(null);
  const [unifiedOpen, setUnifiedOpen] = useState(false);
  const [statsScope, setStatsScope] = useState<string>('all');

  useEffect(() => {
    async function checkAuth() {
      try {
        const res = await fetch('/api/auth/me');
        const data = await res.json().catch(() => null);
        const role = data?.user?.role;
        if (!res.ok || !data?.user || (role !== 'admin' && role !== 'owner')) {
          setAuthorized(false);
        } else {
          setAuthorized(true);
        }
      } catch {
        setAuthorized(false);
      } finally {
        setAuthChecked(true);
      }
    }
    checkAuth();
  }, []);

  const loadBuckets = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const res = await fetch('/api/admin/buckets');
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || 'Error al cargar los buckets');
      }
      const data = await res.json();
      const list: BucketItem[] = data.buckets || [];
      setBuckets(list);

      const usageEntries = await Promise.all(
        list.map(async (bucket) => {
          try {
            const usageRes = await fetch(`/api/admin/buckets/${bucket.id}/usage`);
            if (!usageRes.ok) return [bucket.id, null] as const;
            const usageData = await usageRes.json();
            return [bucket.id, usageData as UsageInfo] as const;
          } catch {
            return [bucket.id, null] as const;
          }
        })
      );

      setUsage(
        usageEntries.reduce((acc, [id, value]) => {
          if (value) acc[id] = value;
          return acc;
        }, {} as Record<string, UsageInfo>)
      );
    } catch (err: any) {
      setErrorMessage(err.message || 'Error al cargar los buckets');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authorized) loadBuckets();
  }, [authorized, loadBuckets]);

  const grouped = useMemo(() => {
    return {
      images: buckets.filter((b) => b.type === 'images'),
      multimedia: buckets.filter((b) => b.type === 'multimedia'),
      clips: buckets.filter((b) => b.type === 'clips'),
      social: buckets.filter((b) => b.type === 'social'),
    };
  }, [buckets]);

  const activeBuckets = useMemo(() => buckets.filter((b) => b.isActive), [buckets]);

  const aggregateUsage = useMemo(() => {
    let totalBytes = 0;
    let totalObjects = 0;
    let totalMaxBytes = 0;
    let loadedCount = 0;
    for (const b of activeBuckets) {
      totalMaxBytes += b.maxBytes;
      const u = usage[b.id];
      if (u) {
        totalBytes += u.totalBytes;
        totalObjects += u.totalObjects;
        loadedCount += 1;
      }
    }
    return { totalBytes, totalObjects, totalMaxBytes, loadedCount, bucketCount: activeBuckets.length };
  }, [activeBuckets, usage]);

  const extensionBreakdown = useMemo(() => {
    const relevantUsage: UsageInfo[] =
      statsScope === 'all'
        ? Object.values(usage)
        : usage[statsScope]
        ? [usage[statsScope]]
        : [];

    const merged = new Map<string, { bytes: number; objects: number }>();
    for (const u of relevantUsage) {
      for (const stat of u.byExtension || []) {
        const entry = merged.get(stat.extension) || { bytes: 0, objects: 0 };
        entry.bytes += stat.bytes;
        entry.objects += stat.objects;
        merged.set(stat.extension, entry);
      }
    }

    const all = Array.from(merged.entries())
      .map(([extension, v]) => ({ extension, bytes: v.bytes, objects: v.objects }))
      .sort((a, b) => b.bytes - a.bytes);

    const totalBytes = all.reduce((sum, e) => sum + e.bytes, 0);
    const top = all.slice(0, EXTENSION_STATS_LIMIT);
    const rest = all.slice(EXTENSION_STATS_LIMIT);
    const othersBytes = rest.reduce((sum, e) => sum + e.bytes, 0);
    const othersObjects = rest.reduce((sum, e) => sum + e.objects, 0);

    const rows =
      othersBytes > 0 ? [...top, { extension: 'otros', bytes: othersBytes, objects: othersObjects }] : top;

    return { rows, totalBytes, loadedCount: relevantUsage.length };
  }, [usage, statsScope]);

  const openCreateModal = () => {
    setEditingBucket(null);
    setForm(emptyForm);
    setFormError(null);
    setModalOpen(true);
  };

  const openEditModal = (bucket: BucketItem) => {
    setEditingBucket(bucket);
    setForm({
      label: bucket.label,
      bucketName: bucket.bucketName,
      type: bucket.type,
      accountId: bucket.accountId,
      accessKeyId: bucket.accessKeyId,
      secretAccessKey: '',
      endpoint: bucket.endpoint,
      publicUrlBase: bucket.publicUrlBase,
      maxBytesGb: String(bucket.maxBytes / 1000 ** 3),
      isDefault: bucket.isDefault,
      isActive: bucket.isActive,
    });
    setFormError(null);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingBucket(null);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);

    const maxBytesGbNum = Number(form.maxBytesGb);
    if (Number.isNaN(maxBytesGbNum) || maxBytesGbNum <= 0) {
      setFormError('El límite debe ser un número mayor que 0.');
      return;
    }
    if (maxBytesGbNum > HARD_MAX_GB) {
      setFormError(`El límite no puede superar los ${HARD_MAX_GB}GB.`);
      return;
    }

    if (!editingBucket && !form.secretAccessKey) {
      setFormError('La secret access key es obligatoria al crear un bucket.');
      return;
    }

    const payload: Record<string, unknown> = {
      label: form.label,
      bucketName: form.bucketName,
      type: form.type,
      accountId: form.accountId,
      accessKeyId: form.accessKeyId,
      endpoint: form.endpoint,
      publicUrlBase: form.publicUrlBase,
      maxBytes: Math.floor(maxBytesGbNum * 1000 ** 3),
      isDefault: form.isDefault,
      isActive: form.isActive,
    };
    if (form.secretAccessKey) {
      payload.secretAccessKey = form.secretAccessKey;
    }

    setSaving(true);
    try {
      const res = await fetch(editingBucket ? `/api/admin/buckets/${editingBucket.id}` : '/api/admin/buckets', {
        method: editingBucket ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || 'Error al guardar el bucket');
      }

      closeModal();
      await loadBuckets();
    } catch (err: any) {
      setFormError(err.message || 'Error al guardar el bucket');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (bucket: BucketItem) => {
    if (!confirm(`¿Eliminar el bucket "${bucket.label}"? Esto no borra los archivos en Cloudflare R2.`)) return;

    setDeletingId(bucket.id);
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/admin/buckets/${bucket.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || 'Error al eliminar el bucket');
      }
      await loadBuckets();
    } catch (err: any) {
      setErrorMessage(err.message || 'Error al eliminar el bucket');
    } finally {
      setDeletingId(null);
    }
  };

  if (!authChecked) {
    return (
      <div className="p-8 flex items-center justify-center text-zinc-400">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  if (!authorized) {
    return (
      <div className="p-8 flex flex-col items-center justify-center gap-3 text-zinc-400">
        <ShieldAlert className="w-10 h-10 text-amber-400" />
        <p>Solo los administradores y propietarios pueden gestionar los buckets R2.</p>
        <button
          onClick={() => router.push('/')}
          className="rounded-2xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 transition"
        >
          Volver al panel
        </button>
      </div>
    );
  }

  const renderBucketCard = (bucket: BucketItem) => {
    const usageInfo = usage[bucket.id];
    const rawPercent = usageInfo ? (usageInfo.totalBytes / bucket.maxBytes) * 100 : null;
    const percent = rawPercent !== null ? Math.min(100, Math.round(rawPercent)) : null;
    const activeLevel = rawPercent !== null ? getAlertLevelForThreshold(getActiveAlertThreshold(rawPercent)) : undefined;
    const barColor = activeLevel ? activeLevel.color : undefined;

    return (
      <div key={bucket.id} className="rounded-3xl border border-zinc-800/70 bg-zinc-950/60 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="truncate text-sm font-semibold text-zinc-100">{bucket.label}</p>
              {bucket.isDefault && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-400">
                  <Star className="w-3 h-3" /> Predeterminado
                </span>
              )}
              {!bucket.isActive && (
                <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] font-medium text-zinc-400">
                  Inactivo
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-500">{bucket.bucketName}</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              onClick={() => openEditModal(bucket)}
              className="rounded-xl bg-zinc-900 p-2 text-zinc-300 hover:bg-zinc-800 transition"
              title="Editar"
            >
              <Edit3 className="w-4 h-4" />
            </button>
            <button
              onClick={() => handleDelete(bucket)}
              disabled={deletingId === bucket.id}
              className="rounded-xl bg-red-700/10 p-2 text-red-300 hover:bg-red-700/20 transition"
              title="Eliminar"
            >
              {deletingId === bucket.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <button
          onClick={() => setConnectedBucket(bucket)}
          className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-200 hover:bg-indigo-600 hover:text-white transition"
        >
          <Link2 className="w-4 h-4" /> Conectar
        </button>

        <div className="mt-4">
          {usageInfo ? (
            <>
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span>{formatSize(usageInfo.totalBytes)} / {formatSize(bucket.maxBytes)}</span>
                <span style={barColor ? { color: barColor } : undefined}>{percent}%</span>
              </div>
              <div className="mt-2 h-2 rounded-full bg-zinc-900 overflow-hidden">
                <div
                  className="h-full rounded-full bg-indigo-500"
                  style={{ width: `${percent ?? 0}%`, backgroundColor: barColor }}
                />
              </div>
              <p className="mt-1 text-[11px] text-zinc-600">{usageInfo.totalObjects} archivo(s)</p>
              {activeLevel && (
                <p className="mt-1 text-[11px]" style={{ color: activeLevel.color }}>
                  {activeLevel.emoji} {activeLevel.label} &mdash; se ha notificado a admins/owners
                </p>
              )}
              {!activeLevel && bucket.lastAlertAt && (
                <p className="mt-1 text-[11px] text-zinc-600">
                  Último aviso enviado: {new Date(bucket.lastAlertAt).toLocaleDateString('es-ES')}
                </p>
              )}
            </>
          ) : (
            <p className="text-xs text-zinc-600">Calculando uso...</p>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-6xl mx-auto w-full">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-zinc-100">
            <HardDrive className="w-5 h-5 text-amber-400" />
            <h1 className="text-xl font-semibold">Buckets R2</h1>
          </div>
          <p className="text-sm text-zinc-400 max-w-2xl">
            Gestiona los buckets de Cloudflare R2 y sus credenciales. Límite máximo por bucket: {HARD_MAX_GB}GB.
          </p>
        </div>
        <button
          onClick={openCreateModal}
          className="inline-flex items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 transition"
        >
          <Plus className="w-4 h-4" /> Nuevo bucket
        </button>
      </div>

      {errorMessage && (
        <div className="rounded-2xl border border-red-800/50 bg-red-950/30 px-4 py-3 text-sm text-red-300">
          {errorMessage}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center p-10 text-zinc-400">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      ) : (
        <>
          <section className="rounded-3xl border border-indigo-500/30 bg-indigo-500/5 p-4 space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-2 text-zinc-100">
                <Layers className="w-5 h-5 shrink-0 text-indigo-400 mt-0.5" />
                <div>
                  <h2 className="text-sm font-semibold">Almacenamiento unificado</h2>
                  <p className="text-xs text-zinc-400">
                    Explora, busca y gestiona los archivos de los {aggregateUsage.bucketCount} bucket(s) activos
                    como si fueran un único almacenamiento.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setUnifiedOpen(true)}
                disabled={aggregateUsage.bucketCount === 0}
                className="inline-flex shrink-0 items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 transition disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
              >
                <Link2 className="w-4 h-4" /> Conectar a todos los buckets
              </button>
            </div>

            {aggregateUsage.bucketCount > 0 && (
              <div>
                <div className="flex items-center justify-between text-xs text-zinc-400">
                  <span>
                    {formatSize(aggregateUsage.totalBytes)} / {formatSize(aggregateUsage.totalMaxBytes)}
                  </span>
                  <span>{aggregateUsage.totalObjects} archivo(s)</span>
                </div>
                <div className="mt-2 h-2 rounded-full bg-zinc-900 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-indigo-500"
                    style={{
                      width: `${
                        aggregateUsage.totalMaxBytes > 0
                          ? Math.min(100, Math.round((aggregateUsage.totalBytes / aggregateUsage.totalMaxBytes) * 100))
                          : 0
                      }%`,
                    }}
                  />
                </div>
                {aggregateUsage.loadedCount < aggregateUsage.bucketCount && (
                  <p className="mt-1 text-[11px] text-amber-400/80">
                    Algunos buckets aún no han cargado su uso; el total puede estar incompleto.
                  </p>
                )}
              </div>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
              <ImageIcon className="w-4 h-4 text-indigo-400" /> Imágenes y otros
            </h2>
            {grouped.images.length === 0 ? (
              <p className="text-sm text-zinc-500">No hay buckets de este tipo todavía.</p>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">{grouped.images.map(renderBucketCard)}</div>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
              <Music className="w-4 h-4 text-indigo-400" /> Multimedia (audio / vídeo)
            </h2>
            {grouped.multimedia.length === 0 ? (
              <p className="text-sm text-zinc-500">No hay buckets de este tipo todavía.</p>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">{grouped.multimedia.map(renderBucketCard)}</div>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
              <Film className="w-4 h-4 text-indigo-400" /> Clips
            </h2>
            {grouped.clips.length === 0 ? (
              <p className="text-sm text-zinc-500">No hay buckets de este tipo todavía.</p>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">{grouped.clips.map(renderBucketCard)}</div>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
              <Share2 className="w-4 h-4 text-indigo-400" /> Clips para Redes Sociales
            </h2>
            {grouped.social.length === 0 ? (
              <p className="text-sm text-zinc-500">No hay buckets de este tipo todavía.</p>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">{grouped.social.map(renderBucketCard)}</div>
            )}
          </section>

          <section className="space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
                <PieChart className="w-4 h-4 text-indigo-400" /> Uso de almacenamiento por tipo de archivo
              </h2>
              <select
                value={statsScope}
                onChange={(e) => setStatsScope(e.target.value)}
                className="bg-zinc-950 border border-zinc-800 text-zinc-300 text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-indigo-500"
              >
                <option value="all">Todos los buckets</option>
                {buckets.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label}
                  </option>
                ))}
              </select>
            </div>

            {buckets.length === 0 ? (
              <p className="text-sm text-zinc-500">No hay buckets configurados todavía.</p>
            ) : statsScope !== 'all' && !usage[statsScope] ? (
              <p className="text-sm text-zinc-500">No se pudo cargar el uso de este bucket.</p>
            ) : extensionBreakdown.rows.length === 0 ? (
              <p className="text-sm text-zinc-500">Este bucket no tiene archivos todavía.</p>
            ) : (
              <div className="rounded-3xl border border-zinc-800/70 bg-zinc-950/60 p-4 space-y-3">
                {statsScope === 'all' && extensionBreakdown.loadedCount < buckets.length && (
                  <p className="text-[11px] text-amber-400/80">
                    Algunos buckets no pudieron cargar sus estadísticas; los totales pueden estar incompletos.
                  </p>
                )}
                {extensionBreakdown.rows.map((row) => {
                  const pct =
                    extensionBreakdown.totalBytes > 0
                      ? Math.round((row.bytes / extensionBreakdown.totalBytes) * 100)
                      : 0;
                  return (
                    <div key={row.extension} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-1.5 text-zinc-200">
                          {iconForExtension(row.extension)}
                          {formatExtensionLabel(row.extension)}
                        </span>
                        <span className="text-zinc-400">
                          {formatSize(row.bytes)} · {row.objects} archivo(s) · {pct}%
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-zinc-900 overflow-hidden">
                        <div className="h-full rounded-full bg-indigo-500" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 overflow-y-auto">
          <div className="w-full max-w-lg rounded-3xl border border-zinc-800 bg-zinc-950 shadow-2xl shadow-black/60">
            <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
              <p className="text-sm font-semibold text-zinc-100">
                {editingBucket ? 'Editar bucket' : 'Nuevo bucket'}
              </p>
              <button onClick={closeModal} className="rounded-lg bg-zinc-900 p-2 text-zinc-300 hover:bg-zinc-800 transition">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="max-h-[75vh] overflow-y-auto p-5 space-y-4">
              {formError && (
                <div className="rounded-xl border border-red-800/50 bg-red-950/30 px-3 py-2 text-xs text-red-300">
                  {formError}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <label className="col-span-2 text-xs text-zinc-400">
                  Nombre descriptivo
                  <input
                    required
                    value={form.label}
                    onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                    className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-indigo-500 focus:outline-none"
                  />
                </label>

                <label className="text-xs text-zinc-400">
                  Nombre del bucket en R2
                  <input
                    required
                    value={form.bucketName}
                    onChange={(e) => setForm((f) => ({ ...f, bucketName: e.target.value }))}
                    className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-indigo-500 focus:outline-none"
                  />
                </label>

                <label className="text-xs text-zinc-400">
                  Tipo
                  <select
                    value={form.type}
                    onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as BucketType }))}
                    className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-indigo-500 focus:outline-none"
                  >
                    <option value="images">Imágenes y otros</option>
                    <option value="multimedia">Multimedia (audio/vídeo)</option>
                    <option value="clips">Clips</option>
                    <option value="social">Clips para Redes Sociales</option>
                  </select>
                </label>

                <label className="text-xs text-zinc-400">
                  Account ID
                  <input
                    required
                    value={form.accountId}
                    onChange={(e) => setForm((f) => ({ ...f, accountId: e.target.value }))}
                    className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-indigo-500 focus:outline-none"
                  />
                </label>

                <label className="text-xs text-zinc-400">
                  Access Key ID
                  <input
                    required
                    value={form.accessKeyId}
                    onChange={(e) => setForm((f) => ({ ...f, accessKeyId: e.target.value }))}
                    className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-indigo-500 focus:outline-none"
                  />
                </label>

                <label className="col-span-2 text-xs text-zinc-400">
                  Secret Access Key
                  <input
                    type="password"
                    value={form.secretAccessKey}
                    onChange={(e) => setForm((f) => ({ ...f, secretAccessKey: e.target.value }))}
                    placeholder={editingBucket ? 'Dejar en blanco para no cambiarla' : ''}
                    className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-indigo-500 focus:outline-none"
                  />
                </label>

                <label className="col-span-2 text-xs text-zinc-400">
                  Endpoint S3 de R2
                  <input
                    required
                    value={form.endpoint}
                    onChange={(e) => setForm((f) => ({ ...f, endpoint: e.target.value }))}
                    placeholder="https://<account_id>.r2.cloudflarestorage.com"
                    className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-indigo-500 focus:outline-none"
                  />
                </label>

                <label className="col-span-2 text-xs text-zinc-400">
                  URL pública / CDN
                  <input
                    required
                    value={form.publicUrlBase}
                    onChange={(e) => setForm((f) => ({ ...f, publicUrlBase: e.target.value }))}
                    placeholder="https://cdn.ejemplo.com"
                    className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-indigo-500 focus:outline-none"
                  />
                </label>

                <label className="text-xs text-zinc-400">
                  Límite de almacenamiento (GB, máx. {HARD_MAX_GB})
                  <input
                    type="number"
                    step="0.1"
                    min="0.1"
                    max={HARD_MAX_GB}
                    required
                    value={form.maxBytesGb}
                    onChange={(e) => setForm((f) => ({ ...f, maxBytesGb: e.target.value }))}
                    className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-indigo-500 focus:outline-none"
                  />
                </label>

                <div className="flex flex-col justify-end gap-2 text-xs text-zinc-300">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={form.isDefault}
                      onChange={(e) => setForm((f) => ({ ...f, isDefault: e.target.checked }))}
                    />
                    Predeterminado para este tipo
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={form.isActive}
                      onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
                    />
                    Activo
                  </label>
                </div>
              </div>

              <button
                type="submit"
                disabled={saving}
                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 transition disabled:cursor-not-allowed disabled:bg-zinc-700"
              >
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Guardando...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" /> Guardar
                  </>
                )}
              </button>
            </form>
          </div>
        </div>
      )}

      {connectedBucket && (
        <BucketFileBrowser
          mode="single"
          bucket={connectedBucket}
          onClose={() => setConnectedBucket(null)}
        />
      )}

      {unifiedOpen && (
        <BucketFileBrowser
          mode="unified"
          buckets={activeBuckets.map((b) => ({ id: b.id, label: b.label, bucketName: b.bucketName }))}
          onClose={() => setUnifiedOpen(false)}
        />
      )}
    </div>
  );
}
