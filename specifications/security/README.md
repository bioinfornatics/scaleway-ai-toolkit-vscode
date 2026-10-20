# Security specifications

Owner task: scaleway_ai_vscode-jgh.1.4. Baseline: [architecture trust boundaries](../architecture.md#security) and requirements R01/R03/R07/R08/R12 in [product specification](../product.md#requirements).

This is an organization entry point, not a completed threat model or security acceptance.

Authored deliverables belong here: threat-model.md (threat → boundary → mitigation → executable check → residual risk → requirement), authorization-policy.md (credential/endpoint rules and bounded mandates), security-test-cases.md (policy, redaction, isolation, revocation, budgets and uncertain-effect recovery checks).

Distinguish discovery, inference, workspace-data transmission, tool execution and provisioning approvals. Secrets must never appear in chat, fixtures, evidence, exports or webview payloads. Test cases may be specified now; passing execution evidence requires actual tests.
