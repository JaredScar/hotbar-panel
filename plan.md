# Hotbar — open-source multi-game server panel (PLAN v3)

> Name: **Hotbar** (decided) — the row of quick slots in most games; here, your servers.
>
> **Decided:** name Hotbar, MIT license, Angular frontend.
>
> **Changes in v3:** two front ends — an **online web panel** and a **desktop app** installed on each machine that runs servers (§4). Milestones reordered desktop-first (§9).
>
> **Changes in v2:** (1) fully open source, no paid tier; (2) UI follows Pterodactyl's layout and flows; (3) new Minecraft Quick Create covering vanilla, Spigot/Paper and modded; (4) Pterodactyl egg import.

## 1. Goal

A free, open-source way to install, run, configure, back up and monitor many game servers (Minecraft and FiveM first; anything with a template after) across one or more machines, Windows or Linux. It ships as two pieces that share one UI:

- **Hotbar Desktop** — an app installed on each machine that hosts servers. It runs them and gives you a local window to manage them, with no account or internet needed.
- **Hotbar Panel** — an online web panel that linked desktop apps connect to, so you (and sub-users) can manage every machine from any browser.

**Positioning:** it should feel like Pterodactyl to anyone who has used it, with three differences:

1. **Windows hosts are first-class** (native process runtime), alongside Linux + Docker.
2. **Minecraft is a guided flow**, not an egg plus a page of startup variables.
3. **Game-aware tabs** (FiveM resources, Minecraft plugins/mods) on top of the standard console/files tabs.
4. **Install an app, not a stack.** Download Hotbar Desktop, click through Quick Create, and a server is running; the online panel is optional and added later by pairing.

### Non-goals (v1)

- Billing, reselling, customer provisioning.
- Kubernetes / multi-region scheduling.
- Replacing txAdmin's in-game admin menu.

## 2. Open source

| Item | Decision |
|---|---|
| License | **MIT** (decided). Same as Pterodactyl, so its code and community eggs can be adapted with attribution. |
| Model | 100% of features in the public repo. No open-core, no paid tabs. Funding via GitHub Sponsors only. |
| Repo files | `LICENSE`, `README` (screenshots + one-command install), `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md` (private disclosure address), issue/PR templates, `CHANGELOG.md` |
| Contributions | DCO sign-off (no CLA). Conventional commits. CI must pass: lint, unit, integration, E2E. |
| Releases | SemVer. GitHub Actions builds signed **desktop installers** (Windows `.exe`/MSI, Linux AppImage/deb; macOS later), headless agent binaries (Windows/Linux, x64/arm64) and panel Docker images, with checksums and SBOM. Desktop auto-updates from GitHub Releases. |
| Community templates | Separate `hotbar-templates` repo so games can be added without a panel release. |
| Docs | Docs site in-repo (`/docs`): install, add a node, write a template, API reference. |
| Third-party notices | `NOTICE.md` listing any code adapted from Pterodactyl (MIT) or others. |
| Branding | Own name, logo and colors. Do not use the Pterodactyl name or logo (registered trademark); README states "not affiliated with Pterodactyl". |

## 3. UI: follow Pterodactyl

Match Pterodactyl v1's information architecture and interaction patterns so existing users need no relearning. Recreate it in our own code and styles; if any Pterodactyl source or CSS is copied directly, keep its MIT notice in `NOTICE.md`.

### 3.1 Client area (per-user)

| Screen | Pterodactyl pattern to follow |
|---|---|
| **Server list** (home) | Top navigation bar, no sidebar. Servers as **full-width rows**: status color strip, name, `ip:port`, then CPU / memory / disk with icons. Toggle "show my servers / others" for admins. Search opens from the top bar. |
| **Server → Console** | Sub-navigation tabs under the top bar. Terminal on the left with command input; right column has **Start / Restart / Stop** (Stop becomes Kill while stopping) and stacked stat blocks: Address, Uptime, CPU, Memory, Disk, Network in/out. CPU / memory / network graphs below. |
| **Files** | Breadcrumb path, checkbox multi-select, per-row kebab menu (rename, move, permissions, archive, delete), New file / New directory / Upload buttons, in-browser editor. |
| **Databases** | Optional per-server MySQL databases (create, rotate password). M6. |
| **Schedules** | List of cron schedules; each has ordered tasks (send command, power action, create backup) with time offsets. |
| **Users** | Sub-users with a permission checklist grouped by area. |
| **Backups** | List with size, checksum, lock; create / download / restore / delete. |
| **Network** | Allocations for this server; set primary; notes. |
| **Startup** | Startup command preview, variables as cards, runtime image picker. |
| **Hotbarings** | SFTP details, rename, reinstall. |
| **Activity** | Per-server event log. |
| **Account** | Password, email, 2FA, API keys, SSH keys. |

