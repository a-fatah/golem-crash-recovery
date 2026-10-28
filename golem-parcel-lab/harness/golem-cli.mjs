import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeTypedValue } from './typed-value.mjs';

export { decodeTypedValue } from './typed-value.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export class GolemCliError extends Error {
  constructor(message, execution) {
    super(message);
    this.name = 'GolemCliError';
    this.execution = execution;
  }
}

export function parseJsonDocuments(stdout) {
  return stdout.split('\n').filter((line) => line.trim()).map((line) => {
    const document = JSON.parse(line);
    if (typeof document !== 'object' || document === null || typeof document.$type !== 'string') {
      throw new Error('Expected a Golem JSON document with a $type discriminator');
    }
    return document;
  });
}

/** The connection to one local Golem application; commands never use a shell. */
export function createGolemCli(options = {}) {
  const cwd = resolve(options.projectDir ?? projectRoot);
  const binaryPath = resolve(options.binaryPath ?? resolve(projectRoot, '.tools/golem'));
  const configDir = resolve(options.configDir ?? resolve(projectRoot, '.data/cli-config'));

  function command(args, commandOptions = {}) {
    return {
      file: binaryPath,
      args: ['--config-dir', configDir,
        ...(commandOptions.json === false ? [] : ['--format', 'json']),
        ...(commandOptions.local === false ? [] : ['--local']),
        ...args],
      cwd,
    };
  }

  async function run(args, runOptions = {}) {
    const invocation = command(args, runOptions);
    const startedAt = new Date().toISOString();
    const timeoutMs = runOptions.timeoutMs ?? 60_000;
    return new Promise((accept, reject) => {
      const child = spawn(invocation.file, invocation.args, {
        cwd: invocation.cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, timeoutMs);
      child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
      child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
      child.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once('close', (exitCode, signal) => {
        clearTimeout(timer);
        const execution = { ...invocation, startedAt, finishedAt: new Date().toISOString(), exitCode, signal, stdout, stderr };
        if (timedOut || exitCode !== 0) {
          reject(new GolemCliError(timedOut
            ? `Golem command timed out after ${timeoutMs} ms`
            : `Golem command failed (${exitCode ?? signal}): ${stderr.trim()}`, execution));
          return;
        }
        try {
          const documents = runOptions.json === false ? [] : parseJsonDocuments(stdout);
          if (runOptions.expectedType && !documents.some((document) => document.$type === runOptions.expectedType)) {
            throw new Error(`Missing expected Golem output type ${runOptions.expectedType}`);
          }
          accept({ ...execution, documents });
        } catch (cause) {
          reject(new GolemCliError(`Invalid structured Golem output: ${cause.message}`, execution));
        }
      });
    });
  }

  async function invoke(agentId, method, invokeOptions = {}) {
    const execution = await run(['agent', 'invoke', '--no-stream',
      ...(invokeOptions.trigger ? ['--trigger'] : []),
      ...(invokeOptions.idempotencyKey ? ['--idempotency-key', invokeOptions.idempotencyKey] : []),
      agentId, method, ...(invokeOptions.arguments ?? [])], {
      timeoutMs: invokeOptions.timeoutMs ?? 90_000,
      expectedType: 'agent.invoke',
    });
    const document = execution.documents.find((item) => item.$type === 'agent.invoke');
    if (invokeOptions.idempotencyKey && document.idempotencyKey !== invokeOptions.idempotencyKey) {
      throw new GolemCliError('Golem returned a different invocation identity', execution);
    }
    return {
      ...execution,
      invocation: document,
      value: document.resultJson !== undefined
        ? decodeTypedValue(document.resultJson)
        : document.resultsJson?.length === 1
          ? decodeTypedValue(document.resultsJson[0])
          : document.resultsJson?.map(decodeTypedValue),
    };
  }

  async function readGuestFile(agentId, guestPath, readOptions) {
    if (!readOptions?.outputPath) throw new Error('readGuestFile requires an explicit outputPath');
    const outputPath = resolve(readOptions.outputPath);
    const execution = await run(['agent', 'file-contents', agentId, guestPath, '--output', outputPath], {
      timeoutMs: readOptions.timeoutMs ?? 5_000,
      expectedType: 'agent.file-contents',
    });
    return { ...execution, contents: await readFile(outputPath, 'utf8'), outputPath };
  }

  return Object.freeze({ projectDir: cwd, binaryPath, configDir, command, run, invoke, readGuestFile });
}
