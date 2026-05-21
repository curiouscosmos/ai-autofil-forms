export const STORAGE_KEY = 'ai-autofill-state';

export type ProviderId = 'openai' | 'claude' | 'gemini' | 'xai' | 'openrouter';

export interface ProviderDefinition {
  id: ProviderId;
  label: string;
  apiBaseUrl: string;
  authHeader: string;
  authPrefix?: string;
  extraHeaders?: Record<string, string>;
}

export interface CategoryFileEntry {
  name: string;
  text: string;
  size: number;
  type: string;
}

export interface Category {
  id: string;
  name: string;
  instructions: string;
  active: boolean;
  files: CategoryFileEntry[];
}

export interface SettingsState {
  provider: ProviderId;
  apiKeys: Partial<Record<ProviderId, string>>;
  models: Partial<Record<ProviderId, string>>;
  autofillEnabled: boolean;
  showFieldIcons: boolean;
  showLauncher: boolean;
}

export interface MemoryEntry {
  value: string;
  updatedAt: string;
  label: string;
  type: string;
}

export interface AutofillState {
  settings: SettingsState;
  categories: Category[];
  activeCategoryId: string;
  memory: Record<string, Record<string, Record<string, MemoryEntry>>>;
}

export interface FieldDescriptor {
  siteKey: string;
  formKey: string;
  label: string;
  name: string;
  placeholder: string;
  autocomplete: string;
  type: string;
  formName: string;
  blockedForm?: boolean;
  eligible?: boolean;
  fieldId?: string;
  categoryId?: string;
}

export interface AutofillPlanEntry {
  key: string;
  value: string;
  blocked: boolean;
  canSave: boolean;
  canFill: boolean;
}

