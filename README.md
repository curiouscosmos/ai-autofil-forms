# AI Autofill

Browser extension for Chrome and Firefox that helps autofill large forms with category-aware memory and optional third-party LLM providers.

## Scope

- Popup settings for connecting to external LLM APIs.
- Provider support for OpenAI, Claude AI, Google Gemini, XAI, and OpenRouter.
- Per-provider API key configuration with a save step before the rest of the popup unlocks.
- Provider model lists are fetched after the API key is saved and shown in a dropdown.
- The popup stays locked to the provider section until a key is saved.
- Global autofill enable/disable control.
- Toggle for the autofill icon shown near inputs.
- User-defined categories such as Job Applications.
- Category-specific instructions, uploaded files, and remembered form data.
- Active category switching from the popup and floating launcher.
- Bottom-right floating launcher on every page, with a popup toggle to show or hide it.
- Per-field fill action on hover.
- Save-to-memory action for fields the user edits.
- Autofill for checkboxes using stored memory and page context.
- Sensitive-form detection to disable autofill on forms containing credit card, SSN, password, or similar fields.
- Password fields must never show autofill or save actions.

## Prerequisites

- Node.js 18 or newer.
- Yarn.
- Chrome or Firefox for local extension testing.

## Install

```bash
yarn install
```

The `postinstall` script runs `wxt prepare`, which generates the local WXT type definitions and extension scaffolding.

## Scripts

```bash
yarn dev
```
Starts the WXT dev server for the default browser target.

```bash
yarn dev:firefox
```
Starts the WXT dev server for Firefox.

```bash
yarn compile
```
Runs TypeScript type checking with no emit.

```bash
yarn test
```
Runs the Node-based regression tests for shared state and provider helpers.

```bash
yarn build
```
Builds the extension for the default browser target.

```bash
yarn build:firefox
```
Builds the extension for Firefox.

```bash
yarn zip
```
Packages the default browser build as a distributable archive.

```bash
yarn zip:firefox
```
Packages the Firefox build as a distributable archive.

## Project Structure

```text
shared/
  providers.js    Provider request builders and response parsing.
  providers.d.ts  Typed declarations for provider helpers.
  state.js        Shared extension state and heuristics.
  state.d.ts      Typed declarations for shared state helpers.
entrypoints/
  background.ts   Background script entrypoint.
  content.ts      Content script entrypoint.
  popup/          Popup React UI and styles.
tests/
  state.test.mjs  Node-based regression tests for shared logic.
public/
  icon/           Extension icons.
  wxt.svg         WXT asset used by the scaffold.
assets/
  react.svg       Starter asset kept by the template.
wxt.config.ts     WXT configuration.
tsconfig.json     TypeScript configuration.
AGENTS.md         Project rules and product scope for agents.
```

WXT also generates local build metadata in `.wxt/`, which should not be edited manually.

## Current Implementation State

This repository now contains the WXT scaffold plus the first functional extension pass: provider settings, category state, shared autofill heuristics, a content-script launcher, and regression tests for the shared logic. The product scope above remains the behavioral reference for future work.

The popup currently uses a provider-first onboarding flow: choose a provider, enter and save the API key, then configure the model and the rest of the extension settings.

## Development Notes

- Keep Chrome and Firefox behavior aligned.
- Keep `README.md` and `AGENTS.md` synchronized when scripts, setup, or scope change.
- Prefer adding new extension logic near the relevant entrypoint instead of broad structural rewrites.
