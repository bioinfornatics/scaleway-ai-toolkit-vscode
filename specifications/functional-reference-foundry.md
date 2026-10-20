# Foundry Toolkit — functional reference

Captured 2026-10-20 from stakeholder-selected public sources; not installed-extension verification or permission to copy proprietary code/assets/branding.

## Sources

- https://marketplace.visualstudio.com/items?itemName=ms-windows-ai-studio.windows-ai-studio — received HTML SHA256 `5be4d9ab6794664f66fd08cbd0517831f3bea7e444012a4de3d6385193ea9de9`.
- https://learn.microsoft.com/en-us/azure/foundry/how-to/develop/get-started-projects-visual-studio-code — received HTML SHA256 `add9600d1ca28005fc798115b2c1dc5f4650f6e8823f030b617cfb69e084f26c`; article updated 2026-10-08. Generic authorization banner present but overview publicly returned; no restricted access.

Raw HTML not archived; hashes identify received bytes only. Reverify evolving features before parity claims. Sources describe AI Toolkit renamed Foundry Toolkit and merged with formerly separate Foundry extension. Some experiences are preview.

## Functional mapping

| Official reference capability | Scaleway equivalent / boundary |
|---|---|
| Model catalog and comparison | Verified catalog/capabilities; comparison requires scoped design |
| Deploy models, endpoints/auth | Dedicated deployment with hardware/IAM/license/cost review; serverless needs no dedicated deployment |
| Model Playground | Prompt/parameters/stream; multimodal only with verified support and consent |
| Create Agents / Agent Builder | Advanced portable agents, instructions/model/tools, generated runnable code; Strands, not presumed managed Scaleway Agent Service |
| Tool Catalog / MCP | Approved tools and explicit execution policy |
| Agent Inspector | Interactive streaming/tool inspection; distinct from stored traces |
| Evaluation | Versioned datasets/metrics; bounded optional judges |
| Hosted agent deployment/playground | Host our application, chat/stream/inspection; not model deployment |
| Versions/logs/tracing | Tracked app/spec/run versions, sanitized logs; Cockpit separately verified |
| My Resources vs Developer Tools | Separate available resources from actions; no browsing-triggered effects |
| Knowledge/vector stores | Deferred backend research, not object storage equated to vector search |
| Fine-tuning, ONNX conversion, Windows profiling, other providers | Reference inventory only; deferred/non-goals, not implicit MVP scope |

Local prompt storage does not imply local inference. Azure Agent Service, RBAC, ACR and Application Insights mechanisms are not Scaleway contracts. Learn flags declarative-workflow retirement on 2026-12-01; no replication of that legacy technology as our baseline.

## Stakeholder journey and sequencing

Same-extension progression: catalog -> use serverless or deploy dedicated model -> model playground -> advanced agent creation -> agent playground -> optional hosting/inspection/evaluation. Reuse connection/model selection. Agent creation is advanced, not a separate product or prerequisite for basic model work; model-only MVP requires no Strands runtime installation. Stored specs cannot grant execution authority.

Current Beads puts dedicated model deployment `.5.1` in phase 3. Moving it before agents was subsequently accepted on 2026-10-20 21:40: .4.1 now depends on .5.1. Existing IDs/parent preserved; no cloud-write/design/build authority or MVP broadening follows. Requirements R01–R05 model workbench, R06–R08 advanced agents, R09–R11 deployment/hosting, R12 quality. Beads owns current status.

## Stakeholder sidebar screenshot — 2026-10-20

Method: visual inspection of conversation attachment; no local image bytes archived.
Reference inventory, not approved Scaleway visual source or implementation mandate.

- My Resources: Set Foundry Project, Models, Agents, Tools, Knowledge, Evaluations,
  Recent, Local Resources, Classic.
- Developer Tools / Discover: Model Catalog, Tool Catalog.
- Developer Tools / Build: Create Agent, Agent Inspector, Deploy to Microsoft
  Foundry, Hosted Agent Playground, Model Playground, Model Conversion, Fine-tuning.
