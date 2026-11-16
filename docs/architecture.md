# Architecture

The desktop window is a view. The agent is the host.

```
Electron window  --HTTP/WS, bearer token-->  Agent on 127.0.0.1
                                              ├─ SQLite
                                              ├─ child processes (the game servers)
                                              └─ outbound signed WSS --> Panel
Browser at /panel --HTTP/WS, session token--> Panel
                                              └─ relays power, console, and stats to the paired agent
```

Screens in `apps/ui` talk to a `DataSource`. `LocalAgentDataSource` calls the agent. `PanelDataSource` calls the panel and is provided on the `/panel` routes, so the server list and console are the same screens.

Cross-process types live in `packages/shared`. The agent imports `@hotbar/shared/node` for the data-directory helper; the browser bundle does not.

Server mutations go through the agent's command handlers. The handlers check a permission, write an activity row, and then change the process. The local token's principal has every permission. Tests also boot an agent whose token cannot start servers.

Startup uses `child_process.spawn` with `shell: false` and an argument array. `${VAR}` placeholders are replaced inside a single argument and are not split afterward.
