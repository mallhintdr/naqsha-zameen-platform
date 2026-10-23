#!/usr/bin/env node
/**
 * Raises the app version by one step, each part rolling over at 9:
 *   5.0.0 -> 5.0.1 ... 5.1.9 -> 5.2.0 ... 5.9.9 -> 6.0.0
 * Updates frontend/package.json (the version shown in the app) and the root package.json.
 *
 *   node scripts/bump-version.mjs           bump and write
 *   node scripts/bump-version.mjs --dry     print the next version only
 *   node scripts/bump-version.mjs 5.1.9     print the version after 5.1.9 (no write)
 *
 * Runs automatically on every commit via .githooks/pre-commit (enable once per clone with
 * `npm run setup-hooks`). Skip for one commit with: SKIP_VERSION_BUMP=1 git commit ...
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function nextVersion(version) {
  const m = String(version).trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) throw new Error(`Version "${version}" is not in the form X.Y.Z`);
  let [major, minor, patch] = m.slice(1).map(Number);
  // Parts above 9 (e.g. from an older scheme) are normalised by the same carry rule.
  patch += 1;
  if (patch > 9) { patch = 0; minor += 1; }
  if (minor > 9) { minor = 0; major += 1; }
  return `${major}.${minor}.${patch}`;
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILES = ['frontend/package.json', 'package.json'];

function main(argv) {
  const arg = argv[2];
  if (arg && /^\d+\.\d+\.\d+$/.test(arg)) {
    console.log(nextVersion(arg));
    return;
  }
  const main = path.join(root, FILES[0]);
  const current = JSON.parse(fs.readFileSync(main, 'utf8')).version;
  const next = nextVersion(current);
  if (arg === '--dry') {
    console.log(next);
    return;
  }
  for (const rel of FILES) {
    const file = path.join(root, rel);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    // Replace only the top-level "version" value, keeping the file's formatting.
    const updated = text.replace(/("version"\s*:\s*")[^"]*(")/, `$1${next}$2`);
    fs.writeFileSync(file, updated);
  }
  console.log(`version ${current} -> ${next}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv);
