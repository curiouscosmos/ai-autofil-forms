import { PROVIDERS } from './state.js';

export function getProviderDefinition(providerId) {
  return PROVIDERS.find((provider) => provider.id === providerId) ?? PROVIDERS[0];
}

export function getDefaultModel(providerId) {
  return {
    openai: 'gpt-4o-mini',
    claude: 'claude-sonnet-4-5',
    gemini: 'gemini-2.5-flash',
    xai: 'grok-4',
    openrouter: 'openai/gpt-4o-mini',
  }[providerId] || 'gpt-4o-mini';
}

export function buildPromptPayload({ page, category, fields }) {
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

export function buildProviderRequest(providerId, apiKey, model, payload) {
  const provider = getProviderDefinition(providerId);
  const body = createRequestBody(providerId, model || getDefaultModel(providerId), payload);
  const headers = {
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

export function createRequestBody(providerId, model, payload) {
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

export async function requestAutofillPlan(providerId, apiKey, model, payload) {
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

export function extractResponseText(providerId, responseJson) {
  if (providerId === 'claude') {
    return responseJson?.content?.map?.((block) => block.text || '').join('') || '';
  }
  if (providerId === 'gemini') {
    return responseJson?.candidates?.[0]?.content?.parts?.map?.((part) => part.text || '').join('') || '';
  }
  return responseJson?.choices?.[0]?.message?.content || responseJson?.output_text || '';
}

export function parseAutofillResponse(text) {
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