export const PROVIDERS: ProviderDefinition[] = [
  { id: 'openai', label: 'OpenAI', apiBaseUrl: 'https://api.openai.com/v1/chat/completions', authHeader: 'Authorization', authPrefix: 'Bearer' },
  { id: 'claude', label: 'Claude AI', apiBaseUrl: 'https://api.anthropic.com/v1/messages', authHeader: 'x-api-key', extraHeaders: { 'anthropic-version': '2023-06-01' } },
  { id: 'gemini', label: 'Google Gemini', apiBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/models', authHeader: 'x-goog-api-key' },
  { id: 'xai', label: 'XAI', apiBaseUrl: 'https://api.x.ai/v1/chat/completions', authHeader: 'Authorization', authPrefix: 'Bearer' },
  { id: 'openrouter', label: 'OpenRouter', apiBaseUrl: 'https://openrouter.ai/api/v1/chat/completions', authHeader: 'Authorization', authPrefix: 'Bearer', extraHeaders: { 'X-OpenRouter-Experimental-Metadata': 'enabled' } },
];

export const DEFAULT_PROVIDER_MODELS: Partial<Record<ProviderId, string>> = {
  openai: 'gpt-4o-mini',
  claude: 'claude-sonnet-4-5',
  gemini: 'gemini-2.5-flash',
  xai: 'grok-4',
  openrouter: 'openai/gpt-4o-mini',
};

export function createCategory(name: string, extras: Partial<Category> & { id?: string } = {}): Category {
  const trimmed = `${name ?? ''}`.trim();
  const id = extras.id || slugify(trimmed || 'general');
  return {
    id,
    name: trimmed || 'General',
    instructions: extras.instructions ?? '',
    active: Boolean(extras.active),
    files: Array.isArray(extras.files) ? extras.files : [],
  };
}

export function createDefaultState(): AutofillState {
  const category = createCategory('General', { id: 'general', active: true });
  return {
    settings: {
      provider: 'openai',
      apiKeys: {},
      models: { ...DEFAULT_PROVIDER_MODELS },
      autofillEnabled: true,
      showFieldIcons: true,
      showLauncher: true,
    },
    categories: [category],
    activeCategoryId: category.id,
    memory: {},
  };
}

export function normalizeState(raw: unknown): AutofillState {
  const base = createDefaultState();
  const state = raw && typeof raw === 'object' ? (raw as Partial<AutofillState>) : {};
  const settings = state.settings && typeof state.settings === 'object' ? (state.settings as Partial<SettingsState>) : {};
  const categories = Array.isArray(state.categories) ? state.categories : [];
  const memory = state.memory && typeof state.memory === 'object' ? state.memory : {};
  const normalizedCategories = categories.length ? categories.map((category, index) => normalizeCategory(category, index === 0)) : base.categories;
  const activeCategoryId = typeof state.activeCategoryId === 'string' ? state.activeCategoryId : normalizedCategories.find((category) => category.active)?.id ?? base.activeCategoryId;
  return {
    settings: {
      provider: PROVIDERS.some((provider) => provider.id === settings.provider) ? (settings.provider as ProviderId) : base.settings.provider,
      apiKeys: settings.apiKeys && typeof settings.apiKeys === 'object' ? settings.apiKeys : {},
      models: {
        ...DEFAULT_PROVIDER_MODELS,
        ...(settings.models && typeof settings.models === 'object' ? settings.models : {}),
      },
      autofillEnabled: settings.autofillEnabled !== false,
      showFieldIcons: settings.showFieldIcons !== false,
      showLauncher: settings.showLauncher !== false,
    },
    categories: normalizedCategories,
    activeCategoryId,
    memory,
  };
}

export function buildStoragePatch(state: unknown, patch: unknown): AutofillState {
  const current = normalizeState(state);
  const next = { ...current, ...(patch && typeof patch === 'object' ? patch : {}) };
  return normalizeState(next);
}

export function slugify(value: string): string {
  return `${value}`
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export function normalizeCategory(category: unknown, isFirst = false): Category {
  const safe = category && typeof category === 'object' ? (category as Partial<Category> & { id?: string }) : {};
  const name = `${safe.name ?? ''}`.trim();
  return {
    id: `${safe.id ?? ''}`.trim() || slugify(name || 'category'),
    name: name || 'Category',
    instructions: `${safe.instructions ?? ''}`,
    active: Boolean(safe.active) || isFirst,
    files: Array.isArray(safe.files) ? safe.files : [],
  };
}

export function getActiveCategory(state: unknown): Category {
  const normalized = normalizeState(state);
  return normalized.categories.find((category) => category.id === normalized.activeCategoryId) ?? normalized.categories[0];
}

export function setActiveCategory(state: unknown, categoryId: string): AutofillState {
  const normalized = normalizeState(state);
  return {
    ...normalized,
    activeCategoryId: categoryId,
    categories: normalized.categories.map((category) => ({
      ...category,
      active: category.id === categoryId,
    })),
  };
}

export function upsertCategory(state: unknown, category: Category): AutofillState {
  const normalized = normalizeState(state);
  const nextCategory = normalizeCategory(category);
  const categories = normalized.categories.some((entry) => entry.id === nextCategory.id)
    ? normalized.categories.map((entry) => (entry.id === nextCategory.id ? nextCategory : entry))
    : [...normalized.categories, nextCategory];
  return {
    ...normalized,
    categories,
    activeCategoryId: normalized.activeCategoryId || nextCategory.id,
  };
}

export function removeCategory(state: unknown, categoryId: string): AutofillState {
  const normalized = normalizeState(state);
  const categories = normalized.categories.filter((category) => category.id !== categoryId);
  const fallback = categories[0] ?? createDefaultState().categories[0];
  const activeCategoryId = normalized.activeCategoryId === categoryId ? fallback.id : normalized.activeCategoryId;
  return {
    ...normalized,
    categories: categories.length ? categories : [fallback],
    activeCategoryId,
  };
}

export function getSiteKey(url: string): string {
  try {
    return new URL(url).hostname || 'unknown-site';
  } catch {
    return 'unknown-site';
  }
}

export function getFormKey(form: HTMLFormElement | null | undefined, index = 0): string {
  const action = form?.getAttribute?.('action') || '';
  const method = form?.getAttribute?.('method') || '';
  return slugify([action, method, index].filter(Boolean).join('|') || `form-${index}`);
}

export function getFieldKey(descriptor: Partial<FieldDescriptor>): string {
  return slugify([
    descriptor.siteKey,
    descriptor.formKey,
    descriptor.name,
    descriptor.label,
    descriptor.placeholder,
    descriptor.type,
  ].filter(Boolean).join('|'));
}

export function shouldBlockField(descriptor: Partial<FieldDescriptor>): boolean {
  const type = `${descriptor.type ?? ''}`.toLowerCase();
  if (type === 'password') {
    return true;
  }
  const haystack = [
    descriptor.name,
    descriptor.label,
    descriptor.placeholder,
    descriptor.autocomplete,
    descriptor.formName,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return /credit\s*card|cc(?:v|v2)?|cvc|cvv|ssn|social\s*security|password|secret|bank\s*account|routing\s*number/.test(haystack);
}

export function canShowSaveAction(descriptor: Partial<FieldDescriptor>): boolean {
  return !shouldBlockField(descriptor) && ['text', 'search', 'email', 'tel', 'url', 'textarea', 'contenteditable'].includes(`${descriptor.type ?? ''}`.toLowerCase());
}

export function canShowFillAction(descriptor: Partial<FieldDescriptor>): boolean {
  return !shouldBlockField(descriptor) && descriptor.eligible !== false;
}

export function buildMemoryBucket(state: unknown, categoryId?: string, siteKey?: string): {
  category: string;
  siteKey: string;
  entries: Record<string, MemoryEntry>;
} {
  const normalized = normalizeState(state);
  return {
    category: categoryId || normalized.activeCategoryId,
    siteKey: siteKey || 'unknown-site',
    entries: normalized.memory?.[categoryId || normalized.activeCategoryId]?.[siteKey || 'unknown-site'] ?? {},
  };
}

export function setMemoryEntry(state: unknown, descriptor: FieldDescriptor, value: string): AutofillState {
  const normalized = normalizeState(state);
  const categoryId = descriptor.categoryId || normalized.activeCategoryId;
  const siteKey = descriptor.siteKey || 'unknown-site';
  const fieldKey = getFieldKey(descriptor);
  const nextMemory = {
    ...normalized.memory,
    [categoryId]: {
      ...(normalized.memory?.[categoryId] ?? {}),
      [siteKey]: {
        ...((normalized.memory?.[categoryId] ?? {})[siteKey] ?? {}),
        [fieldKey]: {
          value,
          updatedAt: new Date().toISOString(),
          label: descriptor.label ?? '',
          type: descriptor.type ?? '',
        },
      },
    },
  };
  return {
    ...normalized,
    memory: nextMemory,
  };
}

export function getMemoryEntry(state: unknown, descriptor: FieldDescriptor): MemoryEntry | null {
  const normalized = normalizeState(state);
  const categoryId = descriptor.categoryId || normalized.activeCategoryId;
  const siteKey = descriptor.siteKey || 'unknown-site';
  const bucket = normalized.memory?.[categoryId]?.[siteKey] ?? {};
  const fieldKey = getFieldKey(descriptor);
  return bucket[fieldKey] ?? null;
}

export function resolveFieldValue(state: unknown, descriptor: FieldDescriptor): string {
  const normalized = normalizeState(state);
  const direct = getMemoryEntry(normalized, descriptor);
  if (direct) {
    return direct.value;
  }
  const categoryBucket = normalized.memory?.[descriptor.categoryId || normalized.activeCategoryId]?.[descriptor.siteKey || 'unknown-site'] ?? {};
  const descriptorTokens = [
    descriptor.name,
    descriptor.label,
    descriptor.placeholder,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  for (const entry of Object.values(categoryBucket)) {
    const entryText = `${entry.label ?? ''} ${entry.type ?? ''}`.toLowerCase();
    if (entryText && descriptorTokens && entryText === descriptorTokens) {
      return entry.value;
    }
  }
  return '';
}

export function buildAutofillPlan(state: unknown, descriptors: FieldDescriptor[]): AutofillPlanEntry[] {
  const normalized = normalizeState(state);
  return descriptors.map((descriptor) => ({
    key: getFieldKey(descriptor),
    value: shouldBlockField(descriptor) ? '' : resolveFieldValue(normalized, descriptor),
    blocked: shouldBlockField(descriptor),
    canSave: canShowSaveAction(descriptor),
    canFill: canShowFillAction(descriptor),
  }));
}
