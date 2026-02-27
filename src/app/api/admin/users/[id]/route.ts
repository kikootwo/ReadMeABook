/**
 * Component: Admin User Update API
 * Documentation: documentation/admin-dashboard.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('API.Admin.Users');

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const { id } = await params;
        const body = await request.json();
        const { role, autoApproveRequests, interactiveSearchAccess, downloadAccess } = body;

        // Validate role
        if (!role || (role !== 'user' && role !== 'admin')) {
          return NextResponse.json(
            { error: 'Invalid role. Must be "user" or "admin"' },
            { status: 400 }
          );
        }

        // Validate autoApproveRequests (optional)
        if (autoApproveRequests !== undefined && autoApproveRequests !== null && typeof autoApproveRequests !== 'boolean') {
          return NextResponse.json(
            { error: 'Invalid autoApproveRequests. Must be a boolean or null' },
            { status: 400 }
          );
        }

        // Validate interactiveSearchAccess (optional)
        if (interactiveSearchAccess !== undefined && interactiveSearchAccess !== null && typeof interactiveSearchAccess !== 'boolean') {
          return NextResponse.json(
            { error: 'Invalid interactiveSearchAccess. Must be a boolean or null' },
            { status: 400 }
          );
        }

        // Validate downloadAccess (optional)
        if (downloadAccess !== undefined && downloadAccess !== null && typeof downloadAccess !== 'boolean') {
          return NextResponse.json(
            { error: 'Invalid downloadAccess. Must be a boolean or null' },
            { status: 400 }
          );
        }

        // Prevent user from demoting themselves
        if (req.user && id === req.user.sub) {
          return NextResponse.json(
            { error: 'You cannot change your own role' },
            { status: 403 }
          );
        }

        // Check if user is the setup admin, OIDC user, or deleted
        const targetUser = await prisma.user.findUnique({
          where: { id },
          select: {
            isSetupAdmin: true,
            authProvider: true,
            plexUsername: true,
            deletedAt: true,
            role: true, // Need current role to detect role changes
          },
        });

        if (!targetUser) {
          return NextResponse.json(
            { error: 'User not found' },
            { status: 404 }
          );
        }

        // Prevent changing deleted users
        if (targetUser.deletedAt) {
          return NextResponse.json(
            { error: 'Cannot modify a deleted user' },
            { status: 403 }
          );
        }

        // Detect if role is being changed
        const isRoleChange = targetUser.role !== role;

        // Prevent changing setup admin role (only if role is actually being changed)
        if (targetUser.isSetupAdmin && isRoleChange && role !== 'admin') {
          return NextResponse.json(
            { error: 'Cannot change the setup admin role. This account must always remain an admin.' },
            { status: 403 }
          );
        }

        // Prevent changing OIDC user roles (only if role is actually being changed)
        if (targetUser.authProvider === 'oidc' && isRoleChange) {
          return NextResponse.json(
            { error: 'Cannot change OIDC user roles. Use admin role mapping in OIDC settings instead.' },
            { status: 403 }
          );
        }

        // Validate that admins cannot have permissions set to false
        if (role === 'admin' && autoApproveRequests === false) {
          return NextResponse.json(
            { error: 'Admins must always auto-approve requests. Cannot set autoApproveRequests to false for admin users.' },
            { status: 400 }
          );
        }
        if (role === 'admin' && interactiveSearchAccess === false) {
          return NextResponse.json(
            { error: 'Admins always have interactive search access. Cannot set interactiveSearchAccess to false for admin users.' },
            { status: 400 }
          );
        }
        if (role === 'admin' && downloadAccess === false) {
          return NextResponse.json(
            { error: 'Admins always have download access. Cannot set downloadAccess to false for admin users.' },
            { status: 400 }
          );
        }

        // Prepare update data
        const updateData: { role: string; autoApproveRequests?: boolean | null; interactiveSearchAccess?: boolean | null; downloadAccess?: boolean | null } = { role };
        if (autoApproveRequests !== undefined) {
          updateData.autoApproveRequests = autoApproveRequests;
        }
        if (interactiveSearchAccess !== undefined) {
          updateData.interactiveSearchAccess = interactiveSearchAccess;
        }
        if (downloadAccess !== undefined) {
          updateData.downloadAccess = downloadAccess;
        }

        // Update user
        const updatedUser = await prisma.user.update({
          where: { id },
          data: updateData,
          select: {
            id: true,
            plexUsername: true,
            role: true,
            autoApproveRequests: true,
            interactiveSearchAccess: true,
            downloadAccess: true,
          },
        });

        return NextResponse.json({ user: updatedUser });
      } catch (error) {
        logger.error('Failed to update user', { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json(
          { error: 'Failed to update user' },
          { status: 500 }
        );
      }
    });
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const { id } = await params;

        // Prevent user from deleting themselves
        if (req.user && id === req.user.sub) {
          return NextResponse.json(
            { error: 'You cannot delete your own account' },
            { status: 403 }
          );
        }

        // Check if user exists and get their details
        const targetUser = await prisma.user.findUnique({
          where: { id },
          select: {
            id: true,
            plexUsername: true,
            isSetupAdmin: true,
            authProvider: true,
            deletedAt: true,
            _count: {
              select: { requests: true },
            },
          },
        });

        if (!targetUser) {
          return NextResponse.json(
            { error: 'User not found' },
            { status: 404 }
          );
        }

        // Check if user is already deleted
        if (targetUser.deletedAt) {
          return NextResponse.json(
            { error: 'User has already been deleted' },
            { status: 400 }
          );
        }

        // Prevent deleting setup admin
        if (targetUser.isSetupAdmin) {
          return NextResponse.json(
            { error: 'Cannot delete the setup admin account. This account is protected.' },
            { status: 403 }
          );
        }

        // Only allow deleting local users (manual registration)
        if (targetUser.authProvider !== 'local') {
          const providerName = targetUser.authProvider === 'plex' ? 'Plex' :
                               targetUser.authProvider === 'oidc' ? 'OIDC' :
                               targetUser.authProvider || 'external';
          return NextResponse.json(
            {
              error: `Cannot delete ${providerName} users. User access is managed by ${providerName}.`
            },
            { status: 403 }
          );
        }

        // Soft-delete user (preserves their requests and history)
        // Append timestamp to plexId to free it up for reuse (allows username reuse)
        const timestamp = Date.now();
        await prisma.user.update({
          where: { id },
          data: {
            deletedAt: new Date(),
            deletedBy: req.user?.sub || null,
            plexId: `local-${targetUser.plexUsername}-deleted-${timestamp}`,
          },
        });

        return NextResponse.json({
          success: true,
          message: `User "${targetUser.plexUsername}" has been deleted. Their ${targetUser._count.requests} request(s) have been preserved.`
        });
      } catch (error) {
        logger.error('Failed to delete user', { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json(
          { error: 'Failed to delete user' },
          { status: 500 }
        );
      }
    });
  });
}
