import { cp, lstat, mkdtemp, readlink, rename, rm, unlink } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkDeploymentArtifact } from './check-deployment-artifact.mjs';

// These are the only aliases observed in ORION's actual standalone Vercel build.
// This is not a general symlink resolver and never follows external targets.
const confirmedAliases = new Set([
  'functions/_global-error.segments/_full.segment.rsc.func',
  'functions/_global-error.segments/_global-error/__PAGE__.segment.rsc.func',
  'functions/_global-error.segments/_tree.segment.rsc.func',
]);
const confirmedTarget = 'functions/_global-error.func';

function within(root, path) {
  const child = relative(root, path);
  return Boolean(child) && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

async function verifyUnlinkedAncestors(path) {
  const ancestors = [];
  for (let cursor = path; ; cursor = dirname(cursor)) {
    ancestors.push(cursor);
    if (dirname(cursor) === cursor) break;
  }
  // Validate from the volume root inward before inspecting a child. In
  // particular, never recurse into a newly introduced Windows junction.
  for (const ancestor of ancestors.reverse()) {
    const stat = await lstat(ancestor);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('An unlinked staging path is required');
  }
}

async function verifyAlias(root, alias) {
  if (!confirmedAliases.has(alias)) throw new Error('Unconfirmed Vercel function alias');
  const path = resolve(root, alias);
  if (!within(root, path) || !(await lstat(path)).isSymbolicLink()) throw new Error('An unchanged internal alias is required');
  const linkText = await readlink(path);
  const targetPath = resolve(dirname(path), linkText);
  if (!within(root, targetPath) || targetPath !== resolve(root, confirmedTarget)) throw new Error('Alias target is not the confirmed internal function');
  // The guard checks all ancestors and files without traversing any junction.
  const target = await checkDeploymentArtifact(targetPath);
  if (!target.safe) throw new Error('The internal function target failed artifact inspection');
  return { alias, path, targetPath, linkText };
}

async function removeOwnedStage(root, stage) {
  if (!within(root, stage) || !basename(stage).startsWith('.orion-materialize-')) throw new Error('Invalid staging cleanup path');
  let stat;
  try { stat = await lstat(stage); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Staging directory changed; cleanup refused');
  await verifyUnlinkedAncestors(stage);
  // This exact directory was created by mkdtemp after root validation. Never
  // delete a build root, function target, caller-supplied path or linked target.
  await rm(stage, { recursive: true });
}

/**
 * Dry-run by default. Apply only to a frozen final build explicitly approved by
 * the owner, then re-run the full profile=vercel artifact guard before upload.
 * @param {string} directory
 * @param {{apply?: boolean}} [options]
 */
export async function materializeVercelFunctionLinks(directory, options = {}) {
  if (typeof directory !== 'string' || !directory.trim()) throw new Error('An explicit Vercel output directory is required');
  if (!options || typeof options !== 'object' || Array.isArray(options) ||
      (options.apply !== undefined && typeof options.apply !== 'boolean')) throw new Error('Apply must be an explicit boolean');
  const root = resolve(directory);
  // The profile rejects other roots, root/ancestor junctions, private artifacts,
  // unknown binaries and credentials. Only the exact three aliases may remain.
  const before = await checkDeploymentArtifact(root, { profile: 'vercel' });
  if (before.findings.some(finding => finding.rule !== 'unresolved-link' || !confirmedAliases.has(finding.path))) {
    throw new Error('Vercel output has findings other than confirmed internal aliases');
  }
  const plan = [];
  for (const finding of before.findings) plan.push(await verifyAlias(root, finding.path));
  const result = { files: before.files, aliases: plan.map(item => item.alias), materialized: 0 };
  if (!options.apply) return result;

  for (const item of plan) {
    const current = await verifyAlias(root, item.alias);
    if (current.linkText !== item.linkText) throw new Error('Alias changed after validation');
    const stagingDirectory = await mkdtemp(join(dirname(item.path), '.orion-materialize-'));
    const stage = join(stagingDirectory, 'function');
    const backup = `${stagingDirectory}.link`;
    let backedUp = false;
    let failure;
    try {
      // Retain links as links, never dereference them. A second full guard on
      // staging refuses any unexpected link or sensitive file introduced since
      // validation before the original alias is touched.
      await cp(item.targetPath, stage, { recursive: true, dereference: false, verbatimSymlinks: true, errorOnExist: true, force: false });
      if (!(await checkDeploymentArtifact(stage)).safe) throw new Error('Staged function failed artifact inspection');
      const unchanged = await verifyAlias(root, item.alias);
      if (unchanged.linkText !== item.linkText) throw new Error('Alias changed during staging');
      await rename(item.path, backup);
      backedUp = true;
      try { await rename(stage, item.path); }
      catch (error) {
        await rename(backup, item.path);
        backedUp = false;
        throw error;
      }
      if (!(await lstat(backup)).isSymbolicLink() || await readlink(backup) !== item.linkText) {
        throw new Error('Alias backup changed; cleanup refused');
      }
      await unlink(backup); // Removes only the original alias, never its target.
      backedUp = false;
      result.materialized += 1;
    } catch (error) {
      failure = error;
    } finally {
      await removeOwnedStage(root, stagingDirectory);
    }
    // A surviving backup causes the full artifact guard to fail closed. Never
    // recursively remove or overwrite anything during an unexpected rollback.
    if (backedUp) throw new Error('Alias backup remains; artifact upload is blocked');
    if (failure) throw failure;
  }
  if (!(await checkDeploymentArtifact(root, { profile: 'vercel' })).safe) throw new Error('Materialized output failed final artifact inspection');
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (![2, 3].includes(args.length) || args[0] !== '--dir' || !args[1] || (args.length === 3 && args[2] !== '--apply')) {
    console.error('Usage: node scripts/materialize-vercel-function-links.mjs --dir <.vercel/output> [--apply]');
    process.exitCode = 2;
  } else {
    try {
      const result = await materializeVercelFunctionLinks(args[1], { apply: args[2] === '--apply' });
      console.log(`Validated ${result.aliases.length} confirmed internal directory aliases; materialized ${result.materialized}. No file content or credential values are printed.`);
      console.log(args[2] === '--apply' ? 'Re-run the full Vercel artifact guard before upload.' : 'Dry-run only. The build artifact was not changed.');
    } catch {
      console.error('Function alias materialization refused or failed. No artifact upload should proceed.');
      process.exitCode = 1;
    }
  }
}
