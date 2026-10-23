import {
  type DedicatedEndpointApproval,
  dedicatedInvocationPolicy,
} from './dedicatedInvocationPolicy';
import {
  InferenceError,
  type InferenceUsage,
  invokeDedicatedText,
  invokeText,
} from './inference';
import {
  exportRealExchange,
  reviewRealSnapshot,
  saveRealExchange,
} from './realExperimentActions';
import {
  parseRealExperiment,
  type RealExperiment,
  type RealFailure,
  sanitizeRealFailure,
} from './realExperiments';
export interface DedicatedPlaygroundConfig {
  approval: DedicatedEndpointApproval;
  invoke?: typeof invokeDedicatedText;
}

import {
  type ListedModel,
  type Project,
  serverlessInvocation,
  uuid,
} from './provider';
import { parseServiceInput } from './servicePlaygroundIpc';
export interface InferenceScope {
  project: Project;
  signal: AbortSignal;
  current(): boolean;
  authorize(): string;
  dispose(): void;
}
export interface ServiceState {
  type: 'state';
  runId: number;
  running: boolean;
  output: string;
  status: string;
  blocked: boolean;
  usage?: InferenceUsage;
  cost?: string;
  snapshotAvailable?: boolean;
  actionBusy?: boolean;
  actionStatus?: string;
}
/** Exact nanos, no zero default. Cached discounts require explicit knowledge. */
export function estimateCost(
  model: ListedModel,
  usage: InferenceUsage,
): string | undefined {
  if (model.kind !== 'serverless') return;
  const prices = model.serverlessPrices;
  if (!prices || (usage.cachedInputTokens ?? 0) > 0) return;
  const input = prices.filter(
    (p) =>
      p.unit === 'token' &&
      p.consumptionMode === 'realtime' &&
      p.tokenType === 'input_token',
  );
  const output = prices.filter(
    (p) =>
      p.unit === 'token' &&
      p.consumptionMode === 'realtime' &&
      p.tokenType === 'output_token',
  );
  if (input.length !== 1 || output.length !== 1) return;
  let nanos = 0n;
  for (const [p, count] of [
    [input[0], usage.inputTokens],
    [output[0], usage.outputTokens],
  ] as const) {
    if (
      !/^[0-9]+(?:[.][0-9]{1,9})?$/.test(p.amountEUR) ||
      !Number.isSafeInteger(p.size) ||
      p.size <= 0
    )
      return;
    const [whole, fraction = ''] = p.amountEUR.split('.');
    const numerator =
      (BigInt(whole) * 1000000000n + BigInt(fraction.padEnd(9, '0'))) *
      BigInt(count);
    nanos += (numerator + BigInt(p.size) - 1n) / BigInt(p.size);
  }
  return (
    (nanos / 1000000000n).toString() +
    '.' +
    (nanos % 1000000000n).toString().padStart(9, '0') +
    ' EUR estimés HT (tarif public, non facture)'
  );
}
export class ServicePlayground {
  private active: AbortController | undefined;
  private disposed = false;
  private invalid = false;
  private snapshot: RealExperiment | undefined;
  private lastRun:
    | {
        prompt: string;
        maxTokens: number;
        timestamp: string;
        billed: 'unknown' | 'possible';
      }
    | undefined;
  readonly state: ServiceState;
  constructor(
    private model: ListedModel,
    private scope: InferenceScope,
    private publish: (state: ServiceState) => void,
    private invoke: typeof invokeText = invokeText,
    private dedicated?: DedicatedPlaygroundConfig,
    private execution: { environment: 'live' | 'local-mock' } = {
      environment: 'live',
    },
  ) {
    this.model = structuredClone(model);
    this.scope = { ...scope, project: structuredClone(scope.project) };
    this.execution = { ...execution };
    if (dedicated)
      this.dedicated = {
        ...dedicated,
        approval: structuredClone(dedicated.approval),
      };
    const dedicatedAllowed = this.dedicatedAllowed();
    this.state = {
      type: 'state',
      runId: 0,
      running: false,
      output: '',
      status: dedicatedAllowed
        ? 'Prêt · endpoint dédié approuvé · facturation à la durée du déploiement, pas aux tokens'
        : serverlessInvocation(model)
          ? serverlessInvocation(model)?.capability === 'unknown'
            ? 'Prêt · compatibilité chat non renseignée · erreurs éventuelles à l’exécution · appel facturé'
            : 'Prêt · Exécuter envoie un appel facturé'
          : 'Chat texte non applicable à cette offre ou service dédié non pris en charge',
      blocked: !dedicatedAllowed && !serverlessInvocation(model),
    };
    scope.signal.addEventListener('abort', this.invalidate, { once: true });
    if (!scope.current()) this.invalidate();
  }
  private dedicatedAllowed(): boolean {
    return (
      !!this.dedicated &&
      dedicatedInvocationPolicy(
        this.model,
        this.scope.project,
        this.dedicated.approval,
      ).allowed
    );
  }
  private capture(status: RealExperiment['status'], failure?: RealFailure) {
    const run = this.lastRun;
    if (!run) return;
    const a = this.dedicated?.approval;
    const service =
      this.model.kind === 'dedicated' && a
        ? {
            kind: 'dedicated',
            organizationId: a.organizationId,
            projectId: a.projectId,
            modelId: this.model.deploymentInfo?.modelId,
            modelName: a.modelName,
            destination:
              'https://' +
              a.deploymentId.toLowerCase() +
              '.ifr.fr-par.scaleway.com/v1/chat/completions',
            authentication: a.authentication,
            region: a.region,
            deploymentId: a.deploymentId,
            endpointId: a.endpointId,
            endpointUrl: a.endpointUrl,
          }
        : {
            kind: 'serverless',
            organizationId: this.scope.project.organizationId,
            projectId: this.scope.project.id,
            modelId: this.model.id,
            modelName: this.model.id,
            destination:
              'https://api.scaleway.ai/' +
              this.scope.project.id +
              '/v1/chat/completions',
            authentication: 'iam',
          };
    // ListedModel has no verified catalogue retrieval timestamp. Do not invent
    // estimate provenance or mistake the display estimate for an actual charge.
    this.snapshot = parseRealExperiment({
      version: 1,
      mode: 'real-provider',
      status,
      timestamp: run.timestamp,
      service,
      prompt: run.prompt,
      maxTokens: run.maxTokens,
      output: this.state.output,
      execution: {
        environment: this.execution.environment,
        status: this.state.status,
        billed:
          this.execution.environment === 'local-mock' ? 'none' : run.billed,
      },
      ...(failure ? { failure } : {}),
      ...(this.state.usage ? { usage: this.state.usage } : {}),
      cost: {
        actual: 'unknown',
        ...(this.model.kind === 'serverless' && this.state.cost
          ? {
              publicEstimate: {
                source: 'public-catalog',
                currency: 'EUR',
                display: this.state.cost,
                retrievedAt: 'unknown',
              },
            }
          : {}),
        billing:
          this.model.kind === 'dedicated' ? 'deployment-duration' : 'token',
      },
    });
  }
  private emit() {
    this.state.snapshotAvailable = !!this.snapshot;
    if (!this.disposed) this.publish({ ...this.state });
  }
  private invalidate = () => {
    if (this.disposed) return;
    this.invalid = true;
    const wasActive = !!this.active;
    this.active?.abort();
    this.active = undefined;
    this.state.running = false;
    this.state.blocked = true;
    this.state.status =
      'Session, projet ou confiance modifiés · ouvrez un nouveau playground';
    if (wasActive) this.capture('cancelled');
    this.emit();
  };
  async receive(value: unknown) {
    if (this.disposed) return;
    const message = parseServiceInput(value);
    if (!message) return;
    if (message.type === 'ready') {
      this.emit();
      return;
    }
    if (
      message.type === 'saveExchange' ||
      message.type === 'loadSnapshot' ||
      message.type === 'exportExample'
    ) {
      if (this.state.actionBusy || this.active) return;
      const snapshot = this.snapshot;
      if (message.type !== 'loadSnapshot' && !snapshot) return;
      this.state.actionBusy = true;
      this.state.actionStatus = 'Opening native document action…';
      this.emit();
      try {
        if (message.type === 'loadSnapshot') await reviewRealSnapshot();
        else if (snapshot && message.type === 'saveExchange')
          await saveRealExchange(snapshot);
        else if (snapshot) await exportRealExchange(snapshot);
        if (this.disposed) return;
        this.state.actionStatus =
          'Native action finished or cancelled · saving is controlled by VS Code · no execution';
      } catch {
        if (this.disposed) return;
        this.state.actionStatus =
          'Document action unavailable or invalid snapshot · no execution';
      } finally {
        if (!this.disposed) {
          this.state.actionBusy = false;
          this.emit();
        }
      }
      return;
    }
    if (message.type === 'cancel') {
      if (!this.active) return;
      this.active?.abort();
      this.active = undefined;
      this.state.running = false;
      this.state.status =
        'Arrêt local · réponse partielle conservée · facturation distante possible';
      this.capture('cancelled');
      this.emit();
      return;
    }
    if (message.type !== 'run' || this.active || this.state.actionBusy) return;
    this.state.runId++;
    if (this.invalid || !this.scope.current()) {
      this.invalidate();
      return;
    }
    if (
      this.model.kind === 'dedicated'
        ? !this.dedicatedAllowed()
        : !serverlessInvocation(this.model)
    ) {
      this.state.blocked = true;
      this.state.status =
        'Appel bloqué · endpoint ou consentement indisponible/expiré · ouvrez un nouveau playground';
      this.emit();
      return;
    }
    const abort = new AbortController();
    const id = this.state.runId;
    this.active = abort;
    this.lastRun = {
      prompt: message.prompt,
      maxTokens: message.maxTokens,
      timestamp: new Date().toISOString(),
      billed: 'unknown',
    };
    this.state.output = '';
    delete this.state.usage;
    delete this.state.cost;
    this.state.running = true;
    this.state.status =
      this.model.kind === 'dedicated'
        ? 'Exécution dédiée · facturation à la durée du déploiement'
        : 'Exécution · un appel facturé';
    this.capture('partial');
    this.emit();
    const current = () =>
      !this.disposed &&
      !this.invalid &&
      this.active === abort &&
      this.state.runId === id &&
      this.scope.current() &&
      !abort.signal.aborted;
    try {
      const authorize = () => {
        if (
          !current() ||
          (this.model.kind === 'dedicated' && !this.dedicatedAllowed())
        )
          throw new Error('authorization denied');
        const key = this.scope.authorize();
        if (!current() || !uuid(key))
          throw new InferenceError('invalid_credentials');
        if (this.lastRun) this.lastRun.billed = 'possible';
        this.capture('partial');
        return key;
      };
      const dedicated = this.dedicated;
      const invoke =
        this.model.kind === 'dedicated' && dedicated
          ? (
              delta: Parameters<typeof invokeText>[1],
              usage: Parameters<typeof invokeText>[2],
            ) =>
              (dedicated.invoke ?? invokeDedicatedText)(
                {
                  deployment: this.model,
                  project: this.scope.project,
                  approval: dedicated.approval,
                  authorize,
                  prompt: message.prompt,
                  maxTokens: message.maxTokens,
                  signal: abort.signal,
                },
                delta,
                usage,
              )
          : (
              delta: Parameters<typeof invokeText>[1],
              usage: Parameters<typeof invokeText>[2],
            ) =>
              this.invoke(
                {
                  modelId: this.model.id,
                  projectId: this.scope.project.id,
                  secretKey: authorize(),
                  prompt: message.prompt,
                  maxTokens: message.maxTokens,
                  signal: abort.signal,
                },
                delta,
                usage,
              );
      // Disabled authentication has no authorize callback. The policy was checked
      // above and the invocation can dispatch; IAM marks possible after authorize.
      if (dedicated?.approval.authentication === 'disabled' && current()) {
        if (this.lastRun) this.lastRun.billed = 'possible';
        this.capture('partial');
      }
      await invoke(
        (text) => {
          if (current()) {
            this.state.output += text;
            this.capture('partial');
            this.emit();
          }
        },
        (usage) => {
          if (current()) {
            this.state.usage = usage;
            this.state.cost =
              this.model.kind === 'dedicated'
                ? 'Facturation à la durée du déploiement · aucune estimation par tokens'
                : estimateCost(this.model, usage);
            this.capture('partial');
          }
        },
      );
      if (current()) {
        this.state.status = 'Réponse terminée';
        this.capture('completed');
      }
    } catch (error) {
      if (current()) {
        if (
          error instanceof InferenceError &&
          ['endpoint_policy', 'invalid_input', 'invalid_credentials'].includes(
            error.code,
          )
        ) {
          if (this.lastRun && !this.state.output)
            this.lastRun.billed = 'unknown';
        }
        const failure =
          error instanceof InferenceError
            ? sanitizeRealFailure(error.code, error.status)
            : sanitizeRealFailure('access_denied');
        this.state.status =
          failure.code === 'access_denied'
            ? 'Accès refusé ou session indisponible'
            : errorMessage(failure.code, failure.status);
        this.capture(this.state.output ? 'partial' : 'failed', failure);
      }
    } finally {
      if (this.active === abort) {
        this.active = undefined;
        this.state.running = false;
        this.emit();
      }
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.invalid = true;
    const scope = this.scope;
    try {
      this.active?.abort();
      scope.signal.removeEventListener('abort', this.invalidate);
      scope.dispose();
    } finally {
      this.active = undefined;
      this.snapshot = undefined;
      this.lastRun = undefined;
      this.state.output = '';
      this.state.status = '';
      this.state.running = false;
      this.state.blocked = true;
      this.state.snapshotAvailable = false;
      this.state.actionBusy = false;
      delete this.state.actionStatus;
      delete this.state.usage;
      delete this.state.cost;
      // Release callbacks retaining credentials, panels and connection state.
      // Dispatched adapters own inputs until settlement; disposed guards late callbacks.
      this.publish = () => {};
      this.invoke = async () => {};
      this.dedicated = undefined;
      this.model = { id: '', label: '', kind: 'serverless' };
      this.scope = {
        project: { id: '', name: '', organizationId: '' },
        signal: AbortSignal.abort(),
        current: () => false,
        authorize: () => {
          throw new Error('playground disposed');
        },
        dispose: () => {},
      };
      this.execution = { environment: 'local-mock' };
    }
  }
}
function errorMessage(code: string, status?: number): string {
  if (code === 'http_error') {
    if (status === 400 || status === 422)
      return 'Requête ou paramètres non acceptés par ce modèle · aucun retry ni remplacement automatique';
    if (status === 401 || status === 403)
      return 'Authentification ou permission refusée · réponse partielle conservée';
    if (status === 429)
      return 'Limite de requêtes ou quota atteint · aucun nouvel essai automatique';
    if (status === 404)
      return 'Modèle ou endpoint indisponible · aucun remplacement';
    if (status && status >= 500)
      return 'Service Scaleway indisponible · réponse partielle conservée';
  }
  const messages: Record<string, string> = {
    http_error:
      'Requête refusée par le service (droits, quota ou disponibilité) · réponse partielle conservée',
    network_error: 'Connexion interrompue · réponse partielle conservée',
    timeout: 'Délai total dépassé · réponse partielle conservée',
    idle_timeout: 'Flux inactif · réponse partielle conservée',
    model_mismatch:
      'Identité du modèle retourné différente · exécution interrompue',
    provider_error: 'Erreur du modèle · réponse partielle conservée',
  };
  return (
    messages[code] ??
    'Flux interrompu ou invalide · réponse partielle conservée'
  );
}
