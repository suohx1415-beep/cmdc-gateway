import crypto from 'node:crypto';
import {
  EMPTY_USAGE,
  contentToText,
  imagePartFromUrl,
  mapFinishReason,
  parseJsonObject,
  toolOutputFromContent,
  usageFromEvent,
} from './wire.mjs';

function normalizeTool(tool) {
  const fn = tool?.function ?? tool;
  const name = typeof fn?.name === 'string' ? fn.name : null;
  if (!name) return null;
  return {
    name,
    description: typeof fn.description === 'string' ? fn.description : '',
    input_schema: fn.parameters ?? fn.input_schema ?? { type: 'object', properties: {} },
  };
}

function userParts(content, warnings) {
  if (typeof content === 'string') return content ? [{ type: 'text', text: content }] : [];
  if (!Array.isArray(content)) return [];
  const parts = [];
  for (const part of content) {
    if (typeof part === 'string') {
      if (part) parts.push({ type: 'text', text: part });
      continue;
    }
    if (part?.type === 'text' || part?.type === 'input_text') {
      const text = String(part.text ?? '');
      if (text) parts.push({ type: 'text', text });
      continue;
    }
    if (part?.type === 'image_url' || part?.type === 'input_image') {
      const url = typeof part.image_url === 'string' ? part.image_url : part.image_url?.url ?? part.image_url;
      if (typeof url === 'string' && url) parts.push(imagePartFromUrl(url));
      else warnings.push('skipped an image part with no usable url');
      continue;
    }
    warnings.push(`skipped unsupported content part: ${part?.type ?? typeof part}`);
  }
  return parts;
}

