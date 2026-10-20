import { Buffer } from 'node:buffer';
import { type Experiment, models, validatePrompt } from './demo';

/** Strict offline schema. Import is data only; no executable/provider configuration. */
export function parseExperiment(value: unknown): Experiment | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).length !== 7 ||
    !['version', 'mode', 'model', 'prompt', 'output', 'status', 'billed'].every(
      (key) => Object.hasOwn(row, key),
    ) ||
    row.version !== 1 ||
    row.mode !== 'offline-synthetic' ||
    row.billed !== false ||
    !models.some((model) => model.id === row.model) ||
    typeof row.prompt !== 'string' ||
    typeof row.output !== 'string' ||
    Buffer.byteLength(row.output, 'utf8') > 65536 ||
    (row.status !== 'completed' && row.status !== 'cancelled')
  )
    return;
  try {
    if (validatePrompt(row.prompt) !== row.prompt) return;
    return {
      version: 1,
      mode: 'offline-synthetic',
      model: row.model as string,
      prompt: row.prompt,
      output: row.output,
      status: row.status,
      billed: false,
    };
  } catch {
    return;
  }
}
export function decodeExperiment(bytes: Uint8Array): Experiment | undefined {
  if (bytes.byteLength > 131072) return;
  try {
    return parseExperiment(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
    );
  } catch {
    return;
  }
}
export function encodeExperiment(experiment: Experiment): Uint8Array {
  const parsed = parseExperiment(experiment);
  if (!parsed) throw new Error('invalid_experiment');
  return Buffer.from(`${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
}
/** Standalone fixtures, not real inference examples. Safe JSON quoting avoids code injection. */
export function exportOfflineExample(
  experiment: Experiment,
  language: 'python' | 'typescript',
): string {
  const parsed = parseExperiment(experiment);
  if (!parsed) throw new Error('invalid_experiment');
  const serialized = JSON.stringify(JSON.stringify(parsed));
  if (language === 'python')
    return (
      '# Offline synthetic experiment replay. No API, credentials or inference.\n' +
      '# python3 experiment.py\nimport json\nexperiment = json.loads(' +
      serialized +
      ')\n' +
      'print(json.dumps(experiment, ensure_ascii=False))\n'
    );
  return (
    '// Offline synthetic experiment replay. No API, credentials or inference.\n' +
    '// node --experimental-strip-types experiment.ts (Node 22.6+)\n' +
    'const experiment = JSON.parse(' +
    serialized +
    ');\nconsole.log(JSON.stringify(experiment));\n'
  );
}
