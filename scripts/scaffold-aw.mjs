#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const options = new Set(args.filter((arg) => arg.startsWith('--')));
const targetArg = args.find((arg) => !arg.startsWith('--'));

if (options.has('--help') || options.has('-h')) {
  console.log('Usage: npm run scaffold:aw -- <empty-directory> [--no-install] [--no-git]');
  process.exit(0);
}
if (!targetArg) {
  console.error('Choose an empty destination directory: npm run scaffold:aw -- <directory>');
  process.exit(1);
}

const node = process.versions.node.split('.').map(Number);
if (node[0] < 22 || (node[0] === 22 && node[1] < 12)) {
  console.error(`Node ${process.versions.node} is too old; use Node 22.12 or later.`);
  process.exit(1);
}

const dirty = execFileSync('git', ['status', '--porcelain'], {
  cwd: root,
  encoding: 'utf8',
}).trim();
if (dirty) {
  console.error('The kit working tree is not clean. Commit or discard kit changes before scaffolding so the site is pinned to the exact script/template commit.');
  process.exit(1);
}

const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const kitPackage = JSON.parse(readFileSync(join(root, 'create/package.json'), 'utf8'));
const tracked = execFileSync('git', ['ls-files', '-z', '--', 'template'], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
}).split('\0').filter(Boolean);
if (!tracked.length) {
  console.error('git reports no tracked template files; refusing to scaffold an unpinned working tree.');
  process.exit(1);
}

const dest = resolve(process.cwd(), targetArg);
const relFromRoot = relative(root, dest);
if (relFromRoot === '' || (!relFromRoot.startsWith(`..${sep}`) && relFromRoot !== '..' && !/^[A-Za-z]:/.test(relFromRoot))) {
  console.error('Choose a destination outside the kit repository.');
  process.exit(1);
}
if (existsSync(dest) && readdirSync(dest).length > 0) {
  console.error(`${targetArg} is not empty; refusing to overwrite an existing project.`);
  process.exit(1);
}

mkdirSync(dest, { recursive: true });
for (const rel of tracked) {
  const parts = rel.split('/');
  const target = join(dest, ...parts.slice(1));
  mkdirSync(dirname(target), { recursive: true });
  cpSync(join(root, ...parts), target);
}

const required = ['.gitignore', 'package-lock.json', 'scripts/build.mjs', 'aw-migration.json'];
const missing = required.filter((file) => !existsSync(join(dest, file)));
if (missing.length) {
  console.error(`Scaffold is incomplete; missing ${missing.join(', ')}.`);
  process.exit(1);
}

const packagePath = join(dest, 'package.json');
const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));
pkg.name = basename(dest).replace(/[^a-z0-9-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'aw-site';
pkg.websiteBuildKit = {
  repository: 'https://github.com/The-AW/website-build-kit',
  commit,
  version: kitPackage.version,
  scaffolded: new Date().toISOString().slice(0, 10),
};
writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);

if (!options.has('--no-git')) {
  execFileSync('git', ['init', '-q'], { cwd: dest, stdio: 'ignore' });
  execFileSync('git', ['add', '-A'], { cwd: dest, stdio: 'ignore' });
}

console.log(`AW site scaffolded from ${commit.slice(0, 12)} into ${targetArg}.`);
console.log('Included: tracked template files, copied scripts, package-lock.json and .gitignore.');
console.log('Edit aw-migration.json before any deploy; the starter is static and has no contact runtime or KV binding.');

if (!options.has('--no-install')) {
  const install = spawnSync('npm', ['ci'], { cwd: dest, stdio: 'inherit', shell: process.platform === 'win32' });
  if (install.status !== 0) {
    console.error('Files are scaffolded, but npm ci failed. Resolve the install error, then run npm ci in the site directory.');
    process.exit(install.status ?? 1);
  }
}
