/**
 * Anthropic Messages translation. The regression this file exists for: `signature_delta` was
 * never emitted, because the open-block field holds the block *type* string and the old code
 * read `.type` off it. Anthropic clients expect a signature before a thinking block closes.
 */
import './helpers.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AnthropicReply, translateMessagesRequest } from '../src/anthropic.mjs';

const reply = (extra = {}) => new AnthropicReply({ model: 'claude-sonnet-4-6', messageId: 'msg_test', ...extra });
const types = (events) => events.map((event) => event.data?.type ?? event.event);
const deltas = (events) => events.filter((event) => event.data?.type === 'content_block_delta').map((event) => event.data.delta);

test('a thinking block closes with a signature_delta before content_block_stop', () => {
  const instance = reply();
  instance.handle({ type: 'reasoning-delta', text: 'thinking…' });

  const closing = instance.handle({ type: 'text-delta', text: 'answer' });

  const signatureIndex = closing.findIndex((event) => event.data?.delta?.type === 'signature_delta');
  const stopIndex = closing.findIndex((event) => event.data?.type === 'content_block_stop');

  assert.notEqual(signatureIndex, -1, 'signature_delta must be emitted (it was missing before)');
  assert.notEqual(stopIndex, -1);
  assert.ok(signatureIndex < stopIndex, 'the signature must precede the block stop');
  assert.equal(closing[signatureIndex].data.delta.signature, '', 'we have no real signature to send');
  assert.equal(closing[signatureIndex].data.index, 0, 'it must carry the thinking block index');
});

test('a plain text block is closed without a signature', () => {
  const instance = reply();
  instance.handle({ type: 'text-delta', text: 'a' });

  // a second delta stays inside the same open block: no new start, no close
  const second = instance.handle({ type: 'text-delta', text: 'b' });
  assert.deepEqual(types(second), ['content_block_delta']);
  assert.equal(instance.index, 0, 'still the first block');

  const end = instance.endEvents();
  assert.equal(end.some((event) => event.data?.delta?.type === 'signature_delta'), false);
  assert.ok(end.some((event) => event.data?.type === 'content_block_stop'));
});

test('endEvents closes an open thinking block with a signature', () => {
  const instance = reply();
  instance.handle({ type: 'reasoning-delta', text: 'still open' });

  const end = instance.endEvents();

  assert.ok(end.some((event) => event.data?.delta?.type === 'signature_delta'), 'streams that end mid-thought still need one');
  assert.ok(end.some((event) => event.data?.type === 'content_block_stop'));
  assert.equal(instance.openBlock, null);
});

test('block indices increment and deltas always target the block the client was told about', () => {
  const instance = reply();
  const events = [
    ...instance.handle({ type: 'reasoning-delta', text: 'r' }),
    ...instance.handle({ type: 'text-delta', text: 't' }),
  ];

  const starts = events.filter((event) => event.data?.type === 'content_block_start');
  assert.equal(starts.length, 2);
  assert.equal(instance.index, 1);
  for (const event of events.filter((entry) => entry.data?.type === 'content_block_delta')) {
    assert.equal(typeof event.data.index, 'number');
    assert.ok(event.data.index <= instance.index);
  }
});

test('text and thinking deltas emit the matching delta types', () => {
  const instance = reply();
  assert.deepEqual(deltas(instance.handle({ type: 'text-delta', text: 'hi' })).at(-1), { type: 'text_delta', text: 'hi' });
  assert.deepEqual(deltas(instance.handle({ type: 'reasoning-delta', text: 'hm' })).at(-1), {
    type: 'thinking_delta',
    thinking: 'hm',
  });
});

test('empty text deltas are ignored instead of opening an empty block', () => {
  const instance = reply();
  assert.deepEqual(instance.handle({ type: 'text-delta', text: '' }), []);
  assert.deepEqual(instance.handle({ type: 'reasoning-delta' }), []);
  assert.equal(instance.openBlock, null);
});

