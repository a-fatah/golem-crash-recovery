/** DOM rendering for the experiment. Server values are always rendered as text. */
const element = (id) => document.getElementById(id);
let renderedEvents = "";
let predictionChoice = null;
let lastMission = null;

function renderPrediction() {
  if (!lastMission) return;
  const feedback = element("prediction-feedback");
  const complete = lastMission.scene === "completed";
  if (complete && !lastMission.success) {
    feedback.textContent = "The available evidence does not yet resolve every part of the prediction. Check the pending receipts below.";
  } else if (complete) {
    feedback.textContent = predictionChoice === "both" ? "You called it. The parcel finished and both fresh forbidden attempts were blocked." : "The result: the parcel finished, and both fresh forbidden attempts were blocked. Recovery kept the work and its boundaries.";
  } else if (predictionChoice) {
    feedback.textContent = lastMission.predictionPrompt;
  } else {
    feedback.textContent = "Make a prediction, or jump straight into the experiment.";
  }
  for (const input of element("mission-prediction").querySelectorAll("input")) input.disabled = complete;
}

function renderMission(state, mission) {
  const panel = element("mission-panel");
  panel.hidden = false;
  for (const id of ["mission-scene", "mission-rule", "mission-progress", "mission-prediction", "prediction-feedback", "mission-receipts"]) element(id).hidden = !mission;
  if (!mission) {
    element("mission-title").textContent = "Explore the local durability concept";
    element("mission-narrative").textContent = "This separate lab illustrates durable execution using WebAssembly and SQLite. Its runtime details appear below.";
    panel.querySelector(".mission-footnote").hidden = true;
    return;
  }
  element("mission-prediction").hidden = mission.scene === "completed";
  lastMission = mission;
  for (const [id, text] of Object.entries({
    "mission-title": mission.title, "mission-narrative": mission.narrative,
    "courier-caption": mission.courier, "parcel-caption": mission.parcelCaption,
    "house-caption": mission.houseCaption, "scene-status": mission.banner,
  })) element(id).textContent = text;
  element("scene-status").hidden = !mission.banner;
  const scene = element("mission-scene");
  scene.dataset.scene = mission.scene;
  scene.dataset.cableIntact = String(mission.cableIntact);
  const cut = mission.cut;
  element("story-step-work").dataset.state = cut ? "done" : state.status === "running" ? "active" : "pending";
  element("story-step-crash").dataset.state = state.status === "crashed" ? "active" : ["recovering", "completed"].includes(mission.scene) ? "done" : "pending";
  element("story-step-return").dataset.state = mission.scene === "completed" ? "done" : mission.scene === "recovering" ? "active" : "pending";
  for (const [id, receipt] of Object.entries(mission.receipts)) {
    element(`receipt-${id}`).dataset.state = receipt.state;
    element(`receipt-${id}-title`).textContent = receipt.title;
    element(`receipt-${id}-detail`).textContent = receipt.detail;
  }
  renderPrediction();
}

function setCounter(id, value, suffix) {
  const counter = element(id);
  counter.replaceChildren(document.createTextNode(String(value)));
  if (suffix) {
    const mark = document.createElement("span");
    mark.textContent = suffix;
    counter.append(mark);
  }
}

function renderRuntimeCopy(copy) {
  for (const [id, text] of Object.entries(copy.fields)) {
    const target = element(id);
    if (target.textContent !== text) target.textContent = text;
  }
  element("golem-evidence").hidden = !copy.processProof;
  const evidenceLink = element("golem-evidence-link");
  evidenceLink.hidden = true;
  evidenceLink.removeAttribute("href");
  if (!copy.processProof) return;
  element("golem-process-proof").textContent = copy.processProof.message;
  if (typeof copy.processProof.evidenceUrl !== "string") return;
  try {
    const url = new URL(copy.processProof.evidenceUrl, window.location.href);
    if (url.origin === window.location.origin && ["http:", "https:"].includes(url.protocol)) {
      evidenceLink.href = url.href;
      evidenceLink.hidden = false;
    }
  } catch {
    // Missing or malformed evidence URLs do not prevent the live view from rendering.
  }
}

function renderProgress(state) {
  const hasCut = state.counts.openedParcels > 0;
  const wasKilled = state.events.some((event) => /crash|kill/i.test(event.kind));
  const replayed = state.counts.replayedCalls > 0;
  element("step-cut").dataset.state = hasCut ? "done" : state.status === "running" ? "active" : "pending";
  element("step-crash").dataset.state = wasKilled ? state.status === "crashed" ? "crashed" : "done" : "pending";
  element("step-replay").dataset.state = state.status === "completed" ? "done" : replayed && state.status === "running" ? "active" : "pending";
}

