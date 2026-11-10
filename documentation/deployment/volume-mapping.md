# Volume Mapping Guide (Download Clients)

**Status:** Reference | qBittorrent + SABnzbd path alignment with RMAB

## The Golden Rule

Both your download client and RMAB must see files at the **SAME path**.

If qBittorrent saves to `/downloads/audiobook.m4b`, RMAB must also see it at `/downloads/audiobook.m4b` — not `/data/downloads/audiobook.m4b` or any other path.

---

## Docker Compose Setup

```yaml
services:
  qbittorrent:
    image: lscr.io/linuxserver/qbittorrent:latest
    volumes:
      - /path/on/host/downloads:/downloads      # Download location
    # ... other settings

  readmeabook:
    image: ghcr.io/kikootwo/readmeabook:latest
    volumes:
      - /path/on/host/downloads:/downloads      # SAME path as qBittorrent!
    # ... other settings
```

**Key Points:**
- **Left side** (`/path/on/host`): Your actual server paths — can be different per container
- **Right side** (`/downloads`): Container paths — **MUST BE IDENTICAL** between download client and RMAB

---

## RMAB Settings Configuration

In the setup wizard or admin settings:

| Setting | Value | Notes |
|---------|-------|-------|
| Download Directory | `/downloads` | Must match download client's save path |

---

## Common Mistakes

### Wrong: Different container paths

```yaml
qbittorrent:
  volumes:
    - /host/downloads:/data/torrents    # qBittorrent sees /data/torrents

readmeabook:
  volumes:
    - /host/downloads:/downloads        # RMAB sees /downloads
```

**Result:** RMAB can't find files — paths don't match inside containers.

### Correct: Identical container paths

```yaml
qbittorrent:
  volumes:
    - /host/downloads:/downloads        # Both see /downloads

readmeabook:
  volumes:
    - /host/downloads:/downloads        # Both see /downloads
```

---

## Verification Checklist

1. **Check download client settings:**
   - qBittorrent: Web UI → Options → Downloads → Default Save Path
   - SABnzbd: Config → Folders → Completed Download Folder
   - Should be `/downloads` (or your mapped path)

2. **Check RMAB settings:**
   - Download Directory: Should be within the mapped volume, e.g., `/downloads/RMAB`

3. **Test download:**
   - Request an audiobook
   - Check RMAB logs for path information
   - Look for `organizePath` in logs — should show a valid path
   - A `warn` that qBittorrent "didn't move it from ... to the save path" means qBittorrent finished in its incomplete folder and couldn't move the files: make RMAB's download directory (after remote path mapping) writable by qBittorrent ([qbittorrent.md](../phase3/qbittorrent.md#completion--relocation-grace))

---

## Quick Example

**Scenario:** Downloads on `/mnt/storage/downloads`

```yaml
services:
  qbittorrent:
    volumes:
      - /mnt/storage/downloads:/downloads

  readmeabook:
    volumes:
      - /mnt/storage/downloads:/downloads
```

**RMAB Settings:**
- Download Directory: `/downloads/RMAB`

**qBittorrent Settings:**
- Default Save Path: `/downloads`

Files will be found correctly because all paths align.

---

## Usenet Categories RMAB Did Not Create

- Picking a SABnzbd/NZBGet category that already exists (another app's) means RMAB never changes it: jobs land in **that category's folder**, with its settings (sorter, post-processing script)
- RMAB imports from the path the client reports, and takes every audio file in it, so that folder must be visible to RMAB at the same path (or through remote path mapping). Otherwise the job log shows `Organization failed: ENOENT: no such file or directory, stat '<path>'` and, after the import retries, the request is left at `warn` with `File organization failed: ENOENT: no such file or directory, stat '<path>'. Max retries (N) exceeded. Manual retry available.` (the release is then blocklisted as "Organize failed")
- After import, cleanup removes only the imported files there, never the folder's other contents, and nothing at all when the job has no folder of its own (it reports the category's folder itself) or the folders can't be worked out as absolute paths (SABnzbd's default relative `complete_dir`)
- qBittorrent is different: a shared category's torrents still download to RMAB's folder (Manual mode)

## Remote Path Mapping (Advanced)

**Note:** 99% of users don't need this. If your download client and RMAB run on the same machine or have access to the same file system (a NAS for example) with matching volume mounts (as shown above), skip this section.

### When You Need It

Remote path mapping is required when:
- Download client runs on a **totally remote** machine (separate from RMAB)
- Download client runs on the **host** while RMAB runs in Docker
- Download client and RMAB have **different volume mount points** that can't be aligned

### How It Works

When enabled, RMAB translates paths reported by the download client:

```
Download client reports: /data/torrents/audiobook.m4b  (remotePath)
RMAB translates to:      /downloads/audiobook.m4b      (localPath)
```

---