Tab order: Console, Files, Databases, Schedules, Users, Backups, Network, Startup, Hotbarings, Activity. Game tabs (§3.3) are inserted after Files.

### 3.2 Admin area

Separate section (gear icon in the top bar), left sidebar: Overview, Hotbarings, API keys, Databases hosts, Locations, **Nodes** (allocations, config, health heartbeat), **Servers**, **Users**, Mounts, **Templates** (Pterodactyl calls these Nests/Eggs; keep a two-level group → template structure).

### 3.3 Where Hotbar deliberately differs

- **Create server** is available to users with the `servers.create` permission from the server list (Pterodactyl hides it in admin). Admin can cap per-user resources.
- **Minecraft Quick Create** (§5) replaces the raw egg form for Minecraft.
- **Game tabs**: FiveM *Resources*; Minecraft *Plugins / Mods*, *Players*, *World*.
- Node cards show OS and runtime (Windows · process / Linux · Docker).

### 3.4 Visual style

Dark neutral blue-gray surfaces, compact rows, small uppercase labels, one accent color per status (running / starting / offline). Keep per-game color only as a small tag on rows, not as full card headers.

### 3.5 Desktop app specifics

Same screens as the web panel, rendered from the same code, plus:

- **First-run wizard**: choose where servers live on disk, detect Docker/Java, add firewall rules, then straight into Quick Create.
- **This machine** page (replaces the admin *Nodes* page when unlinked): CPU/memory/disk, service status, open ports, link/unlink to an online panel.
- **Tray icon**: per-server status and start/stop, "Open Hotbar", "Quit window (servers keep running)".
- **Native touches**: OS notifications on crash/backup failure, "Open folder" in the file manager, drag files from the desktop into Files.
- A small banner showing mode: *Local only* or *Linked to panel.example.com*.

> The existing mockups (sidebar + card grid) predate this decision. Rework them to §3 before building UI: server list rows, console page with right-hand stat stack, admin sidebar, Minecraft Quick Create, desktop first-run wizard and tray menu.

## 4. Architecture: online panel + desktop app

