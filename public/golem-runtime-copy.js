/** Presentation copy for the actual Golem runtime experiment and its evidence. */
const statuses = {
  idle: {
    badge: "Ready · Golem",
    description: "Golem will reject a forbidden tool target and a direct protected-file write, then enter an allowed WebAssembly tool. The experiment kills the entire server while that tool is still running.",
    button: "Start the candy mission",
    note: "This starts the real experiment. It pauses after an automatic mid-tool server crash.",
  },
  running: {
    badge: "Still running · Golem",
    description: "The allowed WebAssembly tool writes its local parcel state, then waits 30 seconds before returning. The harness checks the durable oplog and kills the Golem server mid-tool.",
    button: "Golem running",
    note: "The server crash is automatic. When it stops, choose Resume Golem.",
  },
  crashed: {
    badge: "Server killed · Golem",
    description: "The server is dead. Its invocation has unfinished business. The entire Golem server was killed mid-tool; resume with the same runtime data to recover the original invocation.",
    button: "Resume Golem",
    note: "Pick a prediction, then resume the same job. Final file and policy checks follow.",
  },
  completed: {
    badge: "Back from the dead · Golem",
    description: "A new process. The same invocation. Golem recovered the task; the final parcel state records one cut, and the protected cable remains intact.",
    button: "Try a new mission",
    note: "Read the three receipts below, or start another mission.",
  },
  failed: {
    badge: "Golem run failed",
    description: "The Golem experiment stopped before all verification finished. Inspect the recorded events and oplog evidence for the failure.",
    button: "Run again",
    note: "Start a fresh experiment after inspecting the evidence.",
  },
};

/** Story labels distinguish an observed marker from verified recovered files. */
function missionCopy(state) {
  const metadata = state.golem || {};
  const phase = metadata.phase;
  const recovering = ["restarting", "restarted", "recovered", "policy-verified", "verified"].includes(phase);
  const recorded = state.events.some((event) => event.message.startsWith("Loaded recorded Golem evidence:"));
  const markerObserved = metadata.toolStartIndex != null;
  const finished = state.status === "completed";
  const policy = metadata.postRecoveryPolicy;
  const parcelVerified = finished && state.proof.parcelSealed && state.proof.parcelCutCount === 1;
  const success = parcelVerified && state.proof.protectedCableIntact && policy?.middlewareDenied === true && policy?.directWriteDenied === true;
  const facts = {
    idle: ["Can Golem get the candy ready?", "Cut only the parcel ribbon, then seal the candy box. The house power cable is off limits: no cutting and no direct writes—even after recovery.", "Ready for dispatch"],
    running: recovering
      ? ["Golem is back. The same job continues.", "A new server is recovering the unfinished tool call. After the parcel is sealed, both forbidden routes will be tried again.", "Recovering saved work"]
      : ["The candy mission is underway…", "Golem checks the rules, then cuts the allowed parcel ribbon. The harness will kill the server before that tool returns.", "Preparing the real experiment"],
    crashed: ["The server died. The candy isn’t ready.", "We observed the ribbon-cut marker, but the tool never returned. Bring Golem back and see whether it finishes while the cable stays protected.", "Courier offline · job unfinished"],
    completed: success
      ? ["Candy ready. House safe. Rules survived.", "The recovered parcel has one cut and is sealed. Fresh attempts through the knife and direct filesystem routes were both denied.", recorded ? "Recorded successful Golem run" : "Mission complete"]
      : ["The run finished. Check the available evidence.", "Some final evidence is unavailable. Inspect the receipts below; pending checks have not been proven by this saved run.", "Final evidence incomplete"],
    failed: ["The mission hit a runtime problem.", "The experiment did not finish all checks. Open the runtime evidence below to inspect what happened.", "Needs investigation"],
  };
  const [title, narrative, courier] = facts[state.status] || facts.failed;
  const decision = (value) => value === true ? "pass" : value === false ? "fail" : "pending";
  const scene = state.status === "running" ? recovering ? "recovering" : "working" : state.status === "idle" ? "ready" : state.status;
  return {
    scene,
    title, narrative, courier, recorded, success,
    predictionPrompt: {
      ready: "Prediction noted. Start the mission, then bring Golem back after the crash.",
      working: "Prediction noted. The mission will pause when the server crashes.",
      crashed: "Prediction noted. Bring Golem back to find out.",
      recovering: "Prediction noted. Golem is recovering; wait for the three receipts.",
      failed: "The experiment stopped before every check finished. Inspect the runtime evidence.",
    }[scene],
    cut: markerObserved,
    sealed: state.proof.parcelSealed,
    cableIntact: state.proof.protectedCableIntact,
    parcelCaption: parcelVerified ? "Sealed · one cut in the final file" : state.proof.parcelSealed ? "Sealed · final checks in progress" : markerObserved ? "Cut marker observed · not yet sealed" : "Ribbon waiting to be cut",
    houseCaption: success ? "Intact · both fresh attempts blocked" : "Verification pending · rule already applies",
    banner: state.status === "crashed" ? "REAL SERVER CRASH · The job is waiting for recovery" : recorded ? "SAVED REAL RUN · Start a new mission to try it yourself" : "",
    receipts: {
      parcel: {
        state: parcelVerified ? "pass" : "pending",
        title: parcelVerified ? "Candy ready" : "Candy not ready yet",
        detail: parcelVerified ? "One cut in the final file. Sealing finished." : markerObserved ? "Cut marker observed; final file checks still pending." : "The parcel must be cut and sealed.",
      },
      tool: {
        state: decision(policy?.middlewareDenied),
        title: policy?.middlewareDenied === true ? "Forbidden knife call blocked" : policy?.middlewareDenied === false ? "Knife check failed" : "Knife check after recovery",
        detail: policy?.middlewareDenied === true ? "A fresh request to cut the cable was denied." : "A fresh cable-target request must be denied.",
      },
      filesystem: {
        state: decision(policy?.directWriteDenied),
        title: policy?.directWriteDenied === true ? "Direct cable write blocked" : policy?.directWriteDenied === false ? "Filesystem check failed" : "Direct-write check after recovery",
        detail: policy?.directWriteDenied === true ? "Bypassing the knife still returned permission denied." : "A fresh direct write must also be denied.",
      },
    },
  };
}

