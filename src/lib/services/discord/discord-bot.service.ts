/**
 * Component: Discord Bot Service
 * Documentation: documentation/integrations/discord-bot.md
 *
 * Owns the persistent discord.js gateway client (a process-wide singleton). Started once at app
 * init when the bot is configured + enabled; registers guild-scoped slash commands on `ready` and
 * routes every interaction to the interaction router. All failures are caught and logged so a
 * misconfigured or unreachable bot never affects the rest of the app.
 */

import {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
} from 'discord.js';
import { RMABLogger } from '@/lib/utils/logger';
import { getDiscordConfig, isDiscordBotConfigured, type DiscordConfig } from './discord-config';
import { commandDefinitions } from './command-definitions';
import { routeInteraction } from './interaction-router';

const logger = RMABLogger.create('Discord.Bot');

class DiscordBotService {
  private client: Client | null = null;
  private starting = false;
  private ready = false;

  /** True once the gateway client has logged in and emitted `ready`. */
  isReady(): boolean {
    return this.ready;
  }

  /**
   * Start the bot if configured + enabled. Idempotent: repeated calls while running/starting are
   * no-ops. Safe to call from /api/init on every container start.
   */
  async start(): Promise<void> {
    if (this.client || this.starting) {
      return;
    }

    const config = await getDiscordConfig();
    if (!isDiscordBotConfigured(config)) {
      logger.info('Discord bot not started (disabled or missing token/guild)');
      return;
    }

    this.starting = true;
    try {
      const client = new Client({
        intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
        // DMChannel partial lets us send approval DMs to users we haven't cached
        partials: [Partials.Channel],
      });

      client.once(Events.ClientReady, async (readyClient) => {
        this.ready = true;
        logger.info(`Discord bot logged in as ${readyClient.user.tag}`);
        await this.registerCommands(config, readyClient.user.id).catch((error) => {
          logger.error('Failed to register slash commands', {
            error: error instanceof Error ? error.message : String(error),
          });
        });
      });

      client.on(Events.InteractionCreate, (interaction) => {
        void routeInteraction(interaction);
      });

      client.on(Events.Error, (error) => {
        logger.error('Discord client error', { error: error.message });
      });
      client.on(Events.ShardDisconnect, () => {
        this.ready = false;
        logger.warn('Discord gateway disconnected');
      });
      client.on(Events.ShardReconnecting, () => {
        logger.info('Discord gateway reconnecting');
      });
      client.on(Events.ShardResume, () => {
        this.ready = true;
        logger.info('Discord gateway resumed');
      });

      await client.login(config.botToken!);
      this.client = client;
    } catch (error) {
      logger.error('Failed to start Discord bot', {
        error: error instanceof Error ? error.message : String(error),
      });
      this.client = null;
      this.ready = false;
    } finally {
      this.starting = false;
    }
  }

  /** Stop the bot and release the gateway connection. */
  async stop(): Promise<void> {
    this.ready = false;
    if (this.client) {
      try {
        await this.client.destroy();
      } catch (error) {
        logger.warn('Error while stopping Discord bot', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      this.client = null;
    }
  }

  /** Restart with the latest config (e.g. after a settings change). */
  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  /** Register the slash commands for the configured guild (instant propagation; idempotent upsert). */
  private async registerCommands(config: DiscordConfig, applicationId: string): Promise<void> {
    if (!config.botToken || !config.guildId) return;

    const rest = new REST({ version: '10' }).setToken(config.botToken);
    await rest.put(Routes.applicationGuildCommands(applicationId, config.guildId), {
      body: commandDefinitions,
    });
    logger.info('Registered slash commands', { guildId: config.guildId, count: commandDefinitions.length });
  }
}

// Process-wide singleton
let instance: DiscordBotService | null = null;

export function getDiscordBotService(): DiscordBotService {
  if (!instance) {
    instance = new DiscordBotService();
  }
  return instance;
}