test('a tool call opens a block with empty input, then streams the arguments', () => {
  const instance = reply();
  const events = instance.handle({ type: 'tool-call', toolCallId: 'call_1', toolName: 'get_weather', input: { city: 'SH' } });

  const start = events.find((event) => event.data?.type === 'content_block_start');
  assert.equal(start.data.content_block.type, 'tool_use');
  assert.equal(start.data.content_block.name, 'get_weather');
  assert.deepEqual(start.data.content_block.input, {}, 'input must start empty and arrive via delta');

  const jsonDelta = events.find((event) => event.data?.delta?.type === 'input_json_delta');
  assert.deepEqual(JSON.parse(jsonDelta.data.delta.partial_json), { city: 'SH' });
  assert.deepEqual(instance.message().content.at(-1), { type: 'tool_use', id: 'call_1', name: 'get_weather', input: { city: 'SH' } });
});

test('a tool call accepts the args fallback and generates an id when none is given', () => {
  const instance = reply();
  const events = instance.handle({ type: 'tool-call', toolName: 't', args: { a: 1 } });
  const start = events.find((event) => event.data?.type === 'content_block_start');
  assert.match(start.data.content_block.id, /^call_/);
});

test('a finish event without usage does not wipe the tokens already counted', () => {
  const instance = reply();
  instance.handle({ type: 'finish', totalUsage: { inputTokens: 120, outputTokens: 40, inputTokenDetails: { cacheReadTokens: 100 } } });
  assert.deepEqual(instance.usage, { inputTokens: 120, outputTokens: 40, cacheReadTokens: 100, cacheWriteTokens: 0, reasoningTokens: 0, textTokens: 40 });

  // no usage on this one: the previous totals must survive
  instance.handle({ type: 'finish', finishReason: 'stop' });
  assert.equal(instance.usage.inputTokens, 120);
  assert.equal(instance.usage.outputTokens, 40);
});

test('a finish event carries the stop reason through the mapping', () => {
  for (const [raw, expected] of [['tool-calls', 'tool_use'], ['max_tokens', 'max_tokens'], ['stop', 'end_turn']]) {
    const instance = reply();
    instance.handle({ type: 'finish', finishReason: raw });
    assert.equal(instance.stopReason, expected);
  }
});

test('an error event aborts the stream as a typed error', () => {
  const instance = reply();
  try {
    instance.handle({ type: 'error', error: { message: 'upstream blew up', statusCode: 503 } });
    assert.fail('expected the error event to throw');
  } catch (error) {
    assert.equal(error.message, 'upstream blew up');
    assert.equal(error.status, 503);
    assert.equal(error.type, 'upstream_stream_error');
  }
  // a plain string payload and a missing status both have to work
  assert.throws(() => reply().handle({ type: 'error', error: 'plain' }), /plain/);
});

test('endEvents emits message_delta and message_stop with the usage Anthropic expects', () => {
  const instance = reply();
  instance.handle({ type: 'text-delta', text: 'x' });
  instance.handle({ type: 'finish', totalUsage: { inputTokens: 10, outputTokens: 5, inputTokenDetails: { cacheReadTokens: 7, cacheWriteTokens: 3 } } });

  const end = instance.endEvents();
  assert.deepEqual(types(end).slice(-2), ['message_delta', 'message_stop']);

  const messageDelta = end.find((event) => event.data?.type === 'message_delta');
  assert.deepEqual(messageDelta.data.usage, {
    input_tokens: 10,
    output_tokens: 5,
    cache_read_input_tokens: 7,
    cache_creation_input_tokens: 3,
  });
  assert.equal(messageDelta.data.delta.stop_reason, 'end_turn');
});

test('endEvents starts the message itself when the caller never did', () => {
  const end = reply().endEvents();
  assert.equal(end[0].data.type, 'message_start');
});

test('cache fields are omitted from usage when there is no cache activity', () => {
  const instance = reply();
  instance.handle({ type: 'finish', totalUsage: { inputTokens: 1, outputTokens: 2 } });
  const usage = instance.endEvents().find((event) => event.data?.type === 'message_delta').data.usage;
  assert.deepEqual(usage, { input_tokens: 1, output_tokens: 2 });
});

