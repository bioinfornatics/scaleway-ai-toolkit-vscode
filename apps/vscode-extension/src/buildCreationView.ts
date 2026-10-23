import type { Language, StackChoice } from './stackScaffold';
import type {
  TemplateDefinition,
  TemplateEntry,
  TemplateKind,
} from './templateLibrary';

interface ViewRow {
  index: string;
  template: TemplateDefinition;
  entry?: TemplateEntry;
  stack?: StackChoice;
}
interface BuildView {
  agentForm?: boolean;
  agentName?: string;
  focus?: string;
  creationTab?: 'stack' | 'template';
  destination?: string;
  destinationBase?: string;
  pathEdited?: boolean;
  backend?: string;
  ai?: string;
  models?: { index: string; label: string }[];
  modelIndex?: string;
  keys?: { index: string; label: string }[];
  keyIndex?: string;
  serviceKind?: 'serverless' | 'dedicated';
  modelStatus?: string;
  title: string;
  kind: TemplateKind;
  templateMode: boolean;
  language: Language;
  languages: Map<string, Language>;
  rows: ViewRow[];
  selected?: string;
  trusted: boolean;
  status: string;
  draft: boolean;
  token: string;
  css: string;
  js: string;
  csp: string;
}
function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ] ?? c,
  );
}
const names = { python: 'Python', typescript: 'TypeScript', rust: 'Rust' };
export function buildCreationView(v: BuildView): string {
  const button = (action: string, label: string, index?: string) =>
    '<button type="button" data-action="' +
    action +
    '"' +
    (index ? ` data-index="${index}"` : '') +
    '>' +
    escapeHtml(label) +
    '</button>';
  const tabs = v.creationTab !== undefined;
  const activeTab = v.creationTab ?? 'stack';
  const tabHeader = tabs
    ? '<section class="creation-choice" aria-label="Point de départ de l’agent"><div class="creation-tabs" role="tablist" aria-label="Point de départ">' +
      (['stack', 'template'] as const)
        .map(
          (tab) =>
            '<button type="button" role="tab" id="choice-' +
            tab +
            '" aria-controls="panel-' +
            tab +
            '" aria-selected="' +
            (activeTab === tab) +
            '" tabindex="' +
            (activeTab === tab ? '0' : '-1') +
            '" data-action="' +
            (tab === 'stack' ? 'chooseStack' : 'chooseTemplate') +
            '"' +
            (!v.trusted ? ' disabled' : '') +
            '>' +
            (tab === 'stack' ? 'Choisir une pile' : 'Choisir un template') +
            '</button>',
        )
        .join('') +
      '</div>'
    : '';
  const row = v.trusted
    ? v.rows.find((r) => r.index === v.selected)
    : undefined;
  const noun = v.kind === 'agents' ? 'agent' : 'outil';
  const paths =
    '<code>.scaleway-ai/templates/' +
    v.kind +
    '/</code> et <code>~/.scaleway-ai/templates/' +
    v.kind +
    '/</code>';
  const languageOptions = [...v.languages]
    .map(
      ([index, language]) =>
        '<option value="' +
        index +
        '"' +
        (v.language === language ? ' selected' : '') +
        '>' +
        names[language] +
        '</option>',
    )
    .join('');
  const frameworks = (
    v.trusted ? v.rows.filter((r) => r.stack?.language === v.language) : []
  )
    .map(
      (r) =>
        '<option value="' +
        r.index +
        '"' +
        (v.selected === r.index ? ' selected' : '') +
        '>' +
        escapeHtml(r.stack?.label ?? '') +
        ' · ' +
        (r.stack?.category === 'agent'
          ? 'SDK agent'
          : r.stack?.category === 'backend'
            ? 'Backend'
            : 'Base langage') +
        '</option>',
    )
    .join('');
  const cards = (v.trusted ? v.rows.filter((r) => !r.stack) : [])
    .map(
      (r) =>
        '<article class="template-card"><h3>' +
        escapeHtml(r.template.label) +
        '</h3><p>' +
        escapeHtml(r.template.description) +
        '</p><p class="origin">' +
        (r.entry
          ? r.entry.origin === 'project'
            ? 'Projet'
            : 'Utilisateur'
          : 'Prédéfini') +
        '</p>' +
        button('preview', 'Choisir ce template', r.index).replace(
          ' data-index=',
          v.selected === r.index
            ? ' aria-pressed="true" data-selected-template="true" data-index='
            : ' aria-pressed="false" data-index=',
        ) +
        (r.entry ? button('edit', 'Modifier', r.index) : '') +
        '</article>',
    )
    .join('');
  const selection =
    row && !(v.agentForm && row.stack)
      ? '<p class="selection">' +
        escapeHtml(
          row.stack
            ? v.agentForm
              ? [
                  v.rows.find((r) => r.index === v.backend)?.stack?.label,
                  v.rows.find((r) => r.index === v.ai)?.stack?.label,
                  names[row.stack.language],
                ]
                  .filter(Boolean)
                  .join(' · ')
              : `${row.stack.label} · ${names[row.stack.language]}`
            : `Template · ${row.template.label}`,
        ) +
        '</p><p class="scope-note">' +
        escapeHtml(
          row.stack?.description ??
            'Les fichiers du template seront copiés tels quels, sans conversion de langage.',
        ) +
        '</p>'
      : '';
  const validAgentName =
    /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(v.agentName ?? '') &&
    !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(v.agentName ?? '');
  const dedicated = v.serviceKind === 'dedicated';
  const modelLabel = v.templateMode
    ? 'Modèle (facultatif)'
    : dedicated
      ? 'Déploiement dédié'
      : 'Modèle Serverless';
  const modelPlaceholder = v.templateMode
    ? 'Sélectionner un modèle'
    : dedicated
      ? 'Sélectionner un déploiement dédié'
      : 'Sélectionner un modèle Serverless';
  const modelEmpty = v.templateMode
    ? 'Aucun modèle chargé'
    : dedicated
      ? 'Aucun déploiement dédié chargé'
      : 'Aucun modèle Serverless chargé';
  const serviceToggle =
    v.agentForm && !v.templateMode
      ? '<div class="service-mode" role="group" aria-label="Type de service">' +
        (['serverless', 'dedicated'] as const)
          .map(
            (kind) =>
              '<button type="button" data-action="' +
              kind +
              '" aria-pressed="' +
              ((v.serviceKind ?? 'serverless') === kind) +
              '"' +
              (!v.trusted ? ' disabled' : '') +
              '>' +
              (kind === 'serverless' ? 'Serverless' : 'Dédié') +
              '</button>',
          )
          .join('') +
        '</div>'
      : '';
  const ready =
    !!row &&
    (!v.agentForm ||
      v.templateMode ||
      (!!v.modelIndex &&
        !!v.destination &&
        (v.keys === undefined || !!v.keyIndex)));
  const create = row
    ? '<button type="button" data-action="create" data-index="' +
      row.index +
      '"' +
      (v.agentForm
        ? ` data-agent-create="true" data-ready="${ready}" data-key-ready="${v.keys === undefined || !!v.keyIndex}" data-destination-ready="${v.templateMode || !!v.destination}"`
        : '') +
      (!ready || (v.agentForm && !validAgentName) ? ' disabled' : '') +
      '>' +
      (v.templateMode ? 'Créer le template' : `Créer un ${noun}`) +
      '</button>'
    : `<button type="button" disabled>${v.templateMode ? 'Créer le template' : `Créer un ${noun}`}</button>`;
  const preview = row
    ? '<details class="file-preview"><summary>Voir les fichiers à créer (' +
      Object.keys(row.template.files).length +
      ')</summary>' +
      Object.entries(row.template.files)
        .map(
          ([name, content]) =>
            '<details><summary>' +
            escapeHtml(name) +
            '</summary><pre>' +
            escapeHtml(content) +
            '</pre></details>',
        )
        .join('') +
      '</details>'
    : '';
  return (
    '<!doctype html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; img-src &#39;none&#39;; connect-src &#39;none&#39;; style-src ' +
    escapeHtml(v.csp) +
    ' &#39;nonce-' +
    v.token +
    '&#39;; script-src &#39;nonce-' +
    v.token +
    '&#39;;"><link rel="stylesheet" href="' +
    v.css +
    '"><style nonce="' +
    v.token +
    '">.service-mode{display:inline-flex;margin-top:24px}.service-mode button{margin:0;border-radius:0;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}.service-mode button:first-child{border-radius:4px 0 0 4px}.service-mode button:last-child{border-radius:0 4px 4px 0}.service-mode button[aria-pressed="true"]{background:var(--vscode-button-background);color:var(--vscode-button-foreground);font-weight:700}.service-mode button:focus-visible{position:relative;z-index:1}</style><title>' +
    escapeHtml(v.title) +
    '</title></head><body data-token="' +
    v.token +
    '" data-focus-action="' +
    escapeHtml(v.focus ?? '') +
    '"><main class="build-page"><header><div><h1>' +
    escapeHtml(v.title) +
    '</h1><p>Choisissez votre pile ou commencez depuis un template.</p></div></header>' +
    (v.templateMode
      ? '<p class="template-notice">Vous créez un template, pas un projet local. Destination : ' +
        paths +
        ', au choix lors de la confirmation.</p>'
      : '') +
    (!v.trusted
      ? '<p role="status">Workspace Trust requis (hôte Linux).</p>'
      : '') +
    (v.status ? `<p role="status">${escapeHtml(v.status)}</p>` : '') +
    tabHeader +
    (tabs
      ? '<div id="panel-stack" role="tabpanel" aria-labelledby="choice-stack"' +
        (activeTab !== 'stack' ? ' hidden' : '') +
        '>'
      : '<section aria-labelledby="stack-heading"><h2 id="stack-heading">Choisir une pile</h2>') +
    '<div class="stack-fields"><label>Langage de programmation<select data-action="language"' +
    (!v.trusted ? ' disabled' : '') +
    '>' +
    languageOptions +
    '</select></label>' +
    (v.agentForm
      ? '<label>Backend<select data-action="backend"' +
        (!v.trusted ? ' disabled' : '') +
        '><option value="">Sélectionner un backend</option>' +
        v.rows
          .filter(
            (r) =>
              v.trusted &&
              r.stack?.language === v.language &&
              ['backend', 'basic'].includes(r.stack.category),
          )
          .map(
            (r) =>
              '<option value="' +
              r.index +
              '"' +
              (v.backend === r.index ? ' selected' : '') +
              '>' +
              escapeHtml(r.stack?.label ?? '') +
              '</option>',
          )
          .join('') +
        '</select></label><label>Framework IA<select data-action="ai"' +
        (!v.trusted ? ' disabled' : '') +
        '><option value="">Sélectionner un framework IA</option>' +
        v.rows
          .filter(
            (r) =>
              v.trusted &&
              r.stack?.language === v.language &&
              ['agent', 'basic'].includes(r.stack.category),
          )
          .map(
            (r) =>
              '<option value="' +
              r.index +
              '"' +
              (v.ai === r.index ? ' selected' : '') +
              '>' +
              escapeHtml(
                r.stack?.category === 'basic'
                  ? 'Sans framework IA'
                  : (r.stack?.label ?? ''),
              ) +
              '</option>',
          )
          .join('') +
        '</select></label>'
      : '<label>Framework<select data-action="stack"' +
        (!v.trusted ? ' disabled' : '') +
        '><option value="">Sélectionner un framework</option>' +
        frameworks +
        '</select></label>') +
    '</div>' +
    (tabs
      ? (activeTab === 'stack' ? selection : '') +
        '</div><div id="panel-template" role="tabpanel" aria-labelledby="choice-template"' +
        (activeTab !== 'template' ? ' hidden' : '') +
        '><div class="template-grid">' +
        cards +
        '</div>' +
        (activeTab === 'template' ? selection : '') +
        '</div></section><section class="agent-common" aria-label="Configuration de l’agent">'
      : '') +
    serviceToggle +
    (v.agentForm
      ? '<div class="stack-fields agent-fields"><label>Nom de l’agent<input data-action="name" type="text" maxlength="64" pattern="[A-Za-z0-9][A-Za-z0-9_-]{0,63}" value="' +
        escapeHtml(v.agentName ?? '') +
        '"' +
        (!v.trusted ? ' disabled' : '') +
        ' placeholder="mon-agent"></label><label>' +
        modelLabel +
        '<select data-action="model" data-placeholder="' +
        modelPlaceholder +
        '" data-empty="' +
        modelEmpty +
        '"' +
        (!v.trusted ? ' disabled' : '') +
        '><option value="">' +
        (v.models?.length ? modelPlaceholder : modelEmpty) +
        '</option>' +
        (v.models ?? [])
          .map(
            (m) =>
              '<option value="' +
              m.index +
              '"' +
              (v.modelIndex === m.index ? ' selected' : '') +
              '>' +
              escapeHtml(m.label) +
              '</option>',
          )
          .join('') +
        '</select></label>' +
        (!v.templateMode && v.keys !== undefined
          ? '<label>Clé API<select data-action="key"' +
            (!v.trusted ? ' disabled' : '') +
            '><option value="">' +
            (v.keys.length
              ? 'Sélectionner une clé API locale'
              : 'Aucune clé locale valide') +
            '</option>' +
            v.keys
              .map(
                (key) =>
                  '<option value="' +
                  key.index +
                  '"' +
                  (key.index === v.keyIndex ? ' selected' : '') +
                  '>' +
                  escapeHtml(key.label) +
                  '</option>',
              )
              .join('') +
            '</select></label>'
          : '') +
        '</div>' +
        (!v.templateMode && v.keys !== undefined
          ? button('addKey', 'Ajouter / importer une clé API…')
          : '') +
        '<p class="scope-note">' +
        escapeHtml(v.modelStatus ?? '') +
        '</p>' +
        (v.templateMode
          ? '<p class="scope-note">Le modèle est facultatif pour un template réutilisable.</p>'
          : '')
      : '') +
    (v.language === 'rust' &&
    v.kind === 'agents' &&
    (!tabs || activeTab === 'stack')
      ? '<p class="scope-note">Rust : choisissez un backend ; aucun SDK IA intégré n’est proposé.</p>'
      : '') +
    '</section>' +
    (tabs
      ? ''
      : '<section aria-labelledby="templates-heading"><h2 id="templates-heading">Ou partir d’un template</h2><div class="template-grid">' +
        cards +
        '</div></section>' +
        selection) +
    (v.agentForm && !v.templateMode
      ? '<div class="destination-field"><label for="project-path">Chemin du projet</label><div class="destination-controls"><input id="project-path" type="text" data-action="projectPath" maxlength="4096" aria-describedby="project-path-help" data-base="' +
        escapeHtml(v.destinationBase ?? '') +
        '" data-edited="' +
        String(!!v.pathEdited) +
        '" value="' +
        escapeHtml(v.destination ?? '') +
        '" placeholder="mon-agent ou /chemin/mon-agent"' +
        (!v.trusted ? ' disabled' : '') +
        '><button type="button" data-action="destination"' +
        (!v.trusted ? ' disabled' : '') +
        '>Choisir…</button></div><p id="project-path-help" class="scope-note">Chemin final. Une saisie relative utilise ' +
        escapeHtml(v.destinationBase ?? 'un dossier choisi') +
        '. Le nom de l’agent n’est pas ajouté à votre saisie.</p></div>'
      : '') +
    '<div class="creation-bar">' +
    create +
    (v.agentForm &&
    !v.templateMode &&
    row &&
    !row.entry &&
    ['python', 'typescript', 'rust'].includes(
      row.stack?.language ?? row.template.project?.language ?? v.language,
    )
      ? '<span>Environnement ' +
        {
          python: 'Python avec uv',
          typescript: 'TypeScript avec Bun',
          rust: 'Rust avec Cargo',
        }[row.stack?.language ?? row.template.project?.language ?? v.language] +
        ' préparé automatiquement · aucun appel modèle.</span></div>'
      : '<span>Génération locale uniquement · aucune installation ni exécution.</span></div>') +
    preview +
    '<details class="library-actions"><summary>Gérer les templates</summary>' +
    button('refresh', 'Actualiser') +
    (v.trusted
      ? button('new', 'Nouveau template · éditeur JSON natif') +
        button('import', 'Importer un template JSON') +
        (v.draft
          ? button('saveDraft', 'Enregistrer le brouillon dans la bibliothèque')
          : '')
      : '') +
    '</details></main><script nonce="' +
    v.token +
    '" src="' +
    v.js +
    '"></script></body></html>'
  );
}
