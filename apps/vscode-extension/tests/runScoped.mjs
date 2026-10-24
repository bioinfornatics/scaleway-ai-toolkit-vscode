import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
// Fixed historical non-stopped selection: new suites require deliberate inclusion.
export const priorSuites = [
  'agentProject',
  'agentScaffold',
  'boundedExperimentRead',
  'browserLogin',
  'catalog',
  'catalogHealth',
  'catalogNavigation',
  'catalogRenderer',
  'catalogVisibility',
  'connection',
  'dedicatedConsent',
  'dedicatedInvocationPolicy',
  'dedicatedPrices',
  'deployService',
  'deployedResources',
  'deployment',
  'deploymentExplorer',
  'deploymentJournal',
  'deploymentLifecycle',
  'deploymentOverviewState',
  'deploymentWizard',
  'embeddedTemplates',
  'existingAPIKey',
  'existingAPIKeySdk',
  'inference',
  'llmAccessIam',
  'llmAccessRegistry',
  'llmAccessWizard',
  'localCreation',
  'localInventory',
  'modelEula',
  'projectActions',
  'projectCreation',
  'projectEnvironment',
  'projectGenerator',
  'provider',
  'pythonProjectLayout',
  'quotas',
  'resourceOverview',
  'scalewaySdk',
  'serverlessAvailability',
  'stackScaffold',
  'templateLibrary',
].map((name) => name + '.test.cjs');
export const addedSuites = [
  'a2aService.test.cjs',
  'agentos.test.cjs',
  'serviceProject.test.cjs',
  'serviceCompatibility.test.cjs',
  'buildPackaging.test.cjs',
  'releasePrep.test.cjs',
  'endpointAgent.test.cjs',
  'frameworkAgents.test.cjs',
  'localAgentRunner.test.cjs',
  'servicePlaygroundLifecycle.test.cjs',
  'pythonInstalledLayout.test.cjs',
];
const args = process.argv.slice(2);
if (args.some((arg) => !['--full', '--list'].includes(arg)))
  throw new Error('Usage: node tests/runScoped.mjs [--list] [--full]');
const all = readdirSync(path.join(root, 'tests'))
  .filter((name) => name.endsWith('.test.cjs'))
  .sort();
const selected = args.includes('--full')
  ? all
  : [...priorSuites, ...addedSuites];
if (selected.some((name) => !all.includes(name)))
  throw new Error('Missing explicitly selected suite');
const excluded = all.filter((name) => !selected.includes(name));
console.log(
  JSON.stringify(
    {
      mode: args.includes('--full') ? 'FULL EXPLICIT OPT-IN' : 'SCOPED',
      priorSuites: priorSuites.length,
      selected,
      excluded,
      reason:
        'Stopped historical playground/experiment suites and dedicatedInference never resume implicitly; unlisted new suites require explicit review.',
    },
    null,
    2,
  ),
);
if (!args.includes('--list')) {
  const result = spawnSync(
    process.execPath,
    ['--test', ...selected.map((name) => path.join(root, 'tests', name))],
    { cwd: root, stdio: 'inherit' },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