function eventTone(kind) {
  if (/deny|denied|crash|kill|fail/i.test(kind)) return "danger";
  if (/replay|start|resume/i.test(kind)) return "warning";
  if (/allow|commit|complete|seal/i.test(kind)) return "success";
  return "neutral";
}

function renderEvents(events) {
  const signature = JSON.stringify(events);
  if (signature === renderedEvents) return;
  renderedEvents = signature;
  const log = element("event-log");
  const fragment = document.createDocumentFragment();
  for (const event of [...events].sort((left, right) => right.id - left.id).slice(0, 60)) {
    const row = document.createElement("li");
    row.dataset.tone = eventTone(event.kind);
    const time = document.createElement("time");
    time.dateTime = event.createdAt;
    const date = new Date(event.createdAt);
    time.textContent = Number.isNaN(date.valueOf()) ? "—" : date.toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const dot = document.createElement("span");
    dot.className = "event-dot";
    dot.setAttribute("aria-hidden", "true");
    const content = document.createElement("div");
    const kind = document.createElement("span");
    kind.className = "event-kind";
    kind.textContent = event.kind.replaceAll("_", " ").replaceAll("-", " ");
    const message = document.createElement("p");
    message.className = "event-message";
    message.textContent = event.message;
    content.append(kind, message);
    row.append(time, dot, content);
    fragment.append(row);
  }
  log.replaceChildren(fragment);
  log.hidden = events.length === 0;
  element("journal-empty").hidden = events.length > 0;
  element("event-count").textContent = `${events.length} EVENT${events.length === 1 ? "" : "S"}`;
}

export function renderState(state, options) {
  const copy = options.copy.status;
  renderRuntimeCopy(options.copy);
  renderMission(state, options.copy.mission);
  const badge = element("status-badge");
  badge.dataset.status = state.status;
  badge.replaceChildren(document.createElement("span"), document.createTextNode(copy.badge));
  element("run-description").textContent = copy.description;
  element("worker-pid").textContent = options.copy.pid ?? "—";
  element("attempt-number").textContent = state.attempt || "—";
  element("run-id").textContent = state.runId ? `${state.runId.slice(0, 8)}…` : "—";
  element("run-id").title = state.runId || "No run yet";
  element("primary-label").textContent = options.busy ? "Working…" : copy.button;
  element("primary-action").disabled = state.status === "running" || options.busy;
  element("crash-action").hidden = state.status !== "running" || !options.copy.manualCrash;
  element("crash-action").disabled = Boolean(options.busy);
  element("reset-action").disabled = ["idle", "running"].includes(state.status) || Boolean(options.busy);
  element("action-note").textContent = copy.note;

  setCounter("parcel-cuts", state.proof.parcelCutCount, "×");
  const cableVerified = state.runtime !== "golem" || state.status === "completed";
  setCounter("cable-state", cableVerified ? state.proof.protectedCableIntact ? "Intact" : "Cut" : "Pending", cableVerified ? state.proof.protectedCableIntact ? "↗" : "!" : "—");
  element("cable-state").className = cableVerified ? state.proof.protectedCableIntact ? "positive" : "negative" : "";
  setCounter("sealed-state", state.proof.parcelSealed ? "Sealed" : "Waiting", state.proof.parcelSealed ? "✓" : "—");
  element("sealed-state").className = state.proof.parcelSealed ? "positive" : "";
  setCounter("replayed-count", state.counts.replayedCalls, "↻");
  element("denied-count").textContent = String(state.counts.deniedCalls);
  renderProgress(state);
  renderEvents(state.events);
  if (options.announce) {
    element("live-status").textContent = `${copy.badge}. ${copy.description}`;
  }
}

export function renderError(message) {
  const box = element("action-error");
  box.textContent = message || "";
  box.hidden = !message;
}

export function renderDisconnected(message) {
  const badge = element("status-badge");
  badge.dataset.status = "failed";
  badge.replaceChildren(document.createElement("span"), document.createTextNode("Disconnected"));
  renderError(`Cannot reach the local runtime. ${message} Retrying automatically.`);
}

export function bindActions(handlers) {
  element("mission-prediction").addEventListener("change", (event) => {
    if (event.target instanceof HTMLInputElement) {
      predictionChoice = event.target.value;
      renderPrediction();
    }
  });
  const resetPrediction = () => {
    predictionChoice = null;
    for (const input of element("mission-prediction").querySelectorAll("input")) input.checked = false;
  };
  element("primary-action").addEventListener("click", () => {
    if (["completed", "failed"].includes(lastMission?.scene)) resetPrediction();
    handlers.primary();
  });
  element("reset-action").addEventListener("click", () => {
    resetPrediction();
    handlers.reset();
  });
  element("crash-action").addEventListener("click", handlers.crash);
}
