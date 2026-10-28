import { hasCurrentCueIdentity } from './mission-cue-identity.js';

const neutralStages = new Set(['cutting', 'falling', 'rising', 'sealing', 'done']);

/** Selects proved source phases without letting later polls overtake the animation. */
export function createCodeSelectionModel({ phases, phaseForCue }) {
  const phaseNames = [...phases];
  const emptyProofs = () => Object.fromEntries(phaseNames.map(phase => [phase, null]));
  let runId;
  let archived = false;
  let status;
  let proofs = emptyProofs();
  let selected = null;
  let current = null;
  let playing = false;
  let replay = false;
  let following = true;

  function recognized(cue) {
    if (!hasCurrentCueIdentity(cue, { runId })) return null;
    const phase = phaseForCue(cue, { runId });
    return phaseNames.includes(phase) ? { cue, phase } : null;
  }
  function deactivate() { playing = false; replay = false; }
  function state() {
    const proof = selected ? proofs[selected] : null;
    const active = Boolean(proof && following && playing && current?.cue.key === proof.key);
    return {
      runId, phase: proof ? selected : null, proof,
      mode: !proof ? 'preview' : !following ? 'inspect' : active ? replay ? 'replay' : 'live' : 'observed',
      active, following,
      available: Object.fromEntries(phaseNames.map(phase => [phase, Boolean(proofs[phase])])),
    };
  }

  return {
    state,
    update(message) {
      const snapshot = message.snapshot;
      if (message.type === 'snapshot') {
        const changed = runId !== snapshot?.runId || archived !== (snapshot?.archived === true);
        if (changed) {
          runId = snapshot?.runId;
          archived = snapshot?.archived === true;
          proofs = emptyProofs();
          selected = null;
          current = null;
          following = true;
          deactivate();
        }
        status = snapshot?.status;
        if (!archived) {
          const validCues = (Array.isArray(snapshot?.cues) ? snapshot.cues : [])
            .map(recognized).filter(Boolean).sort((a, b) => a.cue.id - b.cue.id);
          for (const { cue, phase } of validCues) proofs[phase] = cue;
          // A first observation can show existing evidence, but subsequent polls
          // must not jump ahead of the animator's queue.
          if (changed && validCues.length) {
            current = validCues.at(-1);
            selected = current.phase;
          }
        }
        if (status === 'failed') deactivate();
      } else if (message.type === 'cue' && !archived && status !== 'failed' && message.runId === runId) {
        const cue = message.cue;
        const match = recognized(cue);
        if (match) {
          current = match;
          proofs[match.phase] = cue;
          playing = true;
          replay = message.replay === true;
          if (following) selected = match.phase;
        } else if (hasCurrentCueIdentity(cue, { runId }) && neutralStages.has(cue.stage)) deactivate();
      } else if (message.type === 'settled' && snapshot?.runId === runId) deactivate();
      return state();
    },
    select(phase) {
      if (!phaseNames.includes(phase)) return state();
      if (proofs[phase]) { selected = phase; following = false; }
      return state();
    },
    follow() {
      following = true;
      if (current) selected = current.phase;
      return state();
    },
  };
}
