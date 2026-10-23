import type { ClientRequest, IncomingMessage } from 'node:http';
import * as https from 'node:https';
import {
  type DedicatedEndpointApproval,
  dedicatedInvocationPolicy,
} from './dedicatedInvocationPolicy';
import type { ListedModel, Project } from './provider';

export interface InferenceInput {
  modelId: string;
  projectId: string;
  secretKey: string;
  prompt: string;
  maxTokens: number;
  signal: AbortSignal;
}
export interface InferenceUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens?: number;
}
export type InferenceErrorCode =
  | 'endpoint_policy'
  | 'invalid_input'
  | 'invalid_credentials'
  | 'aborted'
  | 'timeout'
  | 'idle_timeout'
  | 'http_error'
  | 'network_error'
  | 'provider_error'
  | 'invalid_stream'
  | 'model_mismatch'
  | 'response_too_large'
  | 'frame_too_large'
  | 'unexpected_eof'
  | 'callback_error';
/** Never attach a provider body, upstream error, credentials, or prompt. */
export class InferenceError extends Error {
  constructor(
    public readonly code: InferenceErrorCode,
    public readonly status?: number,
  ) {
    super(`Inference failed: ${code}`);
    this.name = 'InferenceError';
  }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RESPONSE_BYTES = 2 * 1024 * 1024;
const FRAME_BYTES = 64 * 1024;
const TOTAL_MS = 60_000;
const IDLE_MS = 15_000;
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function count(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function usageSnapshot(value: unknown): InferenceUsage | undefined {
  if (!record(value)) return undefined;
  const inputTokens = value.prompt_tokens;
  const outputTokens = value.completion_tokens;
  const totalTokens = value.total_tokens;
  if (
    !count(inputTokens) ||
    !count(outputTokens) ||
    !count(totalTokens) ||
    inputTokens + outputTokens !== totalTokens
  )
    return undefined;
  const usage: InferenceUsage = { inputTokens, outputTokens, totalTokens };
  if (
    value.prompt_tokens_details !== undefined &&
    value.prompt_tokens_details !== null
  ) {
    if (!record(value.prompt_tokens_details)) return undefined;
    const cached = value.prompt_tokens_details.cached_tokens;
    if (cached !== undefined) {
      if (!count(cached) || cached > inputTokens) return undefined;
      usage.cachedInputTokens = cached;
    }
  }
  return usage;
}
/** One bounded HTTPS POST. DONE, not EOF or finish_reason, completes the stream. */
export async function invokeText(
  input: InferenceInput,
  onDelta: (text: string) => void,
  onUsage: (usage: InferenceUsage) => void,
): Promise<void> {
  if (
    typeof input.projectId !== 'string' ||
    typeof input.secretKey !== 'string' ||
    input.projectId.length !== 36 ||
    input.secretKey.length !== 36 ||
    !UUID.test(input.projectId) ||
    !UUID.test(input.secretKey)
  )
    throw new InferenceError('invalid_credentials');
  validateInvocationInput(input, onDelta, onUsage);
  return invokeSse(
    input,
    {
      hostname: 'api.scaleway.ai',
      path: `/${input.projectId}/v1/chat/completions`,
      authorization: `Bearer ${input.secretKey}`,
    },
    onDelta,
    onUsage,
  );
}

export interface DedicatedInferenceInput {
  deployment: ListedModel;
  project: Project;
  approval: DedicatedEndpointApproval;
  authorize(): string;
  prompt: string;
  maxTokens: number;
  signal: AbortSignal;
}
/** Policy and bounds are checked before credential access; no probe or fallback. */
export async function invokeDedicatedText(
  input: DedicatedInferenceInput,
  onDelta: (text: string) => void,
  onUsage: (usage: InferenceUsage) => void,
): Promise<void> {
  const decision = dedicatedInvocationPolicy(
    input.deployment,
    input.project,
    input.approval,
  );
  if (!decision.allowed) throw new InferenceError('endpoint_policy');
  const invocation = {
    modelId: decision.modelName,
    prompt: input.prompt,
    maxTokens: input.maxTokens,
    signal: input.signal,
  };
  validateInvocationInput(invocation, onDelta, onUsage);
  let authorization: string | undefined;
  if (decision.authentication === 'iam') {
    let secret: string;
    try {
      secret = input.authorize();
    } catch {
      throw new InferenceError('invalid_credentials');
    }
    if (
      typeof secret !== 'string' ||
      secret.length !== 36 ||
      !UUID.test(secret)
    )
      throw new InferenceError('invalid_credentials');
    authorization = `Bearer ${secret}`;
  }
  // authorize may synchronously cancel the request. Do not dispatch after that.
  if (invocation.signal.aborted) throw new InferenceError('aborted');
  const destination = new URL(decision.url);
  return invokeSse(
    invocation,
    {
      hostname: destination.hostname,
      path: destination.pathname + destination.search,
      authorization,
    },
    onDelta,
    onUsage,
  );
}

type SseInput = Pick<
  InferenceInput,
  'modelId' | 'prompt' | 'maxTokens' | 'signal'
>;
function validateInvocationInput(
  input: SseInput,
  onDelta: (text: string) => void,
  onUsage: (usage: InferenceUsage) => void,
): void {
  if (
    typeof input.modelId !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(input.modelId) ||
    /\s/.test(input.modelId) ||
    typeof input.prompt !== 'string' ||
    input.prompt.length > 4096 ||
    !Number.isInteger(input.maxTokens) ||
    input.maxTokens < 1 ||
    input.maxTokens > 2048 ||
    !input.signal ||
    typeof input.signal.addEventListener !== 'function' ||
    typeof onDelta !== 'function' ||
    typeof onUsage !== 'function'
  )
    throw new InferenceError('invalid_input');
  if (input.signal.aborted) throw new InferenceError('aborted');
}

/** Internal destination only: callers must pass through their policy wrapper. */
function invokeSse(
  input: SseInput,
  destination: { hostname: string; path: string; authorization?: string },
  onDelta: (text: string) => void,
  onUsage: (usage: InferenceUsage) => void,
): Promise<void> {
  const body = JSON.stringify({
    model: input.modelId,
    messages: [{ role: 'user', content: input.prompt }],
    max_tokens: input.maxTokens,
    stream: true,
  });
  return new Promise<void>((resolve, reject) => {
    let request: ClientRequest | undefined;
    let response: IncomingMessage | undefined;
    let settled = false;
    let idle: ReturnType<typeof setTimeout> | undefined;
    let snapshot: InferenceUsage | undefined;
    let finished = false;
    let responseBytes = 0;
    let frameBytes = 0;
    let lineParts: Buffer[] = [];
    let data: string[] = [];
    let event = '';
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const settle = (code?: InferenceErrorCode, status?: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(total);
      clearTimeout(idle);
      input.signal.removeEventListener('abort', abort);
      // Keep error listeners installed: destroy can produce asynchronous errors.
      response?.destroy();
      request?.destroy();
      if (code) reject(new InferenceError(code, status));
      else resolve();
    };
    const abort = () => settle('aborted');
    const total = setTimeout(() => settle('timeout'), TOTAL_MS);
    const resetIdle = () => {
      clearTimeout(idle);
      idle = setTimeout(() => settle('idle_timeout'), IDLE_MS);
    };
    const emit = (callback: () => void) => {
      if (settled) return;
      try {
        callback();
      } catch {
        settle('callback_error');
      }
    };
    const frame = () => {
      const payload = data.join('\n');
      data = [];
      const frameEvent = event;
      event = '';
      if (frameEvent === 'error') {
        settle('provider_error');
        return;
      }
      if (!payload) return;
      if (payload === '[DONE]') {
        const finalUsage = snapshot;
        if (finalUsage) emit(() => onUsage(finalUsage));
        if (!settled) settle();
        return;
      }
      let value: unknown;
      try {
        value = JSON.parse(payload);
      } catch {
        settle('invalid_stream');
        return;
      }
      if (!record(value)) {
        settle('invalid_stream');
        return;
      }
      if (value.error !== undefined && value.error !== null) {
        settle('provider_error');
        return;
      }
      if (value.model !== undefined && value.model !== input.modelId) {
        settle('model_mismatch');
        return;
      }
      if (!Array.isArray(value.choices)) {
        settle('invalid_stream');
        return;
      }
      if (value.usage !== undefined && value.usage !== null)
        snapshot = usageSnapshot(value.usage);
      let seenZero = false;
      for (const choice of value.choices) {
        if (!record(choice) || !count(choice.index)) {
          settle('invalid_stream');
          return;
        }
        if (choice.index !== 0) continue;
        if (seenZero) {
          settle('invalid_stream');
          return;
        }
        seenZero = true;
        if (!record(choice.delta)) {
          settle('invalid_stream');
          return;
        }
        const content = choice.delta.content;
        if (
          content !== undefined &&
          content !== null &&
          typeof content !== 'string'
        ) {
          settle('invalid_stream');
          return;
        }
        if (typeof content === 'string' && content.length > 0) {
          if (finished) {
            settle('invalid_stream');
            return;
          }
          emit(() => onDelta(content));
          if (settled) return;
        }
        if (
          choice.finish_reason !== undefined &&
          choice.finish_reason !== null
        ) {
          if (
            choice.finish_reason !== 'stop' &&
            choice.finish_reason !== 'length'
          ) {
            settle('provider_error');
            return;
          }
          finished = true;
        }
      }
    };
    const line = (bytes: Buffer) => {
      let text: string;
      try {
        text = decoder.decode(bytes);
      } catch {
        settle('invalid_stream');
        return;
      }
      if (text.endsWith('\r')) text = text.slice(0, -1);
      if (text === '') {
        frameBytes = 0;
        frame();
        return;
      }
      if (text.startsWith(':')) return;
      const colon = text.indexOf(':');
      const field = colon < 0 ? text : text.slice(0, colon);
      let value = colon < 0 ? '' : text.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'data') data.push(value);
      if (field === 'event') event = value;
    };
    input.signal.addEventListener('abort', abort, { once: true });
    resetIdle();
    try {
      request = https.request(
        {
          protocol: 'https:',
          hostname: destination.hostname,
          port: 443,
          path: destination.path,
          rejectUnauthorized: true,
          method: 'POST',
          headers: {
            ...(destination.authorization === undefined
              ? {}
              : { Authorization: destination.authorization }),
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        (incoming) => {
          if (settled) {
            incoming.on('error', () => {});
            incoming.destroy();
            return;
          }
          response = incoming;
          incoming.on('error', () => settle('network_error'));
          incoming.on('aborted', () => settle('unexpected_eof'));
          incoming.on('end', () => settle('unexpected_eof'));
          incoming.on('close', () => settle('unexpected_eof'));
          if (incoming.statusCode !== 200) {
            settle('http_error', incoming.statusCode);
            return;
          }
          const contentType = incoming.headers['content-type'];
          if (
            typeof contentType !== 'string' ||
            !/^text\/event-stream(?:\s*;|\s*$)/i.test(contentType)
          ) {
            settle('invalid_stream');
            return;
          }
          resetIdle();
          incoming.on('data', (chunk: Buffer) => {
            if (settled) return;
            if (!Buffer.isBuffer(chunk)) {
              settle('invalid_stream');
              return;
            }
            responseBytes += chunk.length;
            if (responseBytes > RESPONSE_BYTES) {
              settle('response_too_large');
              return;
            }
            resetIdle();
            let start = 0;
            while (start < chunk.length && !settled) {
              const newline = chunk.indexOf(10, start);
              const end = newline < 0 ? chunk.length : newline + 1;
              frameBytes += end - start;
              if (frameBytes > FRAME_BYTES) {
                settle('frame_too_large');
                return;
              }
              lineParts.push(
                chunk.subarray(start, newline < 0 ? end : newline),
              );
              if (newline >= 0) {
                const complete = Buffer.concat(lineParts);
                lineParts = [];
                line(complete);
              }
              start = end;
            }
          });
        },
      );
      request.on('error', () => settle('network_error'));
      request.on('close', () => {
        if (!response) settle('network_error');
      });
      if (input.signal.aborted || settled) {
        request.destroy();
        if (!settled) abort();
      } else request.end(body);
    } catch {
      settle('network_error');
    }
  });
}
