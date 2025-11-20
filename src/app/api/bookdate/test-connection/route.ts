/**
 * BookDate: Test AI Provider Connection & Fetch Models
 * Documentation: documentation/features/bookdate-prd.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthenticatedRequest } from '@/lib/middleware/auth';

async function authenticatedHandler(req: AuthenticatedRequest) {
  try {
    const body = await req.json();
    const { provider, apiKey, useSavedKey } = body;

    // Validate provider
    if (!provider) {
      return NextResponse.json(
        { error: 'Provider is required' },
        { status: 400 }
      );
    }

    if (!['openai', 'claude'].includes(provider)) {
      return NextResponse.json(
        { error: 'Invalid provider. Must be "openai" or "claude"' },
        { status: 400 }
      );
    }

    // Get API key from saved global config if useSavedKey is true
    let testApiKey = apiKey;
    if (useSavedKey && !testApiKey) {
      const { prisma } = await import('@/lib/db');
      const { getEncryptionService } = await import('@/lib/services/encryption.service');

      const config = await prisma.bookDateConfig.findFirst();

      if (!config || !config.apiKey) {
        return NextResponse.json(
          { error: 'No saved API key found' },
          { status: 400 }
        );
      }

      const encryptionService = getEncryptionService();
      testApiKey = encryptionService.decrypt(config.apiKey);
    }

    if (!testApiKey) {
      return NextResponse.json(
        { error: 'API key is required' },
        { status: 400 }
      );
    }

    let models = [];

    if (provider === 'openai') {
      // OpenAI: Fetch models from API
      const response = await fetch('https://api.openai.com/v1/models', {
        headers: {
          'Authorization': `Bearer ${testApiKey}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[BookDate] OpenAI API error:', errorText);
        return NextResponse.json(
          { error: 'Invalid OpenAI API key or connection failed' },
          { status: 400 }
        );
      }

      const data = await response.json();

      // Filter to relevant GPT models
      models = data.data
        .filter((m: any) => m.id.startsWith('gpt-') && m.id.includes('4'))
        .map((m: any) => ({
          id: m.id,
          name: m.id,
        }))
        .sort((a: any, b: any) => a.name.localeCompare(b.name));

    } else if (provider === 'claude') {
      // Claude: Hardcoded list (Anthropic doesn't have a public models API endpoint)
      models = [
        { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5 (Latest)' },
        { id: 'claude-3-7-sonnet-20250219', name: 'Claude 3.7 Sonnet' },
        { id: 'claude-opus-4-20250514', name: 'Claude Opus 4' },
        { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku' },
      ];

      // Test connection with a simple API call
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': testApiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-3-5-haiku-20241022',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'Test' }],
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[BookDate] Claude API error:', errorText);
        return NextResponse.json(
          { error: 'Invalid Claude API key or connection failed' },
          { status: 400 }
        );
      }
    }

    return NextResponse.json({
      success: true,
      models,
      provider,
    });

  } catch (error: any) {
    console.error('[BookDate] Test connection error:', error);
    return NextResponse.json(
      { error: error.message || 'Connection test failed' },
      { status: 500 }
    );
  }
}

// Unauthenticated handler for setup wizard
async function unauthenticatedHandler(req: NextRequest) {
  try {
    const body = await req.json();
    const { provider, apiKey, useSavedKey } = body;

    // During setup, useSavedKey should not be used (no auth context)
    if (useSavedKey) {
      return NextResponse.json(
        { error: 'Authentication required to use saved API key' },
        { status: 401 }
      );
    }

    // Validate provider
    if (!provider) {
      return NextResponse.json(
        { error: 'Provider is required' },
        { status: 400 }
      );
    }

    if (!['openai', 'claude'].includes(provider)) {
      return NextResponse.json(
        { error: 'Invalid provider. Must be "openai" or "claude"' },
        { status: 400 }
      );
    }

    if (!apiKey) {
      return NextResponse.json(
        { error: 'API key is required' },
        { status: 400 }
      );
    }

    let models = [];

    if (provider === 'openai') {
      // OpenAI: Fetch models from API
      const response = await fetch('https://api.openai.com/v1/models', {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[BookDate] OpenAI API error:', errorText);
        return NextResponse.json(
          { error: 'Invalid OpenAI API key or connection failed' },
          { status: 400 }
        );
      }

      const data = await response.json();

      // Filter to relevant GPT models
      models = data.data
        .filter((m: any) => m.id.startsWith('gpt-') && m.id.includes('4'))
        .map((m: any) => ({
          id: m.id,
          name: m.id,
        }))
        .sort((a: any, b: any) => a.name.localeCompare(b.name));

    } else if (provider === 'claude') {
      // Claude: Hardcoded list (Anthropic doesn't have a public models API endpoint)
      models = [
        { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5 (Latest)' },
        { id: 'claude-3-7-sonnet-20250219', name: 'Claude 3.7 Sonnet' },
        { id: 'claude-opus-4-20250514', name: 'Claude Opus 4' },
        { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku' },
      ];

      // Test connection with a simple API call
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-3-5-haiku-20241022',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'Test' }],
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[BookDate] Claude API error:', errorText);
        return NextResponse.json(
          { error: 'Invalid Claude API key or connection failed' },
          { status: 400 }
        );
      }
    }

    return NextResponse.json({
      success: true,
      models,
      provider,
    });

  } catch (error: any) {
    console.error('[BookDate] Test connection error:', error);
    return NextResponse.json(
      { error: error.message || 'Connection test failed' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  // Check if request has authorization header
  const authHeader = req.headers.get('authorization');

  if (authHeader) {
    // Authenticated request (from settings page)
    return requireAuth(req, authenticatedHandler);
  } else {
    // Unauthenticated request (from setup wizard)
    return unauthenticatedHandler(req);
  }
}
