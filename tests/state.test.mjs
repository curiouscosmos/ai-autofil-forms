import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAutofillPlan,
  createCategory,
  createDefaultState,
  getFieldKey,
  normalizeState,
  resolveFieldValue,
  setActiveCategory,
  setMemoryEntry,
  shouldBlockField,
} from '../shared/state.js';
import {
  buildModelListRequest,
  buildProviderRequest,
  extractResponseText,
  normalizeModelList,
  parseAutofillResponse,
} from '../shared/providers.js';

test('normalizeState fills defaults and preserves categories', () => {
  const state = normalizeState({
    settings: { provider: 'xai', autofillEnabled: false, showLauncher: false },
    categories: [createCategory('Job Applications', { id: 'jobs', active: true, instructions: 'Use resume' })],
    activeCategoryId: 'jobs',
  });

  assert.equal(state.settings.provider, 'xai');
  assert.equal(state.settings.autofillEnabled, false);
  assert.equal(state.settings.showLauncher, false);
  assert.equal(state.categories[0].name, 'Job Applications');
  assert.equal(state.activeCategoryId, 'jobs');
});

test('shouldBlockField blocks sensitive fields and passwords', () => {
  assert.equal(shouldBlockField({ type: 'password', name: 'password' }), true);
  assert.equal(shouldBlockField({ type: 'text', label: 'Credit Card Number' }), true);
  assert.equal(shouldBlockField({ type: 'text', placeholder: 'SSN' }), true);
  assert.equal(shouldBlockField({ type: 'text', name: 'firstName' }), false);
});

test('field keys are stable for the same descriptor', () => {
  const descriptor = {
    siteKey: 'example.com',
    formKey: 'apply',
    name: 'first_name',
    label: 'First name',
    placeholder: 'First name',
    type: 'text',
  };
  assert.equal(getFieldKey(descriptor), getFieldKey({ ...descriptor }));
});

test('memory entries resolve for the active category and site', () => {
  let state = createDefaultState();
  state = setActiveCategory(state, 'general');
  state = setMemoryEntry(state, {
    siteKey: 'example.com',
    formKey: 'apply',
    name: 'email',
    label: 'Email address',
    placeholder: '',
    type: 'email',
  }, 'user@example.com');

  const value = resolveFieldValue(state, {
    siteKey: 'example.com',
    formKey: 'apply',
    name: 'email',
    label: 'Email address',
    placeholder: '',
    type: 'email',
  });

  assert.equal(value, 'user@example.com');
});

test('autofill plan blocks sensitive fields', () => {
  const plan = buildAutofillPlan(createDefaultState(), [
    { siteKey: 'example.com', formKey: 'apply', name: 'password', label: 'Password', placeholder: '', type: 'password' },
  ]);

  assert.equal(plan[0].blocked, true);
  assert.equal(plan[0].canFill, false);
});

test('provider payloads normalize across providers', () => {
  const request = buildProviderRequest('openrouter', 'token', 'openai/gpt-4o-mini', {
    messages: [{ role: 'user', content: 'Hello' }],
  });
  assert.match(request.url, /openrouter\.ai/);
  assert.equal(request.headers.Authorization, 'Bearer token');
  assert.equal(extractResponseText('openai', { choices: [{ message: { content: 'ok' } }] }), 'ok');
  assert.deepEqual(parseAutofillResponse('```json\n{"fields":{"email":"user@example.com"}}\n```'), {
    fields: { email: 'user@example.com' },
  });
  assert.equal(buildModelListRequest('gemini', 'abc').url, 'https://generativelanguage.googleapis.com/v1beta/models?key=abc');
  assert.deepEqual(
    normalizeModelList('claude', {
      data: [{ id: 'claude-sonnet-4-20250514', display_name: 'Claude Sonnet 4' }],
    }),
    [{ id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' }],
  );
});
