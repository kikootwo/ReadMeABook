<div align="center">

![RMAB_hero.png](screenshots/RMAB_hero.png)

### Audiobook automation for Plex and Audiobookshelf

<div align="center">

  [![Ko-Fi](https://img.shields.io/badge/Ko--fi-F16061?style=for-the-badge&logo=ko-fi&logoColor=white)](https://ko-fi.com/kikootwo)
  [![GitHub Sponsors](https://img.shields.io/github/sponsors/kikootwo?style=for-the-badge&logo=github&logoColor=white&label=Sponsor&color=EA4AAA)](https://github.com/sponsors/kikootwo)
  [![Build Status](https://img.shields.io/github/actions/workflow/status/kikootwo/readmeabook/build-unified-image.yml?branch=main&style=for-the-badge&logo=github&label=Build)](https://github.com/kikootwo/readmeabook/actions/workflows/build-unified-image.yml)
  [![Tests](https://img.shields.io/github/actions/workflow/status/kikootwo/readmeabook/run-tests.yml?branch=main&style=for-the-badge&logo=github&label=Tests)](https://github.com/kikootwo/readmeabook/actions/workflows/run-tests.yml)
  [![Docker Pulls](https://img.shields.io/docker/pulls/kikootwo/readmeabook?style=for-the-badge&logo=docker&logoColor=white)](https://github.com/kikootwo/readmeabook/pkgs/container/readmeabook)
  [![License](https://img.shields.io/badge/License-AGPL%20v3-blue.svg?style=for-the-badge)](https://www.gnu.org/licenses/agpl-3.0)
  [![GitHub Stars](https://img.shields.io/github/stars/kikootwo/readmeabook?style=for-the-badge&logo=github)](https://github.com/kikootwo/readmeabook/stargazers)
  [![Discord](https://img.shields.io/discord/1450562177277755464?style=for-the-badge&logo=discord&logoColor=white&label=Discord)](https://discord.gg/kaw6jKbKts)
</div>

*Radarr/Sonarr + Overseerr for audiobooks, all in one*

[Features](#features) • [Setup](#setup) • [Screenshots](#screenshots) • [Discord](#community)

</div>

---

## What is this?

You run Plex or Audiobookshelf with audiobooks. You want more audiobooks. You search indexers, download torrents or NZBs, organize files, wait for your server to scan. ReadMeABook does all of that automatically.

Request a book → Prowlarr searches → qBittorrent or SABnzbd downloads → Files organized → Library imports. Done.

Also includes BookDate: AI recommendations with a Tinder-style swipe interface. Swipe right to request.

User friendly audible-backed searches, multi-file chapter merging, e-book sidecar support, OIDC OAuth, admin approval workflows, and more.

## Features

- **Plex** or **Audiobookshelf**
- **Torrents** via qBittorrent
- **Usenet** via SABnzbd
- **Prowlarr** for indexer search (torrents + NZBs)
- **BookDate**: AI recommendations (OpenAI/Claude/Local) with swipe interface
- **Chapter merging**: Multi-file downloads → single M4B with chapters
- **E-book sidecar**: Optional EPUB/PDF downloads from Shadow Library
- **Request approval**: Admin approval workflow for multi-user setups
- **Setup wizard**: Step-by-step guided config with connection testing

## Setup

**Prerequisites:** Docker, Plex or Audiobookshelf, qBittorrent or SABnzbd, Prowlarr

```yaml
services:
  readmeabook:
    image: ghcr.io/kikootwo/readmeabook:latest
    container_name: readmeabook
    restart: unless-stopped
    ports:
      - "3030:3030"
    volumes:
      - ./config:/app/config
      - ./cache:/app/cache
      - ./downloads:/downloads        # Your download client's path
      - ./media:/media                # Your audiobook library
      - ./pgdata:/var/lib/postgresql/data
      - ./redis:/var/lib/redis
    environment:
      PUID: 1000                      # Optional: your user ID
      PGID: 1000                      # Optional: your group ID
      PUBLIC_URL: "https://audiobooks.example.com"  # Required for OAuth
```

```bash
docker compose up -d
```

Open http://localhost:3030 and follow the setup wizard.

## Screenshots

<img WIDTH="720" alt="image" src="screenshots/HOMEPAGE.png" />
<img WIDTH="720" alt="image" src="screenshots/ADMIN.png" />
<img WIDTH="720" alt="image" src="screenshots/BOOKDATE.png" />

## Community

Join the Discord: https://discord.gg/kaw6jKbKts

Feature and fix Contributions are highly welcome. Documentation in `documentation/` if you want to contribute. Discord is a great place to ask questions!

## Support

If you find this project useful, consider supporting development via [GitHub Sponsors]()

If you'd like to support but cannot sponsor, a simple star on the GitHub repo is also greatly appreciated!

---

<div align="center">

**AGPL v3 License**

</div>
