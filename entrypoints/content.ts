import {
  type AutofillState,
  canShowFillAction,
  canShowSaveAction,
  createDefaultState,
  type FieldDescriptor,
  getFieldKey,
  getFormKey,
  getSiteKey,
  normalizeState,
  shouldBlockField,
  STORAGE_KEY,
} from '@/shared/state';

type AppState = AutofillState;

const fieldStates = new WeakMap<Element, { dirty: boolean; lastValue: string }>();
let appState: AppState | null = null;
let launcherVisible = true;
let fieldRailHideTimer: ReturnType<typeof setTimeout> | null = null;
const fieldRailHideDelayMs = 5000;

export default defineContentScript({
  matches: ['<all_urls>'],
  main() {
    if (document.documentElement.dataset.aiAutofillMounted === 'true') {
      return;
    }
    document.documentElement.dataset.aiAutofillMounted = 'true';
    bootstrap().catch((error) => console.error('[ai-autofill]', error));
  },
});

async function bootstrap() {
  appState = await loadState();
  launcherVisible = appState.settings.showLauncher;
  const ui = createUi();
  document.documentElement.appendChild(ui.host);
  attachListeners(ui);
  refreshUi(ui);
}

function createUi() {
  const host = document.createElement('div');
  host.id = 'ai-autofill-host';
  host.style.position = 'fixed';
  host.style.inset = '0';
  host.style.zIndex = '2147483647';
  host.style.pointerEvents = 'none';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .launcher, .field-rail, .sheet {
        font-family: Inter, system-ui, sans-serif;
        color: #f8fafc;
      }
      .launcher {
        position: fixed;
        right: 18px;
        bottom: 18px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        pointer-events: auto;
      }
      .launcher-button {
        width: 44px;
        height: 44px;
        border: 1px solid rgba(148,163,184,0.16);
        border-radius: 12px;
        background: #0b0b0b;
        box-shadow: 0 8px 24px rgba(0,0,0,0.4);
        display: grid;
        place-items: center;
        cursor: pointer;
        color: #f8fafc;
      }
      .sheet {
        display: none;
        width: 260px;
        padding: 12px;
        border-radius: 12px;
        border: 1px solid rgba(148,163,184,0.16);
        background: #050505;
        box-shadow: 0 18px 40px rgba(0,0,0,0.45);
      }
      .sheet[data-open="true"] { display: grid; gap: 10px; }
      .sheet select, .sheet button {
        width: 100%;
      }
      .sheet button, .field-action {
        border: 1px solid rgba(148,163,184,0.16);
        background: #111827;
        color: #f8fafc;
        border-radius: 10px;
        height: 34px;
        padding: 0 10px;
        cursor: pointer;
      }
      .sheet button:hover, .field-action:hover, .launcher-button:hover {
        background: #1f2937;
      }
      .field-rail {
        position: fixed;
        display: none;
        gap: 6px;
        align-items: center;
        pointer-events: auto;
        transform: translateY(-50%);
      }
      .field-rail[data-open="true"] { display: flex; }
      .field-action {
        min-width: 42px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      .field-action--save {
        min-width: 54px;
      }
      .status {
        font-size: 12px;
        line-height: 1.4;
        color: #94a3b8;
      }
      .label {
        display: flex;
        flex-direction: column;
        gap: 6px;
        font-size: 12px;
      }
      .label strong {
        font-size: 13px;
        color: #f8fafc;
      }
      .muted {
        color: #94a3b8;
      }
    </style>
    <div class="launcher" hidden>
      <button class="launcher-button" title="AI Autofill" aria-label="AI Autofill">⌁</button>
      <div class="sheet" role="dialog" aria-label="AI Autofill controls">
        <label class="label">
          <strong>Category</strong>
          <select id="category-select"></select>
        </label>
        <button id="fill-form">Fill current form</button>
        <div class="status" id="launcher-status"></div>
      </div>
    </div>
    <div class="field-rail" aria-live="polite">
      <button class="field-action" id="field-fill" title="Fill field" aria-label="Fill field">↯</button>
      <button class="field-action field-action--save" id="field-save" title="Save field" aria-label="Save field">Save</button>
    </div>
  `;
  return {
    host,
    shadow,
    launcher: shadow.querySelector('.launcher') as HTMLDivElement,
    sheet: shadow.querySelector('.sheet') as HTMLDivElement,
    launcherButton: shadow.querySelector('.launcher-button') as HTMLButtonElement,
    fillFormButton: shadow.querySelector('#fill-form') as HTMLButtonElement,
    launcherStatus: shadow.querySelector('#launcher-status') as HTMLDivElement,
    fieldRail: shadow.querySelector('.field-rail') as HTMLDivElement,
    fieldFillButton: shadow.querySelector('#field-fill') as HTMLButtonElement,
    fieldSaveButton: shadow.querySelector('#field-save') as HTMLButtonElement,
    categorySelect: shadow.querySelector('#category-select') as HTMLSelectElement,
  };
}

function attachListeners(ui: ReturnType<typeof createUi>) {
  ui.launcherButton.addEventListener('click', () => {
    ui.sheet.dataset.open = ui.sheet.dataset.open === 'true' ? 'false' : 'true';
  });

  ui.categorySelect.addEventListener('change', async () => {
    if (!appState) return;
    appState = await setState({ activeCategoryId: ui.categorySelect.value });
    refreshUi(ui);
  });

  ui.fillFormButton.addEventListener('click', async () => {
    const targetForm = getPrimaryForm();
    if (!targetForm) {
      setStatus(ui, 'No form found on this page.');
      return;
    }
    const descriptors = getFormDescriptors(targetForm).filter((descriptor) => canShowFillAction(descriptor) && !descriptor.blockedForm);
    if (!descriptors.length) {
      setStatus(ui, 'No eligible fields found.');
      return;
    }
    const result = await browser.runtime.sendMessage({
      type: 'autofill-form',
      page: getPageSnapshot(),
      descriptors,
    });
    applyPlan(result?.plan ?? [], descriptors, ui);
    setStatus(ui, result?.error ? `Fill completed with fallback: ${result.error}` : `Filled ${descriptors.length} field(s).`);
  });

  document.addEventListener('pointerover', (event) => {
    const target = findField(event.target);
    if (!target || !appState?.settings.showFieldIcons) {
      scheduleFieldRailHide(ui);
      return;
    }
    showFieldRail(ui, target);
  });

  document.addEventListener('focusin', (event) => {
    const target = findField(event.target);
    if (!target || !appState?.settings.showFieldIcons) {
      scheduleFieldRailHide(ui);
      return;
    }
    showFieldRail(ui, target);
  });

  document.addEventListener('pointerout', (event) => {
    const target = findField(event.target);
    if (!target) return;
    const related = event.relatedTarget;
    if (related instanceof Node && (target.contains(related) || ui.fieldRail.contains(related))) {
      return;
    }
    scheduleFieldRailHide(ui);
  });

  document.addEventListener('focusout', () => {
    scheduleFieldRailHide(ui);
  });

  document.addEventListener('input', (event) => {
    const field = findField(event.target);
    if (!field) return;
    const state = fieldStates.get(field) ?? { dirty: false, lastValue: '' };
    state.dirty = true;
    state.lastValue = getFieldValue(field);
    fieldStates.set(field, state);
    if (appState?.settings.showFieldIcons) {
      showFieldRail(ui, field);
    }
  });

  ui.fieldFillButton.addEventListener('click', async () => {
    const field = ui.fieldRail.dataset.fieldId ? resolveElementById(ui.fieldRail.dataset.fieldId) : null;
    if (!field || !isFillableField(field)) return;
    const descriptor = describeField(field);
    const result = await browser.runtime.sendMessage({
      type: 'autofill-form',
      page: getPageSnapshot(),
      descriptors: [descriptor],
    });
    const plan = result?.plan?.[0];
    if (plan?.value) {
      applyValue(field, plan.value);
      setStatus(ui, `Filled ${descriptor.label || descriptor.name || 'field'}.`);
    } else {
      setStatus(ui, 'No value available for this field.');
    }
  });

  ui.fieldSaveButton.addEventListener('click', async () => {
    const field = ui.fieldRail.dataset.fieldId ? resolveElementById(ui.fieldRail.dataset.fieldId) : null;
    if (!field || !canShowSaveAction(describeField(field))) return;
    const descriptor = describeField(field);
    const value = getFieldValue(field);
    appState = normalizeState(await browser.runtime.sendMessage({
      type: 'save-memory',
      descriptor,
      value,
    }));
    setStatus(ui, `Saved value for ${descriptor.label || descriptor.name || 'field'}.`);
  });

  ui.fieldRail.addEventListener('pointerenter', () => {
    clearFieldRailHideTimer();
  });

  ui.fieldRail.addEventListener('pointerleave', () => {
    scheduleFieldRailHide(ui);
  });

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[STORAGE_KEY]) return;
    appState = normalizeState(changes[STORAGE_KEY].newValue ?? createDefaultState());
    refreshUi(ui);
  });

  window.addEventListener('scroll', () => repositionOpenFieldRail(ui), true);
  window.addEventListener('resize', () => repositionOpenFieldRail(ui));
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      ui.sheet.dataset.open = 'false';
      hideFieldRail(ui);
    }
  });
}

function refreshUi(ui: ReturnType<typeof createUi>) {
  if (!appState) return;
  launcherVisible = appState.settings.showLauncher;
  ui.launcher.hidden = !launcherVisible;
  ui.categorySelect.innerHTML = '';
  for (const category of appState.categories) {
    const option = document.createElement('option');
    option.value = category.id;
    option.textContent = category.name;
    option.selected = category.id === appState.activeCategoryId;
    ui.categorySelect.appendChild(option);
  }
  ui.launcherStatus.textContent = appState.settings.autofillEnabled
    ? 'Autofill enabled'
    : 'Autofill disabled';
  ui.fillFormButton.disabled = !appState.settings.autofillEnabled;
}

function setStatus(ui: ReturnType<typeof createUi>, text: string) {
  ui.launcherStatus.textContent = text;
}

function showFieldRail(ui: ReturnType<typeof createUi>, field: HTMLElement): void {
  clearFieldRailHideTimer();
  const descriptor = describeField(field);
  if (descriptor.blockedForm || !canShowFillAction(descriptor)) {
    hideFieldRail(ui);
    return;
  }
  const state = fieldStates.get(field);
  if (!state?.dirty && getFieldValue(field).trim() !== '') {
    hideFieldRail(ui);
    return;
  }
  ui.fieldRail.dataset.open = 'true';
  ui.fieldRail.dataset.fieldId = ensureFieldId(field);
  ui.fieldSaveButton.hidden = !canShowSaveAction(descriptor) || !state?.dirty;
  const rect = getFieldRect(field);
  ui.fieldRail.style.top = `${rect.top + rect.height / 2}px`;
  ui.fieldRail.style.left = `${Math.min(window.innerWidth - 120, rect.right + 8)}px`;
  ui.fieldRail.style.display = 'flex';
}

function hideFieldRail(ui: ReturnType<typeof createUi>): void {
  clearFieldRailHideTimer();
  ui.fieldRail.dataset.open = 'false';
  ui.fieldRail.removeAttribute('data-field-id');
  ui.fieldRail.style.display = 'none';
}

function scheduleFieldRailHide(ui: ReturnType<typeof createUi>): void {
  clearFieldRailHideTimer();
  fieldRailHideTimer = setTimeout(() => {
    hideFieldRail(ui);
  }, fieldRailHideDelayMs);
}

function clearFieldRailHideTimer(): void {
  if (fieldRailHideTimer) {
    clearTimeout(fieldRailHideTimer);
    fieldRailHideTimer = null;
  }
}

function repositionOpenFieldRail(ui: ReturnType<typeof createUi>): void {
  if (ui.fieldRail.dataset.open !== 'true' || !ui.fieldRail.dataset.fieldId) return;
  const field = resolveElementById(ui.fieldRail.dataset.fieldId);
  if (!field) {
    hideFieldRail(ui);
    return;
  }
  const rect = getFieldRect(field);
  ui.fieldRail.style.top = `${rect.top + rect.height / 2}px`;
  ui.fieldRail.style.left = `${Math.min(window.innerWidth - 120, rect.right + 8)}px`;
}

async function loadState() {
  const result = await browser.storage.local.get(STORAGE_KEY);
  return normalizeState(result[STORAGE_KEY] ?? createDefaultState());
}

async function setState(patch: Record<string, unknown>): Promise<AppState> {
  return normalizeState(await browser.runtime.sendMessage({ type: 'set-state', patch }));
}

function findField(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const field = target.closest('input, textarea, select, [contenteditable="true"]');
  return field instanceof HTMLElement ? field : null;
}

function isFillableField(field: HTMLElement): boolean {
  return field.matches('input, textarea, select, [contenteditable="true"]');
}

function getPrimaryForm(): HTMLFormElement | null {
  return document.querySelector('form');
}

function getPageSnapshot(): { title: string; url: string; domain: string; text: string } {
  return {
    title: document.title,
    url: location.href,
    domain: location.hostname,
    text: document.body?.innerText?.slice(0, 4000) ?? '',
  };
}

function getFormDescriptors(form: HTMLFormElement): FieldDescriptor[] {
  const siteKey = getSiteKey(location.href);
  const formKey = getFormKey(form, Array.from(document.forms).indexOf(form));
  return Array.from(form.elements)
    .map((element) => (element instanceof HTMLElement ? describeField(element, siteKey, formKey) : null))
    .filter((descriptor): descriptor is FieldDescriptor => Boolean(descriptor));
}

function describeField(field: HTMLElement, siteKey = getSiteKey(location.href), formKey?: string): FieldDescriptor {
  const form = field.closest('form') as HTMLFormElement | null;
  const formIndex = form ? Array.from(document.forms).indexOf(form) : 0;
  const resolvedFormKey = formKey || getFormKey(form, formIndex);
  const input = field as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  const type = field.matches('[contenteditable="true"]')
    ? 'contenteditable'
    : field.tagName === 'TEXTAREA'
      ? 'textarea'
      : field.tagName === 'SELECT'
        ? 'select'
        : (input as HTMLInputElement).type || 'text';
  const label = getFieldLabel(field);
  return {
    siteKey,
    formKey: resolvedFormKey,
    label,
    name: input.getAttribute('name') || '',
    placeholder: input.getAttribute('placeholder') || '',
    autocomplete: input.getAttribute('autocomplete') || '',
    type,
    formName: form?.getAttribute('name') || '',
    blockedForm: Boolean(form && hasSensitiveField(form)),
    eligible: !shouldBlockField({
      type,
      label,
      name: input.getAttribute('name') || '',
      placeholder: input.getAttribute('placeholder') || '',
      autocomplete: input.getAttribute('autocomplete') || '',
      formName: form?.getAttribute('name') || ''
    }),
    fieldId: ensureFieldId(field, {
      siteKey,
      formKey: resolvedFormKey,
      name: input.getAttribute('name') || '',
      label,
      placeholder: input.getAttribute('placeholder') || '',
      type,
    }),
  };
}

function getFieldLabel(field: HTMLElement): string {
  const byLabel = document.querySelector(`label[for="${CSS.escape(field.id)}"]`);
  if (byLabel?.textContent) return byLabel.textContent.trim();
  const parentLabel = field.closest('label');
  if (parentLabel?.textContent) return parentLabel.textContent.trim();
  const ariaLabel = field.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel.trim();
  const labelledBy = field.getAttribute('aria-labelledby');
  if (labelledBy) {
    const parts = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent?.trim())
      .filter(Boolean);
    if (parts.length) return parts.join(' ');
  }
  return field.getAttribute('name') || field.getAttribute('placeholder') || '';
}

function isSensitiveElement(field: HTMLElement): boolean {
  const type = field instanceof HTMLInputElement ? field.type : field.tagName.toLowerCase();
  return shouldBlockField({
    type,
    label: getFieldLabel(field),
    name: field.getAttribute('name') || '',
    placeholder: field.getAttribute('placeholder') || '',
    autocomplete: field.getAttribute('autocomplete') || '',
    formName: (field.closest('form') as HTMLFormElement | null)?.getAttribute('name') || '',
  });
}

function hasSensitiveField(form: HTMLFormElement): boolean {
  return Array.from(form.elements).some((element) => element instanceof HTMLElement && isSensitiveElement(element));
}

function applyPlan(plan: Array<{ key: string; value: string; blocked?: boolean }>, descriptors: FieldDescriptor[], ui: ReturnType<typeof createUi>): void {
  const byKey = new Map(descriptors.map((descriptor) => [getFieldKey(descriptor), descriptor]));
  for (const item of plan) {
    if (item.blocked) continue;
    const descriptor = byKey.get(item.key);
    if (!descriptor) continue;
    const field = resolveElementById(descriptor.fieldId);
    if (!field || !isFillableField(field)) continue;
    if (item.value !== '') {
      applyValue(field, item.value);
    }
  }
  setStatus(ui, `Filled ${plan.filter((item) => !item.blocked).length} field(s).`);
}

function applyValue(field: HTMLElement, value: string): void {
  const input = field as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  if (field.matches('[contenteditable="true"]')) {
    field.textContent = value;
    field.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, data: value }));
    return;
  }
  if (input instanceof HTMLInputElement && (input.type === 'checkbox' || input.type === 'radio')) {
    input.checked = value === 'true' || value === '1' || value === 'yes' || value === 'on';
  } else {
    input.value = value;
  }
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function getFieldValue(field: HTMLElement): string {
  if (field.matches('[contenteditable="true"]')) {
    return field.textContent?.trim() || '';
  }
  const input = field as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  if (input instanceof HTMLInputElement && (input.type === 'checkbox' || input.type === 'radio')) {
    return String(input.checked);
  }
  return input.value || '';
}

function ensureFieldId(field: HTMLElement, descriptor?: Partial<FieldDescriptor>): string {
  if (!field.id) {
    field.id = `ai-autofill-${getFieldKey({
      siteKey: descriptor?.siteKey || getSiteKey(location.href),
      formKey: descriptor?.formKey || 'form',
      name: descriptor?.name || '',
      label: descriptor?.label || '',
      placeholder: descriptor?.placeholder || '',
      autocomplete: '',
      type: descriptor?.type || 'text',
      formName: '',
    })}`;
  }
  return field.id;
}

function resolveElementById(id: string | undefined | null): HTMLElement | null {
  if (!id) return null;
  return document.getElementById(id) as HTMLElement | null;
}

function getFieldRect(field: HTMLElement): DOMRect {
  return field.getBoundingClientRect();
}
