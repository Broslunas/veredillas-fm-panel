// Sube a R2 (bucket type: 'clips') lo descargado por download-clips.mjs y
// actualiza url/videoId/thumbnailUrl en Mongo. Requiere un bucket 'clips'
// activo y predeterminado (créalo desde /admin/buckets).
//
// Uso:
//   node --env-file=.env.local scripts/migrate-clips-to-r2.mjs
//   node --env-file=.env.local scripts/migrate-clips-to-r2.mjs --keep-local

import mongoose from 'mongoose';
import { createDecipheriv } from 'crypto';
import { S3Client, PutObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { readFile, writeFile, unlink, stat, rename } from 'fs/promises';
import path from 'path';

const OUTPUT_DIR = path.resolve(process.cwd(), 'tmp/clips-download');
const MANIFEST_PATH = path.join(OUTPUT_DIR, 'manifest.json');

function decryptSecret(payload, key) {
  const [ivB64, authTagB64, cipherTextB64] = payload.split(':');
  if (!ivB64 || !authTagB64 || !cipherTextB64) throw new Error('Formato de secreto cifrado inválido');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(authTagB64, 'base64'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(cipherTextB64, 'base64')), decipher.final()]);
  return decrypted.toString('utf8');
}

async function getBucketUsage(client, bucketName) {
  let continuationToken;
  let totalBytes = 0;
  do {
    const response = await client.send(
      new ListObjectsV2Command({ Bucket: bucketName, ContinuationToken: continuationToken, MaxKeys: 1000 })
    );
    for (const item of response.Contents || []) totalBytes += item.Size || 0;
    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);
  return totalBytes;
}

async function saveManifest(manifest) {
  const tmpPath = `${MANIFEST_PATH}.tmp`;
  await writeFile(tmpPath, JSON.stringify(manifest, null, 2), 'utf8');
  await rename(tmpPath, MANIFEST_PATH); // atomic: a Ctrl+C mid-write can't corrupt manifest.json
}

const r2BucketSchema = new mongoose.Schema({}, { strict: false });
const episodeContentSchema = new mongoose.Schema({}, { strict: false });

async function resolveClipsBucket(encryptionKeyBase64) {
  const key = Buffer.from(encryptionKeyBase64, 'base64');
  if (key.length !== 32) throw new Error('ENCRYPTION_KEY debe decodificar a 32 bytes en base64');

  const R2Bucket = mongoose.models.R2Bucket || mongoose.model('R2Bucket', r2BucketSchema);
  const bucket = await R2Bucket.findOne({ type: 'clips', isDefault: true, isActive: true }).lean();
  if (!bucket) {
    throw new Error(
      'No hay ningún bucket con type "clips" marcado como predeterminado y activo. Créalo desde /admin/buckets en el panel antes de continuar.'
    );
  }

  const client = new S3Client({
    region: 'auto',
    endpoint: bucket.endpoint,
    credentials: { accessKeyId: bucket.accessKeyId, secretAccessKey: decryptSecret(bucket.secretAccessKeyEncrypted, key) },
  });

  return { bucket, client, publicBase: bucket.publicUrlBase.replace(/\/+$/, '') };
}

