import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  createCategory,
  createDefaultState,
  normalizeState,
  PROVIDERS,
  removeCategory,
  setActiveCategory,
  type Category,
  type AutofillState,
  type ProviderId,
  upsertCategory,
} from '@/shared/state';
import { fetchAvailableModels, getDefaultModel, type ModelOption } from '@/shared/providers';
import './App.css';

type ProviderMode = 'editing' | 'connected';

const initialState = createDefaultState();

function App() {
  const [state, setAppState] = useState<AutofillState>(initialState);
  const [status, setStatus] = useState('Loading settings...');
  const [newCategoryName, setNewCategoryName] = useState('');
  const [isCreatingCategory, setIsCreatingCategory] = useState(false);
  const [categoryEditorId, setCategoryEditorId] = useState<string | 'new' | null>(null);
  const [providerMode, setProviderMode] = useState<ProviderMode>('editing');
  const [providerDraft, setProviderDraft] = useState({
    provider: initialState.settings.provider as ProviderId,
    apiKey: '',
  });
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [modelLoading, setModelLoading] = useState(false);
  const [modelError, setModelError] = useState('');

  useEffect(() => {
    void load();
  }, []);

  const activeCategory = useMemo(
    () => state.categories.find((category) => category.id === state.activeCategoryId) ?? state.categories[0],
    [state],
  );

  const currentProvider = state.settings.provider;
  const currentApiKey = state.settings.apiKeys[currentProvider] ?? '';
  const providerConfigured = providerMode === 'connected' && Boolean(currentApiKey);
  const currentModel = state.settings.models?.[currentProvider] || getDefaultModel(currentProvider);
  const visibleModelOptions = modelOptions.length
    ? modelOptions
    : [{ id: currentModel, label: currentModel }];

  async function load() {
    const current = normalizeState(await browser.runtime.sendMessage({ type: 'get-state' }));
    setAppState(current);
    const savedKey = current.settings.apiKeys[current.settings.provider] ?? '';
    setProviderDraft({ provider: current.settings.provider, apiKey: savedKey });
    if (savedKey) {
      setProviderMode('connected');
      await refreshModels(current.settings.provider, savedKey, current.settings.models[current.settings.provider]);
      setStatus(`Connected to ${getProviderLabel(current.settings.provider)}`);
    } else {
      setProviderMode('editing');
      setModelOptions([]);
      setStatus('');
    }
  }

  async function persist(next: unknown) {
    const updated = normalizeState(await browser.runtime.sendMessage({ type: 'set-state', patch: next }));
    setAppState(updated);
    return updated;
  }

  async function updateSettings(patch: Record<string, unknown>) {
    await persist({
      settings: {
        ...state.settings,
        ...patch,
      },
    });
  }

  async function refreshModels(provider: ProviderId, apiKey: string, preferredModel?: string) {
    setModelLoading(true);
    setModelError('');
    try {
      const fetched = await fetchAvailableModels(provider, apiKey);
      const nextOptions = fetched.length
        ? fetched
        : [{ id: getDefaultModel(provider), label: getDefaultModel(provider) }];
      setModelOptions(nextOptions);
      const nextModel =
        preferredModel && nextOptions.some((option) => option.id === preferredModel)
          ? preferredModel
          : nextOptions[0]?.id || getDefaultModel(provider);
      if (nextModel && nextModel !== state.settings.models[provider]) {
        await updateSettings({
          models: {
            ...state.settings.models,
            [provider]: nextModel,
          },
        });
      }
      setStatus(`Loaded ${nextOptions.length} model(s) for ${getProviderLabel(provider)}.`);
    } catch (error) {
      const fallbackModel = getDefaultModel(provider);
      setModelOptions([{ id: fallbackModel, label: fallbackModel }]);
      setModelError(error instanceof Error ? error.message : String(error));
      if (fallbackModel !== state.settings.models[provider]) {
        await updateSettings({
          models: {
            ...state.settings.models,
            [provider]: fallbackModel,
          },
        });
      }
      setStatus(`Using fallback model for ${getProviderLabel(provider)}.`);
    } finally {
      setModelLoading(false);
    }
  }

  async function saveProvider() {
    const provider = providerDraft.provider;
    const apiKey = providerDraft.apiKey.trim();
    if (!apiKey) {
      setStatus('Enter an API key before saving.');
      return;
    }
    const updated = await persist({
      settings: {
        ...state.settings,
        provider,
        apiKeys: {
          ...state.settings.apiKeys,
          [provider]: apiKey,
        },
      },
    });
    setProviderMode('connected');
    setProviderDraft({ provider, apiKey });
    await refreshModels(provider, apiKey, updated.settings.models[provider]);
  }

  async function beginEditProvider() {
    setProviderDraft({
      provider: currentProvider,
      apiKey: currentApiKey,
    });
    setModelOptions([]);
    setModelError('');
    setProviderMode('editing');
    setStatus('Update the provider and save a new API key to unlock settings.');
  }

  async function handleProviderSelection(provider: ProviderId) {
    setProviderDraft({
      provider,
      apiKey: state.settings.apiKeys[provider] ?? '',
    });
  }

  async function handleModelChange(provider: ProviderId, value: string) {
    await updateSettings({
      models: {
        ...state.settings.models,
        [provider]: value,
      },
    });
  }

  async function toggleCategory(categoryId: string) {
    const next = setActiveCategory(state, categoryId);
    await persist(next);
    setCategoryEditorId(categoryId);
  }

  async function saveCategory(nextCategory = activeCategory) {
    if (!nextCategory) return;
    await persist(upsertCategory(state, nextCategory));
    setCategoryEditorId(null);
    setStatus(`Saved ${nextCategory.name}.`);
  }

  async function addCategory() {
    if (!newCategoryName.trim()) return;
    const next = createCategory(newCategoryName.trim(), { active: true });
    await persist(setActiveCategory(upsertCategory(state, next), next.id));
    setNewCategoryName('');
    setIsCreatingCategory(false);
    setCategoryEditorId(next.id);
    setStatus(`Created ${next.name}.`);
    requestAnimationFrame(() => {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
    });
  }

  async function deleteCategory(categoryId: string) {
    if (state.categories.length === 1) return;
    await persist(removeCategory(state, categoryId));
    setStatus('Category removed.');
  }

  async function uploadFiles(category: Category, files: FileList | null) {
    if (!files?.length) return;
    const fileEntries = await Promise.all(
      Array.from(files).map(async (file) => ({
        name: file.name,
        text: await file.text(),
        size: file.size,
        type: file.type,
      })),
    );
    const nextCategory = {
      ...category,
      files: [...category.files, ...fileEntries],
    };
    await persist(upsertCategory(state, nextCategory));
    setStatus(`${fileEntries.length} file(s) added to ${nextCategory.name}.`);
  }

  async function openCategoryCreator() {
    setCategoryEditorId('new');
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
        resolve();
      });
    });
  }

  return (
    <div className="popup">
      <header className="popup__header">
        <div>
          <h1 className="eyebrow">AI Autofill</h1>
        </div>
        <div className="status">{status}</div>
      </header>

      <section className="section">
        <h2>Provider</h2>
        {!providerConfigured ? (
          <div className="grid">
            <label>
              <span>LLM provider</span>
              <select value={providerDraft.provider} onChange={(event) => void handleProviderSelection(event.target.value as ProviderId)}>
                {PROVIDERS.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>API key</span>
              <input
                type="password"
                value={providerDraft.apiKey}
                onChange={(event) => setProviderDraft((current) => ({ ...current, apiKey: event.target.value }))}
                placeholder={`Paste ${getProviderLabel(providerDraft.provider)} key`}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <button type="button" onClick={() => void saveProvider()}>
              Save API key
            </button>
          </div>
        ) : (
          <div className="provider-summary">
            <div>
              <span className="provider-summary__label">Connected provider</span>
              <strong>{getProviderLabel(currentProvider)}</strong>
            </div>
            <button type="button" className="ghost" onClick={() => void beginEditProvider()}>
              Change
            </button>
          </div>
        )}
      </section>

      {providerConfigured ? (
        <>
          <section className="section">
            <div className="section__row">
              <h2>Model</h2>
              <span className="muted">{modelLoading ? 'Loading models...' : modelError || 'Ready'}</span>
            </div>
            <div className="grid">
              <label>
                <span>Model selection</span>
                <select
                  value={currentModel}
                  onChange={(event) => void handleModelChange(currentProvider, event.target.value)}
                  disabled={modelLoading}
                >
                  {visibleModelOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="ghost"
                onClick={() => void refreshModels(currentProvider, currentApiKey, currentModel)}
                disabled={modelLoading || !currentApiKey}
              >
                Refresh models
              </button>
            </div>
          </section>

          <section className="section">
            <h2>Behavior</h2>
            <div className="toggles">
              <Toggle
                label="Autofill enabled"
                checked={state.settings.autofillEnabled}
                onChange={(checked) => void updateSettings({ autofillEnabled: checked })}
              />
              <Toggle
                label="Show field icons"
                checked={state.settings.showFieldIcons}
                onChange={(checked) => void updateSettings({ showFieldIcons: checked })}
              />
              <Toggle
                label="Show floating launcher"
                checked={state.settings.showLauncher}
                onChange={(checked) => void updateSettings({ showLauncher: checked })}
              />
            </div>
          </section>

          <section className="section">
            <div className="section__row">
              <h2>Categories</h2>
              <button className="ghost" onClick={() => void openCategoryCreator()}>
                Create Category
              </button>
            </div>
            <p className="section-note">Categories help the AI model to save the context and instructions for filling forms. For example: Job applications, travel forms etc.</p>
            <div className="category-list">
              {state.categories.map((category) => (
                <button
                  key={category.id}
                  className={category.id === state.activeCategoryId ? 'category category--active' : 'category'}
                  onClick={() => void toggleCategory(category.id)}
                  type="button"
                >
                  <span className="category__row">
                    <span className="category__name">{category.name}</span>
                    {category.id === state.activeCategoryId ? <span className="category__active-badge">Active</span> : null}
                  </span>
                  <small>{previewInstructions(category.instructions)}</small>
                </button>
              ))}
            </div>

            {categoryEditorId ? (
              <div className="category-editor">
                {categoryEditorId === 'new' ? (
                  <label>
                    <span>New category name</span>
                    <div className="inline">
                      <input
                        value={newCategoryName}
                        onChange={(event) => setNewCategoryName(event.target.value)}
                        placeholder="Job Applications"
                      />
                      <button type="button" onClick={() => void addCategory()}>
                        Add
                      </button>
                    </div>
                  </label>
                ) : activeCategory ? (
                  <>
                    <div className="section__row">
                      <h3>{activeCategory.name}</h3>
                    </div>
                    <label>
                      <span>Name</span>
                      <input
                        value={activeCategory.name}
                        onChange={(event) =>
                          setAppState({
                            ...state,
                            categories: state.categories.map((category) =>
                              category.id === activeCategory.id ? { ...category, name: event.target.value } : category,
                            ),
                          })
                        }
                      />
                    </label>
                    <label>
                      <span>Instructions</span>
                      <textarea
                        value={activeCategory.instructions}
                        onChange={(event) =>
                          setAppState({
                            ...state,
                            categories: state.categories.map((category) =>
                              category.id === activeCategory.id ? { ...category, instructions: event.target.value } : category,
                            ),
                          })
                        }
                        placeholder="Tell the AI what to prioritize for this category."
                      />
                    </label>
                    <label>
                      <span>Upload supporting file</span>
                      <input
                        type="file"
                        multiple
                        aria-describedby="category-upload-help"
                        onChange={(event) => void uploadFiles(activeCategory, event.target.files)}
                      />
                      <small id="category-upload-help" className="section-note">
                        Upload helper documents, for example Resume for Job Applications
                      </small>
                    </label>
                    <div className="file-list">
                      {activeCategory.files.length ? (
                        activeCategory.files.map((file) => (
                          <div className="file-item" key={`${activeCategory.id}-${file.name}-${file.size}`}>
                            <strong>{file.name}</strong>
                            <small>{Math.max(1, Math.round(file.text.length / 1024))} KB extracted text</small>
                          </div>
                        ))
                      ) : (
                        <p className="muted">No files stored for this category.</p>
                      )}
                    </div>
                    <div className="actions">
                      <button type="button" className="ghost" onClick={() => void saveCategory(activeCategory)}>
                        Save category
                      </button>
                      <button
                        type="button"
                        className="danger"
                        onClick={() => void deleteCategory(activeCategory.id)}
                        disabled={state.categories.length === 1}
                      >
                        Delete category
                      </button>
                    </div>
                  </>
                ) : null}
              </div>
            ) : null}
          </section>
        </>
      ) : (
        <section className="section unlock-message">
          <p>
            LLM API key is required to enable the autofill. Purchase any paid plan from{' '}
            <ExternalLink href="https://platform.openai.com/home">OpenAI</ExternalLink>,{' '}
            <ExternalLink href="https://platform.claude.com/dashboard">Claude AI</ExternalLink>,{' '}
            <ExternalLink href="https://aistudio.google.com/app/api-keys">Google Gemini</ExternalLink>,{' '}
            <ExternalLink href="https://console.x.ai">XAI</ExternalLink>, or find any Free LLM API from{' '}
            <ExternalLink href="https://openrouter.ai/models">Openrouter</ExternalLink>.
          </p>
        </section>
      )}
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="toggle">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

function getProviderLabel(provider: ProviderId) {
  return PROVIDERS.find((entry) => entry.id === provider)?.label ?? provider;
}

function previewInstructions(instructions: string) {
  const trimmed = instructions.trim();
  if (!trimmed) {
    return 'No instructions';
  }
  return trimmed.length > 30 ? `${trimmed.slice(0, 30)}...` : trimmed;
}

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  );
}

export default App;
