/**
 * Component: Discord Card Message Sending
 * Documentation: documentation/integrations/discord-bot.md
 *
 * Posts, DMs and edits messages through the running client's REST handler, with raw API
 * paths built only from IDs checked as snowflakes. Every body carries `allowed_mentions`
 * (the client's default does not apply to raw REST calls), so nothing pings unless the body
 * lists the role itself.
 */

import type { Client } from 'discord.js';
import { isSnowflake } from '../discord-snowflake';
import { NO_MENTIONS_RAW, type MessageBody } from './discord-card-embeds';

export type CardKind = 'public' | 'dm' | 'approval';

/** One stored card (Request.discordCards entry). */
export interface CardRef {
  kind: CardKind;
  channelId: string;
  messageId: string;
}

/** The slice of discord.js's REST handler used here. */
export interface CardRest {
  post(route: `/${string}`, options: { body: unknown }): Promise<unknown>;
  patch(route: `/${string}`, options: { body: unknown }): Promise<unknown>;
}

const KINDS: readonly CardKind[] = ['public', 'dm', 'approval'];

/** The valid entries of a stored Request.discordCards value (anything else is dropped). */
export function parseCardRefs(value: unknown): CardRef[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const ref = entry as Partial<CardRef> | null;
    if (!ref || !KINDS.includes(ref.kind as CardKind) || !isSnowflake(ref.channelId) || !isSnowflake(ref.messageId)) return [];
    return [{ kind: ref.kind as CardKind, channelId: ref.channelId as string, messageId: ref.messageId as string }];
  });
}

function withMentions(body: MessageBody): MessageBody {
  return { ...body, allowed_mentions: body.allowed_mentions ?? NO_MENTIONS_RAW };
}

function idOf(value: unknown, key: 'id' | 'channel_id'): string {
  const id = (value as Record<string, unknown> | null)?.[key];
  if (!isSnowflake(id)) throw new Error(`Discord returned no ${key}`);
  return id as string;
}

export class CardMessenger {
  constructor(private readonly rest: CardRest) {}

  static fromClient(client: Client): CardMessenger {
    return new CardMessenger(client.rest as unknown as CardRest);
  }

  /** Posts to a server channel. */
  async send(kind: CardKind, channelId: string, body: MessageBody): Promise<CardRef> {
    if (!isSnowflake(channelId)) throw new Error('Invalid channel ID');
    const message = await this.rest.post(`/channels/${channelId}/messages`, { body: withMentions(body) });
    return { kind, channelId: idOf(message, 'channel_id'), messageId: idOf(message, 'id') };
  }

  /** Opens (or reuses) the DM channel with a Discord user and posts there. */
  async sendDm(kind: CardKind, discordUserId: string, body: MessageBody): Promise<CardRef> {
    if (!isSnowflake(discordUserId)) throw new Error('Invalid Discord user ID');
    const channel = await this.rest.post('/users/@me/channels', { body: { recipient_id: discordUserId } });
    return this.send(kind, idOf(channel, 'id'), body);
  }

  async edit(ref: CardRef, body: MessageBody): Promise<void> {
    if (!isSnowflake(ref.channelId) || !isSnowflake(ref.messageId)) throw new Error('Invalid card reference');
    await this.rest.patch(`/channels/${ref.channelId}/messages/${ref.messageId}`, { body: withMentions(body) });
  }
}
