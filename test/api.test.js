import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../src/api.js';

class MemoryStore {
  constructor() { this.values = new Map(); }
  async get(key, options = {}) {
    const value = this.values.get(key);
    if (value === undefined) return null;
    return options.type === 'json' ? structuredClone(value) : JSON.stringify(value);
  }
  async setJSON(key, value) { this.values.set(key, structuredClone(value)); }
  async delete(key) { this.values.delete(key); }
}

const req = (method, path, body, cookie = '') => new Request(`https://releasecue.test${path}`, {
  method,
  headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const sessionCookie = (response) => response.headers.get('set-cookie').split(';')[0];
const makeApi = () => createApi({
  store: new MemoryStore(),
  now: () => '2026-07-11T02:30:00.000Z',
  randomId: (() => { let n = 0; return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`; })(),
  randomToken: (() => { let n = 2; return () => String(++n % 10).repeat(64); })(),
});

async function signup(api, username = 'release-owner') {
  const response = await api(req('POST', '/api/register', {
    username, password: `${username}-password-long`, workspaceName: `${username} releases`, template: 'web-app',
  }));
  return { response, cookie: sessionCookie(response) };
}

test('owner completes a recurring release run with tasks, notes, lifecycle, edits, and archive', async () => {
  const api = makeApi();
  const { response, cookie } = await signup(api);
  assert.equal(response.status, 201);
  assert.match(response.headers.get('set-cookie'), /rc_session=.*HttpOnly.*Secure.*SameSite=Strict/i);
  assert.equal((await response.clone().json()).user.template, 'web-app');

  const createdResponse = await api(req('POST', '/api/releases', {
    name: 'July product release', version: 'v2.4.0', owner: 'Maya', targetDate: '2026-07-18',
  }, cookie));
  assert.equal(createdResponse.status, 201);
  let release = (await createdResponse.json()).release;
  assert.equal(release.status, 'planned');
  assert.ok(release.tasks.length >= 3);
  assert.equal('userId' in release, false);

  const added = await api(req('POST', `/api/releases/${release.id}/tasks`, { text: 'Verify rollback command' }, cookie));
  release = (await added.json()).release;
  const customTask = release.tasks.find((task) => task.text === 'Verify rollback command');
  assert.ok(customTask);

  const completed = await api(req('PATCH', `/api/releases/${release.id}/tasks/${customTask.id}`, { done: true }, cookie));
  release = (await completed.json()).release;
  assert.equal(release.tasks.find((task) => task.id === customTask.id).done, true);
  for (const task of release.tasks.filter((item) => !item.done)) {
    release = (await (await api(req('PATCH', `/api/releases/${release.id}/tasks/${task.id}`, { done: true }, cookie))).json()).release;
  }
  const removedTask = await api(req('DELETE', `/api/releases/${release.id}/tasks/${customTask.id}`, undefined, cookie));
  release = (await removedTask.json()).release;
  assert.equal(release.tasks.some((task) => task.id === customTask.id), false);

  const noted = await api(req('POST', `/api/releases/${release.id}/notes`, { text: 'Staging smoke test passed.' }, cookie));
  release = (await noted.json()).release;
  assert.equal(release.notes.at(-1).text, 'Staging smoke test passed.');

  for (const action of ['start', 'mark-ready', 'mark-shipped']) {
    const advanced = await api(req('POST', `/api/releases/${release.id}/actions`, { action }, cookie));
    assert.equal(advanced.status, 200);
    release = (await advanced.json()).release;
  }
  assert.equal(release.status, 'shipped');

  const edited = await api(req('PATCH', `/api/releases/${release.id}`, {
    name: 'July stable release', version: 'v2.4.1', owner: 'Maya', targetDate: '2026-07-19',
  }, cookie));
  assert.equal((await edited.json()).release.version, 'v2.4.1');

  const archived = await api(req('DELETE', `/api/releases/${release.id}`, undefined, cookie));
  assert.equal((await archived.json()).release.archived, true);
  assert.equal((await (await api(req('GET', '/api/releases', undefined, cookie))).json()).releases.length, 0);
  const history = await (await api(req('GET', '/api/releases?include=archived', undefined, cookie))).json();
  assert.equal(history.releases[0].archived, true);
});

test('ready gate blocks a release until every checklist task is complete', async () => {
  const api = makeApi();
  const { cookie } = await signup(api, 'readiness-owner');
  let release = (await (await api(req('POST', '/api/releases', {
    name: 'Guarded release', version: 'v3.0.0', owner: 'Mira', targetDate: '2026-07-21',
  }, cookie))).json()).release;
  release = (await (await api(req('POST', `/api/releases/${release.id}/actions`, { action: 'start' }, cookie))).json()).release;

  const blocked = await api(req('POST', `/api/releases/${release.id}/actions`, { action: 'mark-ready' }, cookie));
  assert.equal(blocked.status, 409);
  assert.match((await blocked.json()).error, /complete every task/i);

  for (const task of release.tasks) {
    release = (await (await api(req('PATCH', `/api/releases/${release.id}/tasks/${task.id}`, { done: true }, cookie))).json()).release;
  }
  const ready = await api(req('POST', `/api/releases/${release.id}/actions`, { action: 'mark-ready' }, cookie));
  assert.equal(ready.status, 200);
  assert.equal((await ready.json()).release.status, 'ready');

  const reopenedAfterReady = await api(req('PATCH', `/api/releases/${release.id}/tasks/${release.tasks[0].id}`, { done: false }, cookie));
  assert.equal(reopenedAfterReady.status, 409);
});

test('returning login, experiment metrics, validation, and storage recovery behave safely', async () => {
  const api = makeApi();
  await api(req('POST', '/api/visit', { visitorId: '11111111-1111-4111-8111-111111111111' }));
  await api(req('POST', '/api/visit', { visitorId: '11111111-1111-4111-8111-111111111111' }));
  await signup(api, 'metric-owner');
  const denied = await api(req('POST', '/api/login', { username: 'metric-owner', password: 'wrong-password-long' }));
  assert.equal(denied.status, 401);
  const login = await api(req('POST', '/api/login', { username: 'METRIC-OWNER', password: 'metric-owner-password-long' }));
  const cookie = sessionCookie(login);
  const invalid = await api(req('POST', '/api/releases', { name: 'Bad', version: 'bad version', owner: 'A', targetDate: 'not-a-date' }, cookie));
  assert.equal(invalid.status, 400);
  const impossibleDate = await api(req('POST', '/api/releases', { name: 'Impossible', version: 'v1.0.0', owner: 'A', targetDate: '2026-02-30' }, cookie));
  assert.equal(impossibleDate.status, 400);
  let release = (await (await api(req('POST', '/api/releases', { name: 'Metric release', version: 'v1.0.0', owner: 'A', targetDate: '2026-07-20' }, cookie))).json()).release;
  await api(req('POST', `/api/releases/${release.id}/actions`, { action: 'start' }, cookie));
  await api(req('POST', '/api/intent', { kind: 'github-sync-pricing' }, cookie));
  await api(req('POST', '/api/intent', { kind: 'github-sync-pricing' }, cookie));
  assert.deepEqual(await (await api(req('GET', '/api/metrics'))).json(), {
    uniqueVisitors: 1, workspacesCreated: 1, releasesCreated: 1, activatedWorkspaces: 1, releasesAdvanced: 1, pricingInterest: 1,
  });
  const logout = await api(req('POST', '/api/logout', {}, cookie));
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await api(req('GET', '/api/me', undefined, cookie))).status, 401);

  const broken = createApi({ store: { async get() { throw new Error('private coordinates'); }, async setJSON() {}, async delete() {} } });
  const failed = await broken(req('GET', '/api/metrics'));
  assert.equal(failed.status, 500);
  assert.deepEqual(await failed.json(), { error: 'Temporary server error.' });
  assert.equal(failed.headers.get('retry-after'), '5');
});

test('private releases require authentication and foreign users receive 404 across nested actions', async () => {
  const api = makeApi();
  const first = await signup(api, 'first-owner');
  const second = await signup(api, 'second-owner');
  const release = (await (await api(req('POST', '/api/releases', {
    name: 'Private release', version: 'v1.0.0', owner: 'A', targetDate: '2026-07-20',
  }, first.cookie))).json()).release;

  assert.equal((await api(req('GET', '/api/releases'))).status, 401);
  assert.equal((await api(req('GET', `/api/releases/${release.id}`, undefined, second.cookie))).status, 404);
  assert.equal((await api(req('POST', `/api/releases/${release.id}/tasks`, { text: 'steal' }, second.cookie))).status, 404);
  assert.equal((await api(req('POST', `/api/releases/${release.id}/actions`, { action: 'start' }, second.cookie))).status, 404);
});
