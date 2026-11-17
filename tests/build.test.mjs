import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const comparable = value => process.platform === 'win32' ? value.toLowerCase() : value;

async function fixture(t) {
  const outputs = join(root, 'outputs');
  await mkdir(outputs, { recursive: true });
  const workspace = await realpath(root), parent = await realpath(outputs);
  assert.ok(comparable(parent).startsWith(comparable(workspace + sep)));
  const temporary = await mkdtemp(join(parent, 'vercel-build-qa-'));
  t.after(async () => {
    const target = await realpath(temporary);
    assert.ok(comparable(target).startsWith(comparable(parent + sep)));
    await rm(target, { recursive: true });
  });
  for (const dir of ['scripts', 'src', 'assets/tiers', 'data/archive', 'docs'])
    await mkdir(join(temporary, dir), { recursive: true });
  await copyFile(join(root, 'scripts/build.mjs'), join(temporary, 'scripts/build.mjs'));
  for (const [file, contents] of Object.entries({
    'index.html': '<html>game</html>', 'styles.css': 'body{}',
    'src/app.js': 'export const game = true;', 'src/old.js': 'export const old = true;',
    'src/notes.md': 'not runtime', 'assets/audio-cues.json': '{}',
    'assets/tiers/krillion.png': 'sprite', 'data/questions.json': '{"version":"test"}',
    'data/evidence.json': '{"articles":{}}', 'data/survey-bank.json': '{"version":"survey"}', 'data/archive/old.json': 'archive',
    'docs/research.md': 'research'
  })) await writeFile(join(temporary, file), contents);
  return temporary;
}

test('the static build contains runtime files only and removes obsolete generated files', async t => {
  const work = await fixture(t), run = () => exec(process.execPath, [join(work, 'scripts/build.mjs')]);
  await run();
  assert.equal(await readFile(join(work, 'dist/index.html'), 'utf8'), '<html>game</html>');
  assert.equal(await readFile(join(work, 'dist/data/survey-bank.json'), 'utf8'), '{"version":"survey"}');
  await assert.rejects(readFile(join(work, 'dist/data/questions.json')), { code:'ENOENT' });
  await assert.rejects(readFile(join(work, 'dist/data/evidence.json')), { code:'ENOENT' });
  await assert.rejects(readFile(join(work, 'dist/data/archive/old.json')), { code:'ENOENT' });
  await assert.rejects(readFile(join(work, 'dist/docs/research.md')), { code:'ENOENT' });
  await assert.rejects(readFile(join(work, 'dist/src/notes.md')), { code:'ENOENT' });
  await unlink(join(work, 'src/old.js'));
  await writeFile(join(work, 'styles.css'), 'body{color:red}');
  await run();
  await assert.rejects(readFile(join(work, 'dist/src/old.js')), { code:'ENOENT' });
  assert.equal(await readFile(join(work, 'dist/styles.css'), 'utf8'), 'body{color:red}');
});

test('the build refuses to overwrite unowned files in dist', async t => {
  const work = await fixture(t), run = () => exec(process.execPath, [join(work, 'scripts/build.mjs')]);
  await mkdir(join(work, 'dist'));
  const note = join(work, 'dist/keep.txt');
  await writeFile(note, 'keep this');
  await assert.rejects(run(), error => error.stderr.includes('not created by this build'));
  assert.equal(await readFile(note, 'utf8'), 'keep this');
});
