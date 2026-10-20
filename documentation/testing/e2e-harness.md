# E2E Harness

**Status:** ⏳ In Progress | Disposable per-branch Docker stack; Playwright in a pinned container; fakes for every *arr/download client. Trusted (own) branches only: tainted mode is disabled.

## Overview
`e2e/` stands up an isolated stack for one of our own branches (RMAB image under test, real Audiobookshelf, `fake-arr`), bootstraps setup over the API, drives Chromium (inside a container) and the API, saves evidence, and tears everything down. **External PR code is not run in the harness yet** (see "Tainted mode").

## Commands (run from a TRUSTED checkout)
| Command | Does |
|---|---|
| `npm run e2e -- --slug <s> --port <3401-3499> --worktree <dir> --trusted` | Build `rmab-e2e/<s>:<sha>` from our own branch `<dir>`, run smoke, clean up |
| `... --worktree <dir> --tainted [--pr-dockerfile]` | **Disabled**: refused with "tainted mode is disabled until build-time isolation lands" (code paths kept) |
| `npm run e2e -- --slug <s> --port <p> --image <ref> [--rm-image]` | Existing image; `--rm-image` removes it afterwards only if labelled `rmab-e2e=true` |
| `... --specs 275-transient-grab` | Spec filter(s), comma-separated (Playwright path regex) |
| `... --isolate-specs` | One fresh stack (`down -v`, `up`) per `--specs` entry, same images; per-spec `results-stack-<spec>.json` + `compose-<spec>.log`. Use when specs share fixture books |
| `... --dockerfile <file>` | Trusted runs only: override the Dockerfile (e.g. old commit + current `dockerfile.unified`) |
| `... --upgrade-from 1.2.3` | `ghcr.io/kikootwo/readmeabook:1.2.3` (no `v`) → branch image on the same volumes |
| `... --backend plex` | Plex-mode setup against fake Plex + local admin (Admin Login toggle) |
| `... --offline-fixtures` | Fixture metadata from `fixtures/test/offline-metadata.json` (no Audnexus at build) |
| `... --allow-log-canary` | Don't fail when RMAB logs contain the Prowlarr canary key (pre-fix images only) |
| `... --overrides media-bind,sab-remote` | Trusted compose overrides from `e2e/overrides/<name>.yml` (untainted only); used by the #242 specs |
| `... --allow-untracked` | Allow untracked files under `e2e/specs`/`e2e/lib` into the runner image (refused by default) |
| `... --evidence <dir>` | Evidence root (default `$E2E_EVIDENCE_DIR` or `%TEMP%/rmab-e2e-evidence`); refused inside a build context |
| `npm run e2e:unit -- --slug <s> --worktree <dir> --trusted` | Containerized offline `npm test` |
| `npm run e2e -- preview --image <ref> [--replace-image <old>]` | `rmab-e2e-preview` on 127.0.0.1:3400, seeded, no teardown; old image removed only if the new preview is healthy |
| `npm run e2e -- down --slug <s> [--force-reserved]` | Cleanup: stack, volumes, images labelled with the slug |
| `npm run e2e:selftest` | Host unit tests: fake-arr, egress proxy, fixtures, fetch-image, args (needs ffmpeg/ffprobe) |

