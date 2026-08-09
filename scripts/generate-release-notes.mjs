#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === '--tag' && argv[i + 1]) args.tag = argv[++i];
    else if (item === '--version' && argv[i + 1]) args.version = argv[++i];
    else if (item === '--output' && argv[i + 1]) args.output = argv[++i];
  }
  return args;
}

function runGit(args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function getReleaseTagList() {
  const tags = runGit(['tag', '--list', 'v*', '--sort=-version:refname'])
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
  return tags;
}

function getPreviousTag(currentTag) {
  const tags = getReleaseTagList();
  if (!tags.length) return null;
  if (currentTag) {
    const index = tags.indexOf(currentTag);
    if (index >= 0 && index + 1 < tags.length) return tags[index + 1];
  }
  return tags[0] || null;
}

function getCommitList(previousTag, currentTag) {
  const range = previousTag ? `${previousTag}..${currentTag || 'HEAD'}` : (currentTag ? `${currentTag}^..${currentTag}` : 'HEAD');
  const raw = runGit(['log', '--pretty=format:%s', range]);
  if (!raw) return [];
  return raw
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function buildReleaseNotes({ tag, version, previousTag, commits }) {
  const bulletLines = commits.length
    ? commits.map((commit) => `- ${commit}`)
    : ['- No detailed commit history was available for this release.'];

  const releaseLabel = version || tag || 'This release';

  return [
    '## Problem',
    '- Users needed a simple, plain-language update about what changed and why it mattered.',
    '',
    '## What changed',
    ...bulletLines,
    '',
    '## Fix',
    `- ${releaseLabel} includes the latest fixes, reliability improvements, and validation updates so the release is easier to trust and use.`,
    '',
  ].join('\n');
}

function main() {
  const args = parseArgs(process.argv);
  const tag = args.tag || process.env.GITHUB_REF_NAME || '';
  const version = args.version || process.env.RELEASE_VERSION || (tag ? tag.replace(/^v/, '') : 'next');
  const outputPath = args.output || path.join(root, 'release-notes.md');
  const previousTag = getPreviousTag(tag);
  const commits = getCommitList(previousTag, tag);
  const notes = buildReleaseNotes({ tag, version, previousTag, commits });
  fs.writeFileSync(outputPath, notes, 'utf8');
  process.stdout.write(notes + '\n');
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  main();
}

export { buildReleaseNotes, getCommitList, getPreviousTag };
