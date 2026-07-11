const $ = (selector) => document.querySelector(selector);
const state = { user: null, releases: [], release: null, includeArchived: false };

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } });
  let body = {};
  try { body = await response.json(); } catch { body = { error: 'Invalid server response.' }; }
  if (!response.ok) {
    const error = new Error(body.error || 'Request failed.');
    error.status = response.status;
    throw error;
  }
  return body;
}
function visitorId() {
  let id = localStorage.getItem('rc_visitor');
  if (!id) { id = crypto.randomUUID(); localStorage.setItem('rc_visitor', id); }
  return id;
}
api('/api/visit', { method: 'POST', body: JSON.stringify({ visitorId: visitorId() }) }).catch(() => {});

function el(tag, text = '', className = '') {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}
function message(target, text, good = false) {
  target.textContent = text;
  target.style.color = good ? 'var(--mint)' : '';
}
function formData(form) { return Object.fromEntries(new FormData(form).entries()); }
function showSurface(name) {
  $('#auth-surface').hidden = name !== 'auth';
  $('#dashboard-surface').hidden = name !== 'dashboard';
  $('#detail-surface').hidden = name !== 'detail';
  $('#logout').hidden = name === 'auth';
}
function go(path) { history.pushState({}, '', path); route(); }
function today() { return new Date().toISOString().slice(0, 10); }
function defaultTarget() {
  const date = new Date(); date.setDate(date.getDate() + 7); return date.toISOString().slice(0, 10);
}

function renderStats() {
  const active = state.releases.filter((release) => !release.archived);
  const values = [
    [active.length, 'active runs'],
    [active.filter((release) => release.status === 'running').length, 'running'],
    [active.filter((release) => release.status !== 'shipped' && release.targetDate < today()).length, 'past target'],
    [active.filter((release) => release.status === 'shipped').length, 'shipped'],
  ];
  $('#dashboard-stats').replaceChildren(...values.map(([value, label]) => {
    const box = el('div', '', 'stat'); box.append(el('strong', String(value)), el('span', label)); return box;
  }));
}
function releaseRow(release) {
  const row = el('article', '', 'release-row');
  const open = el('button'); open.type = 'button';
  open.append(el('strong', release.name), el('code', release.version));
  open.addEventListener('click', () => go(`/releases/${release.id}`));
  const owner = el('span', release.owner);
  const due = el('span', release.targetDate, release.targetDate < today() && release.status !== 'shipped' ? 'overdue' : '');
  row.append(open, owner, due, el('span', release.archived ? 'archived' : release.status, 'pill'));
  return row;
}
async function loadDashboard() {
  showSurface('dashboard');
  $('#workspace-title').textContent = state.user.workspaceName;
  $('#dashboard-loading').hidden = false; $('#dashboard-error').hidden = true; $('#dashboard-empty').hidden = true; $('#release-list').hidden = true;
  try {
    const suffix = state.includeArchived ? '?include=archived' : '';
    state.releases = (await api(`/api/releases${suffix}`)).releases;
    $('#dashboard-loading').hidden = true; renderStats();
    if (!state.releases.length) $('#dashboard-empty').hidden = false;
    else { $('#release-list').replaceChildren(...state.releases.map(releaseRow)); $('#release-list').hidden = false; }
  } catch (error) {
    if (error.status === 401) return signOutView();
    $('#dashboard-loading').hidden = true; $('#dashboard-error').hidden = false;
  }
}