- Developer Tools / Monitor: collapsed; children not visible, not inferred.
- Help And Feedback: Ask Copilot, Get Started, View Documentation, What's New,
  Report Issues, Join Community.

The highlighted Create Agent row is a selected navigation action, not evidence of
an agent creation screen, completed agent, or required onboarding order. Tree order
is not execution dependency order. Deploy to Microsoft Foundry is a visible label;
its target/operation cannot be determined from screenshot alone.

## Approved experimental navigation — 2026-10-20

Stakeholder rejected the minimal two-model-only sidebar after viewing installed
VSIX0.0.1 and approved the proposed Foundry-inspired three native sections:
Mes ressources, Outils de développement, Aide et retours. VSIX0.0.2 implements
offline context/models/last experiment; Découvrir/demo catalogue (Quick Pick);
Construire et tester/central model playground; getting started/documentation.
No advanced placeholders. Central editor owns prompt/run/stop/response/JSON action;
sidebar is navigation, not response surface. Theme tokens and text-only rendering
remain provisional native styling, not copied Foundry code/assets or brand.
This is scoped incremental build approval, not production/value validation.
Owning implementation apps/vscode-extension; evidence/validation/vscode-navigation-preview-v2.json.

Scaleway navigation should preserve resources vs actions separation and contextual
project selection. Labels/services such as Classic, Foundry project and Ask Copilot
are not automatic equivalents. Expose only implemented, verified slice capabilities;
no empty advanced menus or fake feature parity. Model and agent playgrounds remain
separate actions within the same extension. Dependency sequencing remains in Beads.

## Stakeholder reminder and delivery alignment — 23:44–23:46

The stakeholder explicitly supplies the inventory again: My Resources / Set
Foundry Project, Models, Agents, Tools, Knowledge, Evaluations, Recent (Create in
Code With Template; Design an Agent with Builder), Local Resources, Classic;
Developer Tools / Discover (Model Catalog, Tool Catalog), Build (Create Agent,
Agent Inspector, Deploy to Microsoft Foundry, Hosted Agent Playground, Model
Playground, Model Conversion, Fine-tuning), Monitor; Help And Feedback.
Project selection exposes Switch project and Create project with default assignment.
This is stakeholder-reported reference, not independently verified installed Azure UI.

[Delivery roadmap](roadmap.md) maps implemented Scaleway actions and future stages.
Beads .3.22 prioritizes currently invisible installed model catalog, reusing
existing .3.3/.3.6 API observations; .3.23 aligns native resources vs discovery
vs build and Local Resources; .3.24 defines Switch/default-project selector and
separately guarded Create project. No empty advanced actions or write authorization
from a menu label. Public/help/offline access and silent explicit bounded GET remain.


## Eight outcome-oriented journeys — stakeholder reference 2026-10-21 01:09

Provenance: the stakeholder supplied the descriptions and links below in conversation.
These additions have not been independently recaptured or verified against an installed
Foundry version. They guide developer outcomes, not Azure/Scaleway service parity,
visual-source approval, billable operations or license acceptance. Earlier source
hashes above do not identify these new pages.

