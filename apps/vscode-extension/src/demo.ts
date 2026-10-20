import { Buffer } from 'node:buffer';
/** Synthetic offline data: not a provider catalog, usage or compatibility claim. */
export const models = [
  {
    id: 'demo-general',
    label: 'Demo · General assistant',
    description: 'Synthetic • no API calls',
  },
  {
    id: 'demo-code',
    label: 'Demo · Coding assistant',
    description: 'Synthetic • no API calls',
  },
] as const;
export type DemoModel = (typeof models)[number];
export interface Experiment {
  version: 1;
  mode: 'offline-synthetic';
  model: string;
  prompt: string;
  output: string;
  status: 'completed' | 'cancelled';
  billed: false;
}
export function validatePrompt(value: string): string {
  const prompt = value.trim();
  if (!prompt || Buffer.byteLength(prompt, 'utf8') > 4096)
    throw new Error('Use a prompt between 1 and 4096 UTF-8 bytes.');
  return prompt;
}
export async function runDemo(
  model: DemoModel,
  prompt: string,
  cancelled: () => boolean,
  onChunk: (text: string) => void,
  delayMs = 65,
): Promise<Experiment> {
  if (!models.some((item) => item.id === model.id))
    throw new Error('Unknown synthetic model.');
  prompt = validatePrompt(prompt);
  const text =
    'Offline demonstration. Model: ' +
    model.label +
    '. Your prompt stays in VS Code memory. ' +
    'This simulated stream lets you test model selection, progress, cancellation and experiment export. ' +
    'No request was sent to Scaleway. The next increment will add a real connection through SecretStorage.';
  let output = '';
  for (const token of text.match(/\S+\s*/g) ?? []) {
    if (cancelled()) break;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    if (cancelled()) break;
    output += token;
    onChunk(token);
  }
  return {
    version: 1,
    mode: 'offline-synthetic',
    model: model.id,
    prompt,
    output,
    status: cancelled() ? 'cancelled' : 'completed',
    billed: false,
  };
}
