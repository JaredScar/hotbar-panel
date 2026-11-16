# Install Hotbar

Hotbar is not affiliated with Pterodactyl.

## Desktop

The desktop window talks to the agent on `127.0.0.1`. Closing the window hides it. The agent keeps game servers running.

From a checkout:

```bash
pnpm install
pnpm dev
```

The UI is `http://127.0.0.1:4200`. The agent is `http://127.0.0.1:7878`. The optional panel is `http://127.0.0.1:3000`.

## Agent service

`hotbar-agent service plan` only prints the Windows task or writes a systemd unit. It does not change the machine.

`hotbar-agent service install` is the command that registers it. On Windows it creates a logon task named `HotbarAgent`. On Linux it writes the unit and tries `systemctl --user enable --now`.

A `v*` tag publishes installers through GitHub Actions. Windows gets a setup program, macOS a disk image, and Linux a `.deb` package plus an AppImage. The builds are not signed. Windows SmartScreen and macOS Gatekeeper ask you to confirm before the app opens. Running the workflow by hand builds the same files without publishing a release.

## Link a panel

Create an account in the panel, create a pairing code, then either enter it under This machine or run:

```bash
hotbar-agent link http://127.0.0.1:3000 CODE
```

The agent dials out. The panel does not open a port on the game machine.
