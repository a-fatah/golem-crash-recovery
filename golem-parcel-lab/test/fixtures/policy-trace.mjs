const target = '/protected/safety-cable.txt';
const error = `Knife policy denies target: ${target}`;
const string = { kind: 'string', value: {} };

/** Typed CLI middleware denial fixture shared by policy and lifecycle tests. */
export function policyTrace(options = {}) {
  const { phase = 'before', startIndex = 10, targetPath = target, middleware = 'knife-policy', runKey = 'parcel-test' } = options;
  const method = phase === 'after' ? 'probePolicy' : 'run';
  const key = phase === 'after' ? `${runKey}-post-recovery-policy` : runKey;
  const scope = { startIndex, entity: { kind: 'toolMiddleware', name: middleware }, operation: { type: 'Tool' } };
  const attribution = { type: 'Entity', invocation: scope, ancestors: [] };
  const terminalSchema = {
    kind: 'record', value: { fields: [
      { name: 'body_execution', body: { kind: 'enum', value: { cases: ['Skipped', 'Executed', 'Trapped'] } } },
      { name: 'result', body: { kind: 'result', value: { spec: {
        ok: string,
        err: { kind: 'variant', value: { cases: [
          { name: 'RemoteToolError', payload: { kind: 'ref', value: { id: 'ToolError' } } },
          { name: 'Denied', payload: string },
        ] } },
      } } } },
    ] },
  };
  const documents = [
    { $type: 'agent.oplog', index: startIndex - 1, attribution: { type: 'Agent' }, entry: {
      type: 'AgentInvocationStarted', invocation: { type: 'AgentMethodInvocation', methodName: method, idempotencyKey: key },
    } },
    { $type: 'agent.oplog', index: startIndex, attribution, entry: {
      type: 'Start', functionName: 'golem::entity::invoke', request: {
        graph: { root: { kind: 'record', value: { fields: [{ name: 'target', body: string }] } } },
        value: { kind: 'record', value: { fields: [{ kind: 'string', value: targetPath }] } },
      },
    } },
    { $type: 'agent.oplog', index: startIndex + 3, attribution, entry: {
      type: 'End', startIndex, response: {
        graph: { root: terminalSchema, defs: [{ id: 'ToolError', body: {
          kind: 'variant', value: { cases: [
            { name: 'InvalidInput', payload: string }, { name: 'ConstraintViolation', payload: string },
          ] },
        } }] },
        value: { kind: 'record', value: { fields: [
          { kind: 'enum', value: { case: 1 } },
          { kind: 'result', value: { tag: 'err', value: {
            kind: 'variant', value: { case: 0, payload: {
              kind: 'variant', value: { case: 1, payload: { kind: 'string', value: error } },
            } },
          } } },
        ] } },
      },
    } },
  ];
  if (phase === 'after') documents.push({
    $type: 'agent.oplog', index: startIndex + 5, attribution: { type: 'Agent' },
    entry: { type: 'AgentInvocationFinished', methodName: method },
  });
  return documents;
}

