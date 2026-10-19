/**
 * BookDate: Test AI Provider Connection & Fetch Models
 * Documentation: documentation/features/bookdate-prd.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { AuthenticatedRequest, requireSetupIncompleteOrAdmin } from '@/lib/middleware/auth';
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
    'https://generativelanguage.googleapis.com/v1beta/models',
    { headers: { 'x-goog-api-key': apiKey } }
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

// Longest slice of a custom provider's response body written to the (admin-only) server log
const MAX_LOGGED_BODY_CHARS = 1000;

// Keep only well-formed model entries: a string id (or a bare string) and a string name
function toModelList(entries: unknown[]): { id: string; name: string }[] {
  const models: { id: string; name: string }[] = [];
  for (const entry of entries) {
    if (typeof entry === 'string') {
      if (entry) models.push({ id: entry, name: entry });
      continue;
    }
    if (!entry || typeof entry !== 'object') continue;
    const { id, name } = entry as { id?: unknown; name?: unknown };
    if (typeof id !== 'string' || !id) continue;
    models.push({ id, name: typeof name === 'string' && name ? name : id });
  }
  return models;
}

async function readBodyForLog(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, MAX_LOGGED_BODY_CHARS);
  } catch {
    return '';
  }
}

async function testConnection(req: NextRequest, options: { callerIsAdmin: boolean }) {
  try {
    const body = await req.json();
    const { provider, apiKey, baseUrl, useSavedKey } = body;

    // Only a signed-in admin may use the saved key (never the setup wizard)
    if (useSavedKey && !options.callerIsAdmin) {
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
      // The setup wizard only offers the built-in providers; custom URLs are admin-only
      if (!options.callerIsAdmin) {
        return NextResponse.json(
          { error: 'Custom providers can only be tested by an admin' },
          { status: 403 }
        );
      }

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

      // A saved key is only ever sent to the provider it was saved for
      if (config.provider !== provider) {
        return NextResponse.json(
          { error: 'The saved API key is for a different provider. Enter an API key to test this provider.' },
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
          // The body goes to the server log only; the caller gets the status, never the body.
          // Return 400 (not the external service's status) to prevent triggering logout on 401.
          logger.error('Custom provider connection error', {
            status: response.status,
            body: await readBodyForLog(response),
          });
          return NextResponse.json(
            { error: `Failed to connect to custom provider (HTTP ${response.status})` },
            { status: 400 }
          );
        }

        const rawBody = await response.text();
        let data: unknown;
        try {
          data = JSON.parse(rawBody);
        } catch {
          logger.error('Custom provider returned a non-JSON response', {
            body: rawBody.slice(0, MAX_LOGGED_BODY_CHARS),
          });
          return NextResponse.json(
            { error: 'Connected to the custom provider, but the response was not JSON' },
            { status: 400 }
          );
        }

        // Handle multiple response formats
        let modelsList: { id: string; name: string }[];
        const wrapped = (data as { data?: unknown } | null)?.data;
        if (Array.isArray(wrapped)) {
          // OpenAI format: { data: [...] }
          modelsList = toModelList(wrapped);
        } else if (Array.isArray(data)) {
          // Direct array format
          modelsList = toModelList(data);
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
        logger.error('Custom provider network error', { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json(
          { error: 'Could not connect to the custom provider' },
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
      { error: 'Connection test failed' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/bookdate/test-connection
 * Requires admin after setup; while setup is incomplete the setup wizard may test
 * a built-in provider with a key it supplies, without signing in.
 */
export async function POST(req: NextRequest) {
  return requireSetupIncompleteOrAdmin(req, async (request) => {
    // Set by the auth middleware after setup; absent for the unauthenticated setup wizard
    const callerIsAdmin = (request as AuthenticatedRequest).user?.role === 'admin';
    return testConnection(request, { callerIsAdmin });
  });
}
