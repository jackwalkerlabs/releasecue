import { copyFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const assets = ['index.html', 'styles.css', 'app.js', '_redirects', '_headers'];
export async function build(output = join(root, 'dist')) {
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  await Promise.all(assets.map((asset) => copyFile(join(root, 'public', asset), join(output, asset))));
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await build();
  console.log(`Built ${assets.length} public assets.`);
}
