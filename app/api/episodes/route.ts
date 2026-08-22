import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import EpisodeContent from '@/models/EpisodeContent';
import { isAuthorizedRoute } from '@/lib/api-guard';
import { logAudit } from '@/lib/audit-log';

export async function GET(request: Request) {
  const { authorized } = await isAuthorizedRoute(request);
  if (!authorized) {
    return NextResponse.json({ error: 'Acceso no autorizado' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q') || '';

  await dbConnect();
  const filter: any = { deletedAt: null };
  if (q) {
    filter.$or = [
      { title: { $regex: q, $options: 'i' } },
      { description: { $regex: q, $options: 'i' } },
      { slug: { $regex: q, $options: 'i' } },
    ];
  }
  const status = searchParams.get('status');
  if (status === 'draft' || status === 'published') {
    filter.status = status;
  }

  const episodes = await EpisodeContent.find(filter)
    .select('title description slug pubDate duration image status isPremiere author season episode tags transcription dubs')
    .sort({ pubDate: -1, createdAt: -1 })
    .lean();
  return NextResponse.json(episodes);
}

export async function POST(request: Request) {
  const { authorized, user } = await isAuthorizedRoute(request);
  if (!authorized || !user) {
    return NextResponse.json({ error: 'Acceso no autorizado' }, { status: 403 });
  }

  try {
    const data = await request.json();
    await dbConnect();

    // Auto-generate slug if not provided
    if (!data.slug && data.title) {
      data.slug = data.title
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
    }

    const episode = await EpisodeContent.create(data);

    await logAudit({
      actor: user,
      action: 'create',
      resource: 'episode',
      resourceId: episode._id.toString(),
      label: episode.title,
    });

    return NextResponse.json(episode, { status: 201 });
  } catch (error: any) {
    console.error('Error creating episode:', error);
    return NextResponse.json({ error: error.message || 'Error al crear el episodio' }, { status: 400 });
  }
}
