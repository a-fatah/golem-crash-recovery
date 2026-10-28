import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, mkdir, readFile, rename, rm } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const release = JSON.parse(await readFile(new URL('../runtime-release.json', import.meta.url), 'utf8'));
if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  throw new Error('This pinned demo installer targets macOS ARM64. Install the matching Golem 1.6.1 binary into .tools/golem for another platform.');
}
const directory = new URL('../.tools/', import.meta.url);
const binary = new URL('golem', directory);
await mkdir(directory, { recursive: true });
async function digest(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return `sha256:${hash.digest('hex')}`;
}
try {
  if (await digest(binary) === release.expectedDigest) {
    console.log('Golem 1.6.1 is installed; SHA-256 verified.');
    process.exit(0);
  }
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const temporary = new URL(`golem-${randomUUID()}.download`, directory);
try {
  console.log(`Downloading ${release.tag} (${Math.round(release.sizeBytes / 1_000_000)} MB)…`);
  const response = await fetch(release.downloadUrl);
  if (!response.ok || !response.body) throw new Error(`Golem download returned HTTP ${response.status}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary, { flags: 'wx', mode: 0o700 }));
  if (await digest(temporary) !== release.expectedDigest) throw new Error('Golem download failed SHA-256 verification');
  await chmod(temporary, 0o755);
  await rename(temporary, binary);
  console.log('Installed Golem 1.6.1; SHA-256 verified.');
} finally {
  await rm(temporary, { force: true });
}
