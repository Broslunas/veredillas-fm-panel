'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { Languages, AlertCircle, CheckCircle2, ChevronRight, FileAudio, ExternalLink } from 'lucide-react';

interface MissingTranscriptionsWidgetProps {
  episodes: any[];
}

export const TARGET_LANGUAGES = [
  { code: 'es', label: 'Español (Original)' },
  { code: 'en', label: 'Inglés' },
  { code: 'fr', label: 'Francés' },
  { code: 'de', label: 'Alemán' },
  { code: 'it', label: 'Italiano' },
  { code: 'pt', label: 'Portugués' },
  { code: 'ca', label: 'Catalán' },
  { code: 'eu', label: 'Euskera' },
  { code: 'gl', label: 'Gallego' },
  { code: 'zh', label: 'Chino' },
  { code: 'ja', label: 'Japonés' },
];

export default function MissingTranscriptionsWidget({ episodes }: MissingTranscriptionsWidgetProps) {
  const [selectedLang, setSelectedLang] = useState<string>('es');

  // Evaluar episodios que carecen de la transcripción / doblaje en el idioma seleccionado
  const missingEpisodes = useMemo(() => {
    return episodes.filter((ep) => {
      // Ignorar borrados o episodios sin audios/videos si procede, o filtrar todos
      if (selectedLang === 'es') {
        // En español se comprueba la transcripción base
        return !ep.transcription || !Array.isArray(ep.transcription) || ep.transcription.length === 0;
      }

      // En otros idiomas se comprueba si existe un dub listo o con progreso en ese idioma
      const dubs = Array.isArray(ep.dubs) ? ep.dubs : [];
      const hasDub = dubs.some(
        (d: any) =>
          d.lang === selectedLang ||
          d.lang?.startsWith(`${selectedLang}-`)
      );

      return !hasDub;
    });
  }, [episodes, selectedLang]);

  const currentLangLabel = TARGET_LANGUAGES.find((l) => l.code === selectedLang)?.label || selectedLang;

  return (
    <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-xl p-5 space-y-4">
      {/* Encabezado */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-800/60 pb-3">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
            <Languages className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
              <span>Auditoría de Transcripciones y Doblajes</span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-950/60 border border-amber-800/60 text-amber-400">
                {missingEpisodes.length} pendientes
              </span>
            </h2>
            <p className="text-xs text-zinc-400">
              Episodios que no tienen transcripción ni pista en el idioma seleccionado
            </p>
          </div>
        </div>

        {/* Selector de idioma */}
        <div className="flex items-center gap-2 shrink-0">
          <label htmlFor="missing-lang-select" className="text-xs text-zinc-400 font-medium">
            Idioma:
          </label>
          <select
            id="missing-lang-select"
            value={selectedLang}
            onChange={(e) => setSelectedLang(e.target.value)}
            className="bg-zinc-900 border border-zinc-700 text-zinc-200 text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-indigo-500 transition"
          >
            {TARGET_LANGUAGES.map((lang) => (
              <option key={lang.code} value={lang.code}>
                {lang.label} ({lang.code.toUpperCase()})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Lista de episodios faltantes */}
      {missingEpisodes.length === 0 ? (
        <div className="p-6 border border-emerald-900/30 bg-emerald-950/10 rounded-xl flex items-center justify-center gap-2 text-emerald-400 text-xs font-mono">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>¡Genial! Todos los episodios cuentan con transcripción/doblaje en {currentLangLabel}.</span>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="max-h-72 overflow-y-auto pr-1 space-y-2 divide-y divide-zinc-800/40">
            {missingEpisodes.slice(0, 10).map((ep) => (
              <div
                key={ep._id}
                className="pt-2 first:pt-0 flex items-center justify-between gap-3 hover:bg-zinc-800/40 p-2 rounded-lg transition"
              >
                <div className="flex items-center gap-3 min-w-0">
                  {ep.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={ep.image}
                      alt={ep.title}
                      className="w-9 h-9 rounded-md object-cover bg-zinc-950 border border-zinc-800 shrink-0"
                    />
                  ) : (
                    <div className="w-9 h-9 rounded-md bg-zinc-800 flex items-center justify-center text-zinc-400 shrink-0">
                      <FileAudio className="w-4 h-4" />
                    </div>
                  )}

                  <div className="min-w-0">
                    <p className="text-xs font-medium text-zinc-200 truncate">{ep.title}</p>
                    <p className="text-[11px] text-zinc-500 font-mono truncate">
                      {ep.slug} &bull; {ep.status === 'draft' ? 'Borrador' : 'Publicado'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-red-950/50 border border-red-800/50 text-red-400 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    Sin {selectedLang.toUpperCase()}
                  </span>
                  <Link
                    href={`/episodes/${ep._id}`}
                    className="text-xs text-indigo-400 hover:text-indigo-300 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/20 px-2.5 py-1.5 rounded-md transition flex items-center gap-1 font-medium"
                  >
                    <span>Editar</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </div>
            ))}
          </div>

          {missingEpisodes.length > 10 && (
            <p className="text-[11px] text-zinc-500 text-center font-mono pt-2">
              Mostrando 10 de {missingEpisodes.length} episodios pendientes en {currentLangLabel}.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
