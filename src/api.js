import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-releasecue-api': '1',
    ...headers,
  },
});
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const clean = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const normalizeUsername = (value) => clean(value, 32).toLowerCase();
const publicUser = ({ id, username, workspaceName, template, createdAt }) => ({ id, username, workspaceName, template, createdAt });
const safeRelease = ({ userId, ...release }) => release;
const sessionHeader = (token) => `rc_session=${token}; Path=/; Max-Age=604800; HttpOnly; Secure; SameSite=Strict`;
const UUID = /^[a-f0-9-]{36}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (value) => {
  if (!DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,39}$/;
const TEMPLATES = {
  'web-app': ['Freeze release scope', 'Verify staging smoke test', 'Confirm rollback path', 'Publish changelog'],
  package: ['Update version and changelog', 'Run clean package build', 'Verify install from artifact', 'Publish and tag release'],
  mobile: ['Freeze release scope', 'Run device smoke tests', 'Confirm store metadata', 'Submit build for review'],
  blank: [],
};

function parseCookie(request, name) {
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return '';
}
async function readBody(request, max = 20_000) {
  const raw = await request.text();
  if (raw.length > max) return { error: json({ error: 'Request is too large.' }, 413) };
  try { return { value: JSON.parse(raw || '{}') }; }
  catch { return { error: json({ error: 'Invalid JSON.' }, 400) }; }
}
async function ownedRelease(store, id, userId) {
  const release = await store.get(`release:${id}`, { type: 'json' });
  return release && release.userId === userId ? release : null;
}

export function createApi({
  store,
  now = () => new Date().toISOString(),
  randomId = randomUUID,
  randomToken = () => randomBytes(32).toString('hex'),
}) {
  const defaultMetrics = () => ({
    uniqueVisitors: 0,
    workspacesCreated: 0,
    releasesCreated: 0,
    activatedWorkspaces: 0,
    releasesAdvanced: 0,
    pricingInterest: 0,
  });
  const bump = async (field) => {
    const metrics = await store.get('metrics', { type: 'json' }) || defaultMetrics();
    metrics[field] += 1;
    await store.setJSON('metrics', metrics);
  };
  const authenticated = async (request) => {
    const token = parseCookie(request, 'rc_session');
    if (!/^[a-f0-9]{64}$/.test(token)) return null;
    const session = await store.get(`session:${sha256(token)}`, { type: 'json' });
    if (!session || session.expiresAt <= now()) return null;
    const user = await store.get(`user:${session.userId}`, { type: 'json' });
    return user ? { user, token } : null;
  };
  const authenticate = async (request) => {
    const auth = await authenticated(request);
    return auth || { error: json({ error: 'Authentication required.' }, 401) };
  };
  const persistRelease = async (release) => {
    release.updatedAt = now();
    await store.setJSON(`release:${release.id}`, release);
  };

  return async function handle(request) {
    try {
      const url = new URL(request.url);
      const path = url.pathname.replace(/^\/\.netlify\/functions\/api/, '').replace(/\/$/, '') || '/';

      if (request.method === 'POST' && path === '/api/visit') {
        const parsed = await readBody(request, 1_000);
        if (parsed.error) return parsed.error;
        const visitorId = clean(parsed.value.visitorId, 36);
        if (!UUID.test(visitorId)) return json({ error: 'Invalid visitor ID.' }, 400);
        const key = `visit:${sha256(visitorId)}`;
        if (!await store.get(key, { type: 'json' })) {
          await store.setJSON(key, { firstSeenAt: now() });
          await bump('uniqueVisitors');
        }
        return json({ recorded: true });
      }
      if (request.method === 'GET' && path === '/api/metrics') {
        return json(await store.get('metrics', { type: 'json' }) || defaultMetrics());
      }

      if (request.method === 'POST' && path === '/api/register') {
        const parsed = await readBody(request);
        if (parsed.error) return parsed.error;
        const username = normalizeUsername(parsed.value.username);
        const password = typeof parsed.value.password === 'string' ? parsed.value.password : '';
        const workspaceName = clean(parsed.value.workspaceName, 60);
        const template = clean(parsed.value.template, 20);
        if (!/^[a-z0-9][a-z0-9-]{2,31}$/.test(username)) return json({ error: 'Username must be 3–32 lowercase letters, numbers, or hyphens.' }, 400);
        if (password.length < 12 || password.length > 128) return json({ error: 'Password must be 12–128 characters.' }, 400);
        if (!workspaceName) return json({ error: 'Workspace name is required.' }, 400);
        if (!(template in TEMPLATES)) return json({ error: 'Choose a valid release template.' }, 400);
        if (await store.get(`username:${username}`, { type: 'json' })) return json({ error: 'That username is unavailable.' }, 409);
        const id = randomId();
        const salt = randomBytes(16).toString('hex');
        const user = {
          id, username, workspaceName, template, salt,
          passwordHash: scryptSync(password, salt, 64).toString('hex'),
          releaseIds: [], activated: false, pricingInterest: false, createdAt: now(),
        };
        await store.setJSON(`user:${id}`, user);
        await store.setJSON(`username:${username}`, { userId: id });
        await bump('workspacesCreated');
        const token = randomToken();
        await store.setJSON(`session:${sha256(token)}`, {
          userId: id,
          expiresAt: new Date(Date.parse(now()) + 7 * 86400_000).toISOString(),
        });
        return json({ user: publicUser(user) }, 201, { 'set-cookie': sessionHeader(token) });
      }

      if (request.method === 'POST' && path === '/api/login') {
        const parsed = await readBody(request, 2_000);
        if (parsed.error) return parsed.error;
        const username = normalizeUsername(parsed.value.username);
        const password = typeof parsed.value.password === 'string' ? parsed.value.password : '';
        const lookup = await store.get(`username:${username}`, { type: 'json' });
        const user = lookup ? await store.get(`user:${lookup.userId}`, { type: 'json' }) : null;
        let valid = false;
        if (user && password.length <= 128) {
          const actual = scryptSync(password, user.salt, 64);
          const expected = Buffer.from(user.passwordHash, 'hex');
          valid = actual.length === expected.length && timingSafeEqual(actual, expected);
        }
        if (!valid) return json({ error: 'Invalid username or password.' }, 401);
        const token = randomToken();
        await store.setJSON(`session:${sha256(token)}`, {
          userId: user.id,
          expiresAt: new Date(Date.parse(now()) + 7 * 86400_000).toISOString(),
        });
        return json({ user: publicUser(user) }, 200, { 'set-cookie': sessionHeader(token) });
      }
      if (request.method === 'POST' && path === '/api/logout') {
        const auth = await authenticated(request);
        if (auth) await store.delete(`session:${sha256(auth.token)}`);
        return json({ loggedOut: true }, 200, {
          'set-cookie': 'rc_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict',
        });
      }
      if (request.method === 'GET' && path === '/api/me') {
        const auth = await authenticate(request);
        if (auth.error) return auth.error;
        return json({ user: publicUser(auth.user) });
      }
      if (request.method === 'POST' && path === '/api/intent') {
        const auth = await authenticate(request);
        if (auth.error) return auth.error;
        const parsed = await readBody(request, 1_000);
        if (parsed.error) return parsed.error;
        if (parsed.value.kind !== 'github-sync-pricing') return json({ error: 'Invalid intent.' }, 400);
        if (!auth.user.pricingInterest) {
          auth.user.pricingInterest = true;
          await store.setJSON(`user:${auth.user.id}`, auth.user);
          await bump('pricingInterest');
        }
        return json({ recorded: true });
      }

      if (path === '/api/releases' && request.method === 'POST') {
        const auth = await authenticate(request);
        if (auth.error) return auth.error;
        const parsed = await readBody(request);
        if (parsed.error) return parsed.error;
        const name = clean(parsed.value.name, 80);
        const version = clean(parsed.value.version, 40);
        const owner = clean(parsed.value.owner, 60);
        const targetDate = clean(parsed.value.targetDate, 10);
        if (!name || !VERSION.test(version) || !owner || !validDate(targetDate)) {
          return json({ error: 'Name, valid version, owner, and target date are required.' }, 400);
        }
        const id = randomId();
        const tasks = TEMPLATES[auth.user.template].map((text) => ({
          id: randomId(), text, done: false, createdAt: now(), completedAt: null,
        }));
        const release = {
          id, userId: auth.user.id, name, version, owner, targetDate,
          status: 'planned', archived: false, tasks, notes: [],
          history: [{ action: 'created', at: now() }], createdAt: now(), updatedAt: now(),
        };
        await store.setJSON(`release:${id}`, release);
        auth.user.releaseIds.push(id);
        await store.setJSON(`user:${auth.user.id}`, auth.user);
        await bump('releasesCreated');
        return json({ release: safeRelease(release) }, 201);
      }
      if (path === '/api/releases' && request.method === 'GET') {
        const auth = await authenticate(request);
        if (auth.error) return auth.error;
        const includeArchived = url.searchParams.get('include') === 'archived';
        const releases = [];
        for (const id of auth.user.releaseIds) {
          const release = await store.get(`release:${id}`, { type: 'json' });
          if (release && release.userId === auth.user.id && (includeArchived || !release.archived)) releases.push(safeRelease(release));
        }
        releases.sort((a, b) => a.targetDate.localeCompare(b.targetDate) || b.updatedAt.localeCompare(a.updatedAt));
        return json({ releases });
      }

      const actionMatch = path.match(/^\/api\/releases\/([a-f0-9-]{36})\/actions$/);
      if (actionMatch && request.method === 'POST') {
        const auth = await authenticate(request);
        if (auth.error) return auth.error;
        const release = await ownedRelease(store, actionMatch[1], auth.user.id);
        if (!release) return json({ error: 'Release not found.' }, 404);
        const parsed = await readBody(request, 2_000);
        if (parsed.error) return parsed.error;
        const transitions = {
          start: { from: 'planned', to: 'running', event: 'started' },
          'mark-ready': { from: 'running', to: 'ready', event: 'marked-ready' },
          'mark-shipped': { from: 'ready', to: 'shipped', event: 'shipped' },
        };
        const transition = transitions[parsed.value.action];
        if (!transition || release.status !== transition.from || release.archived) return json({ error: 'That lifecycle action is not available.' }, 409);
        if (parsed.value.action === 'mark-ready' && release.tasks.some((task) => !task.done)) {
          return json({ error: 'Complete every task before marking this release ready.' }, 409);
        }
        release.status = transition.to;
        release.history.push({ action: transition.event, at: now() });
        await persistRelease(release);
        await bump('releasesAdvanced');
        if (!auth.user.activated) {
          auth.user.activated = true;
          await store.setJSON(`user:${auth.user.id}`, auth.user);
          await bump('activatedWorkspaces');
        }
        return json({ release: safeRelease(release) });
      }

      const taskMatch = path.match(/^\/api\/releases\/([a-f0-9-]{36})\/tasks(?:\/([a-f0-9-]{36}))?$/);
      if (taskMatch) {
        const auth = await authenticate(request);
        if (auth.error) return auth.error;
        const release = await ownedRelease(store, taskMatch[1], auth.user.id);
        if (!release) return json({ error: 'Release not found.' }, 404);
        if (release.archived) return json({ error: 'Archived releases are read-only.' }, 409);
        if (release.status === 'ready' || release.status === 'shipped') return json({ error: 'Ready and shipped checklists are locked.' }, 409);
        if (!taskMatch[2] && request.method === 'POST') {
          const parsed = await readBody(request, 2_000);
          if (parsed.error) return parsed.error;
          const text = clean(parsed.value.text, 160);
          if (!text) return json({ error: 'Task text is required.' }, 400);
          const task = { id: randomId(), text, done: false, createdAt: now(), completedAt: null };
          release.tasks.push(task);
          release.history.push({ action: 'task-added', label: text, at: now() });
          await persistRelease(release);
          return json({ release: safeRelease(release) }, 201);
        }
        const task = release.tasks.find((item) => item.id === taskMatch[2]);
        if (!task) return json({ error: 'Task not found.' }, 404);
        if (request.method === 'PATCH') {
          const parsed = await readBody(request, 1_000);
          if (parsed.error) return parsed.error;
          if (typeof parsed.value.done !== 'boolean') return json({ error: 'Task state must be true or false.' }, 400);
          task.done = parsed.value.done;
          task.completedAt = task.done ? now() : null;
          release.history.push({ action: task.done ? 'task-completed' : 'task-reopened', label: task.text, at: now() });
          await persistRelease(release);
          return json({ release: safeRelease(release) });
        }
        if (request.method === 'DELETE') {
          release.tasks = release.tasks.filter((item) => item.id !== task.id);
          release.history.push({ action: 'task-deleted', label: task.text, at: now() });
          await persistRelease(release);
          return json({ release: safeRelease(release) });
        }
      }

      const notesMatch = path.match(/^\/api\/releases\/([a-f0-9-]{36})\/notes$/);
      if (notesMatch && request.method === 'POST') {
        const auth = await authenticate(request);
        if (auth.error) return auth.error;
        const release = await ownedRelease(store, notesMatch[1], auth.user.id);
        if (!release) return json({ error: 'Release not found.' }, 404);
        if (release.archived) return json({ error: 'Archived releases are read-only.' }, 409);
        const parsed = await readBody(request, 3_000);
        if (parsed.error) return parsed.error;
        const text = clean(parsed.value.text, 500);
        if (!text) return json({ error: 'Note text is required.' }, 400);
        release.notes.push({ id: randomId(), text, at: now() });
        release.history.push({ action: 'note-added', at: now() });
        await persistRelease(release);
        return json({ release: safeRelease(release) }, 201);
      }

      const releaseMatch = path.match(/^\/api\/releases\/([a-f0-9-]{36})$/);
      if (releaseMatch) {
        const auth = await authenticate(request);
        if (auth.error) return auth.error;
        const release = await ownedRelease(store, releaseMatch[1], auth.user.id);
        if (!release) return json({ error: 'Release not found.' }, 404);
        if (request.method === 'GET') return json({ release: safeRelease(release) });
        if (request.method === 'PATCH') {
          if (release.archived) return json({ error: 'Archived releases are read-only.' }, 409);
          const parsed = await readBody(request);
          if (parsed.error) return parsed.error;
          const name = clean(parsed.value.name, 80);
          const version = clean(parsed.value.version, 40);
          const owner = clean(parsed.value.owner, 60);
          const targetDate = clean(parsed.value.targetDate, 10);
          if (!name || !VERSION.test(version) || !owner || !validDate(targetDate)) return json({ error: 'Name, valid version, owner, and target date are required.' }, 400);
          Object.assign(release, { name, version, owner, targetDate });
          release.history.push({ action: 'edited', at: now() });
          await persistRelease(release);
          return json({ release: safeRelease(release) });
        }
        if (request.method === 'DELETE') {
          if (!release.archived) {
            release.archived = true;
            release.history.push({ action: 'archived', at: now() });
            await persistRelease(release);
          }
          return json({ release: safeRelease(release) });
        }
      }

      return json({ error: 'Not found.' }, 404);
    } catch {
      return json({ error: 'Temporary server error.' }, 500, { 'retry-after': '5' });
    }
  };
}
