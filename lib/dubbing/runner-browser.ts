import { assembleDubTimeline, DEFAULT_DUB_SAMPLE_RATE } from '@/lib/dubbing/timeline';
import { parseWavArrayBuffer } from '@/lib/dubbing/wav-browser';
import { encodePcmToMp3 } from '@/lib/audio-extraction';
import { uploadFileToR2ViaPresignedUrl } from '@/lib/r2-client';

export interface RunDubPipelineCallbacks {
  onProgress?: (progress: { stage: string; percent: number | null; detail: string }) => void;
}

export interface PreferredVoices {
  masculine?: string;
  feminine?: string;
  default?: string;
}

async function postJson(url: string, body: any) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Error de red');
  return data;
}

/**
 * Assembles and uploads dubbed MP3 in the browser.
 */
export async function assembleAndUploadDubClient(
  episodeId: string,
  episodeSlug: string,
  lang: string,
  onProgress?: (progress: { stage: string; percent: number | null; detail: string }) => void
): Promise<{ url: string; maxDriftSeconds: number }> {
  const prep = await postJson('/api/admin/dubbing/finalize', { episodeId, lang });
  const segments: { index: number; start: number; url: string }[] = prep.segments;
  const sourceDuration: number = prep.sourceDuration;

  const buffers: (ArrayBuffer | null)[] = new Array(segments.length).fill(null);
  let downloaded = 0;
  let nextToFetch = 0;
  const concurrency = 8;

  async function downloadWorker() {
    for (;;) {
      const i = nextToFetch++;
      if (i >= segments.length) return;
      const res = await fetch(segments[i].url);
      if (!res.ok) throw new Error(`No se pudo descargar el segmento ${segments[i].index}`);
      buffers[i] = await res.arrayBuffer();
      downloaded++;
      onProgress?.({
        stage: 'finalizing',
        percent: Math.round((downloaded / segments.length) * 40),
        detail: `Descargando segmentos sintetizados… (${downloaded}/${segments.length})`,
      });
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, segments.length) }, downloadWorker));

  onProgress?.({ stage: 'finalizing', percent: 40, detail: 'Ajustando sincronización de segmentos…' });
  const { pcm, maxDriftSeconds, placements } = assembleDubTimeline(
    segments.map((s, i) => ({
      index: s.index,
      start: s.start,
      samples: parseWavArrayBuffer(buffers[i]!).samples,
    })),
    DEFAULT_DUB_SAMPLE_RATE,
    sourceDuration
  );

  const floatPcm = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) floatPcm[i] = pcm[i] / 32768;

  const mp3Blob = await encodePcmToMp3({ left: floatPcm, sampleRate: DEFAULT_DUB_SAMPLE_RATE }, (percent) => {
    onProgress?.({
      stage: 'finalizing',
      percent: 40 + Math.round(percent * 0.4),
      detail: `Codificando el audio final a MP3… ${percent}%`,
    });
  });

  const baseName = `${episodeSlug}-dub-${lang}`;
  const mp3File = new File([mp3Blob], `${baseName}.mp3`, { type: 'audio/mpeg' });
  const publicUrl = await uploadFileToR2ViaPresignedUrl(mp3File, {
    folder: 'audios/dubs',
    target: 'audio',
    entityId: baseName,
    onProgress: (percent) => {
      onProgress?.({
        stage: 'finalizing',
        percent: 80 + Math.round(percent * 0.2),
        detail: `Subiendo audio final… ${percent}%`,
      });
    },
  });

  const duration = pcm.length / DEFAULT_DUB_SAMPLE_RATE;
  await postJson('/api/admin/dubbing/finalize-complete', {
    episodeId,
    lang,
    url: publicUrl,
    duration,
    maxDriftSeconds,
    placements,
  });

  return { url: publicUrl, maxDriftSeconds };
}

/**
 * Runs the complete automated dubbing pipeline for an episode.
 */
export async function runFullDubbingPipeline(
  episodeId: string,
  episodeSlug: string,
  lang: string,
  label: string,
  customVoiceMap?: Record<string, string>,
  callbacks?: RunDubPipelineCallbacks
): Promise<{ url: string; maxDriftSeconds: number }> {
  const onProgress = callbacks?.onProgress;

  onProgress?.({ stage: 'transcribing', percent: null, detail: 'Transcribiendo y segmentando audio original…' });
  const startRes = await postJson('/api/admin/dubbing/start', { episodeId, lang, label });

  const finalVoiceMap = customVoiceMap && Object.keys(customVoiceMap).length > 0
    ? customVoiceMap
    : startRes.voiceMap;

  if (finalVoiceMap && Object.keys(finalVoiceMap).length > 0) {
    onProgress?.({ stage: 'configuring', percent: null, detail: 'Configurando asignación de voces…' });
    await postJson('/api/admin/dubbing/set-voices', { episodeId, lang, voiceMap: finalVoiceMap });
  }

  for (;;) {
    const res = await postJson('/api/admin/dubbing/translate-batch', { episodeId, lang, batchSize: 25 });
    onProgress?.({
      stage: 'translating',
      percent: res.totalCount ? Math.round((res.translatedCount / res.totalCount) * 100) : null,
      detail: `${res.translatedCount}/${res.totalCount} segmentos traducidos`,
    });
    if (res.done) break;
  }

  for (;;) {
    const res = await postJson('/api/admin/dubbing/synthesize-batch', { episodeId, lang, batchSize: 5 });
    const errCount = res.errors?.length ? res.errors.length : 0;
    onProgress?.({
      stage: 'synthesizing',
      percent: res.totalCount ? Math.round((res.synthesizedCount / res.totalCount) * 100) : null,
      detail: `${res.synthesizedCount}/${res.totalCount} segmentos sintetizados${errCount ? ` · ${errCount} con error` : ''}`,
    });
    if (res.done) break;
  }

  onProgress?.({ stage: 'finalizing', percent: 0, detail: 'Ensamblando y subiendo audio final…' });
  return await assembleAndUploadDubClient(episodeId, episodeSlug, lang, onProgress);
}
