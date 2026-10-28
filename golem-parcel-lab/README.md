# Golem parcel lab

The actual Golem application and its verification harness. Start with the [repository README](../README.md) for the experiment, setup, UI, evidence, and limitations, or read the [interactive walkthrough](https://lab.a-fatah.com/posts/golem-crash-recovery/).

## Commands from this directory

Requires Node.js 24.11+ and npm.

```sh
npm ci
npm run setup
npm test
npm run verify
npm start
```

The installer targets macOS ARM64 and checks the official binary's SHA-256 against `runtime-release.json`. On another supported platform, place the matching official Golem **1.6.1** executable at `.tools/golem` and skip `npm run setup`. The SDK is pinned to **2.0.1** in the package lock.

The dashboard listens on **http://127.0.0.1:4319** by default. Run terminal verification while the dashboard experiment is idle; both use the same Golem ports and local data. First startup may download built-in artifacts, and the tool intentionally waits for 30 seconds.

`npm test` typechecks TypeScript and tests harness behavior using fixtures. `npm run verify` starts real Golem processes, confirms the mid-tool crash, recovers the original invocation, and checks both policies with fresh requests.

## Application boundaries

- `src/knife-policy.ts` allows only `/workspace/parcel.cuts`; `golem.yaml` installs that middleware on the knife tool.
- The explicit permission card in `golem.yaml` denies writes and deletion under `/protected/**`, including requests made directly by the agent.
- `src/policy-probes.ts` tries both routes before the permitted cut and again in a new invocation after recovery.
- `scripts/verify.mjs` correlates the tool's original Start, post-append marker, confirmed server SIGKILL, and recovered End. The harness owns only the processes it creates.

Run artifacts go to `evidence/<run-id>/`, with the latest attempted result in `evidence/latest.json`. Runtime state and isolated CLI configuration live under `.data/`; the downloaded binary lives under `.tools/`. All are local generated files excluded from the repository.

The tool and filesystem may replay. The assertions establish one logical tool call and the final reconstructed files, rather than one physical execution of every guest operation. External side effects require their own idempotency or reconciliation.
