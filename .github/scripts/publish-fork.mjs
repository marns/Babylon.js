#!/usr/bin/env node
/**
 * Publishes the @babylonjs/inspector package to GitHub Packages as @marns/babylonjs-inspector.
 *
 * Steps:
 *  1. Reads inspector-v2 package.json
 *  2. Renames @babylonjs/inspector -> @marns/babylonjs-inspector
 *  3. Sets version to {upstream_version}-fork.{git_short_sha}
 *  4. Keeps @babylonjs/* peer deps as-is (they resolve from npm)
 *  5. Adds publishConfig for GitHub Packages registry
 *  6. Runs npm publish
 *  7. Restores original package.json
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const SHORT_SHA = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim();

const INSPECTOR_DIR = resolve(ROOT, 'packages/public/@babylonjs/inspector-v2');
const pkgPath = resolve(INSPECTOR_DIR, 'package.json');

if (!existsSync(pkgPath)) {
    console.error('inspector-v2 package.json not found');
    process.exit(1);
}

const original = readFileSync(pkgPath, 'utf-8');
const pkg = JSON.parse(original);

const newName = '@marns/babylonjs-inspector';
const newVersion = `${pkg.version}-fork.${SHORT_SHA}`;

// Rewrite package identity
pkg.name = newName;
pkg.version = newVersion;
pkg.publishConfig = { registry: 'https://npm.pkg.github.com' };
pkg.repository = {
    type: 'git',
    url: 'https://github.com/marns/Babylon.js.git',
};

// Keep all @babylonjs/* peer deps as-is — consumers get them from npm
// Remove scripts and private flag
delete pkg.scripts;
delete pkg.private;

writeFileSync(pkgPath, JSON.stringify(pkg, null, 4) + '\n');

try {
    console.log(`Publishing ${newName}@${newVersion}...`);
    execSync('npm publish --access public', {
        cwd: INSPECTOR_DIR,
        stdio: 'inherit',
    });
    console.log('Published successfully.');
} catch (e) {
    console.error(`Failed to publish ${newName}@${newVersion}`);
    writeFileSync(pkgPath, original);
    process.exit(1);
}

// Restore original package.json
writeFileSync(pkgPath, original);
console.log('Done.');
