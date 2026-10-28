# Golem crash recovery and policy enforcement

A small experiment using **Golem 1.6.1** and TypeScript SDK **2.0.1**. A golem prepares a candy parcel with a knife. It may cut the ribbon; the power cable is off limits. No LLM or API key is needed.

[Read the interactive article](https://lab.a-fatah.com/posts/golem-crash-recovery/).

## Run it

Requires Node.js **24.11+** and npm.

```sh
npm ci
npm run setup
npm start
```

Open **http://127.0.0.1:4319**, start the mission, then choose **Resume Golem** after the automatic crash. The tool deliberately waits 30 seconds before returning. Cold startup can take longer while Golem downloads its built-in artifacts.

The setup script installs the official macOS ARM64 binary and checks its SHA-256. On another supported platform, skip setup: place the official Golem **1.6.1** binary at `golem-parcel-lab/.tools/golem`, make it executable, and run `npm --prefix golem-parcel-lab ci`.

```sh
npm test          # Typechecks and tests; does not start Golem
npm run verify    # Runs the real crash/recovery experiment
```

Keep the dashboard idle during terminal verification: they share ports and runtime data.

## What it checks

- Both cable routes are denied before the crash and in fresh calls after recovery: the knife target policy and direct filesystem writes.
- The harness kills the entire server after the ribbon cut is recorded, before the tool returns. A replacement server recovers the original invocation using the same data and idempotency key.
- The recovered parcel is sealed, its ledger contains one `cut` entry, and the cable remains intact.

Each run saves its logs, policy results, and final files in `golem-parcel-lab/evidence/<run-id>/`. `evidence/latest.json` points to the latest attempt; `summary.json` contains its assertions.

## Code

Paths below are inside `golem-parcel-lab/`:

- `src/knife-policy.ts` — allowed targets.
- `golem.yaml` — middleware binding and filesystem permissions.
- `src/knife-tool.ts` — the unfinished tool call.
- `scripts/verify.mjs` — crash and recovery harness.

Recovery replays local filesystem state. This verifies one logical tool call and its final files; external side effects still need receiver-side idempotency or reconciliation.

Artwork is based on Golem’s mascot; the Halloween variant was generated from supplied references.
