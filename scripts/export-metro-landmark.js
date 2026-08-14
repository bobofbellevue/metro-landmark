#!/usr/bin/env node
/* eslint-env node */
/**
 * Workstream 4.1 — Clean Metro Landmark export snapshot (no git history).
 *
 * Usage:
 *   node scripts/export-metro-landmark.js
 *   node scripts/export-metro-landmark.js --out /tmp/metro-landmark-export
 *   npm run export:metro
 *
 * Produces a directory Bob can `git init` and push to public `metro-landmark`.
 * Honors docs/EXPORT_DENY_LIST.md via scripts/export-metro-deny.js.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REQUIRE_PRESENT,
  shouldDenyExportPath,
} from './export-metro-deny.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const outIdx = argv.indexOf('--out');
  const out =
    outIdx >= 0 && argv[outIdx + 1]
      ? path.resolve(argv[outIdx + 1])
      : path.resolve('/tmp/metro-landmark-export');
  const dryRun = argv.includes('--dry-run');
  return { out, dryRun };
}

function walkFiles(dir, baseRel = '') {
  /** @type {string[]} */
  const files = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const ent of entries) {
    const rel = baseRel ? `${baseRel}/${ent.name}` : ent.name;
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (shouldDenyExportPath(rel)) continue;
      files.push(...walkFiles(abs, rel));
    } else if (ent.isFile() || ent.isSymbolicLink()) {
      files.push(rel.replace(/\\/g, '/'));
    }
  }
  return files;
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function copyFile(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function transformPackageJson(pkgPath) {
  const raw = fs.readFileSync(pkgPath, 'utf8');
  const pkg = JSON.parse(raw);
  pkg.name = 'metro-landmark';
  // App package — keep private so npm publish is not implied
  pkg.private = true;
  pkg.license = 'MIT';
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, '\t')}\n`);
}

function writeHandoff(outDir, stats) {
  const handoff = `# Metro Landmark export handoff

Generated: ${new Date().toISOString()}
Source: Salish Landmark (private) → clean snapshot (no \`.git\` history)
Output: \`${outDir}\`

## What this folder is

A **directory snapshot** ready for:

\`\`\`bash
cd ${outDir}
git init
git add .
git commit -m "Initial public commit — Metro Landmark"
# Create empty public repo metro-landmark on your GitHub, then:
git branch -M main
git remote add origin git@github.com:<YOU>/metro-landmark.git
git push -u origin main
\`\`\`

Then verify a **fresh clone** boots (Workstream 4.3) and archive Salish Landmark (4.4).

## Export stats

- Files copied: ${stats.copied}
- Paths denied: ${stats.denied}
- Package name set to: \`metro-landmark\`

## Denied categories (see private \`docs/EXPORT_DENY_LIST.md\` in Salish)

Secrets/env dumps, PII samples, internal transition docs, agent prompts,
Michigan/out-of-jurisdiction samples, \`node_modules\`, \`.git\`, IDE scaffolding.

## After push (Bob)

1. Create public GitHub repo **\`metro-landmark\`** (empty, no README if pushing existing tree).
2. Push this snapshot as the initial commit (commands above).
3. Clone to a clean directory: \`git clone … && cd metro-landmark && npm install\`.
4. Copy \`.db-environments.example.json\` → \`.db-environments.json\`, fill keys, \`npm run env:select\`, \`npm run dev:full\`.
5. When satisfied, **Archive** the Salish Landmark GitHub repo.

## Note

This handoff file is written only into the export output (not required in the public tree long-term; delete before commit if you prefer a pristine root).
`;
  fs.writeFileSync(path.join(outDir, 'EXPORT_HANDOFF.md'), handoff);
}

function verifyExport(outDir) {
  const problems = [];
  for (const req of REQUIRE_PRESENT) {
    const p = path.join(outDir, req);
    if (!fs.existsSync(p)) {
      problems.push(`missing required: ${req}`);
    }
  }

  // Walk export and ensure deny paths did not sneak in
  const exported = walkFiles(outDir);
  for (const rel of exported) {
    // EXPORT_HANDOFF is intentional in output only
    if (rel === 'EXPORT_HANDOFF.md') continue;
    if (shouldDenyExportPath(rel)) {
      problems.push(`denied path present in export: ${rel}`);
    }
  }

  const pkg = JSON.parse(
    fs.readFileSync(path.join(outDir, 'package.json'), 'utf8')
  );
  if (pkg.name !== 'metro-landmark') {
    problems.push(`package.json name is "${pkg.name}", expected metro-landmark`);
  }

  return problems;
}

function main() {
  const { out, dryRun } = parseArgs(process.argv.slice(2));
  console.log(`[export:metro] source: ${REPO_ROOT}`);
  console.log(`[export:metro] output: ${out}${dryRun ? ' (dry-run)' : ''}`);

  const allRel = walkFiles(REPO_ROOT);
  const toCopy = [];
  const denied = [];
  for (const rel of allRel) {
    if (shouldDenyExportPath(rel)) {
      denied.push(rel);
    } else {
      toCopy.push(rel);
    }
  }

  console.log(
    `[export:metro] candidates=${allRel.length} copy=${toCopy.length} deny=${denied.length}`
  );

  if (dryRun) {
    console.log('[export:metro] sample denied:');
    for (const d of denied.slice(0, 25)) console.log(`  - ${d}`);
    if (denied.length > 25) console.log(`  … ${denied.length - 25} more`);
    process.exit(0);
  }

  if (fs.existsSync(out)) {
    fs.rmSync(out, { recursive: true, force: true });
  }
  ensureDir(out);

  for (const rel of toCopy) {
    const src = path.join(REPO_ROOT, rel);
    const dest = path.join(out, rel);
    copyFile(src, dest);
  }

  transformPackageJson(path.join(out, 'package.json'));
  writeHandoff(out, { copied: toCopy.length, denied: denied.length });

  // Add a short templates provenance note if templates exist
  const templatesDir = path.join(out, 'public', 'templates');
  if (fs.existsSync(templatesDir)) {
    const note = `# Template provenance

Blank / standard form templates under this directory are included for the
Washington reference deployment. Confirm redistribution rights for any
third-party forms (e.g. NWMLS) before commercial redistribution.
`;
    fs.writeFileSync(path.join(templatesDir, 'PROVENANCE.md'), note);
  }

  const problems = verifyExport(out);
  if (problems.length) {
    console.error('[export:metro] verification FAILED:');
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }

  console.log('[export:metro] OK');
  console.log(`[export:metro] files copied: ${toCopy.length}`);
  console.log(`[export:metro] handoff: ${path.join(out, 'EXPORT_HANDOFF.md')}`);
  console.log('[export:metro] next: Bob creates public metro-landmark and pushes (see handoff)');
}

main();
