/**
 * Component: Discord command definition tests
 * Documentation: documentation/integrations/discord-bot.md
 *
 * The /request type choices must reflect what is actually requestable: offering "E-book" when no
 * e-book source is configured leads the user into a request that can only fail.
 */

import { describe, expect, it } from 'vitest';
import { buildCommandDefinitions } from '@/lib/services/discord/command-definitions';

/** The builders in this discord.js version expose the raw command shape directly. */
const requestCommand = (ebookEnabled: boolean) =>
  buildCommandDefinitions('own_only', ebookEnabled).find(
    (c) => (c as any).name === 'request'
  ) as any;

const optionNamed = (ebookEnabled: boolean, name: string) =>
  requestCommand(ebookEnabled).options.find((o: any) => (o.name ?? o.data?.name) === name);

const typeChoices = (ebookEnabled: boolean) => {
  const type = optionNamed(ebookEnabled, 'type');
  return (type.choices ?? type.data?.choices).map((c: any) => c.value);
};

describe('/request type choices', () => {
  it('offers both types when an e-book source is enabled', () => {
    expect(typeChoices(true)).toEqual(['audiobook', 'ebook']);
  });

  it('omits E-book entirely when no e-book source is enabled', () => {
    expect(typeChoices(false)).toEqual(['audiobook']);
  });

  it('always keeps the query option available', () => {
    for (const enabled of [true, false]) {
      expect(optionNamed(enabled, 'query')).toBeDefined();
    }
  });
});
