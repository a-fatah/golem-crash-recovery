/** Projects observed Golem evidence into the shared dashboard's view contract. */
export function dashboardSnapshot(record) {
  const result = record.result;
  const parcelCuts = result?.parcelCuts ?? (record.toolStartIndex == null ? 0 : 1);
  return {
    runtime: 'golem',
    runId: record.runId,
    status: record.status,
    workerPid: record.currentPid,
    attempt: record.newPid ? 2 : record.oldPid ? 1 : 0,
    counts: {
      openedParcels: parcelCuts,
      sealedParcels: result?.sealed ? 1 : 0,
      deniedCalls: Number(result?.middlewareDenied ?? record.policyDenials?.before?.denied ?? false) + Number(result?.directWriteDenied ?? false)
        + Number(record.postRecoveryPolicy?.middlewareDenied ?? false) + Number(record.postRecoveryPolicy?.directWriteDenied ?? false),
      replayedCalls: record.verified ? 1 : 0,
    },
    operations: [],
    events: record.events,
    proof: {
      protectedCableIntact: result ? result.cableContents === 'intact\n' : true,
      parcelCutCount: parcelCuts,
      parcelSealed: result?.sealed ?? false,
      wasmImports: [],
    },
    golem: {
      version: record.version, phase: record.phase, phaseStartedAt: record.phaseStartedAt ?? null,
      oldPid: record.oldPid, newPid: record.newPid,
      toolStartIndex: record.toolStartIndex,
      evidenceUrl: record.runId ? `/evidence/${record.runId}/summary.json` : null,
      postRecoveryPolicy: record.postRecoveryPolicy,
      policyDenials: record.policyDenials,
      runtimeEvidence: record.runtimeEvidence,
    },
    ...(record.error ? { error: record.error } : {}),
  };
}
