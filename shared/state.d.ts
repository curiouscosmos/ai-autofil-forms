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

export interface MemoryEntry {
  value: string;
  updatedAt: string;
  label: string;
  type: string;
}

export interface AutofillPlanEntry {
  key: string;
  value: string;
  blocked: boolean;
  canSave: boolean;
  canFill: boolean;
}

export declare const STORAGE_KEY: string;
export declare const PROVIDERS: ProviderDefinition[];
export declare const DEFAULT_PROVIDER_MODELS: Partial<Record<ProviderId, string>>;
export declare function createCategory(name: string, extras?: Partial<Category> & { id?: string }): Category;
export declare function createDefaultState(): AutofillState;
export declare function normalizeState(raw: unknown): AutofillState;
export declare function buildStoragePatch(state: unknown, patch: unknown): AutofillState;
export declare function slugify(value: string): string;
export declare function normalizeCategory(category: unknown, isFirst?: boolean): Category;
export declare function getActiveCategory(state: unknown): Category;
export declare function setActiveCategory(state: unknown, categoryId: string): AutofillState;
export declare function upsertCategory(state: unknown, category: Category): AutofillState;
export declare function removeCategory(state: unknown, categoryId: string): AutofillState;
export declare function getSiteKey(url: string): string;
export declare function getFormKey(form: HTMLFormElement | null | undefined, index?: number): string;
export declare function getFieldKey(descriptor: FieldDescriptor): string;
export declare function shouldBlockField(descriptor: Partial<FieldDescriptor>): boolean;
export declare function canShowSaveAction(descriptor: Partial<FieldDescriptor>): boolean;
export declare function canShowFillAction(descriptor: Partial<FieldDescriptor>): boolean;
export declare function buildMemoryBucket(state: unknown, categoryId?: string, siteKey?: string): {
  category: string;
  siteKey: string;
  entries: Record<string, MemoryEntry>;
};
export declare function setMemoryEntry(state: unknown, descriptor: FieldDescriptor, value: string): AutofillState;
export declare function getMemoryEntry(state: unknown, descriptor: FieldDescriptor): MemoryEntry | null;
export declare function resolveFieldValue(state: unknown, descriptor: FieldDescriptor): string;
export declare function buildAutofillPlan(state: unknown, descriptors: FieldDescriptor[]): AutofillPlanEntry[];