```
                 Browser ──HTTPS/WSS──▶  Hotbar Panel (online)
                                          NestJS API + web UI + MariaDB
                                                  ▲
                                                  │ outbound WSS (paired, pinned key, signed commands)
┌──────────────── machine that hosts servers ─────┼───────────────────────┐
│  Hotbar Desktop (Electron window + tray)          │                       │
│        │ localhost API (token)                  │                       │
│        ▼                                        │                       │
│  Hotbar Agent  — background OS service ───────────┘                       │
│   ├─ local SQLite (this machine's servers, schedules, backups index)    │
│   ├─ runtime driver: process (Windows + Linux)                          │
│   └─ runtime driver: docker  (Linux, optional)                          │
│        └─ game server processes                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 4.1 Components

| Component | What it is | Runs where |
|---|---|---|
| **Hotbar Agent** | The engine: installs servers, runs processes, streams console, serves files/SFTP, takes backups, runs schedules, reports stats. Exposes a local API on `127.0.0.1`. | Every host machine, as a **Windows service / systemd unit** |
| **Hotbar Desktop** | Electron app: installer, first-run wizard, tray, auto-updater, and a window that renders the shared web UI against the local agent. Installs and supervises the agent service. | Every host machine with a desktop session |
| **Hotbar Panel** | Online control plane: accounts, sub-users, permissions, multi-machine server list, remote console/files relayed to agents. | Self-hosted (Docker Compose) on a VPS, or on one of the host machines |
| **Shared UI** | One web app built twice: as the panel's site and as the desktop renderer. A `DataSource` abstraction switches between *local agent API* and *panel API*. | Both |

**Key rule: the desktop window is not the server host.** Game servers are children of the agent *service*, so closing the window, logging out of Windows or the UI crashing never stops them. The desktop app is only a view and an installer.

### 4.2 Modes

| Mode | Setup | Who it is for |
|---|---|---|
| **Local only** | Install Hotbar Desktop. No account, works offline. Manage from the desktop window. | One PC or dedicated box, single admin |
| **Linked** | In Desktop: *Link to panel* → enter panel URL + one-time pairing code (or scan/paste a link). The machine appears as a node in the online panel. Local window keeps working. | Remote access, several machines, sub-users |
| **Headless** | Install the agent binary alone and pair it from the CLI (`hotbar-agent link <url> <code>`). | Linux VPS with no desktop |

### 4.3 Who owns what (so it works offline)

- **Agent is the source of truth for its own servers**: definitions, variables, files, schedules, backups. Schedules and the crash watchdog run on the agent, so they fire even if the panel or internet is down.
- **Panel is the source of truth for people**: users, sub-users, permissions, API keys, which machines exist.
- **Sync**: on connect the agent pushes a snapshot of its servers; afterwards it pushes change events. The panel caches these for the multi-machine list and to render pages while relaying live data. Panel-initiated changes are commands to the agent, never direct DB writes.
- **Conflicts**: none by design; every server mutation is executed by the agent, in order, whether it came from the local window or the panel. Both UIs receive the resulting event.
- **Unlink** keeps all servers on the machine and just drops the pairing.

### 4.4 Remote access without port forwarding

Agents dial **out** to the panel, so the management connection works behind NAT and with a changing home IP. Players still need the *game* ports reachable; the desktop app helps with that: adds OS firewall rules, shows the LAN/public address, runs a reachability check, and offers optional UPnP mapping.

### 4.5 Stack

| Layer | Choice |
|---|---|
| Shared UI | Angular + Tailwind, xterm.js, Monaco, Chart.js |
| Desktop shell | Electron (`electron-builder`, `electron-updater`), tray, native notifications |
| Agent | Node + TypeScript single executable; SQLite; `dockerode`, `node-pty`, `ssh2`; installed as a service (`node-windows`/WinSW on Windows, systemd on Linux) |
| Panel API | NestJS, REST + OpenAPI, WebSocket gateway; MariaDB (SQLite option) |
| Monorepo | pnpm workspaces: `apps/ui` (shared), `apps/desktop`, `apps/agent`, `apps/panel-api`, `packages/shared`, `templates/`, `docs/` |

> Frontend is **Angular** (decided). Pterodactyl's React components are a visual reference only; re-implement them as Angular components.

## 5. Minecraft Quick Create

Goal: a working Minecraft server in **four choices and one button**, with no knowledge of jars, Java versions or startup flags.

### 5.1 Flow

1. **Type** — big tiles, grouped:
   - **Vanilla** — official Mojang server.
   - **Plugins** — Paper (recommended), Spigot, Purpur.
   - **Mods** — Fabric, Forge, NeoForge, Quilt.
   - **Modpack** — search Modrinth, paste a CurseForge/Modrinth link, or upload a server pack zip / `.mrpack`.
2. **Version** — dropdown of versions valid for that type, newest stable preselected; "show snapshots" toggle. For Modpack this step is skipped (the pack pins it).
3. **Size** — presets instead of raw numbers: *Small (2 GB, ~5 players)*, *Medium (4 GB, ~15)*, *Large (8 GB, ~40)*, *Custom*. Modded types default one step up. Warn if the node lacks free memory.
4. **Basics** — server name, node (auto-picked: most free memory), EULA checkbox (required, links to Mojang's EULA). Optional "More options" drawer: gamemode, difficulty, max players, MOTD, whitelist, online-mode, seed, upload existing world zip.
5. **Create** — live install log, then lands on the Console tab with the server starting.

Everything else is automatic: port allocation (next free from 25565), Java version, JVM flags, `eula.txt`, `server.properties`, daily backup schedule.

### 5.2 Provider interface

One `minecraft-java` template backed by pluggable providers in the agent:

```ts
interface McProvider {
  id: 'vanilla'|'paper'|'spigot'|'purpur'|'fabric'|'forge'|'neoforge'|'quilt';
  listVersions(): Promise<McVersion[]>;            // cached in panel, 1 h TTL
  install(ctx: InstallCtx, version: string): Promise<{ launch: string[] }>;
}
```

| Provider | Version source | Install | Notes |
|---|---|---|---|
| vanilla | Mojang version manifest (`piston-meta.mojang.com`) | Download `server.jar` from the version JSON, verify SHA-1 | Version JSON also gives the required Java major version; use it for **all** providers |
| paper | PaperMC Fill v3 API (`fill.papermc.io/v3`) | Download URL + SHA-256 come in the API response; do not construct URLs | Requires a descriptive `User-Agent`. The old `api.papermc.io/v2` is sunset. Response includes recommended JVM flags and minimum Java |
| purpur | Purpur API | Direct download | |
| spigot | BuildTools version list | **Build on the node** with BuildTools (`--rev <ver>`); needs Git + JDK; takes several minutes | Spigot jars are not legally distributable, so no direct download exists. Cache the built jar per node per version. UI shows "Building… ~5–10 min" and suggests Paper as the faster drop-in |
| fabric | Fabric meta API | Download server launcher jar for (MC, loader, installer) | |
| quilt | Quilt meta API | Run Quilt installer in server mode | |
| forge | Forge promotions/maven metadata | Run installer with `--installServer`; launch via generated `run.sh`/`run.bat` + `user_jvm_args.txt` (older versions: launch the forge jar) | Handle both launch styles |
| neoforge | NeoForge maven metadata | Run installer in server mode; launch via generated run scripts | |

Rules:

- **Never hard-code version formats.** Minecraft moved from `1.x.y` to year-based versions (e.g. `26.2`); treat versions as opaque strings ordered by the provider's own list.
- **Java**: agent keeps a Temurin JDK cache per major version (process runtime) or picks the matching image tag (Docker runtime). Required major comes from Mojang's version JSON.
- **JVM flags**: Paper's recommended flags when provided by the API; otherwise Aikar's flags; `-Xms`/`-Xmx` from the size preset minus headroom.
- Verify every download's checksum; fail closed.
- Re-check each API's current shape when implementing; several of these changed in the last two years.

### 5.3 Modpacks

- **Modrinth**: search API → pick pack + version → download `.mrpack` → install the declared loader → download each file whose `env.server` is not `unsupported` (hash-verified) → apply `overrides/` and `server-overrides/`.
- **CurseForge**: requires an API key (admin setting). Some mods forbid third-party downloads; list those to the user with links and an upload slot. Prefer the pack's official *server pack* file when one exists.
- **Upload**: accept a server pack zip; detect loader + MC version from its contents, confirm with the user.

### 5.4 After creation (Minecraft tabs)

- **Plugins / Mods**: search Modrinth (and Hangar for Paper), one-click install filtered to the server's loader + version, update check, enable/disable (rename to `.disabled`), upload jar.
- **Players**: online list, op/deop, whitelist, ban/kick (via stdin commands; RCON optional).
- **World**: download world zip, upload/replace world, reset with new seed, per-world backup.
- **Version**: "Change version/type" wizard (e.g. Vanilla → Paper, Paper update) that takes a backup first and warns on downgrades.
- **Properties**: typed form for `server.properties` with raw fallback.

### 5.5 Later

Bedrock Dedicated Server, Velocity/BungeeCord proxy template with a "network" view linking backend servers, Geyser one-click.

## 6. Templates (all other games)

```yaml
id: fivem
version: 1
group: gta            # two-level group → template, like nests → eggs
name: FiveM
runtimes:
  docker:  { image: "hotbar/fxserver:latest" }
  process: { os: [windows, linux] }
