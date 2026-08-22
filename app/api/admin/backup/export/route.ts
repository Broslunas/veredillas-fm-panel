import { NextResponse } from 'next/server';
import { isAuthorizedOwnerOrAdmin } from '@/lib/api-guard';
import { exportDatabaseZip } from '@/lib/backup';
import { logAudit } from '@/lib/audit-log';

// ── GET: Download a ZIP with every collection in the database ──
export async function GET(request: Request) {
  try {
    const { authorized, user: currentUser } = await isAuthorizedOwnerOrAdmin(request);
    if (!authorized || !currentUser) {
      return NextResponse.json({ error: 'Sin permisos para exportar la base de datos' }, { status: 403 });
    }

    const zipBuffer = await exportDatabaseZip();

    await logAudit({
      actor: currentUser,
      action: 'export',
      resource: 'database_backup',
      label: 'Backup completo de la base de datos',
    });

    const filename = `backup-veredillas-fm-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;

    return new NextResponse(new Uint8Array(zipBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('Error exporting database backup:', error);
    return NextResponse.json({ error: 'Error interno al generar el backup' }, { status: 500 });
  }
}
