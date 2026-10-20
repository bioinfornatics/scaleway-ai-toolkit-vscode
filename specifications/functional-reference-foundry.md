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
