/**
 * Component: Discord Bot Token Mask
 * Documentation: documentation/integrations/discord-bot.md
 *
 * Shared by the settings API and the Discord tab (no server imports). The token is
 * never sent back to the browser: the tab sees this mask, and sending the mask back
 * keeps the saved token. That is safe here because the token only ever goes to
 * discord.com (no admin-set address it could be sent to).
 */

export const DISCORD_TOKEN_MASK = '••••••••••••';

/** True for the mask (any run of mask dots, as other settings use shorter masks). */
export function isMaskedToken(value: string | null | undefined): boolean {
  return typeof value === 'string' && /^•+$/.test(value);
}
