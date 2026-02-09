#!/usr/bin/env node
/**
 * Publishes @babylonjs/* packages to GitHub Packages under the @marns scope.
 *
 * For each package:
 *  1. Reads package.json
 *  2. Renames @babylonjs/X -> @marns/babylonjs-X
 *  3. Sets version to {upstream_version}-fork.{git_short_sha}
 *  4. Rewrites peer/dev/dependencies referencing @babylonjs/* -> @marns/babylonjs-*
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

// Packages to publish (necessary only)
const PACKAGES = [
    'packages/public/@babylonjs/core',
    'packages/public/@babylonjs/gui',
    'packages/public/@babylonjs/loaders',
    'packages/public/@babylonjs/serializers',
    'packages/public/@babylonjs/materials',
    'packages/public/@babylonjs/addons',
    'packages/public/@babylonjs/inspector-v2',
];

// Set of @babylonjs package names we actually publish
const PUBLISHED_NAMES = new Set([
    '@babylonjs/core',
    '@babylonjs/gui',
    '@babylonjs/loaders',
    '@babylonjs/serializers',
    '@babylonjs/materials',
    '@babylonjs/addons',
    '@babylonjs/inspector',
]);

function renamePkg(name) {
    if (!name.startsWith('@babylonjs/')) return name;
    const suffix = name.replace('@babylonjs/', '');
    return `@marns/babylonjs-${suffix}`;
}

function rewriteDeps(deps) {
    if (!deps) return deps;
    const result = {};
    for (const [key, value] of Object.entries(deps)) {
        if (PUBLISHED_NAMES.has(key)) {
            // Only rewrite deps we actually publish under @marns
            result[renamePkg(key)] = '*';
        } else {
            // Keep unpublished @babylonjs/* deps as-is (they're optional peers)
            result[key] = value;
        }
    }
    return result;
}

let failures = 0;

for (const pkgDir of PACKAGES) {
    const fullDir = resolve(ROOT, pkgDir);
    const pkgPath = resolve(fullDir, 'package.json');

    if (!existsSync(pkgPath)) {
        console.warn(`Skipping ${pkgDir}: package.json not found`);
        continue;
    }

    const original = readFileSync(pkgPath, 'utf-8');
    const pkg = JSON.parse(original);

    const originalName = pkg.name;
    const newName = renamePkg(pkg.name);
    const newVersion = `${pkg.version}-fork.${SHORT_SHA}`;

    // Rewrite package.json
    pkg.name = newName;
    pkg.version = newVersion;
    pkg.publishConfig = { registry: 'https://npm.pkg.github.com' };

    // GitHub Packages requires a repository field matching the repo
    pkg.repository = {
        type: 'git',
        url: 'https://github.com/marns/Babylon.js.git',
    };

    if (pkg.peerDependencies) {
        pkg.peerDependencies = rewriteDeps(pkg.peerDependencies);
    }
    if (pkg.devDependencies) {
        pkg.devDependencies = rewriteDeps(pkg.devDependencies);
    }
    if (pkg.dependencies) {
        pkg.dependencies = rewriteDeps(pkg.dependencies);
    }

    // Remove scripts to avoid lifecycle issues during publish
    delete pkg.scripts;
    // Remove private flag if set
    delete pkg.private;

    writeFileSync(pkgPath, JSON.stringify(pkg, null, 4) + '\n');

    try {
        console.log(`Publishing ${newName}@${newVersion} (from ${originalName})...`);
        execSync('npm publish --access public', {
            cwd: fullDir,
            stdio: 'inherit',
        });
        console.log(`  Published successfully.`);
    } catch (e) {
        console.error(`  Failed to publish ${newName}@${newVersion}`);
        failures++;
    } finally {
        // Restore original package.json
        writeFileSync(pkgPath, original);
    }
}

if (failures > 0) {
    console.error(`\n${failures} package(s) failed to publish.`);
    process.exit(1);
}

console.log('\nAll packages published successfully.');
