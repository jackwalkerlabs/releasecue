# ReleaseCue

A private recurring release-run workspace for small software teams and open-source maintainers.

## Product surfaces

1. Onboarding/setup: create a password-protected workspace and choose a default checklist.
2. Persistent dashboard: create release runs, revisit the queue, see target-date status, and inspect archived history.
3. Detail/action workflow: add/complete/delete tasks, log decisions, edit ownership and dates, advance planned → running → ready → shipped, and archive.

## Architecture

- Netlify static client + Netlify Function business logic
- Netlify Blobs persistent storage with strong consistency
- Passwords hashed with Node scrypt and unique salts
- Random sessions stored only as SHA-256 token hashes; HttpOnly, Secure, SameSite=Strict cookie
- Every release and nested task/note action checks the authenticated user; foreign IDs return 404
- Privacy-safe aggregate validation counters and an explicit $9/month GitHub-sync interest action; no payment flow

## Verify

```bash
npm install --ignore-scripts
npm test
npm run build
node --check public/app.js
node --check src/api.js
npm audit --omit=dev --audit-level=high
```

## Privacy and limits

Do not enter credentials, secrets, or regulated/sensitive data. ReleaseCue stores the username, one-way password hash, workspace setup, and release metadata entered by the user. It has no email, payment, repository access, or third-party analytics. Netlify may retain standard request metadata. This validation build has no password recovery or automatic account deletion.

ReleaseCue does not deploy code, guarantee release safety, or replace CI. It is a workflow record and readiness gate.

## Rollback

Publish the prior known-good deploy from Netlify Deploys. Deploy IDs are recorded in the experiment report.
