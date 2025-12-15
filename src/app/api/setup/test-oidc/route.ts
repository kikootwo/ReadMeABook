/**
 * Test OIDC Configuration Endpoint
 * Documentation: documentation/features/audiobookshelf-integration.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { Issuer } from 'openid-client';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { issuerUrl, clientId, clientSecret } = body;

    // Validate required fields
    if (!issuerUrl || !clientId || !clientSecret) {
      return NextResponse.json(
        {
          success: false,
          error: 'Issuer URL, Client ID, and Client Secret are required'
        },
        { status: 400 }
      );
    }

    // Validate issuer URL format
    try {
      new URL(issuerUrl);
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid issuer URL format'
        },
        { status: 400 }
      );
    }

    // Attempt OIDC discovery
    const issuer = await Issuer.discover(issuerUrl);

    // Validate that we got the necessary endpoints
    if (!issuer.metadata.authorization_endpoint ||
        !issuer.metadata.token_endpoint ||
        !issuer.metadata.userinfo_endpoint) {
      return NextResponse.json(
        {
          success: false,
          error: 'OIDC provider is missing required endpoints'
        },
        { status: 500 }
      );
    }

    // Return success with discovered metadata
    return NextResponse.json({
      success: true,
      issuer: {
        issuer: issuer.issuer,
        authorizationEndpoint: issuer.metadata.authorization_endpoint,
        tokenEndpoint: issuer.metadata.token_endpoint,
        userinfoEndpoint: issuer.metadata.userinfo_endpoint,
        jwksUri: issuer.metadata.jwks_uri,
        supportedScopes: issuer.metadata.scopes_supported || [],
        supportedResponseTypes: issuer.metadata.response_types_supported || [],
      },
    });
  } catch (error) {
    console.error('[Test OIDC] Discovery failed:', error);

    // Determine error message
    let errorMessage = 'OIDC discovery failed';
    if (error instanceof Error) {
      errorMessage = error.message;

      // Provide more helpful messages for common errors
      if (errorMessage.includes('ENOTFOUND') || errorMessage.includes('ECONNREFUSED')) {
        errorMessage = 'Cannot reach OIDC provider. Check the issuer URL and network connectivity.';
      } else if (errorMessage.includes('404')) {
        errorMessage = 'OIDC discovery endpoint not found. Verify the issuer URL is correct.';
      } else if (errorMessage.includes('timeout')) {
        errorMessage = 'Connection to OIDC provider timed out. Check the issuer URL.';
      }
    }

    return NextResponse.json(
      {
        success: false,
        error: errorMessage
      },
      { status: 500 }
    );
  }
}
