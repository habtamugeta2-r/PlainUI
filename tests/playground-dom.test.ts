/**
 * The playground has no logic of its own, but it has plenty of wiring: element ids, event
 * listeners, debouncing, tab switching, the share link. This test runs `web/app.ts` against a
 * real DOM (jsdom) and drives it the way a reader would — type, break something, fix it, format.
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { before, test } from 'node:test';

import { JSDOM } from 'jsdom';

const TICK = 260;

interface Playground {
  readonly editor: HTMLTextAreaElement;
  readonly status: HTMLElement;
  readonly diagnostics: HTMLElement;
  readonly dart: HTMLElement;
  readonly html: HTMLElement;
  readonly preview: HTMLIFrameElement;
  readonly gutter: HTMLElement;
  readonly highlight: HTMLElement;
  readonly window: JSDOM['window'];
}

let page: Playground;

function element<T extends HTMLElement>(window: JSDOM['window'], id: string): T {
  const found = window.document.getElementById(id);
  assert.ok(found !== null, `#${id} is missing from index.html`);
  return found as T;
}

before(async () => {
  const dom = new JSDOM(readFileSync('web/index.html', 'utf8'), { url: 'http://localhost:4173/' });
  const { window } = dom;

  // Only what jsdom must own. `btoa`/`atob`/`URL`/`Blob` come from Node: replacing the globals
  // makes jsdom's own implementations misbehave (its btoa starts rejecting plain ASCII).
  Object.assign(globalThis, {
    window,
    document: window.document,
    localStorage: window.localStorage,
    location: window.location,
    history: window.history,
  });
  // jsdom's own Performance recurses when installed as a Node global; the app only needs now().
  Object.defineProperty(globalThis, 'performance', {
    value: { now: (): number => Number(process.hrtime.bigint()) / 1e6 },
    configurable: true,
  });
  Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });

  await import('../web/app.ts');

  page = {
    editor: element<HTMLTextAreaElement>(window, 'source'),
    status: element(window, 'status'),
    diagnostics: element(window, 'diagnostics'),
    dart: element(window, 'dart'),
    html: element(window, 'html'),
    preview: element<HTMLIFrameElement>(window, 'preview'),
    gutter: element(window, 'gutter'),
    highlight: element(window, 'highlight'),
    window,
  };
});

function type(text: string): void {
  page.editor.value = text;
  page.editor.dispatchEvent(new page.window.Event('input', { bubbles: true }));
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

test('the page starts with a working example', () => {
  assert.ok(page.editor.value.includes('screen Counter'), 'the counter example is loaded by default');
  assert.match(page.status.textContent ?? '', /no problems/);
  assert.match(page.dart.textContent ?? '', /class Counter extends StatefulWidget/);
  assert.match(page.preview.srcdoc, /<main class="pui-root"/);
  assert.match(page.highlight.innerHTML, /<span class="tok-/);
  assert.equal((page.gutter.textContent ?? '').trim().split('\n').length, page.editor.value.split('\n').length);
  assert.match(page.diagnostics.textContent ?? '', /No problems found/);
});

test('breaking the source reports the error in every pane', async () => {
  type('screen Counter:\n    colum:\n        text "x"\n');
  await wait(TICK);

  assert.match(page.status.textContent ?? '', /1 error/);
  assert.match(page.diagnostics.textContent ?? '', /PUI2001/);
  assert.match(page.dart.textContent ?? '', /Fix the errors/);
  assert.match(page.preview.srcdoc, /Nothing to preview yet/);

  const items = Array.from(page.diagnostics.querySelectorAll('.diagnostic'));
  assert.ok(items.length >= 1);
  assert.equal(items.some((item) => item.textContent?.includes('PUI2001')), true);
});

test('fixing the source clears the diagnostics', async () => {
  type('screen Counter:\n    column:\n        text "x"\n');
  await wait(TICK);

  assert.match(page.status.textContent ?? '', /no problems/);
  assert.match(page.dart.textContent ?? '', /class Counter extends StatelessWidget/);
  assert.match(page.preview.srcdoc, /<span class="pui-text"/);
});

test('the format button rewrites the source', async () => {
  type('screen   Counter:\n      column  gap=8:\n          text   "hi"   style=heading\n');
  await wait(TICK);

  page.window.document.getElementById('format')!.dispatchEvent(new page.window.Event('click'));
  await wait(TICK);

  assert.equal(page.editor.value, 'screen Counter:\n    column gap=8:\n        text "hi" style=heading\n');
  assert.match(page.status.textContent ?? '', /no problems/);
});

test('the output tabs switch panels', () => {
  const tabs = Array.from(page.window.document.querySelectorAll<HTMLButtonElement>('.tab'));
  const htmlTab = tabs.find((tab) => tab.dataset['tab'] === 'html');
  assert.ok(htmlTab !== undefined);

  htmlTab.dispatchEvent(new page.window.Event('click'));
  assert.equal(htmlTab.getAttribute('aria-selected'), 'true');
  assert.equal(element<HTMLElement>(page.window, 'panel-html').hidden, false);
  assert.equal(element<HTMLElement>(page.window, 'panel-preview').hidden, true);

  const previewTab = tabs.find((tab) => tab.dataset['tab'] === 'preview');
  previewTab!.dispatchEvent(new page.window.Event('click'));
  assert.equal(element<HTMLElement>(page.window, 'panel-preview').hidden, false);
  assert.equal(element<HTMLElement>(page.window, 'panel-html').hidden, true);
});

test('the share button puts the source in the URL', () => {
  type('screen Shared:\n    text "hi"\n');
  page.window.document.getElementById('share')!.dispatchEvent(new page.window.Event('click'));

  assert.match(page.window.location.hash, /^#code=/);
  const encoded = page.window.location.hash.replace('#code=', '');
  assert.equal(decodeURIComponent(atob(encoded)), 'screen Shared:\n    text "hi"\n');
});

test('choosing an example replaces the source', async () => {
  const select = element<HTMLSelectElement>(page.window, 'examples');
  const options = Array.from(select.options).map((option) => option.value).filter((value) => value !== '');
  assert.ok(options.length >= 3, 'expected the bundled examples in the picker');

  select.value = options[options.length - 1]!;
  select.dispatchEvent(new page.window.Event('change'));
  await wait(TICK);

  assert.match(page.status.textContent ?? '', /no problems/);
  assert.ok(page.editor.value.length > 20);
});

test('the source survives a reload through localStorage', () => {
  const stored = page.window.localStorage.getItem('plainui.playground.source');
  assert.ok(stored !== null && stored.includes('screen '));
});
