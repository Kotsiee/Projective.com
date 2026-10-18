/**
 * `@projective/types/newsletter` — a compatibility re-export. The newsletter shapes moved to
 * `@projective/types/community` with their table (`community.newsletter_subscriptions`,
 * Decision #274); import from there. This path stays so an importer written before the move keeps
 * resolving to the one definition.
 *
 * @deprecated Import from `@projective/types/community`.
 */
export * from "../community/newsletter.ts";
