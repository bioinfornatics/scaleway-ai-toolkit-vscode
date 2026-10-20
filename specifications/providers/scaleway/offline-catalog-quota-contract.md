# Catalog/quota observations — offline contract boundary

2026-10-20. Supplements .1.2/.1.3; no authenticated request or new public-source
retrieval. The fixture at tests/discovery/fixtures/catalog-quota-observations.json
is a SYNTHETIC normalized projection of stakeholder-capture notes already in
Beads and existing pinned source research, NOT the complete original JSON, a
provider schema, or independently recaptured evidence. No numeric quota or
technical quota-name/model mapping was invented.

Run: python3 -m unittest discover -s tests/discovery -v

## What is checked locally

- Separate inference serverless /v1/models (Bearer), regional dedicated /models
  (X-Auth-Token), commercial /product-catalog/v2alpha1/catalog and console views.
  Notes report 58 dedicated / 31 commercial / 12 console: distinct populations,
  not interchangeable counts or a universal model/variant/price/lifecycle join.
- Existing pinned SDK read-operation inventory has explicit organization/project
  queries, embedded deployment endpoints, no assumed ListEndpoints, no node-list
  order_by. Its coverage does NOT establish the newer alpha catalog/quota routes.
- Existing source-derived list schemas have arrays and nonnegative total_count,
  but intentionally no invented requiredness. They are partial projections, not
  complete production wire validators. Existing hash/reference checks still pass.
- Stakeholder-noted quota route is singular
  /iam/v1alpha1/organizations/{organization_id}/quota. The noted request used
  order_by=name_asc, organization_id, page=3, page_size=100. Requested size does
  not prove maximum or completeness. Seen entry fields name/limit/pretty_name
  and GLM5.2/5.3 request/minute and token/minute labels do not supply exact
  technical names, numeric values, outer envelope or remaining consumption.
- Fixtures preserve zero, false, null and missing as different states. Available
  enabled stock is not organization capacity, remaining quota or inference grant.
  OrganizationReadOnly is a documentation candidate, not demonstrated minimum IAM.
- Dedicated IAM rename vs pinned permission table, effective quota scope changes,
  and catalog-count differences remain explicit contradictions/unknowns.

## Still unresolved

Full alpha response schemas/errors/pagination, route-specific authentication and
minimum IAM, exact quota identifiers/units/limits and consumption, visibility and
sentinel scope, precision/batch pricing, variants/lifecycle/capability joins and
actual inference/tools/stream/usage/Strands compatibility. The 31 commercial
records mentioned in Beads are not present as complete source data in this
checkout; this supplement does not reconstruct them from descriptions.

No new alpha SDK/docs snapshot was independently retrieved in this work. Thus
current alpha schemas and IAM cannot be called verified. Authenticated fixtures,
least-privilege allow/deny tests and inference require separately scoped approvals.
Screenshots and source schemas prove neither inference nor remaining spend.
Do not auto-enable unknown parameters, assume unknown usage is zero, request
broad IAM grants, forward credentials to unverified routes or issue cloud calls.
