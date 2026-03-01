/**
 * BookDate: Test AI Provider Connection & Fetch Models
 * Documentation: documentation/features/bookdate-prd.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthenticatedRequest } from '@/lib/middleware/auth';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('API.BookDate.TestConnection');

// Fetch available Claude models from the Anthropic API
async function fetchClaudeModels(apiKey: string): Promise<{ id: string; name: string }[]> {
  const allModels: { id: string; name: string }[] = [];
  let afterId: string | undefined;

  // Paginate through all available models
  do {
    const params = new URLSearchParams({ limit: '1000' });
    if (afterId) {
      params.set('after_id', afterId);
    }

    const response = await fetch(
      `https://api.anthropic.com/v1/models?${params.toString()}`,
      {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Claude API error', { error: errorText });
      throw new Error('Invalid Claude API key or connection failed');
    }

    const data = await response.json();

    for (const model of data.data) {
      allModels.push({
        id: model.id,
        name: model.display_name || model.id,
      });
    }

    afterId = data.has_more ? data.last_id : undefined;
  } while (afterId);

  return allModels;
}

// Fetch available Gemini models from the Google API
async function fetchGeminiModels(apiKey: string): Promise<{ id: string; name: string }[]> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
  );

  if (!response.ok) {
    const errorText = await response.text();
    logger.error('Gemini API error', { error: errorText });
    throw new Error('Invalid Gemini API key or connection failed');
  }

  const data = await response.json();

  return (data.models || [])
    .filter((m: any) => m.name?.startsWith('models/gemini-') && m.supportedGenerationMethods?.includes('generateContent'))
    .map((m: any) => ({
      id: m.name.replace('models/', ''),
      name: m.displayName || m.name.replace('models/', ''),
    }))
    .sort((a: any, b: any) => a.name.localeCompare(b.name));
}

// Helper functions for custom provider
function isValidBaseUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/$/, ''); // Remove trailing slash
}

async function authenticatedHandler(req: AuthenticatedRequest) {
  try {
    const body = await req.json();
    const { provider, apiKey, baseUrl, useSavedKey } = body;

    // Validate provider
    if (!provider) {
      return NextResponse.json(
        { error: 'Provider is required' },
        { status: 400 }
      );
    }

    if (!['openai', 'claude', 'custom', 'gemini'].includes(provider)) {
      return NextResponse.json(
        { error: 'Invalid provider. Must be "openai", "claude", "custom", or "gemini"' },
        { status: 400 }
      );
    }

    // Custom provider requires baseUrl
    if (provider === 'custom') {
      if (!baseUrl && !useSavedKey) {
        return NextResponse.json(
          { error: 'Base URL is required for custom provider' },
          { status: 400 }
        );
      }

      const urlToValidate = useSavedKey ? null : baseUrl; // Will check saved URL later if useSavedKey
      if (urlToValidate && !isValidBaseUrl(urlToValidate)) {
        return NextResponse.json(
          { error: 'Invalid base URL format. Must start with http:// or https://' },
          { status: 400 }
        );
      }
    }

    // Get API key and baseUrl from saved global config if useSavedKey is true
    let testApiKey = apiKey;
    let testBaseUrl = baseUrl;
    if (useSavedKey) {
      const { prisma } = await import('@/lib/db');
      const { getEncryptionService } = await import('@/lib/services/encryption.service');

      const config = await prisma.bookDateConfig.findFirst();

      if (!config || !config.apiKey) {
        return NextResponse.json(
          { error: 'No saved configuration found' },
          { status: 400 }
        );
      }

      const encryptionService = getEncryptionService();
      try {
        testApiKey = encryptionService.decrypt(config.apiKey);
      } catch {
        // Allow empty API key for custom provider
        if (provider !== 'custom') {
          return NextResponse.json(
            { error: 'Failed to decrypt saved API key' },
            { status: 500 }
          );
        }
        testApiKey = '';
      }

      if (provider === 'custom') {
        testBaseUrl = config.baseUrl || '';
        if (!testBaseUrl) {
          return NextResponse.json(
            { error: 'No saved base URL found for custom provider' },
            { status: 400 }
          );
        }
      }
    }

    // API key required for OpenAI and Claude
    if (!testApiKey && provider !== 'custom') {
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
        logger.error('OpenAI API error', { error: errorText });
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
      // Claude: Fetch models dynamically from the Anthropic Models API
      try {
        models = await fetchClaudeModels(testApiKey);
      } catch {
        return NextResponse.json(
          { error: 'Invalid Claude API key or connection failed' },
          { status: 400 }
        );
      }
    } else if (provider === 'gemini') {
      // Gemini: Fetch models dynamically from the Google API
      try {
        models = await fetchGeminiModels(testApiKey);
      } catch {
        return NextResponse.json(
          { error: 'Invalid Gemini API key or connection failed' },
          { status: 400 }
        );
      }
    } else if (provider === 'custom') {
      // Custom: Fetch models from custom OpenAI-compatible endpoint
      const normalizedUrl = normalizeBaseUrl(testBaseUrl);
      const modelsEndpoint = normalizedUrl + '/models';

      const headers: Record<string, string> = {};
      if (testApiKey) {
        headers['Authorization'] = `Bearer ${testApiKey}`;
      }

      try {
        const response = await fetch(modelsEndpoint, {
          method: 'GET',
          headers,
        });

        if (!response.ok) {
          const errorText = await response.text();
          logger.error('Custom provider connection error', { error: errorText });
          // Return 400 (not the external service's status) to prevent triggering logout on 401
          return NextResponse.json(
            { error: `Failed to connect to custom provider: ${response.status} ${errorText}` },
            { status: 400 }
          );
        }

        const data = await response.json();

        // Handle multiple response formats
        let modelsList = [];
        if (Array.isArray(data?.data)) {
          // OpenAI format: { data: [...] }
          modelsList = data.data.map((m: any) => ({
            id: m.id,
            name: m.name || m.id,
          }));
        } else if (Array.isArray(data)) {
          // Direct array format
          modelsList = data.map((m: any) => ({
            id: m.id || m,
            name: m.name || m.id || m,
          }));
        } else {
          // Unable to parse, but connection successful
          return NextResponse.json({
            success: true,
            models: [],
            message: 'Connected successfully but could not parse models list. You may need to enter model name manually.',
          });
        }

        models = modelsList;
      } catch (error: any) {
        logger.error('Custom provider network error', { error: error.message });
        return NextResponse.json(
          { error: `Network error connecting to custom provider: ${error.message}` },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({
      success: true,
      models,
      provider,
    });

  } catch (error: any) {
    logger.error('Test connection error', { error: error instanceof Error ? error.message : String(error) });
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
    const { provider, apiKey, baseUrl, useSavedKey } = body;

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

    if (!['openai', 'claude', 'custom', 'gemini'].includes(provider)) {
      return NextResponse.json(
        { error: 'Invalid provider. Must be "openai", "claude", "custom", or "gemini"' },
        { status: 400 }
      );
    }

    // Custom provider requires baseUrl
    if (provider === 'custom') {
      if (!baseUrl) {
        return NextResponse.json(
          { error: 'Base URL is required for custom provider' },
          { status: 400 }
        );
      }

      if (!isValidBaseUrl(baseUrl)) {
        return NextResponse.json(
          { error: 'Invalid base URL format. Must start with http:// or https://' },
          { status: 400 }
        );
      }
    }

    // API key required for OpenAI and Claude
    if (!apiKey && provider !== 'custom') {
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
        logger.error('OpenAI API error', { error: errorText });
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
      // Claude: Fetch models dynamically from the Anthropic Models API
      try {
        models = await fetchClaudeModels(apiKey);
      } catch {
        return NextResponse.json(
          { error: 'Invalid Claude API key or connection failed' },
          { status: 400 }
        );
      }
    } else if (provider === 'gemini') {
      // Gemini: Fetch models dynamically
      try {
        models = await fetchGeminiModels(apiKey);
      } catch {
        return NextResponse.json(
          { error: 'Invalid Gemini API key or connection failed' },
          { status: 400 }
        );
      }
    } else if (provider === 'custom') {
      // Custom: Fetch models from custom OpenAI-compatible endpoint
      const normalizedUrl = normalizeBaseUrl(baseUrl);
      const modelsEndpoint = normalizedUrl + '/models';

      const headers: Record<string, string> = {};
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      try {
        const response = await fetch(modelsEndpoint, {
          method: 'GET',
          headers,
        });

        if (!response.ok) {
          const errorText = await response.text();
          logger.error('Custom provider connection error', { error: errorText });
          // Return 400 (not the external service's status) to prevent triggering logout on 401
          return NextResponse.json(
            { error: `Failed to connect to custom provider: ${response.status} ${errorText}` },
            { status: 400 }
          );
        }

        const data = await response.json();

        // Handle multiple response formats
        let modelsList = [];
        if (Array.isArray(data?.data)) {
          // OpenAI format: { data: [...] }
          modelsList = data.data.map((m: any) => ({
            id: m.id,
            name: m.name || m.id,
          }));
        } else if (Array.isArray(data)) {
          // Direct array format
          modelsList = data.map((m: any) => ({
            id: m.id || m,
            name: m.name || m.id || m,
          }));
        } else {
          // Unable to parse, but connection successful
          return NextResponse.json({
            success: true,
            models: [],
            message: 'Connected successfully but could not parse models list. You may need to enter model name manually.',
          });
        }

        models = modelsList;
      } catch (error: any) {
        logger.error('Custom provider network error', { error: error.message });
        return NextResponse.json(
          { error: `Network error connecting to custom provider: ${error.message}` },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({
      success: true,
      models,
      provider,
    });

  } catch (error: any) {
    logger.error('Test connection error', { error: error instanceof Error ? error.message : String(error) });
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
