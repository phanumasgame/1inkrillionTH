import { copyFile, lstat, mkdir, readFile, readdir, realpath, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'dist');
const markerName = '.krillion-build.json';
const markerKind = 'krillion-th-static-build';
const slash = value => value.split(sep).join('/');
const comparable = value => process.platform === 'win32' ? value.toLowerCase() : value;

function outputPath(relative) {
  if (isAbsolute(relative) || relative.split(/[\\/]/).some(part => part === '..'))
    throw new Error('Unsafe build path: ' + relative);
  const target = resolve(output, relative);
  if (!comparable(target).startsWith(comparable(output + sep)))
    throw new Error('Build path is outside dist: ' + relative);
  return target;
}

async function regularFiles(folder, base = '') {
  const result = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const relative = base ? base + '/' + entry.name : entry.name;
    const absolute = join(folder, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Symlinks are not allowed in the build: ' + relative);
    if (entry.isDirectory()) result.push(...await regularFiles(absolute, relative));
    else if (entry.isFile()) result.push(relative);
    else throw new Error('Unsupported file in the build: ' + relative);
  }
  return result;
}

async function main() {
  const sourceFiles = [
    'index.html', 'styles.css', 'data/survey-bank.json',
    ...(await regularFiles(join(root, 'src'))).filter(name => name.endsWith('.js')).map(name => 'src/' + name),
    ...(await regularFiles(join(root, 'assets'))).map(name => 'assets/' + name),
  ].sort();
  for (const file of sourceFiles) {
    const info = await lstat(join(root, file));
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('Missing or unsafe source file: ' + file);
  }

  const outputInfo = await lstat(output).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
  if (outputInfo && (!outputInfo.isDirectory() || outputInfo.isSymbolicLink()))
    throw new Error('Refusing to write to a non-directory or symlink: ' + output);
  await mkdir(output, { recursive: true });
  const expected = join(await realpath(root), 'dist');
  if (comparable(await realpath(output)) !== comparable(expected))
    throw new Error('Build output resolves outside this workspace: ' + output);

  let previous = [];
  const markerPath = outputPath(markerName);
  const existing = (await regularFiles(output)).filter(file => file !== markerName);
  try {
    const marker = JSON.parse(await readFile(markerPath, 'utf8'));
    if (marker.kind !== markerKind || !Array.isArray(marker.files) ||
      marker.files.some(file => typeof file !== 'string')) throw new Error('Invalid build marker');
    previous = marker.files;
    previous.forEach(outputPath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('Cannot safely use dist: ' + error.message);
    if (existing.length) throw new Error('dist already contains files not created by this build; move them before building.');
  }
  const owned = new Set(previous);
  if (existing.some(file => !owned.has(file)))
    throw new Error('dist contains files not created by this build; move them before rebuilding.');

  // The interim manifest also allows an interrupted build to be rerun safely.
  const union = [...new Set([...previous, ...sourceFiles])].sort();
  await writeFile(markerPath, JSON.stringify({ kind: markerKind, files: union }, null, 2) + '\n');
  for (const file of sourceFiles) {
    const destination = outputPath(file);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(join(root, file), destination);
  }
  const current = new Set(sourceFiles);
  for (const old of previous) if (!current.has(old))
    await unlink(outputPath(old)).catch(error => { if (error.code !== 'ENOENT') throw error; });
  await writeFile(markerPath, JSON.stringify({ kind: markerKind, files: sourceFiles.map(slash) }, null, 2) + '\n');
  console.log('Prepared ' + sourceFiles.length + ' static files in dist/.');
}

main().catch(error => { console.error('Build failed: ' + error.message); process.exitCode = 1; });
