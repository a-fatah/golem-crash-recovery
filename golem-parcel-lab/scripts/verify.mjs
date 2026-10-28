import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createGolemCli, decodeTypedValue } from '../harness/golem-cli.mjs';
import { createLocalServer } from '../harness/server-process.mjs';
import { summarizeOplog, assertInFlightTool, assertRecoveredTool } from '../harness/oplog.mjs';
import { assertKnifePolicyDenial } from '../harness/policy-denials.mjs';

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ports = { routerPort: 58410, customRequestPort: 58411, mcpPort: 58412 };

/** Runs a real process-crash experiment and leaves inspectable evidence. */
export async function verifyParcelRecovery(options = {}) {
  const runId = options.runId ?? `parcel-${Date.now()}-${randomUUID().slice(0, 8)}`;
  assert.match(runId, /^[a-zA-Z0-9_-]+$/, 'runId must be safe as a filename and agent identity');
  const evidenceRoot = options.evidenceRoot ?? resolve(projectDir, 'evidence');
  const evidenceDir = resolve(evidenceRoot, runId);
  await mkdir(evidenceDir, { recursive: true });
  const cli = options.cli ?? createGolemCli({ projectDir });
  const server = options.server ?? createLocalServer({ cli, dataDir: resolve(projectDir, '.data/server-data'), ports });
  const agentId = `ParcelAgent(${JSON.stringify(runId)})`;
  const summary = { runId, agentId, idempotencyKey: runId, startedAt: new Date().toISOString(), evidenceDir, passed: false };
  const emit = (stage, detail = {}) => options.onProgress?.({
    stage, phase: stage, runId, agentId, serverPid: detail.pid ?? server.pid, ...detail,
  });
  const save = async (name, value) => writeFile(resolve(evidenceDir, name), JSON.stringify(value, null, 2) + '\n');

  async function captureOplog(name) {
    const execution = await cli.run(['agent', 'oplog', agentId]);
    await save(`${name}.json`, execution.documents);
    return { documents: execution.documents, trace: summarizeOplog(execution.documents) };
  }

  function filesystemDenials(trace) {
    return trace.denialEntries.filter((document) => document.entry.type === 'Start' && document.entry.denial != null
      && /filesystem|\/protected\//i.test(JSON.stringify(document.entry))).map((document) => ({
      index: document.index,
      functionName: document.entry.functionName,
      denial: document.entry.denial,
      request: decodeTypedValue(document.entry.request),
    }));
  }

  try {
    const version = await cli.run(['--version'], { local: false, json: false });
    await save('runtime-version.json', version);
    summary.runtimeVersion = version.stdout.trim();
    assert.equal(summary.runtimeVersion, 'golem 1.6.1', 'Use the verified Golem version that records filesystem permission denials');
    emit('starting');
    summary.beforeServer = await server.start({ evidenceDir, label: 'before', timeoutMs: options.startupTimeoutMs ?? 180_000 });
    await save('server-before.json', summary.beforeServer);
    if (options.deploy !== false) {
      await options.beforeDeploy?.();
      emit('deploying');
      await save('deploy.json', await cli.run(['deploy', '--yes'], { timeoutMs: 180_000, expectedType: 'deploy' }));
    }
    emit('invoking', { agentId });
    await save('trigger.json', await cli.invoke(agentId, 'run', { trigger: true, idempotencyKey: runId }));

    const deadline = Date.now() + (options.observationTimeoutMs ?? 25_000);
    let before;
    let beforeDocuments;
    let observationError;
    while (Date.now() < deadline) {
      try {
        const { documents, trace: candidate } = await captureOplog('oplog-before');
        assertInFlightTool(candidate);
        before = candidate;
        beforeDocuments = documents;
        // File-download requests wait for an active tool. Its attributed log marker is
        // emitted after the unconditional append, and the unmatched Start proves
        // that this same tool call has not returned yet.
        await save('effect-before.json', {
          observation: 'Tool-attributed log emitted after append and before await/return',
          guestPath: '/workspace/parcel.cuts',
          markerEntries: candidate.parcelCalls[0].markers,
        });
        break;
      } catch (error) {
        observationError = error;
        try {
          const metadataExecution = await cli.run(['agent', 'get', agentId], { expectedType: 'agent.get', timeoutMs: 2_000 });
          const metadata = metadataExecution.documents.find((document) => document.$type === 'agent.get').metadata;
          if (metadata.status.toLowerCase() === 'failed') {
            await save('agent-failed.json', metadataExecution.documents);
            break;
          }
        } catch {
          // An early filesystem probe can precede agent startup; the deadline remains authoritative.
        }
        await delay(150);
      }
    }
    if (!before) {
      const error = new Error(`Could not establish a tool in flight after its append: ${observationError?.message}`);
      error.execution = observationError?.execution;
      throw error;
    }
    const beforeCall = assertInFlightTool(before);
    summary.policyDenials = {
      before: assertKnifePolicyDenial(beforeDocuments, { phase: 'before', method: 'run', idempotencyKey: runId }),
      after: null,
    };
    await save('policy-denials.json', summary.policyDenials);
    summary.filesystemDenials = { before: filesystemDenials(before), after: [] };
    await save('in-flight.json', before);
    await save('agent-before.json', (await cli.run(['agent', 'get', agentId], { expectedType: 'agent.get' })).documents);
    const inFlightEvidence = {
      entryCount: before.entryCount,
      toolStartIndex: beforeCall.startIndex,
      markerIndex: beforeCall.markers[0].index,
      markerMessage: beforeCall.markers[0].entry.message.trim(),
      markerTimestamp: beforeCall.markers[0].entry.timestamp,
      matchingToolEnds: beforeCall.ends.length,
      agentFinishes: before.agentFinishes.length,
      filesystemDenials: summary.filesystemDenials.before,
    };
    const inFlightRuntimeEvidence = {
      phase: 'in-flight', invocationKey: runId, agentId,
      toolStartIndex: beforeCall.startIndex, oldPid: summary.beforeServer.pid,
      markerIndex: beforeCall.markers[0].index, matchingToolEnds: beforeCall.ends.length,
    };
    emit('knife-denied-before', { policyDenial: summary.policyDenials.before });
    emit('effect-observed', { pid: server.pid, startIndex: beforeCall.startIndex, evidence: inFlightEvidence, runtimeEvidence: inFlightRuntimeEvidence });
    summary.kill = await server.stop({ signal: 'SIGKILL' });
    assert.equal(summary.kill.signal, 'SIGKILL', 'The entire server must die from SIGKILL');
    assert.equal(summary.kill.pid, summary.beforeServer.pid, 'The killed process must be the original Golem server');
    await save('kill.json', summary.kill);
    emit('killed', { pid: summary.kill.pid, runtimeEvidence: {
      ...inFlightRuntimeEvidence, phase: 'killed', signal: summary.kill.signal,
    } });
    await options.beforeRestart?.({ runId, agentId, serverPid: summary.kill.pid, evidence: inFlightEvidence });

    summary.afterServer = await server.start({ evidenceDir, label: 'after', timeoutMs: options.startupTimeoutMs ?? 180_000 });
    assert.notEqual(summary.beforeServer.pid, summary.afterServer.pid, 'Server process identity must change');
    await save('server-after.json', summary.afterServer);
    emit('restarted', { pid: summary.afterServer.pid, runtimeEvidence: {
      ...inFlightRuntimeEvidence, phase: 'restarted', newPid: summary.afterServer.pid,
    } });
    const recovered = await cli.invoke(agentId, 'run', { idempotencyKey: runId, timeoutMs: 90_000 });
    await save('recovered-invocation.json', recovered);
    const result = recovered.value;
    summary.result = result;
    await save('wallet.json', (await cli.run(['card', 'list', '--agent', agentId])).documents);
    const { documents: afterDocuments, trace: after } = await captureOplog('oplog-after');
    summary.filesystemDenials.after = filesystemDenials(after);
    await save('filesystem-denials.json', summary.filesystemDenials);
    await save('recovery.json', after);
    const parcel = await cli.readGuestFile(agentId, '/workspace/parcel.cuts', { outputPath: resolve(evidenceDir, 'parcel-after.txt') });
    const cable = await cli.readGuestFile(agentId, '/protected/safety-cable.txt', { outputPath: resolve(evidenceDir, 'cable-after.txt') });
    assert.equal(result?.parcelCuts, 1, 'Recovered ledger must contain one logical cut');
    assert.equal(result.cableContents, 'intact\n', 'Protected cable must remain intact');
    assert.equal(result.sealed, true, 'Agent must finish sealing the parcel');
    assert.equal(result.middlewareDenied, true, 'Configured middleware must deny the protected target');
    assert.ok(result.middlewareError?.length > 0, 'Capture the actual middleware denial');
    assert.equal(result.directWriteDenied, true, 'Runtime filesystem permissions must deny the direct write');
    assert.ok(result.directWriteError?.length > 0, 'Capture the actual filesystem denial');
    const recoveredCall = assertRecoveredTool(after, { startIndex: beforeCall.startIndex });
    assert.equal(parcel.contents, 'cut\n');
    assert.equal(cable.contents, 'intact\n');
    emit('recovered', { result, runtimeEvidence: {
      ...inFlightRuntimeEvidence, phase: 'recovered', newPid: summary.afterServer.pid,
      matchingToolEnds: recoveredCall.ends.length, toolEndIndex: recoveredCall.ends[0].index,
    } });
    const postRecovery = await cli.invoke(agentId, 'probePolicy', { idempotencyKey: `${runId}-post-recovery-policy` });
    await save('post-recovery-policy.json', postRecovery);
    summary.postRecoveryPolicy = postRecovery.value;
    assert.equal(postRecovery.value.middlewareDenied, true, 'A fresh middleware operation must be denied after recovery');
    assert.ok(postRecovery.value.middlewareError?.length > 0);
    assert.equal(postRecovery.value.directWriteDenied, true, 'A fresh direct write must be denied after recovery');
    assert.ok(postRecovery.value.directWriteError?.length > 0);
    const cableAfterPolicy = await cli.readGuestFile(agentId, '/protected/safety-cable.txt', { outputPath: resolve(evidenceDir, 'cable-after-policy.txt') });
    assert.equal(cableAfterPolicy.contents, 'intact\n', 'Fresh post-recovery probes must leave the cable intact');
    const { documents: afterPolicyDocuments, trace: afterPolicy } = await captureOplog('oplog-after-policy');
    summary.policyDenials.after = assertKnifePolicyDenial(afterPolicyDocuments, {
      phase: 'after', method: 'probePolicy', idempotencyKey: `${runId}-post-recovery-policy`,
      afterIndex: Math.max(...afterDocuments.map(document => document.index)),
    });
    await save('policy-denials.json', summary.policyDenials);
    summary.filesystemDenials.afterPolicy = filesystemDenials(afterPolicy);
    await save('filesystem-denials.json', summary.filesystemDenials);
    emit('knife-denied-after', { policyDenial: summary.policyDenials.after, postRecoveryPolicy: summary.postRecoveryPolicy });
    emit('policy-verified', { result: summary.postRecoveryPolicy });
    const repeated = await cli.invoke(agentId, 'run', { idempotencyKey: runId });
    assert.deepEqual(repeated.value, result, 'Same invocation key must retrieve the same result');
    await save('same-key-invocation.json', repeated);
    assertRecoveredTool((await captureOplog('oplog-same-key')).trace, { startIndex: beforeCall.startIndex });
    summary.logicalTool = { startIndex: beforeCall.startIndex, starts: 1, ends: after.parcelCalls[0].ends.length };
    summary.scope = 'One logical Golem tool invocation and reconstructed filesystem state; guest code and local writes may replay.';
    summary.passed = true;
    emit('verified', { result });
    return summary;
  } catch (error) {
    summary.error = { name: error.name, message: error.message, execution: error.execution };
    if (server.running) {
      try {
        await captureOplog('oplog-failed');
      } catch (captureError) {
        summary.diagnosticError = captureError.message;
      }
    }
    emit('failed', { message: error.message });
    throw error;
  } finally {
    if (server.running) {
      try {
        summary.stopped = await server.stop();
      } catch (error) {
        // Compilation can delay graceful shutdown; never leave an owned server behind.
        summary.shutdownError = error.message;
        summary.stopped = await server.stop({ signal: 'SIGKILL' });
      }
    }
    summary.finishedAt = new Date().toISOString();
    await save('summary.json', summary);
    await writeFile(resolve(evidenceRoot, 'latest.json'), JSON.stringify(summary, null, 2) + '\n');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyParcelRecovery({
    deploy: !process.argv.includes('--skip-deploy'),
    onProgress: (event) => console.log(JSON.stringify(event)),
  }).then((summary) => console.log(JSON.stringify(summary, null, 2))).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