variables:
  - { key: LICENSE_KEY, label: "Cfx.re license key", secret: true, required: true }
  - { key: MAX_PLAYERS, label: "Max players", type: int, default: 48 }
ports:
  - { name: game, default: 30120, protocols: [tcp, udp] }
install:
  - { step: download-fxserver-artifact, channel: recommended }
  - { step: write-file, path: server.cfg, from: templates/server.cfg.hbs }
startup:
  command: ["FXServer", "+exec", "server.cfg", "+set", "sv_licenseKey", "${LICENSE_KEY}"]
  ready_when: { log_matches: "server license key authentication succeeded" }
stop: { stdin: "quit", timeout_s: 30, then: kill }
config_files:
  - { path: server.cfg, parser: fivem-cfg, managed_blocks: [resources] }
query: { type: fivem-http, path: /players.json }
ui_plugins: [fivem-resources]
```

- `install` steps come from a fixed allow-list (`download`, `steamcmd`, `unzip`, `write-file`, `download-fxserver-artifact`, `minecraft-provider`, …). Arbitrary shell only in admin-created templates, flagged in the UI.
- **Pterodactyl egg import**: admin uploads an egg JSON → converted to a Hotbar template (variables, startup, stop, config parser rules, Docker images, install script). Imported eggs run on the **Docker runtime only**, because egg install scripts are bash executed in an install container. This gives day-one coverage of the community egg library.

### Built-in for v1

| Template | Install | Game tab |
|---|---|---|
| `minecraft-java` | Providers (§5) | Plugins/Mods, Players, World, Version, Properties |
| `fivem` | FXServer artifacts | Resources: ensure toggles, drag load order, add from Git/zip, per-resource restart |
| `palworld`, `rust` (M5) | SteamCMD | Hotbarings form |
| `custom` | user-defined | none |

## 7. Data model (core tables)

- `users`, `api_keys`, `ssh_keys`, `server_subusers` (permission list per server)
- `locations`, `nodes` (os, runtimes, address, agent key fingerprint, last_seen), `allocations` (node, ip, port, server nullable, notes)
- `template_groups`, `templates` (id, version, yaml, source: builtin | community | egg-import | user)
- `servers` (owner, node, template@version, name, limits {cpu, memory, disk}, variables json, state, auto_start, auto_restart, feature limits: databases/backups/allocations)
- `mc_installs` (server_id, provider, mc_version, loader_version, java_major, modpack ref) — drives the Version tab and update checks
- `backups`, `schedules`, `schedule_tasks`, `databases`, `database_hosts`, `mounts`
- `stats_samples` (downsample after 24 h), `activity_log` (actor, event, target, ip, properties json)
- `secrets` (encrypted at rest)

**Where tables live:** servers, `mc_installs`, backups, schedules, stats and secrets live in each **agent's SQLite** (authoritative) and are mirrored read-only in the panel. Users, sub-users, API keys, locations, nodes and `pairings` (node, public key fingerprint, paired_at, last_seen, revoked) live in the **panel's MariaDB**.

## 8. Security (hard requirement)

A game panel is remote code execution by design, and an open-source one is read by attackers too.

- **Auth**: Argon2id, TOTP + passkeys, short-lived access + rotating refresh tokens, rate-limited login.
- **Permissions**: per-server, per-action (`control.console`, `control.start`, `file.read`, `file.update`, `backup.restore`, …), mirroring Pterodactyl's sub-user permission groups.
- **Agent trust**: one-time enrolment token → agent keypair → panel pins it. Commands are signed with nonce + expiry. Outbound WSS only.
- **File jail**: resolve symlinks, then check against server root; reject traversal; cap upload and unzip size/entry count (zip-bomb guard). Same jail for SFTP.
- **Isolation**: Docker = unprivileged user, dropped capabilities, resource limits. Process runtime = dedicated low-privilege OS user per server, Job Objects / cgroups.
- **No shell interpolation**: startup and install commands are argument arrays; variables are substituted per-argument and validated against each variable's rules.
- **Downloads**: HTTPS only, checksum-verified, allow-listed hosts for built-in providers. Modpack files only from the hosts the pack format permits.
- **Secrets** encrypted (AES-GCM), write-only in the UI, redacted from console output.
- **Supply chain**: pinned dependencies, Dependabot, signed releases, SBOM, `SECURITY.md` with a disclosure window.
- **Desktop app**: Electron with `contextIsolation` on, `nodeIntegration` off, sandboxed renderer, strict CSP, no remote content, IPC allow-list. Local agent API binds to `127.0.0.1` only and requires a per-install token readable only by the installing OS user/admin group. Optional app lock (PIN/OS credential) for shared machines.
- **Agent service** runs as a dedicated service account, not SYSTEM/root where avoidable; game servers run as lower-privilege users beneath it.
- **Pairing**: one-time code, 10-minute expiry, single use; shows the panel's key fingerprint for confirmation; revocable from either side. A linked panel can do anything a local admin can, so the link screen says so plainly.
- **Updates**: signed installers and signed update manifests; the agent refuses unsigned updates. Windows code-signing certificate required to avoid SmartScreen warnings.
- **Activity log** for power actions, commands, file writes, permission changes, logins.

## 9. Milestones

Desktop-first: a useful local product early, then the online panel on top.

| # | Milestone | Scope | Done when |
|---|---|---|---|
| M0 | Skeleton + OSS setup | Monorepo, license, contributing docs, CI | `pnpm dev` runs shared UI + agent + Electron shell; repo is public-ready |
| M1 | **Desktop app + agent service** | Electron shell, installer, agent as OS service, local API + token, tray, Pterodactyl-style server list and Console page, process runtime | Install on Windows, register a server by hand, start/stop with live console; servers survive closing the app and a reboot |
| M2 | **Minecraft Quick Create** | `vanilla`, `paper`, `fabric` providers; Java cache; size presets; EULA; auto port; firewall rule + reachability check; Properties form; first-run wizard | Fresh PC → install Hotbar Desktop → joinable Paper server in under 3 minutes without typing a command |
| M3 | **Online panel + linking** | Panel API + DB, accounts, pairing flow, node list, snapshot/event sync, remote console/power relayed to agent, headless agent CLI | Link a desktop to a self-hosted panel and control its server from a phone browser; unplug the internet and the local window still works |
| M4 | Minecraft complete | `spigot` (BuildTools + cache), `purpur`, `forge`, `neoforge`, `quilt`; Modrinth modpacks; Plugins/Mods, Players, World, Version tabs | All eight types create and reach "Done"; a Modrinth pack installs end to end |
| M5 | Files, Startup, Hotbarings + FiveM | File manager + editor, SFTP, Startup/Hotbarings/Network tabs, `fivem` template, Resources tab | FXServer boots on Windows; toggle/reorder a resource from either UI |
| M6 | Ops | Backups + restore, Schedules (agent-side), crash watchdog, sub-users, Activity, Discord webhooks, OS notifications | Crash auto-recovers and notifies with the panel offline; nightly backup keeps 7 |
| M7 | Admin + Docker + eggs | Panel admin area (nodes, locations, allocations, users, templates), Docker runtime, egg import, SteamCMD, `palworld`/`rust`, Databases tab, CurseForge packs | Linux VPS (headless) and Windows desktop in one list; a community egg imports and runs |
| M8 | Hardening + 1.0 | 2FA/passkeys, API keys, security review of §8, signed installers + auto-update, docs site | Public v1.0 tag |

Build order inside each milestone: shared types → agent → API → UI.

## 10. Agent ↔ panel protocol (sketch)

- **Local**: Desktop/UI ↔ agent over `http://127.0.0.1:<port>` + WebSocket, bearer token. Same message types as below, minus signing.
- **Pairing**: `POST /pair {code, agentPublicKey, machineInfo}` → panel returns its public key + node id; both sides pin keys.
- **Sync**: on connect `node.snapshot` (all servers + versions), then `server.changed` / `server.removed` events; panel acks with a cursor so reconnects resume.
- One WSS connection per agent; JSON messages `{id, type, serverId?, payload, sig}`.
- Panel → agent: `server.install`, `server.power`, `server.stdin`, `fs.*`, `backup.*`, `template.sync`, `mc.listVersions`, `mc.changeVersion`.
- Agent → panel: `server.state`, `server.log` (batched), `server.stats` (every 5 s), `install.progress`, `ack/err`.
- Console fan-out: API relays logs to subscribed browsers after a permission check; agent keeps a ~2,000-line ring buffer per server.

