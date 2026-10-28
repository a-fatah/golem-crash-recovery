import assert from 'node:assert/strict';

function scopes(document) {
  const attribution = document.attribution;
  return attribution?.type === 'Entity' ? [attribution.invocation, ...attribution.ancestors] : [];
}

/** Derives evidence from the CLI's documented agent.oplog schema. */
export function summarizeOplog(documents, options = {}) {
  const toolName = options.toolName ?? 'knife';
  const agentMethod = options.agentMethod ?? 'run';
  const targetPath = options.targetPath ?? '/workspace/parcel.cuts';
  const marker = options.marker ?? 'PARCEL_CUT_IN_FLIGHT';
  const entries = documents.filter((document) => document.$type === 'agent.oplog');
  assert.equal(entries.length, documents.length, 'Expected only agent.oplog documents');
  const invocationScopes = new Map();
  for (const document of entries) {
    for (const scope of scopes(document)) {
      if (scope.entity?.kind === 'tool' && scope.entity.name === toolName) invocationScopes.set(scope.startIndex, scope);
    }
  }
  const toolCalls = [...invocationScopes].map(([startIndex, scope]) => {
    const start = entries.find((document) => document.index === startIndex);
    const ends = entries.filter((document) => document.entry.type === 'End' && document.entry.startIndex === startIndex);
    const markers = entries.filter((document) => document.entry.type === 'Log'
      && document.entry.message.includes(marker)
      && scopes(document).some((owner) => owner.startIndex === startIndex && owner.entity?.kind === 'tool'));
    return {
      startIndex,
      scope,
      start: start ?? null,
      ends,
      markers,
      isParcel: markers.length > 0 || JSON.stringify(start?.entry.request ?? '').includes(targetPath),
    };
  });
  const agentFinishes = entries.filter((document) => document.entry.type === 'AgentInvocationFinished'
    && document.entry.methodName === agentMethod);
  const denialEntries = entries.filter((document) => document.entry.denial != null
    || /denied|constraint-violation|permission|not permitted/i.test(JSON.stringify(document.entry)));
  return {
    entryCount: entries.length,
    toolName,
    agentMethod,
    parcelCalls: toolCalls.filter((call) => call.isParcel),
    toolCalls,
    agentFinishes,
    denialEntries,
    recoveryEntries: entries.filter((document) => ['RecoverySucceeded', 'Restart', 'Resumed'].includes(document.entry.type)),
  };
}

export function assertInFlightTool(summary) {
  assert.equal(summary.parcelCalls.length, 1, 'Expected one logical parcel tool invocation');
  const call = summary.parcelCalls[0];
  assert.equal(call.start?.entry.type, 'Start', 'Parcel tool must have a recorded Start entry');
  assert.equal(call.ends.length, 0, 'Parcel tool already completed before the kill');
  assert.ok(call.markers.length > 0, 'Missing tool effect-written marker');
  assert.equal(summary.agentFinishes.length, 0, 'Agent method already completed before the kill');
  return call;
}

export function assertRecoveredTool(summary, options = {}) {
  assert.equal(summary.parcelCalls.length, 1, 'Recovery created a second logical parcel tool invocation');
  const call = summary.parcelCalls[0];
  assert.equal(call.start?.entry.type, 'Start', 'Recovered parcel tool must retain its recorded Start');
  assert.ok(call.markers.length > 0, 'Recovered trace must retain the tool effect-written marker');
  assert.equal(call.scope.entity.kind, 'tool');
  assert.equal(call.scope.entity.name, summary.toolName);
  if (options.startIndex !== undefined) assert.equal(call.startIndex, options.startIndex, 'Recovery changed the logical tool identity');
  assert.equal(call.ends.length, 1, 'Recovered parcel tool must have exactly one End');
  assert.equal(summary.agentFinishes.length, 1, 'Agent method must complete exactly once');
  return call;
}
