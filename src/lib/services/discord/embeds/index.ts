/**
 * Component: Discord Embed & Component Builders (barrel)
 * Documentation: documentation/integrations/discord-bot.md
 *
 * Re-exports the bot's embed/select/button builders. Split into focused modules to stay within the
 * per-file size limit while keeping a single `./embeds` import surface:
 *  - book-fields:   shared palette, text helpers, BookEmbedFields, status footer/color/cancellability
 *  - request-cards: /request search select, confirm card, live request card
 *  - approval:      admin approval message + decision/cancellation rewrites
 *  - lists:         /status & /delete paginated lists, selects, delete-confirm embed
 */

export * from './book-fields';
export * from './request-cards';
export * from './approval';
export * from './lists';
