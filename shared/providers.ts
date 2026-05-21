import type { ProviderId } from './state.ts';
import { PROVIDERS } from './state.ts';

export type ModelOption = {
  id: string;
  label: string;
};

export function getProviderDefinition(providerId: ProviderId) {
  return PROVIDERS.find((provider) => provider.id === providerId) ?? PROVIDERS[0];
}

export function getDefaultModel(providerId: ProviderId): string {
  return {
    openai: 'gpt-4o-mini',
    claude: 'claude-sonnet-4-5',
    gemini: 'gemini-2.5-flash',
    xai: 'grok-4',
    openrouter: 'openai/gpt-4o-mini',
  }[providerId] || 'gpt-4o-mini';
}

export function buildPromptPayload({
  page,
  category,
  fields,
}: {
  page: Record<string, unknown>;
  category: { id: string; name: string; instructions: string; files: unknown[] };
  fields: unknown[];
}) {
  return {
    model: '',
    messages: [
      {
        role: 'system',
        content:
          'You fill forms. Return strict JSON with a single object named fields where each key is a field key and each value is the value to enter. Never change sensitive fields. Return empty strings for fields you cannot infer.',
      },
      {
        role: 'user',
        content: JSON.stringify({
          page,
          category: {
            id: category.id,
            name: category.name,
            instructions: category.instructions,
            files: category.files,
          },
          fields,
        }),
      },
    ],
  };
}

export function buildProviderRequest(providerId: ProviderId, apiKey: string, model: string, payload: { messages: Array<{ role: string; content: string }> }) {
  const provider = getProviderDefinition(providerId);
  const body = createRequestBody(providerId, model || getDefaultModel(providerId), payload);
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...provider.extraHeaders,
    ...(provider.authHeader === 'Authorization'
      ? { Authorization: `${provider.authPrefix || 'Bearer'} ${apiKey}` }
      : { [provider.authHeader]: apiKey }),
  };
  const url =
    providerId === 'gemini'
      ? `https://generativelanguage.googleapis.com/v1beta/models/${model || getDefaultModel(providerId)}:generateContent`
      : provider.apiBaseUrl;
  return { url, headers, body, provider };
}

export function buildModelListRequest(providerId: ProviderId, apiKey: string) {
  const provider = getProviderDefinition(providerId);
  if (providerId === 'gemini') {
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
      headers: {},
      provider,
    };
  }
  const url =
    providerId === 'xai'
      ? 'https://api.x.ai/v1/models'
      : providerId === 'openrouter'
        ? 'https://openrouter.ai/api/v1/models'
        : providerId === 'claude'
          ? 'https://api.anthropic.com/v1/models'
          : 'https://api.openai.com/v1/models';
  const headers: Record<string, string> = {
    ...provider.extraHeaders,
    ...(provider.authHeader === 'Authorization'
      ? { Authorization: `${provider.authPrefix || 'Bearer'} ${apiKey}` }
      : { [provider.authHeader]: apiKey }),
  };
  return { url, headers, provider };
}

export function createRequestBody(providerId: ProviderId, model: string, payload: { messages: Array<{ role: string; content: string }> }): string {
  if (providerId === 'claude') {
    return JSON.stringify({
      model,
      max_tokens: 1024,
      messages: payload.messages,
    });
  }
  if (providerId === 'gemini') {
    const text = payload.messages.map((message) => `${message.role.toUpperCase()}: ${message.content}`).join('\n\n');
    return JSON.stringify({
      contents: [{ role: 'user', parts: [{ text }] }],
    });
  }
  return JSON.stringify({
    model,
    messages: payload.messages,
    temperature: 0,
  });
}

