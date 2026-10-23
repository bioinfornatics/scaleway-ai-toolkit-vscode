import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import * as https from 'node:https';
import { createAdvancedClient, withHTTPClient } from '@scaleway/sdk-client';
import { Inferencev1 } from '@scaleway/sdk-inference';
import * as vscode from 'vscode';
import {
  corroboratedPublicPrice,
  type DedicatedPriceObservation,
} from './dedicatedPrices';
import { deploymentOptions } from './deployment';
import type { ModelEula } from './modelEula';
import {
  type ListedModel,
  type NodeType,
  type Project,
  parseDeployment,
  ReadError,
  text,
  uuid,
} from './provider';

/** Exact SDK wire body, also usable by the host's write-ahead journal. No credentials. */
export interface CreateDeploymentBody {
  readonly accept_eula: boolean;
  readonly endpoints: readonly [
    {
      readonly disable_auth: false;
      readonly public_network: Readonly<Record<string, never>>;
    },
  ];
  readonly max_size: 1;
  readonly min_size: 1;
  readonly model_id: string;
  readonly name: string;
  readonly node_type_name: string;
  readonly project_id: string;
  readonly quantization: { readonly bits: number };
  readonly tags: readonly [];
}
export interface ConfirmedService {
  readonly body: CreateDeploymentBody;
  readonly project: Readonly<Project>;
  readonly model: Readonly<{ id: string; name: string }>;
}
const approvalLifetime = 5 * 60 * 1000;
const approvals = new WeakMap<
  ConfirmedService,
  {
    serialized: string;
    receiptSnapshot: string;
    issuedAt: number;
    fresh: () => boolean;
  }
>();
const path = '/inference/v1/regions/fr-par/deployments';
const origin = 'https://api.scaleway.com';
function recent(timestamp: string): boolean {
  const age = Date.now() - Date.parse(timestamp);
  return Number.isFinite(age) && age >= 0 && age <= approvalLifetime;
}
function safeName(label: string): string {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 63)
      .replace(/-+$/, '') || 'model-service'
  );
}
function validName(name: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(name);
}

