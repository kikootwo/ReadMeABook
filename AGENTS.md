# ReadMeABook Agent Instructions

These are the repository-wide instructions for all agents. Also follow the project standards and approval workflow in `CLAUDE.md`.

## Shared Developer Docker Compose

- The canonical developer Compose file is `C:\GIT\ReadMeABook\docker-compose.yml`.
- It is intentionally local-only, marked `skip-worktree`, and contains private machine configuration. Never print its full contents, expose its credentials, or include it in a commit.
- The active data bind mounts are hard-coded to `C:\GIT\ReadMeABook\config`, `cache`, `bookdrop`, `pgdata`, and `redis`, so every worktree uses the same developer data. Keep these mounts absolute.
- From any ReadMeABook worktree, pass its Git root as `--project-directory`. This keeps `build.context: .` pointed at that worktree's source code while the absolute data mounts continue to use the canonical root directories:

```powershell
$rmabWorktree = (git rev-parse --show-toplevel).Trim()
docker compose --project-directory $rmabWorktree -f C:\GIT\ReadMeABook\docker-compose.yml build readmeabook
docker compose --project-directory $rmabWorktree -f C:\GIT\ReadMeABook\docker-compose.yml up -d
```

- To build and start in one command:

```powershell
$rmabWorktree = (git rev-parse --show-toplevel).Trim()
docker compose --project-directory $rmabWorktree -f C:\GIT\ReadMeABook\docker-compose.yml up -d --build
```

- Do not use a plain `docker compose build readmeabook` unless the active worktree's Compose file has first been verified to contain a `build` section. The tracked production Compose normally references a prebuilt registry image, making that command a no-op.
- The developer Compose uses the fixed container name `readmeabook-test`. Before starting it, inspect any existing container with that name. Do not remove or replace an existing container without user approval.
