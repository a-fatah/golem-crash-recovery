import { createMissionCodeModel } from './mission-source-model.js';
import { missionCodePresentation } from './mission-code-presentation.js';

/** Renders source beside the scene without controlling the runtime or its clock. */
export function createMissionCodeView({ panel }) {
  const model = createMissionCodeModel();
  const title = panel.querySelector('#mission-code-title');
  const status = panel.querySelector('#mission-code-status');
  const proof = panel.querySelector('#mission-code-proof');
  const explanation = panel.querySelector('#mission-code-explanation');
  const identity = panel.querySelector('#mission-code-identity');
  const follow = panel.querySelector('#mission-code-follow');
  const guard = panel.querySelector('#mission-code-guard');
  const binding = panel.querySelector('#mission-code-binding');
  const bindingDetails = binding.closest('details');
  const tabs = [...panel.querySelectorAll('[data-code-phase], [data-policy-phase]')];
  let source;
  let visible = false;
  let signature;
  let displayedSource;
  let playback;

  function render() {
    panel.hidden = !visible;
    if (!visible) return;
    const state = model.state();
    const content = missionCodePresentation({ state, bundle: source, playback });
    const next = JSON.stringify({ state, playback });
    if (next === signature) return;
    signature = next;
    panel.dataset.active = String(state.active);
    panel.dataset.mode = state.mode;
    panel.dataset.phase = state.phase ?? 'preview';
    panel.dataset.playback = content.playback;
    follow.checked = state.following;
    follow.disabled = !state.proof;
    for (const tab of tabs) {
      const phase = tab.dataset.codePhase ?? tab.dataset.policyPhase;
      tab.disabled = !state.available[phase];
      tab.setAttribute('aria-pressed', String(state.phase === phase));
    }
    if (displayedSource !== content.source) {
      guard.innerHTML = content.source.html;
      displayedSource = content.source;
    }
    for (const line of guard.querySelectorAll('.line[data-line]')) {
      const number = Number(line.dataset.line);
      line.dataset.codeHidden = String(number < content.source.windowStart || number > content.source.windowEnd);
      line.dataset.codeFocus = String(Boolean(state.proof) && content.source.focusLines.includes(number));
      line.dataset.codeUnreached = String(Boolean(state.proof) && number === content.source.unreachedLine);
    }
    bindingDetails.hidden = !content.policy;
    title.textContent = content.title;
    status.textContent = content.status;
    proof.textContent = content.proof;
    identity.textContent = content.identity;
    identity.hidden = !content.identity;
    explanation.textContent = content.explanation;
  }

  for (const tab of tabs) tab.addEventListener('click', () => { model.select(tab.dataset.codePhase ?? tab.dataset.policyPhase); render(); });
  follow.addEventListener('change', () => {
    if (follow.checked) model.follow();
    else model.select(model.state().phase);
    render();
  });

  return {
    setSource(bundle) {
      source = bundle;
      // These fragments are escaped and highlighted from local source at build time.
      // Runtime values and trace fields are rendered with textContent above.
      binding.innerHTML = source.binding.html;
      displayedSource = null;
      for (const line of binding.querySelectorAll('.line[data-line]')) {
        line.dataset.codeFocus = String(source.binding.focusLines.includes(Number(line.dataset.line)));
      }
      signature = null;
      render();
    },
    unavailable() {
      panel.hidden = false;
      status.textContent = 'The source could not load. Runtime controls and evidence remain available.';
    },
    update(message) {
      if (message.type === 'snapshot') visible = Boolean(message.snapshot);
      model.update(message);
      if (source) render();
    },
    setPlayback(value) {
      playback = value;
      if (source) render();
    },
  };
}

// Preserve the policy-only panel's original import while it gains the runtime sequence.
export const createPolicyCodeView = createMissionCodeView;