/** Compact native review: compatible configuration, name, optional separate license, cost confirmation. */
export async function reviewService(
  project: Project,
  model: ListedModel,
  nodes: NodeType[],
  prices: DedicatedPriceObservation[],
  eula: ModelEula | undefined,
  current: () => boolean,
): Promise<ConfirmedService | undefined> {
  if (!current()) return;
  if (
    !uuid(project.id) ||
    !uuid(project.organizationId) ||
    !text(project.name) ||
    !text(model.label)
  )
    throw new ReadError('invalid_scope');
  const snapshot = JSON.stringify({ project, model, nodes, prices, eula });
  const fresh = () =>
    current() &&
    snapshot === JSON.stringify({ project, model, nodes, prices, eula });
  const options = deploymentOptions(model, nodes);
  if (!options.length || typeof model.dedicatedInfo?.hasEula !== 'boolean') {
    await vscode.window.showWarningMessage(
      'Déploiement bloqué : configuration compatible disponible et statut de licence explicite requis. Aucune création.',
    );
    return;
  }
  const hasEula = model.dedicatedInfo.hasEula;
  if (
    hasEula &&
    (!eula ||
      eula.modelId !== model.id ||
      eula.projectId !== project.id ||
      eula.organizationId !== project.organizationId ||
      eula.region !== 'fr-par' ||
      eula.accepted !== false ||
      !recent(eula.fetchedAt) ||
      typeof eula.content !== 'string' ||
      !eula.content.trim() ||
      Buffer.byteLength(eula.content, 'utf8') > 262144 ||
      Array.from(eula.content).some((c) => {
        const n = c.charCodeAt(0);
        return (n < 32 && n !== 9 && n !== 10 && n !== 13) || n === 127;
      }) ||
      createHash('sha256').update(eula.content, 'utf8').digest('hex') !==
        eula.sha256)
  )
    throw new ReadError('invalid_eula_response');
  const choices = options.map((option) => {
    const observations = prices.filter(
      (price) => price.nodeTypeName === option.nodeTypeName,
    );
    const price =
      observations.length === 1 && recent(observations[0].fetchedAt)
        ? corroboratedPublicPrice(observations[0])
        : undefined;
    return {
      label: option.nodeTypeName,
      description: `${option.quantizationBits} bits · contexte ${option.maxContextSize}`,
      detail: price
        ? price.minuteEUR +
          ' EUR/min/node · équivalent ' +
          price.hourlyEquivalentEUR +
          ' EUR/h HT · prix PUBLIC, prix compte inconnu'
        : 'Bloqué : prix public ou période non corroborés',
      option,
      price,
    };
  });
  const picked = await vscode.window.showQuickPick(choices, {
    title: `Déployer ${model.label}`,
    placeHolder: '1 nœud compatible · fr-par · endpoint public protégé par IAM',
    matchOnDetail: true,
  });
  if (!picked || !fresh()) return;
  if (!choices.includes(picked) || !picked.price) {
    await vscode.window.showWarningMessage(
      'Déploiement bloqué : période et tarif public exact non corroborés. Aucune création.',
    );
    return;
  }
  const name = await vscode.window.showInputBox({
    title: 'Nom du service dédié',
    value: safeName(model.label),
    prompt: '1–63 caractères : lettres minuscules, chiffres et tirets.',
    validateInput: (value) =>
      validName(value)
        ? undefined
        : 'Nom requis : 1–63 caractères, lettres minuscules, chiffres et tirets, sans tiret aux extrémités.',
  });
  if (!name || !fresh()) return;
  if (!validName(name)) throw new ReadError('invalid_request');
  let accepted = false;
  if (hasEula && eula) {
    const document = await vscode.workspace.openTextDocument({
      language: 'plaintext',
      content: eula.content,
    });
    if (!fresh() || !recent(eula.fetchedAt)) return;
    await vscode.window.showTextDocument(document, { preview: false });
    if (!fresh()) return;
    const choice = await vscode.window.showInformationMessage(
      'Licence de ' +
        model.label +
        ' : lisez le document texte ouvert. Acceptez-vous explicitement ces conditions ? Cette acceptation ne déploie pas le service.',
      { modal: true, detail: `SHA-256 : ${eula.sha256}` },
      'Accepter la licence',
    );
    if (choice !== 'Accepter la licence' || !fresh() || !recent(eula.fetchedAt))
      return;
    accepted = true;
  }
  const confirmation = await vscode.window.showInformationMessage(
    `Déployer le service facturé « ${name} » ?`,
    {
      modal: true,
      detail: [
        `Modèle : ${model.label} (${model.id})`,
        `Projet : ${project.name} (${project.id}) · fr-par`,
        '1 nœud ' +
          picked.option.nodeTypeName +
          ' · ' +
          picked.option.quantizationBits +
          ' bits · min/max = 1',
        'Endpoint public protégé par IAM (authentification activée).',
        'Prix PUBLIC : ' +
          picked.price.minuteEUR +
          ' EUR/min/node · équivalent ' +
          picked.price.hourlyEquivalentEUR +
          ' EUR/h HT.',
        'Source publique épinglée : ' +
          picked.price.pricingURL +
          ' (observation ' +
          picked.price.observedOn +
          ').',
        'Prix effectif du compte inconnu ; frais additionnels possibles. Facturation à la durée, même sans trafic.',
        'Aucun plafond de dépense ni arrêt automatique. Le service continue jusqu’à suppression explicite.',
        'Quotas, droits IAM et allocation non vérifiés : la création reste soumise à acceptation ou rejet par Scaleway.',
        hasEula
          ? 'Licence explicitement acceptée séparément.'
          : 'Aucune EULA requise selon le catalogue.',
      ].join('\n'),
    },
    'Déployer',
  );
  if (
    confirmation !== 'Déployer' ||
    !fresh() ||
    (hasEula && eula && !recent(eula.fetchedAt))
  )
    return;
  const body: CreateDeploymentBody = Object.freeze({
    accept_eula: accepted,
    endpoints: Object.freeze([
      Object.freeze({
        disable_auth: false as const,
        public_network: Object.freeze({}),
      }),
    ]) as CreateDeploymentBody['endpoints'],
    max_size: 1,
    min_size: 1,
    model_id: model.id,
    name,
    node_type_name: picked.option.nodeTypeName,
    project_id: project.id,
    quantization: Object.freeze({ bits: picked.option.quantizationBits }),
    tags: Object.freeze([]) as readonly [],
  });
  const receipt: ConfirmedService = Object.freeze({
    body,
    project: Object.freeze({
      id: project.id,
      name: project.name,
      organizationId: project.organizationId,
    }),
    model: Object.freeze({ id: model.id, name: model.label }),
  });
  approvals.set(receipt, {
    serialized: JSON.stringify(body),
    receiptSnapshot: JSON.stringify(receipt),
    issuedAt: Date.now(),
    fresh: () =>
      fresh() &&
      (!hasEula || (!!eula && recent(eula.fetchedAt))) &&
      prices.some(
        (price) =>
          price.nodeTypeName === body.node_type_name && recent(price.fetchedAt),
      ),
  });
  return receipt;
}

