# Local agent API

The agent listens on `127.0.0.1` only. Send `Authorization: Bearer <token>`.

| Method | Path | What it does |
| --- | --- | --- |
| GET | `/api/setup` | Servers folder, Docker, SteamCMD |
| POST | `/api/setup` | Marks first-run setup complete |
| PUT | `/api/settings` | Saves a Discord webhook, or clears it |
| GET | `/api/servers/:id/files?path=` | Lists a folder inside the server |
| GET | `/api/servers/:id/files/content?path=` | Reads a text file |
| PUT | `/api/servers/:id/files/content` | Writes a text file |
| POST | `/api/servers/:id/backups` | Creates a backup and keeps 7 |
| POST | `/api/servers/:id/backups/restore` | Restores a backup while the server is stopped |
| GET | `/api/servers/:id/schedules` | Lists schedules |
| POST | `/api/servers/:id/schedules` | Adds a backup, power, or command schedule |
| GET | `/api/modpacks?q=` | Searches Modrinth modpacks |
| POST | `/api/servers/:id/modpack` | Installs a modpack into a stopped server |
| POST | `/api/eggs` | Converts an egg and stores it |
| POST | `/api/steam` | Installs Palworld or Rust with SteamCMD |
| GET | `/api/activity` | Recent activity |

The panel adds `/api/nodes`, `/api/account/keys`, `/api/auth/totp`, and `/api/servers/:id/users`. Panel requests use the account token or an API key.
