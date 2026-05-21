import type { ProviderId } from './state.js';

export declare function getProviderDefinition(providerId: ProviderId): {
  id: ProviderId;
  label: string;
  apiBaseUrl: string;
  authHeader: string;
  authPrefix?: string;
  extraHeaders?: Record<string, string>;
};
export declare function getDefaultModel(providerId: ProviderId): string;
export type ModelOption = {
  id: string;
  label: string;
};
export declare function buildPromptPayload(input: {
  page: Record<string, unknown>;
  category: { id: string; name: string; instructions: string; files: unknown[] };
  fields: unknown[];
}): {
  model: string;
  messages: Array<{ role: string; content: string }>;
};
export declare function buildProviderRequest(
  providerId: ProviderId,
  apiKey: string,
  model: string,
  payload: { messages: Array<{ role: string; content: string }> },
): {
  url: string;
  headers: Record<string, string>;
  body: string;
  provider: ReturnType<typeof getProviderDefinition>;
  };
export declare function createRequestBody(providerId: ProviderId, model: string, payload: { messages: Array<{ role: string; content: string }> }): string;
export declare function requestAutofillPlan(providerId: ProviderId, apiKey: string, model: string, payload: { messages: Array<{ role: string; content: string }> }): Promise<string>;
export declare function buildModelListRequest(providerId: ProviderId, apiKey: string): {
  url: string;
  headers: Record<string, string>;
  provider: ReturnType<typeof getProviderDefinition>;
};
export declare function fetchAvailableModels(providerId: ProviderId, apiKey: string): Promise<ModelOption[]>;
export declare function normalizeModelList(providerId: ProviderId, responseJson: unknown): ModelOption[];
export declare function extractResponseText(providerId: ProviderId, responseJson: unknown): string;
export declare function parseAutofillResponse(text: string): { fields: Record<string, string> };
