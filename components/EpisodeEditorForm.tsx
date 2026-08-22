'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import R2Uploader from '@/components/R2Uploader';
import ParticipantsPicker from '@/components/ParticipantsPicker';
import ClipYouTubeBatchUploader from '@/components/ClipYouTubeBatchUploader';
import AudioExtractionProgress from '@/components/AudioExtractionProgress';
import DubbingManager from '@/components/DubbingManager';
import { uploadFileToR2ViaPresignedUrl } from '@/lib/r2-client';
import { ExtractionProgress, extractMp3FromVideoFile, extractMp3FromVideoUrl } from '@/lib/audio-extraction';
import { useAutoSaveDraft } from '@/lib/useAutoSaveDraft';
import AutoSaveDraftBanner from '@/components/AutoSaveDraftBanner';
import AutoSaveStatus from '@/components/AutoSaveStatus';
import {
  Save,
  ArrowLeft,
  Plus,
  Trash2,
  List,
  MessageSquare,
  Video,
  HelpCircle,
  Radio,
  Loader2,
  CheckCircle2,
  XCircle,
  Undo2,
  Sparkles,
  Music,
  Users,
  Play,
  ChevronLeft,
  ChevronRight,
  UserCheck,
  AlertCircle,
  Languages,
  ImageOff,
} from 'lucide-react';

const CHAPTER_TIME_REGEX = /^(\d{1,2}:)?\d{1,2}:\d{2}$/;

