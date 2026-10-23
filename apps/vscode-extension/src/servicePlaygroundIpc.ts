export type ServiceInput =
  | {
      type:
        | 'ready'
        | 'cancel'
        | 'saveExchange'
        | 'loadSnapshot'
        | 'exportExample';
    }
  | { type: 'run'; prompt: string; maxTokens: number };
export function parseServiceInput(value: unknown): ServiceInput | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return;
  const own = Reflect.ownKeys(value);
  if (
    own.some(
      (key) =>
        typeof key !== 'string' ||
        !Object.hasOwn(
          Object.getOwnPropertyDescriptor(value, key) ?? {},
          'value',
        ),
    )
  )
    return;
  const v = value as Record<string, unknown>;
  if (own.length === 1) {
    if (
      v.type === 'ready' ||
      v.type === 'cancel' ||
      v.type === 'saveExchange' ||
      v.type === 'loadSnapshot' ||
      v.type === 'exportExample'
    )
      return { type: v.type };
    return;
  }
  if (
    own.length === 3 &&
    own.every((key) =>
      ['type', 'prompt', 'maxTokens'].includes(key as string),
    ) &&
    v.type === 'run' &&
    typeof v.prompt === 'string' &&
    v.prompt.trim().length > 0 &&
    v.prompt.length <= 4096 &&
    typeof v.maxTokens === 'number' &&
    Number.isInteger(v.maxTokens) &&
    v.maxTokens >= 1 &&
    v.maxTokens <= 2048
  )
    return { type: 'run', prompt: v.prompt, maxTokens: v.maxTokens };
}