async function migrateClip(entry, { client, bucket, publicBase, EpisodeContent, usedBytes, maxBytes }) {
  const [videoStat, thumbStat] = await Promise.all([stat(entry.localVideoPath), stat(entry.localThumbPath)]);
  const projectedBytes = usedBytes + videoStat.size + thumbStat.size;
  if (projectedBytes > maxBytes) {
    throw new Error(`Subir este clip superaría el límite del bucket (${(maxBytes / 1000 ** 3).toFixed(2)} GB). Se detiene la migración.`);
  }

  console.log(`\n-> Subiendo "${entry.title}" (${entry.videoId})...`);

  const videoKey = `clips/${entry.episodeSlug}/${entry.videoId}.mp4`;
  const thumbKey = `clips/${entry.episodeSlug}/${entry.videoId}.jpg`;

  await client.send(
    new PutObjectCommand({ Bucket: bucket.bucketName, Key: videoKey, Body: await readFile(entry.localVideoPath), ContentType: 'video/mp4' })
  );
  await client.send(
    new PutObjectCommand({ Bucket: bucket.bucketName, Key: thumbKey, Body: await readFile(entry.localThumbPath), ContentType: 'image/jpeg' })
  );

  const videoUrl = `${publicBase}/${videoKey}`;
  const thumbnailUrl = `${publicBase}/${thumbKey}`;

  const result = await EpisodeContent.updateOne(
    { _id: entry.episodeId },
    {
      $set: {
        [`clips.${entry.clipIndex}.url`]: videoUrl,
        [`clips.${entry.clipIndex}.videoId`]: entry.videoId,
        [`clips.${entry.clipIndex}.thumbnailUrl`]: thumbnailUrl,
      },
    }
  );
  if (result.matchedCount === 0) throw new Error(`No se encontró el episodio ${entry.episodeId} en MongoDB`);

  return { videoUrl, usedBytes: projectedBytes };
}

async function main() {
  const { MONGODB_URI, ENCRYPTION_KEY } = process.env;
  if (!MONGODB_URI) throw new Error('Falta MONGODB_URI');
  if (!ENCRYPTION_KEY) throw new Error('Falta ENCRYPTION_KEY. Genera una con: openssl rand -base64 32');

  const keepLocal = process.argv.includes('--keep-local');

  const manifestRaw = await readFile(MANIFEST_PATH, 'utf8').catch(() => null);
  if (!manifestRaw) {
    throw new Error(`No se encontró ${MANIFEST_PATH}. Ejecuta antes: node --env-file=.env.local scripts/download-clips.mjs`);
  }
  let manifest = JSON.parse(manifestRaw);

  await mongoose.connect(MONGODB_URI);
  const { bucket, client, publicBase } = await resolveClipsBucket(ENCRYPTION_KEY);
  const EpisodeContent = mongoose.models.EpisodeContent || mongoose.model('EpisodeContent', episodeContentSchema);

  const maxBytes = bucket.maxBytes;
  let usedBytes = await getBucketUsage(client, bucket.bucketName);

  const pending = manifest.filter((entry) => entry.status === 'downloaded');
  console.log(`Clips pendientes de migrar: ${pending.length}`);
  console.log(`Uso actual del bucket "${bucket.bucketName}": ${(usedBytes / 1000 ** 3).toFixed(2)} GB de ${(maxBytes / 1000 ** 3).toFixed(2)} GB`);

  let migrated = 0;
  const failures = [];

  for (const entry of pending) {
    try {
      const { videoUrl, usedBytes: newUsedBytes } = await migrateClip(entry, { client, bucket, publicBase, EpisodeContent, usedBytes, maxBytes });
      usedBytes = newUsedBytes;
      entry.status = 'migrated';
      delete entry.error;
      migrated += 1;
      console.log(`OK "${entry.title}" -> ${videoUrl}`);

      if (!keepLocal) {
        await unlink(entry.localVideoPath).catch(() => {});
        await unlink(entry.localThumbPath).catch(() => {});
      }
    } catch (error) {
      entry.status = 'error';
      entry.error = error.message;
      failures.push({ title: entry.title, videoId: entry.videoId, error: error.message });
      console.error(`Error con "${entry.title}": ${error.message}`);
    }

    manifest = manifest.map((m) => (m.key === entry.key ? entry : m));
    await saveManifest(manifest);
  }

  await mongoose.disconnect();

  console.log(`\nMigración completada: ${migrated} migrados, ${failures.length} con error.`);
  if (failures.length > 0) {
    console.log('Clips con error:');
    failures.forEach((f) => console.log(`  - ${f.title} (${f.videoId}): ${f.error}`));
  }
}

main().catch((err) => {
  console.error('Error en la migración:', err);
  process.exit(1);
});