function slugifyValue(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// Speaker identification helpers
const GENERIC_SPEAKER_REGEX = /^hablante\s*\d+$/i;
const SPEAKER_COLORS = [
  { dot: 'bg-indigo-500', ring: 'border-indigo-500/60', text: 'text-indigo-300', chip: 'bg-indigo-950/60 border-indigo-800/60' },
  { dot: 'bg-emerald-500', ring: 'border-emerald-500/60', text: 'text-emerald-300', chip: 'bg-emerald-950/60 border-emerald-800/60' },
  { dot: 'bg-amber-500', ring: 'border-amber-500/60', text: 'text-amber-300', chip: 'bg-amber-950/60 border-amber-800/60' },
  { dot: 'bg-rose-500', ring: 'border-rose-500/60', text: 'text-rose-300', chip: 'bg-rose-950/60 border-rose-800/60' },
  { dot: 'bg-cyan-500', ring: 'border-cyan-500/60', text: 'text-cyan-300', chip: 'bg-cyan-950/60 border-cyan-800/60' },
  { dot: 'bg-fuchsia-500', ring: 'border-fuchsia-500/60', text: 'text-fuchsia-300', chip: 'bg-fuchsia-950/60 border-fuchsia-800/60' },
  { dot: 'bg-lime-500', ring: 'border-lime-500/60', text: 'text-lime-300', chip: 'bg-lime-950/60 border-lime-800/60' },
  { dot: 'bg-orange-500', ring: 'border-orange-500/60', text: 'text-orange-300', chip: 'bg-orange-950/60 border-orange-800/60' },
];

function isGenericSpeakerLabel(label: string): boolean {
  return GENERIC_SPEAKER_REGEX.test(label.trim());
}

// Small AI-generate affordance shown next to a field's label. `error` is the
// "you need to fill in X first" hint (or a request failure) rendered under
// the field when generation isn't possible yet.
function AiFieldButton({ loading, onClick }: { loading: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="inline-flex items-center gap-1 text-[10px] font-mono font-semibold text-indigo-400 hover:text-indigo-300 disabled:opacity-50 transition shrink-0"
      title="Generar con IA"
    >
      {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
      <span>IA</span>
    </button>
  );
}

function AiFieldHint({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className="text-[11px] text-amber-400 mt-1">{message}</p>;
}

function timeStrToSeconds(time: string): number {
  const parts = (time || '0:00').split(':').map((p) => parseInt(p, 10));
  const nums = parts.map((p) => (Number.isNaN(p) ? 0 : p));
  if (nums.length === 3) return nums[0] * 3600 + nums[1] * 60 + nums[2];
  if (nums.length === 2) return nums[0] * 60 + nums[1];
  return nums[0] || 0;
}

interface EpisodeEditorProps {
  initialData?: any;
  isEdit?: boolean;
}

type TabType = 'general' | 'media' | 'sections' | 'transcript' | 'clips' | 'quiz' | 'dubbing';
const VALID_TABS: TabType[] = ['general', 'media', 'sections', 'transcript', 'clips', 'quiz'];

interface AudioExtractionUiState {
  active: boolean;
  source: 'upload' | 'existing' | null;
  progress: ExtractionProgress | null;
  error: string | null;
  successMessage: string | null;
}

export default function EpisodeEditorForm({ initialData, isEdit = false }: EpisodeEditorProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const tabQuery = searchParams.get('tab') as TabType | null;
  const initialTab: TabType = tabQuery && VALID_TABS.includes(tabQuery) ? tabQuery : 'general';

  const [activeTab, setActiveTab] = useState<TabType>(initialTab);

  useEffect(() => {
    if (tabQuery && VALID_TABS.includes(tabQuery) && tabQuery !== activeTab) {
      setActiveTab(tabQuery);
    }
  }, [tabQuery]);

  const changeTab = (newTab: TabType) => {
    setActiveTab(newTab);
    const params = new URLSearchParams(searchParams ? searchParams.toString() : '');
    params.set('tab', newTab);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const [saving, setSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Audio extraction pipeline state, shared by both the auto-extraction
  // (right after a fresh video upload) and the manual "extract from an
  // already-uploaded video" flow.
  const [audioExtraction, setAudioExtraction] = useState<AudioExtractionUiState>({
    active: false,
    source: null,
    progress: null,
    error: null,
    successMessage: null,
  });

  // Deepgram AI Transcription States
  const [deepgramLoading, setDeepgramLoading] = useState(false);
  const [deepgramStatus, setDeepgramStatus] = useState('');
  const [deepgramError, setDeepgramError] = useState<string | null>(null);
  const [generatedSubtitles, setGeneratedSubtitles] = useState<{ srt: string; vtt: string } | null>(null);
  const [copiedSrt, setCopiedSrt] = useState(false);

  // Speaker identification: media player + per-speaker preview cursor
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [speakerPreviewIndex, setSpeakerPreviewIndex] = useState<Record<string, number>>({});
  const [activeSpeakerLabel, setActiveSpeakerLabel] = useState<string | null>(null);

  // Gemini AI per-field content generation state: one loading/error slot per
  // generatable field, since each field is now generated independently.
  type AiFieldKey = 'title' | 'slug' | 'description' | 'tags' | 'participants' | 'warningMessage' | 'body' | 'sections';
  const [fieldAiState, setFieldAiState] = useState<Record<AiFieldKey, { loading: boolean; error: string | null }>>({
    title: { loading: false, error: null },
    slug: { loading: false, error: null },
    description: { loading: false, error: null },
    tags: { loading: false, error: null },
    participants: { loading: false, error: null },
    warningMessage: { loading: false, error: null },
    body: { loading: false, error: null },
    sections: { loading: false, error: null },
  });

  // Gemini AI Quiz Generation States (from transcript + chapters)
  const [quizAiLoading, setQuizAiLoading] = useState(false);
  const [quizAiStatus, setQuizAiStatus] = useState<string | null>(null);
  const [quizAiError, setQuizAiError] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    status: (initialData?.status as 'draft' | 'published') || (isEdit ? 'published' : 'draft'),
    title: initialData?.title || '',
    slug: initialData?.slug || '',
    description: initialData?.description || '',
    pubDate: initialData?.pubDate ? new Date(initialData.pubDate).toISOString().slice(0, 16) : new Date().toISOString().slice(0, 16),
    author: initialData?.author || 'Veredillas FM',
    image: initialData?.image || '',
    audioUrl: initialData?.audioUrl || '',
    duration: initialData?.duration || '',
    season: initialData?.season || '',
    episode: initialData?.episode || '',
    videoUrl: initialData?.videoUrl || '',
    tags: Array.isArray(initialData?.tags) ? initialData.tags.join(', ') : initialData?.tags || '',
    participants: Array.isArray(initialData?.participants) ? initialData.participants.join(', ') : initialData?.participants || '',
    isPremiere: Boolean(initialData?.isPremiere),
    warningMessage: initialData?.warningMessage || '',
    body: initialData?.body || '',
    sections: initialData?.sections || [{ title: '', time: '00:00' }],
    transcription: initialData?.transcription || [{ time: '00:00', text: '', speaker: '' }],
    clips: initialData?.clips || [{ title: '', url: '' }],
    quiz: initialData?.quiz || [{ question: '', options: ['', '', '', ''], correctAnswer: 0 }],
  });

  const {
    lastAutoSavedAt,
    draftAvailable,
    draftSavedAt,
    restoreDraft,
    discardDraft,
    markSaved,
  } = useAutoSaveDraft(`episode:${initialData?._id || 'new'}`, formData);

  const handleRestoreDraft = () => {
    const draft = restoreDraft();
    if (draft) setFormData(draft);
  };

  const handleTitleChange = (val: string) => {
    const updated: any = { title: val };
    if (!isEdit && !formData.slug) {
      updated.slug = slugifyValue(val);
    }
    setFormData((prev) => ({ ...prev, ...updated }));
  };

  const hasTranscript = formData.transcription.some((t: any) => t.text && t.text.trim());
  const hasIdentifiedSpeakers = formData.transcription.some(
    (t: any) => t.speaker && t.speaker.trim() && !isGenericSpeakerLabel(t.speaker)
  );

  // Per-field AI generation: each field lists what other fields it needs
  // filled in first, since there's no longer a single "topic" to work from.
  const getFieldRequirementError = (field: AiFieldKey): string | null => {
    const hasTitle = !!formData.title.trim();
    const hasDescription = !!formData.description.trim();
    const hasBody = !!formData.body.trim();

    switch (field) {
      case 'title':
        return hasDescription || hasBody || hasTranscript
          ? null
          : 'Tienes que rellenar la descripción, las notas del programa o la transcripción para poder generar el título.';
      case 'slug':
        return hasTitle ? null : 'Tienes que rellenar el título para poder generar el slug.';
      case 'description':
        return hasTitle || hasBody || hasTranscript
          ? null
          : 'Tienes que rellenar el título, las notas del programa o la transcripción para poder generar la descripción.';
      case 'tags':
        return hasTitle || hasDescription || hasBody || hasTranscript
          ? null
          : 'Tienes que rellenar el título, la descripción o la transcripción para poder generar las etiquetas.';
      case 'participants':
        return hasIdentifiedSpeakers
          ? null
          : 'Tienes que identificar a los hablantes en la transcripción (pestaña 3) para poder generar los participantes.';
      case 'warningMessage':
        return hasDescription || hasBody || hasTranscript
          ? null
          : 'Tienes que rellenar la descripción, las notas del programa o la transcripción para poder generar el aviso.';
      case 'body':
        return hasTitle || hasDescription || hasTranscript
          ? null
          : 'Tienes que rellenar el título, la descripción o la transcripción para poder generar las notas del programa.';
      case 'sections':
        return hasTranscript ? null : 'Tienes que añadir la transcripción del episodio (pestaña 3) para poder generar los capítulos.';
      default:
        return null;
    }
  };

  const handleGenerateField = async (field: AiFieldKey) => {
    const requirementError = getFieldRequirementError(field);
    if (requirementError) {
      setFieldAiState((prev) => ({ ...prev, [field]: { loading: false, error: requirementError } }));
      return;
    }

    if (field === 'slug') {
      setFormData((prev) => ({ ...prev, slug: slugifyValue(prev.title) }));
      setFieldAiState((prev) => ({ ...prev, slug: { loading: false, error: null } }));
      return;
    }

    setFieldAiState((prev) => ({ ...prev, [field]: { loading: true, error: null } }));

    try {
      const res = await fetch('/api/admin/gemini/generate-episode-field', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          field,
          context: {
            title: formData.title,
            description: formData.description,
            tags: formData.tags,
            participants: formData.participants,
            body: formData.body,
            warningMessage: formData.warningMessage,
            transcription: formData.transcription,
            sections: formData.sections,
          },
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al generar con IA');

      setFormData((prev) => {
        switch (field) {
          case 'tags':
            return { ...prev, tags: Array.isArray(data.value) ? data.value.join(', ') : prev.tags };
          case 'participants':
            return { ...prev, participants: Array.isArray(data.value) ? data.value.join(', ') : prev.participants };
          case 'sections':
            return { ...prev, sections: Array.isArray(data.value) && data.value.length ? data.value : prev.sections };
          default:
            return { ...prev, [field]: typeof data.value === 'string' ? data.value : (prev as any)[field] };
        }
      });
      setFieldAiState((prev) => ({ ...prev, [field]: { loading: false, error: null } }));
    } catch (err: any) {
      setFieldAiState((prev) => ({ ...prev, [field]: { loading: false, error: err.message || 'Error al generar con IA' } }));
    }
  };

  const handleGenerateQuizWithAI = async () => {
    const hasTranscript = formData.transcription.some((t: any) => t.text && t.text.trim());
    if (!hasTranscript) {
      setQuizAiError('Añade primero la transcripción del episodio (pestaña 3) para poder generar el quiz con IA.');
      return;
    }

    setQuizAiError(null);
    setQuizAiStatus('Analizando la transcripción y los capítulos con Gemini AI...');
    setQuizAiLoading(true);

    try {
      const res = await fetch('/api/admin/gemini/generate-quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: formData.title,
          transcription: formData.transcription,
          sections: formData.sections,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al generar el quiz con IA');

      setFormData((prev) => ({
        ...prev,
        quiz: Array.isArray(data.quiz) && data.quiz.length ? data.quiz : prev.quiz,
      }));
      setQuizAiStatus('¡Quiz generado a partir de la transcripción! Revisa las preguntas antes de guardar.');
    } catch (err: any) {
      setQuizAiError(err.message || 'Error al generar el quiz con IA');
      setQuizAiStatus(null);
    } finally {
      setQuizAiLoading(false);
    }
  };

  const uploadR2File = async (
    file: File,
    folder: string,
    target: 'audio' | 'video',
    entityId?: string,
    onProgress?: (percent: number) => void
  ) => {
    return uploadFileToR2ViaPresignedUrl(file, { folder, target, entityId, onProgress });
  };

  const uploadExtractedAudio = async (
    audioBlob: Blob,
    fileName: string,
    onProgress: (progress: ExtractionProgress) => void
  ): Promise<string> => {
    const audioFile = new File([audioBlob], fileName, { type: 'audio/mpeg' });
    const startTime = performance.now();
    return uploadR2File(audioFile, 'audios', 'audio', formData.slug, (percent) => {
      const elapsedSeconds = (performance.now() - startTime) / 1000;
      const etaSeconds = percent > 0 ? (elapsedSeconds / percent) * (100 - percent) : null;
      onProgress({
        stage: 'uploading',
        percent,
        etaSeconds,
        loadedBytes: Math.round((percent / 100) * audioFile.size),
        totalBytes: audioFile.size,
      });
    });
  };

  const handleExtractAudioFromUploadedVideo = async () => {
    if (!formData.videoUrl) {
      setAudioExtraction({ active: false, source: null, progress: null, error: 'Primero sube un vídeo o añade su URL.', successMessage: null });
      return;
    }

    setAudioExtraction({ active: true, source: 'existing', progress: null, error: null, successMessage: null });
    const onProgress = (progress: ExtractionProgress) => setAudioExtraction((prev) => ({ ...prev, progress }));

    try {
      const presignRes = await fetch(`/api/admin/r2-presign-download?url=${encodeURIComponent(formData.videoUrl)}`);
      if (!presignRes.ok) {
        const data = await presignRes.json().catch(() => null);
        throw new Error(data?.error || 'No se pudo generar la URL de descarga del vídeo');
      }
      const { presignedUrl } = await presignRes.json();

      // Downloaded directly from R2 by the browser (not proxied through Vercel)
      // to avoid burning serverless bandwidth on large video files.
      const audioBlob = await extractMp3FromVideoUrl(presignedUrl, onProgress);

      const baseName = formData.slug || 'episodio';
      const audioUrl = await uploadExtractedAudio(audioBlob, `${baseName}.mp3`, onProgress);

      setFormData((prev) => ({ ...prev, audioUrl }));
      setAudioExtraction({
        active: false,
        source: null,
        progress: null,
        error: null,
        successMessage: 'Audio extraído y subido correctamente.',
      });
    } catch (error: any) {
      console.error(error);
      setAudioExtraction({
        active: false,
        source: null,
        progress: null,
        error: error.message || 'Error al extraer el audio del vídeo.',
        successMessage: null,
      });
    }
  };

  const handleSubmit = async (e: React.SyntheticEvent, statusOverride?: 'draft' | 'published') => {
    e.preventDefault();
    setSaving(true);
    setSuccessMessage(null);
    setErrorMessage(null);

    const nextStatus = statusOverride || formData.status;
    if (statusOverride) {
      setFormData((prev) => ({ ...prev, status: statusOverride }));
    }

    const payload = {
      ...formData,
      status: nextStatus,
      season: formData.season ? Number(formData.season) : undefined,
      episode: formData.episode ? Number(formData.episode) : undefined,
      tags: typeof formData.tags === 'string' ? formData.tags.split(',').map((t) => t.trim()).filter(Boolean) : formData.tags,
      participants: typeof formData.participants === 'string' ? formData.participants.split(',').map((p) => p.trim()).filter(Boolean) : formData.participants,
      sections: formData.sections.filter((s: any) => s.title.trim() !== ''),
      transcription: formData.transcription.filter((t: any) => t.text.trim() !== ''),
      clips: formData.clips.filter((c: any) => c.title.trim() !== '' && c.url.trim() !== ''),
      quiz: formData.quiz.filter((q: any) => q.question.trim() !== ''),
    };

    try {
      const url = isEdit ? `/api/episodes/${initialData._id}` : '/api/episodes';
      const method = isEdit ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al guardar el episodio');

      markSaved();
      setSuccessMessage(isEdit ? 'Episodio actualizado con éxito' : 'Episodio creado con éxito');
      setTimeout(() => {
        router.push('/episodes');
      }, 1000);
    } catch (err: any) {
      setErrorMessage(err.message || 'Error al guardar el episodio');
    } finally {
      setSaving(false);
    }
  };

  // Section helpers
  const addSection = () => {
    setFormData((prev) => ({
      ...prev,
      sections: [...prev.sections, { title: '', time: '00:00' }],
    }));
  };

  const removeSection = (idx: number) => {
    setFormData((prev) => ({
      ...prev,
      sections: prev.sections.filter((_: any, i: number) => i !== idx),
    }));
  };

  const updateSection = (idx: number, field: string, val: string) => {
    setFormData((prev) => {
      const copy = [...prev.sections];
      copy[idx] = { ...copy[idx], [field]: val };
      return { ...prev, sections: copy };
    });
  };

  // Transcription helpers
  const addTranscription = () => {
    setFormData((prev) => ({
      ...prev,
      transcription: [...prev.transcription, { time: '00:00', text: '', speaker: '' }],
    }));
  };

  const removeTranscription = (idx: number) => {
    setFormData((prev) => ({
      ...prev,
      transcription: prev.transcription.filter((_: any, i: number) => i !== idx),
    }));
  };

  const updateTranscription = (idx: number, field: string, val: string) => {
    setFormData((prev) => {
      const copy = [...prev.transcription];
      copy[idx] = { ...copy[idx], [field]: val };
      return { ...prev, transcription: copy };
    });
  };

  // Groups every transcription line by its current "speaker" label, in order
  // of first appearance, so the identification panel lists each distinct
  // person who speaks instead of raw "Hablante 0/1/2..." rows.
  const speakerGroups = useMemo(() => {
    const map = new Map<string, { label: string; count: number; segments: { time: string; idx: number }[] }>();
    formData.transcription.forEach((tr: any, idx: number) => {
      const label = (tr.speaker || '').trim();
      if (!label) return;
      if (!map.has(label)) map.set(label, { label, count: 0, segments: [] });
      const group = map.get(label)!;
      group.count += 1;
      group.segments.push({ time: tr.time, idx });
    });
    return Array.from(map.values());
  }, [formData.transcription]);

  const speakerColorMap = useMemo(() => {
    const colors: Record<string, (typeof SPEAKER_COLORS)[number]> = {};
    speakerGroups.forEach((group, i) => {
      colors[group.label] = SPEAKER_COLORS[i % SPEAKER_COLORS.length];
    });
    return colors;
  }, [speakerGroups]);

  const participantSuggestions = useMemo(
    () =>
      String(formData.participants || '')
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean),
    [formData.participants]
  );

  // Seeks the episode's video (falls back to audio) to a given timestamp and
  // plays it, so the admin can watch/listen and identify who is speaking.
  const seekTo = (seconds: number) => {
    const el: HTMLMediaElement | null = formData.videoUrl ? videoRef.current : audioRef.current;
    if (!el) return;
    el.currentTime = seconds;
    el.play().catch(() => {});
  };

  const playSpeakerSegment = (label: string, segmentIdx: number) => {
    const group = speakerGroups.find((g) => g.label === label);
    const segment = group?.segments[segmentIdx];
    if (!segment) return;
    setActiveSpeakerLabel(label);
    seekTo(timeStrToSeconds(segment.time));
  };

  // Renames a speaker label across every transcription line at once, so
  // identifying one intervention updates every line where that person speaks.
  const renameSpeaker = (oldLabel: string, newLabel: string) => {
    const trimmed = newLabel.trim();
    if (!trimmed || trimmed === oldLabel) return;
    setFormData((prev) => ({
      ...prev,
      transcription: prev.transcription.map((t: any) =>
        (t.speaker || '').trim() === oldLabel ? { ...t, speaker: trimmed } : t
      ),
    }));
  };

  // Clips helpers
  const addClip = () => {
    setFormData((prev) => ({
      ...prev,
      clips: [...prev.clips, { title: '', url: '' }],
    }));
  };

  const removeClip = (idx: number) => {
    setFormData((prev) => ({
      ...prev,
      clips: prev.clips.filter((_: any, i: number) => i !== idx),
    }));
  };

  const updateClip = (idx: number, field: string, val: string) => {
    setFormData((prev) => {
      const copy = [...prev.clips];
      copy[idx] = { ...copy[idx], [field]: val };
      return { ...prev, clips: copy };
    });
  };

  const handleClipUploaded = (clip: { title: string; url: string; thumbnailUrl?: string }) => {
    setFormData((prev) => ({
      ...prev,
      clips: [...prev.clips, clip],
    }));
  };

  // Quiz helpers
  const addQuizQuestion = () => {
    setFormData((prev) => ({
      ...prev,
      quiz: [...prev.quiz, { question: '', options: ['', '', '', ''], correctAnswer: 0 }],
    }));
  };

  const removeQuizQuestion = (idx: number) => {
    setFormData((prev) => ({
      ...prev,
      quiz: prev.quiz.filter((_: any, i: number) => i !== idx),
    }));
  };

  const updateQuizQuestion = (idx: number, val: string) => {
    setFormData((prev) => {
      const copy = [...prev.quiz];
      copy[idx] = { ...copy[idx], question: val };
      return { ...prev, quiz: copy };
    });
  };

  const updateQuizOption = (idx: number, optionIdx: number, val: string) => {
    setFormData((prev) => {
      const copy = [...prev.quiz];
      const options = [...copy[idx].options];
      options[optionIdx] = val;
      copy[idx] = { ...copy[idx], options };
      return { ...prev, quiz: copy };
    });
  };

  const updateQuizCorrectAnswer = (idx: number, optionIdx: number) => {
    setFormData((prev) => {
      const copy = [...prev.quiz];
      copy[idx] = { ...copy[idx], correctAnswer: optionIdx };
      return { ...prev, quiz: copy };
    });
  };

  // Publication checklist — gates the "Publicar" action but never blocks saving a draft.
  const checklist = useMemo(() => {
    const validChapters = formData.sections.filter(
      (s: any) => s.title?.trim() && CHAPTER_TIME_REGEX.test((s.time || '').trim())
    );
    return [
      { id: 'image', label: 'Imagen de portada', passed: !!formData.image?.trim(), tab: 'media' as TabType },
      {
        id: 'transcript',
        label: 'Transcripción añadida',
        passed: formData.transcription.some((t: any) => t.text?.trim()),
        tab: 'transcript' as TabType,
      },
      {
        id: 'chapters',
        label: 'Capítulos válidos (título + tiempo mm:ss)',
        passed: validChapters.length > 0,
        tab: 'sections' as TabType,
      },
      {
        id: 'seo',
        label: 'SEO básico (título 10-100 y descripción 50-300 caracteres)',
        passed:
          formData.title.trim().length >= 10 &&
          formData.title.trim().length <= 100 &&
          formData.description.trim().length >= 50 &&
          formData.description.trim().length <= 300,
        tab: 'general' as TabType,
      },
    ];
  }, [formData.image, formData.transcription, formData.sections, formData.title, formData.description]);
  const allChecksPassed = checklist.every((c) => c.passed);

  return (
    <form onSubmit={handleSubmit} className="p-6 md:p-8 space-y-6 max-w-5xl mx-auto w-full">
      {/* Top Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800/80 pb-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.push('/episodes')}
            className="p-2 text-zinc-400 hover:text-zinc-100 bg-zinc-900 border border-zinc-800 rounded-lg transition"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold text-zinc-100">
                {isEdit ? `Editar Episodio` : 'Nuevo Episodio'}
              </h1>
              {formData.status === 'draft' ? (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-950/60 border border-amber-800/60 text-amber-400">
                  Borrador
                </span>
              ) : (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950/60 border border-emerald-800/60 text-emerald-400">
                  Publicado
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-400 font-mono">
              {formData.slug ? `/episodios/${formData.slug}` : 'Configuración de episodio'}
            </p>
            <AutoSaveStatus lastAutoSavedAt={lastAutoSavedAt} />
          </div>
        </div>

        <div className="flex items-center gap-2">
          {formData.status === 'draft' ? (
            <>
              <button
                type="submit"
                disabled={saving}
                className="bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700/60 text-xs font-medium px-4 py-2.5 rounded-lg transition flex items-center gap-2 disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                <span>{saving ? 'Guardando...' : 'Guardar Borrador'}</span>
              </button>
              <button
                type="button"
                onClick={(e) => handleSubmit(e, 'published')}
                disabled={saving || !allChecksPassed}
                title={!allChecksPassed ? 'Completa el checklist de publicación para poder publicar' : undefined}
                className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium px-5 py-2.5 rounded-lg transition flex items-center gap-2 shadow-lg shadow-indigo-600/20 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Publicar</span>
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={(e) => handleSubmit(e, 'draft')}
                disabled={saving}
                className="bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700/60 text-xs font-medium px-3.5 py-2.5 rounded-lg transition flex items-center gap-2 disabled:opacity-50"
              >
                <Undo2 className="w-4 h-4" />
                <span>Volver a borrador</span>
              </button>
              <button
                type="submit"
                disabled={saving}
                className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium px-5 py-2.5 rounded-lg transition flex items-center gap-2 shadow-lg shadow-indigo-600/20 disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                <span>{saving ? 'Guardando...' : 'Guardar Cambios'}</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Publication Checklist */}
      <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-xl p-4 space-y-2">
        <h2 className="text-xs font-semibold text-zinc-300 uppercase tracking-wide font-mono">
          Checklist de Publicación
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {checklist.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => changeTab(item.tab)}
              className="flex items-center gap-2 text-left text-xs px-2.5 py-1.5 rounded-lg hover:bg-zinc-800/60 transition"
            >
              {item.passed ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <XCircle className="w-4 h-4 text-zinc-600 shrink-0" />
              )}
              <span className={item.passed ? 'text-zinc-300' : 'text-zinc-500'}>{item.label}</span>
            </button>
          ))}
        </div>
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

      {/* Tabs Header */}
      <div className="flex items-center gap-2 border-b border-zinc-800/80 overflow-x-auto pb-1">
        <button
          type="button"
          onClick={() => changeTab('general')}
          className={`px-4 py-2 text-xs font-medium rounded-t-lg transition flex items-center gap-2 border-b-2 whitespace-nowrap ${
            activeTab === 'general'
              ? 'border-indigo-500 text-indigo-400 bg-zinc-900/60'
              : 'border-transparent text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <Radio className="w-4 h-4" />
          <span>1. Información General</span>
        </button>

        <button
          type="button"
          onClick={() => changeTab('media')}
          className={`px-4 py-2 text-xs font-medium rounded-t-lg transition flex items-center gap-2 border-b-2 whitespace-nowrap ${
            activeTab === 'media'
              ? 'border-indigo-500 text-indigo-400 bg-zinc-900/60'
              : 'border-transparent text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <span>2. Archivos & R2</span>
        </button>

        <button
          type="button"
          onClick={() => changeTab('transcript')}
          className={`px-4 py-2 text-xs font-medium rounded-t-lg transition flex items-center gap-2 border-b-2 whitespace-nowrap ${
            activeTab === 'transcript'
              ? 'border-indigo-500 text-indigo-400 bg-zinc-900/60'
              : 'border-transparent text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <MessageSquare className="w-4 h-4" />
          <span>3. Transcripción</span>
        </button>
        
        <button
          type="button"
          onClick={() => changeTab('sections')}
          className={`px-4 py-2 text-xs font-medium rounded-t-lg transition flex items-center gap-2 border-b-2 whitespace-nowrap ${
            activeTab === 'sections'
              ? 'border-indigo-500 text-indigo-400 bg-zinc-900/60'
              : 'border-transparent text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <List className="w-4 h-4" />
          <span>4. Capítulos / Secciones ({formData.sections.length})</span>
        </button>


        <button
          type="button"
          onClick={() => changeTab('clips')}
          className={`px-4 py-2 text-xs font-medium rounded-t-lg transition flex items-center gap-2 border-b-2 whitespace-nowrap ${
            activeTab === 'clips'
              ? 'border-indigo-500 text-indigo-400 bg-zinc-900/60'
              : 'border-transparent text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <Video className="w-4 h-4" />
          <span>5. Clips ({formData.clips.length})</span>
        </button>

        <button
          type="button"
          onClick={() => changeTab('quiz')}
          className={`px-4 py-2 text-xs font-medium rounded-t-lg transition flex items-center gap-2 border-b-2 whitespace-nowrap ${
            activeTab === 'quiz'
              ? 'border-indigo-500 text-indigo-400 bg-zinc-900/60'
              : 'border-transparent text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <HelpCircle className="w-4 h-4" />
          <span>6. Quiz ({formData.quiz.length})</span>
        </button>

        <button
          type="button"
          onClick={() => changeTab('dubbing')}
          className={`px-4 py-2 text-xs font-medium rounded-t-lg transition flex items-center gap-2 border-b-2 whitespace-nowrap ${
            activeTab === 'dubbing'
              ? 'border-indigo-500 text-indigo-400 bg-zinc-900/60'
              : 'border-transparent text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <Languages className="w-4 h-4" />
          <span>7. Doblaje</span>
        </button>
      </div>

      {/* TAB 1: GENERAL */}
      {activeTab === 'general' && (
        <div className="space-y-6">
          <div className="space-y-4 bg-zinc-900/40 p-6 rounded-xl border border-zinc-800/80">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="flex items-center justify-between gap-2 mb-1">
                <label className="block text-xs font-mono uppercase tracking-wider text-zinc-400">
                  Título del Episodio *
                </label>
                <AiFieldButton loading={fieldAiState.title.loading} onClick={() => handleGenerateField('title')} />
              </div>
              <input
                type="text"
                required
                value={formData.title}
                onChange={(e) => handleTitleChange(e.target.value)}
                placeholder="Ej: Amor Sin Filtros ft. Saray"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 transition font-medium"
              />
              <AiFieldHint message={fieldAiState.title.error} />
            </div>

            <div>
              <div className="flex items-center justify-between gap-2 mb-1">
                <label className="block text-xs font-mono uppercase tracking-wider text-zinc-400">
                  Slug Único *
                </label>
                <AiFieldButton loading={fieldAiState.slug.loading} onClick={() => handleGenerateField('slug')} />
              </div>
              <input
                type="text"
                required
                value={formData.slug}
                onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
                placeholder="amor-sin-filtros"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 font-mono placeholder-zinc-600 focus:outline-none focus:border-zinc-500 transition"
              />
              <AiFieldHint message={fieldAiState.slug.error} />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between gap-2 mb-1">
              <label className="block text-xs font-mono uppercase tracking-wider text-zinc-400">
                Descripción Corta *
              </label>
              <AiFieldButton loading={fieldAiState.description.loading} onClick={() => handleGenerateField('description')} />
            </div>
            <textarea
              required
              rows={3}
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Breve resumen del episodio..."
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 transition"
            />
            <AiFieldHint message={fieldAiState.description.error} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-mono uppercase tracking-wider text-zinc-400 mb-1">
                Fecha de Publicación
              </label>
              <input
                type="datetime-local"
                value={formData.pubDate}
                onChange={(e) => setFormData({ ...formData, pubDate: e.target.value })}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 font-mono focus:outline-none focus:border-zinc-500 transition"
              />
            </div>

            <div>
              <label className="block text-xs font-mono uppercase tracking-wider text-zinc-400 mb-1">
                Autor
              </label>
              <input
                type="text"
                value={formData.author}
                onChange={(e) => setFormData({ ...formData, author: e.target.value })}
                placeholder="Veredillas FM"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-zinc-500 transition"
              />
            </div>

            <div>
              <label className="block text-xs font-mono uppercase tracking-wider text-zinc-400 mb-1">
                Duración (ej: 37 min)
              </label>
              <input
                type="text"
                value={formData.duration}
                onChange={(e) => setFormData({ ...formData, duration: e.target.value })}
                placeholder="37 min"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 font-mono focus:outline-none focus:border-zinc-500 transition"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-mono uppercase tracking-wider text-zinc-400 mb-1">
                Temporada
              </label>
              <input
                type="number"
                value={formData.season}
                onChange={(e) => setFormData({ ...formData, season: e.target.value })}
                placeholder="1"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 font-mono focus:outline-none focus:border-zinc-500 transition"
              />
            </div>

            <div>
              <label className="block text-xs font-mono uppercase tracking-wider text-zinc-400 mb-1">
                Nº de Episodio
              </label>
              <input
                type="number"
                value={formData.episode}
                onChange={(e) => setFormData({ ...formData, episode: e.target.value })}
                placeholder="5"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 font-mono focus:outline-none focus:border-zinc-500 transition"
              />
            </div>

            <div className="flex items-center pt-5">
              <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-zinc-300">
                <input
                  type="checkbox"
                  checked={formData.isPremiere}
                  onChange={(e) => setFormData({ ...formData, isPremiere: e.target.checked })}
                  className="rounded bg-zinc-950 border-zinc-800 text-indigo-600 focus:ring-0"
                />
                <span>Marcar como Próximo Estreno (Is Premiere)</span>
              </label>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="flex items-center justify-between gap-2 mb-1">
                <label className="block text-xs font-mono uppercase tracking-wider text-zinc-400">
                  Etiquetas (separadas por coma)
                </label>
                <AiFieldButton loading={fieldAiState.tags.loading} onClick={() => handleGenerateField('tags')} />
              </div>
              <input
                type="text"
                value={formData.tags}
                onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
                placeholder="Ej: Amor, Entrevista"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-zinc-500 transition"
              />
              <AiFieldHint message={fieldAiState.tags.error} />
            </div>

            <div>
              <div className="flex items-center justify-between gap-2 mb-1">
                <label className="block text-xs font-mono uppercase tracking-wider text-zinc-400">
                  Participantes
                </label>
                <AiFieldButton loading={fieldAiState.participants.loading} onClick={() => handleGenerateField('participants')} />
              </div>
              <ParticipantsPicker
                value={formData.participants}
                onChange={(val) => setFormData({ ...formData, participants: val })}
              />
              <AiFieldHint message={fieldAiState.participants.error} />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between gap-2 mb-1">
              <label className="block text-xs font-mono uppercase tracking-wider text-zinc-400">
                Mensaje de Advertencia (Contenido Sensible)
              </label>
              <AiFieldButton loading={fieldAiState.warningMessage.loading} onClick={() => handleGenerateField('warningMessage')} />
            </div>
            <input
              type="text"
              value={formData.warningMessage}
              onChange={(e) => setFormData({ ...formData, warningMessage: e.target.value })}
              placeholder="Este episodio contiene lenguaje explícito..."
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-zinc-500 transition"
            />
            <AiFieldHint message={fieldAiState.warningMessage.error} />
          </div>

          <div className="pt-2 border-t border-zinc-800/80">
            <div className="flex items-center justify-between gap-2 mb-1">
              <label className="block text-xs font-mono uppercase tracking-wider text-zinc-400">
                Notas del Programa / Show Notes (Soporta HTML)
              </label>
              <AiFieldButton loading={fieldAiState.body.loading} onClick={() => handleGenerateField('body')} />
            </div>
            <textarea
              rows={10}
              value={formData.body}
              onChange={(e) => setFormData({ ...formData, body: e.target.value })}
              placeholder="Notas ampliadas del episodio: contexto, temas tratados, enlaces mencionados..."
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-sm text-zinc-100 font-mono placeholder-zinc-600 focus:outline-none focus:border-zinc-500 transition"
            />
            <AiFieldHint message={fieldAiState.body.error} />
          </div>
          </div>
        </div>
      )}

      {/* TAB 2: MEDIA & R2 */}
      {activeTab === 'media' && (
        <div className="space-y-6 bg-zinc-900/40 p-6 rounded-xl border border-zinc-800/80">
          <R2Uploader
            label="Imagen de Portada (R2 Upload)"
            accept="image/*"
            folder="images"
            entityId={formData.slug}
            value={formData.image}
            onChange={(url) => setFormData({ ...formData, image: url })}
            helperText="Formato recomendado: WebP / JPG / PNG (16:9 relación de aspecto)."
          />


          <div className="space-y-4 pt-2">
            <R2Uploader
              label="Subir Vídeo (R2 Private Video Bucket)"
              accept="video/*"
              folder="videos"
              target="video"
              entityId={formData.slug}
              value={formData.videoUrl}
              onChange={(url) => setFormData((prev) => ({ ...prev, videoUrl: url }))}
              onUploadSuccess={async (file) => {
                setAudioExtraction({ active: true, source: 'upload', progress: null, error: null, successMessage: null });
                const onProgress = (progress: ExtractionProgress) =>
                  setAudioExtraction((prev) => ({ ...prev, progress }));

                try {
                  const audioBlob = await extractMp3FromVideoFile(file, onProgress);
                  const audioFileName = file.name.replace(/\.[^/.]+$/, '') + '.mp3';
                  const audioUrl = await uploadExtractedAudio(audioBlob, audioFileName, onProgress);
                  setFormData((prev) => ({ ...prev, audioUrl }));
                  setAudioExtraction({
                    active: false,
                    source: null,
                    progress: null,
                    error: null,
                    successMessage: 'Vídeo subido y audio extraído correctamente.',
                  });
                } catch (error: any) {
                  console.error(error);
                  setAudioExtraction({
                    active: false,
                    source: null,
                    progress: null,
                    error: error.message || 'Error al extraer el audio del vídeo.',
                    successMessage: null,
                  });
                }
              }}
              helperText="Sube un archivo de vídeo y extrae automáticamente el audio para el episodio."
            />

            {audioExtraction.active && (
              <AudioExtractionProgress
                progress={audioExtraction.progress}
                includeDownloadStage={audioExtraction.source === 'existing'}
              />
            )}
            {!audioExtraction.active && audioExtraction.successMessage && (
              <div className="p-2.5 rounded-lg bg-emerald-950/40 border border-emerald-900/60 text-xs font-mono text-emerald-300 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" />
                <span>{audioExtraction.successMessage}</span>
              </div>
            )}
            {!audioExtraction.active && audioExtraction.error && (
              <div className="p-2.5 rounded-lg bg-red-950/40 border border-red-900/60 text-xs font-mono text-red-300">
                {audioExtraction.error}
              </div>
            )}

            {formData.videoUrl && (
              <div className="p-4 bg-zinc-950/60 border border-zinc-800/80 rounded-xl space-y-2">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h4 className="text-xs font-semibold text-zinc-200">Extraer audio del vídeo ya subido</h4>
                    <p className="text-xs text-zinc-500">
                      {formData.audioUrl
                        ? 'Ya existe un audio asignado. Puedes volver a extraerlo desde el vídeo ya subido a R2.'
                        : 'Este vídeo ya está en R2 pero todavía no tiene audio generado. Extráelo sin volver a subir el archivo.'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleExtractAudioFromUploadedVideo}
                    disabled={audioExtraction.active}
                    className="shrink-0 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-100 text-xs font-medium px-4 py-2 rounded-lg transition flex items-center gap-2"
                  >
                    {audioExtraction.active && audioExtraction.source === 'existing' ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Music className="w-4 h-4 text-indigo-400" />
                    )}
                    <span>{audioExtraction.active ? 'Extrayendo...' : 'Extraer audio del vídeo en R2'}</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          <R2Uploader
            label="Archivo de Audio Principal (R2 Direct Upload)"
            accept="audio/*"
            folder="audios"
            entityId={formData.slug}
            value={formData.audioUrl}
            onChange={(url) => setFormData({ ...formData, audioUrl: url })}
          />
        </div>
      )}

      {/* TAB 3: TRANSCRIPTION */}
      {activeTab === 'transcript' && (
        <div className="space-y-6 bg-zinc-900/40 p-6 rounded-xl border border-zinc-800/80">
          {/* Deepgram AI Transcription Generator Box */}
          <div className="bg-gradient-to-r from-indigo-950/60 via-zinc-900 to-purple-950/60 border border-indigo-800/60 rounded-2xl p-5 space-y-4 shadow-xl">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-indigo-900/40 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-indigo-600/30 border border-indigo-500/50 flex items-center justify-center text-indigo-300">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
                    <span>Transcripción Automática con Deepgram AI</span>
                    <span className="text-[10px] font-mono font-bold bg-indigo-950 border border-indigo-800 text-indigo-300 px-2 py-0.5 rounded">
                      Nova-3
                    </span>
                  </h4>
                  <p className="text-xs text-zinc-400">
                    Genera automáticamente la transcripción con marcas de tiempo e identificación de hablantes usando la IA de Deepgram.
                  </p>
                </div>
              </div>
            </div>

            {/* Input Selection / Audio Status */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3 text-xs">
              <div className="md:col-span-8 space-y-1.5">
                <label className="text-zinc-300 font-mono text-[11px] font-semibold">Fuente de Audio / Vídeo</label>
                <input
                  type="text"
                  placeholder="https://pub-<account_id>.r2.dev/audios/ejemplo.mp3"
                  value={formData.audioUrl || formData.videoUrl || ''}
                  onChange={(e) => setFormData((prev) => ({ ...prev, audioUrl: e.target.value }))}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-100 font-mono focus:outline-none focus:border-indigo-500"
                />
                <span className="text-[10px] text-zinc-500 block">
                  {formData.audioUrl ? '✓ Usando Audio Principal asignado al episodio' : formData.videoUrl ? '✓ Usando URL de Vídeo del episodio' : 'Pega una URL de audio/vídeo de R2 para transcribir'}
                </span>
              </div>

              <div className="md:col-span-4 flex items-end">
                <button
                  type="button"
                  onClick={async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const sourceUrl = formData.audioUrl || formData.videoUrl;
                    if (!sourceUrl) {
                      setDeepgramError('Por favor añade la URL de audio o vídeo del episodio primero.');
                      return;
                    }
                    setDeepgramError(null);
                    setDeepgramLoading(true);
                    setDeepgramStatus('Enviando audio a Deepgram AI (Nova-3)...');
                    try {
                      const res = await fetch('/api/admin/deepgram/transcribe', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          url: sourceUrl,
                          model: 'nova-3',
                          language: 'es',
                        }),
                      });
                      if (!res.ok) {
                        const errData = await res.json();
                        throw new Error(errData.error || 'Error en la transcripción con Deepgram');
                      }
                      const data = await res.json();
                      setGeneratedSubtitles({ srt: data.srt, vtt: data.vtt });

                      if (data.utterances && data.utterances.length > 0) {
                        const formatted = data.utterances.map((u: any) => {
                          const m = Math.floor(u.start / 60);
                          const s = Math.floor(u.start % 60);
                          const timeStr = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
                          return {
                            time: timeStr,
                            text: u.transcript.trim(),
                            speaker: u.speaker !== undefined ? `Hablante ${u.speaker}` : '',
                          };
                        });
                        setFormData((prev) => ({ ...prev, transcription: formatted }));
                      } else if (data.transcript) {
                        setFormData((prev) => ({
                          ...prev,
                          transcription: [{ time: '00:00', text: data.transcript.trim(), speaker: 'Hablante 1' }],
                        }));
                      }
                      setDeepgramStatus('¡Transcripción y subtítulos integrados con éxito en el formulario!');
                    } catch (err: any) {
                      console.error(err);
                      setDeepgramError(err.message || 'Error al generar la transcripción');
                    } finally {
                      setDeepgramLoading(false);
                    }
                  }}
                  disabled={deepgramLoading}
                  className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold py-2.5 rounded-xl transition flex items-center justify-center gap-2 text-xs shadow-md shadow-indigo-600/20"
                >
                  {deepgramLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-white" />
                      <span>Transcribiendo...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 text-indigo-300" />
                      <span>Generar Transcripción</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Status & Error Feedback Banners */}
            {deepgramStatus && !deepgramError && (
              <div className="p-2.5 rounded-xl bg-indigo-950/60 border border-indigo-800/80 text-xs font-mono text-indigo-300 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>{deepgramStatus}</span>
              </div>
            )}

            {deepgramError && (
              <div className="p-2.5 rounded-xl bg-rose-950/60 border border-rose-800/80 text-xs font-mono text-rose-300 flex items-center gap-2">
                <span className="text-rose-400 font-bold">⚠️ Error:</span>
                <span>{deepgramError}</span>
              </div>
            )}

            {/* Subtitle Export buttons if generated */}
            {generatedSubtitles && (
              <div className="flex items-center gap-3 pt-2 border-t border-indigo-900/40 text-xs font-mono">
                <span className="text-zinc-400 font-bold">Subtítulos Exportables:</span>
                <button
                  type="button"
                  onClick={() => {
                    const blob = new Blob([generatedSubtitles.srt], { type: 'text/plain' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${formData.slug || 'episodio'}.srt`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="px-2.5 py-1 rounded bg-indigo-900/80 hover:bg-indigo-800 text-indigo-200 border border-indigo-700 transition"
                >
                  Descargar .SRT
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const blob = new Blob([generatedSubtitles.vtt], { type: 'text/vtt' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${formData.slug || 'episodio'}.vtt`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="px-2.5 py-1 rounded bg-purple-900/80 hover:bg-purple-800 text-purple-200 border border-purple-700 transition"
                >
                  Descargar .VTT
                </button>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(generatedSubtitles.srt);
                    setCopiedSrt(true);
                    setTimeout(() => setCopiedSrt(false), 2000);
                  }}
                  className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 transition"
                >
                  {copiedSrt ? '¡SRT Copiado!' : 'Copiar SRT'}
                </button>
              </div>
            )}
          </div>

          {/* Speaker Identification Panel */}
          <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-800/80 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-300">
                  <Users className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-zinc-100">Identificación de Hablantes</h4>
                  <p className="text-xs text-zinc-400">
                    Reproduce cada intervención para ver quién habla y ponle su nombre real. Se actualizará en todas las líneas donde intervenga.
                  </p>
                </div>
              </div>
              {speakerGroups.length > 0 && (
                <span className="text-[11px] font-mono text-zinc-400 shrink-0">
                  {speakerGroups.filter((g) => !isGenericSpeakerLabel(g.label)).length}/{speakerGroups.length} identificados
                </span>
              )}
            </div>

            {(formData.videoUrl || formData.audioUrl) ? (
              <div className="sticky top-2 z-10 rounded-xl overflow-hidden border border-zinc-800 bg-black shadow-lg">
                {formData.videoUrl ? (
                  <video ref={videoRef} src={formData.videoUrl} controls preload="metadata" className="w-full max-h-72 bg-black" />
                ) : (
                  <audio ref={audioRef} src={formData.audioUrl} controls preload="metadata" className="w-full bg-zinc-950 p-2" />
                )}
              </div>
            ) : (
              <div className="p-3 rounded-xl bg-amber-950/30 border border-amber-900/50 text-xs text-amber-300 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>Sube un vídeo o audio en la pestaña &quot;Media&quot; para poder reproducir cada intervención y reconocer a los hablantes.</span>
              </div>
            )}

            {speakerGroups.length === 0 ? (
              <div className="p-3 rounded-xl bg-zinc-950/60 border border-zinc-800/80 text-xs text-zinc-500">
                Aún no hay hablantes detectados. Genera la transcripción con Deepgram AI o rellena el campo &quot;Hablante&quot; en las líneas de abajo.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {speakerGroups.map((group) => {
                  const color = speakerColorMap[group.label];
                  const previewIdx = speakerPreviewIndex[group.label] ?? 0;
                  const segment = group.segments[previewIdx];
                  const identified = !isGenericSpeakerLabel(group.label);
                  const isActive = activeSpeakerLabel === group.label;

                  return (
                    <div
                      key={group.label}
                      className={`rounded-xl border p-3 space-y-2.5 transition bg-zinc-950/60 ${
                        isActive ? color.ring : 'border-zinc-800/80'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <div className={`w-8 h-8 rounded-full ${color.dot} flex items-center justify-center text-white text-xs font-bold shrink-0`}>
                          {group.label.trim().charAt(0).toUpperCase() || '?'}
                        </div>
                        <input
                          key={group.label}
                          type="text"
                          defaultValue={group.label}
                          list="known-speaker-names"
                          onBlur={(e) => renameSpeaker(group.label, e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              (e.target as HTMLInputElement).blur();
                            }
                          }}
                          className="flex-1 min-w-0 bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-100 focus:outline-none focus:border-indigo-500"
                        />
                        {identified ? (
                          <span title="Identificado" className="shrink-0">
                            <UserCheck className="w-4 h-4 text-emerald-400" />
                          </span>
                        ) : (
                          <span title="Sin identificar" className="shrink-0">
                            <AlertCircle className="w-4 h-4 text-amber-500" />
                          </span>
                        )}
                      </div>

                      {participantSuggestions.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {participantSuggestions.map((name) => (
                            <button
                              key={name}
                              type="button"
                              onClick={() => renameSpeaker(group.label, name)}
                              className={`px-1.5 py-0.5 rounded text-[10px] border transition ${color.chip} ${color.text} hover:brightness-125`}
                            >
                              {name}
                            </button>
                          ))}
                        </div>
                      )}

                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setSpeakerPreviewIndex((prev) => ({
                              ...prev,
                              [group.label]: Math.max(0, previewIdx - 1),
                            }))
                          }
                          disabled={previewIdx === 0}
                          className="p-1 text-zinc-500 hover:text-zinc-200 disabled:opacity-30 transition"
                        >
                          <ChevronLeft className="w-3.5 h-3.5" />
                        </button>
                        <span className="text-[10px] font-mono text-zinc-500 text-center flex-1">
                          {group.count === 1 ? '1 intervención' : `${group.count} intervenciones`} &bull; {previewIdx + 1}/{group.count} a los {segment.time}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setSpeakerPreviewIndex((prev) => ({
                              ...prev,
                              [group.label]: Math.min(group.count - 1, previewIdx + 1),
                            }))
                          }
                          disabled={previewIdx === group.count - 1}
                          className="p-1 text-zinc-500 hover:text-zinc-200 disabled:opacity-30 transition"
                        >
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={() => playSpeakerSegment(group.label, previewIdx)}
                        disabled={!formData.videoUrl && !formData.audioUrl}
                        className="w-full flex items-center justify-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-200 text-xs font-medium py-1.5 rounded-lg transition"
                      >
                        <Play className="w-3.5 h-3.5" />
                        <span>Reproducir para identificar</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            <datalist id="known-speaker-names">
              {speakerGroups.map((g) => (
                <option key={g.label} value={g.label} />
              ))}
              {participantSuggestions.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </div>

          {/* Existing Manual/AI Line Feed */}
          <div className="flex items-center justify-between pt-2">
            <div>
              <h3 className="text-sm font-semibold text-zinc-200">Líneas de Transcripción del Episodio</h3>
              <p className="text-xs text-zinc-400">Puedes editar, reordenar o añadir fragmentos manualmente</p>
            </div>

            <button
              type="button"
              onClick={addTranscription}
              className="bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium px-3 py-1.5 rounded-lg transition flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4 text-indigo-400" />
              <span>Añadir Línea</span>
            </button>
          </div>

          <div className="space-y-3">
            {formData.transcription.map((tr: any, idx: number) => {
              const label = (tr.speaker || '').trim();
              const color = label ? speakerColorMap[label] : undefined;
              return (
                <div
                  key={idx}
                  className={`bg-zinc-950 p-3 border rounded-lg space-y-2 ${color ? color.ring : 'border-zinc-800/80'}`}
                >
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => seekTo(timeStrToSeconds(tr.time))}
                      disabled={!formData.videoUrl && !formData.audioUrl}
                      title="Reproducir este momento"
                      className="p-1.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-indigo-300 hover:border-indigo-700 disabled:opacity-30 transition shrink-0"
                    >
                      <Play className="w-3.5 h-3.5" />
                    </button>
                    <input
                      type="text"
                      value={tr.time}
                      onChange={(e) => updateTranscription(idx, 'time', e.target.value)}
                      placeholder="00:00"
                      className="w-24 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-100 font-mono text-center"
                    />
                    <div className="flex-1 flex items-center gap-1.5 min-w-0">
                      {color && <span className={`w-2 h-2 rounded-full ${color.dot} shrink-0`} />}
                      <input
                        type="text"
                        value={tr.speaker || ''}
                        onChange={(e) => updateTranscription(idx, 'speaker', e.target.value)}
                        placeholder="Hablante"
                        list="known-speaker-names"
                        className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-xs text-zinc-100"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeTranscription(idx)}
                      className="ml-auto p-1 text-zinc-500 hover:text-red-400 transition"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <textarea
                    rows={2}
                    value={tr.text}
                    onChange={(e) => updateTranscription(idx, 'text', e.target.value)}
                    placeholder="Texto dicho en este fragmento de tiempo..."
                    className="w-full bg-zinc-900 border border-zinc-800 rounded p-2 text-xs text-zinc-100 focus:outline-none focus:border-zinc-600"
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
      
      {/* TAB 4: SECTIONS / CAPÍTULOS */}
      {activeTab === 'sections' && (
        <div className="space-y-4 bg-zinc-900/40 p-6 rounded-xl border border-zinc-800/80">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-zinc-200">Secciones y Capítulos del Episodio</h3>
              <p className="text-xs text-zinc-400">
                Añade marcas de tiempo para permitir la navegación por capítulos &bull;{' '}
                <span className={checklist.find((c) => c.id === 'chapters')?.passed ? 'text-emerald-400' : 'text-zinc-500'}>
                  {formData.sections.filter((s: any) => s.title?.trim() && CHAPTER_TIME_REGEX.test((s.time || '').trim())).length}/
                  {formData.sections.length} válidos
                </span>
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleGenerateField('sections')}
                disabled={fieldAiState.sections.loading}
                className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition flex items-center gap-1.5"
              >
                {fieldAiState.sections.loading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4 text-indigo-200" />
                )}
                <span>Generar Capítulos con IA</span>
              </button>
              <button
                type="button"
                onClick={addSection}
                className="bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium px-3 py-1.5 rounded-lg transition flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4 text-indigo-400" />
                <span>Añadir Sección</span>
              </button>
            </div>
          </div>

          <AiFieldHint message={fieldAiState.sections.error} />

          <div className="space-y-2">
            {formData.sections.map((sec: any, idx: number) => (
              <div key={idx} className="flex items-center gap-2 bg-zinc-950 p-2 border border-zinc-800/80 rounded-lg">
                <input
                  type="text"
                  value={sec.time}
                  onChange={(e) => updateSection(idx, 'time', e.target.value)}
                  placeholder="00:00"
                  title={!CHAPTER_TIME_REGEX.test((sec.time || '').trim()) ? 'Formato esperado: mm:ss o h:mm:ss' : undefined}
                  className={`w-24 bg-zinc-900 border rounded px-2 py-1 text-xs text-zinc-100 font-mono text-center focus:outline-none focus:border-zinc-600 ${
                    CHAPTER_TIME_REGEX.test((sec.time || '').trim()) ? 'border-zinc-800' : 'border-amber-700/70'
                  }`}
                />
                <input
                  type="text"
                  value={sec.title}
                  onChange={(e) => updateSection(idx, 'title', e.target.value)}
                  placeholder="Título de la sección (ej: Intro / Bienvenida)"
                  className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-xs text-zinc-100 focus:outline-none focus:border-zinc-600"
                />
                <button
                  type="button"
                  onClick={() => removeSection(idx)}
                  className="p-1 text-zinc-500 hover:text-red-400 transition"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 5: CLIPS */}
      {activeTab === 'clips' && (
        <div className="space-y-6 bg-zinc-900/40 p-6 rounded-xl border border-zinc-800/80">
          {/* Batch upload of clips from the local computer directly to YouTube */}
          <div className="pb-6 border-b border-zinc-800/80">
            <ClipYouTubeBatchUploader onUploaded={handleClipUploaded} />
          </div>

          {/* Clips */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-200">Clips de Vídeo (YouTube Shorts)</h3>
              <button
                type="button"
                onClick={addClip}
                className="bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium px-3 py-1.5 rounded-lg transition flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4 text-indigo-400" />
                <span>Añadir Clip</span>
              </button>
            </div>

            {formData.clips.map((clip: any, idx: number) => (
              <div key={idx} className="flex items-center gap-2 bg-zinc-950 p-2 border border-zinc-800/80 rounded-lg">
                {/* Check visual: miniatura guardada para este clip (o aviso si falta) */}
                {clip.thumbnailUrl ? (
                  <a
                    href={clip.thumbnailUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="relative w-9 h-9 rounded border border-emerald-800/60 overflow-hidden shrink-0"
                    title="Miniatura en R2 (clic para ver a tamaño completo)"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={clip.thumbnailUrl} alt="Miniatura del clip" className="w-full h-full object-cover" />
                  </a>
                ) : (
                  <div
                    className="w-9 h-9 rounded border border-zinc-800 bg-zinc-900 flex items-center justify-center shrink-0"
                    title="Sin miniatura (clip añadido manualmente o miniatura no generada)"
                  >
                    <ImageOff className="w-3.5 h-3.5 text-zinc-600" />
                  </div>
                )}
                <input
                  type="text"
                  value={clip.title}
                  onChange={(e) => updateClip(idx, 'title', e.target.value)}
                  placeholder="Título del clip"
                  className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-xs text-zinc-100"
                />
                <input
                  type="text"
                  value={clip.url}
                  onChange={(e) => updateClip(idx, 'url', e.target.value)}
                  placeholder="https://youtube.com/shorts/..."
                  className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-xs text-zinc-100 font-mono"
                />
                <button
                  type="button"
                  onClick={() => removeClip(idx)}
                  className="p-1 text-zinc-500 hover:text-red-400 transition"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 6: QUIZ */}
      {activeTab === 'quiz' && (
        <div className="space-y-6 bg-zinc-900/40 p-6 rounded-xl border border-zinc-800/80">
          {/* Quiz AI Generation */}
          <div className="bg-gradient-to-r from-indigo-950/60 via-zinc-900 to-purple-950/60 border border-indigo-800/60 rounded-2xl p-5 space-y-4 shadow-xl">
            <div className="flex items-center gap-2.5 border-b border-indigo-900/40 pb-3">
              <div className="w-8 h-8 rounded-xl bg-indigo-600/30 border border-indigo-500/50 flex items-center justify-center text-indigo-300">
                <Sparkles className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
                  <span>Generar Quiz con IA</span>
                  <span className="text-[10px] font-mono font-bold bg-indigo-950 border border-indigo-800 text-indigo-300 px-2 py-0.5 rounded">
                    Gemini
                  </span>
                </h4>
                <p className="text-xs text-zinc-400">
                  Gemini analiza la transcripción y los capítulos ya cargados en este episodio y genera 5 preguntas tipo test.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleGenerateQuizWithAI}
              disabled={quizAiLoading}
              className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold py-2.5 rounded-xl transition flex items-center justify-center gap-2 text-xs shadow-md shadow-indigo-600/20"
            >
              {quizAiLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-white" />
                  <span>Generando quiz...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 text-indigo-300" />
                  <span>Generar Quiz desde la Transcripción</span>
                </>
              )}
            </button>

            {quizAiStatus && !quizAiError && (
              <div className="p-2.5 rounded-xl bg-indigo-950/60 border border-indigo-800/80 text-xs font-mono text-indigo-300 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>{quizAiStatus}</span>
              </div>
            )}

            {quizAiError && (
              <div className="p-2.5 rounded-xl bg-rose-950/60 border border-rose-800/80 text-xs font-mono text-rose-300 flex items-center gap-2">
                <span className="text-rose-400 font-bold">⚠️ Error:</span>
                <span>{quizAiError}</span>
              </div>
            )}
          </div>

          {/* Quiz */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
                  <HelpCircle className="w-4 h-4 text-indigo-400" />
                  <span>Quiz del Episodio</span>
                </h3>
                <p className="text-xs text-zinc-400">Preguntas tipo test que verán los oyentes en la web</p>
              </div>
              <button
                type="button"
                onClick={addQuizQuestion}
                className="bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium px-3 py-1.5 rounded-lg transition flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4 text-indigo-400" />
                <span>Añadir Pregunta</span>
              </button>
            </div>

            {formData.quiz.map((q: any, idx: number) => (
              <div key={idx} className="bg-zinc-950 p-3 border border-zinc-800/80 rounded-lg space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-zinc-500 shrink-0">#{idx + 1}</span>
                  <input
                    type="text"
                    value={q.question}
                    onChange={(e) => updateQuizQuestion(idx, e.target.value)}
                    placeholder="Escribe la pregunta..."
                    className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-xs text-zinc-100 focus:outline-none focus:border-zinc-600"
                  />
                  <button
                    type="button"
                    onClick={() => removeQuizQuestion(idx)}
                    className="p-1 text-zinc-500 hover:text-red-400 transition"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pl-6">
                  {q.options.map((opt: string, optionIdx: number) => (
                    <label
                      key={optionIdx}
                      className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5"
                    >
                      <input
                        type="radio"
                        name={`quiz-correct-${idx}`}
                        checked={q.correctAnswer === optionIdx}
                        onChange={() => updateQuizCorrectAnswer(idx, optionIdx)}
                        className="shrink-0 text-indigo-600 focus:ring-0"
                        title="Marcar como respuesta correcta"
                      />
                      <input
                        type="text"
                        value={opt}
                        onChange={(e) => updateQuizOption(idx, optionIdx, e.target.value)}
                        placeholder={`Opción ${optionIdx + 1}`}
                        className="flex-1 bg-transparent text-xs text-zinc-100 focus:outline-none min-w-0"
                      />
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 7: DOBLAJE */}
      {activeTab === 'dubbing' && (
        <div className="space-y-6">
          {isEdit && initialData?._id && (formData.audioUrl || formData.videoUrl) ? (
            <DubbingManager
              episodeId={initialData._id}
              episodeSlug={formData.slug}
              sourceUrl={formData.audioUrl || formData.videoUrl}
              initialDubs={initialData?.dubs || []}
            />
          ) : (
            <p className="text-xs text-zinc-500">
              Guarda el episodio con un audio o vídeo asociado para poder generar un doblaje.
            </p>
          )}
        </div>
      )}
    </form>
  );
}
