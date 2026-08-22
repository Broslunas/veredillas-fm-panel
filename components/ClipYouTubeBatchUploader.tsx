'use client';

import React, { useEffect, useRef, useState } from 'react';
import { UploadCloud, Trash2, Loader2, CheckCircle2, AlertCircle, RefreshCw, Video, ImageOff } from 'lucide-react';

interface ClipUploadItem {
  id: string;
  file: File;
  title: string;
  status: 'pending' | 'uploading' | 'success' | 'error';
  progress: number;
  error?: string;
  url?: string;
  thumbnailUrl?: string;
  thumbnailError?: string;
  generatingThumbnail?: boolean;
}

interface ClipYouTubeBatchUploaderProps {
  onUploaded: (clip: { title: string; url: string; thumbnailUrl?: string }) => void;
}

/**
 * Captura un frame del vídeo (al 10% de su duración, o al segundo 1 si no hay
 * duración fiable) y lo convierte en un JPEG para usarlo como miniatura.
 */
function captureThumbnail(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const videoEl = document.createElement('video');
    videoEl.preload = 'metadata';
    videoEl.muted = true;
    videoEl.playsInline = true;

    const objectUrl = URL.createObjectURL(file);
    const cleanup = () => URL.revokeObjectURL(objectUrl);

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Tiempo de espera agotado generando la miniatura.'));
    }, 15000);

    videoEl.onloadedmetadata = () => {
      const duration = Number.isFinite(videoEl.duration) ? videoEl.duration : 1;
      videoEl.currentTime = Math.min(1, duration * 0.1) || 0.1;
    };

    videoEl.onseeked = () => {
      clearTimeout(timeout);
      try {
        const canvas = document.createElement('canvas');
        canvas.width = videoEl.videoWidth || 640;
        canvas.height = videoEl.videoHeight || 360;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('No se pudo crear el contexto de canvas.');
        ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          (blob) => {
            cleanup();
            if (blob) resolve(blob);
            else reject(new Error('No se pudo generar la miniatura.'));
          },
          'image/jpeg',
          0.85
        );
      } catch (err) {
        cleanup();
        reject(err instanceof Error ? err : new Error('Error generando la miniatura.'));
      }
    };

    videoEl.onerror = () => {
      clearTimeout(timeout);
      cleanup();
      reject(new Error('No se pudo leer el vídeo para generar la miniatura.'));
    };

    videoEl.src = objectUrl;
  });
}

