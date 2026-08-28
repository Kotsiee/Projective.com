import { z } from "zod";

/**
 * services.common — the **booking format** vocabulary shared by every service CTA on the platform.
 *
 * A listing's delivery model decides what its primary control does, and until now that decision was
 * made twice: once by `entity-archetype.ts` (which body to render) and once, implicitly, by whichever
 * handler the button happened to be wired to. This module is the single answer, so the label a buyer
 * reads and the flow the click opens are derived from one value.
 *
 * **Seven formats, not five.** The five discovery `ServiceType` delivery models
 * (`@projective/types/explore`) describe how work is STAFFED and PRICED; they are not a booking
 * vocabulary, and two of them cover two purchases each:
 *
 * - `Direct Deliverable` and `One-Off` are both fixed-scope fixed-fee, but a One-Off is bought by
 *   scoping and funding stages while a Single Task is bought by writing a brief. The purchase SSOT
 *   has always distinguished them (`one_off_service` vs `single_service_task` in
 *   `finance.purchasable_item_kind`); only the view layer folded them.
 * - `Session` covers both a single booking and a block of N sessions sold together — again already
 *   distinguished by the purchase SSOT (`service_session` vs `set_session`).
 *
 * So this vocabulary UNFOLDS the two, rather than adding delivery models. `ServiceType` keeps its
 * five members (they are documented across four spec files and drive exhaustive `Record` maps), and
 * the set-session case is carried by an additive `sessionCount` on the composed service view.
 *
 * Pure and client-safe: no clock, no DOM, no money math. SSR == island.
 */

// #region Format
/**
 * How a service is booked. One member per distinct purchase FLOW — the test for a new member is
 * "does the primary CTA open a different modal", not "is this a different kind of work".
 */
export const ServiceBookingFormat = z.enum([
	/** Staged pipeline: instantiated into the client's workspace as a draft project. */
	"pipeline",
	/** Fixed-scope multi-stage engagement: scoped + funded, then basketed. */
	"one_off",
	/** Fixed-scope single deliverable: brief only, then basketed. */
	"single_task",
	/** One 1-on-1 booking against the provider's availability. */
	"session",
	/** A block of N sessions sold together; the first is scheduled at checkout. */
	"set_session",
	/** A multi-attendee cohort with finite capacity. */
	"cohort",
	/** A digital asset — bought outright, no scheduling and no scoping. */
	"product",
]);
export type ServiceBookingFormat = z.infer<typeof ServiceBookingFormat>;

/** The formats whose primary CTA opens a date/slot picker. */
export const SCHEDULED_FORMATS: readonly ServiceBookingFormat[] = ["session", "set_session", "cohort"];

/** The formats whose primary CTA opens a scope/brief composer. */
export const SCOPED_FORMATS: readonly ServiceBookingFormat[] = ["one_off", "single_task"];

/** Whether booking this format requires picking a time. */
export function isScheduledFormat(format: ServiceBookingFormat): boolean {
	return SCHEDULED_FORMATS.includes(format);
}

/** Whether booking this format requires writing a brief first. */
export function isScopedFormat(format: ServiceBookingFormat): boolean {
	return SCOPED_FORMATS.includes(format);
}
// #endregion

// #region CTA descriptor
/**
 * What the primary control does when pressed. The island switches on THIS rather than on the format,
 * so adding a format that reuses an existing flow needs no island change at all.
 */
export const BookingActionKind = z.enum([
	/** Route straight to `/checkout/payment` — the buyer has decided and nothing needs configuring. */
	"buy_now",
	/** Add the line and route to `/checkout`. */
	"add_to_basket",
	/** POST the service template into the client's workspace as a draft project. */
	"instantiate_pipeline",
	/** Navigate to an already-instantiated draft's board. */
	"open_project",
	/** Open the date-rail + slot picker. */
	"open_scheduler",
	/** Open the scope/funding + brief composer. */
	"open_scope",
	/** Rendered, but refuses — a full cohort. The label carries the reason. */
	"unavailable",
]);
export type BookingActionKind = z.infer<typeof BookingActionKind>;

/**
 * One resolved CTA. The primary and the secondary of a decision region are both described by this
 * shape, and §B.8.2's "exactly one `filled` per decision region" is expressed by
 * {@link ServiceCtaRig} carrying exactly one `primary`.
 */
export const BookingCtaSchema = z.object({
	kind: BookingActionKind,
	/** The visible label. Already interpolated (`Book 6 sessions`, `Join cohort (3 spots left)`). */
	label: z.string().min(1).max(60),
	/**
	 * The accessible name when it must say more than the label does — a count that a sighted reader
	 * takes from an adjacent meter, say. Omitted when the label is already the whole fact.
	 */
	ariaLabel: z.string().max(160).optional(),
	/** Where the control navigates, for the kinds that navigate rather than open a panel. */
	href: z.string().max(400).nullable(),
	/** Refused, with the reason rendered beside it rather than hidden in a tooltip. */
	disabled: z.boolean(),
	/** Why it is refused. `null` whenever `disabled` is false. */
	disabledReason: z.string().max(200).nullable(),
});
/**
 * The lane's complete action rig for one listing.
 *
 * **`secondary` is nullable and that is load-bearing.** A session cannot be put in a basket without a
 * time, so offering "Add to basket" beside "Book session" would be an affordance that either refuses
 * or silently books an unspecified slot. Absence is the honest answer (§D.7.2 — a control that
 * renders must do something).
 */