export function translateChatRequest(body, config) {
  const warnings = [];
  const messages = [];
  const systemTexts = [];
  const toolNames = new Map();
  let activeToolMessage = null;

  for (const message of body.messages ?? []) {
    const role = message?.role;
    if (role === 'system' || role === 'developer') {
      const text = contentToText(message.content);
      if (text) systemTexts.push(text);
      continue;
    }

    if (role === 'tool' || role === 'function') {
      const toolCallId = message.tool_call_id ?? message.tool_use_id ?? '';
      const toolName = message.name ?? toolNames.get(toolCallId) ?? 'unknown';
      if (!activeToolMessage) {
        activeToolMessage = { role: 'tool', content: [] };
        messages.push(activeToolMessage);
      }
      activeToolMessage.content.push({
        type: 'tool-result',
        toolCallId,
        toolName,
        output: toolOutputFromContent(message.content),
      });
      continue;
    }

    // any non-tool message ends the current tool-result group
    activeToolMessage = null;

    if (role === 'assistant') {
      const parts = [];
      const reasoning = message.reasoning_content ?? message.reasoning;
      if (typeof reasoning === 'string' && reasoning) parts.push({ type: 'reasoning', text: reasoning });
      const text = contentToText(message.content);
      if (text) parts.push({ type: 'text', text });
      for (const call of message.tool_calls ?? []) {
        const name = call?.function?.name ?? call?.name;
        if (!name) continue;
        const id = call.id ?? call.tool_call_id ?? `call_${crypto.randomUUID()}`;
        toolNames.set(id, name);
        parts.push({
          type: 'tool-call',
          toolCallId: id,
          toolName: name,
          input: parseJsonObject(call.function?.arguments ?? call.arguments),
        });
      }
      if (message.function_call?.name) {
        const id = `call_${crypto.randomUUID()}`;
        toolNames.set(id, message.function_call.name);
        parts.push({
          type: 'tool-call',
          toolCallId: id,
          toolName: message.function_call.name,
          input: parseJsonObject(message.function_call.arguments),
        });
      }
      if (parts.length) messages.push({ role: 'assistant', content: parts });
      continue;
    }

    const parts = userParts(message?.content, warnings);
    if (parts.length) messages.push({ role: 'user', content: parts });
  }

  let tools = (body.tools ?? []).map(normalizeTool).filter(Boolean);
  if (body.tool_choice === 'none') tools = [];
  else if (body.tool_choice && body.tool_choice !== 'auto') {
    warnings.push('tool_choice is not enforced by the Command Code backend; tools were passed as-is');
  }

  const maxTokens = Number(body.max_completion_tokens ?? body.max_tokens) || config.maxTokens;
  const temperature = typeof body.temperature === 'number' ? body.temperature : undefined;
  const reasoningEffort = body.reasoning_effort ?? body.reasoning?.effort;

  if (typeof body.top_p === 'number') warnings.push('top_p is not forwarded (not part of the wire protocol)');
  if (body.n && body.n > 1) warnings.push('n > 1 is not supported; returning a single choice');

  const params = {
    model: body.model,
    messages,
    tools,
    max_tokens: maxTokens,
    ...(systemTexts.length ? { system: [{ type: 'text', text: systemTexts.join('\n\n') }] } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
    ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
  };

  return {
    model: body.model,
    stream: Boolean(body.stream),
    includeUsage: Boolean(body.stream_options?.include_usage),
    params,
    warnings,
    threadId: typeof body.user === 'string' ? body.user : undefined,
  };
}

export class OpenAIReply {
  constructor({ model, includeUsage = false }) {
    this.model = model;
    this.includeUsage = includeUsage;
    this.id = `chatcmpl-${crypto.randomUUID().replace(/-/g, '')}`;
    this.created = Math.floor(Date.now() / 1000);
    this.text = '';
    this.reasoning = '';
    this.toolCalls = [];
    this.toolIndex = new Map();
    this.usage = { ...EMPTY_USAGE };
    this.finishReason = null;
    this.roleSent = false;
  }

  chunk(delta, finishReason = null) {
    return {
      id: this.id,
      object: 'chat.completion.chunk',
      created: this.created,
      model: this.model,
      choices: [{ index: 0, delta, finish_reason: finishReason, logprobs: null }],
    };
  }

  roleChunk() {
    if (this.roleSent) return null;
    this.roleSent = true;
    return this.chunk({ role: 'assistant', content: '' });
  }

  handle(event) {
    const out = [];
    switch (event?.type) {
      case 'text-delta': {
        const text = event.text ?? '';
        if (!text) break;
        this.text += text;
        out.push(this.chunk({ content: text }));
        break;
      }
      case 'reasoning-delta': {
        const text = event.text ?? '';
        if (!text) break;
        this.reasoning += text;
        out.push(this.chunk({ reasoning_content: text }));
        break;
      }
      case 'tool-call': {
        const name = event.toolName ?? '';
        const id = event.toolCallId || `call_${crypto.randomUUID()}`;
        const index = this.toolCalls.length;
        const args = JSON.stringify(event.input ?? event.args ?? {});
        this.toolCalls.push({ id, name, arguments: args });
        this.toolIndex.set(id, index);
        out.push(
          this.chunk({ tool_calls: [{ index, id, type: 'function', function: { name, arguments: args } }] }),
        );
        break;
      }
      case 'finish': {
        const usage = usageFromEvent(event);
        // never let a usage-less finish event wipe tokens we already counted
        if (usage) this.usage = usage;
        this.finishReason = mapFinishReason(event.finishReason ?? event.rawFinishReason);
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

  finalChunks() {
    const finishReason = this.finishReason ?? 'stop';
    const chunks = [this.chunk({}, finishReason)];
    if (this.includeUsage) {
      chunks.push({
        id: this.id,
        object: 'chat.completion.chunk',
        created: this.created,
        model: this.model,
        choices: [],
        usage: this.usagePayload(),
      });
    }
    return chunks;
  }

  usagePayload() {
    return {
      prompt_tokens: this.usage.inputTokens,
      completion_tokens: this.usage.outputTokens,
      total_tokens: this.usage.inputTokens + this.usage.outputTokens,
      prompt_tokens_details: { cached_tokens: this.usage.cacheReadTokens },
    };
  }

  message() {
    const toolCalls = this.toolCalls.map((call) => ({
      id: call.id,
      type: 'function',
      function: { name: call.name, arguments: call.arguments },
    }));
    return {
      role: 'assistant',
      content: this.text || null,
      refusal: null,
      ...(this.reasoning ? { reasoning_content: this.reasoning } : {}),
      ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
    };
  }

  completion() {
    return {
      id: this.id,
      object: 'chat.completion',
      created: this.created,
      model: this.model,
      choices: [
        {
          index: 0,
          message: this.message(),
          finish_reason: this.finishReason ?? 'stop',
          logprobs: null,
        },
      ],
      usage: this.usagePayload(),
    };
  }
}