export default function ClipYouTubeBatchUploader({ onUploaded }: ClipYouTubeBatchUploaderProps) {
  const [items, setItems] = useState<ClipUploadItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const itemsRef = useRef<ClipUploadItem[]>([]);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const handleFilesSelected = (files: FileList | null) => {
    if (!files) return;
    const newItems: ClipUploadItem[] = Array.from(files)
      .filter((f) => f.type.startsWith('video/'))
      .map((f) => ({
        id: `${f.name}-${f.size}-${Math.random().toString(36).slice(2)}`,
        file: f,
        title: f.name.replace(/\.[^/.]+$/, ''),
        status: 'pending',
        progress: 0,
      }));

    if (newItems.length === 0) {
      alert('Por favor selecciona archivos de vídeo válidos.');
    }

    setItems((prev) => [...prev, ...newItems]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const updateItem = (id: string, patch: Partial<ClipUploadItem>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
  };

  const uploadItem = async (item: ClipUploadItem) => {
    updateItem(item.id, { status: 'uploading', progress: 0, error: undefined });

    try {
      const finalTitle = item.title.trim() || item.file.name.replace(/\.[^/.]+$/, '');

      const presignRes = await fetch('/api/admin/r2-presign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: item.file.name,
          contentType: item.file.type || 'video/mp4',
          folder: 'social-clips',
          target: 'video',
          fileSize: item.file.size,
        }),
      });

      const presignData = await presignRes.json();
      if (!presignRes.ok || !presignData.presignedUrl) {
        throw new Error(presignData.error || 'No se pudo iniciar la subida a R2.');
      }

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', presignData.presignedUrl, true);
        xhr.setRequestHeader('Content-Type', item.file.type || 'video/mp4');

        xhr.upload.onprogress = (evt) => {
          if (evt.lengthComputable) {
            updateItem(item.id, { progress: Math.round((evt.loaded / evt.total) * 100) });
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error(`Error al subir el vídeo a R2 (HTTP ${xhr.status}).`));
        };

        xhr.onerror = () => reject(new Error('Error de conexión durante la subida a R2.'));
        xhr.send(item.file);
      });

      const url = presignData.publicUrl as string;
      updateItem(item.id, { url, generatingThumbnail: true });

      // El vídeo ya está a salvo en R2; la miniatura es un extra, no bloquea el éxito.
      let thumbnailUrl: string | undefined;
      try {
        const thumbBlob = await captureThumbnail(item.file);
        const thumbFileName = `${item.file.name.replace(/\.[^/.]+$/, '')}-thumb.jpg`;

        const thumbPresignRes = await fetch('/api/admin/r2-presign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileName: thumbFileName,
            contentType: 'image/jpeg',
            folder: 'social-clips',
            target: 'image',
            fileSize: thumbBlob.size,
          }),
        });

        const thumbPresignData = await thumbPresignRes.json();
        if (!thumbPresignRes.ok || !thumbPresignData.presignedUrl) {
          throw new Error(thumbPresignData.error || 'No se pudo iniciar la subida de la miniatura.');
        }

        const putRes = await fetch(thumbPresignData.presignedUrl, {
          method: 'PUT',
          headers: { 'Content-Type': 'image/jpeg' },
          body: thumbBlob,
        });
        if (!putRes.ok) throw new Error(`Error al subir la miniatura a R2 (HTTP ${putRes.status}).`);

        thumbnailUrl = thumbPresignData.publicUrl as string;
        updateItem(item.id, { thumbnailUrl, generatingThumbnail: false });
      } catch (thumbErr) {
        const thumbMessage = thumbErr instanceof Error ? thumbErr.message : 'Error generando la miniatura.';
        updateItem(item.id, { thumbnailError: thumbMessage, generatingThumbnail: false });
      }

      updateItem(item.id, { status: 'success', progress: 100, url });
      onUploaded({ title: finalTitle, url, thumbnailUrl });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al subir el vídeo.';
      updateItem(item.id, { status: 'error', error: message });
    }
  };

  const uploadAll = async () => {
    setIsProcessing(true);
    const idsToProcess = items
      .filter((it) => it.status === 'pending' || it.status === 'error')
      .map((it) => it.id);

    for (const id of idsToProcess) {
      const current = itemsRef.current.find((it) => it.id === id);
      if (!current) continue;
      await uploadItem(current);
    }

    setIsProcessing(false);
  };

  const hasUploadable = items.some((it) => it.status === 'pending' || it.status === 'error');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
            <Video className="w-4 h-4 text-indigo-400" />
            <span>Subir Clips desde tu Ordenador a R2</span>
          </h3>
          <p className="text-xs text-zinc-400">
            Selecciona varios vídeos a la vez, edita el título de cada uno, y súbelos a R2 de uno en uno.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isProcessing}
            className="bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed text-zinc-200 text-xs font-medium px-3 py-1.5 rounded-lg transition flex items-center gap-1.5"
          >
            <UploadCloud className="w-4 h-4 text-indigo-400" />
            <span>Seleccionar Vídeos</span>
          </button>

          {hasUploadable && (
            <button
              type="button"
              onClick={uploadAll}
              disabled={isProcessing}
              className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold px-3 py-1.5 rounded-lg transition flex items-center gap-1.5"
            >
              {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Video className="w-4 h-4" />}
              <span>{isProcessing ? 'Subiendo...' : 'Subir a R2 (uno a uno)'}</span>
            </button>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="video/*"
          multiple
          className="hidden"
          onChange={(e) => handleFilesSelected(e.target.files)}
        />
      </div>

      {items.length > 0 && (
        <div className="space-y-2">
          {items.map((item) => (
            <div key={item.id} className="bg-zinc-950 border border-zinc-800/80 rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  type="text"
                  value={item.title}
                  onChange={(e) => updateItem(item.id, { title: e.target.value })}
                  disabled={item.status === 'uploading' || item.status === 'success'}
                  placeholder="Título del clip"
                  className="flex-1 min-w-[160px] bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-xs text-zinc-100 disabled:opacity-60 focus:outline-none focus:border-zinc-600"
                />

                {item.status === 'pending' && (
                  <button
                    type="button"
                    onClick={() => removeItem(item.id)}
                    className="p-1 text-zinc-500 hover:text-red-400 transition"
                    title="Quitar de la lista"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}

                {item.status === 'error' && (
                  <button
                    type="button"
                    onClick={() => uploadItem(item)}
                    disabled={isProcessing}
                    className="p-1 text-amber-400 hover:text-amber-300 transition disabled:opacity-50"
                    title="Reintentar subida"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                )}

                {item.status === 'uploading' && <Loader2 className="w-4 h-4 text-indigo-400 animate-spin shrink-0" />}
                {item.status === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />}
              </div>

              <div className="flex items-center gap-2 text-[11px] font-mono text-zinc-500">
                <span className="truncate max-w-[240px]">{item.file.name}</span>
                <span>({(item.file.size / (1024 * 1024)).toFixed(1)} MB)</span>
              </div>

              {item.status === 'uploading' && (
                <div className="w-full bg-zinc-900 border border-zinc-800 h-2 rounded-full overflow-hidden">
                  <div
                    className="bg-indigo-500 h-full rounded-full transition-all duration-300"
                    style={{ width: `${item.progress}%` }}
                  />
                </div>
              )}

              {item.status === 'success' && item.url && (
                <div className="flex items-center gap-2">
                  {item.generatingThumbnail ? (
                    <div
                      className="w-10 h-10 rounded border border-zinc-800 bg-zinc-900 flex items-center justify-center shrink-0"
                      title="Generando miniatura..."
                    >
                      <Loader2 className="w-3.5 h-3.5 text-indigo-400 animate-spin" />
                    </div>
                  ) : item.thumbnailUrl ? (
                    <a
                      href={item.thumbnailUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="relative w-10 h-10 rounded border border-emerald-800/60 overflow-hidden shrink-0"
                      title="Miniatura subida a R2 (clic para ver a tamaño completo)"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={item.thumbnailUrl} alt="Miniatura del clip" className="w-full h-full object-cover" />
                      <CheckCircle2 className="w-3 h-3 text-emerald-400 bg-zinc-950 rounded-full absolute -bottom-0.5 -right-0.5" />
                    </a>
                  ) : (
                    <div
                      className="w-10 h-10 rounded border border-amber-900/60 bg-zinc-900 flex items-center justify-center shrink-0"
                      title={item.thumbnailError || 'Sin miniatura'}
                    >
                      <ImageOff className="w-3.5 h-3.5 text-amber-500" />
                    </div>
                  )}

                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] font-mono text-emerald-400 hover:underline truncate flex-1 min-w-0"
                  >
                    {item.url}
                  </a>
                </div>
              )}

              {item.status === 'success' && item.thumbnailError && (
                <div className="flex items-center gap-1.5 text-[11px] text-amber-400">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>Vídeo subido correctamente, pero la miniatura falló: {item.thumbnailError}</span>
                </div>
              )}

              {item.status === 'error' && item.error && (
                <div className="flex items-center gap-1.5 text-[11px] text-red-400">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>{item.error}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
