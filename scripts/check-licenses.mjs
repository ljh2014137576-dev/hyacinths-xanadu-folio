import { readFile } from 'node:fs/promises';

const lockfile = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));
const allowed = new Set(['0BSD', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'BlueOak-1.0.0', 'CC0-1.0', 'ISC', 'MIT', 'MIT-0', 'MPL-2.0']);
const packages = Object.entries(lockfile.packages).filter(([path]) => path.length > 0);
const missing = packages.filter(([, value]) => typeof value.license !== 'string');
const unsupported = packages.filter(([, value]) => typeof value.license === 'string' && !allowed.has(value.license));
if (missing.length > 0 || unsupported.length > 0) {
  console.error(`License gate failed: ${missing.length} missing, ${unsupported.length} outside review allowlist.`);
  process.exitCode = 1;
} else {
  const summary = [...new Set(packages.map(([, value]) => value.license))].sort();
  console.log(`License gate passed for ${packages.length} locked packages: ${summary.join(', ')}`);
}
