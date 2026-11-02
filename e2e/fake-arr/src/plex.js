/**
 * Component: E2E fake Plex Media Server (subset RMAB calls; plex.tv is never faked)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Derived from src/lib/integrations/plex.service.ts: /identity :220, /library/sections :426,
 * /library/sections/<id>/all :479/:548, /library/sections/<id>/search :639,
 * /library/sections/<id>/refresh :616, /library/metadata/<key> GET :686 / DELETE :794,
 * /library/metadata/<key>/children (tracks with Media > Part file; getItemFilePaths, request delete).
 * The library is the real shared media volume: <libraryPath>/<Author>/<Title>/ becomes one album.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { sendJson, sendText, notFound } from './http-util.js';

const SECTION_ID = '1';
const AUDIO = /\.(m4b|m4a|mp3|mp4|flac|aac|ogg|opus)$/i;
const MACHINE_ID = 'rmab-e2e-fake-plex-0001';

function libraryPath(state) {
  return process.env.PLEX_LIBRARY_PATH || path.posix.join(state.config.mediaDir, 'audiobooks');
}

/** Walk <root>/<Author>/<Title> folders into Plex album metadata. */
export function scanAlbums(state) {
  const root = libraryPath(state);
  if (!fs.existsSync(root)) return [];
  const albums = [];
  for (const author of fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    const authorDir = path.join(root, author.name);
    for (const title of fs.readdirSync(authorDir, { withFileTypes: true }).filter((d) => d.isDirectory())) {
      const dir = path.join(authorDir, title.name);
      const stat = fs.statSync(dir);
      const ratingKey = String(parseInt(createHash('sha1').update(dir).digest('hex').slice(0, 7), 16));
      // Folder names may end in an ASIN ("Title B0XXXXXXXX" or "Title [B0XXXXXXXX]"): like Plex's
      // Audible agent, expose it in the guid and keep it out of the album title.
      const asin = /(?:^|\s)\[?(B0[A-Z0-9]{8})\]?\s*$/.exec(title.name)?.[1];
      const album = {
        ratingKey,
        key: `/library/metadata/${ratingKey}/children`,
        guid: asin ? `com.plexapp.agents.audible://${asin}?lang=en` : `plex://album/e2e${ratingKey}`,
        type: 'album',
        title: title.name.replace(/\s*\[?B0[A-Z0-9]{8}\]?\s*$/, ''),
        parentTitle: author.name,
        librarySectionID: SECTION_ID,
        addedAt: Math.floor(stat.mtimeMs / 1000),
        updatedAt: Math.floor(stat.mtimeMs / 1000),
        dir,
      };
      albums.push(album);
      const files = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && AUDIO.test(e.name)).map((e) => path.posix.join(dir, e.name));
      state.plexSeen?.set(ratingKey, { album, files });
    }
  }
  return albums.sort((a, b) => b.addedAt - a.addedAt);
}

/**
 * An album by ratingKey: live from disk, else as last seen. Real Plex keeps an item (and its file
 * paths) in its database after the files are gone, until a scan empties the trash.
 */
function findAlbum(state, ratingKey) {
  scanAlbums(state);
  return state.plexSeen?.get(ratingKey) || null;
}

const container = (extra) => ({ MediaContainer: { size: 0, ...extra } });

export function handlePlex(state, req, res, url) {
  const token = req.headers['x-plex-token'] || url.searchParams.get('X-Plex-Token');
  if (token !== state.config.plexToken) return sendText(res, 401, 'Unauthorized');
  const p = url.pathname;

  if (p === '/identity') {
    return sendJson(res, 200, container({ machineIdentifier: MACHINE_ID, version: '1.41.0.8992-fake', claimed: true }));
  }
  if (p === '/library/sections') {
    return sendJson(
      res,
      200,
      container({
        size: 1,
        Directory: [{ key: SECTION_ID, type: 'artist', title: 'Audiobooks', agent: 'tv.plex.agents.music', Location: [{ id: 1, path: libraryPath(state) }] }],
      })
    );
  }
  const section = /^\/library\/sections\/(\d+)\/(all|search|refresh|recentlyAdded)$/.exec(p);
  if (section) {
    if (section[1] !== SECTION_ID) return notFound(res);
    if (section[2] === 'refresh') {
      state.plexRefreshes += 1;
      // A scan drops items whose folder is gone
      for (const [key, seen] of state.plexSeen ?? []) if (!fs.existsSync(seen.album.dir)) state.plexSeen.delete(key);
      return sendText(res, 200, '');
    }
    let albums = scanAlbums(state);
    if (section[2] === 'search') {
      const q = String(url.searchParams.get('title') || '').toLowerCase();
      albums = albums.filter((a) => a.title.toLowerCase().includes(q));
    }
    const start = Number(url.searchParams.get('X-Plex-Container-Start') || 0);
    const size = Number(url.searchParams.get('X-Plex-Container-Size') || albums.length);
    const page = albums.slice(start, start + size).map(({ dir, ...a }) => a);
    return sendJson(res, 200, container({ size: page.length, totalSize: albums.length, Metadata: page }));
  }
  // An album's tracks: one per audio file directly in its folder, with Media > Part file (the path as Plex sees it)
  const children = /^\/library\/metadata\/(\d+)\/children$/.exec(p);
  if (children) {
    const seen = findAlbum(state, children[1]);
    if (!seen) return notFound(res);
    const tracks = seen.files.map((file, i) => ({
      ratingKey: `${seen.album.ratingKey}${i + 1}`,
      type: 'track',
      title: path.posix.basename(file),
      parentRatingKey: seen.album.ratingKey,
      index: i + 1,
      Media: [{ Part: [{ file }] }],
    }));
    return sendJson(res, 200, container({ size: tracks.length, Metadata: tracks }));
  }
  const meta = /^\/library\/metadata\/(\d+)$/.exec(p);
  if (meta) {
    const seen = findAlbum(state, meta[1]);
    if (!seen) return notFound(res);
    const album = seen.album;
    if (req.method === 'DELETE') {
      // Like Plex with "allow media deletion": the item and its files go
      fs.rmSync(album.dir, { recursive: true, force: true });
      state.plexSeen?.delete(album.ratingKey);
      return sendText(res, 200, '');
    }
    const { dir, ...rest } = album;
    return sendJson(res, 200, container({ size: 1, Metadata: [rest] }));
  }
  return notFound(res);
}
