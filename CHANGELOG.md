# Changelog

## 0.1.0

- Monorepo for the shared Angular UI, local agent, Electron shell, and the online panel.
- Local agent on `127.0.0.1` with a bearer token, SQLite, and a process runtime that starts and stops programs without a shell.
- Minecraft Quick Create for Vanilla, Paper, and Fabric, including a checksummed Java cache, `server.properties`, and a daily backup schedule.
- Pterodactyl-style server list, console, and properties, plus a this-machine page and a tray menu.
- Panel accounts, one-time pairing, and remote power and console. The agent connects outbound and both sides sign messages.
- Quitting the desktop window does not stop servers owned by the agent.
