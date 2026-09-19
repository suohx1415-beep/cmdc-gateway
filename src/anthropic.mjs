import crypto from 'node:crypto';
import { EMPTY_USAGE, toolOutputFromContent, usageFromEvent } from './wire.mjs';

function anthropicImagePart(source) {
  if (source?.type === 'base64') {
    const mediaType = source.media_type ?? 'image/png';
    return { type: 'image', image: `data:${mediaType};base64,${source.data ?? ''}`, mimeType: mediaType };
  }
  if (source?.type === 'url') return { type: 'image', image: source.url, mimeType: 'image/png' };
  return null;
}

function translateMessages(messages, warnings) {
  const wire = [];
  const toolNames = new Map();
  let activeToolMessage = null;

  for (const message of messages ?? []) {
    if (message?.role === 'tool' || message?.role === 'function') continue;
    const role = message?.role === 'assistant' ? 'assistant' : 'user';
    const content = message?.content;
    const blocks = typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : [];

    if (role === 'assistant') {
      activeToolMessage = null;
      const parts = [];
      for (const block of blocks) {
        if (block?.type === 'text') {
          if (block.text) parts.push({ type: 'text', text: block.text });
        } else if (block?.type === 'thinking' || block?.type === 'redacted_thinking') {
          const text = block.thinking ?? '';
          if (text) parts.push({ type: 'reasoning', text });
        } else if (block?.type === 'tool_use') {
          const name = block.name ?? '';
          if (!name) continue;
          const id = block.id ?? `call_${crypto.randomUUID()}`;
          toolNames.set(id, name);
          parts.push({ type: 'tool-call', toolCallId: id, toolName: name, input: block.input ?? {} });
        } else {
          warnings.push(`skipped unsupported assistant block: ${block?.type}`);
        }
      }
      if (parts.length) wire.push({ role: 'assistant', content: parts });
      continue;
    }

    const userBlocks = [];
    for (const block of blocks) {
      if (block?.type === 'text') {
        if (block.text) userBlocks.push({ type: 'text', text: block.text });
      } else if (block?.type === 'image') {
        const part = anthropicImagePart(block.source);
        if (part) userBlocks.push(part);
        else warnings.push('skipped an image block with an unsupported source');
      } else if (block?.type === 'tool_result') {
        if (!activeToolMessage) {
          activeToolMessage = { role: 'tool', content: [] };
          wire.push(activeToolMessage);
        }
        activeToolMessage.content.push({
          type: 'tool-result',
          toolCallId: block.tool_use_id ?? '',
          toolName: toolNames.get(block.tool_use_id) ?? 'unknown',
          output: toolOutputFromContent(block.content),
        });
      } else {
        warnings.push(`skipped unsupported user block: ${block?.type}`);
      }
    }
    if (userBlocks.length) {
      activeToolMessage = null;
      wire.push({ role: 'user', content: userBlocks });
    }
  }

  return wire;
}

