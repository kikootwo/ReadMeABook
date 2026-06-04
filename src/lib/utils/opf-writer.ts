import fs from 'fs/promises';
import path from 'path';
import type { AudiobookMetadata } from './file-organizer';

function escapeXml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function writeOpfMetadata(
  targetDirectory: string,
  audiobook: AudiobookMetadata,
  filename = 'metadata.opf'
): Promise<string> {
  const opfPath = path.join(targetDirectory, filename);

  const identifier = audiobook.asin || `${audiobook.author}-${audiobook.title}`;
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="2.0">',
    '  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:calibre="http://calibre.kovidgoyal.net/2009/metadata">',
    `    <dc:identifier id="BookId">${escapeXml(identifier)}</dc:identifier>`,
    `    <dc:title>${escapeXml(audiobook.title)}</dc:title>`,
    `    <dc:creator>${escapeXml(audiobook.author)}</dc:creator>`,
  ];

  if (audiobook.narrator) {
    lines.push(`    <meta name="narrator" content="${escapeXml(audiobook.narrator)}"/>`);
  }

  if (audiobook.year) {
    lines.push(`    <dc:date>${escapeXml(audiobook.year)}</dc:date>`);
    lines.push(`    <meta name="calibre:publication_year" content="${escapeXml(audiobook.year)}"/>`);
  }

  if (audiobook.asin) {
    lines.push(`    <meta name="asin" content="${escapeXml(audiobook.asin)}"/>`);
  }

  if (audiobook.series) {
    lines.push(`    <meta name="calibre:series" content="${escapeXml(audiobook.series)}"/>`);
  }

  if (audiobook.seriesPart) {
    lines.push(`    <meta name="calibre:series_index" content="${escapeXml(audiobook.seriesPart)}"/>`);
  }

  lines.push('  </metadata>');
  lines.push('</package>');
  lines.push('');

  await fs.writeFile(opfPath, lines.join('\n'), 'utf8');
  return opfPath;
}