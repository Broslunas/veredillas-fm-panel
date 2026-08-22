'use client';

import React, { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus, Search, Radio, Trash2, Edit2, Loader2, Sparkles, Languages } from 'lucide-react';
import BulkActionsBar from '@/components/BulkActionsBar';
import BatchDubbingModal from '@/components/BatchDubbingModal';

type StatusFilter = 'all' | 'draft' | 'published';

export default function EpisodesListPage() {
  return (
    <Suspense
      fallback={
        <div className="p-12 flex justify-center text-zinc-500 gap-2 font-mono text-xs">
          <Loader2 className="w-5 h-5 animate-spin text-indigo-500" />
          <span>Cargando episodios...</span>
        </div>
      }
    >
      <EpisodesListContent />
    </Suspense>
  );
}

function EpisodesListContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialStatus = searchParams.get('status');
  const [episodes, setEpisodes] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(
    initialStatus === 'draft' || initialStatus === 'published' ? initialStatus : 'all'
  );
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isBatchDubOpen, setIsBatchDubOpen] = useState(false);

  const fetchEpisodes = async (query = '', status: StatusFilter = 'all') => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (query) params.set('q', query);
      if (status !== 'all') params.set('status', status);
      const res = await fetch(`/api/episodes?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setEpisodes(data);
        // Drop selections that are no longer in the visible result set.
        setSelectedIds((prev) => prev.filter((id) => data.some((ep: any) => ep._id === id)));
      }
    } catch (err) {
      console.error('Error fetching episodes:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEpisodes(search, statusFilter);
  }, [search, statusFilter]);

  const handleStatusFilterChange = (status: StatusFilter) => {
    setStatusFilter(status);
    const params = new URLSearchParams(searchParams.toString());
    if (status === 'all') params.delete('status');
    else params.set('status', status);
    router.replace(`/episodes${params.toString() ? `?${params.toString()}` : ''}`, { scroll: false });
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const handleDelete = async (id: string) => {
    if (!confirm('¿Mover este episodio a la papelera? Podrás restaurarlo más tarde desde Papelera.')) return;

    setDeletingId(id);
    try {
      const res = await fetch(`/api/episodes/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setEpisodes((prev) => prev.filter((ep) => ep._id !== id));
      }
    } catch (err) {
      alert('Error al eliminar episodio');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-6xl mx-auto w-full">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800/80 pb-6">
        <div>
          <h1 className="text-xl font-bold text-zinc-100 flex items-center gap-2">
            <Radio className="w-5 h-5 text-indigo-400" />
            <span>Gestión de Episodios</span>
          </h1>
          <p className="text-xs text-zinc-400 mt-0.5">
            Crea, edita y gestiona el contenido multimedia y audio de los programas
          </p>
        </div>

        <Link
          href="/episodes/new"
          className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium px-4 py-2.5 rounded-lg transition flex items-center gap-2 self-start sm:self-auto shadow-lg shadow-indigo-600/20"
        >
          <Plus className="w-4 h-4" />
          <span>Nuevo Episodio</span>
        </Link>
      </div>

      {/* Search Bar */}
      <div className="relative max-w-md">
        <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar episodio por título, slug o descripción..."
          className="w-full bg-zinc-900 border border-zinc-800 rounded-lg pl-9 pr-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-600 transition"
        />
      </div>

      {/* Status Filter */}
      <div className="flex items-center gap-1.5">
        {([
          { value: 'all', label: 'Todos' },
          { value: 'draft', label: 'Borradores' },
          { value: 'published', label: 'Publicados' },
        ] as { value: StatusFilter; label: string }[]).map((opt) => (
          <button
            key={opt.value}
            onClick={() => handleStatusFilterChange(opt.value)}
            className={`text-xs font-medium px-3 py-1.5 rounded-lg transition ${
              statusFilter === opt.value
                ? 'bg-zinc-800 text-zinc-100 border border-zinc-700/60'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60 border border-transparent'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Table / List */}
      {loading ? (
        <div className="p-12 flex justify-center text-zinc-500 gap-2">
          <Loader2 className="w-5 h-5 animate-spin text-indigo-400" />
          <span className="text-xs font-mono">Cargando episodios...</span>
        </div>
      ) : episodes.length === 0 ? (
        <div className="p-12 border border-zinc-800/80 rounded-xl text-center space-y-3">
          <p className="text-xs font-mono text-zinc-500">No se encontraron episodios.</p>
          <Link
            href="/episodes/new"
            className="inline-flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 font-medium"
          >
            <Plus className="w-4 h-4" />
            <span>Crear primer episodio</span>
          </Link>
        </div>
      ) : (
        <>
        <BulkActionsBar
          collection="episodes"
          selectedIds={selectedIds}
          totalCount={episodes.length}
          actions={['publish', 'unpublish', 'tag_add', 'tag_remove', 'delete']}
          customAction={{
            label: 'Doblar en lote',
            icon: Languages,
            onClick: () => setIsBatchDubOpen(true),
            className:
              'bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1 rounded-lg font-medium transition flex items-center gap-1 shadow-sm',
          }}
          onClear={() => setSelectedIds([])}
          onSelectAll={() => setSelectedIds(episodes.map((ep) => ep._id))}
          onDone={() => {
            setSelectedIds([]);
            fetchEpisodes(search, statusFilter);
          }}
          deleteWarning="¿Mover {count} episodio(s) a la papelera? Podrás restaurarlos más tarde."
        />

        <BatchDubbingModal
          isOpen={isBatchDubOpen}
          onClose={() => setIsBatchDubOpen(false)}
          selectedEpisodes={episodes.filter((ep) => selectedIds.includes(ep._id))}
          onComplete={() => {
            fetchEpisodes(search, statusFilter);
          }}
        />

        <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-xl divide-y divide-zinc-800/60 overflow-hidden">
          {episodes.map((ep) => (
            <div
              key={ep._id}
              className={`p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition ${
                selectedIds.includes(ep._id) ? 'bg-indigo-950/30' : 'hover:bg-zinc-900/80'
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <input
                  type="checkbox"
                  checked={selectedIds.includes(ep._id)}
                  onChange={() => toggleSelect(ep._id)}
                  aria-label={`Seleccionar ${ep.title}`}
                  className="rounded border-zinc-700 bg-zinc-900 accent-indigo-600 shrink-0"
                />
                {ep.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={ep.image}
                    alt={ep.title}
                    className="w-12 h-12 rounded-lg object-cover bg-zinc-950 border border-zinc-800 shrink-0"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-lg bg-zinc-800 flex items-center justify-center text-zinc-400 shrink-0">
                    <Radio className="w-6 h-6" />
                  </div>
                )}

                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-zinc-100 truncate">{ep.title}</h3>
                    {ep.status === 'draft' && (
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-400 shrink-0">
                        Borrador
                      </span>
                    )}
                    {ep.isPremiere ? (
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-950/60 border border-amber-800/60 text-amber-400 shrink-0">
                        Estreno
                      </span>
                    ) : (
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950/60 border border-emerald-800/60 text-emerald-400 shrink-0">
                        Publicado
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-zinc-400 line-clamp-1">{ep.description}</p>
                  <div className="flex items-center gap-3 text-[11px] font-mono text-zinc-500">
                    <span>Slug: {ep.slug}</span>
                    <span>&bull;</span>
                    <span>{ep.pubDate ? new Date(ep.pubDate).toLocaleDateString('es-ES') : ''}</span>
                    {ep.duration && (
                      <>
                        <span>&bull;</span>
                        <span>{ep.duration}</span>
                      </>
                    )}
                  </div>
                  {ep.tags?.length > 0 && (
                    <div className="flex items-center gap-1 flex-wrap">
                      {ep.tags.map((tag: string) => (
                        <span
                          key={tag}
                          className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800/80 border border-zinc-700/60 text-zinc-400"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
                <Link
                  href={`/episodes/${ep._id}`}
                  className="flex items-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 px-3 py-1.5 rounded-lg text-xs font-medium transition"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                  <span>Editar</span>
                </Link>

                <button
                  onClick={() => handleDelete(ep._id)}
                  disabled={deletingId === ep._id}
                  className="p-2 text-zinc-500 hover:text-red-400 hover:bg-red-950/30 rounded-lg transition"
                  title="Eliminar episodio"
                >
                  {deletingId === ep._id ? (
                    <Loader2 className="w-4 h-4 animate-spin text-red-400" />
                  ) : (
                    <Trash2 className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
        </>
      )}
    </div>
  );
}