export function translateMessagesRequest(body, config) {
  const warnings = [];
  const messages = translateMessages(body.messages, warnings);

  let system;
  if (typeof body.system === 'string') {
    if (body.system) system = [{ type: 'text', text: body.system }];
  } else if (Array.isArray(body.system)) {
    const sections = body.system.filter((block) => block?.type === 'text' && block.text);
    if (sections.length) {
      const last = sections.length - 1;
      system = sections.map((block, index) => ({
        type: 'text',
        text: index < last ? `${block.text}\n` : block.text,
        ...(block.cache_control ? { cache_control: block.cache_control } : {}),
      }));
    }
  }

  const tools = (body.tools ?? [])
    .filter((tool) => typeof tool?.name === 'string' && tool.name)
    .map((tool) => ({
      name: tool.name,
      description: typeof tool.description === 'string' ? tool.description : '',
      input_schema: tool.input_schema ?? { type: 'object', properties: {} },
    }));

  if (body.tool_choice && body.tool_choice.type && body.tool_choice.type !== 'auto') {
    warnings.push(`tool_choice "${body.tool_choice.type}" is not enforced by the Command Code backend`);
  }
  if (body.thinking?.type === 'enabled') {
    warnings.push('the thinking budget is advisory only; the model decides its own reasoning depth');
  }
  if (typeof body.top_p === 'number') warnings.push('top_p is not forwarded (not part of the wire protocol)');
  if (typeof body.top_k === 'number') warnings.push('top_k is not forwarded (not part of the wire protocol)');

  // Anthropic Messages has no reasoning_effort field, so the gateway default fills in only
  // when the caller did not pass one explicitly
  const reasoningEffort = body.reasoning_effort ?? config.reasoningEffort ?? '';
  if (!body.reasoning_effort && config.reasoningEffort) {
    warnings.push(`reasoning_effort defaulted to "${config.reasoningEffort}" (gateway default; client sent none)`);
  }

  const params = {
    model: body.model,
    messages,
    tools,
    max_tokens: Number(body.max_tokens) || config.maxTokens,
    ...(system ? { system } : {}),
    ...(typeof body.temperature === 'number' ? { temperature: body.temperature } : {}),
    ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
  };

  return {
    model: body.model,
    stream: Boolean(body.stream),
    params,
    warnings,
    messageId: `msg_${crypto.randomUUID().replace(/-/g, '')}`,
  };
}

function mapStopReason(value) {
  const raw = String(value ?? '').toLowerCase();
  if (raw === 'tool-calls' || raw === 'tool_calls' || raw === 'tool_use') return 'tool_use';
  if (raw === 'length' || raw === 'max_tokens') return 'max_tokens';
  return 'end_turn';
}

export class AnthropicReply {
  constructor({ model, messageId }) {
    this.model = model;
    this.id = messageId ?? `msg_${crypto.randomUUID().replace(/-/g, '')}`;
    this.blocks = [];
    this.openBlock = null;
    this.index = -1;
    this.usage = { ...EMPTY_USAGE };
    this.stopReason = null;
    this.started = false;
  }