/** Private one-request, fixed-origin transport. No retry, redirect or response-body diagnostics. */
function send(
  body: string,
  secret: string,
  signal: AbortSignal,
): Promise<unknown> {
  if (signal.aborted) return Promise.reject(new ReadError('cancelled'));
  return new Promise((resolve, reject) => {
    let done = false;
    let bytes = 0;
    const chunks: Buffer[] = [];
    let req: ReturnType<typeof https.request> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const end = (error?: ReadError, raw?: unknown) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      req?.destroy();
      if (error) reject(error);
      else resolve(raw);
    };
    const unknown = () => end(new ReadError('creation_outcome_unknown'));
    const cancel = unknown;
    timer = setTimeout(unknown, 10000);
    signal.addEventListener('abort', cancel, { once: true });
    try {
      req = https.request(
        {
          hostname: 'api.scaleway.com',
          path,
          method: 'POST',
          agent: false,
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'X-Auth-Token': secret,
          },
        },
        (res) => {
          const status = res.statusCode ?? 0;
          if (status < 200 || status >= 300) {
            res.destroy();
            return end(
              new ReadError(
                status === 401 || status === 403
                  ? 'access_denied'
                  : status === 400 || status === 422
                    ? 'creation_rejected'
                    : status === 429
                      ? 'rate_limited'
                      : 'creation_outcome_unknown',
              ),
            );
          }
          if (
            !/^application\/json(?:\s*;|$)/i.test(
              res.headers['content-type'] ?? '',
            )
          ) {
            res.destroy();
            return unknown();
          }
          res.on('data', (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > 2 * 1024 * 1024) {
              res.destroy();
              unknown();
            } else chunks.push(chunk);
          });
          res.on('error', unknown);
          res.on('aborted', unknown);
          res.on('close', () => {
            if (!done) unknown();
          });
          res.on('end', () => {
            try {
              end(
                undefined,
                JSON.parse(
                  new TextDecoder('utf-8', { fatal: true }).decode(
                    Buffer.concat(chunks),
                  ),
                ),
              );
            } catch {
              unknown();
            }
          });
        },
      );
      req.on('error', unknown);
      if (signal.aborted) return cancel();
      req.end(body);
    } catch {
      unknown();
    }
  });
}

/** Consume a native approval once; the SDK supplies the exact POST contract, never defaults as validation. */
export async function createService(
  receipt: ConfirmedService,
  secret: string,
  signal: AbortSignal,
): Promise<ListedModel> {
  const approval = approvals.get(receipt);
  approvals.delete(receipt);
  if (
    !approval?.fresh() ||
    Date.now() < approval.issuedAt ||
    Date.now() - approval.issuedAt > approvalLifetime ||
    JSON.stringify(receipt) !== approval.receiptSnapshot ||
    JSON.stringify(receipt.body) !== approval.serialized
  )
    throw new ReadError('invalid_approval');
  if (!uuid(secret)) throw new ReadError('invalid_request');
  if (signal.aborted) throw new ReadError('cancelled');
  let attempted = false;
  let captured = false;
  let raw: unknown;
  let transportError: ReadError | undefined;
  const http: typeof fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    if (
      attempted ||
      request.method !== 'POST' ||
      request.url !== origin + path ||
      (await request.text()) !== approval.serialized
    )
      throw new ReadError('invalid_request');
    if (!approval.fresh()) throw new ReadError('invalid_approval');
    attempted = true;
    try {
      raw = await send(approval.serialized, secret, signal);
      captured = true;
      return new Response(JSON.stringify(raw), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      transportError =
        error instanceof ReadError
          ? error
          : new ReadError('creation_outcome_unknown');
      throw transportError;
    }
  };
  const body = receipt.body;
  try {
    await new Inferencev1.API(
      createAdvancedClient(withHTTPClient(http)),
    ).createDeployment(
      {
        region: 'fr-par',
        projectId: body.project_id,
        modelId: body.model_id,
        name: body.name,
        nodeTypeName: body.node_type_name,
        minSize: 1,
        maxSize: 1,
        quantization: { bits: body.quantization.bits },
        endpoints: [{ publicNetwork: {}, disableAuth: false }],
        tags: [],
        acceptEula: body.accept_eula,
      },
      { signal },
    );
  } catch {
    if (transportError) throw transportError;
    if (!captured)
      throw new ReadError(
        attempted ? 'creation_outcome_unknown' : 'invalid_request',
      );
    // A generated unmarshaller failure cannot discard a valid strictly parsed raw receipt.
  }
  try {
    if (!captured) throw new Error();
    const resource = parseDeployment(raw, receipt.project);
    if (
      resource.label !== body.name ||
      (resource.deploymentInfo?.modelId !== undefined &&
        resource.deploymentInfo.modelId !== body.model_id) ||
      (resource.deploymentInfo?.nodeTypeName !== undefined &&
        resource.deploymentInfo.nodeTypeName !== body.node_type_name) ||
      resource.deploymentInfo?.endpoints?.some(
        (endpoint) =>
          endpoint.authentication !== 'iam' || endpoint.network !== 'public',
      )
    )
      throw new Error();
    return resource;
  } catch {
    throw new ReadError('creation_outcome_unknown');
  }
}
