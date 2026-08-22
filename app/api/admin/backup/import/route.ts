import { NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/api-guard';
import { importDatabaseZip } from '@/lib/backup';
import { logAudit } from '@/lib/audit-log';

const CONFIRMATION_PHRASE = 'RESTAURAR BASE DE DATOS';

// ── POST: Restore the ENTIRE database from a backup ZIP ──
//
// Hard-coded to `owner` only, deliberately bypassing the granular permissions
// system in lib/permissions.ts — this is destructive enough that it must not
// depend on a per-user permission override ever being able to grant it.
export async function POST(request: Request) {
  try {
    const currentUser = await getAuthUser(request);
    if (!currentUser || currentUser.role !== 'owner') {
      return NextResponse.json(
        { error: 'Solo el propietario puede restaurar copias de seguridad' },
        { status: 403 }
      );
    }

    const formData = await request.formData();
    const file = formData.get('file');
    const confirmation = formData.get('confirmation');

    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: 'Falta el archivo ZIP a restaurar' }, { status: 400 });
    }
    if (typeof confirmation !== 'string' || confirmation !== CONFIRMATION_PHRASE) {
      return NextResponse.json(
        { error: `Debes escribir exactamente "${CONFIRMATION_PHRASE}" para confirmar` },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const { collections, documents } = await importDatabaseZip(buffer);

    await logAudit({
      actor: currentUser,
      action: 'restore',
      resource: 'database_backup',
      label: 'Restauración completa de la base de datos',
      metadata: { collections, documents },
    });

    return NextResponse.json({ success: true, collections, documents });
  } catch (error) {
    console.error('Error importing database backup:', error);
    const message = error instanceof Error ? error.message : 'Error interno al restaurar el backup';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