export async function requestAutofillPlan(providerId: ProviderId, apiKey: string, model: string, payload: { messages: Array<{ role: string; content: string }> }): Promise<string> {
  const request = buildProviderRequest(providerId, apiKey, model, payload);
  const response = await fetch(request.url, {
    method: 'POST',
    headers: request.headers,
    body: request.body,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Provider request failed (${response.status}): ${text}`);
  }
  return extractResponseText(providerId, await response.json());
}

export async function fetchAvailableModels(providerId: ProviderId, apiKey: string): Promise<ModelOption[]> {
  const request = buildModelListRequest(providerId, apiKey);
  const response = await fetch(request.url, {
    method: 'GET',
    headers: request.headers,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Model list request failed (${response.status}): ${text}`);
  }
  return normalizeModelList(providerId, await response.json());
}

export function normalizeModelList(providerId: ProviderId, responseJson: unknown): ModelOption[] {
  const asRecord = responseJson as { data?: unknown[]; models?: unknown[] };
  const mapOpenAiLike = (items: unknown[], labelKey: 'name' | 'display_name' = 'name') =>
    items
      .filter((model): model is Record<string, unknown> => Boolean(model) && typeof model === 'object')
      .filter((model) => typeof model.id === 'string')
      .map((model) => ({
        id: String(model.id),
        label: typeof model[labelKey] === 'string' ? String(model[labelKey]) : String(model.id),
      }));

  if (providerId === 'gemini') {
    return Array.isArray(asRecord.models)
      ? asRecord.models
          .filter((model): model is Record<string, unknown> => Boolean(model) && typeof model === 'object')
          .filter((model) => typeof model.name === 'string')
          .map((model) => ({
            id: String(model.name).replace(/^models\//, ''),
            label: typeof model.displayName === 'string' ? String(model.displayName) : String(model.name).replace(/^models\//, ''),
          }))
      : [];
  }
  if (providerId === 'claude') {
    return Array.isArray(asRecord.data)
      ? asRecord.data
          .filter((model): model is Record<string, unknown> => Boolean(model) && typeof model === 'object')
          .filter((model) => typeof model.id === 'string')
          .map((model) => ({
            id: String(model.id),
            label: typeof model.display_name === 'string' ? String(model.display_name) : String(model.id),
          }))
      : [];
  }
  if (providerId === 'xai') {
    const items = Array.isArray(asRecord.data) ? asRecord.data : Array.isArray(asRecord.models) ? asRecord.models : [];
    return mapOpenAiLike(items, 'name');
  }
  if (providerId === 'openrouter') {
    return Array.isArray(asRecord.data)
      ? asRecord.data
          .filter((model): model is Record<string, unknown> => Boolean(model) && typeof model === 'object')
          .filter((model) => typeof model.id === 'string')
          .map((model) => ({
            id: String(model.id),
            label: typeof model.name === 'string' ? String(model.name) : String(model.id),
          }))
      : [];
  }
  return Array.isArray(asRecord.data)
    ? asRecord.data
        .filter((model): model is Record<string, unknown> => Boolean(model) && typeof model === 'object')
        .filter((model) => typeof model.id === 'string')
        .map((model) => ({
          id: String(model.id),
          label: String(model.id),
        }))
    : [];
}

export function extractResponseText(providerId: ProviderId, responseJson: unknown): string {
  const response = responseJson as {
    content?: Array<{ text?: string }>;
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    choices?: Array<{ message?: { content?: string } }>;
    output_text?: string;
  };
  if (providerId === 'claude') {
    return response?.content?.map?.((block) => block.text || '').join('') || '';
  }
  if (providerId === 'gemini') {
    return response?.candidates?.[0]?.content?.parts?.map?.((part) => part.text || '').join('') || '';
  }
  return response?.choices?.[0]?.message?.content || response?.output_text || '';
}

export function parseAutofillResponse(text: string): { fields: Record<string, string> } {
  if (!text) {
    return { fields: {} };
  }
  const trimmed = `${text}`.trim();
  const body = trimmed.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try {
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed === 'object' && parsed.fields && typeof parsed.fields === 'object') {
      return parsed;
    }
  } catch {
    // fall through
  }
  return { fields: {} };
}
