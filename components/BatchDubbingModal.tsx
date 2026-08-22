'use client';

import React, { useState, useEffect } from 'react';
import {
  Languages,
  X,
  Play,
  Square,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ChevronRight,
  Sparkles,
  Volume2
} from 'lucide-react';
import { runFullDubbingPipeline } from '@/lib/dubbing/runner-browser';

interface AuraVoice {
  name?: string;
  canonical_name: string;
  languages: string[];
  metadata?: { accent?: string; display_name?: string; tags?: string[] };
}

interface EpisodeItem {
  _id: string;
  title: string;
  slug: string;
  audioUrl?: string;
  videoUrl?: string;
  dubs?: Array<{ lang: string; status: string; url?: string }>;
}

interface BatchDubbingModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedEpisodes: EpisodeItem[];
  onComplete?: () => void;
}

const LANGUAGE_LABELS: Record<string, string> = {
  en: 'Inglés',
  fr: 'Francés',
  de: 'Alemán',
  it: 'Italiano',
  pt: 'Portugués',
  ca: 'Catalán',
  eu: 'Euskera',
  gl: 'Gallego',
  nl: 'Neerlandés',
  ru: 'Ruso',
  ar: 'Árabe',
  zh: 'Chino',
  ja: 'Japonés',
  ko: 'Coreano',
  es: 'Español',
};

function labelForLang(code: string): string {
  const base = code.split('-')[0];
  return LANGUAGE_LABELS[base] || code.toUpperCase();
}

interface EpisodeTaskState {
  id: string;
  title: string;
  slug: string;
  status: 'pending' | 'processing' | 'done' | 'error';
  stage?: string;
  percent?: number | null;
  detail?: string;
  error?: string;
}

