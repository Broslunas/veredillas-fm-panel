'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, CheckCircle2, XCircle, HardDrive, Cpu } from 'lucide-react';
import { getActiveAlertThreshold, getAlertLevelForThreshold } from '@/lib/storage-alert-levels';

const YoutubeIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
  </svg>
);

interface BucketUsage {
  id: string;
  label: string;
  type: string;
  totalBytes: number;
  maxBytes: number;
}

function formatGB(bytes: number): string {
  // Base decimal (1000), igual que el dashboard de Cloudflare R2 (no GiB/1024^3).
  return `${(bytes / (1000 * 1000 * 1000)).toFixed(1)} GB`;
}

export default function IntegrationStatusWidget() {
  const [loading, setLoading] = useState(true);
  const [youtube, setYoutube] = useState<{ configured: boolean; channel: any } | null>(null);
  const [deepgramBalance, setDeepgramBalance] = useState<{ amount: number; units: string } | null>(null);
  const [buckets, setBuckets] = useState<BucketUsage[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const [ytRes, dgRes, bucketsRes] = await Promise.allSettled([
        fetch('/api/youtube/status').then((r) => r.json()),
        fetch('/api/admin/deepgram/stats').then((r) => (r.ok ? r.json() : Promise.reject())),
        fetch('/api/admin/buckets').then((r) => (r.ok ? r.json() : Promise.reject())),
      ]);

      if (cancelled) return;

      if (ytRes.status === 'fulfilled') {
        setYoutube({ configured: !!ytRes.value.channel, channel: ytRes.value.channel });
      }

      if (dgRes.status === 'fulfilled') {
        const balance = dgRes.value?.balances?.balances?.[0];
        if (balance) {
          setDeepgramBalance({ amount: balance.amount, units: balance.units || 'USD' });
        }
      }

      if (bucketsRes.status === 'fulfilled') {
        const defaultBuckets = (bucketsRes.value.buckets || []).filter((b: any) => b.isDefault);
        const usages = await Promise.all(
          defaultBuckets.map(async (b: any) => {
            try {
              const res = await fetch(`/api/admin/buckets/${b.id}/usage`);
              if (!res.ok) return null;
              const usage = await res.json();
              return { id: b.id, label: b.label, type: b.type, totalBytes: usage.totalBytes, maxBytes: usage.maxBytes };
            } catch {
              return null;
            }
          })
        );
        if (!cancelled) setBuckets(usages.filter((u): u is BucketUsage => !!u));
      }

      if (!cancelled) setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-xl p-4 space-y-3">
      <h2 className="text-xs font-semibold text-zinc-300 uppercase tracking-wide font-mono">
        Estado de Integraciones
      </h2>

      {loading ? (
        <div className="flex items-center gap-2 text-zinc-500 py-4 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-xs font-mono">Comprobando...</span>
        </div>
      ) : (
        <div className="space-y-2.5">
          {/* YouTube */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <YoutubeIcon className="w-4 h-4 text-red-500 shrink-0" />
              <span className="text-xs text-zinc-300 truncate">
                {youtube?.configured ? youtube.channel?.title || 'YouTube' : 'YouTube'}
              </span>
            </div>
            {youtube?.configured ? (
              <span className="flex items-center gap-1 text-[10px] font-mono text-emerald-400 shrink-0">
                <CheckCircle2 className="w-3.5 h-3.5" /> Conectado
              </span>
            ) : (
              <Link
                href="/youtube"
                className="flex items-center gap-1 text-[10px] font-mono text-red-400 shrink-0 hover:text-red-300"
              >
                <XCircle className="w-3.5 h-3.5" /> Reconectar
              </Link>
            )}
          </div>

          {/* Deepgram */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Cpu className="w-4 h-4 text-purple-400 shrink-0" />
              <span className="text-xs text-zinc-300 truncate">Deepgram</span>
            </div>
            {deepgramBalance ? (
              <span className="text-[10px] font-mono text-zinc-400 shrink-0">
                ${deepgramBalance.amount.toFixed(2)} {deepgramBalance.units}
              </span>
            ) : (
              <Link href="/deepgram-stats" className="text-[10px] font-mono text-zinc-500 hover:text-zinc-300 shrink-0">
                Ver detalle
              </Link>
            )}
          </div>

          {/* R2 Buckets */}
          {buckets.length === 0 ? (
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <HardDrive className="w-4 h-4 text-amber-400 shrink-0" />
                <span className="text-xs text-zinc-300 truncate">Almacenamiento R2</span>
              </div>
              <Link href="/admin/buckets" className="text-[10px] font-mono text-zinc-500 hover:text-zinc-300 shrink-0">
                Ver buckets
              </Link>
            </div>
          ) : (
            buckets.map((bucket) => {
              const rawPct = bucket.maxBytes > 0 ? (bucket.totalBytes / bucket.maxBytes) * 100 : 0;
              const pct = Math.min(100, rawPct);
              const activeLevel = getAlertLevelForThreshold(getActiveAlertThreshold(rawPct));
              return (
                <div key={bucket.id} className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <HardDrive className="w-4 h-4 text-amber-400 shrink-0" />
                      <span className="text-xs text-zinc-300 truncate">{bucket.label}</span>
                    </div>
                    <span className="text-[10px] font-mono text-zinc-500 shrink-0">
                      {formatGB(bucket.totalBytes)} / {formatGB(bucket.maxBytes)}
                    </span>
                  </div>
                  <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden ml-6">
                    <div
                      className="h-full rounded-full bg-indigo-500"
                      style={{ width: `${pct}%`, backgroundColor: activeLevel?.color }}
                    />
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
