'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Plus, Search, Users, Trash2, Edit2, Loader2, Link2 } from 'lucide-react';

export default function TeamListPage() {
  const [team, setTeam] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [schoolYearFilter, setSchoolYearFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchTeam = async (query = '') => {
    setLoading(true);
    try {
      const res = await fetch(`/api/team?q=${encodeURIComponent(query)}`);
      if (res.ok) {
        const data = await res.json();
        setTeam(data);
      }
    } catch (err) {
      console.error('Error fetching team:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTeam(search);
  }, [search]);

  const schoolYears = useMemo(() => {
    const all = team.flatMap((m) => {
      const parts = (m.schoolYear || '').split('/').map((p: string) => parseInt(p.trim(), 10));
      if (parts.length === 2 && !Number.isNaN(parts[0]) && !Number.isNaN(parts[1]) && parts[1] > parts[0]) {
        const list = [];
        for (let y = parts[0]; y < parts[1]; y++) list.push(`${y}/${y + 1}`);
        return list;
      }
      return m.schoolYear ? [m.schoolYear] : [];
    });
    return [...new Set(all)].sort().reverse();
  }, [team]);

  const filteredTeam = useMemo(
    () =>
      schoolYearFilter
        ? team.filter((m) => {
            const parts = (m.schoolYear || '').split('/').map((p: string) => parseInt(p.trim(), 10));
            if (parts.length === 2 && !Number.isNaN(parts[0]) && !Number.isNaN(parts[1]) && parts[1] > parts[0]) {
              const list = [];
              for (let y = parts[0]; y < parts[1]; y++) list.push(`${y}/${y + 1}`);
              return list.includes(schoolYearFilter);
            }
            return m.schoolYear === schoolYearFilter;
          })
        : team,
    [team, schoolYearFilter]
  );

  const handleDelete = async (id: string) => {
    if (!confirm('¿Mover este miembro del equipo a la papelera? Podrás restaurarlo más tarde desde Papelera.')) return;

    setDeletingId(id);
    try {
      const res = await fetch(`/api/team/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setTeam((prev) => prev.filter((m) => m._id !== id));
      }
    } catch (err) {
      alert('Error al eliminar miembro del equipo');
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
            <Users className="w-5 h-5 text-purple-400" />
            <span>Gestión del Equipo</span>
          </h1>
          <p className="text-xs text-zinc-400 mt-0.5">
            Perfiles del equipo de Veredillas FM, organizados por curso escolar
          </p>
        </div>

        <Link
          href="/team/new"
          className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium px-4 py-2.5 rounded-lg transition flex items-center gap-2 self-start sm:self-auto shadow-lg shadow-indigo-600/20"
        >
          <Plus className="w-4 h-4" />
          <span>Nuevo Miembro</span>
        </Link>
      </div>

      {/* Search + Filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative max-w-md flex-1">
          <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre, rol o slug..."
            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg pl-9 pr-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-600 transition"
          />
        </div>

        <select
          value={schoolYearFilter}
          onChange={(e) => setSchoolYearFilter(e.target.value)}
          className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-zinc-600 transition"
        >
          <option value="">Todos los cursos</option>
          {schoolYears.map((year) => (
            <option key={year} value={year}>
              {year}
            </option>
          ))}
        </select>
      </div>

      {/* Grid of Team Members */}
      {loading ? (
        <div className="p-12 flex justify-center text-zinc-500 gap-2">
          <Loader2 className="w-5 h-5 animate-spin text-purple-400" />
          <span className="text-xs font-mono">Cargando equipo...</span>
        </div>
      ) : filteredTeam.length === 0 ? (
        <div className="p-12 border border-zinc-800/80 rounded-xl text-center space-y-3">
          <p className="text-xs font-mono text-zinc-500">No se encontraron miembros del equipo.</p>
          <Link
            href="/team/new"
            className="inline-flex items-center gap-1.5 text-xs text-purple-400 hover:text-purple-300 font-medium"
          >
            <Plus className="w-4 h-4" />
            <span>Crear primer miembro</span>
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredTeam.map((member) => (
            <div
              key={member._id}
              className="bg-zinc-900/40 border border-zinc-800/80 rounded-xl p-5 hover:border-zinc-700/80 transition flex flex-col justify-between space-y-4"
            >
              <div className="flex items-start gap-3">
                {member.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={member.image}
                    alt={member.name}
                    className="w-12 h-12 rounded-full object-cover bg-zinc-950 border border-zinc-800 shrink-0"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-300 font-bold shrink-0">
                    {member.name?.charAt(0)}
                  </div>
                )}

                <div className="min-w-0 space-y-0.5">
                  <h3 className="text-sm font-semibold text-zinc-100 truncate">{member.name}</h3>
                  <p className="text-xs text-purple-400 font-mono truncate">{member.role || 'Miembro del equipo'}</p>
                  <p className="text-[11px] text-zinc-500 font-mono truncate">Slug: {member.slug}</p>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-950/50 text-indigo-300 border border-indigo-900/50">
                  {member.schoolYear}
                </span>
                {member.department && (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700/50">
                    {member.department}
                  </span>
                )}
              </div>

              {member.bio && <p className="text-xs text-zinc-400 line-clamp-2">{member.bio}</p>}

              <div className="pt-2 border-t border-zinc-800/60 flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-zinc-500">
                  {member.links?.length > 0 && (
                    <span title={`${member.links.length} enlace(s)`} className="flex items-center gap-1">
                      <Link2 className="w-3.5 h-3.5" />
                      <span className="text-[10px] font-mono">{member.links.length}</span>
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <Link
                    href={`/team/${member._id}`}
                    className="flex items-center gap-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 px-2.5 py-1 rounded-md text-xs font-medium transition"
                  >
                    <Edit2 className="w-3 h-3" />
                    <span>Editar</span>
                  </Link>

                  <button
                    onClick={() => handleDelete(member._id)}
                    disabled={deletingId === member._id}
                    className="p-1.5 text-zinc-500 hover:text-red-400 hover:bg-red-950/30 rounded-md transition"
                    title="Eliminar miembro del equipo"
                  >
                    {deletingId === member._id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-red-400" />
                    ) : (
                      <Trash2 className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