export default function BatchDubbingModal({
  isOpen,
  onClose,
  selectedEpisodes,
  onComplete,
}: BatchDubbingModalProps) {
  const [availableLanguages, setAvailableLanguages] = useState<string[]>([]);
  const [voiceCatalog, setVoiceCatalog] = useState<AuraVoice[]>([]);
  const [selectedLang, setSelectedLang] = useState<string>('en');
  const [selectedVoice, setSelectedVoice] = useState<string>('');

  const [isRunning, setIsRunning] = useState(false);
  const [isAborted, setIsAborted] = useState(false);
  const [tasks, setTasks] = useState<EpisodeTaskState[]>([]);
  const [activeEpisodeId, setActiveEpisodeId] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    fetch('/api/admin/dubbing/voices')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.languages)) {
          setAvailableLanguages(data.languages);
          if (data.languages.length > 0 && !data.languages.includes(selectedLang)) {
            setSelectedLang(data.languages[0]);
          }
        }
        if (Array.isArray(data.voices)) {
          setVoiceCatalog(data.voices);
        }
      })
      .catch(() => {});
  }, [isOpen]);

  useEffect(() => {
    if (selectedEpisodes.length > 0) {
      setTasks(
        selectedEpisodes.map((ep) => ({
          id: ep._id,
          title: ep.title,
          slug: ep.slug,
          status: 'pending',
        }))
      );
    }
  }, [selectedEpisodes]);

  const voicesForLang = voiceCatalog.filter(
    (v) => Array.isArray(v.languages) && v.languages.some((l) => l === selectedLang || l.startsWith(`${selectedLang}-`))
  );

  useEffect(() => {
    if (voicesForLang.length > 0 && !selectedVoice) {
      setSelectedVoice(voicesForLang[0].canonical_name);
    } else if (voicesForLang.length > 0 && !voicesForLang.some((v) => v.canonical_name === selectedVoice)) {
      setSelectedVoice(voicesForLang[0].canonical_name);
    }
  }, [selectedLang, voicesForLang]);

  if (!isOpen) return null;

  const startBatch = async () => {
    setIsRunning(true);
    setIsAborted(false);

    const voiceMap: Record<string, string> = {};
    if (selectedVoice) {
      for (let i = 0; i < 15; i++) {
        voiceMap[String(i)] = selectedVoice;
      }
    }

    const langLabel = labelForLang(selectedLang);

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      if (task.status === 'done') continue;

      setActiveEpisodeId(task.id);
      setTasks((prev) =>
        prev.map((t) => (t.id === task.id ? { ...t, status: 'processing', detail: 'Iniciando doblaje…' } : t))
      );

      try {
        await runFullDubbingPipeline(
          task.id,
          task.slug,
          selectedLang,
          langLabel,
          Object.keys(voiceMap).length > 0 ? voiceMap : undefined,
          {
            onProgress: (p) => {
              setTasks((prev) =>
                prev.map((t) =>
                  t.id === task.id
                    ? {
                        ...t,
                        stage: p.stage,
                        percent: p.percent,
                        detail: p.detail,
                      }
                    : t
                )
              );
            },
          }
        );

        setTasks((prev) =>
          prev.map((t) =>
            t.id === task.id ? { ...t, status: 'done', detail: 'Doblaje finalizado con éxito', percent: 100 } : t
          )
        );
      } catch (err: any) {
        setTasks((prev) =>
          prev.map((t) =>
            t.id === task.id
              ? {
                  ...t,
                  status: 'error',
                  error: err?.message || 'Error al procesar el episodio',
                  detail: err?.message || 'Error',
                }
              : t
          )
        );
      }
    }

    setIsRunning(false);
    setActiveEpisodeId(null);
    onComplete?.();
  };

  const handleClose = () => {
    if (isRunning) {
      if (!confirm('Hay un proceso de doblaje por lotes en ejecución. ¿Deseas cerrar el diálogo?')) {
        return;
      }
    }
    onClose();
  };

  const completedCount = tasks.filter((t) => t.status === 'done').length;
  const errorCount = tasks.filter((t) => t.status === 'error').length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        {/* Modal Header */}
        <div className="p-5 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <Languages className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
                <span>Doblaje por Lotes</span>
                <span className="bg-indigo-950 text-indigo-400 border border-indigo-800/80 text-[10px] px-2 py-0.5 rounded-full font-mono">
                  {selectedEpisodes.length} seleccionados
                </span>
              </h3>
              <p className="text-xs text-zinc-400 mt-0.5">
                Procesa en cola automáticamente todos los episodios seleccionados sin intervención manual
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="text-zinc-400 hover:text-zinc-100 p-1.5 rounded-lg hover:bg-zinc-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-5 overflow-y-auto flex-1">
          {/* Configuration Form */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-zinc-950/60 border border-zinc-800/80 p-4 rounded-xl">
            <div>
              <label className="block text-xs font-semibold text-zinc-300 mb-1.5">Idioma destino</label>
              <select
                disabled={isRunning}
                value={selectedLang}
                onChange={(e) => setSelectedLang(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 disabled:opacity-50 focus:outline-none focus:border-indigo-500"
              >
                {availableLanguages.map((code) => (
                  <option key={code} value={code}>
                    {labelForLang(code)} ({code})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-300 mb-1.5 flex items-center justify-between">
                <span>Voz por defecto</span>
                <span className="text-[10px] text-zinc-500 font-normal">Deepgram Aura</span>
              </label>
              <select
                disabled={isRunning || voicesForLang.length === 0}
                value={selectedVoice}
                onChange={(e) => setSelectedVoice(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 disabled:opacity-50 focus:outline-none focus:border-indigo-500"
              >
                {voicesForLang.length === 0 ? (
                  <option value="">Sin voces para {labelForLang(selectedLang)}</option>
                ) : (
                  voicesForLang.map((v) => (
                    <option key={v.canonical_name} value={v.canonical_name}>
                      {v.metadata?.display_name || v.name || v.canonical_name} ({v.metadata?.accent || 'General'})
                    </option>
                  ))
                )}
              </select>
            </div>
          </div>

          {/* Warning banner */}
          <div className="bg-amber-950/30 border border-amber-800/40 rounded-xl p-3 text-xs text-amber-200/90 flex items-start gap-2.5">
            <Sparkles className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-0.5 leading-relaxed">
              <span className="font-semibold text-amber-300">Mantén esta pestaña abierta:</span>
              <p className="text-[11px] text-zinc-400">
                El ensamblado y codificación final a MP3 ocurre de forma segura y eficiente directamente en tu navegador
                antes de subirse a Cloudflare R2.
              </p>
            </div>
          </div>

          {/* Episode List / Progress */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-zinc-400 px-1">
              <span>Cola de episodios ({tasks.length})</span>
              <div className="flex items-center gap-3 text-[11px] font-mono">
                {completedCount > 0 && <span className="text-emerald-400">✓ {completedCount} listos</span>}
                {errorCount > 0 && <span className="text-rose-400">✕ {errorCount} errores</span>}
              </div>
            </div>

            <div className="bg-zinc-950/80 border border-zinc-800 rounded-xl divide-y divide-zinc-800/60 max-h-64 overflow-y-auto">
              {tasks.map((task) => (
                <div key={task.id} className="p-3 text-xs flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-zinc-200 truncate">{task.title}</span>
                    </div>

                    {task.detail && (
                      <p
                        className={`text-[11px] font-mono truncate ${
                          task.status === 'error'
                            ? 'text-rose-400'
                            : task.status === 'done'
                            ? 'text-emerald-400'
                            : 'text-zinc-400'
                        }`}
                      >
                        {task.detail}
                      </p>
                    )}

                    {task.status === 'processing' && task.percent !== null && task.percent !== undefined && (
                      <div className="w-full bg-zinc-800 rounded-full h-1.5 overflow-hidden mt-1">
                        <div
                          className="bg-indigo-500 h-full transition-all duration-300 rounded-full"
                          style={{ width: `${Math.min(100, Math.max(0, task.percent))}%` }}
                        />
                      </div>
                    )}
                  </div>

                  <div className="shrink-0 flex items-center">
                    {task.status === 'pending' && (
                      <span className="text-[10px] font-mono bg-zinc-900 border border-zinc-800 text-zinc-500 px-2 py-0.5 rounded">
                        En espera
                      </span>
                    )}
                    {task.status === 'processing' && (
                      <span className="text-[10px] font-mono bg-indigo-950 text-indigo-300 border border-indigo-800 px-2 py-0.5 rounded flex items-center gap-1.5">
                        <Loader2 className="w-3 h-3 animate-spin text-indigo-400" />
                        Procesando
                      </span>
                    )}
                    {task.status === 'done' && (
                      <span className="text-[10px] font-mono bg-emerald-950 text-emerald-300 border border-emerald-800 px-2 py-0.5 rounded flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                        Completado
                      </span>
                    )}
                    {task.status === 'error' && (
                      <span className="text-[10px] font-mono bg-rose-950 text-rose-300 border border-rose-800 px-2 py-0.5 rounded flex items-center gap-1">
                        <AlertCircle className="w-3 h-3 text-rose-400" />
                        Error
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-zinc-800 bg-zinc-950 flex items-center justify-between">
          <button
            type="button"
            disabled={isRunning}
            onClick={handleClose}
            className="text-xs text-zinc-400 hover:text-zinc-200 px-4 py-2 rounded-lg font-medium transition disabled:opacity-50"
          >
            Cerrar
          </button>

          <button
            type="button"
            disabled={isRunning || tasks.length === 0 || voicesForLang.length === 0}
            onClick={startBatch}
            className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold px-4 py-2 rounded-lg transition flex items-center gap-2 shadow-lg shadow-indigo-600/20"
          >
            {isRunning ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Procesando lote…</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4 fill-current" />
                <span>Iniciar doblaje en lote</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
