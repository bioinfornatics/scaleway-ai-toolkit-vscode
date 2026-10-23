/** Single executable matrix. API routes use endpoint transport; SDK orchestration is separate. */
import type { Language } from './stackScaffold';
export const SERVICE_CAPABILITIES = Object.freeze([
  Object.freeze({
    language: 'python',
    framework: 'fastapi',
    adapter: 'fastapi',
  }),
  Object.freeze({
    language: 'python',
    framework: 'litestar',
    adapter: 'litestar',
  }),
  Object.freeze({
    language: 'typescript',
    framework: 'elysia',
    adapter: 'elysia',
  }),
] as const);
export function apiCapability(
  language: string | undefined,
  framework: string | undefined,
) {
  return SERVICE_CAPABILITIES.find(
    (c) => c.language === language && c.framework === framework,
  );
}
export const INTEGRATED_SERVICE = Object.freeze({
  frontend: 'nextjs',
  language: 'typescript',
} as const);
export const CLI_LANGUAGES = Object.freeze([
  'python',
  'typescript',
  'rust',
] as const);
export function supportsIntegrated(
  frontend: string | undefined,
  language: string | undefined,
): boolean {
  return (
    frontend === INTEGRATED_SERVICE.frontend &&
    language === INTEGRATED_SERVICE.language
  );
}
export function supportsCli(language: string): language is Language {
  return CLI_LANGUAGES.some((candidate) => candidate === language);
}
