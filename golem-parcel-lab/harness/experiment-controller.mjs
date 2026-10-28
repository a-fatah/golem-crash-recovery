import { randomUUID } from 'node:crypto';
import { dashboardSnapshot } from './dashboard-snapshot.mjs';

const stageMessages = {
  starting: 'Starting the actual local Golem server.',
  deploying: 'Deploying the typed knife tool, host-bound middleware, and explicit permission card.',
  invoking: 'Invoking ParcelAgent.run under a fresh agent identity and stable invocation key.',
  'knife-denied-before': 'Before the crash, the knife middleware rejected the protected cable target. The knife never reached the cable.',
  'effect-observed': 'Observed the tool marker after its append and a Golem tool Start with no End; the tool is still running.',
  killed: 'The entire Golem server exited on SIGKILL while the knife call was unfinished. Its data directory remains.',
  restarted: 'Started a new Golem server process using the same data directory and original invocation key.',
  recovered: 'Golem returned the recovered invocation: one parcel cut, protected cable intact, parcel sealed.',
  'knife-denied-after': 'After recovery, a fresh knife call was rejected for the same protected cable target. The knife still cannot reach the cable.',
  'policy-verified': 'Fresh operations on the recovered server were denied by the knife middleware and the filesystem permission card. The cable is still intact.',
  verified: 'Verified the original logical tool completed once, both enforcement paths denied access, and the same invocation key returns the saved result.',
};

/** Owns the interactive experiment lifetime; every result comes from Golem. */
export function createGolemExperiment({ verify, version, latest = null }) {
  let record;
  let task = null;
  let releaseRecovery = null;
  let stopping = false;

  function blank() {
    return {
      version, status: 'idle', phase: 'idle', phaseStartedAt: null, runId: null, currentPid: null,
      oldPid: null, newPid: null, toolStartIndex: null,
      result: null, postRecoveryPolicy: null, verified: false, error: null, events: [],
      policyDenials: { before: null, after: null },
      runtimeEvidence: null,
    };
  }
  record = blank();

  function event(kind, message, options = {}) {
    record.events.push({
      id: record.events.length + 1, kind, message, createdAt: new Date().toISOString(),
      ...(options.policyDenial ? { policyDenial: options.policyDenial } : {}),
      ...(options.runtimeEvidence ? { runtimeEvidence: options.runtimeEvidence } : {}),
    });
  }

  if (latest?.passed) {
    record = {
      ...record, status: 'completed', phase: 'verified', runId: latest.runId,
      oldPid: latest.beforeServer.pid, newPid: latest.afterServer.pid,
      toolStartIndex: latest.logicalTool.startIndex, result: latest.result,
      postRecoveryPolicy: latest.postRecoveryPolicy, verified: true,
      policyDenials: latest.policyDenials ?? { before: null, after: null },
    };
    event('complete', `Loaded recorded Golem evidence: server ${record.oldPid} was killed; server ${record.newPid} recovered its in-flight tool.`);
    event('deny', latest.result.middlewareError);
    event('deny', latest.result.directWriteError);
    if (latest.postRecoveryPolicy) event('policy-verified', stageMessages['policy-verified']);
  }

  function progress(observation) {
    if (record.phase !== observation.stage) {
      record.phase = observation.stage;
      record.phaseStartedAt = new Date().toISOString();
    }
    record.runId = observation.runId;
    if (observation.runtimeEvidence) record.runtimeEvidence = observation.runtimeEvidence;
    if (observation.stage === 'invoking') {
      record.oldPid = observation.serverPid;
      record.currentPid = observation.serverPid;
    }
    if (observation.stage === 'effect-observed') record.toolStartIndex = observation.startIndex;
    if (observation.stage === 'knife-denied-before') record.policyDenials.before = observation.policyDenial;
    if (observation.stage === 'knife-denied-after') {
      record.policyDenials.after = observation.policyDenial;
      record.postRecoveryPolicy = observation.postRecoveryPolicy;
    }
    if (observation.stage === 'killed') {
      record.currentPid = null;
      record.status = 'crashed';
    }
    if (observation.stage === 'restarted') {
      record.currentPid = observation.serverPid;
      record.newPid = observation.serverPid;
    }
    if (observation.stage === 'policy-verified') record.postRecoveryPolicy = observation.result;
    else if (observation.result) record.result = observation.result;
    if (observation.stage === 'verified') record.verified = true;
    if (observation.stage === 'failed') record.error = observation.message;
    const kind = observation.stage === 'killed' ? 'crash'
      : observation.stage === 'verified' ? 'complete'
      : observation.stage === 'recovered' ? 'replay' : observation.stage;
    event(kind, stageMessages[observation.stage] ?? observation.message ?? observation.stage, {
      policyDenial: observation.policyDenial, runtimeEvidence: observation.runtimeEvidence,
    });
    if (observation.stage === 'recovered') {
      event('deny', observation.result.middlewareError);
      event('deny', observation.result.directWriteError);
    }
  }

  return {
    get active() { return task !== null; },
    state: () => dashboardSnapshot(record),
    start() {
      if (task) throw new Error('An actual Golem experiment is already active');
      record = { ...blank(), status: 'running', phaseStartedAt: new Date().toISOString(), runId: `parcel-${Date.now()}-${randomUUID().slice(0, 8)}` };
      task = verify({
        runId: record.runId,
        onProgress: progress,
        beforeRestart: () => stopping ? undefined : new Promise(resolve => { releaseRecovery = resolve; }),
      }).then(() => {
        record.status = 'completed';
      }).catch(error => {
        record.status = 'failed';
        record.error = error.message;
        event('error', error.message);
      }).finally(() => {
        record.currentPid = null;
        releaseRecovery = null;
        task = null;
      });
      return dashboardSnapshot(record);
    },
    resume() {
      if (!releaseRecovery) throw new Error('No killed Golem server is waiting for recovery; start a new experiment');
      record.status = 'running';
      record.phase = 'restarting';
      record.phaseStartedAt = new Date().toISOString();
      const resume = releaseRecovery;
      releaseRecovery = null;
      resume();
      return dashboardSnapshot(record);
    },
    crash() { throw new Error('The harness sends SIGKILL only after verifying that the Golem tool is in flight'); },
    reset() {
      if (task) throw new Error('Resume and finish the active Golem experiment before resetting');
      record = blank();
      return dashboardSnapshot(record);
    },
    async stop() {
      stopping = true;
      releaseRecovery?.();
      await task;
    },
  };
}
