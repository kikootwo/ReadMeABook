/**
 * Component: Request with Specific Torrent API, request body schema
 * Documentation: documentation/phase3/prowlarr.md
 */

import { z } from 'zod';

export const RequestWithTorrentSchema = z.object({
  audiobook: z.object({
    asin: z.string(),
    title: z.string(),
    author: z.string(),
    narrator: z.string().optional(),
    description: z.string().optional(),
    coverArtUrl: z.string().optional(),
    durationMinutes: z.number().optional(),
    releaseDate: z.string().optional(),
    rating: z.number().nullable().optional(),
  }),
  torrent: z.object({
    guid: z.string(),
    title: z.string(),
    size: z.number(),
    seeders: z.number().optional(), // Optional for NZB/Usenet results
    leechers: z.number().optional(), // Optional for NZB/Usenet results
    indexer: z.string(),
    indexerId: z.number().optional(), // Prowlarr indexer ID
    downloadUrl: z.string(),
    infoUrl: z.string().optional(), // Link to indexer's info page
    publishDate: z.string().transform((str) => new Date(str)),
    infoHash: z.string().optional(),
    format: z.enum(['M4B', 'M4A', 'MP3', 'OTHER']).optional(),
    bitrate: z.string().optional(),
    hasChapters: z.boolean().optional(),
    protocol: z.enum(['torrent', 'usenet']).optional(), // Protocol from Prowlarr API
  }),
  /** Mark the request Explicit (#542); a re-request keeps the replaced request's mark either way */
  explicit: z.boolean().optional(),
});
