import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const base = process.argv[2] || 'https://releasecue.netlify.app';
const out = process.argv[3] || 'reports/production-e2e.json';
const stamp = Date.now().toString(36);
const passwordA = `Verify-A-${randomBytes(12).toString('hex')}`;
const passwordB = `Verify-B-${randomBytes(12).toString('hex')}`;
const usernameA = `verify-a-${stamp}`;
const usernameB = `verify-b-${stamp}`;

async function request(path, { method = 'GET', body, cookie, expected = 200 } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  let data = {};
  try { data = await response.json(); } catch { data = { nonJson: true }; }
  if (response.status !== expected) throw new Error(`${method} ${path}: expected ${expected}, got ${response.status}: ${JSON.stringify(data)}`);
  return { response, data };
}
const cookieFrom = ({ response }) => response.headers.get('set-cookie').split(';')[0];

const before = (await request('/api/metrics')).data;
await request('/api/releases', { expected: 401 });
const registeredA = await request('/api/register', {
  method: 'POST', expected: 201,
  body: { username: usernameA, password: passwordA, workspaceName: 'Operator verification A', template: 'web-app' },
});
if (!/HttpOnly.*Secure.*SameSite=Strict/i.test(registeredA.response.headers.get('set-cookie'))) throw new Error('Secure cookie attributes missing.');
const cookieA = cookieFrom(registeredA);
const created = await request('/api/releases', {
  method: 'POST', expected: 201, cookie: cookieA,
  body: { name: 'Operator release lifecycle', version: `v0.0.${stamp.length}`, owner: 'Operator', targetDate: '2026-07-25' },
});
const releaseId = created.data.release.id;
const addedTask = await request(`/api/releases/${releaseId}/tasks`, { method: 'POST', expected: 201, cookie: cookieA, body: { text: 'Verify production rollback path' } });
let release = addedTask.data.release;
const started = await request(`/api/releases/${releaseId}/actions`, { method: 'POST', cookie: cookieA, body: { action: 'start' } });
const blockedReady = await request(`/api/releases/${releaseId}/actions`, { method: 'POST', cookie: cookieA, body: { action: 'mark-ready' }, expected: 409 });
for (const task of release.tasks) {
  const completed = await request(`/api/releases/${releaseId}/tasks/${task.id}`, { method: 'PATCH', cookie: cookieA, body: { done: true } });
  release = completed.data.release;
}
const noted = await request(`/api/releases/${releaseId}/notes`, { method: 'POST', expected: 201, cookie: cookieA, body: { text: 'Synthetic deployment smoke test passed.' } });
const ready = await request(`/api/releases/${releaseId}/actions`, { method: 'POST', cookie: cookieA, body: { action: 'mark-ready' } });
const shipped = await request(`/api/releases/${releaseId}/actions`, { method: 'POST', cookie: cookieA, body: { action: 'mark-shipped' } });
const edited = await request(`/api/releases/${releaseId}`, { method: 'PATCH', cookie: cookieA, body: { name: 'Operator release verified', version: 'v0.0.verified', owner: 'Operator', targetDate: '2026-07-26' } });

const registeredB = await request('/api/register', {
  method: 'POST', expected: 201,
  body: { username: usernameB, password: passwordB, workspaceName: 'Operator verification B', template: 'blank' },
});
const cookieB = cookieFrom(registeredB);
await request(`/api/releases/${releaseId}`, { cookie: cookieB, expected: 404 });
await request(`/api/releases/${releaseId}/tasks`, { method: 'POST', cookie: cookieB, body: { text: 'Unauthorized task' }, expected: 404 });
await request(`/api/releases/${releaseId}/actions`, { method: 'POST', cookie: cookieB, body: { action: 'start' }, expected: 404 });

await request('/api/logout', { method: 'POST', cookie: cookieA, body: {} });
await request('/api/me', { cookie: cookieA, expected: 401 });
const loggedIn = await request('/api/login', { method: 'POST', body: { username: usernameA, password: passwordA } });
const returnedCookie = cookieFrom(loggedIn);
const returningMe = await request('/api/me', { cookie: returnedCookie });
const returningList = await request('/api/releases', { cookie: returnedCookie });
await request('/api/intent', { method: 'POST', cookie: returnedCookie, body: { kind: 'github-sync-pricing' } });
const archived = await request(`/api/releases/${releaseId}`, { method: 'DELETE', cookie: returnedCookie });
const activeList = await request('/api/releases', { cookie: returnedCookie });
const archiveList = await request('/api/releases?include=archived', { cookie: returnedCookie });
const after = (await request('/api/metrics')).data;

const report = {
  success: true,
  testedAt: new Date().toISOString(),
  base,
  operatorRecords: { workspaces: [usernameA, usernameB], releaseId },
  checks: {
    anonymousList: 401,
    secureSessionCookie: true,
    register: registeredA.response.status,
    create: created.response.status,
    addTask: addedTask.response.status,
    incompleteReadyGate: blockedReady.data.error,
    tasksCompleted: release.tasks.filter((task) => task.done).length,
    noteLogged: noted.data.release.notes.length,
    lifecycle: [started.data.release.status, ready.data.release.status, shipped.data.release.status],
    editVersion: edited.data.release.version,
    crossUserRead: 404,
    crossUserNestedWrite: 404,
    crossUserLifecycle: 404,
    logoutInvalidatedSession: true,
    returningUser: returningMe.data.user.username,
    returningReleaseCount: returningList.data.releases.length,
    archived: archived.data.release.archived,
    activeCountAfterArchive: activeList.data.releases.length,
    archiveCount: archiveList.data.releases.length,
    intentRecorded: true,
  },
  metricsBefore: before,
  metricsAfter: after,
  operatorBaselineDelta: Object.fromEntries(Object.keys(after).map((key) => [key, after[key] - (before[key] || 0)])),
};
await mkdir(dirname(out), { recursive: true });
await writeFile(out, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