const actionCopy = {
  planned: ['Start the release run', 'Move from planning into active execution. This is the measured activation signal.', 'Start run', 'start'],
  running: ['Pass the ready gate', 'Every checklist task must be complete before this release can become ready.', 'Mark ready', 'mark-ready'],
  ready: ['Confirm the release shipped', 'Use this only after the release is live and verification is complete.', 'Mark shipped', 'mark-shipped'],
  shipped: ['Release complete', 'The run remains in history. Archive it when the active queue no longer needs it.', 'Shipped', ''],
};
function renderTasks(release) {
  const done = release.tasks.filter((task) => task.done).length;
  const checklistLocked = release.archived || release.status === 'ready' || release.status === 'shipped';
  $('#task-count').textContent = `${done}/${release.tasks.length} done`;
  $('#task-progress').textContent = `${done} of ${release.tasks.length} release tasks complete`;
  $('#task-progress-bar').style.width = release.tasks.length ? `${Math.round(done / release.tasks.length * 100)}%` : '100%';
  $('#task-list').replaceChildren(...release.tasks.map((task) => {
    const row = el('div', '', `task-row${task.done ? ' done' : ''}`);
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = task.done; checkbox.disabled = release.archived;
    checkbox.setAttribute('aria-label', `${task.done ? 'Reopen' : 'Complete'} ${task.text}`); checkbox.disabled = checklistLocked;
    checkbox.addEventListener('change', async () => {
      checkbox.disabled = true; message($('#task-message'), 'Updating task…');
      try {
        const result = await api(`/api/releases/${release.id}/tasks/${task.id}`, { method: 'PATCH', body: JSON.stringify({ done: checkbox.checked }) });
        renderDetail(result.release); message($('#task-message'), 'Checklist updated.', true);
      } catch (error) { checkbox.checked = !checkbox.checked; checkbox.disabled = false; message($('#task-message'), `${error.message} Try again.`); }
    });
    const remove = el('button', '×', 'icon-button'); remove.type = 'button'; remove.disabled = checklistLocked; remove.setAttribute('aria-label', `Delete ${task.text}`);
    remove.addEventListener('click', async () => {
      remove.disabled = true;
      try { renderDetail((await api(`/api/releases/${release.id}/tasks/${task.id}`, { method: 'DELETE' })).release); }
      catch (error) { remove.disabled = false; message($('#task-message'), `${error.message} Try again.`); }
    });
    row.append(checkbox, el('span', task.text), remove); return row;
  }));
}
function renderNotes(release) {
  const nodes = [...release.notes].reverse().map((note) => {
    const item = el('li'); item.append(el('time', new Date(note.at).toLocaleString()), el('span', note.text)); return item;
  });
  if (!nodes.length) nodes.push(el('li', 'No decisions logged yet.'));
  $('#note-list').replaceChildren(...nodes);
}
function renderHistory(release) {
  $('#history-list').replaceChildren(...[...release.history].reverse().map((event) => {
    const item = el('li');
    const label = `${event.action.replaceAll('-', ' ')}${event.label ? ` · ${event.label}` : ''}`;
    item.append(el('time', new Date(event.at).toLocaleString()), el('span', label)); return item;
  }));
}
function renderDetail(release) {
  state.release = release;
  $('#detail-version').textContent = release.version;
  $('#detail-name').textContent = release.name;
  $('#detail-meta').textContent = `${release.owner} owns this run · target ${release.targetDate}`;
  $('#detail-status').textContent = release.archived ? 'archived' : release.status;
  const [title, copy, buttonText, action] = actionCopy[release.status];
  $('#action-title').textContent = title; $('#action-copy').textContent = copy;
  const actionButton = $('#lifecycle-action'); actionButton.textContent = buttonText; actionButton.dataset.action = action; actionButton.disabled = !action || release.archived;
  const editForm = $('#edit-release-form');
  for (const key of ['name', 'version', 'owner', 'targetDate']) editForm.elements[key].value = release[key] || '';
  for (const control of editForm.elements) control.disabled = release.archived;
  $('#archive-release').disabled = release.archived;
  const checklistLocked = release.archived || release.status === 'ready' || release.status === 'shipped';
  for (const control of $('#add-task-form').elements) control.disabled = checklistLocked;
  for (const control of $('#add-note-form').elements) control.disabled = release.archived;
  renderTasks(release); renderNotes(release); renderHistory(release);
  $('#detail-loading').hidden = true; $('#detail-error').hidden = true; $('#detail-content').hidden = false;
}
async function loadDetail(id) {
  showSurface('detail'); $('#detail-loading').hidden = false; $('#detail-error').hidden = true; $('#detail-content').hidden = true;
  try { renderDetail((await api(`/api/releases/${id}`)).release); }
  catch (error) {
    if (error.status === 401) return signOutView();
    $('#detail-loading').hidden = true; $('#detail-error').hidden = false;
  }
}
function signOutView() {
  state.user = null; state.releases = []; state.release = null; history.replaceState({}, '', '/'); showSurface('auth');
}
async function route() {
  if (!state.user) return showSurface('auth');
  const match = location.pathname.match(/^\/releases\/([a-f0-9-]{36})$/);
  if (match) return loadDetail(match[1]);
  if (location.pathname !== '/app') history.replaceState({}, '', '/app');
  return loadDashboard();
}
function setAuthMode(mode) {
  $('#register-form').hidden = mode !== 'register'; $('#login-form').hidden = mode !== 'login';
  $('#show-register').classList.toggle('active', mode === 'register'); $('#show-login').classList.toggle('active', mode === 'login'); message($('#auth-message'), '');
}
$('#show-register').addEventListener('click', () => setAuthMode('register'));
$('#show-login').addEventListener('click', () => setAuthMode('login'));
$('#register-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const button = event.currentTarget.querySelector('button[type="submit"]'); button.disabled = true; message($('#auth-message'), 'Creating private workspace…');
  try { state.user = (await api('/api/register', { method: 'POST', body: JSON.stringify(formData(event.currentTarget)) })).user; go('/app'); }
  catch (error) { message($('#auth-message'), error.message); } finally { button.disabled = false; }
});
$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const button = event.currentTarget.querySelector('button[type="submit"]'); button.disabled = true; message($('#auth-message'), 'Opening workspace…');
  try { state.user = (await api('/api/login', { method: 'POST', body: JSON.stringify(formData(event.currentTarget)) })).user; go('/app'); }
  catch (error) { message($('#auth-message'), error.message); } finally { button.disabled = false; }
});
$('#logout').addEventListener('click', async () => { try { await api('/api/logout', { method: 'POST', body: '{}' }); } catch {} signOutView(); });
$('#create-release-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const form = event.currentTarget; const button = form.querySelector('button[type="submit"]'); button.disabled = true; message($('#create-message'), 'Creating release run…');
  try { const result = await api('/api/releases', { method: 'POST', body: JSON.stringify(formData(form)) }); form.reset(); form.elements.targetDate.value = defaultTarget(); go(`/releases/${result.release.id}`); }
  catch (error) { message($('#create-message'), error.message); } finally { button.disabled = false; }
});
$('#edit-release-form').addEventListener('submit', async (event) => {
  event.preventDefault(); message($('#edit-message'), 'Saving release…');
  try { renderDetail((await api(`/api/releases/${state.release.id}`, { method: 'PATCH', body: JSON.stringify(formData(event.currentTarget)) })).release); message($('#edit-message'), 'Saved.', true); }
  catch (error) { message($('#edit-message'), `${error.message} Try again.`); }
});
$('#lifecycle-action').addEventListener('click', async (event) => {
  const button = event.currentTarget; const action = button.dataset.action; if (!action) return; button.disabled = true; message($('#action-message'), 'Updating lifecycle…');
  try { renderDetail((await api(`/api/releases/${state.release.id}/actions`, { method: 'POST', body: JSON.stringify({ action }) })).release); message($('#action-message'), 'Lifecycle updated.', true); }
  catch (error) { button.disabled = false; message($('#action-message'), `${error.message} Try again.`); }
});
$('#add-task-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const form = event.currentTarget; message($('#task-message'), 'Adding task…');
  try { renderDetail((await api(`/api/releases/${state.release.id}/tasks`, { method: 'POST', body: JSON.stringify(formData(form)) })).release); form.reset(); message($('#task-message'), 'Task added.', true); }
  catch (error) { message($('#task-message'), `${error.message} Try again.`); }
});
$('#add-note-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const form = event.currentTarget; message($('#note-message'), 'Logging note…');
  try { renderDetail((await api(`/api/releases/${state.release.id}/notes`, { method: 'POST', body: JSON.stringify(formData(form)) })).release); form.reset(); message($('#note-message'), 'Decision logged.', true); }
  catch (error) { message($('#note-message'), `${error.message} Try again.`); }
});
$('#archive-release').addEventListener('click', async () => {
  if (!confirm('Archive this release run? Its history remains visible through Show archive.')) return;
  try { await api(`/api/releases/${state.release.id}`, { method: 'DELETE' }); go('/app'); }
  catch (error) { message($('#edit-message'), `${error.message} Try again.`); }
});
$('#pricing-interest').addEventListener('click', async () => {
  const button = $('#pricing-interest'); button.disabled = true;
  try { await api('/api/intent', { method: 'POST', body: JSON.stringify({ kind: 'github-sync-pricing' }) }); button.textContent = 'Interest recorded · no charge'; }
  catch { button.disabled = false; button.textContent = 'Could not record · try again'; }
});
$('#include-archived').addEventListener('change', (event) => { state.includeArchived = event.currentTarget.checked; loadDashboard(); });
$('#retry-dashboard').addEventListener('click', loadDashboard);
$('#retry-detail').addEventListener('click', () => state.release && loadDetail(state.release.id));
$('#back-dashboard').addEventListener('click', () => go('/app'));
window.addEventListener('popstate', route);
$('#create-release-form').elements.targetDate.value = defaultTarget();
(async () => {
  try { state.user = (await api('/api/me')).user; await route(); }
  catch { showSurface('auth'); }
})();
