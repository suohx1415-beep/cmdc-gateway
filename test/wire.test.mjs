/**
 * Wire-level helpers. The bugs these cover were all "silently produced wrong numbers":
 * a usage-less `finish` event zeroing real totals, and structured tool results being dropped.
 */
import './helpers.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  EMPTY_USAGE,
  contentToText,
  imagePartFromUrl,
  mapFinishReason,
  normalizeUsage,
  parseJsonObject,
  toolOutputFromContent,
  usageFromEvent,
} from '../src/wire.mjs';

test('normalizeUsage derives text tokens from the split, or from the remainder', () => {
  const withSplit = normalizeUsage({
    inputTokens: 100,
    outputTokens: 50,
    outputTokenDetails: { textTokens: 20, reasoningTokens: 30 },
    inputTokenDetails: { cacheReadTokens: 80, cacheWriteTokens: 5 },
  });
  assert.deepEqual(withSplit, {
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 80,
    cacheWriteTokens: 5,
    reasoningTokens: 30,
    textTokens: 20,
  });

  // no split reported: the remainder is text, so the two still add up to outputTokens
  const withoutSplit = normalizeUsage({ inputTokens: 1, outputTokens: 50, reasoningTokens: 30 });
  assert.equal(withoutSplit.textTokens, 20);
  assert.equal(withoutSplit.reasoningTokens + withoutSplit.textTokens, withoutSplit.outputTokens);
});

test('normalizeUsage tolerates missing or junk payloads', () => {
  assert.deepEqual(normalizeUsage(null), { ...EMPTY_USAGE });
  assert.deepEqual(normalizeUsage('nonsense'), { ...EMPTY_USAGE });
  assert.deepEqual(normalizeUsage({}), { ...EMPTY_USAGE });
  const junk = normalizeUsage({ inputTokens: 'abc', outputTokens: null });
  assert.equal(junk.inputTokens, 0);
  assert.equal(junk.outputTokens, 0);
});

test('usageFromEvent returns null when an event carries no usage', () => {
  // regression: this used to return zeros, which let a usage-less finish wipe known totals
  assert.equal(usageFromEvent({ type: 'finish', finishReason: 'stop' }), null);
  assert.equal(usageFromEvent({ type: 'text-delta', text: 'hi' }), null);
  assert.equal(usageFromEvent(null), null);
  assert.equal(usageFromEvent({ totalUsage: null }), null);
  assert.equal(usageFromEvent({ totalUsage: 'nope' }), null);
});

test('usageFromEvent accepts both totalUsage and a plain usage key', () => {
  const fromTotal = usageFromEvent({ type: 'finish', totalUsage: { inputTokens: 7, outputTokens: 9 } });
  assert.equal(fromTotal.inputTokens, 7);
  assert.equal(fromTotal.outputTokens, 9);

  // the wire protocol is reverse-engineered and has used both shapes
  const fromUsage = usageFromEvent({ type: 'finish', usage: { inputTokens: 3, outputTokens: 4 } });
  assert.equal(fromUsage.inputTokens, 3);
  assert.equal(fromUsage.outputTokens, 4);
});

test('contentToText keeps scalars and text parts, drops everything else', () => {
  assert.equal(contentToText('plain'), 'plain');
  assert.equal(contentToText(42), '42');
  assert.equal(contentToText(false), 'false');
  assert.equal(contentToText([{ type: 'text', text: 'a' }, { type: 'input_text', text: 'b' }]), 'ab');
  assert.equal(contentToText([{ type: 'image', source: {} }]), '');
  assert.equal(contentToText(null), '');
  assert.equal(contentToText(undefined), '');
  assert.equal(contentToText([{ type: 'text' }]), '');
});

test('toolOutputFromContent preserves structured results instead of dropping them', () => {
  // regression: a non-text tool result used to become an empty string, silently truncating
  // the caller's tool loop
  const structured = toolOutputFromContent([{ type: 'image', source: { data: 'x' } }]);
  assert.equal(structured.type, 'text');
  assert.deepEqual(JSON.parse(structured.value), [{ type: 'image', source: { data: 'x' } }]);

  const object = toolOutputFromContent({ rows: 3, ok: true });
  assert.deepEqual(JSON.parse(object.value), { rows: 3, ok: true });

  // plain text still passes through untouched
  assert.deepEqual(toolOutputFromContent('hello'), { type: 'text', value: 'hello' });
  assert.deepEqual(toolOutputFromContent([{ type: 'text', text: 'hi' }]), { type: 'text', value: 'hi' });
  // nothing at all stays empty rather than becoming "[]"
  assert.deepEqual(toolOutputFromContent([]), { type: 'text', value: '' });
  assert.deepEqual(toolOutputFromContent(null), { type: 'text', value: '' });
});

test('toolOutputFromContent survives a value JSON cannot represent', () => {
  const cyclic = {};
  cyclic.self = cyclic;
  assert.deepEqual(toolOutputFromContent(cyclic), { type: 'text', value: '' });
});

test('parseJsonObject falls back instead of throwing', () => {
  assert.deepEqual(parseJsonObject('{"a":1}'), { a: 1 });
  assert.deepEqual(parseJsonObject({ a: 1 }), { a: 1 });
  assert.deepEqual(parseJsonObject('not json', { fallback: true }), { fallback: true });
  assert.deepEqual(parseJsonObject('', { fallback: true }), { fallback: true });
  assert.deepEqual(parseJsonObject(null), {});
  // primitives are not objects, so they fall back
  assert.deepEqual(parseJsonObject('42', { fallback: true }), { fallback: true });
  assert.deepEqual(parseJsonObject('"text"', { fallback: true }), { fallback: true });
  // a JSON array is typeof "object" and passes through as-is. Note this differs from
  // readJsonSafe, which rejects arrays; pinned here so changing it stays deliberate.
  assert.deepEqual(parseJsonObject('[1,2]'), [1, 2]);
});

test('imagePartFromUrl keeps the declared mime type', () => {
  assert.deepEqual(imagePartFromUrl('data:image/jpeg;base64,AAAA'), {
    type: 'image',
    image: 'data:image/jpeg;base64,AAAA',
    mimeType: 'image/jpeg',
  });
  assert.deepEqual(imagePartFromUrl('https://example.com/a.png'), {
    type: 'image',
    image: 'https://example.com/a.png',
    mimeType: 'image/png',
  });
});

test('mapFinishReason normalises the shapes seen on the wire', () => {
  for (const raw of ['tool-calls', 'tool_calls', 'tool_use']) assert.equal(mapFinishReason(raw), 'tool_calls');
  for (const raw of ['length', 'max_tokens', 'MAX_TOKENS']) assert.equal(mapFinishReason(raw), 'length');
  for (const raw of ['stop', 'end_turn', '', null, undefined, 'whatever']) assert.equal(mapFinishReason(raw), 'stop');
});