export const ServiceCtaRigSchema = z.object({
	format: ServiceBookingFormat,
	primary: BookingCtaSchema,
	secondary: BookingCtaSchema.nullable(),
});
export type ServiceCtaRig = z.infer<typeof ServiceCtaRigSchema>;

/** One resolved control, as {@link resolveCta} returns it. */
export type BookingCta = z.infer<typeof BookingCtaSchema>;
// #endregion

// #region Copy
/** The human name of a format, for headings and the summary ledger. */
export const FORMAT_LABEL: Record<ServiceBookingFormat, string> = {
	pipeline: "Pipeline",
	one_off: "One-off delivery",
	single_task: "Single task",
	session: "1-on-1 session",
	set_session: "Session block",
	cohort: "Group session",
	product: "Digital product",
};

/**
 * The pluralising helper the CTA labels use.
 *
 * Trivial, and it exists anyway: `Book 1 sessions` is the kind of defect that survives every review
 * because the fixture that produced it happened to have six.
 */
export function plural(n: number, one: string, many = `${one}s`): string {
	return n === 1 ? one : many;
}
// #endregion

// #region CTA resolution
/** Everything {@link resolveCta} needs. Primitives only, so the rule is pure and testable. */
export interface CtaInput {
	format: ServiceBookingFormat;
	/** How many sessions one purchase commits to. `1` for everything but a set-session block. */
	sessionCount: number;
	/** Cohort seats left, or `null` for a format with no finite capacity. */
	seatsRemaining: number | null;
	/** The board href of an existing pipeline draft, or `null` when there is none. */
	draftHref: string | null;
	/** Whether the provider is currently accepting bookings at all. */
	bookingsOpen: boolean;
}

/**
 * Resolve one listing's action rig.
 *
 * This is the single implementation of "what does the button say and what does it do", and it lives
 * in the SSOT rather than in the surface for the reason §D.7.4 exists: the conversion lane and the
 * ≤767px buy bar are two components rendering one offer, and two components deriving that offer
 * independently is how a phone comes to offer a different transaction from a laptop.
 *
 * **The pipeline branch never returns a destructive primary.** Once a draft exists the verb becomes
 * "Open Project →", not "Remove project": a conversion CTA that turns destructive puts a delete under
 * a cursor that was hovering the primary action one render ago, and the reader's next click is aimed
 * at where the button was rather than at what it now says. Removal is a secondary control behind an
 * explicit confirmation (root CLAUDE.md §3).
 *
 * **A full cohort is `disabled` with a reason, not hidden.** "Cohort full" is information a buyer
 * came for; an absent control makes them wonder whether the page is broken. That is the opposite of
 * the Contact-menu rule, and deliberately so — there the capability does not exist, here it exists
 * and is exhausted, and those are different facts.
 */
export function resolveCta(input: CtaInput): ServiceCtaRig {
	const { format, sessionCount, seatsRemaining, draftHref, bookingsOpen } = input;

	const basket: BookingCta = {
		kind: "add_to_basket",
		label: "Add to basket",
		href: null,
		disabled: false,
		disabledReason: null,
	};

	switch (format) {
		case "product":
			return {
				format,
				primary: {
					kind: "buy_now",
					label: "Buy now",
					href: null,
					disabled: false,
					disabledReason: null,
				},
				secondary: basket,
			};

		case "pipeline":
			return {
				format,
				primary: draftHref
					? {
						kind: "open_project",
						label: "Open project",
						ariaLabel: "Open your draft project for this service",
						href: draftHref,
						disabled: false,
						disabledReason: null,
					}
					: {
						kind: "instantiate_pipeline",
						label: "Add to projects",
						ariaLabel: "Add this pipeline to your projects as a draft",
						href: null,
						disabled: false,
						disabledReason: null,
					},
				// No basket line for a pipeline: it is staffed and then bought against, one ticket at a
				// time. A basket control here would be an affordance with nothing to add.
				secondary: null,
			};

		case "one_off":
		case "single_task":
			return {
				format,
				primary: {
					kind: "open_scope",
					label: "Continue",
					ariaLabel: format === "one_off"
						? "Scope this engagement and continue to checkout"
						: "Describe what you need and continue to checkout",
					href: null,
					disabled: false,
					disabledReason: null,
				},
				secondary: basket,
			};

		case "session":
		case "set_session": {
			const label = sessionCount > 1
				? `Book ${sessionCount} sessions`
				: "Book session";
			return {
				format,
				primary: {
					kind: bookingsOpen ? "open_scheduler" : "unavailable",
					label: bookingsOpen ? label : "Not taking bookings",
					href: null,
					disabled: !bookingsOpen,
					disabledReason: bookingsOpen
						? null
						: "This provider is not accepting bookings at the moment.",
				},
				// A session cannot sit in a basket without a time. Offering "Add to basket" beside it would
				// be a control that either refuses or silently books an unspecified slot (§D.7.2).
				secondary: null,
			};
		}

		case "cohort": {
			const left = seatsRemaining ?? 0;
			const full = left <= 0;
			return {
				format,
				primary: {
					kind: full ? "unavailable" : "open_scheduler",
					label: full ? "Cohort full" : `Join cohort (${left} ${plural(left, "spot")} left)`,
					ariaLabel: full
						? "This cohort is full"
						: `Join this cohort — ${left} ${plural(left, "spot")} remaining`,
					href: null,
					disabled: full,
					disabledReason: full ? "Every seat in this cohort is taken." : null,
				},
				secondary: null,
			};
		}
	}
}
// #endregion