## 11. Testing

- Unit: template schema, egg → template conversion, config parsers (round-trip without touching user lines), path jail (fuzzed), version ordering.
- Provider contract tests against **recorded fixtures** of each upstream API, plus a nightly live check that opens an issue when an upstream API changes shape.
- Integration: fake "echo server" template so CI needs no game binaries.
- E2E (Playwright): Quick Create a vanilla server → reaches Done → `stop`.
- Release matrix: every Minecraft type × {Windows process, Linux Docker}; FiveM on both.

## 12. Open questions

1. **txAdmin**: default off with a template variable to enable it?
2. **CurseForge**: ship without it until someone supplies an API key policy?
3. **Official hosted panel?** Default is self-hosted only. A free hosted panel would make linking one click, but it means running infrastructure and holding the keys to other people's machines.
4. **macOS desktop build**: needed, or Windows + Linux only for 1.0?
5. **Code signing**: who buys and holds the Windows certificate for an open-source project?

## 13. Instructions for an AI coding agent

- Work milestone by milestone; do not start M(n+1) until M(n)'s "Done when" passes.
- Before building any screen, read §3 and match Pterodactyl's layout for it; do not invent a new layout.
- Keep cross-process types in `packages/shared`; never duplicate them.
- Build every screen once in `apps/ui` against the `DataSource` interface; never fork a screen for desktop vs web. Desktop-only features go behind a capability flag.
- Game servers must be children of the agent service, never of the Electron process. Add a test that kills the Electron process and asserts servers keep running.
- All server mutations go through the agent's command handler, whether they originate locally or from the panel.
- Every API route needs a permission check, an activity log entry and a test.
- Never run a string through a shell; spawn with an argument array.
- Before implementing a Minecraft provider, fetch the upstream API docs and confirm endpoints; do not rely on remembered URLs.
- Add third-party code only with a compatible license and a `NOTICE.md` entry.
