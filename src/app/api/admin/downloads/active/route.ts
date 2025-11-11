/**
 * Component: Admin Active Downloads API
 * Documentation: documentation/admin-dashboard.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';

export async function GET(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
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
            plexUsername: true,
          },
        },
        downloadHistory: {
          where: {
            downloadStatus: 'downloading',
          },
          orderBy: {
            createdAt: 'desc',
          },
          take: 1,
          select: {
            downloadStatus: true,
            torrentName: true,
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
      status: download.status,
      progress: download.progress,
      torrentName: download.downloadHistory[0]?.torrentName || null,
      downloadStatus: download.downloadHistory[0]?.downloadStatus || null,
      user: download.user.plexUsername,
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
    });
  });
}
