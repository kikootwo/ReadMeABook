/**
 * Component: Discord ID (snowflake) Check
 * Documentation: documentation/integrations/discord-bot.md
 *
 * Shared by the server and the browser (no server imports). One rule for users,
 * servers, channels and roles.
 */

/** A Discord ID: 15 to 20 digits, no leading zero. */
export const DISCORD_SNOWFLAKE_PATTERN = /^[1-9]\d{14,19}$/;

export function isSnowflake(value: unknown): value is string {
  return typeof value === 'string' && DISCORD_SNOWFLAKE_PATTERN.test(value);
}