| Journey / intended result | Scaleway mapping and current boundary | Existing Beads authority |
|---|---|---|
| 1. Choose a model and test an idea → accessible model and first behavior assessment | Public Serverless offers, dedicated model catalog and existing deployments are separate. Dedicated path: catalog → compatible infrastructure → reviewed creation → returned endpoint → real model playground. Serverless need not allocate dedicated GPU. Only catalog/details, deployment preparation/explorer and synthetic playground are delivered; real invocation/comparison remains incomplete. | .3.3, .3.4, .3.6, .5.1 |
| 2. Prototype an agent locally → reusable local configuration and generated integration code | Strands portable spec/instructions/model/tool refs; local configuration can call a distant model. Bounded JSON prompting + local validation/repair is our accepted baseline, not native structured-output parity. No Strands prerequisite for model-only workflow. | .4.1–.4.5; contracts under .1.5; repair .1.10 |
| 3. Configure a managed prompt agent → versioned service-side agent | No verified native Scaleway managed prompt-agent/version/session service. A local declarative Strands spec or our hosted application is a different product boundary, not a renamed equivalent. Saving a version does not publish a stable endpoint. Do not expose an assumed cloud-agent CRUD menu. | .4.1/.4.2 and .5.3 for our application only; provider feasibility remains unestablished |
| 4. Develop an agent in code and host it → repository source running remotely | Generate/maintain Strands application code, debug locally, package a portable image, explicitly deploy to reviewed hosting and inspect via hosted playground. Scaleway Containers is a candidate; Azure ZIP/ACR/Foundry scaling are not assumed. Dedicated model allocation and agent-app hosting are separate effects. | .4.2/.4.4/.4.5, .5.2–.5.6, hosting .1.6 |
| 5. Connect business data/actions → authenticated useful tool execution | Approved MCP configuration and pre-effect policy first. OpenAPI, A2A and Toolbox have distinct roles; no automatic adapter/service parity. A localhost MCP server cannot simply be reused by cloud execution: reachability/auth and grants must be re-reviewed. | .4.3 and .4.2; retrieval .6.1 |
| 6. Measure quality/regressions → comparable versioned metrics | Distinguish scoring recorded outputs from live dataset execution. Local evaluations can invoke distant models and consume budget. Dataset/version/metric/judge provenance, concurrency/cancellation and partial/error exclusions required. | .4.6/.4.7, product/value .2.5 |
| 7. Inspect failure/latency → identify responsible step and verify fix | Live correlated inspector differs from retained traces. Strands run/model/tool events plus optional approved local tracing; Cockpit ingestion/auth/linking requires its own verification, not Application Insights parity. | .4.5/.4.7, .5.5 |
| 8. Adapt/optimize a model → measured optimized model or adapter | Conversion/quantification/fine-tuning require provider/platform feasibility, datasets and comparison. Selecting an API-supported quantization for deployment is NOT conversion/training. Windows ONNX/Phi Silica/LoRA tooling is not a Linux/Scaleway promise. | .6.2/.6.3 (research), compatibility .5.1 |

### Supplied reference links (not independently fetched in this update)

- Project/resources navigation: https://learn.microsoft.com/en-us/azure/foundry/how-to/develop/get-started-projects-vs-code
- Model catalog and destinations: https://code.visualstudio.com/docs/intelligentapps/models
- Local/managed agent configuration: https://code.visualstudio.com/docs/intelligentapps/agentbuilder
- Prompt vs hosted agent: https://code.visualstudio.com/docs/intelligentapps/create-agents
- Hosted code/application: https://code.visualstudio.com/docs/intelligentapps/hosted-agents
- Optional Copilot-assisted development: https://code.visualstudio.com/docs/intelligentapps/copilot-tools
- MCP/OpenAPI/A2A/Toolbox reference: https://code.visualstudio.com/docs/intelligentapps/tool-catalog
- Evaluation: https://code.visualstudio.com/docs/intelligentapps/evaluation
- Inspector: https://code.visualstudio.com/docs/intelligentapps/agent-inspector
- Tracing: https://code.visualstudio.com/docs/intelligentapps/tracing
- Conversion: https://code.visualstudio.com/docs/intelligentapps/modelconversion
- Fine-tuning: https://code.visualstudio.com/docs/intelligentapps/finetune

### Product invariants carried into delivery

My Resources answers “what exists and in what state?”; Developer Tools answers
“what action can I take?”. A catalog entry is not deployment, ready catalog is not
ready endpoint, local config is not local inference, a saved version is not a
published application, and a prepared plan is not executed allocation. Resources
must not be fabricated to make the journey look complete. Use the same verified
model selection/context through model and advanced-agent workflows, without merging
catalog UUIDs, deployment UUIDs and inference IDs by guessed name matching.

The eight journeys describe coverage, not eight MVP dependencies. Keep the accepted
sequence: model exploration/use → reviewed dedicated deployment → advanced local
Strands agents → optional hosted application. Retain explicit unsupported/unknown
states and expose only working actions. Source-generated examples, executed examples,
locally saved specs and remotely deployed versions need distinct labels/evidence.
