/** Loads only build-generated, syntax-highlighted source; no runtime evidence. */
export async function loadMissionCodeSource() {
  const response = await fetch('/mission-code-snippets.json');
  if (!response.ok) throw new Error(`Mission source returned HTTP ${response.status}`);
  const bundle = await response.json();
  if (bundle.version !== 1 || ![bundle.policy, bundle.binding, ...['tool', 'crash', 'recovery', 'finish'].map(phase => bundle.runtime?.[phase])].every(source =>
    source && typeof source.filename === 'string' && typeof source.html === 'string'
    && Array.isArray(source.focusLines) && source.focusLines.every(Number.isSafeInteger))) {
    throw new Error('The mission source bundle is invalid');
  }
  return bundle;
}
