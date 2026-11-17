// Spec section 13: every requirement ID in section 3 needs at least one automated test.
// Lists each ID with the test files that name it; fails when an ID has none. Ranges such as
// "DTM-1 to DTM-6" in a test name count for every ID inside them.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const spec = readFileSync(join(root, 'docs/SPEC.md'), 'utf8');
const section3 = spec.slice(spec.indexOf('## 3. Functional requirements'), spec.indexOf('## 4.'));
const ids = [...new Set([...section3.matchAll(/^\| ([A-Z]+-\d+) \|/gm)].map((m) => m[1]))];

const TEST_DIRS = ['apps/api/test', 'apps/api/src', 'apps/web/e2e', 'apps/web/src', 'packages'];
const isTest = (f) => /\.test\.tsx?$|e2e\/.*\.cjs$/.test(f);
function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'generated') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (isTest(relative(root, path))) yield path;
  }
}

const covered = new Map(ids.map((id) => [id, new Set()]));
for (const dir of TEST_DIRS) {
  for (const file of walk(join(root, dir))) {
    const text = readFileSync(file, 'utf8');
    const rel = relative(root, file);
    for (const m of text.matchAll(/\b([A-Z]+)-(\d+) to \1-(\d+)\b/g)) {
      for (let n = Number(m[2]); n <= Number(m[3]); n += 1) covered.get(`${m[1]}-${n}`)?.add(rel);
    }
    for (const m of text.matchAll(/\b([A-Z]+-\d+)\b/g)) covered.get(m[1])?.add(rel);
  }
}

const missing = ids.filter((id) => covered.get(id).size === 0);
if (process.argv.includes('--list')) {
  for (const id of ids) console.log(id.padEnd(8), [...covered.get(id)].join(', ') || 'NO TEST');
}
console.log(`${ids.length - missing.length} of ${ids.length} requirement IDs have tests.`);
if (missing.length) {
  console.error(`Missing tests for: ${missing.join(', ')}`);
  process.exit(1);
}
