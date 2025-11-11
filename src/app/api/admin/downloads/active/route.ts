/**
 * Component: Admin Active Downloads API
 * Documentation: documentation/admin-dashboard.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    // Verify user is authenticated and is admin
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { role: true },
    });

    if (user?.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Get active downloads with related data
    const activeDownloads = await prisma.request.findMany({
      where: {
        status: 'downloading',
      },
      include: {
        audiobook: {
          select: {
            id: true,
            title: true,
            author: true,
          },
        },
        user: {
          select: {
            id: true,
            name: true,
          },
        },
        downloadHistory: {
          where: {
            status: 'downloading',
          },
          orderBy: {
            createdAt: 'desc',
          },
          take: 1,
          select: {
            downloadSpeed: true,
            eta: true,
          },
        },
      },
      orderBy: {
        updatedAt: 'desc',
      },
      take: 20,
    });

    // Format response
    const formatted = activeDownloads.map((download) => ({
      requestId: download.id,
      title: download.audiobook.title,
      author: download.audiobook.author,
      progress: download.progress,
      speed: download.downloadHistory[0]?.downloadSpeed || 0,
      eta: download.downloadHistory[0]?.eta || null,
      user: download.user.name,
      startedAt: download.updatedAt,
    }));

    return NextResponse.json({ downloads: formatted });
  } catch (error) {
    console.error('[Admin] Failed to fetch active downloads:', error);
    return NextResponse.json(
      { error: 'Failed to fetch active downloads' },
      { status: 500 }
    );
  }
}
