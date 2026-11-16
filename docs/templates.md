# Templates

Built-in games are Minecraft (Vanilla, Paper, Purpur, Spigot, Fabric, Quilt, Forge, NeoForge), FiveM, and Hytale. Palworld and Rust install through SteamCMD when `steamcmd` is on PATH. App ids are `2394010` and `258550`.

Modpacks come from Modrinth `.mrpack` files. Hotbar checks the published sha1 and skips files marked unsupported on the server. CurseForge is not included.

## Eggs

An admin can POST a Pterodactyl egg JSON to `/api/eggs`. Hotbar converts the startup into an argument array and stores the template. If the startup contains shell syntax, Hotbar keeps a note and does not run it. Imported eggs are Docker-only because their install scripts are shell. Docker has to be on PATH.

txAdmin stays off. A FiveM server uses `server.cfg` and `+exec`.
