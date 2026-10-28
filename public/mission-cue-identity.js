/** Source evidence belongs to one exact event in the currently displayed mission. */
export function hasCurrentCueIdentity(cue, { runId }) {
  return typeof runId === 'string' && runId.length > 0
    && cue !== null && typeof cue === 'object'
    && Number.isSafeInteger(cue.id)
    && typeof cue.eventKind === 'string' && cue.eventKind.length > 0
    && cue.key === `${runId}:${cue.id}:${cue.eventKind}`;
}
