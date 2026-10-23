import * as vscode from 'vscode';
import type { Bearer } from './llmAccessIam';

export type AccessPlan =
  | { type: 'reuse' }
  | { type: 'import'; accessKey: string; secretKey: string }
  | { type: 'create'; bearer: Bearer; description: string; lifetimeMs: number };

type AccessContext = {
  modelId?: string;
  selectedAccessKey?: string;
  userId: string;
  projectName: string;
  current(): boolean;
  applications(): Promise<{ id: string; name: string }[]>;
};

const controls = {
  test: (value: string): boolean =>
    Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || (code >= 127 && code <= 159);
    }),
};
const uuid = (value: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const accessKeyValid = (value: string): boolean =>
  /^SCW[A-Z0-9]{17}$/.test(value);
const descriptionValid = (value: string): boolean =>
  value.length <= 200 && !controls.test(value);
const display = (value: string, max = 200): string =>
  Array.from(value)
    .filter((character) => !controls.test(character))
    .join('')
    .slice(0, max);

/** UI only: the parent rechecks current scope, API metadata (including application
 * bearers) and model access before persisting or using reuse/import credentials.
 * Only the parent lists applications, creates keys or writes SecretStorage.
 */
export async function chooseAccessPlan(
  context: AccessContext,
): Promise<AccessPlan | undefined> {
  const { modelId, userId, projectName, current, applications } = context;
  const selectedAccessKey = context.selectedAccessKey;
  if (!current()) return undefined;
  try {
    const sources = [
      { label: 'Réutiliser la clé de connexion', type: 'reuse' as const },
      { label: 'Importer une clé existante', type: 'import' as const },
      { label: 'Générer une clé API', type: 'create' as const },
    ];
    const source = selectedAccessKey
      ? sources[1]
      : await vscode.window.showQuickPick(sources, {
          title: `Clé API · ${display(modelId ?? projectName)}`,
          placeHolder:
            'Choisir une source de clé (validation API par le parent)',
          ignoreFocusOut: true,
        });
    if (!current() || !source || !sources.includes(source)) return undefined;
    if (source.type === 'reuse') return { type: 'reuse' };
    if (source.type === 'import') {
      const accessKey =
        selectedAccessKey ??
        (await vscode.window.showInputBox({
          title: 'Importer · Access key',
          prompt:
            'Clé utilisateur ou application IAM : SCW suivi de 17 caractères A–Z / 0–9.',
          password: true,
          ignoreFocusOut: true,
          validateInput: (value) =>
            accessKeyValid(value) ? undefined : 'Format de clé invalide.',
        }));
      if (!current() || accessKey === undefined || !accessKeyValid(accessKey))
        return undefined;
      const secretKey = await vscode.window.showInputBox({
        title: 'Importer · Secret key',
        prompt:
          'Secret UUID ; jamais affiché ni journalisé. Validation API avant enregistrement.',
        password: true,
        ignoreFocusOut: true,
        validateInput: (value) =>
          uuid(value) ? undefined : 'Format UUID requis.',
      });
      if (!current() || secretKey === undefined || !uuid(secretKey))
        return undefined;
      return { type: 'import', accessKey, secretKey };
    }

    const bearers = [
      { label: 'Moi-même IAM', type: 'user' as const },
      { label: 'Une application IAM existante', type: 'application' as const },
    ];
    const bearerPick = await vscode.window.showQuickPick(bearers, {
      title: 'Titulaire de la clé API',
      ignoreFocusOut: true,
    });
    if (!current() || !bearerPick || !bearers.includes(bearerPick))
      return undefined;
    let bearer: Bearer;
    let bearerLabel: string;
    if (bearerPick.type === 'user') {
      if (!uuid(userId)) return undefined;
      bearer = { type: 'user', id: userId };
      bearerLabel = `Moi-même IAM (${userId})`;
    } else {
      // The parent owns pagination, request limits and organization membership.
      const available = await applications();
      if (!current()) return undefined;
      if (
        !Array.isArray(available) ||
        !available.length ||
        available.some(
          (item) =>
            !item ||
            !uuid(item.id) ||
            typeof item.name !== 'string' ||
            !item.name.trim() ||
            item.name.length > 200 ||
            controls.test(item.name),
        )
      )
        return undefined;
      const items = available.map((item) => ({
        label: item.name,
        description: item.id,
        id: item.id,
      }));
      const application = await vscode.window.showQuickPick(items, {
        title: 'Application IAM existante',
        placeHolder: 'Aucune application ni politique IAM ne sera créée',
        ignoreFocusOut: true,
      });
      if (!current() || !application || !items.includes(application))
        return undefined;
      bearer = { type: 'application', id: application.id };
      bearerLabel = `Application IAM : ${application.label} (${application.id})`;
    }
    const defaultDescription = display(
      modelId ? `Accès LLM ${modelId}` : 'Accès LLM',
    );
    const entered = await vscode.window.showInputBox({
      title: 'Description de la clé API (facultative)',
      value: defaultDescription,
      prompt: '200 caractères maximum, sans caractères de contrôle.',
      ignoreFocusOut: true,
      validateInput: (value) =>
        descriptionValid(value)
          ? undefined
          : '200 caractères maximum, sans caractères de contrôle.',
    });
    if (!current() || entered === undefined || !descriptionValid(entered))
      return undefined;
    const description = entered.trim() ? entered : defaultDescription;
    const lifetimes = [
      { label: '1 heure', lifetimeMs: 3600000 },
      { label: '7 jours', lifetimeMs: 7 * 86400000 },
      { label: '30 jours', lifetimeMs: 30 * 86400000 },
      { label: '1 an', lifetimeMs: 365 * 86400000 },
    ];
    const expiry = await vscode.window.showQuickPick(lifetimes, {
      title: 'Expiration de la clé API',
      placeHolder: 'Expiration obligatoire ; aucune durée illimitée',
      ignoreFocusOut: true,
    });
    if (!current() || !expiry || !lifetimes.includes(expiry)) return undefined;
    const consent = await vscode.window.showWarningMessage(
      'Générer la clé API',
      {
        modal: true,
        detail: [
          `Projet : ${display(projectName)}`,
          ...(modelId ? [`Modèle : ${display(modelId)}`] : []),
          `Titulaire : ${bearerLabel}`,
          `Expiration : ${expiry.label} après création.`,
          'Les permissions sont héritées des politiques IAM de l’organisation du titulaire ; elles ne sont pas limitées à ce modèle ni à un modèle particulier.',
          'Le secret sera conservé dans VS Code SecretStorage par le parent, sans affichage ni journalisation.',
          'Aucune inférence ne sera exécutée. Aucune application ni politique IAM ne sera créée.',
          'La déconnexion locale ne révoque pas cette clé API.',
        ].join('\n'),
      },
      'Générer la clé API',
    );
    if (!current() || consent !== 'Générer la clé API') return undefined;
    return {
      type: 'create',
      bearer,
      description,
      lifetimeMs: expiry.lifetimeMs,
    };
  } catch {
    // Native cancellation/provider failures must not leak errors or credentials.
    current();
    return undefined;
  }
}
