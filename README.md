# Golem crash recovery and policy enforcement

A runnable experiment on **Golem 1.6.1** with TypeScript SDK **2.0.1**: kill the entire server during an unfinished tool call, recover the invocation, and test both policy boundaries again.

Read the [interactive walkthrough](https://lab.a-fatah.com/posts/golem-crash-recovery/).

The deterministic agent prepares a candy parcel. A knife may cut its ribbon, but the house's power cable is off limits. No language model or API key is required.

## Run locally

Requires Node.js **24.11+** and npm. The included installer downloads the official **macOS ARM64** Golem 1.6.1 binary and verifies its SHA-256 against `golem-parcel-lab/runtime-release.json`.

```sh
npm ci
npm run setup
npm test
npm start
```

Open **http://127.0.0.1:4319**. Start a mission, observe the automatic crash, then choose **Resume Golem**. The unfinished tool deliberately waits for 30 seconds before returning; first startup may also download Golem's built-in artifacts.

On another supported platform, install the matching official **Golem 1.6.1** binary at `golem-parcel-lab/.tools/golem`, make it executable, and install the lab dependencies with `npm --prefix golem-parcel-lab ci`. Skip `npm run setup`, whose installer checks for macOS ARM64.

Run verification without a browser:

```sh
npm run verify
```

Keep the dashboard idle while running terminal verification: both use the same local ports and runtime data. The harness signals only server processes it creates.

## What the experiment checks

1. The agent requests a cable cut. Manifest-bound middleware rejects its target before the knife body executes.
2. The agent attempts a direct write to the cable file. Golem's explicit filesystem permission card denies it.
3. The allowed knife call appends `cut\n` to the parcel ledger, emits a marker, and waits before returning.
4. The harness confirms a tool-attributed marker and an original tool Start with no matching End, then sends **SIGKILL to the whole Golem server** and confirms its exit.
5. A replacement server opens the same runtime data. The harness requests the original invocation using the same idempotency key.
6. The recovered invocation finishes the parcel. A new `probePolicy` invocation then tests both forbidden routes again with a fresh key.

Verification requires a changed server PID, exactly one End paired with the original logical tool Start, a final parcel ledger containing exactly `cut\n`, a sealed parcel, and a protected cable containing exactly `intact\n`. Both recovered policy results and both fresh post-recovery checks must report denial.

The protected file is provisioned **read-write**. Its direct-write protection comes from the runtime permission card, rather than an initial-file read-only flag. The knife body appends unconditionally; it contains no target guard or application deduplication.

## Recovery scope

Golem reconstructs local filesystem state through replay. A passing run demonstrates one **logical tool operation** and the recovered file contents; it does not establish that guest JavaScript or a physical append syscall executed only once.

An external API interrupted during a request still needs receiver-side idempotency or reconciliation. The runtime journal alone cannot make an arbitrary external side effect exactly once.

## Inspect the evidence

Each terminal or dashboard run writes a separate `golem-parcel-lab/evidence/<run-id>/` directory. `evidence/latest.json` identifies the latest attempted run and whether it passed. Generated evidence and runtime data are excluded from Git.

| File | What to inspect |
| --- | --- |
| `runtime-version.json` | The actual binary version |
| `oplog-before.json`, `in-flight.json` | Original tool Start, post-append marker, and missing End |
| `kill.json`, `server-before.json`, `server-after.json` | Confirmed SIGKILL and distinct server processes |
| `recovered-invocation.json`, `oplog-after.json` | Recovered result and matching terminal |
| `post-recovery-policy.json`, `oplog-after-policy.json` | Fresh invocation and policy decisions |
| `policy-denials.json`, `filesystem-denials.json` | Both enforcement boundaries before and after recovery |
| `parcel-after.txt`, `cable-after-policy.txt` | Final downloaded guest files |
| `same-key-invocation.json`, `summary.json` | Stable invocation result and passing assertions |

## Source map

| Concern | File or directory |
| --- | --- |
| Agent contract and workflow | `golem-parcel-lab/src/parcel-agent*.ts` |
| Shared forbidden requests | `golem-parcel-lab/src/policy-probes.ts` |
| Typed knife contract and implementation | `golem-parcel-lab/src/knife-definition.ts`, `golem-parcel-lab/src/knife-tool.ts` |
| Target policy | `golem-parcel-lab/src/knife-policy.ts` |
| Middleware binding and permission card | `golem-parcel-lab/golem.yaml` |
| Crash/recovery verification | `golem-parcel-lab/scripts/verify.mjs` |
| CLI, owned processes, and operation-log assertions | `golem-parcel-lab/harness/` |
| Dashboard HTTP and embedding boundary | `src/` |
| Animation, playback, and highlighted source | `public/` |

Dashboard movements follow observed runtime events. Pause and step controls pause presentation; the real experiment continues and queues its events. The committed highlighted snippets are static source snapshots used by the dashboard.

`npm test` typechecks the agent and runs verifier, policy-evidence, HTTP, and presentation tests. It does not start Golem; `npm run verify` is the real runtime experiment.

## References and artwork

See Golem's [durable execution](https://learn.golem.cloud/v1.6/concepts/durable-execution) and [tool security](https://learn.golem.cloud/v1.6/develop/tool-security) documentation, and the [1.6.1 release](https://github.com/golemcloud/golem/releases/tag/v1.6.1).

This is an independent educational demo. Golem mascot references belong to Golem; the Halloween costume artwork was generated from supplied mascot references. Its prompt is preserved in `public/assets/golem-halloween.prompt.txt`.