test('the non-streaming message carries thinking blocks with an empty signature', () => {
  const instance = reply();
  instance.handle({ type: 'reasoning-delta', text: 'thought' });
  instance.handle({ type: 'text-delta', text: 'answer' });

  const message = instance.message();
  assert.equal(message.type, 'message');
  assert.equal(message.role, 'assistant');
  assert.deepEqual(message.content[0], { type: 'thinking', thinking: 'thought', signature: '' });
  assert.deepEqual(message.content[1], { type: 'text', text: 'answer' });
  assert.equal(message.stop_reason, 'end_turn');
});

test('reasoningChars counts streamed thinking as a fallback metric', () => {
  const instance = reply();
  instance.handle({ type: 'reasoning-delta', text: 'abc' });
  instance.handle({ type: 'reasoning-delta', text: 'de' });
  instance.handle({ type: 'text-delta', text: 'ignored' });
  assert.equal(instance.reasoningChars(), 5);
});

/* ------------------------------------------------------------------ request translation */

const config = { reasoningEffort: '', maxTokens: 64_000 };

test('a system string becomes a single text section', () => {
  const request = translateMessagesRequest({ model: 'm', messages: [], system: 'be brief' }, config);
  assert.deepEqual(request.params.system, [{ type: 'text', text: 'be brief' }]);
});

test('a system array keeps its sections and marks the cache breakpoint', () => {
  const request = translateMessagesRequest(
    {
      model: 'm',
      messages: [],
      system: [
        { type: 'text', text: 'first' },
        { type: 'text', text: 'last', cache_control: { type: 'ephemeral' } },
      ],
    },
    config,
  );

  assert.deepEqual(request.params.system, [
    { type: 'text', text: 'first\n' },
    { type: 'text', text: 'last', cache_control: { type: 'ephemeral' } },
  ]);
});

test('tool_choice and the sampling knobs are reported as not forwarded', () => {
  const request = translateMessagesRequest(
    { model: 'm', messages: [], tool_choice: { type: 'any' }, top_p: 0.9, top_k: 5, thinking: { type: 'enabled' } },
    config,
  );

  const warnings = request.warnings.join('\n');
  assert.match(warnings, /tool_choice "any"/);
  assert.match(warnings, /top_p is not forwarded/);
  assert.match(warnings, /top_k is not forwarded/);
  assert.match(warnings, /budget is advisory/);
  assert.equal(request.params.top_p, undefined, 'unsupported knobs must not leak into the wire request');
});

test('tool_choice auto is not worth warning about', () => {
  const request = translateMessagesRequest({ model: 'm', messages: [], tool_choice: { type: 'auto' } }, config);
  assert.equal(request.warnings.some((warning) => warning.includes('tool_choice')), false);
});

test('the gateway reasoning default fills in only when the client sent none, and says so', () => {
  const withDefault = translateMessagesRequest({ model: 'm', messages: [] }, { reasoningEffort: 'low', maxTokens: 100 });
  assert.equal(withDefault.params.reasoning_effort, 'low');
  assert.match(withDefault.warnings.join('\n'), /reasoning_effort defaulted to "low"/);

  // the client's own value always wins, and then there is nothing to warn about
  const explicit = translateMessagesRequest({ model: 'm', messages: [], reasoning_effort: 'max' }, { reasoningEffort: 'low', maxTokens: 100 });
  assert.equal(explicit.params.reasoning_effort, 'max');
  assert.equal(explicit.warnings.some((warning) => warning.includes('defaulted')), false);
});

test('an empty gateway default sends no reasoning_effort at all', () => {
  const request = translateMessagesRequest({ model: 'm', messages: [] }, { reasoningEffort: '', maxTokens: 100 });
  assert.equal('reasoning_effort' in request.params, false, 'the gateway must not change model behaviour by default');
});

