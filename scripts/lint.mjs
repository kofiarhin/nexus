import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { extname, join } from 'node:path';
import { transformWithOxc } from 'vite';

const SYNTAX_EXTENSIONS = ['.js', '.mjs'];
const JSX_EXTENSIONS = ['.jsx'];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if ([...SYNTAX_EXTENSIONS, ...JSX_EXTENSIONS].includes(extname(entry.name))) files.push(path);
  }
  return files;
}

const files = (await Promise.all(['server', 'client', 'tests', 'scripts'].map(walk))).flat();
let checked = 0;

for (const file of files) {
  if (JSX_EXTENSIONS.includes(extname(file))) {
    // JSX is parsed through Vite's own transform, so the check matches what the
    // client build will accept.
    try {
      await transformWithOxc(await readFile(file, 'utf8'), file);
    } catch (error) {
      console.error(`Syntax error in ${file}:`);
      console.error(error.message);
      process.exit(1);
    }
  } else {
    const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
  checked += 1;
}

console.log(`Checked ${checked} JavaScript and JSX files.`);
