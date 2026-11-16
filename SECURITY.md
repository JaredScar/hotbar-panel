# Security

Hotbar is a remote-control surface for processes on your machine. Treat a linked panel as a local administrator.

## Reporting

Use a private GitHub Security Advisory on this repository. Do not open a public issue for an unpublished vulnerability. Please include the version, the component (agent, desktop, or panel), and a reproduction that does not require us to attack a third-party host.

## What this build already enforces

- The agent listens on `127.0.0.1` only and rejects any other bind address.
- The local API requires a bearer token. In development the token is the well-known value `dev-local-token` and it is refused unless `HOTBAR_DEV=1`.
- Startup commands are argument arrays. The agent does not invoke a shell, and it rejects `.bat`, `.cmd`, and shell scripts as the executable.
- Console output redacts environment values whose names look like secrets.
- File paths used by later file features go through `resolveInJail`, which resolves symlinks and rejects paths that leave the server root.
- Zip entry lists are rejected when they traverse, or when the entry count or uncompressed size exceeds the guard limits.
- The desktop renderer runs with context isolation, sandboxing, and no Node integration. Its preload exposes one IPC channel, `bootstrap`.

## Not in this build yet

- Per-server operating-system accounts and Windows Job Objects are not in this build.
- Authenticator codes and passkeys are available on the panel account. The installer is unsigned.
- The agent refuses an update manifest that has no valid signature. This build does not ship a signed installer.
- The panel pairs with an Ed25519 key and signs every agent message. Bind the panel to loopback unless TLS sits in front of it. Do not expose the agent port beyond loopback.