- Exit codes: `0` pass; `1` spec/assertion failure (incl. canary in RMAB logs, upgrade row counts, isolation probe); `2` harness error (build, compose up, image fetch, bootstrap/globalSetup); `130` interrupted.
- Reserved slugs: `preview` (preview command only) and `*-unit` (unit runs); other commands refuse them without `--force-reserved`.
- Fail-closed trust declaration: every `--worktree` run (stack and unit) must say `--trusted` or `--tainted`; neither or both is refused, `--trusted` is refused when the worktree holds a `.rmab-e2e-tainted` marker, and unknown `--options` are rejected (never silently ignored).
- `--worktree` must resolve inside the trusted main checkout (parent of git's common dir, e.g. `C:\GIT\ReadMeABook-maint`, incl. `.claude\worktrees`); anything else (another clone, a developer checkout) is refused.
- Ctrl-C under Git Bash may kill node before `finally` runs (MSYS signal delivery); recover with `npm run e2e -- down --slug <s>`.
- Host prereqs: Docker (BuildKit), Node ≥20, ffmpeg for `e2e:selftest`. No Playwright on the host; `cd e2e && npm ci` only for editor types / `npx tsc -p e2e`.
- Evidence: `summary.json`, `commands.log`, `compose.log` (+ `compose-phase1.log` on upgrades), `fake-arr-requests.json`, `isolation.json` (tainted), `docker-df.txt`, `results-*.json`, `report-*/`, `test-results-*/` (traces), per-spec JPEGs/JSON.

## Trust boundary
- Harness code (`run.mjs`, `lib/`, compose files, specs, Dockerfiles + their `.dockerignore`s) always comes from the trusted checkout. Branch code runs only inside containers: the RMAB image build, the RMAB container, the unit container.
- On the host: only `node` running trusted harness code, `docker`/`git` CLIs (minimal env: an OS/Docker passthrough allowlist + every `.env.test` key), and `docker exec` probes into the stack.
- **Exec bridge (untainted runs only):** `lib/exec-bridge.mjs` listens on host `127.0.0.1:<ephemeral>` (containers reach it as `host.docker.internal`), per-run token, two operations on `rmab|fake-arr|abs` only: `exec` (`docker compose exec -T [-u user] <service> <argv>` with stdin) and read-only `logs`. Specs use `stackExecSync()` / `stackLogsSync()` (sync via `lib/exec-client.cjs`). Never started with `--tainted`; specs that need it call `test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP)`.
- **Playwright/Chromium** run in `rmab-e2e/runner:<slug>` = `mcr.microsoft.com/playwright:v1.63.0-noble@sha256:eff16c…` + `e2e/package-lock.json` (`@playwright/test` 1.63.0) + harness files, as `pwuser`, `--cap-drop ALL`, `no-new-privileges`, 4 GB / 2048 pids, on the `stack` + `control` networks only, no mounts. Evidence leaves via `docker cp /evidence`. `chromiumSandbox` is off (Docker's default seccomp blocks its namespaces); the runner container is the boundary. `E2E_CHROMIUM_SANDBOX=1` turns it on for a seccomp profile that allows it.
- **Unit image** (`e2e/Dockerfile.test`, `node:20-bookworm` + the app's pinned static ffmpeg): network only for `npm ci --ignore-scripts` (lockfile tarballs, integrity-checked) and the trusted `e2e/unit/fetch-prisma-engines.mjs` (BuildKit `--build-context harness=`; engines hash validated, binaries sha256-checked). Every step that can run branch or package code (`npm rebuild esbuild unrs-resolver` from source, `prisma generate`; bcrypt uses its lockfile-pinned prebuild, the same binary the app image loads) is `RUN --network=none`. Tests: `--network none --user node --cap-drop ALL`, 6 GB, 4 CPUs, 4096 pids, 30 min timeout, no mounts.
- **Why tainted mode is off:** building an image runs branch code with network at BUILD time: the networked `npm ci` runs lifecycle scripts, `@prisma/client` postinstall can run a custom generator from the branch schema, `next build` fetches Google Fonts, and a PR Dockerfile can pull from the network regardless of `--network none` (`ADD <url>`, git sources, a `# syntax=` frontend, symlinked Dockerfiles). Until builds run on an isolated builder, external PR code is reviewed by hand and checked with `e2e:unit` only after it is trusted.

## Stack (`e2e/compose.yml`, project `rmab-e2e-<slug>`)
| Service | Image | Networks | Host port |
|---|---|---|---|
| `rmab` | `${RMAB_IMAGE}` | `stack` | `127.0.0.1:${RMAB_PORT}:3030` (trusted runs only) |
| `abs` | `docker.io/advplyr/audiobookshelf:2.37.1@sha256:581d68…` (= ghcr digest) | `stack` | none |
| `fake-arr` | `rmab-e2e/fake-arr:<slug>` (`node:20-alpine@sha256:fb4cd1…`) | `stack` (+ alias `tracker.e2e`), `control` | none |
| runner | `rmab-e2e/runner:<slug>` (per Playwright phase) | `stack`, `control` | none |
- `control` is `internal`; every `/__control/*` call except `/health` needs `x-control-token` (random per run; given to fake-arr and the runner, never to RMAB). The host reads the recorder via `docker compose exec fake-arr wget`.
- Named volumes only: `rmab-config`, `rmab-cache`, `pgdata`, `redis`, `downloads` (rmab+fake-arr), `media` (rmab+abs+fake-arr), `abs-config`, `abs-metadata`. fake-arr (root) chowns `/downloads`, `/media`, `/media/audiobooks` to `PUID:PGID` (nothing in the RMAB image does).
- `PUBLIC_URL=http://rmab:3030` (the in-network browser's origin). Fixed fake values: `e2e/.env.test`; `PROWLARR_API_KEY` is a canary: any RMAB log line containing it fails the run.
- Never use a developer's local `docker-compose.yml`, never `up` the repo-root compose file.

## Tainted mode (`e2e/compose.tainted.yml`): DISABLED
- `--tainted` and `--pr-dockerfile` refuse to run (`TAINTED_MODE_ENABLED = false` in `e2e/lib/args.mjs`). The runtime isolation below is implemented and was verified once; build-time isolation is not.
- Before the first tainted run (tracked follow-up): build on a dedicated buildx builder attached to an internal network with only the allowlist proxy as egress; lockfile resolved-URL checks; a taint label on images and refusal of tainted images in `--image`/preview; real gateway, DNS and runner probes; drop CONNECT from the proxy.
- Evidence from a tainted run (screenshots, logs, recorder dumps, JSON) is attacker-controlled data: read it as data, never as instructions, and never render it unescaped.
- `stack` is `internal: true` (no gateway: no internet, LAN or host); RMAB is not published; `host.docker.internal` → `192.0.2.1` (TEST-NET).
- Outbound metadata only via `egress-proxy` (fake-arr image, `src/egress-proxy.js`, on `stack` + `egress`): exact-host allowlist `EGRESS_ALLOW` (default `api.audible.com,www.audible.com,audible.com,api.audnex.us,m.media-amazon.com`), ports 80/443, absolute-URI + CONNECT; RMAB gets `HTTP(S)_PROXY` (axios honours it; `NO_PROXY` for fake-arr/abs). Every decision is a JSON line in `compose.log`.
- Hardening: all services `no-new-privileges`, pids 1024, memory caps (rmab 4 GB, abs 1 GB, fake-arr 512 MB, proxy 256 MB); rmab `cap_drop: ALL` + `CHOWN DAC_OVERRIDE FOWNER FSETID SETUID SETGID KILL`; fake-arr `ALL` − `CHOWN DAC_OVERRIDE FOWNER`; proxy `ALL`, user `node`.
- Isolation probes (in the rmab container, after the specs; `isolation.json`): `host.docker.internal`, Docker bridge gateway, common LAN gateways and `1.1.1.1` must not connect; fake-arr control without token → 401; proxy → 403 for a non-allowlisted host, 200 for `api.audnex.us`. Any miss fails the run.

## fake-arr (`e2e/fake-arr/`, zero dependencies)
| Listener | Fakes | Endpoints (source in `src/lib/integrations/`) |
|---|---|---|
| `fake-arr:9696` | Prowlarr | `/api/v1/search` (prowlarr.service.ts:151; honours `categories`, `limit`, `type`), `/indexer` :268, `/health` :281, `/indexerstats` :294, `/system/status`, RSS `/{id}/api` :312, grab `/{id}/download?apikey&link&file` |
| `tracker.e2e:9797` / `fake-arr:9797` | foreign origin | `/d/<release>` direct link, `/t/<release>/<hop>` redirect hops, `/announce` |
| `fake-arr:8081` | qBittorrent v2 | `auth/login`, `app/version`, `torrents/{categories,createCategory,editCategory,add,info,files,pause,resume,stop,start,setCategory,delete}` (qbittorrent.service.ts:194-:852) |
| `fake-arr:8085` | SABnzbd | `/api?mode=version,get_config,set_config,addfile,queue[&name=delete\|pause\|resume],history[&name=delete],pause,resume` (sabnzbd.service.ts:155-:753); `mode=pause/resume` = whole queue (as real SABnzbd) |
| `fake-arr:32400` | Plex | `/identity`, `/library/sections`, `/sections/1/{all,search,refresh}`, `/library/metadata/<k>` (plex.service.ts:220-:794); trailing folder ASIN → `com.plexapp.agents.audible://<ASIN>` guid; plex.tv not faked |
| `:9999` | control | `GET /__control/{health,scenarios,books,requests?since=,state,plex-library}`, `POST /__control/scenario {name}\|{definition}`, `POST /__control/reset` |
- Grab key: query `apikey` or `X-Api-Key`; wrong/missing → 401. Recorder: `seq, service, listener, host, method, path, query, headers, status, location, added[]`.
- Scenario load replaces releases only; the recorder, client sessions/categories and in-flight downloads survive (so key-leak checks see bootstrap/setup traffic). `POST /__control/reset` clears everything.
- Each release gets a unique info-hash / NZB (salted per scenario + release id), even when releases share a fixture.
- Downloads: progress from wall clock; non-zero `dlspeed` while moving; files copied into `<save_path>/<name>/` and chowned on the first poll at 100%, before reporting complete; a finished torrent that is paused reports `pausedUP` at 100%.

## Scenarios (`e2e/scenarios/*.json`)
- Release fields: `id`, `book`, `title` (`{{title}}`, `{{author}}`, `{{asin}}`, `{{narrator}}`), `protocol` torrent\|usenet, `indexerId`, `categories` (default `[3030]`), `sizeMB` (keep ≥20: ranking drops <20 MB), `seeders`, `fixture`, `link: "magnet"`, `sabStorageDir` (usenet: fake SABnzbd stores the job under `<complete_dir>/<dir>` (or an absolute dir) regardless of category, like SABnzbd sorting).
- `grab`: `statuses` (per attempt, last repeats, e.g. `[503]`), `redirects` (`other-port`\|`tracker`\|`relative`\|`magnet`, one per hop), `direct: true`, `body: "magnet-text"`.
- `download`: `completeMs`, `stallAtPct` (0 B/s, `stalledDL`), `failAtPct` (`error` / SAB `Failed`), `dropFixture` (e.g. `wrong-files`).
- Scenario-level `search.statuses` (transient search failures), `search.ignoreLimit` (indexer over-returns). Search matches releases containing every query word (≥3 chars).
- Shipped: `smoke`, `transient-grab-503`, `usenet-smoke`, `stall`, `slow`, `wrong-files`, `failed-download`, `key-scope`, `preview`.

## Fixtures (`e2e/fixtures/`)
- `manifest.json` references books by ASIN only; title/author/narrator come from Audnexus at fake-arr image build (`--offline-fixtures` / `--metadata` for offline).
- ffmpeg only in the builder stage: multi-file tagged mp3s (album/album_artist/composer/track), m4b with chapters, `Title [B0…]` folder, `wrong-files`. ~250 KB total.

## Bootstrap (`e2e/bootstrap.ts`, Playwright globalSetup in the runner, idempotent)
1. ABS: `/init` root user → `/login` → library `/media/audiobooks` → API key (`/api/api-keys`, legacy token fallback).
2. Wait RMAB `/api/health`; `GET /api/setup/status`.
3. `POST /api/setup/complete` (ABS + `authMethod: manual` + `registration` + local admin; or Plex mode with fake Plex), both fake download clients, indexers 1 (torrent) and 2 (usenet). Already set up → admin login.
4. Writes `auth.json`, `storage-state.json`, `bootstrap-ok` (missing marker + failed run → exit 2).

## Specs (`e2e/specs/`)
| Spec | Asserts |
|---|---|
| `smoke.spec.ts` | UI login (ABS form, or Plex-mode Admin Login toggle) → search → card Request → qBit add → downloaded → ABS item / fake Plex album → `available` (scan + recently-added jobs) → "In Your Library"; Prowlarr key never off the Prowlarr origin |
| `regressions/275-transient-grab.spec.ts` | A's grab answered 503, then B fetched after it (fails here on pre-fix code), qBit got only B, request completes |
| `upgrade.spec.ts` | Seed (available/downloading/failed) on the release image; after upgrade: health, admin login (API, then UI via `loginAdminUi` in either backend mode), statuses kept, stored Prowlarr key decrypts. `run.mjs` adds exact host-side row counts: users/audiobooks/requests/download_history/api_tokens/blocked_releases unchanged (snapshot after counts settle), no table shrinks |
| `preview-seed.spec.ts` | Preview has `available`, `downloading`, `failed` requests and one library book |
| `regressions/242-delete-guard.spec.ts` | #242: post-import cleanup never deletes library content (sha256 snapshots of `/media`+`/downloads`, symlinks, Bull enqueue; `--overrides media-bind` for case 1E); exec bridge required |
| `regressions/242-torrent-seeding.spec.ts`, `242-usenet-mapped.spec.ts` | #242 torrent keeps seeding; usenet with remote path mapping (`--overrides sab-remote`); exec bridge required |
| `regressions/verified-import.spec.ts` | Verified-import cleanup cases 1-6: partial usenet import keeps the download, selected-file manual cleanup, interrupted copy (app SIGSTOPped at the first partial, SIGKILLed, Bull re-run), truncated target re-copied, same-name file kept, symlinked library entry kept; exec bridge required |
| `regressions/verified-import-mapped.spec.ts` | Verified-import case 7: a broad mapped client path never bounds the empty-folder sweep (`--overrides sab-remote`, `sabStorageDir`); exec bridge required |
| `regressions/sec-shell-exec.spec.ts` | #351: a release folder named with `$(...)`, backticks and a quote goes through download + chapter merge; no sentinel file, no shell `touch` signature, ffprobe reads the literal path; exec bridge required |
| `harness/exec-bridge.spec.ts` | Bridge works untainted (psql, `-u 1000:1000`, non-zero exit throws); absent when tainted |
- Helpers: `e2e/lib/harness.ts` (`Rmab`, `Abs`, `fakeArr`, `keyLeaks`, `waitFor`, `snap`, `loginAdminUi`: /login admin form in either backend mode, clicking the Plex-mode "Admin Login" toggle). Host-side: `e2e/lib/runner.mjs` (runner container, recorder, canary, isolation probes, row counts).

## Cleanup (every stack/unit run, in `finally`, incl. failures)
- Before: `down -v` the project. Disk ceiling: `docker system df` images+cache+volumes > 50 GB → prune `rmab-e2e-*` stacks with no running container (never the preview), images labelled with this run's slug, our dangling images, and the build cache (cap 15 GB). Pool-safe: other slots' stacks and images are never touched.
- After: `down -v --remove-orphans`; remove images this run built (only if labelled `rmab-e2e=true`) and images it pulled; `image prune -f --filter label=rmab-e2e=true`. No routine `builder prune`.
- Kept between runs: the preview stack and its image, plus shared bases (Playwright ~2.5 GB, Audiobookshelf ~0.36 GB).

## Critical Issues
- Unit tests must not reach the network: `e2e:unit` runs `--network none`, so an unmocked call hangs to the 20 s timeout even though host `npm test` passes.
- `setup/complete` with `authMethod: manual` 500s without a `registration` object (after writing part of the config); bootstrap always sends one.
- A daemon with broken ghcr.io credentials fails even public pulls (`denied: denied`). `--upgrade-from` falls back to `e2e/lib/fetch-image.mjs`: anonymous registry API, every descriptor validated (`sha256:` + 64 hex, safe-integer size) before use, blobs checked for digest and size, OCI layout + `manifest.json` → `docker load`.

## Related
- [../testing.md](../testing.md) (unit suite), [../deployment/docker.md](../deployment/docker.md), [../phase3/README.md](../phase3/README.md), [../phase3/qbittorrent.md](../phase3/qbittorrent.md), [../phase3/sabnzbd.md](../phase3/sabnzbd.md), [../backend/services/jobs.md](../backend/services/jobs.md)