export function golemRuntimeCopy(state) {
  const metadata = state.golem || {};
  const version = String(metadata.version || "1.6");
  const status = { ...(statuses[state.status] || statuses.failed) };
  if (state.status === "running" && state.attempt > 1) {
    status.description = "The server returns with unfinished business. Golem has restarted with the same runtime data and is recovering the original invocation, rebuilding local filesystem state through replay.";
    status.note = "Finishing the original job. Fresh policy checks run before the mission is marked complete.";
  }
  return {
    mission: missionCopy(state),
    status,
    pid: state.workerPid ?? metadata.newPid ?? metadata.oldPid,
    manualCrash: false,
    processProof: {
      message: `Original server ${metadata.oldPid ?? "—"} → Recovery server ${metadata.newPid ?? "—"}`,
      evidenceUrl: state.status === "completed" ? metadata.evidenceUrl : undefined,
    },
    fields: {
      "runtime-disclaimer": `Actual Golem ${version} · WebAssembly tool + host-enforced policy`,
      "hero-description": "Help a golem get the Halloween candy ready. Its server will die mid-job. Can it finish after recovery—and still leave the forbidden cable alone?",
      "worker-pid-label": "Golem server PID",
      "step-cut-title": "Policy checks, then Golem tool",
      "step-cut-description": "Reject two forbidden operations. Enter the allowed cut.",
      "step-crash-title": "Kill the whole Golem server",
      "step-crash-description": "Tool start recorded; no tool end before SIGKILL.",
      "step-replay-title": "Bring back the same invocation",
      "step-replay-description": "Golem rebuilds local state and finishes the tool.",
      "policy-description": "Golem enforces tool-target middleware and filesystem grants. The agent also tries a direct write to the protected cable.",
      "policy-code-label": "Golem policy checks · summary",
      "policy-code": "tool target: parcel only\nprotected cable: read-only\n\nforbidden tool target → denied\ndirect protected write → denied",
      "policy-footnote": "Fresh policy probes repeat both checks after recovery.",
      "denied-label": "Blocked operations",
      "parcel-cuts-note": "Final durable filesystem value after recovery.",
      "replayed-label": "Recovered tool calls",
      "replayed-note": "Logical calls recovered; local files rebuilt by Golem replay.",
      "boundary-agent-title": "Golem agent",
      "boundary-host-label": "Actual Golem runtime",
      "boundary-policy-title": "Host policy + durable oplog",
      "boundary-policy-description": "Target middleware + filesystem grants",
      "boundary-explanation": "Restart the Golem server with the same runtime data. Golem recovers the original invocation by replay, including its local filesystem state. The protected target remains forbidden.",
      "imports-label": "Golem host capabilities",
      "wasm-imports": `Golem ${version} · WebAssembly tools + filesystem grants`,
      "runtime-caveat": "This experiment runs on the actual Golem runtime. Golem restores local filesystem state by replay; a tool handler may execute again during recovery. External APIs need an idempotency or transaction strategy.",
    },
  };
}
