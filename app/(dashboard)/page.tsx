'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Radio, FileText, Users, HardDrive, Plus, ArrowUpRight, Loader2, Sparkles } from 'lucide-react';
import IntegrationStatusWidget from '@/components/dashboard/IntegrationStatusWidget';
import PendingCommentsWidget from '@/components/dashboard/PendingCommentsWidget';
import PendingTasksWidget from '@/components/dashboard/PendingTasksWidget';
import MissingTranscriptionsWidget from '@/components/dashboard/MissingTranscriptionsWidget';
import { PermissionMap, can } from '@/lib/permissions';

export default function DashboardOverviewPage() {
  const [stats, setStats] = useState({
    episodes: 0,
    blog: 0,
    guests: 0,
    files: 0,
  });
  const [permissions, setPermissions] = useState<PermissionMap | null>(null);
  const [recentEpisodes, setRecentEpisodes] = useState<any[]>([]);
  const [allEpisodes, setAllEpisodes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        const [meRes, epRes, blogRes, guestRes, r2Res] = await Promise.all([
          fetch('/api/auth/me'),
          fetch('/api/episodes'),
          fetch('/api/blog'),
          fetch('/api/guests'),
          fetch('/api/r2/files'),
        ]);

        if (meRes.ok) {
          const meData = await meRes.json();
          setPermissions(meData.user?.permissions || null);
        }

        const episodes = epRes.ok ? await epRes.json() : [];
        const blog = blogRes.ok ? await blogRes.json() : [];
        const guests = guestRes.ok ? await guestRes.json() : [];
        const r2Data = r2Res.ok ? await r2Res.json() : { files: [] };

        setStats({
          episodes: episodes.length || 0,
          blog: blog.length || 0,
          guests: guests.length || 0,
          files: r2Data.files?.length || 0,
        });

        setAllEpisodes(episodes);
        setRecentEpisodes(episodes.slice(0, 5));
      } catch (err) {
        console.error('Error loading dashboard overview data:', err);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, []);

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center text-zinc-500 gap-2">
        <Loader2 className="w-5 h-5 animate-spin text-indigo-500" />
        <span className="text-xs font-mono">Cargando métricas...</span>
      </div>
    );
  }

  const statCards = [
    { label: 'Episodios', count: stats.episodes, icon: Radio, href: '/episodes', color: 'text-indigo-400', section: 'episodes' as const },
    { label: 'Artículos de Blog', count: stats.blog, icon: FileText, href: '/blog', color: 'text-emerald-400', section: 'blog' as const },
    { label: 'Invitados', count: stats.guests, icon: Users, href: '/guests', color: 'text-purple-400', section: 'guests' as const },
    { label: 'Archivos R2', count: stats.files, icon: HardDrive, href: '/admin/buckets', color: 'text-amber-400', section: 'buckets' as const },
  ].filter((card) => can(permissions, card.section));

  return (
    <div className="p-6 md:p-8 space-y-8 max-w-6xl mx-auto w-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800/80 pb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-100 flex items-center gap-2">
            <span>Visión General</span>
            <Sparkles className="w-4 h-4 text-indigo-400" />
          </h1>
          <p className="text-xs text-zinc-400 mt-1">
            Gestión completa de contenidos para Veredillas FM
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Link
            href="/episodes/new"
            className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium px-3.5 py-2 rounded-lg transition flex items-center gap-1.5 shadow-lg shadow-indigo-600/20"
          >
            <Plus className="w-4 h-4" />
            <span>Episodio</span>
          </Link>
          <Link
            href="/blog/new"
            className="bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700/60 text-xs font-medium px-3.5 py-2 rounded-lg transition flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            <span>Blog</span>
          </Link>
          <Link
            href="/guests/new"
            className="bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700/60 text-xs font-medium px-3.5 py-2 rounded-lg transition flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            <span>Invitado</span>
          </Link>
        </div>
      </div>

      {/* STAT CARDS */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((card) => {
          const Icon = card.icon;
          return (
            <Link
              key={card.label}
              href={card.href}
              className="bg-zinc-900/60 border border-zinc-800/80 hover:border-zinc-700/80 rounded-xl p-5 transition group space-y-3"
            >
              <div className="flex items-center justify-between">
                <Icon className={`w-5 h-5 ${card.color}`} />
                <ArrowUpRight className="w-4 h-4 text-zinc-600 group-hover:text-zinc-300 transition" />
              </div>
              <div>
                <span className="text-2xl font-bold text-zinc-100 font-mono block">
                  {card.count}
                </span>
                <span className="text-xs text-zinc-400 font-medium">
                  {card.label}
                </span>
              </div>
            </Link>
          );
        })}
      </div>

      {/* RECENT EPISODES */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-200 tracking-wide uppercase font-mono">
            Episodios Recientes
          </h2>
          <Link
            href="/episodes"
            className="text-xs text-indigo-400 hover:text-indigo-300 transition font-medium"
          >
            Ver todos los episodios &rarr;
          </Link>
        </div>

        {recentEpisodes.length === 0 ? (
          <div className="p-8 border border-zinc-800/80 rounded-xl text-center text-zinc-500 text-xs font-mono">
            No hay episodios registrados todavía. ¡Crea el primero!
          </div>
        ) : (
          <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-xl divide-y divide-zinc-800/60 overflow-hidden">
            {recentEpisodes.map((ep) => (
              <div
                key={ep._id}
                className="p-4 flex items-center justify-between gap-4 hover:bg-zinc-900/80 transition"
              >
                <div className="flex items-center gap-3 min-w-0">
                  {ep.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={ep.image}
                      alt={ep.title}
                      className="w-10 h-10 rounded-lg object-cover bg-zinc-950 border border-zinc-800 shrink-0"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-lg bg-zinc-800 flex items-center justify-center text-zinc-400 shrink-0">
                      <Radio className="w-5 h-5" />
                    </div>
                  )}

                  <div className="min-w-0">
                    <p className="text-sm font-medium text-zinc-200 truncate">{ep.title}</p>
                    <p className="text-xs text-zinc-500 font-mono truncate">
                      {ep.pubDate ? new Date(ep.pubDate).toLocaleDateString('es-ES') : 'Sin fecha'} &bull; {ep.slug}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  {ep.isPremiere ? (
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-950/60 border border-amber-800/60 text-amber-400">
                      Estreno
                    </span>
                  ) : (
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950/60 border border-emerald-800/60 text-emerald-400">
                      Publicado
                    </span>
                  )}
                  <Link
                    href={`/episodes/${ep._id}`}
                    className="text-xs text-zinc-400 hover:text-zinc-100 bg-zinc-800 hover:bg-zinc-700 px-3 py-1.5 rounded-md transition"
                  >
                    Editar
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* WIDGETS */}
      <div className="space-y-4">
        {can(permissions, 'episodes') && <MissingTranscriptionsWidget episodes={allEpisodes} />}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {can(permissions, 'interviews') && <PendingTasksWidget episodes={allEpisodes} />}
          {can(permissions, 'comments') && <PendingCommentsWidget />}
          {can(permissions, 'buckets') && <IntegrationStatusWidget />}
        </div>
      </div>
    </div>
  );
}
