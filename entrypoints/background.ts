import {
  type FieldDescriptor,
  STORAGE_KEY,
  buildAutofillPlan,
  buildStoragePatch,
  createDefaultState,
  normalizeState,
  setMemoryEntry,
} from '@/shared/state';
import { buildPromptPayload, parseAutofillResponse, resolveAutofillFieldValue, requestAutofillPlan } from '@/shared/providers';

type Message =
  | { type: 'get-state' }
  | { type: 'set-state'; patch: Record<string, unknown> }
  | { type: 'save-memory'; descriptor: Record<string, unknown>; value: string }
  | { type: 'autofill-form'; page: Record<string, unknown>; descriptors: Record<string, unknown>[] };

async function readState() {
  const result = await browser.storage.local.get(STORAGE_KEY);
  return normalizeState(result[STORAGE_KEY] ?? createDefaultState());
}

async function writeState(nextState: unknown) {
  await browser.storage.local.set({ [STORAGE_KEY]: normalizeState(nextState) });
}

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(async () => {
    const current = await browser.storage.local.get(STORAGE_KEY);
    if (!current[STORAGE_KEY]) {
      await writeState(createDefaultState());
    } else {
      await writeState(current[STORAGE_KEY]);
    }
  });

  browser.runtime.onMessage.addListener((message: Message) => {
    if (!message || typeof message !== 'object') {
      return undefined;
    }
    return handleMessage(message);
  });
});

async function handleMessage(message: Message) {
  const state = await readState();
  if (message.type === 'get-state') {
    return state;
  }
  if (message.type === 'set-state') {
    const next = buildStoragePatch(state, message.patch);
    await writeState(next);
    return next;
  }
  if (message.type === 'save-memory') {
    const next = setMemoryEntry(state, message.descriptor as any, message.value);
    await writeState(next);
    return next;
  }
  if (message.type === 'autofill-form') {
    const normalized = normalizeState(state);
    const settings = normalized.settings;
    const activeCategory = normalized.categories.find((category) => category.id === normalized.activeCategoryId) ?? normalized.categories[0];
    const providerId = settings.provider;
    const apiKey = settings.apiKeys?.[providerId];
    const model = (settings.models as Record<string, string | undefined>)?.[providerId] ?? '';
    const descriptors = message.descriptors as unknown as FieldDescriptor[];
    const payload = buildPromptPayload({
      page: message.page,
      category: activeCategory,
      fields: descriptors as any,
    });
    const fallbackPlan = buildAutofillPlan(normalized, descriptors);
    console.info('[ai-autofill][llm] autofill pipeline started', {
      providerId,
      model: model || '',
      fieldCount: descriptors.length,
      categoryId: activeCategory?.id,
    });
    if (!apiKey) {
      console.warn('[ai-autofill][llm] autofill falling back to memory because no api key is configured', {
        providerId,
        categoryId: activeCategory?.id,
      });
      return { plan: fallbackPlan, source: 'memory-only', prompt: payload };
    }
    try {
      const responseText = await requestAutofillPlan(providerId, apiKey, model, payload);
      const parsed = parseAutofillResponse(responseText);
      console.info('[ai-autofill][llm] autofill response received', {
        providerId,
        model: model || '',
        responseLength: responseText.length,
        parsedFieldCount: Object.keys(parsed.fields || {}).length,
      });
      if (!Object.keys(parsed.fields || {}).length && responseText.trim()) {
        console.warn('[ai-autofill][llm] autofill response could not be parsed into fields', {
          providerId,
          model: model || '',
          responsePreview: responseText.slice(0, 500),
        });
      }
      const fields = parsed.fields as Record<string, string>;
      const plan = descriptors.map((descriptor, index) => {
        const key = fallbackPlan[index]?.key;
        const proposed =
          resolveAutofillFieldValue(fields, descriptor, key, descriptors.length === 1) ||
          fallbackPlan[index]?.value ||
          '';
        return {
          key,
          value: proposed,
          blocked: fallbackPlan[index]?.blocked ?? false,
          canSave: fallbackPlan[index]?.canSave ?? false,
          canFill: fallbackPlan[index]?.canFill ?? false,
        };
      });
      console.info('[ai-autofill][llm] autofill plan resolved', {
        providerId,
        filledFields: plan.filter((entry) => Boolean(entry.value) && !entry.blocked).length,
        responseKeys: Object.keys(fields),
      });
      return { plan, source: providerId, prompt: payload };
    } catch (error) {
      console.error('[ai-autofill][llm] autofill pipeline failed', {
        providerId,
        model: model || '',
        error: error instanceof Error ? error.message : String(error),
      });
      return { plan: fallbackPlan, source: 'memory-only', error: error instanceof Error ? error.message : String(error), prompt: payload };
    }
  }
  return undefined;
}
