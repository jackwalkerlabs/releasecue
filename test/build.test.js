import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('client ships onboarding, persistent dashboard, and release action surfaces with recovery states', async () => {
  const [html, app, config] = await Promise.all([
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../netlify.toml', import.meta.url), 'utf8'),
  ]);
  for (const id of ['auth-surface', 'dashboard-surface', 'detail-surface', 'dashboard-loading', 'dashboard-empty', 'dashboard-error', 'detail-loading', 'detail-error']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  for (const capability of ['/api/releases', '/tasks', '/notes', '/actions', '/api/intent']) assert.match(app, new RegExp(capability.replaceAll('/', '\\/')));
  assert.doesNotMatch(app, /\.innerHTML\s*=/);
  assert.match(config, /Content-Security-Policy/);
  assert.match(config, /\/releases\/\*/);
});