  startEvents() {
    this.started = true;
    return [
      {
        event: 'message_start',
        data: {
          type: 'message_start',
          message: {
            id: this.id,
            type: 'message',
            role: 'assistant',
            model: this.model,
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 0, output_tokens: 0 },
          },
        },
      },
    ];
  }

  /**
   * Anthropic clients expect a signature before a thinking block closes. We have no real
   * signature, so an empty one is sent (documented behaviour).
   */
  signatureDelta() {
    return {
      event: 'content_block_delta',
      data: { type: 'content_block_delta', index: this.index, delta: { type: 'signature_delta', signature: '' } },
    };
  }

  /** `openBlock` holds the block *type* string, so compare against it directly. */
  closeBlock(events) {
    if (!this.openBlock) return;
    if (this.openBlock === 'thinking') events.push(this.signatureDelta());
    events.push({ event: 'content_block_stop', data: { type: 'content_block_stop', index: this.index } });
    this.openBlock = null;
  }

  pushBlock(type) {
    const events = [];
    this.closeBlock(events);
    this.index += 1;
    this.openBlock = type;
    const contentBlock =
      type === 'text' ? { type: 'text', text: '' } : type === 'thinking' ? { type: 'thinking', thinking: '' } : null;
    if (contentBlock) {
      events.push({ event: 'content_block_start', data: { type: 'content_block_start', index: this.index, content_block: contentBlock } });
    }
    return events;
  }

  handle(event) {
    const out = [];
    switch (event?.type) {
      case 'text-delta': {
        if (!event.text) break;
        if (this.openBlock !== 'text') out.push(...this.pushBlock('text'));
        this.pushContent({ type: 'text', text: event.text });
        out.push({ event: 'content_block_delta', data: { type: 'content_block_delta', index: this.index, delta: { type: 'text_delta', text: event.text } } });
        break;
      }
      case 'reasoning-delta': {
        if (!event.text) break;
        if (this.openBlock !== 'thinking') out.push(...this.pushBlock('thinking'));
        this.pushContent({ type: 'thinking', thinking: event.text });
        out.push({ event: 'content_block_delta', data: { type: 'content_block_delta', index: this.index, delta: { type: 'thinking_delta', thinking: event.text } } });
        break;
      }
      case 'tool-call': {
        const id = event.toolCallId || `call_${crypto.randomUUID()}`;
        const input = event.input ?? event.args ?? {};
        out.push(...this.pushBlock('tool_use'));
        const block = { type: 'tool_use', id, name: event.toolName ?? '', input };
        this.blocks.push({ ...block, index: this.index });
        out.push({
          event: 'content_block_start',
          data: { type: 'content_block_start', index: this.index, content_block: { type: 'tool_use', id, name: block.name, input: {} } },
        });
        out.push({
          event: 'content_block_delta',
          data: { type: 'content_block_delta', index: this.index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } },
        });
        break;
      }
      case 'finish': {
        const usage = usageFromEvent(event);
        // never let a usage-less finish event wipe tokens we already counted
        if (usage) this.usage = usage;
        this.stopReason = mapStopReason(event.finishReason ?? event.rawFinishReason);
        break;
      }
      case 'error': {
        const detail = typeof event.error === 'string' ? event.error : event.error?.message;
        const error = new Error(detail || 'upstream stream error');
        error.status = event.error?.statusCode ?? 502;
        error.type = 'upstream_stream_error';
        throw error;
      }
      default:
        break;
    }
    return out;
  }

  pushContent(block) {
    const last = this.blocks.at(-1);
    if (this.openBlock === 'text' && last?.index === this.index && last.type === 'text') last.text += block.text;
    else if (this.openBlock === 'thinking' && last?.index === this.index && last.type === 'thinking') last.thinking += block.thinking;
    else this.blocks.push({ ...block, index: this.index });
  }

  endEvents() {
    const events = [];
    if (!this.started) events.push(...this.startEvents());
    this.closeBlock(events);
    const usage = { input_tokens: this.usage.inputTokens, output_tokens: this.usage.outputTokens };
    if (this.usage.cacheReadTokens) usage.cache_read_input_tokens = this.usage.cacheReadTokens;
    if (this.usage.cacheWriteTokens) usage.cache_creation_input_tokens = this.usage.cacheWriteTokens;
    events.push({
      event: 'message_delta',
      data: { type: 'message_delta', delta: { stop_reason: this.stopReason ?? 'end_turn', stop_sequence: null }, usage },
    });
    events.push({ event: 'message_stop', data: { type: 'message_stop' } });
    return events;
  }

  /** Reasoning characters streamed so far — fallback when upstream omits the token split. */
  reasoningChars() {
    let total = 0;
    for (const block of this.blocks) if (block.type === 'thinking') total += (block.thinking ?? '').length;
    return total;
  }

  message() {
    const usage = { input_tokens: this.usage.inputTokens, output_tokens: this.usage.outputTokens };
    if (this.usage.cacheReadTokens) usage.cache_read_input_tokens = this.usage.cacheReadTokens;
    if (this.usage.cacheWriteTokens) usage.cache_creation_input_tokens = this.usage.cacheWriteTokens;
    return {
      id: this.id,
      type: 'message',
      role: 'assistant',
      model: this.model,
      content: this.blocks.map((block) => {
        if (block.type === 'text') return { type: 'text', text: block.text };
        if (block.type === 'thinking') return { type: 'thinking', thinking: block.thinking, signature: '' };
        return { type: 'tool_use', id: block.id, name: block.name, input: block.input };
      }),
      stop_reason: this.stopReason ?? 'end_turn',
      stop_sequence: null,
      usage,
    };
  }
}