test('max_tokens falls back to the configured cap', () => {
  assert.equal(translateMessagesRequest({ model: 'm', messages: [] }, config).params.max_tokens, 64_000);
  assert.equal(translateMessagesRequest({ model: 'm', messages: [], max_tokens: 10 }, config).params.max_tokens, 10);
});

test('tools are normalised and nameless ones dropped', () => {
  const request = translateMessagesRequest(
    {
      model: 'm',
      messages: [],
      tools: [{ name: 'ok', description: 'd', input_schema: { type: 'object' } }, { description: 'no name' }],
    },
    config,
  );

  assert.equal(request.params.tools.length, 1);
  assert.deepEqual(request.params.tools[0], { name: 'ok', description: 'd', input_schema: { type: 'object' } });
});

test('a tool with no schema still gets a valid empty object schema', () => {
  const request = translateMessagesRequest({ model: 'm', messages: [], tools: [{ name: 'x' }] }, config);
  assert.deepEqual(request.params.tools[0].input_schema, { type: 'object', properties: {} });
});

test('tool results become a tool message and recover the tool name from the earlier call', () => {
  const request = translateMessagesRequest(
    {
      model: 'm',
      messages: [
        { role: 'assistant', content: [{ type: 'tool_use', id: 'call_9', name: 'lookup', input: {} }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_9', content: 'result text' }] },
      ],
    },
    config,
  );

  const toolMessage = request.params.messages.find((message) => message.role === 'tool');
  assert.equal(toolMessage.content[0].toolName, 'lookup');
  assert.deepEqual(toolMessage.content[0].output, { type: 'text', value: 'result text' });
});

test('an unknown tool result id degrades to a placeholder name instead of throwing', () => {
  const request = translateMessagesRequest(
    { model: 'm', messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'ghost', content: 'x' }] }] },
    config,
  );
  assert.equal(request.params.messages[0].content[0].toolName, 'unknown');
});

test('unsupported content blocks are skipped and reported', () => {
  const request = translateMessagesRequest(
    {
      model: 'm',
      messages: [
        { role: 'assistant', content: [{ type: 'mystery' }] },
        { role: 'user', content: [{ type: 'also_mystery' }] },
      ],
    },
    config,
  );

  const warnings = request.warnings.join('\n');
  assert.match(warnings, /skipped unsupported assistant block: mystery/);
  assert.match(warnings, /skipped unsupported user block: also_mystery/);
  assert.equal(request.params.messages.length, 0, 'nothing translatable should produce no messages');
});

test('base64 and URL images are both translated', () => {
  const request = translateMessagesRequest(
    {
      model: 'm',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/webp', data: 'AAAA' } },
            { type: 'image', source: { type: 'url', url: 'https://example.com/a.png' } },
            { type: 'image', source: { type: 'unknown' } },
          ],
        },
      ],
    },
    config,
  );

  const parts = request.params.messages[0].content;
  assert.deepEqual(parts[0], { type: 'image', image: 'data:image/webp;base64,AAAA', mimeType: 'image/webp' });
  assert.deepEqual(parts[1], { type: 'image', image: 'https://example.com/a.png', mimeType: 'image/png' });
  assert.equal(parts.length, 2, 'the unsupported source must be dropped');
  assert.match(request.warnings.join('\n'), /unsupported source/);
});

test('the message id is generated in the Anthropic shape', () => {
  const request = translateMessagesRequest({ model: 'm', messages: [] }, config);
  assert.match(request.messageId, /^msg_[0-9a-f]{32}$/);
});

test('the request reports the model and stream flag it was given', () => {
  const request = translateMessagesRequest({ model: 'some-model', messages: [], stream: true }, config);
  assert.equal(request.model, 'some-model');
  assert.equal(request.stream, true);
  assert.equal(request.params.model, 'some-model');
});

test('a legacy tool role message is dropped rather than translated wrongly', () => {
  const request = translateMessagesRequest(
    { model: 'm', messages: [{ role: 'tool', content: 'legacy' }, { role: 'user', content: 'real' }] },
    config,
  );
  assert.equal(request.params.messages.length, 1);
  assert.equal(request.params.messages[0].role, 'user');
});
