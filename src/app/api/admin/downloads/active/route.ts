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
    });
  });
}
