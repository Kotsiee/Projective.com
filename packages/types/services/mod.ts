/**
 * @projective/types/services — the **service booking** domain barrel: the vocabulary behind every
 * conversion CTA on a listing page, and the payloads its four flows send.
 *
 * Five layers, deliberately separate:
 * - {@link ./common.ts} — the seven booking FORMATS and the CTA descriptor. One value decides both
 *   the label a buyer reads and the flow their click opens, so the two cannot disagree.
 * - {@link ./offer.ts} — the resolved commercial offer for one listing and one viewer, SSR'd so the
 *   first byte carries the right verb.
 * - {@link ./contact.ts} — the Contact Me menu: a discovery call, a question, or a custom quote.
 *   None of the three creates a project, a stage, a ticket or an escrow.
 * - {@link ./booking.ts} — the write payloads for booking a session and for scoping a fixed-price
 *   engagement, plus the single outcome shape all four flows resolve to.
 * - {@link ./pipeline.ts} — instantiating a pipeline template as a draft project, and the 30-day
 *   idle sweep that soft-archives one nobody funds.
 * - {@link ./sim.ts} — the developer simulation overlay, travelling as validated query params.
 *
 * # Where this sits
 *
 * It is a composition layer over four existing domains rather than a fifth vocabulary competing with
 * them. Slots are `@projective/types/scheduling` (`./booking.ts` there); money is
 * `@projective/types/finance`; the purchase kind is `finance.purchasable_item_kind`; the discovery
 * call is `scheduling.discovery_calls`. Nothing here re-declares any of that — it imports the public
 * slices it composes, and the dependency runs one way (services → scheduling), so there is no cycle.
 *
 * ⚠️ **No tables of its own.** These are read+write PROJECTIONS the fat services derive, in the same
 * position `projects/detail`, `projects/messages` and `finance/wallet` occupied before their live
 * paths landed. The two schema changes this layer DOES require are folded into the consolidated
 * migrations (root CLAUDE.md §1): `project_status += 'archived'`, and
 * `projects.projects.source_blueprint_id` / `.archived_at` / `.last_activity_at`.
 */
export * from "./common.ts";
export * from "./offer.ts";
export * from "./contact.ts";
export * from "./booking.ts";
export * from "./pipeline.ts";
export * from "./sim.ts";
