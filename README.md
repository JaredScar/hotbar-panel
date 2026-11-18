# Hotbar

Hotbar installs, runs, and monitors game servers on the machine in front of you. It is free, MIT licensed, and not affiliated with Pterodactyl.

## Screenshots

Hotbar Desktop and the optional web panel share one interface. Join addresses, the SFTP password, and local folder paths are blurred.

### Server list

Every server on this computer, with its state and resource use. This machine has Vanilla, Paper, Spigot, Purpur, Fabric, Quilt, Forge, NeoForge, a FiveM resources server, a Modrinth pack, and a Docker egg.

![Server list](docs/screenshots/desktop.png)

### Create a server

Pick Minecraft, FiveM, or Hytale. The next steps choose the type, version, size, and setup.

![Create a server](docs/screenshots/create.png)

### Minecraft

Vanilla, Paper, Purpur, Spigot, Fabric, Quilt, Forge, and NeoForge. Paper is the recommended plugin server. Spigot is compiled on this machine, so the first install takes longer.

![Minecraft types](docs/screenshots/minecraft-types.png)

### FiveM

A GTA V server. The license key comes from the Cfx portal. Hotbar stores it for that server and keeps it out of the console log.

![FiveM](docs/screenshots/fivem.png)

### Hytale

The official dedicated server. The installer prints a sign-in link and code. Players connect over UDP.

![Hytale](docs/screenshots/hytale.png)

### Choose a version

The newest stable release is selected. Snapshots stay hidden unless you ask for them.

![Choose a version](docs/screenshots/create-version.png)

### Choose a size

Memory and a rough player count. Medium is 4 GB.

![Choose a size](docs/screenshots/create-size.png)

### Minecraft setup

Name the server, set the message of the day, and accept the EULA. The folder path is hidden.

![Minecraft setup](docs/screenshots/create-setup.png)

### Console

Live log, command line, power buttons, and CPU, memory, and network charts.

![Console](docs/screenshots/console.png)

### Properties

The whole `server.properties` file, grouped and searchable. A save writes only the settings you change. Restart the server before players see them, and stop it before changing the port.

![Properties](docs/screenshots/properties.png)

### Files

Folders and files for that server. Right-click a file, or use More, to rename, copy, or delete it. Text files open in the editor. Ctrl+S saves.

![Files](docs/screenshots/files.png)

### Plugins

Paper, Purpur, and Spigot search Modrinth for plugins that match the server version. Install asks before the jar is downloaded. Disable renames a jar to `.disabled`.

![Plugins on Paper](docs/screenshots/plugins.png)

![Confirm a plugin download](docs/screenshots/plugin-download.png)

### Mods

Fabric, Quilt, Forge, and NeoForge use the same page, labeled Mods.

![Mods on Fabric](docs/screenshots/mods.png)

Vanilla does not load plugins or mods.

![Vanilla](docs/screenshots/plugins-vanilla.png)

### World

The world folder, and a reset that takes a backup first.

![World](docs/screenshots/world.png)

### Backups

Backups Hotbar has already written. It keeps the newest seven.

![Backups](docs/screenshots/backups.png)

### Schedules

A daily backup, or any start, stop, restart, or console command on a cron.

![Schedules](docs/screenshots/schedules.png)

### Players

Operators, the whitelist, and bans, plus who is online when the server is running. Kick, ban, and operator changes apply to that player. The whitelist can be changed while the server is stopped.

![Players](docs/screenshots/players.png)

### Version

The installed server and Java version, and a change that backs up first.

![Version](docs/screenshots/version.png)

### Users

Sub-users are added from the panel account page after that person has registered. The machine owner keeps full access.

![Users](docs/screenshots/users.png)

### Databases

Hotbar installs MariaDB on this computer and creates a database, user, and password for the server. It asks before downloading Docker Desktop or MariaDB. The database listens only on this machine.

![Databases](docs/screenshots/databases.png)

### Network

The join address, and whether this computer is accepting that port. SFTP listens on this computer only. The password stays hidden until you show it.

![Network](docs/screenshots/network.png)

### Startup

Memory, start with Hotbar, restart after a crash, and the stop command. Change memory while the server is stopped. The folder path is hidden.

![Startup](docs/screenshots/startup.png)

