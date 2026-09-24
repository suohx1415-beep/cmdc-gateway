/**
 * The panel is a single self-contained HTML string with one inline script. A syntax error or a
 * renamed element id would only show up in a browser, so it is checked here instead.
 */
import './helpers.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

import { callbackPage, panelHtml } from '../src/panel.mjs';

const html = panelHtml();
const script = /<script[^>]*>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';
/** Ids from the markup only: ids synthesised inside the script must not satisfy the lookup check. */
const markup = html.replace(script, '');
const definedIds = new Set([...markup.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]));
const referencedIds = new Set([...script.matchAll(/\$\('([^']+)'\)/g)].map((match) => match[1]));

test('the panel renders a complete HTML document', () => {
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /<\/html>\s*$/);
  assert.ok(html.includes('<style>'), 'styles should be inlined');
  assert.ok(html.includes('<meta name="viewport"'), 'the panel is used from phones too');
});

test('the panel ships exactly one inline script', () => {
  assert.equal([...html.matchAll(/<script/g)].length, 1);
  assert.equal([...html.matchAll(/<\/script>/g)].length, 1);
  assert.ok(script.length > 1000, `unexpectedly small script (${script.length} chars)`);
});

test('the embedded script parses as JavaScript', () => {
  // parse only, never execute: this is what catches an unfinished edit or a stray brace that
  // a text comparison would happily ship
  assert.doesNotThrow(() => new vm.Script(script, { filename: 'panel-inline.js' }));
});

test('every element the script looks up exists in the markup', () => {
  const missing = [...referencedIds].filter((id) => !definedIds.has(id));
  assert.deepEqual(missing, [], `script references ids that are not in the HTML: ${missing.join(', ')}`);
});

test('the script does look things up, so the previous test is not vacuous', () => {
  assert.ok(referencedIds.size > 20, `expected the panel to look up many elements, found ${referencedIds.size}`);
  assert.ok(definedIds.size > referencedIds.size, 'markup should define at least as many ids as are looked up');
});

test('markup ids are unique so lookups are unambiguous', () => {
  const all = [...markup.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]);
  const duplicates = [...new Set(all.filter((id, index) => all.indexOf(id) !== index))];
  assert.deepEqual(duplicates, [], `duplicate element ids: ${duplicates.join(', ')}`);
});

test('the access-key warning slot and its setter are wired up', () => {
  // the panel has to be able to tell the operator their key is the published default
  assert.ok(definedIds.has('ov-accesskey-warn'), 'missing the warning element');
  assert.ok(script.includes('setAccessKeyNote'), 'missing the setter call');
});

test('the overview shows the access key and the reasoning tier', () => {
  assert.ok(definedIds.has('ov-accesskey'));
  assert.ok(definedIds.has('ov-reasoning'));
});

test('the embedded script cannot break out of its own script element', () => {
  assert.equal(script.includes('</script'), false);
});

test('the panel never inlines a real access key', () => {
  // the HTML is served without auth so it can load first; it must not carry the secret
  assert.doesNotMatch(html, /cmdc_[0-9a-f]{40}/, 'the panel must not embed a concrete key');
});

/* ------------------------------------------------------------------ callback page */

test('the OAuth callback page renders both outcomes', () => {
  const success = callbackPage({ ok: true, title: '登录成功', message: '可以关掉这个页面了' });
  const failure = callbackPage({ ok: false, title: '登录失败', message: '授权被拒绝' });

  assert.match(success, /^<!doctype html>/i);
  assert.match(success, /<\/html>\s*$/);
  assert.ok(success.includes('登录成功'));
  assert.ok(success.includes('可以关掉这个页面了'));
  assert.ok(failure.includes('登录失败'));
  assert.ok(failure.includes('授权被拒绝'));
});

test('callbackPage interpolates verbatim, so callers own the escaping', () => {
  // This template does not escape. server.mjs escapes the one dynamic value it passes (the
  // account display name) with escapeHtml() before calling; the other call sites pass
  // constants. Pinned here so that contract stays deliberate: a new call site carrying
  // untrusted input has to escape it there.
  const page = callbackPage({ ok: true, title: 'T', message: 'M' });
  assert.ok(page.includes('<h1>T</h1>'));
  assert.ok(page.includes('<p>M</p>'));
  assert.ok(page.includes('href="/panel"'), 'the page should offer a way back to the panel');
});
