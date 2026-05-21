import type { FieldDescriptor, ProviderId } from './state.ts';
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
  console.info('[ai-autofill][llm] autofill request', {
    providerId,
    url: request.url,
    model: model || getDefaultModel(providerId),
    messageCount: payload.messages.length,
    requestBodyPreview: previewText(request.body),
  });
  try {
    const response = await fetch(request.url, {
      method: 'POST',
      headers: request.headers,
      body: request.body,
    });
    if (!response.ok) {
      const text = await response.text();
      console.error('[ai-autofill][llm] autofill request failed', {
        providerId,
        url: request.url,
        status: response.status,
        statusText: response.statusText,
        body: text,
      });
      throw new Error(`Provider request failed (${response.status}): ${text}`);
    }
    const responseJson = await response.json();
    const responseText = extractResponseText(providerId, responseJson);
    console.info('[ai-autofill][llm] autofill result', {
      providerId,
      url: request.url,
      responseTextPreview: previewText(responseText),
      responseTextLength: responseText.length,
      responseKeys: responseJson && typeof responseJson === 'object' ? Object.keys(responseJson as Record<string, unknown>) : [],
    });
    if (!responseText) {
      console.warn('[ai-autofill][llm] autofill request returned empty content', {
        providerId,
        url: request.url,
      });
    }
    return responseText;
  } catch (error) {
    console.error('[ai-autofill][llm] autofill request error', {
      providerId,
      url: request.url,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function fetchAvailableModels(providerId: ProviderId, apiKey: string): Promise<ModelOption[]> {
  const request = buildModelListRequest(providerId, apiKey);
  console.info('[ai-autofill][llm] model list request', {
    providerId,
    url: request.url,
  });
  try {
    const response = await fetch(request.url, {
      method: 'GET',
      headers: request.headers,
    });
    if (!response.ok) {
      const text = await response.text();
      console.error('[ai-autofill][llm] model list request failed', {
        providerId,
        url: request.url,
        status: response.status,
        statusText: response.statusText,
        body: text,
      });
      throw new Error(`Model list request failed (${response.status}): ${text}`);
    }
    const responseJson = await response.json();
    const models = normalizeModelList(providerId, responseJson);
    console.info('[ai-autofill][llm] model list result', {
      providerId,
      url: request.url,
      modelCount: models.length,
      responseKeys: responseJson && typeof responseJson === 'object' ? Object.keys(responseJson as Record<string, unknown>) : [],
    });
    return models;
  } catch (error) {
    console.error('[ai-autofill][llm] model list request error', {
      providerId,
      url: request.url,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
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
  const candidates = [trimmed, trimmed.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()];
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      const fields = coerceFields(parsed);
      if (Object.keys(fields).length) {
        return { fields };
      }
    } catch {
      // fall through
    }
  }
  const lines = trimmed
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const fields: Record<string, string> = {};
  for (const line of lines) {
    const match = line.match(/^([^:=]{1,80})\s*[:=]\s*(.+)$/);
    if (!match) continue;
    const key = match[1].trim();
    const value = match[2].trim().replace(/^"|"$/g, '');
    if (key && value) {
      fields[key] = value;
    }
  }
  if (Object.keys(fields).length) {
    return { fields };
  }
  return { fields: {} };
}

export function resolveAutofillFieldValue(
  fields: Record<string, string>,
  descriptor: Pick<FieldDescriptor, 'name' | 'label' | 'placeholder' | 'autocomplete' | 'fieldId'>,
  fallbackKey?: string,
  allowSingleValueFallback = false,
): string {
  const candidates = [
    fallbackKey,
    descriptor.fieldId,
    descriptor.name,
    descriptor.label,
    descriptor.placeholder,
    descriptor.autocomplete,
  ]
    .filter((value): value is string => Boolean(value && value.trim()))
    .flatMap((value) => [value, normalizeLookupKey(value)]);

  for (const candidate of candidates) {
    if (candidate in fields && fields[candidate]) {
      return fields[candidate];
    }
  }

  const normalizedFieldEntries = Object.entries(fields).map(([key, value]) => [normalizeLookupKey(key), value] as const);
  for (const candidate of candidates.map(normalizeLookupKey)) {
    const match = normalizedFieldEntries.find(([key]) => key === candidate);
    if (match?.[1]) {
      return match[1];
    }
  }

  if (allowSingleValueFallback) {
    const onlyValue = Object.values(fields).find((value) => Boolean(value));
    return onlyValue || '';
  }

  return '';
}

function normalizeLookupKey(value: string): string {
  return `${value}`
    .toLowerCase()
    .replace(/[_\s\-]+/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function previewText(value: string, limit = 500): string {
  return `${value}`.slice(0, limit);
}

function coerceFields(parsed: unknown): Record<string, string> {
  if (!parsed || typeof parsed !== 'object') {
    return {};
  }
  const record = parsed as Record<string, unknown>;
  if (record.fields && typeof record.fields === 'object' && !Array.isArray(record.fields)) {
    return coerceStringMap(record.fields as Record<string, unknown>);
  }
  if (record.data && typeof record.data === 'object' && !Array.isArray(record.data)) {
    const nested = record.data as Record<string, unknown>;
    if (nested.fields && typeof nested.fields === 'object' && !Array.isArray(nested.fields)) {
      return coerceStringMap(nested.fields as Record<string, unknown>);
    }
  }
  return coerceStringMap(record);
}

function coerceStringMap(value: Record<string, unknown>): Record<string, string> {
  const entries = Object.entries(value).filter(([, entry]) => typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean');
  return Object.fromEntries(entries.map(([key, entry]) => [key, String(entry)]));
}
