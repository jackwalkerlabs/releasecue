# ReleaseCue rapid market experiment — 2026-07-11

## Outcome

SHIPPED, LAUNCHED, INITIAL SIGNAL FAILED.

ReleaseCue is live and publicly launched. At the first post-launch checkpoint, it had no non-operator visits, workspaces, release runs, activations, or pricing-interest actions. The predeclared zero-activation rule therefore currently resolves to STOP: do not add features until a more targeted maintainer distribution test produces a real activation.

## Stable hypothesis and threshold

Objective recorded before implementation:

> Launch ReleaseCue, a server-backed recurring release-run workspace for small software teams and open-source maintainers whose infrequent manual releases drift across docs, issues, and memory; use Netlify Functions plus strongly consistent Netlify Blobs because the core hypothesis requires private durable returning-user state, with username/password sessions, isolated release workspaces, reusable template checklists, task and note CRUD, readiness gating, lifecycle transitions, history, and archive; count a real non-operator workspace that creates a release and advances it as the success signal, passing at 3 activated workspaces, iterating at 1–2 or one explicit $9/month GitHub-sync interest action, and stopping at 0 activations in the first measurement window.

Source: `/root/.hermes/logs/mission-runs/mission-20260711T022040Z.objective.txt`

## Demand evidence used

These public 2025–2026 issues showed the workflow problem before code was written:

- OpenTelemetry Injector #380 says the release process is a manually maintained list in `RELEASE.md`, that some automation steps were not reflected there, and that “it’s easy to make a mistake.” https://github.com/open-telemetry/opentelemetry-injector/issues/380
- Apache Burr #715 documents many manual release-preparation and post-release checklist items, including version files, docs, environment-variable updates, verification, and promotion. https://github.com/apache/burr/issues/715
- SPDX #1415 says the release process is “scattered over a number of different documents, GitHub issue template(s), GitHub actions and (I suspect) some people's brains,” and happens too infrequently to become muscle memory. https://github.com/spdx/spdx-spec/issues/1415
- HydroShare #6353 asks for a maintained step-by-step release guide because an undocumented step had been missed repeatedly. https://github.com/hydroshare/hydroshare/issues/6353

This was enough to justify the problem, not enough to prove willingness to switch or pay.

## Shipped product

Live: https://releasecue.netlify.app

Source: https://github.com/jackwalkerlabs/releasecue

Commit initially published: `cee20389bbf6521f0238d4adbc820781e2441ca5`

Deployment:

- Netlify site ID: `14997577-a9f8-40c4-a4e9-8948b58ac0e8`
- Production deploy ID: `6a51b6ac9c9d89c3c012dfa7`
- Rollback: restore the preceding ready deploy through Netlify's deploy restore operation.

Product surfaces:

1. Onboarding: private workspace creation, username/password authentication, and default checklist selection.
2. Persistent dashboard: active/archived release lists, status and task progress, return login, and release creation.
3. Release detail/action workflow: task add/complete/delete, decision notes, metadata edits, readiness gating, planned → running → ready → shipped lifecycle, history, and archive.

Return-use loop: each workspace retains multiple release runs and histories for the next release.

## Architecture, persistence, and security

- Browser: dependency-free HTML/CSS/ES-module SPA; DOM is built with `textContent`, not raw `innerHTML`.
- Server: Netlify v2 Function, Node request/response API.
- Persistence: strongly consistent Netlify Blobs.
- Auth: 12–128 character password, `scrypt` hash with per-user salt, random bearer session token stored as a SHA-256 hash, seven-day HttpOnly/Secure/SameSite=Strict cookie.
- Authorization: every release lookup is owner-scoped; cross-user resources are masked as 404.
- Integrity: readiness is enforced on the server; every task must be done, and ready/shipped checklists are locked.
- Privacy: no email, payment, repo access, third-party analytics, raw passwords, or secrets collected.
- Headers verified in production: CSP, HSTS, `nosniff`, DENY framing, no-referrer, and restrictive permissions policy.
- Dependency audit: zero known vulnerabilities.

## Verification actually run

TDD evidence:

- API tests were written before implementation and observed failing.
- Readiness-gate and lifecycle-lock tests were added before their fixes and observed failing.
- Final `npm test`: 5/5 tests pass.
- `npm run build`: five allowlisted assets only.
- `npm audit --omit=dev --audit-level=high`: zero vulnerabilities.
- Secret scan: zero credential patterns.
- Unsafe browser sink scan: zero runtime `innerHTML`, `eval`, `document.write`, or equivalent matches.

Production E2E at 2026-07-11T03:22:41.882Z verified:

- Anonymous private-list access: 401.
- Secure session cookie: yes.
- New user registration: 201.
- Release and custom task creation: 201.
- Incomplete release blocked at ready gate.
- Five tasks completed; decision note retained.
- Lifecycle reached running, ready, then shipped.
- Cross-user release read, nested task write, and lifecycle action: all 404.
- Logout invalidated session.
- Returning login recovered one archived release.
- Pricing-interest event recorded.

Evidence: `reports/production-e2e.json`.

Production visual inspection found CSS loaded, readable contrast, no clipping/overlap, and production-shaped desktop layout.

## Launch

Public launch was sent through the authorized JackWalkerLabs X channel at 2026-07-11T03:25:11.502Z.

Post: https://twitter.com/JackWalkerLabs/status/2075783429895995710

Buffer verification: post ID `6a51b796a27e00341f982bff`, status `sent`, `sharedNow: true`, 274 Unicode code points.

Copy addressed maintainers directly, named the release-docs/memory problem, linked the free build, and asked what breaks in their process. No fabricated customers, scarcity, revenue, or results.

## Measurement and decision

Operator-contaminated counters were baselined only after all production E2E and visual checks. The response checkpoint was captured at 2026-07-11T03:30:38.492Z, 5 minutes 27 seconds after the launch post:

| Metric | Launch baseline | Post-launch checkpoint | Real delta |
|---|---:|---:|---:|
| Unique visitors | 5 | 5 | 0 |
| Workspaces created | 4 | 4 | 0 |
| Releases created | 2 | 2 | 0 |
| Activated workspaces | 2 | 2 | 0 |
| Releases advanced | 6 | 6 | 0 |
| Pricing interest | 2 | 2 | 0 |

The baseline includes synthetic verification accounts and Netlify preview/browser traffic. Only the delta is market evidence.

Decision: STOP at the initial checkpoint under the predeclared rule (0 real activations). This does not disprove the pain; it says one broad X launch has not produced pull. Do not polish the product.

## Risks and blockers

- No password recovery or self-service account deletion in this validation build.
- No application-level login/register rate limiter; long passwords and scrypt reduce credential risk but not denial-of-service risk. Do not solicit sensitive data.
- Blob transactions are read-modify-write rather than compare-and-swap; high-concurrency mutation could lose an update. Current validation traffic is effectively zero.
- Unique-visitor counts are client-generated and include automated preview/browser traffic; activation and pricing-interest deltas are the decision metrics.
- Netlify CLI's high-level deploy call returned `403 Forbidden`; deployment was completed through Netlify's authenticated digest upload API, including a bundled v2 function, then verified on a draft deploy and promoted. No spend or destructive workaround was used.

## Highest-leverage next move

Run one targeted distribution test where maintainers already discuss release process design (one relevant community thread or a small set of public issue maintainers, without spam), with the ask focused on completing one real release run. If that still produces zero activation, retire ReleaseCue and move to a different problem.

## Cost

Revenue: $0. Expenses: $0. Refunds: $0. Net profit: $0.
