/**
 * Component: Discord Bot Service (gateway lifecycle)
 * Documentation: documentation/integrations/discord-bot.md
 *
 * One bot client per process (globalThis singleton). discord.js is loaded only after the
 * settings say the bot is configured, and only once per process. A generation counter
 * makes start/stop/restart safe to interleave: a start that a later stop or restart has
 * superseded never keeps its client. start() never throws; failures are logged and shown
 * on the settings tab as the bot status.
 */

import type { Client } from 'discord.js';
import { RMABLogger } from '@/lib/utils/logger';
import { processSingleton } from '@/lib/utils/process-singleton';
import { errorForLog } from '@/lib/utils/zod-validation';
import { isDiscordConfigured, loadDiscordConfig } from './discord-config';
import { setDiscordBotRunning } from './discord-runtime';
import { DISCORD_COMMANDS, routeInteraction, type RoutableInteraction } from './discord-interaction-router';

const logger = RMABLogger.create('Discord.Bot');

export type DiscordBotState = 'stopped' | 'starting' | 'running' | 'failed';

export interface DiscordBotStatus {
  state: DiscordBotState;
  /** The bot's Discord name while running. */
  botTag?: string;
  /** A short reason when the last start failed (never the token). */
  lastError?: string;
}

type DiscordModule = typeof import('discord.js');

interface BotState {
  generation: number;
  client: Client | null;
  status: DiscordBotStatus;
  /** discord.js, loaded once per process on the first configured start. */
  library?: Promise<DiscordModule>;
}

function botState(): BotState {
  return processSingleton<BotState>('discord-bot', () => ({ generation: 0, client: null, status: { state: 'stopped' } }));
}

function loadLibrary(state: BotState): Promise<DiscordModule> {
  if (!state.library) {
    state.library = import('discord.js');
    // A failed load is retried on the next start
    state.library.catch(() => { state.library = undefined; });
  }
  return state.library;
}

/** A failure reason safe to show an admin (discord.js messages carry no secrets; cap the length anyway). */
function shortReason(error: unknown): string {
  return errorForLog(error).slice(0, 200);
}

export class DiscordBotService {
  /** Starts the bot when configured. Resolves once logged in, failed, skipped or superseded. */
  async start(): Promise<void> {
    const state = botState();
    const generation = ++state.generation;
    const superseded = () => generation !== state.generation;

    try {
      const config = await loadDiscordConfig();
      if (superseded()) return;
      if (!isDiscordConfigured(config)) {
        const reason = !config.enabled ? 'disabled' : !config.botToken ? 'no bot token' : 'no valid server ID';
        logger.info('Discord bot not started', { reason });
        state.status = { state: 'stopped' };
        return;
      }

      state.status = { state: 'starting' };
      const { Client, Events, GatewayIntentBits } = await loadLibrary(state);
      if (superseded()) return;

      // Guilds only: roles come from interaction.member, no privileged intents.
      // No mention is parsed unless a send names it (an admin role ping lists its role).
      const client = new Client({ intents: [GatewayIntentBits.Guilds], allowedMentions: { parse: [] } });
      state.client = client;

      client.on(Events.Error, (error) => logger.warn('Discord client error', { error: errorForLog(error) }));
      client.on(Events.ShardError, (error, shardId) => logger.warn('Discord shard error', { shardId, error: errorForLog(error) }));
      client.once(Events.ClientReady, (ready) => {
        if (superseded()) return;
        state.status = { state: 'running', botTag: ready.user.tag };
        setDiscordBotRunning(true);
        logger.info('Discord bot connected', { bot: ready.user.tag });
        void this.registerCommands(ready, config.guildId);
      });
      client.on(Events.InteractionCreate, (interaction) => {
        void this.onInteraction(interaction as unknown as RoutableInteraction, config.guildId);
      });

      await client.login(config.botToken);
      if (superseded()) {
        await destroyQuietly(client);
      }
    } catch (error) {
      if (superseded()) return;
      logger.error('Failed to start the Discord bot', { error: errorForLog(error) });
      const failed = state.client;
      state.client = null;
      state.status = { state: 'failed', lastError: shortReason(error) };
      setDiscordBotRunning(false);
      if (failed) await destroyQuietly(failed);
    }
  }

  /** Disconnects the bot. Any start still in progress is superseded. */
  async stop(): Promise<void> {
    const state = botState();
    state.generation++;
    const client = state.client;
    state.client = null;
    state.status = { state: 'stopped' };
    setDiscordBotRunning(false);
    if (client) {
      await destroyQuietly(client);
      logger.info('Discord bot stopped');
    }
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  /** The live client, or null when not started or not ready to use. */
  getClient(): Client | null {
    return botState().client;
  }

  getStatus(): DiscordBotStatus {
    return { ...botState().status };
  }

  /** Bulk-overwrites the server's commands with the current list (empty clears stale ones). */
  private async registerCommands(client: Client<true>, guildId: string): Promise<void> {
    try {
      await client.application.commands.set(DISCORD_COMMANDS as never[], guildId);
    } catch (error) {
      logger.warn('Could not register Discord commands (is the bot in the server?)', { guildId, error: errorForLog(error) });
    }
  }

  private async onInteraction(interaction: RoutableInteraction, guildId: string): Promise<void> {
    try {
      const outcome = await routeInteraction(interaction, guildId);
      if (outcome === 'ignored-foreign-guild') {
        logger.debug('Ignored a Discord interaction from another server', { guildId: interaction.guildId });
      }
    } catch (error) {
      logger.warn('Discord interaction failed', { error: errorForLog(error) });
    }
  }
}

async function destroyQuietly(client: Client): Promise<void> {
  try {
    await client.destroy();
  } catch (error) {
    logger.debug('Discord client destroy failed', { error: errorForLog(error) });
  }
}

// Stateless: every copy of this module shares the globalThis state above
const service = new DiscordBotService();

export function getDiscordBotService(): DiscordBotService {
  return service;
}
