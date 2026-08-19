/**
 * Component: Discord Bot Service
 * Documentation: documentation/integrations/discord-bot.md
 *
 * Owns the persistent discord.js gateway client (a process-wide singleton). Started once at app
 * init when the bot is configured + enabled; registers guild-scoped slash commands on `ready` and
 * routes every interaction to the interaction router. All failures are caught and logged so a
 * misconfigured or unreachable bot never affects the rest of the app.
 *
 * Lazy loading: `discord.js` and the bot's command/router modules are loaded via dynamic `import()`
 * inside start()/registerCommands(), never at module scope. The `Client` type below is a type-only
 * import, which is erased at compile time. This means that when the bot is disabled, importing this
 * service (e.g. from /api/init) pulls in nothing from discord.js — zero runtime footprint until the
 * bot is actually enabled and started.
 */

import { RMABLogger } from '@/lib/utils/logger';
import { getDiscordConfig, isDiscordBotConfigured, type DiscordConfig } from './discord-config';
import type { Client } from 'discord.js';

const logger = RMABLogger.create('Discord.Bot');

class DiscordBotService {
  private client: Client | null = null;
  /** The in-flight start, so concurrent callers join it rather than racing past it. */
  private starting: Promise<void> | null = null;
  private ready = false;
  /**
   * Bumped on every stop(). A start that is mid-login when the epoch moves has been superseded, and
   * tears its own connection down instead of publishing a client built from stale config.
   */
  private generation = 0;

  /** True once the gateway client has logged in and emitted `ready`. */
  isReady(): boolean {
    return this.ready;
  }

  /**
   * The live gateway client, or null when the bot is stopped/not ready. Used by background work
   * (e.g. the notification hook that edits request cards) to act outside an interaction.
   */
  getClient(): Client | null {
    return this.ready ? this.client : null;
  }

  /**
   * Start the bot if configured + enabled. Idempotent: a call while one is already running is a
   * no-op, and a call while one is starting joins that start rather than returning early. Safe to
   * call from /api/init on every container start.
   */
  async start(): Promise<void> {
    if (this.client) return;
    if (this.starting) return this.starting;

    this.starting = this.doStart();
    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
  }

  private async doStart(): Promise<void> {
    // Snapshot the epoch: if stop() bumps it while we are logging in, this attempt is stale.
    const epoch = this.generation;

    const config = await getDiscordConfig();
    if (!isDiscordBotConfigured(config)) {
      logger.info('Discord bot not started (disabled or missing token/guild)');
      return;
    }

    try {
      // Lazy-load discord.js + the bot's router only once we know the bot is enabled.
      const { Client, Events, GatewayIntentBits, Partials } = await import('discord.js');
      const { routeInteraction } = await import('./interaction-router');

      const client = new Client({
        intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
        // DMChannel partial lets us send approval DMs to users we haven't cached
        partials: [Partials.Channel],
      });

      client.once(Events.ClientReady, async (readyClient) => {
        // A superseded connection must not flip the service to ready.
        if (this.generation !== epoch) return;
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

      // stop()/restart() landed while login() was in flight, so this client was built from config
      // that is already stale. Tear it down rather than publishing it; the caller that bumped the
      // epoch is responsible for starting the replacement.
      if (this.generation !== epoch) {
        logger.info('Discarding superseded Discord gateway connection');
        await client.destroy().catch(() => undefined);
        return;
      }

      this.client = client;
    } catch (error) {
      logger.error('Failed to start Discord bot', {
        error: error instanceof Error ? error.message : String(error),
      });
      this.client = null;
      this.ready = false;
    }
  }

  /** Stop the bot and release the gateway connection. */
  async stop(): Promise<void> {
    // Bump first so any start mid-login sees the epoch move and discards itself.
    this.generation++;
    this.ready = false;

    // Detach before awaiting destroy() so a concurrent start never observes a half-torn-down client.
    const client = this.client;
    this.client = null;
    if (client) {
      try {
        await client.destroy();
      } catch (error) {
        logger.warn('Error while stopping Discord bot', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /**
   * Restart with the latest config (e.g. after a settings change).
   *
   * Drains any in-flight start first. Without that, a start that is mid-login has not yet assigned
   * this.client, so stop() would find nothing to destroy and the follow-up start() would join the
   * doomed in-flight attempt -- leaving the admin's saved settings silently unapplied while the old
   * connection stayed live.
   */
  async restart(): Promise<void> {
    if (this.starting) {
      await this.starting.catch(() => undefined);
    }
    await this.stop();
    await this.start();
  }

  /** Register the slash commands for the configured guild (instant propagation; idempotent upsert). */
  private async registerCommands(config: DiscordConfig, applicationId: string): Promise<void> {
    if (!config.botToken || !config.guildId) return;

    const { REST, Routes } = await import('discord.js');
    const { buildCommandDefinitions } = await import('./command-definitions');
    const commands = buildCommandDefinitions(config.deletePermission);
    const rest = new REST({ version: '10' }).setToken(config.botToken);
    await rest.put(Routes.applicationGuildCommands(applicationId, config.guildId), {
      body: commands,
    });
    logger.info('Registered slash commands', { guildId: config.guildId, count: commands.length });
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
