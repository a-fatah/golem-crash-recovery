/** Layout and user-requested navigation messages; none control the runtime. */
export const MISSION_EMBED_RESIZE = 'golem:mission:resize';
export const MISSION_EMBED_MEASURE = 'golem:mission:measure';
export const MISSION_EMBED_REVEAL_REQUEST = 'golem:mission:reveal-request';
export const MISSION_EMBED_REVEAL = 'golem:mission:reveal';

export function isMissionEmbedSize(data) {
  return data !== null && typeof data === 'object'
    && data.type === MISSION_EMBED_RESIZE
    && Number.isInteger(data.height) && data.height > 0 && data.height <= 20000;
}

/** Scene coordinates are measured from the child document's top edge. */
export function isMissionEmbedScene(data) {
  return data !== null && typeof data === 'object' && !Array.isArray(data)
    && data.type === MISSION_EMBED_REVEAL
    && Number.isFinite(data.top) && data.top >= 0
    && Number.isFinite(data.height) && data.height > 0
    && data.top + data.height <= 20000;
}
