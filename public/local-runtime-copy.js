/** Presentation copy for the standalone WebAssembly + SQLite concept model. */
const statuses = {
  idle: {
    badge: "Ready",
    description: "The agent will inspect a parcel, cut it, and try a forbidden cable cut. Its first process is killed after the permitted cut commits.",
    button: "Run the experiment",
    note: "The first run injects a real process crash automatically.",
  },
  running: {
    badge: "Still running",
    description: "A real worker process is executing a WebAssembly agent. Every tool request passes through the host policy and journal.",
    button: "Agent running",
    note: "The journal remains available if the worker process disappears.",
  },
  crashed: {
    badge: "Process killed",
    description: "The worker is dead. Its task has unfinished business. The permitted cut is already committed; resume the agent to replay saved results and finish.",
    button: "Resume agent",
    note: "Resurrection starts a new worker. The journal retains committed effects and results.",
  },
  completed: {
    badge: "Back from the dead",
    description: "The worker returns. The parcel was cut once, the cable stayed intact, and the remaining work finished.",
    button: "Run again",
    note: "Start a fresh experiment to observe the same guarantees again.",
  },
  failed: {
    badge: "Worker failed",
    description: "The worker stopped before finishing. Its journal is still available. Resume to retry the remaining work.",
    button: "Resume agent",
    note: "The host retains recorded results across worker failures.",
  },
};

export function localRuntimeCopy(state) {
  const status = { ...(statuses[state.status] || statuses.failed) };
  if (state.status === "crashed" && state.counts.openedParcels === 0) {
    status.description = "The worker is dead. Any recorded tool results remain in the journal. Resume the agent to bring its unfinished task back.";
  }
  return {
    status,
    pid: state.workerPid,
    manualCrash: true,
    processProof: null,
    fields: {
      "runtime-disclaimer": "Local concept demo · WebAssembly + SQLite · not the Golem runtime",
      "hero-description": "A small rehearsal for the afterlife: give an agent a tool, kill its worker, and recover its progress while the host keeps the protected cable off limits.",
      "worker-pid-label": "Worker PID",
      "step-cut-title": "Cut the parcel",
      "step-cut-description": "Host commits the permitted effect.",
      "step-crash-title": "The worker meets SIGKILL",
      "step-crash-description": "Before the agent receives its result.",
      "step-replay-title": "Return, replay, then finish",
      "step-replay-description": "Reuse the saved result. Enforce every rule.",
      "policy-description": "A tool name is not a permission. Each target is checked outside the agent.",
      "policy-code-label": "Policy, in plain code",
      "policy-code": 'if (tool === "knife") {\n  return target === "parcel"\n    ? "allow"\n    : "deny";\n}',
      "policy-footnote": "Model-supplied “admin” claims have no authority.",
      "denied-label": "Blocked tool calls",
      "parcel-cuts-note": "One committed cut, even after replay.",
      "replayed-label": "Replayed calls",
      "replayed-note": "Saved results, without repeating effects.",
      "boundary-agent-title": "WebAssembly agent",
      "boundary-host-label": "Trusted host",
      "boundary-policy-title": "Policy + durable journal",
      "boundary-policy-description": "Check → commit effect & result",
      "boundary-explanation": "Restart the agent; keep the host’s history. A completed call returns its recorded result. A forbidden call stays forbidden.",
      "imports-label": "Agent imports",
      "wasm-imports": state.proof.wasmImports?.join(", ") || "host.invoke",
      "runtime-caveat": "This demonstration commits local effects and call results atomically in SQLite. Arbitrary external APIs require an idempotency or transaction strategy. This is an educational model of the idea, not verification of Golem’s implementation.",
    },
  };
}
