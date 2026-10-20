import {models, validatePrompt} from './demo';
export type Input = {type: 'ready'} | {type: 'run'; model: string; prompt: string} | {type: 'cancel'} | {type: 'experiment'};
export function parseInput(value: unknown): Input | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const v = value as Record<string, unknown>;
  if (Object.keys(v).length === 1 && typeof v.type === 'string' && ['ready', 'cancel', 'experiment'].includes(v.type)) return v as Input;
  if (Object.keys(v).length !== 3 || v.type !== 'run' || typeof v.model !== 'string'
      || typeof v.prompt !== 'string' || !models.some(m => m.id === v.model)) return;
  try { return {type: 'run', model: v.model, prompt: validatePrompt(v.prompt)}; } catch { return; }
}
