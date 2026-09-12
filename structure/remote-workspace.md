# Remote Workspace

`src/remote-control/` owns Remote Workspace contracts, explicit executor construction and Hub session adapters. No module is registered with server startup in this layer. Existing Remote Hub provider routing remains in `src/remote/` and is a separate capability.

`src/remote-control/protocol.ts` owns frame and identity contracts. `src/remote-control/crypto.ts` implements signed handshakes and directional encryption. `src/remote-control/workspace-agent-protocol.ts` parses bounded control messages; `src/remote-control/workspace-rpc-framing.ts` bounds reassembly allocation, count and expiry. Importing these modules starts no process or timer; incomplete reassembly owns expiry timers after an explicit call.

`src/remote-control/workspace-agent-connection.ts` intersects presence with enrollment authority and negotiates explicit session grants. `src/remote-control/workspace-rpc.ts` snapshots session/device/root/capabilities and rejects mismatches before invoking the executor. The paired Hub is trusted to select an approved root over authenticated WSS; workspace control traffic is not an untrusted opaque relay protocol.

`src/remote-control/workspace-executor.ts` checks approved root identity, relative paths, file size and write preconditions. File reads and write preconditions open descriptors nonblocking before verifying regular-file identity, so special files cannot wait for a peer during open. Its optional command runner lives in `src/remote-control/workspace-command-runner.ts`. Linux uses bubblewrap outside writable workspace roots and checks executable/parent permissions before invocation. The official Windows and macOS native helpers refuse commands; file tools remain independent of command availability.

`src/remote-control/workspace-hub.ts`, `src/remote-control/workspace-device.ts` and `src/remote-control/workspace-sessions.ts` own separate persisted state. `src/remote-control/workspace-secret-store.ts` requires private permissions and rejects access failures rather than treating them as first-run absence. Publication reuses `src/config/atomic-write.ts`; workspace file publication uses the remote-workspace publisher in `src/lib/windows-atomic-replace.ts`.

`src/remote-control/workspace-runtime.ts` is the lazy composition owner for Hub services. Codex, Claude and Pi adapters keep model processes on the Hub and expose selected remote tools. Their source configuration is not evidence of live CLI confinement. `src/cli/remote-workspace.ts` contains explicit executor pair/agent/status handling; it is not yet registered by this layer.

The optional terminal prototype in `src/remote-control/host.ts` invokes only a caller-supplied factory after authenticated traffic. `src/remote-control/relay.ts` routes opaque prototype envelopes after caller authorization. Neither is a production terminal service.

Regression coverage lives in `tests/clients/remote-workspace-session-binding.test.ts`, `tests/clients/remote-workspace-secret-store.test.ts` and the adjacent protocol, agent-wire, device, hub, sessions and command-runner tests. Real CLI and native confinement tests require their explicit environments; generic suite success does not certify those paths. Windows command support remains unavailable pending a verified lifecycle owner.

Hub runtime admission counts pending create/resume starts as well as live handles against global and per-device limits; every outcome releases its reservation. Stop and shutdown reclaim late resumed handles before clearing ownership. Coordinator result size limits normalize both response text and success, so bridge and MCP callers receive consistent errors.
