/**
 * Component: Individual Request API Routes
 * Documentation: documentation/backend/api.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';

/**
 * GET /api/requests/[id]
 * Get a specific request by ID
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    try {
      if (!req.user) {
        return NextResponse.json(
          { error: 'Unauthorized', message: 'User not authenticated' },
          { status: 401 }
        );
      }

      const { id } = await params;

      const requestRecord = await prisma.request.findUnique({
        where: { id },
        include: {
          audiobook: true,
          user: {
            select: {
              id: true,
              plexUsername: true,
            },
          },
          downloadHistory: {
            where: { selected: true },
            take: 1,
          },
          jobs: {
            orderBy: { createdAt: 'desc' },
            take: 5,
          },
        },
      });

      if (!requestRecord) {
        return NextResponse.json(
          { error: 'NotFound', message: 'Request not found' },
          { status: 404 }
        );
      }

      // Check authorization: users can only see their own requests, admins can see all
      if (requestRecord.userId !== req.user.id && req.user.role !== 'admin') {
        return NextResponse.json(
          { error: 'Forbidden', message: 'You do not have access to this request' },
          { status: 403 }
        );
      }

      return NextResponse.json({
        success: true,
        request: requestRecord,
      });
    } catch (error) {
      console.error('Failed to get request:', error);
      return NextResponse.json(
        {
          error: 'FetchError',
          message: 'Failed to fetch request',
        },
        { status: 500 }
      );
    }
  });
}

/**
 * PATCH /api/requests/[id]
 * Update a request (cancel, retry, etc.)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    try {
      if (!req.user) {
        return NextResponse.json(
          { error: 'Unauthorized', message: 'User not authenticated' },
          { status: 401 }
        );
      }

      const { id } = await params;
      const body = await req.json();
      const { action } = body;

      const requestRecord = await prisma.request.findUnique({
        where: { id },
      });

      if (!requestRecord) {
        return NextResponse.json(
          { error: 'NotFound', message: 'Request not found' },
          { status: 404 }
        );
      }

      // Check authorization
      if (requestRecord.userId !== req.user.id && req.user.role !== 'admin') {
        return NextResponse.json(
          { error: 'Forbidden', message: 'You do not have access to this request' },
          { status: 403 }
        );
      }

      if (action === 'cancel') {
        // Cancel the request
        const updated = await prisma.request.update({
          where: { id },
          data: {
            status: 'cancelled',
            updatedAt: new Date(),
          },
          include: {
            audiobook: true,
          },
        });

        return NextResponse.json({
          success: true,
          request: updated,
          message: 'Request cancelled successfully',
        });
      } else if (action === 'retry' && req.user.role === 'admin') {
        // Retry failed request (admin only)
        const updated = await prisma.request.update({
          where: { id },
          data: {
            status: 'pending',
            progress: 0,
            errorMessage: null,
            updatedAt: new Date(),
          },
          include: {
            audiobook: true,
          },
        });

        // TODO: Trigger search job again

        return NextResponse.json({
          success: true,
          request: updated,
          message: 'Request retry initiated',
        });
      }

      return NextResponse.json(
        {
          error: 'ValidationError',
          message: 'Invalid action',
        },
        { status: 400 }
      );
    } catch (error) {
      console.error('Failed to update request:', error);
      return NextResponse.json(
        {
          error: 'UpdateError',
          message: 'Failed to update request',
        },
        { status: 500 }
      );
    }
  });
}

/**
 * DELETE /api/requests/[id]
 * Delete a request (admin only)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    try {
      if (!req.user) {
        return NextResponse.json(
          { error: 'Unauthorized', message: 'User not authenticated' },
          { status: 401 }
        );
      }

      if (req.user.role !== 'admin') {
        return NextResponse.json(
          { error: 'Forbidden', message: 'Admin access required' },
          { status: 403 }
        );
      }

      const { id } = await params;

      await prisma.request.delete({
        where: { id },
      });

      return NextResponse.json({
        success: true,
        message: 'Request deleted successfully',
      });
    } catch (error) {
      console.error('Failed to delete request:', error);
      return NextResponse.json(
        {
          error: 'DeleteError',
          message: 'Failed to delete request',
        },
        { status: 500 }
      );
    }
  });
}
