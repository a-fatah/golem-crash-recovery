import { spawn } from 'node:child_process';
import { open, mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

/** Owns only server processes it creates, never an unrelated listener. */
export function createLocalServer({ cli, dataDir, ports = { routerPort: 58410, customRequestPort: 58411, mcpPort: 58412 } }) {
  if (!cli || !dataDir) throw new Error('createLocalServer requires cli and dataDir');
  let current;

  async function start({ evidenceDir, label = 'server', timeoutMs = 60_000 }) {
    if (current && current.child.exitCode === null && current.child.signalCode === null) {
      throw new Error(`This controller already owns a running server (${current.child.pid})`);
    }
    const directory = resolve(evidenceDir);
    await mkdir(directory, { recursive: true });
    const token = `${label}-${randomUUID()}`;
    const portsPath = resolve(directory, `${token}.ports.json`);
    const logPath = resolve(directory, `${token}.log`);
    const invocation = cli.command(['-X', 'server', 'run', '--router-addr', '127.0.0.1',
      '--router-port', String(ports.routerPort), '--custom-request-port', String(ports.customRequestPort),
      '--mcp-port', String(ports.mcpPort), '--ports-file', portsPath, '--data-dir', resolve(dataDir)], {
      local: false, json: false,
    });
    const log = await open(logPath, 'a');
    const child = spawn(invocation.file, invocation.args, { cwd: invocation.cwd, stdio: ['ignore', log.fd, log.fd] });
    const record = { child, log, error: null, exit: null, ...invocation, logPath, portsPath, startedAt: new Date().toISOString() };
    record.closed = new Promise((accept) => {
      child.once('error', (error) => { record.error = error; });
      child.once('close', (exitCode, signal) => {
        record.exit = { exitCode, signal, stoppedAt: new Date().toISOString() };
        void log.close();
        accept(record.exit);
      });
    });
    current = record;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (record.error || record.exit) {
        throw new Error(`Local Golem startup failed: ${record.error?.message ?? JSON.stringify(record.exit)}; see ${logPath}`);
      }
      try {
        const actualPorts = JSON.parse(await readFile(portsPath, 'utf8'));
        for (const [name, expected] of Object.entries(ports)) {
          if (actualPorts[name] !== expected) throw new Error(`Unexpected ${name}: ${actualPorts[name]}`);
        }
        return { pid: child.pid, ports: actualPorts, portsPath, logPath, startedAt: record.startedAt, command: invocation };
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      await delay(100);
    }
    await stop({ signal: 'SIGKILL' });
    throw new Error(`Local Golem did not become ready within ${timeoutMs} ms; see ${logPath}`);
  }

  async function stop({ signal = 'SIGINT', timeoutMs = 10_000 } = {}) {
    const record = current;
    if (!record) return null;
    const pid = record.child.pid;
    if (!record.exit) {
      if (!record.child.kill(signal)) throw new Error(`Could not send ${signal} to owned server ${pid}`);
      let timer;
      try {
        await Promise.race([record.closed, new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Server ${pid} did not exit after ${signal}`)), timeoutMs);
        })]);
      } finally {
        clearTimeout(timer);
      }
    }
    return { pid, requestedSignal: signal, ...record.exit };
  }

  return Object.freeze({
    start,
    stop,
    get pid() { return current?.child.pid ?? null; },
    get running() { return Boolean(current && !current.exit && !current.error); },
  });
}
