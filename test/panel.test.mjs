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

/* ------------------------------------------------------------------ cache dial */

const dial = /<svg viewBox="0 0 200 146"[\s\S]*?<\/svg>/.exec(html)?.[0] ?? '';
const dialPart = (selector) => new RegExp(`<(?:line|path|circle|text) class="${selector}"[^>]*>`).exec(dial)?.[0] ?? '';
const attribute = (source, name) => new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(source)?.[1] ?? null;

test('the cache hit rate is drawn as a dial, not a progress bar', () => {
  assert.ok(dial, 'the sidebar dial markup is missing');
  assert.equal(html.includes('class="cache-rate"'), false, 'the old progress-bar block should be gone');
  assert.equal(html.includes('.cache-rate{'), false, 'the old styles should be gone');
  assert.ok(html.includes('class="cache-gauge"'));
  for (const part of ['track', 'arc', 'needle', 'hub']) {
    assert.ok(dial.includes(`class="${part}"`), `the dial is missing its ${part}`);
  }
});

test('the dial has a real instrument scale', () => {
  const ticks = [...dial.matchAll(/<line class="tick( major)?"/g)];
  assert.equal(ticks.length, 41, 'one tick every 6° across the sweep');
  assert.equal(ticks.filter((match) => match[1]).length, 9, 'a major tick every 30°');
  assert.equal([...dial.matchAll(/class="tick-label"/g)].length, 5, 'labelled 0 / 25 / 50 / 75 / 100');
  for (const value of [0, 25, 50, 75, 100]) {
    assert.ok(dial.includes(`>${value}</text>`), `the ${value} label is missing`);
  }
});

test('the needle rests at zero and the value arc starts empty', () => {
  const needle = dialPart('needle');
  const rotation = Number(/rotate\((-?[\d.]+)/.exec(attribute(needle, 'transform') ?? '')?.[1]);
  // the sweep starts at 150° and the needle is drawn pointing up (270°)
  assert.equal(rotation, 150 - 270, 'the needle must rest at the 0 end of the scale');

  const arc = dialPart('arc');
  assert.equal(attribute(arc, 'stroke-dashoffset'), attribute(arc, 'data-len'), 'the arc starts fully hidden');
  assert.equal(attribute(arc, 'stroke-dasharray'), attribute(arc, 'data-len'));
});

test('the arc length attribute agrees with the path it draws', () => {
  // the client animates with stroke-dashoffset, so data-len has to match the real arc length
  // exactly — otherwise the needle and the coloured arc would disagree about the same value
  const arc = dialPart('arc');
  const path = attribute(arc, 'd');
  const parsed = /^M ([\d.-]+) ([\d.-]+) A ([\d.]+) [\d.]+ 0 1 1 ([\d.-]+) ([\d.-]+)$/.exec(path);
  assert.ok(parsed, `unexpected arc path: ${path}`);

  const [, startX, startY, radius, endX, endY] = parsed.map(Number);
  const hub = dialPart('hub');
  const cx = Number(attribute(hub, 'cx'));
  const cy = Number(attribute(hub, 'cy'));
  const degrees = (x, y) => (Math.atan2(y - cy, x - cx) * 180) / Math.PI;

  assert.equal(degrees(startX, startY).toFixed(1), '150.0', 'the scale should start at the lower left');
  let sweep = degrees(endX, endY) - degrees(startX, startY);
  if (sweep <= 0) sweep += 360;
  assert.equal(sweep.toFixed(1), '240.0', 'a speedometer sweep');

  const expected = (radius * sweep * Math.PI) / 180;
  assert.equal(Number(attribute(arc, 'data-len')).toFixed(2), expected.toFixed(2));
  assert.ok(Number(attribute(arc, 'data-len')) > 0);
});

test('every dial coordinate stays inside the viewBox', () => {
  const width = 200;
  const height = 146;
  const points = [];

  for (const match of dial.matchAll(/<line class="tick[^"]*" x1="([\d.-]+)" y1="([\d.-]+)" x2="([\d.-]+)" y2="([\d.-]+)"/g)) {
    points.push([Number(match[1]), Number(match[2])], [Number(match[3]), Number(match[4])]);
  }
  for (const match of dial.matchAll(/<path class="(?:track|arc)" d="M ([\d.-]+) ([\d.-]+) A [\d.]+ [\d.]+ 0 1 1 ([\d.-]+) ([\d.-]+)"/g)) {
    points.push([Number(match[1]), Number(match[2])], [Number(match[3]), Number(match[4])]);
  }
  for (const match of dial.matchAll(/<text class="tick-label" x="([\d.-]+)" y="([\d.-]+)"/g)) {
    // 8.5px glyphs sit around their anchor
    points.push([Number(match[1]) - 8, Number(match[2]) - 7], [Number(match[1]) + 8, Number(match[2]) + 2]);
  }

  // the needle sweeps the whole scale, so check both ends at every angle it can reach
  const needle = /<line class="needle" x1="([\d.-]+)" y1="([\d.-]+)" x2="([\d.-]+)" y2="([\d.-]+)" transform="rotate\((-?[\d.]+) ([\d.]+) ([\d.]+)\)"/.exec(dial);
  assert.ok(needle, 'the needle is missing');
  const ends = [[Number(needle[1]), Number(needle[2])], [Number(needle[3]), Number(needle[4])]];
  const originX = Number(needle[6]);
  const originY = Number(needle[7]);
  for (let step = 0; step <= 240; step += 12) {
    const radians = ((Number(needle[5]) + step) * Math.PI) / 180;
    for (const [x, y] of ends) {
      const dx = x - originX;
      const dy = y - originY;
      points.push([
        originX + dx * Math.cos(radians) - dy * Math.sin(radians),
        originY + dx * Math.sin(radians) + dy * Math.cos(radians),
      ]);
    }
  }

  assert.equal(/NaN|undefined/.test(dial), false, 'the dial contains a non-numeric value');
  assert.ok(points.length > 50, 'expected the dial to be dense enough to be worth checking');
  for (const [x, y] of points) {
    assert.ok(Number.isFinite(x) && Number.isFinite(y), `bad coordinate: ${x}, ${y}`);
    assert.ok(x >= -1 && x <= width + 1, `x=${x} falls outside the ${width} wide viewBox`);
    assert.ok(y >= -1 && y <= height + 1, `y=${y} falls outside the ${height} tall viewBox`);
  }
});

test('the readout sits outside the dial so the needle can never cross it', () => {
  // the needle sweeps the lower half of the dial, so a readout drawn inside it would be crossed
  // at low rates — and always in the empty state, where the needle rests at zero
  assert.equal(dial.includes('readout'), false, 'the dial must not draw the value itself');
  assert.ok(markup.includes('class="readout" id="cache-rate-value"'), 'the value node must keep its id');
  assert.ok(markup.includes('id="cache-rate-sub"'));
});

/* ------------------------------------------------------------------ per-request bars */

test('the live feed shows a bar for each request\'s cache hit rate and first token', () => {
  assert.ok(script.includes('function miniBar('), 'the inline bar helper is missing');
  assert.match(script, /miniBar\(cacheRate, /, 'the cache bar should use the per-request rate');
  assert.match(script, /miniBar\(slowest && typeof r\.ttftMs === 'number'/, 'the first-token bar is missing');
  // the first-token bar is relative, so the panel has to say what it is relative to
  assert.match(html, /最慢的一条为满格/);
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
