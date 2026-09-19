export const EMPTY_USAGE = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  reasoningTokens: 0,
  textTokens: 0,
};

export function parseJsonObject(raw, fallback = {}) {
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw !== 'string' || !raw.trim()) return fallback;
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' ? value : fallback;
  } catch {
    return fallback;
  }
}

export function imagePartFromUrl(url) {
  const match = /^data:([^;,]+);base64,([\s\S]*)$/.exec(url);
  if (match) return { type: 'image', image: url, mimeType: match[1] };
  return { type: 'image', image: url, mimeType: 'image/png' };
}

export function contentToText(content) {
  if (typeof content === 'string') return content;
  if (typeof content === 'number' || typeof content === 'boolean') return String(content);
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (typeof part === 'number' || typeof part === 'boolean') return String(part);
      if (part?.type === 'text' || part?.type === 'input_text') return String(part.text ?? '');
      return '';
    })
    .join('');
}

/**
 * Tool results are often structured (objects, or arrays of non-text parts). Dropping them
 * silently truncates the caller's tool loop, so anything non-text is kept as JSON.
 */
export function toolOutputFromContent(content) {
  const text = contentToText(content);
  if (text) return { type: 'text', value: text };
  const structured = Array.isArray(content) ? content.length > 0 : Boolean(content) && typeof content === 'object';
  if (!structured) return { type: 'text', value: text };
  try {
    return { type: 'text', value: JSON.stringify(content) };
  } catch {
    return { type: 'text', value: '' };
  }
}

/**
 * Upstream reports `outputTokens` inclusive of reasoning, plus a split under
 * `outputTokenDetails` (and a top-level `reasoningTokens`). Keeping the split lets the panel
 * answer "how much of this request was the model thinking".
 */
export function normalizeUsage(raw) {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_USAGE };
  const input = raw.inputTokenDetails ?? {};
  const output = raw.outputTokenDetails ?? {};
  const outputTokens = Number(raw.outputTokens) || 0;
  const reasoningTokens = Number(raw.reasoningTokens ?? output.reasoningTokens) || 0;
  const textTokens = Number(output.textTokens);
  return {
    inputTokens: Number(raw.inputTokens) || 0,
    outputTokens,
    cacheReadTokens: Number(input.cacheReadTokens) || 0,
    cacheWriteTokens: Number(input.cacheWriteTokens) || 0,
    reasoningTokens,
    // if the upstream ever omits the split, treat the remainder as text so both still add up
    textTokens: Number.isFinite(textTokens) ? textTokens : Math.max(0, outputTokens - reasoningTokens),
  };
}

/**
 * Usage off a terminal stream event, or null when the event carries none.
 * Returns null (instead of zeros) so callers never overwrite known totals with `0`.
 * Tolerates the payload living under `totalUsage` or a plain `usage` key, since the wire
 * protocol is reverse-engineered and has changed shape between CLI versions.
 */
export function usageFromEvent(event) {
  if (!event || typeof event !== 'object') return null;
  const raw = event.totalUsage ?? event.usage ?? null;
  if (!raw || typeof raw !== 'object') return null;
  return normalizeUsage(raw);
}

export function mapFinishReason(raw) {
  const value = String(raw ?? '').toLowerCase();
  if (value === 'tool-calls' || value === 'tool_calls' || value === 'tool_use') return 'tool_calls';
  if (value === 'length' || value === 'max_tokens') return 'length';
  return 'stop';
}
