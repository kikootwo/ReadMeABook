/**
 * Component: Discord Message Building Blocks
 * Documentation: documentation/integrations/discord-bot.md
 *
 * Raw Discord API values and text helpers for replies, so the handlers never import
 * discord.js (it stays unloaded until the bot is configured; discord.js accepts these
 * plain JSON shapes for components, modals and embeds).
 */

/** discord-api-types v10 values used by the handlers. */
export const ComponentType = { ActionRow: 1, Button: 2, StringSelect: 3, TextInput: 4 } as const;
export const ButtonStyle = { Primary: 1, Secondary: 2 } as const;
export const TextInputStyle = { Short: 1 } as const;
export const MessageFlags = { Ephemeral: 64 } as const;
export const ApplicationCommandType = { ChatInput: 1 } as const;
export const ApplicationCommandOptionType = { String: 3 } as const;

/** Discord's limits for the fields the bot fills. */
export const DISCORD_LIMITS = {
  embedTitle: 256,
  embedFieldValue: 1024,
  selectOptions: 25,
  selectLabel: 100,
  selectDescription: 100,
  content: 2000,
} as const;

/** Mentions are never parsed from bot text (the client default too). */
export const NO_MENTIONS = { parse: [] as never[] };

/** Single line, trimmed, at most `max` characters (an ellipsis marks a cut). */
export function clip(value: string, max: number): string {
  const line = value.replace(/\s+/g, ' ').trim();
  return line.length <= max ? line : `${line.slice(0, max - 1)}…`;
}

/**
 * Escapes Discord markdown so book text (any user can rename a book through a request)
 * shows as written: no formatting, links, headings, lists, quotes or spoilers. A
 * backslash before any ASCII punctuation is dropped by Discord, so over-escaping is safe.
 */
export function escapeMarkdown(value: string): string {
  return value.replace(/[\\*_~`|>#\-[\]()<:@!.+=]/g, '\\$&');
}

/** Escaped for markdown, single line, cut so the escaped text fits `max`. */
export function safeText(value: string | null | undefined, max: number): string {
  if (!value) return '';
  let cut = max;
  let text = escapeMarkdown(clip(value, cut));
  while (text.length > max && cut > 2) {
    cut -= 1;
    text = escapeMarkdown(clip(value, cut));
  }
  return text;
}
