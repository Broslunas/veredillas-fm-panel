import dbConnect from '@/lib/mongodb';
import R2Bucket, { IR2Bucket } from '@/models/R2Bucket';
import User from '@/models/User';
import { STORAGE_ALERT_LEVELS, getActiveAlertThreshold, getAlertLevelForThreshold, StorageAlertLevel } from '@/lib/storage-alert-levels';

function formatGB(bytes: number): string {
  // Base decimal (1000), igual que el dashboard de Cloudflare R2 (no GiB/1024^3).
  return `${(bytes / 1000 ** 3).toFixed(2)} GB`;
}

async function sendStorageAlertEmail(
  recipients: { email: string; name: string }[],
  bucketLabel: string,
  level: StorageAlertLevel,
  totalBytes: number,
  maxBytes: number,
  percentUsed: number
) {
  const apiKeyPublic = process.env.MJ_APIKEY_PUBLIC;
  const apiKeyPrivate = process.env.MJ_API_SECRET;

  const subject = `${level.emoji} ${level.label}: el bucket "${bucketLabel}" está al ${percentUsed.toFixed(0)}% de su capacidad`;
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #09090b; color: #f4f4f5; padding: 40px 20px; border-radius: 12px; max-width: 520px; margin: 0 auto; border: 1px solid #27272a;">
      <h2 style="color: ${level.color}; font-size: 20px; margin-top: 0; margin-bottom: 16px;">${level.emoji} ${level.label} de almacenamiento</h2>
      <p style="color: #a1a1aa; font-size: 14px; line-height: 1.6; margin-bottom: 8px;">
        El bucket <strong style="color: #f4f4f5;">${bucketLabel}</strong> ha alcanzado el <strong style="color: ${level.color};">${percentUsed.toFixed(1)}%</strong> de su límite de almacenamiento.
      </p>
      <p style="color: #71717a; font-size: 13px; line-height: 1.6; margin-bottom: 24px;">
        Uso actual: ${formatGB(totalBytes)} de ${formatGB(maxBytes)}.
      </p>
      <p style="color: #71717a; font-size: 12px; line-height: 1.5; margin-bottom: 0;">
        Recibes este aviso porque tienes un rol de administrador o propietario en el Panel Veredillas FM. Gestiona el bucket desde la sección "Buckets R2" del panel.
      </p>
    </div>
  `;

  if (!apiKeyPublic || !apiKeyPrivate) {
    console.warn(
      `Mailjet API keys not fully configured. Simulating storage alert email for "${bucketLabel}" (${percentUsed.toFixed(0)}%) to ${recipients
        .map((r) => r.email)
        .join(', ')}`
    );
    return;
  }

  const authHeader = 'Basic ' + Buffer.from(`${apiKeyPublic}:${apiKeyPrivate}`).toString('base64');

  const response = await fetch('https://api.mailjet.com/v3.1/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authHeader },
    body: JSON.stringify({
      Messages: recipients.map((recipient) => ({
        From: { Email: 'contacto@broslunas.com', Name: 'Veredillas FM Panel' },
        To: [{ Email: recipient.email, Name: recipient.name || recipient.email.split('@')[0] }],
        Subject: subject,
        HTMLPart: html,
      })),
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error('Mailjet API error sending storage alert:', errText);
  }
}

async function sendUploadBlockedEmail(
  recipients: { email: string; name: string }[],
  bucketLabel: string,
  attemptedBytes: number,
  currentBytes: number,
  maxBytes: number,
  fileName?: string
) {
  const apiKeyPublic = process.env.MJ_APIKEY_PUBLIC;
  const apiKeyPrivate = process.env.MJ_API_SECRET;

  const subject = `🚫 Subida cancelada: el bucket "${bucketLabel}" ha alcanzado su límite`;
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #09090b; color: #f4f4f5; padding: 40px 20px; border-radius: 12px; max-width: 520px; margin: 0 auto; border: 1px solid #27272a;">
      <h2 style="color: #ef4444; font-size: 20px; margin-top: 0; margin-bottom: 16px;">🚫 Subida cancelada</h2>
      <p style="color: #a1a1aa; font-size: 14px; line-height: 1.6; margin-bottom: 8px;">
        Se ha intentado subir ${fileName ? `el archivo <strong style="color: #f4f4f5;">${fileName}</strong>` : 'un archivo'} (${formatGB(
    attemptedBytes
  )}) al bucket <strong style="color: #f4f4f5;">${bucketLabel}</strong>, pero se ha cancelado porque superaría su límite de almacenamiento.
      </p>
      <p style="color: #71717a; font-size: 13px; line-height: 1.6; margin-bottom: 24px;">
        Uso actual: ${formatGB(currentBytes)} de ${formatGB(maxBytes)}.
      </p>
      <p style="color: #71717a; font-size: 12px; line-height: 1.5; margin-bottom: 0;">
        Recibes este aviso porque tienes un rol de administrador o propietario en el Panel Veredillas FM. Libera espacio o amplía el límite desde la sección "Buckets R2" del panel.
      </p>
    </div>
  `;

  if (!apiKeyPublic || !apiKeyPrivate) {
    console.warn(
      `Mailjet API keys not fully configured. Simulating upload-blocked email for "${bucketLabel}" to ${recipients
        .map((r) => r.email)
        .join(', ')}`
    );
    return;
  }

  const authHeader = 'Basic ' + Buffer.from(`${apiKeyPublic}:${apiKeyPrivate}`).toString('base64');

  const response = await fetch('https://api.mailjet.com/v3.1/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authHeader },
    body: JSON.stringify({
      Messages: recipients.map((recipient) => ({
        From: { Email: 'contacto@broslunas.com', Name: 'Veredillas FM Panel' },
        To: [{ Email: recipient.email, Name: recipient.name || recipient.email.split('@')[0] }],
        Subject: subject,
        HTMLPart: html,
      })),
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error('Mailjet API error sending upload-blocked alert:', errText);
  }
}

const UPLOAD_BLOCKED_COOLDOWN_MS = 10 * 60 * 1000; // evita reenviar en ráfagas de subidas fallidas repetidas

type BlockableBucket = Pick<IR2Bucket, '_id' | 'label' | 'maxBytes'> & { lastUploadBlockedAt?: Date | null };

// Notifica a admins/owners cuando una subida se cancela por superar el límite del bucket.
export async function notifyUploadBlocked(
  bucket: BlockableBucket,
  attemptedBytes: number,
  currentBytes: number,
  fileName?: string
): Promise<void> {
  try {
    const lastBlockedAt = bucket.lastUploadBlockedAt ? new Date(bucket.lastUploadBlockedAt).getTime() : 0;
    if (Date.now() - lastBlockedAt < UPLOAD_BLOCKED_COOLDOWN_MS) return;

    await dbConnect();

    const admins = await User.find({ role: { $in: ['admin', 'owner'] } }, 'email name').lean();
    if (admins.length > 0) {
      await sendUploadBlockedEmail(
        admins.map((admin) => ({ email: admin.email, name: admin.name })),
        bucket.label,
        attemptedBytes,
        currentBytes,
        bucket.maxBytes,
        fileName
      );
    }

    await R2Bucket.findByIdAndUpdate(bucket._id, { lastUploadBlockedAt: new Date() });
  } catch (error) {
    console.error(`Error notificando subida cancelada en el bucket "${bucket.label}":`, error);
  }
}

type AlertableBucket = Pick<IR2Bucket, '_id' | 'label' | 'maxBytes'> & { lastAlertThreshold?: number };

// Comprueba si el uso del bucket ha cruzado uno de los niveles de aviso (75% / 83% / 90% / 98%)
// y, si es así, notifica por email a admins/owners. No reenvía el mismo nivel dos veces,
// y si el uso baja por debajo de un nivel ya notificado, se rearma para volver a avisar
// si vuelve a subir.
export async function checkAndSendStorageAlert(bucket: AlertableBucket, totalBytes: number): Promise<void> {
  try {
    if (!bucket.maxBytes || bucket.maxBytes <= 0) return;

    const percentUsed = (totalBytes / bucket.maxBytes) * 100;
    const activeThreshold = getActiveAlertThreshold(percentUsed);
    const previousThreshold = bucket.lastAlertThreshold ?? 0;

    if (activeThreshold === previousThreshold) return;

    await dbConnect();

    if (activeThreshold < previousThreshold) {
      await R2Bucket.findByIdAndUpdate(bucket._id, { lastAlertThreshold: activeThreshold });
      return;
    }

    const level = getAlertLevelForThreshold(activeThreshold);
    if (!level) return;

    const admins = await User.find({ role: { $in: ['admin', 'owner'] } }, 'email name').lean();
    if (admins.length > 0) {
      await sendStorageAlertEmail(
        admins.map((admin) => ({ email: admin.email, name: admin.name })),
        bucket.label,
        level,
        totalBytes,
        bucket.maxBytes,
        percentUsed
      );
    }

    await R2Bucket.findByIdAndUpdate(bucket._id, { lastAlertThreshold: activeThreshold, lastAlertAt: new Date() });
  } catch (error) {
    console.error(`Error comprobando/enviando aviso de almacenamiento para el bucket "${bucket.label}":`, error);
  }
}

export { STORAGE_ALERT_LEVELS };
