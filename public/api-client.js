/** Local runtime transport. Mutations are followed by a fresh state read. */
async function request(path, options = {}) {
  const response = await fetch(path, { ...options, cache: "no-store" });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `The runtime returned HTTP ${response.status}.`);
  }
  return response.headers.get('X-Lab-Idle-Sleep') === 'true'
    ? { ...payload, sleepWhenIdle: true }
    : payload;
}

export async function readState() {
  return request("/api/state");
}

export async function runAction(action) {
  await request(`/api/${action}`, { method: "POST" });
  return readState();
}
