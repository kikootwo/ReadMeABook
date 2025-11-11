/**
 * Component: Admin Recent Requests API
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

    // Get recent requests
    const recentRequests = await prisma.request.findMany({
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
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 50,
    });

    // Format response
    const formatted = recentRequests.map((request) => ({
      requestId: request.id,
      title: request.audiobook.title,
      author: request.audiobook.author,
      status: request.status,
      user: request.user.name,
      createdAt: request.createdAt,
      completedAt: request.completedAt,
      errorMessage: request.errorMessage,
    }));

    return NextResponse.json({ requests: formatted });
  } catch (error) {
    console.error('[Admin] Failed to fetch recent requests:', error);
    return NextResponse.json(
      { error: 'Failed to fetch recent requests' },
      { status: 500 }
    );
  }
}
