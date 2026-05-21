import { useEffect, useMemo, useState } from 'react';
import {
  createCategory,
  createDefaultState,
  normalizeState,
  PROVIDERS,
  setActiveCategory,
  upsertCategory,
  removeCategory,
} from '@/shared/state';
import { getDefaultModel } from '@/shared/providers';
import './App.css';

const initialState = createDefaultState();

function App() {
  const [state, setState] = useState(initialState);
  const [status, setStatus] = useState('Loading settings...');
  const [newCategoryName, setNewCategoryName] = useState('');

  useEffect(() => {
    void load();
  }, []);

  const activeCategory = useMemo(
    () => state.categories.find((category) => category.id === state.activeCategoryId) ?? state.categories[0],
    [state],
  );

  async function load() {
    const current = await browser.runtime.sendMessage({ type: 'get-state' });
    setState(normalizeState(current));
    setStatus('Settings loaded.');
  }

  async function persist(next: unknown) {
    const updated = await browser.runtime.sendMessage({ type: 'set-state', patch: next });
    setState(normalizeState(updated));
  }

  async function updateSettings(patch: Record<string, unknown>) {
    await persist({
      settings: {
        ...state.settings,
        ...patch,
      },
    });
  }

  async function updateProvider(provider: string) {
    await updateSettings({ provider });
  }

  async function updateApiKey(provider: string, value: string) {
    await updateSettings({
      apiKeys: {
        ...state.settings.apiKeys,
        [provider]: value,
      },
    });
  }

  async function updateModel(provider: string, value: string) {
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
  }

  async function saveCategory(nextCategory = activeCategory) {
    if (!nextCategory) return;
    await persist(upsertCategory(state, nextCategory));
    setStatus(`Saved ${nextCategory.name}.`);
  }

  async function addCategory() {
    if (!newCategoryName.trim()) return;
    const next = createCategory(newCategoryName.trim(), { active: true });
    await persist(setActiveCategory(upsertCategory(state, next), next.id));
    setNewCategoryName('');
    setStatus(`Created ${next.name}.`);
  }

  async function deleteCategory(categoryId: string) {
    if (state.categories.length === 1) return;
    await persist(removeCategory(state, categoryId));
    setStatus('Category removed.');
  }

  async function uploadFiles(categoryId: string, files: FileList | null) {
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
      ...activeCategory,
      files: [...activeCategory.files, ...fileEntries],
    };
    if (categoryId === activeCategory.id) {
      await persist(upsertCategory(state, nextCategory));
      setStatus(`${fileEntries.length} file(s) added to ${nextCategory.name}.`);
    }
  }

  const provider = state.settings.provider;
  const selectedModel = state.settings.models?.[provider] || getDefaultModel(provider);

  return (
    <div className="popup">
      <header className="popup__header">
        <div>
          <p className="eyebrow">AI Autofill</p>
          <h1>Control center</h1>
        </div>
        <div className="status">{status}</div>
      </header>

      <section className="section">
        <h2>Provider</h2>
        <div className="grid">
          <label>
            <span>LLM provider</span>
            <select value={provider} onChange={(event) => void updateProvider(event.target.value)}>
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
              value={state.settings.apiKeys[provider] ?? ''}
              onChange={(event) => void updateApiKey(provider, event.target.value)}
              placeholder={`Paste ${PROVIDERS.find((entry) => entry.id === provider)?.label ?? 'provider'} key`}
            />
          </label>
          <label>
            <span>Model</span>
            <input
              value={selectedModel}
              onChange={(event) => void updateModel(provider, event.target.value)}
              placeholder={getDefaultModel(provider)}
            />
          </label>
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
          <button className="ghost" onClick={() => void saveCategory()}>Save current</button>
        </div>
        <div className="category-list">
          {state.categories.map((category) => (
            <button
              key={category.id}
              className={category.id === state.activeCategoryId ? 'category category--active' : 'category'}
              onClick={() => void toggleCategory(category.id)}
              type="button"
            >
              <span>{category.name}</span>
              <small>{category.instructions ? 'Has instructions' : 'No instructions'}</small>
            </button>
          ))}
        </div>
        <div className="stack">
          <label>
            <span>New category</span>
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

          {activeCategory ? (
            <div className="category-editor">
              <label>
                <span>Name</span>
                <input
                  value={activeCategory.name}
                  onChange={(event) =>
                    setState({
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
                    setState({
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
                  onChange={(event) => void uploadFiles(activeCategory.id, event.target.files)}
                />
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
                <button type="button" className="danger" onClick={() => void deleteCategory(activeCategory.id)} disabled={state.categories.length === 1}>
                  Delete category
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </section>
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

export default App;
