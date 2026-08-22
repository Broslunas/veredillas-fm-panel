import { NextResponse } from 'next/server';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { isAuthorizedRoute } from '@/lib/api-guard';
import { synthesizeSpeechWav, DeepgramTextTooLongError } from '@/lib/deepgram';
import { getBucketByType, getS3ClientForBucket } from '@/lib/r2';
import { parseWav, encodeMonoPcm16ToWav, DEFAULT_DUB_SAMPLE_RATE } from '@/lib/dubbing/audio';
import { getEpisodeWithTrack, saveTrack } from '@/lib/dubbing/store';
import type { IDubSegment } from '@/models/EpisodeContent';

export const maxDuration = 90;

// Splits translated text roughly in half at the sentence boundary closest to the
// midpoint, so a too-long segment can be synthesized as two Deepgram Speak calls
// instead of failing outright.
function splitTextForRetry(text: string): [string, string] {
  const mid = Math.floor(text.length / 2);
  const boundary = /[.!?]\s/g;
  let bestIndex = -1;
  let match: RegExpExecArray | null;
  while ((match = boundary.exec(text))) {
    const candidate = match.index + 1;
    if (bestIndex === -1 || Math.abs(candidate - mid) < Math.abs(bestIndex - mid)) {
      bestIndex = candidate;
    }
  }
  const splitAt = bestIndex > 0 ? bestIndex : mid;
  return [text.slice(0, splitAt).trim(), text.slice(splitAt).trim()];
}

async function synthesizeWithRetry(text: string, voice: string): Promise<Buffer> {
  try {
    return await synthesizeSpeechWav(text, voice, DEFAULT_DUB_SAMPLE_RATE);
  } catch (error) {
    if (!(error instanceof DeepgramTextTooLongError)) throw error;

    const [first, second] = splitTextForRetry(text);
    if (!first || !second) throw error;

    const [firstBuf, secondBuf] = await Promise.all([
      synthesizeSpeechWav(first, voice, DEFAULT_DUB_SAMPLE_RATE),
      synthesizeSpeechWav(second, voice, DEFAULT_DUB_SAMPLE_RATE),
    ]);
    const firstWav = parseWav(firstBuf);
    const secondWav = parseWav(secondBuf);
    const combined = new Int16Array(firstWav.samples.length + secondWav.samples.length);
    combined.set(firstWav.samples, 0);
    combined.set(secondWav.samples, firstWav.samples.length);
    return encodeMonoPcm16ToWav(combined, DEFAULT_DUB_SAMPLE_RATE);
  }
}

export async function POST(request: Request) {
  const { authorized } = await isAuthorizedRoute(request);
  if (!authorized) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  try {
    const { episodeId, lang, batchSize = 5 } = await request.json();
    if (!episodeId || !lang) {
      return NextResponse.json({ error: 'Se requieren episodeId y lang' }, { status: 400 });
    }

    const { track } = await getEpisodeWithTrack(episodeId, lang);
    const totalCount = track.segments.length;
    const batch = track.segments.filter((s) => s.status === 'translated').slice(0, batchSize);

    const bucket = await getBucketByType('multimedia');
    if (!bucket) {
      return NextResponse.json({ error: 'No hay bucket "multimedia" configurado en R2' }, { status: 500 });
    }
    const client = getS3ClientForBucket(bucket);

    const errors: { index: number; error: string }[] = [];
    const segmentsByIndex = new Map(track.segments.map((s) => [s.index, s]));

    await Promise.all(
      batch.map(async (segment) => {
        try {
          const voice = track.voiceMap[String(segment.speaker ?? 0)] || Object.values(track.voiceMap)[0];
          if (!voice) throw new Error('No hay ninguna voz asignada para este segmento');

          const wavBuffer = await synthesizeWithRetry(segment.translatedText || segment.text, voice);
          const parsed = parseWav(wavBuffer);
          const key = `dubs-tmp/${episodeId}/${lang}/seg-${String(segment.index).padStart(5, '0')}.wav`;

          await client.send(
            new PutObjectCommand({
              Bucket: bucket.bucketName,
              Key: key,
              Body: wavBuffer,
              ContentType: 'audio/wav',
            })
          );

          const updated: IDubSegment = {
            ...segment,
            status: 'synthesized',
            tempKey: key,
            durationSeconds: parsed.samples.length / parsed.sampleRate,
            error: undefined,
          };
          segmentsByIndex.set(segment.index, updated);
        } catch (error: any) {
          const message = error?.message || 'Error al sintetizar el segmento';
          errors.push({ index: segment.index, error: message });
          segmentsByIndex.set(segment.index, { ...segment, status: 'error', error: message });
        }
      })
    );

    track.segments = track.segments.map((s) => segmentsByIndex.get(s.index) || s);

    const doneCount = track.segments.filter((s) => s.status === 'synthesized' || s.status === 'error').length;
    const done = doneCount === totalCount;

    track.progress = 30 + Math.round((doneCount / totalCount) * 60);
    if (done) track.status = 'finalizing';
    track.updatedAt = new Date();

    await saveTrack(episodeId, lang, track);

    return NextResponse.json({
      batchCount: batch.length,
      synthesizedCount: doneCount,
      totalCount,
      done,
      errors,
    });
  } catch (error: any) {
    console.error('Error in /api/admin/dubbing/synthesize-batch:', error);
    return NextResponse.json({ error: error.message || 'Error al sintetizar el lote' }, { status: 500 });
  }
}
