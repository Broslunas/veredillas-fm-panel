'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import R2Uploader from '@/components/R2Uploader';
import { Save, ArrowLeft, Loader2, CheckCircle2, Plus, Trash2 } from 'lucide-react';
import { useAutoSaveDraft } from '@/lib/useAutoSaveDraft';
import AutoSaveDraftBanner from '@/components/AutoSaveDraftBanner';
import AutoSaveStatus from '@/components/AutoSaveStatus';

interface TeamLink {
  label: string;
  url: string;
}

interface TeamEditorProps {
  initialData?: any;
  isEdit?: boolean;
}

function suggestSchoolYear(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-indexed, 8 = septiembre
  const startYear = month >= 8 ? year : year - 1;
  return `${startYear}/${startYear + 1}`;
}

export default function TeamEditorForm({ initialData, isEdit = false }: TeamEditorProps) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    name: initialData?.name || '',
    slug: initialData?.slug || '',
    role: initialData?.role || '',
    department: initialData?.department || '',
    image: initialData?.image || '',
    schoolYear: initialData?.schoolYear || suggestSchoolYear(),
    order: initialData?.order ?? 0,
    bio: initialData?.bio || '',
    links: (initialData?.links as TeamLink[] | undefined)?.length
      ? (initialData.links as TeamLink[])
      : [],
  });

  const {
    lastAutoSavedAt,
    draftAvailable,
    draftSavedAt,
    restoreDraft,
    discardDraft,
    markSaved,
  } = useAutoSaveDraft(`team:${initialData?._id || 'new'}`, formData);

  const handleRestoreDraft = () => {
    const draft = restoreDraft();
    if (draft) setFormData(draft);
  };

  const handleNameChange = (val: string) => {
    const updated: any = { name: val };
    if (!isEdit && !formData.slug) {
      updated.slug = val
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
    }
    setFormData((prev) => ({ ...prev, ...updated }));
  };

  const updateLink = (index: number, field: keyof TeamLink, value: string) => {
    setFormData((prev) => ({
      ...prev,
      links: prev.links.map((link, i) => (i === index ? { ...link, [field]: value } : link)),
    }));
  };

  const addLink = () => {
    setFormData((prev) => ({ ...prev, links: [...prev.links, { label: '', url: '' }] }));
  };

  const removeLink = (index: number) => {
    setFormData((prev) => ({ ...prev, links: prev.links.filter((_, i) => i !== index) }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSuccessMessage(null);
    setErrorMessage(null);

    try {
      const url = isEdit ? `/api/team/${initialData._id}` : '/api/team';
      const method = isEdit ? 'PUT' : 'POST';

      const payload = {
        ...formData,
        order: Number(formData.order) || 0,
        links: formData.links.filter((link) => link.label.trim() && link.url.trim()),
      };

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al guardar el miembro del equipo');

      markSaved();
      setSuccessMessage(isEdit ? 'Miembro actualizado con éxito' : 'Miembro creado con éxito');
      setTimeout(() => {
        router.push('/team');
      }, 1000);
    } catch (err: any) {
      setErrorMessage(err.message || 'Error al guardar el miembro del equipo');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="p-6 md:p-8 space-y-6 max-w-4xl mx-auto w-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800/80 pb-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.push('/team')}
            className="p-2 text-zinc-400 hover:text-zinc-100 bg-zinc-900 border border-zinc-800 rounded-lg transition"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="text-lg font-bold text-zinc-100">
              {isEdit ? 'Editar Miembro del Equipo' : 'Nuevo Miembro del Equipo'}
            </h1>
            <p className="text-xs text-zinc-400 font-mono">
              {formData.slug ? `/equipo/${formData.slug}` : 'Perfil del equipo'}
            </p>
            <AutoSaveStatus lastAutoSavedAt={lastAutoSavedAt} />
          </div>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium px-5 py-2.5 rounded-lg transition flex items-center gap-2 shadow-lg shadow-indigo-600/20 disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          <span>{saving ? 'Guardando...' : 'Guardar Miembro'}</span>
        </button>
      </div>

      {draftAvailable && (
        <AutoSaveDraftBanner savedAt={draftSavedAt} onRestore={handleRestoreDraft} onDiscard={discardDraft} />
      )}

      {successMessage && (
        <div className="p-3 bg-emerald-950/40 border border-emerald-900/60 rounded-lg text-xs text-emerald-300 flex items-center gap-2 font-mono">
          <CheckCircle2 className="w-4 h-4" />
          <span>{successMessage}</span>
        </div>
      )}

      {errorMessage && (
        <div className="p-3 bg-red-950/40 border border-red-900/60 rounded-lg text-xs text-red-300 font-mono">
          {errorMessage}
        </div>
      )}

      {/* Form Content */}
      <div className="space-y-4 bg-zinc-900/40 p-6 rounded-xl border border-zinc-800/80">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-zinc-400 mb-1">
              Nombre Completo *
            </label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="Ej: Miguel Salazar"
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 font-medium placeholder-zinc-600 focus:outline-none focus:border-zinc-500 transition"
            />
          </div>

          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-zinc-400 mb-1">
              Slug Único *
            </label>
            <input
              type="text"
              required
              value={formData.slug}
              onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
              placeholder="miguel-salazar"
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 font-mono placeholder-zinc-600 focus:outline-none focus:border-zinc-500 transition"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-zinc-400 mb-1">
              Rol / Cargo
            </label>
            <input
              type="text"
              value={formData.role}
              onChange={(e) => setFormData({ ...formData, role: e.target.value })}
              placeholder="Ej: Lead Dev, Sonido & Estrategia"
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 transition"
            />
          </div>

          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-zinc-400 mb-1">
              Departamento
            </label>
            <input
              type="text"
              value={formData.department}
              onChange={(e) => setFormData({ ...formData, department: e.target.value })}
              placeholder="Ej: Dirección, Tecnología, Voces..."
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 transition"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-zinc-400 mb-1">
              Curso Escolar *
            </label>
            <input
              type="text"
              required
              value={formData.schoolYear}
              onChange={(e) => setFormData({ ...formData, schoolYear: e.target.value })}
              placeholder="2025/2026 o 2025/2027"
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 font-mono placeholder-zinc-600 focus:outline-none focus:border-zinc-500 transition"
            />
            <p className="text-[11px] text-zinc-500 mt-1">
              Año único (ej: 2025/2026) o rango plurianual (ej: 2025/2027) para estar activo en varios cursos.
            </p>
          </div>

          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-zinc-400 mb-1">
              Orden
            </label>
            <input
              type="number"
              value={formData.order}
              onChange={(e) => setFormData({ ...formData, order: e.target.value })}
              placeholder="0"
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 font-mono placeholder-zinc-600 focus:outline-none focus:border-zinc-500 transition"
            />
            <p className="text-[11px] text-zinc-500 mt-1">
              Controla la posición dentro del curso. Los números más bajos aparecen primero.
            </p>
          </div>
        </div>

        <R2Uploader
          label="Foto de Perfil (R2 Upload)"
          accept="image/*"
          folder="team"
          entityId={formData.slug}
          value={formData.image}
          onChange={(url) => setFormData({ ...formData, image: url })}
          helperText="Foto de perfil en formato cuadrado recomendado."
        />

        <div>
          <label className="block text-xs font-mono uppercase tracking-wider text-zinc-400 mb-1">
            Biografía
          </label>
          <textarea
            rows={4}
            value={formData.bio}
            onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
            placeholder="Breve biografía del miembro del equipo..."
            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 transition"
          />
        </div>

        {/* Links */}
        <div className="pt-4 border-t border-zinc-800/80 space-y-3">
          <div className="flex items-center justify-between">
            <label className="block text-xs font-mono uppercase tracking-wider text-zinc-400">
              Enlaces (Redes Sociales, Web...)
            </label>
            <button
              type="button"
              onClick={addLink}
              className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 font-medium"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Añadir enlace</span>
            </button>
          </div>

          {formData.links.length === 0 ? (
            <p className="text-xs text-zinc-500">Sin enlaces todavía.</p>
          ) : (
            <div className="space-y-2">
              {formData.links.map((link, index) => (
                <div key={index} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={link.label}
                    onChange={(e) => updateLink(index, 'label', e.target.value)}
                    placeholder="Instagram"
                    className="w-32 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                  />
                  <input
                    type="text"
                    value={link.url}
                    onChange={(e) => updateLink(index, 'url', e.target.value)}
                    placeholder="https://instagram.com/..."
                    className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-100 font-mono placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                  />
                  <button
                    type="button"
                    onClick={() => removeLink(index)}
                    className="p-1.5 text-zinc-500 hover:text-red-400 hover:bg-red-950/30 rounded-md transition shrink-0"
                    title="Eliminar enlace"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </form>
  );
}