### Activity

What Hotbar did for this server, including the reads that refresh the list.

![Activity](docs/screenshots/activity.png)

### FiveM resources

Reorder `ensure` lines, then edit `server.cfg` and save it.

![FiveM resources](docs/screenshots/resources.png)

### This machine

The agent that owns the processes: host, memory, disk, and the panel link. Closing the window does not stop the servers.

![This machine](docs/screenshots/machine.png)

### Setup

Where servers are stored, and whether Docker and SteamCMD are available.

![Setup](docs/screenshots/setup.png)

### Panel sign-in

The optional web panel. The same screens are available after you sign in.

![Panel sign-in](docs/screenshots/panel.png)

### Panel

After sign-in, pair a machine. Servers on that computer show up in this list.

![Panel](docs/screenshots/panel-home.png)

### Account

Passkeys, an authenticator, API keys, and sub-users for the signed-in panel user.

![Account](docs/screenshots/account.png)

What is in this repository:

- **Hotbar Agent** listens on `127.0.0.1`, stores this machine's servers in SQLite, and starts them as child processes. Closing the desktop window does not stop them.
- **Minecraft** for Vanilla, Paper, Spigot, Purpur, Fabric, Quilt, Forge, and NeoForge. Hotbar downloads a checksummed server jar and a Temurin JDK, writes `eula.txt` and `server.properties`, and starts the server. It asks before that download.
- **FiveM** asks for a Cfx.re license key, then installs the server. The Resources tab reorders `ensure` lines in `server.cfg`.
- **Hytale** installs the official dedicated server and waits while you sign in.
- **Modpacks** install from a Modrinth `.mrpack`. Palworld and Rust install through SteamCMD when it is on PATH.
- **Databases** are MariaDB, one container on this computer, bound to `127.0.0.1`. Hotbar asks before downloading Docker Desktop or the MariaDB image.
- **Hotbar Desktop** is an Electron window and tray around the shared UI.
- **Hotbar Panel** is optional: accounts, a one-time pairing code, and remote power and console. The agent dials out. Messages between the agent and the panel are signed with Ed25519.

## Install

Pushing a `v*` tag runs the release workflow. It publishes a Windows setup program, a macOS disk image, and a Linux `.deb` package plus an AppImage. These builds are not signed, so the operating system asks you to confirm before opening Hotbar.

## Requirements

Node.js 22.12 or newer, and pnpm 11.

## Run it

```bash
pnpm install
pnpm dev
```

That starts the agent, the UI at <http://127.0.0.1:4200>, the panel at <http://127.0.0.1:3000>, and the desktop window. The dev agent accepts the well-known token `dev-local-token` and will not bind to anything except loopback.

Choose **Minecraft**, then Vanilla, Paper, Spigot, Purpur, Fabric, Quilt, Forge, or NeoForge. Accept the EULA, and Hotbar downloads Java and the server, then starts it. **FiveM** asks for a Cfx.re license key. **Hytale** asks you to sign in when the installer prints a code. You can still **Register a program** by hand. While `pnpm dev` is running, the register dialog includes **Add demo echo server**.

To control this machine from the panel, open **Panel**, create an account, and choose **Pair a machine**. Enter the code on **This machine**. The panel UI in this dev setup is the same Angular app at <http://127.0.0.1:4200/panel>.

Start, type a line, and stop it from the console. Quitting the window from the tray leaves the agent, and any server it owns, running. Stop the `pnpm dev` terminal when you want the dev agent to exit.

To see the logon service command without installing it:

```bash
pnpm --filter @hotbar/agent exec node --experimental-sqlite --experimental-strip-types src/index.ts service plan
```

## Layout

| Path | What it is |
|---|---|
| `apps/ui` | Angular UI shared by the desktop window and the panel |
| `apps/desktop` | Electron shell, tray, and preload |
| `apps/agent` | Local API, process runtime, game installers, and SQLite |
| `apps/panel-api` | Accounts, pairing, and the signed agent connection |
| `packages/shared` | Types used by the agent, the panel, and the UI |
| `templates/` | Template definitions for Minecraft, FiveM, and Hytale |

## Checks

```bash
pnpm --filter @hotbar/shared build
pnpm typecheck
pnpm test
```
