import { loadEmbeddedTemplates } from './embeddedTemplates';
import type { TemplateDefinition, TemplateKind } from './templateLibrary';
export type Language = 'python' | 'typescript' | 'rust';
export interface StackChoice {
  language: Language;
  framework: string;
  label: string;
  category: 'agent' | 'backend' | 'basic';
  description: string;
  template: TemplateDefinition;
}
/** Fresh validated files from assets next to the installed dist directory. */
export function stackChoices(kind: TemplateKind): StackChoice[] {
  return loadEmbeddedTemplates(kind, 'stack').map((entry) => ({
    language: entry.language,
    framework: entry.framework,
    label: entry.template.label.split(' · ')[0],
    category: entry.category,
    description: entry.template.description,
    template: entry.template,
  }));
}
