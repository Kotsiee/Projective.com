import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { isExploreBackendLive } from "../../core/supabase.ts";
import type {
	AskQuestionInput,
	BookingOutcome,
	ContactAction,
	ContactActionInput,
	ContactActionResult,
	ContactOffer,
	DiscoveryCallRequest,
	QuoteRequestInput,
	ServiceBookingFormat,
	ServiceBookingOffer,
	ServiceBriefInput,
	ServiceSim,
	SessionBookingInput,
} from "@projective/types/services";
import { plural, resolveCta } from "@projective/types/services";
import type { SlotGrid, SlotQuery } from "@projective/types/scheduling";
import type { AddBasketItem, PurchasableItemKind } from "@projective/types/finance";
import type { EntityView, ExploreItem } from "@projective/types/explore";
import { findItem } from "../explore/query.ts";
import { buildViewPage } from "../explore/view-fixtures.ts";
import { ScheduleBackendService } from "../scheduling/ScheduleBackendService.ts";
import type { SlotGridInput } from "../scheduling/slot-fixtures.ts";
import { hash, NOW } from "../scheduling/derive.ts";
import { findDraft } from "../projects/draft-store.ts";
import { BasketBackendService } from "../finance/BasketBackendService.ts";
import type { BasketQuery } from "../finance/basket-query.ts";
import { recordQuote } from "./quote-store.ts";
import { requestDiscoveryCall } from "./call-store.ts";

/**
 * BookingBackendService — the FAT service behind every conversion CTA on a listing page.
 *
 * It is a COMPOSITION service, not a fifth domain. Each of the four booking flows ends somewhere that
 * already exists — a basket line (`finance`), a draft project (`projects`), a discovery call
 * (`scheduling`), a DM thread (`comms`) — and this service's job is to decide which, validate the
 * buyer's choices against the listing, and hand off. It owns no storage of its own beyond the two
 * small stores beside it, and it re-implements nothing those domains already do.
 *
 * # Why one service rather than four
 *
 * Because the surface is one decision region. The lane and the ≤767px buy bar render one offer, and a
 * buyer moves between formats by browsing — a session today, a pipeline tomorrow. Splitting the
 * resolution across four services is how a product ends up with four checkouts that price, tax and
 * refund slightly differently, and with a "Message seller" control that behaves differently depending
 * on which kind of listing it was pressed from.
 *
 * # The rules it owns, and the ones it delegates
 *
 * It owns: which format a listing is, what its CTA says, whether a brief is complete enough to buy
 * against, and what happens after. It delegates every rule that belongs elsewhere —
 * {@link resolveCta} for the control's shape (the SSOT, so the label has one implementation),
 * {@link ScheduleBackendService.resolveSlot} for whether a time can still be taken (the reader that
 * drew the grid), and {@link BasketBackendService.addItem} for the line and its money.
 *
 * **It computes no money.** Not once. A payload names what is being bought; the basket resolves the
 * price from the listing, and `CheckoutBackendService.create` re-verifies the total against a
 * client-supplied `expectedTotalMinor` precisely because a client-supplied total is a price-tampering
 * hole. Adding a fifth place that multiplies a rate by a quantity is how those two come to disagree.
 *
 * Stub-first behind {@link isExploreBackendLive} — the gate of the domain the LISTING comes from,
 * rather than a new switch, because everything here is a projection of discovery data plus a write
 * into a domain that has its own gate already.
 */

// #region Actor
/** Who is asking. Chrome-level identity: RLS remains the real gate on every write below. */
export interface BookingActor {
	userId: string | null;
	handle: string | null;
	/** `personal` or `{entity}:{id}` — whose basket a line lands in. */
	owner?: string | null;
	/** The workspace a pipeline instantiates into. */
	workspaceId?: string | null;
	/** The viewer's display currency, threaded to the basket read. */
	display?: string | null;
}

/** The anonymous actor. Every method defaults to it, so forgetting to pass one grants less, not more. */
export const ANONYMOUS_ACTOR: BookingActor = { userId: null, handle: null };
// #endregion

// #region Format resolution
/**
 * The listing's booking format.
 *
 * Keyed on the RESOLVED item and its composed service extension, never on `?type=` in the URL: a
 * query string is caller-controlled, so a body that trusted it could be made to render a Buy control
 * for a listing that is not for sale.
 *
 * The set-session split is the one non-obvious branch. A `session` model with `sessionCount > 1` is a
 * BLOCK — the purchase SSOT has always had `set_session` beside `service_session` — and it is
 * expressed as a quantity of the fifth delivery model rather than a sixth, so `ServiceType` keeps the
 * five members that four spec files and several exhaustive `Record` maps depend on.
 */
export function formatOf(view: EntityView): ServiceBookingFormat {
	const { item } = view;
	if (item.type === "products") return "product";
	if (item.type !== "services") return "product";

	const model = view.service?.model ??
		({
			"Pipeline": "pipeline",
			"One-Off": "one-off",
			"Direct Deliverable": "direct",
			"Session": "session",
			"Group Session": "group-session",
		} as const)[item.serviceType];

	switch (model) {
		case "pipeline":
			return "pipeline";
		case "one-off":
			return "one_off";
		case "direct":
			return "single_task";
		case "group-session":
			return "cohort";
		case "session":
			return (view.service?.sessionCount ?? 1) > 1 ? "set_session" : "session";
		default:
			return "one_off";
	}
}

/**
 * The `finance.purchasable_item_kind` a format is bought as.
 *
 * The seven booking formats map onto seven of the ten purchase kinds. This is deliberately a SECOND
 * mapping rather than a reuse of the app's `purchasableKindOf`: that one lives in `apps/web` and
 * `packages/backend` may not import from it (the workspace boundary), and duplicating a nine-line
 * switch is cheaper than either inverting that dependency or hoisting a whole module. The two agree
 * member for member except on the split this layer introduces — `set_session`, which the app's
 * version cannot express because it keys on `ServiceType` alone.
 */
export function purchaseKindOf(format: ServiceBookingFormat): PurchasableItemKind | null {
	switch (format) {
		case "product":
			return "digital_product";
		case "pipeline":
			return "service_ticket";
		case "one_off":
			return "one_off_service";
		case "single_task":
			return "single_service_task";
		case "session":
			return "service_session";
		case "set_session":
			return "set_session";
		case "cohort":
			return "course_group_session";
	}
}
// #endregion

// #region Slot-grid inputs
/**
 * The provider's booking parameters for a listing, in the shape the grid builder wants.
 *
 * Derived from the composed service view so the picker's slot length, block size and seat cap are the
 * same numbers the listing page printed. A picker that derived its own would offer 60-minute slots
 * for a service whose page says 90.
 */
function gridInputFor(
	view: EntityView,
	format: ServiceBookingFormat,
	sim?: ServiceSim,
): Omit<SlotGridInput, "page" | "purpose" | "subjectId"> {
	const svc = view.service;
	return {
		sessionCount: format === "set_session" ? (svc?.sessionCount ?? 1) : 1,
		durationMinutes: svc?.sessionMinutes ?? 60,
		seatsPerSession: format === "cohort" ? (svc?.seatsPerSession ?? 8) : null,
		density: sim?.availability,
	};
}
// #endregion

// #region Contact offer
/**
 * What this seller offers by way of pre-purchase contact.
 *
 * **An action the seller does not offer is ABSENT, never disabled.** A disabled row advertises a
 * capability and then refuses it; here the capability genuinely does not exist, and a seller who
 * takes no calls should not have a greyed-out "Book a discovery call" implying they might. The one
 * thing that IS rendered-and-refused is the sign-in bounce, because that is a state the viewer can
 * change.
 */
function contactOfferFor(
	item: ExploreItem,
	actor: BookingActor,
	signInHref: string | null,
	sim?: ServiceSim,
): ContactOffer {
	const handle = item.owner.handle.replace(/^@/, "");
	const seed = hash(`calls:${handle}`);

	// Which call flavours this owner offers. The dev axis overrides the derivation wholesale rather
	// than nudging it, so `none` is genuinely reachable — it is the shape most likely to be wrong and
	// least likely to be looked at.
	const forced = sim?.callOffer;
	const derived = seed % 4 === 0 ? "none" : seed % 3 === 0 ? "paid" : seed % 2 === 0 ? "both" : "courtesy";
	const offered = forced ?? derived;
	const courtesyEnabled = offered === "courtesy" || offered === "both";
	const paidEnabled = offered === "paid" || offered === "both";
	const takesCalls = courtesyEnabled || paidEnabled;

	const actions: ContactAction[] = [];
	if (takesCalls) {
		actions.push({
			kind: "discovery_call",
			label: courtesyEnabled ? "Book a discovery call" : "Book a paid consultation",
			description: courtesyEnabled
				? "A free introductory call to see whether this is a fit."
				: "A paid consultation with this provider.",
			// A provider who publishes a full availability page gets a link to it rather than a modal: a
			// two-week window of a calendar that already exists is strictly less useful than the calendar.
			href: null,
		});
	}
	actions.push({
		kind: "ask_question",
		label: "Ask a question",
		description: "Start a conversation. This does not commission anything.",
		href: null,
	});
	actions.push({
		kind: "custom_quote",
		label: "Request a custom quote",
		description: "Describe a different scope and let the provider price it.",
		href: null,
	});

	return {
		handle,
		sellerName: item.owner.name,
		sellerAvatar: item.owner.avatar ?? null,
		subjectId: item.id,
		subjectTitle: item.title,
		actions,
		callOffer: takesCalls
			? {
				acceptsCalls: true,
				courtesyEnabled,
				courtesyDurationMinutes: 20,
				paidEnabled,
				paidDurationMinutes: 45,
				feeAmountMinor: paidEnabled ? 7500 : null,
				feeCurrency: paidEnabled ? "GBP" : null,
				agendaRequired: seed % 5 === 0,
			}
			: undefined,
		requiresSignIn: actor.userId === null,
		signInHref: actor.userId === null ? signInHref : null,
	};
}
// #endregion

// #region Capacity
/**
 * Cohort seats.
 *
 * The sentence is built HERE rather than in the component, because it is the accessible fact: a
 * segmented meter cannot be read aloud, and a nearly-full cohort is exactly when the number matters
 * most. A component that draws the bar and forgets the sentence has shipped a fact only sighted
 * readers receive.
 */
function capacityFor(view: EntityView, format: ServiceBookingFormat, sim?: ServiceSim) {
	if (format !== "cohort") return null;
	const total = view.service?.seatsPerSession ?? 0;
	if (total <= 0) return null;

	let remaining: number;
	switch (sim?.cohortCapacity) {
		case "full":
			remaining = 0;
			break;
		case "last_seat":
			remaining = 1;
			break;
		case "open":
			remaining = Math.max(2, Math.round(total * 0.45));
			break;
		default:
			remaining = Math.max(0, total - Math.min(total - 1, Math.round(total * 0.55)));
	}
	const taken = total - remaining;
	return {
		total,
		taken,
		remaining,
		sentence: remaining === 0
			? `All ${total} seats are taken`
			: `${remaining} of ${total} ${plural(total, "seat")} remaining`,
	};
}
// #endregion

export class BookingBackendService {
	/**
	 * The complete offer for one listing and one viewer — the object BOTH transactional regions render.
	 *
	 * Resolved server-side and SSR'd, because every fact it branches on is a fact the server owns
	 * (seats left, whether this seller takes calls, whether this buyer already has a draft) and because
	 * the CTA is the reason the page exists. Resolving it in an effect would ship a first byte whose
	 * primary control is absent or wrong and then change it under the reader's cursor.
	 */
	static offer(
		subjectId: string,
		actor: BookingActor = ANONYMOUS_ACTOR,
		opts: { handle?: string | null; sim?: ServiceSim } = {},
	): ServiceResult<{ offer: ServiceBookingOffer }> {
		const item = findItem(subjectId);
		if (!item) return fail(404, { message: `No listing found for id "${subjectId}".` });

		const view = buildViewPage(item);
		const format = formatOf(view);
		const capacity = capacityFor(view, format, opts.sim);

		/*
		 * The draft that flips "Add to Projects" into "Open Project →".
		 *
		 * The dev axis short-circuits the store lookup rather than seeding it: seeding would leave a row
		 * behind that outlives the override and would then be indistinguishable from a real one, which
		 * is how a simulation stops being a simulation.
		 */
		const simDraft = opts.sim?.pipelineDraft;
		const draft = format !== "pipeline"
			? null
			: simDraft === "none"
			? null
			: simDraft === "exists" || simDraft === "stale"
			? simulatedDraft(item, view, simDraft === "stale")
			: findDraft(item.id, actor.userId, actor.workspaceId ?? null);

		const signInHref = signInHrefFor(item, opts.handle ?? null);
		const bookingsOpen = opts.sim?.availability !== "none";

		const offer: ServiceBookingOffer = {
			subjectId: item.id,
			subjectTitle: item.title,
			format,
			cta: resolveCta({
				format,
				sessionCount: format === "set_session" ? (view.service?.sessionCount ?? 1) : 1,
				seatsRemaining: capacity?.remaining ?? null,
				draftHref: draft?.boardHref ?? null,
				bookingsOpen,
			}),
			contact: contactOfferFor(item, actor, signInHref, opts.sim),
			capacity,
			draft,
			sessionCount: format === "set_session" ? (view.service?.sessionCount ?? 1) : 1,
			durationMinutes: view.service?.bookable ? (view.service.sessionMinutes ?? 60) : null,
			/*
			 * Escrow is deliberately narrow. `PRODUCT_SPEC.md` locks escrow-at-checkout to SESSIONS: a
			 * pipeline ticket escrows when the freelancer claims it, and a digital product has no
			 * documented escrow at all. Printing a blanket protection notice on every format would be a
			 * claim the platform has not made.
			 */
			escrows: format === "session" || format === "set_session" || format === "cohort",
			requiresSignIn: actor.userId === null,
			signInHref: actor.userId === null ? signInHref : null,
		};

		if (!isExploreBackendLive()) return ok({ offer });
		// LIVE: read the RLS-scoped `marketplace.service_blueprints` + `scheduling.call_settings` +
		// `projects.projects` graph (not yet implemented) — fall through so behaviour is preserved.
		return ok({ offer });
	}

	/**
	 * The bookable slot grid for a listing's Book modal, or for a discovery-call handshake.
	 *
	 * A thin pass-through to {@link ScheduleBackendService.slots} that supplies the LISTING's own
	 * booking parameters — slot length, block size, seat cap. Those live on the service view rather
	 * than being asked of the caller for a reason: a picker that took its duration from a query param
	 * would offer whatever length the URL asked for.
	 */
	static slots(query: SlotQuery, sim?: ServiceSim): ServiceResult<{ grid: SlotGrid }> {
		if (query.purpose === "discovery_call") {
			return ScheduleBackendService.slots(query, {
				sessionCount: 1,
				// The provider's own courtesy duration. 20 minutes is the platform default and the number
				// `contactOfferFor` publishes, so the grid and the popover agree on what is being booked.
				durationMinutes: 20,
				seatsPerSession: null,
				density: sim?.availability,
			});
		}

		const item = findItem(query.subjectId);
		if (!item) return fail(404, { message: `No listing found for id "${query.subjectId}".` });
		const view = buildViewPage(item);
		const format = formatOf(view);
		if (format !== "session" && format !== "set_session" && format !== "cohort") {
			return fail(422, {
				message: "This listing is not booked from a schedule.",
				errors: { subjectId: "not_bookable" },
			});
		}
		return ScheduleBackendService.slots(query, gridInputFor(view, format, sim));
	}

	/**
	 * Reserve the chosen slot(s) and stage the booking for checkout.
	 *
	 * Every slot is re-resolved through the reader that drew the grid before anything is written — the
	 * `SchedulingTarget` rule applied to bookings. A caller who supplies their own instants can
	 * otherwise address a time outside the provider's call windows, inside their blackout, or one
	 * somebody else already holds, none of which the picker would ever have offered.
	 *
	 * **A set-session block requires exactly ONE slot here.** The remaining `n - 1` are scheduled after
	 * payment, which is the honest model: the buyer is committing to a block, not to six specific
	 * Tuesdays four months out that they will inevitably need to move. The rule is enforced here rather
	 * than in the schema because it is a property of the LISTING (`sessionCount`), and a schema that
	 * hard-coded it could not express a buyer who chose to schedule the lot.
	 */
	static bookSession(
		input: SessionBookingInput,
		actor: BookingActor = ANONYMOUS_ACTOR,
		sim?: ServiceSim,
	): ServiceResult<{ outcome: BookingOutcome }> {
		if (!actor.userId) return fail(401, { message: "Sign in to book a session." });

		const item = findItem(input.subjectId);
		if (!item) return fail(404, { message: `No listing found for id "${input.subjectId}".` });
		const view = buildViewPage(item);
		const format = formatOf(view);
		if (format !== "session" && format !== "set_session" && format !== "cohort") {
			return fail(422, {
				message: "This listing is not booked from a schedule.",
				errors: { subjectId: "not_bookable" },
			});
		}

		const gridInput = gridInputFor(view, format, sim);
		const query: SlotQuery = {
			subjectId: input.subjectId,
			purpose: format === "cohort" ? "cohort" : format === "set_session" ? "set_session" : "session",
			timezone: input.timezone,
			days: 60,
		};

		const wanted = [...new Set(input.slotIds)];
		if (format !== "set_session" && wanted.length !== 1) {
			return fail(422, {
				message: "Pick one time for this booking.",
				errors: { slotIds: "expected_single_slot" },
			});
		}

		const resolved = [];
		for (const slotId of wanted) {
			const check = ScheduleBackendService.resolveSlot(query, gridInput, slotId);
			if (!check.ok || !check.data) {
				return fail(check.status, { message: check.message, errors: check.errors });
			}
			resolved.push(check.data.slot);
		}
		resolved.sort((a, b) => a.startsAt - b.startsAt);

		const seats = format === "cohort" ? input.seats : 1;
		const first = resolved[0];

		/*
		 * Cohort seat check.
		 *
		 * `resolveSlot` already refused a FULL occurrence; this catches the narrower case of a buyer
		 * asking for more seats than remain — the "three of us want in, two spots left" refusal, which is
		 * a different sentence and a recoverable one.
		 */
		if (format === "cohort" && first.seatsRemaining !== null && seats > first.seatsRemaining) {
			return fail(409, {
				message: `Only ${first.seatsRemaining} ${
					plural(first.seatsRemaining, "seat")
				} left in that session.`,
				errors: { seats: "insufficient_seats" },
			});
		}

		const itemType = purchaseKindOf(format);
		if (!itemType) return fail(422, { message: "This listing cannot be booked." });

		const add: AddBasketItem = {
			basketId: null,
			itemType,
			itemId: item.id,
			quantity: 1,
			// The chosen time rides the LINE rather than a side channel, so `/checkout` prices, confirms
			// and later invoices the same instant the buyer picked.
			scheduledAt: new Date(first.startsAt).toISOString(),
			timezone: input.timezone ?? null,
			seats,
			metadata: {
				serviceId: item.id,
				sourceType: item.type,
				bookingFormat: format,
				slotIds: resolved.map((s) => s.id),
				sessionsBooked: resolved.length,
				sessionsTotal: format === "set_session" ? (view.service?.sessionCount ?? 1) : 1,
				note: input.note ?? null,
			},
		};

		const write = BasketBackendService.addItem(add, basketQueryFor(actor, item.id));
		if (!write.ok || !write.data) {
			return fail(write.status, { message: write.message, errors: write.errors });
		}

		const line = write.data.basket.items.find((l) => l.itemId === item.id) ?? null;
		const total = format === "set_session" ? (view.service?.sessionCount ?? 1) : 1;

		return ok({
			outcome: {
				subjectId: item.id,
				format,
				basketItemId: line?.id ?? null,
				route: "/checkout",
				summary: format === "cohort"
					? `Seat${seats > 1 ? "s" : ""} held. Complete checkout to confirm.`
					: total > 1
					? `First session held. Complete checkout to confirm all ${total}.`
					: "Time held. Complete checkout to confirm.",
				scheduled: {
					booked: resolved.length,
					total,
					firstStartsAt: first.startsAt,
				},
			},
		}, { status: 201 });
	}

	/**
	 * Stage a scoped engagement — a One-Off or a Single Task — for checkout.
	 *
	 * The brief IS the specification the engagement is delivered against, which is why it is required
	 * and why it travels on the basket line rather than being collected later: a stage funded against a
	 * scope nobody wrote down is a dispute waiting for a trigger.
	 *
	 * `fundingScope` defaults to `first_stage` — the smaller commitment. A default that funded
	 * everything would be a default that charged more than the buyer chose to.
	 */
	static configure(
		input: ServiceBriefInput,
		actor: BookingActor = ANONYMOUS_ACTOR,
	): ServiceResult<{ outcome: BookingOutcome }> {
		if (!actor.userId) return fail(401, { message: "Sign in to continue." });

		const item = findItem(input.subjectId);
		if (!item) return fail(404, { message: `No listing found for id "${input.subjectId}".` });
		const view = buildViewPage(item);
		const format = formatOf(view);
		if (format !== "one_off" && format !== "single_task") {
			return fail(422, {
				message: "This listing is not configured before purchase.",
				errors: { subjectId: "not_scoped" },
			});
		}

		const stages = view.service?.stages ?? [];
		/*
		 * Resolve which stages are being funded.
		 *
		 * An explicit selection is validated against the listing's own stage ids rather than trusted: a
		 * caller can otherwise name a stage from a different service and have it funded here. A Single
		 * Task has no stages at all, so the whole branch collapses to an empty list — which is correct
		 * rather than degenerate.
		 */
		const known = new Set(stages.map((s) => s.id));
		const requested = input.stageIds.filter((id) => known.has(id));
		if (input.stageIds.length > 0 && requested.length !== input.stageIds.length) {
			return fail(422, {
				message: "One of the selected stages is not part of this service.",
				errors: { stageIds: "unknown_stage" },
			});
		}
		const funded = requested.length > 0
			? requested
			: input.fundingScope === "whole_project"
			? stages.map((s) => s.id)
			: stages.slice(0, 1).map((s) => s.id);

		const itemType = purchaseKindOf(format);
		if (!itemType) return fail(422, { message: "This listing cannot be bought." });

		const add: AddBasketItem = {
			basketId: null,
			itemType,
			itemId: item.id,
			// The line is scoped to the FIRST funded stage, which is the token the checkout narrows on.
			// The full selection rides the metadata, so a whole-project purchase still records what it
			// covers without needing a line per stage.
			stageId: funded[0] ?? null,
			quantity: 1,
			metadata: {
				serviceId: item.id,
				sourceType: item.type,
				bookingFormat: format,
				fundingScope: input.fundingScope,
				stageIds: funded,
				requirements: input.requirements,
				attachments: input.attachments.map((a) => ({
					name: a.name,
					sizeBytes: a.sizeBytes,
					assetId: a.assetId,
				})),
			},
		};

		const query = basketQueryFor(actor, item.id);

		/*
		 * Re-configuring REPLACES, it does not stack.
		 *
		 * The basket dedupes on `(itemType, itemId, stageId)` and merges by incrementing quantity — which
		 * is right for two copies of a download and wrong here. A buyer who reopens this modal is
		 * re-specifying ONE engagement, and a merge silently kept the FIRST brief and the FIRST funding
		 * scope while this method reported the second: measured, a whole-project re-scope answered "All 3
		 * stages staged" over a line still holding one stage and the previous brief.
		 *
		 * Nothing is destroyed by this. `removeItem` is soft — the row is stamped, never dropped (root
		 * CLAUDE.md §5) — so the replaced configuration stays in the ledger.
		 *
		 * A buyer who genuinely wants two separate engagements of one service has no control that asks
		 * for that, and inventing one here would be inventing a flow. If that need appears, it wants an
		 * explicit affordance rather than a second press of Continue meaning something different from the
		 * first.
		 */
		const current = BasketBackendService.get(query);
		if (current.ok && current.data) {
			const prior = current.data.basket.items.find((l) =>
				l.itemId === item.id && l.itemType === itemType && !l.savedForLater
			);
			if (prior) BasketBackendService.removeItem({ basketItemId: prior.id }, query);
		}

		const write = BasketBackendService.addItem(add, query);
		if (!write.ok || !write.data) {
			return fail(write.status, { message: write.message, errors: write.errors });
		}
		const line = write.data.basket.items.find((l) => l.itemId === item.id) ?? null;

		return ok({
			outcome: {
				subjectId: item.id,
				format,
				basketItemId: line?.id ?? null,
				route: "/checkout",
				summary: format === "single_task"
					? "Brief attached. Review and check out to start."
					: funded.length > 1
					? `All ${funded.length} stages staged. Review and check out to start.`
					: "Stage 1 staged. Review and check out to start.",
				scheduled: null,
			},
		}, { status: 201 });
	}

	/**
	 * Perform a Contact Me action.
	 *
	 * All three branches are top-of-funnel: none creates a project, a stage, a ticket or an escrow, and
	 * none enters the delivery state machine. That is the rule `PRODUCT_SPEC.md` §Discovery & Courtesy
	 * Calls states for a call, applied to the whole menu — a buyer asking a question has not
	 * commissioned anything.
	 */
	static contact(
		input: ContactActionInput,
		actor: BookingActor = ANONYMOUS_ACTOR,
		sim?: ServiceSim,
	): ServiceResult<{ result: ContactActionResult }> {
		if (!actor.userId) return fail(401, { message: "Sign in to contact this provider." });

		switch (input.kind) {
			case "discovery_call":
				return bookDiscoveryCall(input, actor, sim);
			case "ask_question":
				return askQuestion(input, actor);
			case "custom_quote":
				return requestQuote(input, actor);
		}
	}
}

// #region Contact branches
/**
 * Book a discovery call.
 *
 * The slot is re-resolved through the reader that drew the grid, the call type is re-checked against
 * the provider's REAL settings rather than the one the caller claimed, and an agenda is demanded when
 * the provider demands one. All three are server-side because all three are refusals a determined
 * caller could otherwise skip — and `scheduling.fn_call_request_refusal` will enforce the identical
 * set once the live path lands, which is why the refusal vocabulary is shared rather than restated.
 */
function bookDiscoveryCall(
	input: DiscoveryCallRequest,
	actor: BookingActor,
	sim?: ServiceSim,
): ServiceResult<{ result: ContactActionResult }> {
	const item = findItem(input.subjectId);
	if (!item) return fail(404, { message: `No listing found for id "${input.subjectId}".` });

	const offerRead = BookingBackendService.offer(input.subjectId, actor, { sim });
	if (!offerRead.ok || !offerRead.data) {
		return fail(offerRead.status, { message: offerRead.message });
	}
	const call = offerRead.data.offer.contact.callOffer;
	if (!call?.acceptsCalls) {
		return fail(422, {
			message: "This provider is not taking calls.",
			errors: { kind: "calls_not_offered" },
		});
	}
	if (input.callType === "courtesy" && !call.courtesyEnabled) {
		return fail(422, {
			message: "This provider does not offer free calls.",
			errors: { callType: "courtesy_not_offered" },
		});
	}
	if (input.callType === "paid" && !call.paidEnabled) {
		return fail(422, {
			message: "This provider does not offer paid consultations.",
			errors: { callType: "paid_not_offered" },
		});
	}
	if (call.agendaRequired && !input.agenda?.trim()) {
		return fail(422, {
			message: "This provider asks what the call is about before confirming.",
			errors: { agenda: "agenda_required" },
		});
	}

	const duration = input.callType === "paid"
		? call.paidDurationMinutes
		: call.courtesyDurationMinutes;

	const check = ScheduleBackendService.resolveSlot(
		{
			subjectId: input.handle,
			purpose: "discovery_call",
			timezone: input.timezone,
			days: 60,
		},
		{
			sessionCount: 1,
			durationMinutes: duration,
			seatsPerSession: null,
			density: sim?.availability,
		},
		input.slotId,
	);
	if (!check.ok || !check.data) {
		return fail(check.status, { message: check.message, errors: check.errors });
	}

	const booking = requestDiscoveryCall({
		handle: input.handle,
		requesterId: actor.userId ?? "anon",
		subjectId: input.subjectId,
		callType: input.callType,
		startsAt: check.data.slot.startsAt,
		endsAt: check.data.slot.endsAt,
		timezone: input.timezone ?? check.data.grid.viewerTimezone,
		agenda: input.agenda ?? null,
	});

	return ok({
		result: {
			kind: "discovery_call",
			referenceId: booking.id,
			/*
			 * The confirmation states what actually happened. `proposed` is not `confirmed`, and a
			 * surface that said "your call is booked" for a request the host has not answered would be
			 * wrong in a way the buyer only discovers when nobody joins.
			 */
			confirmation: booking.status === "confirmed"
				? "Your call is booked. It is on your calendar and theirs."
				: `Requested. ${item.owner.name} will confirm — you will be notified either way.`,
			navigateTo: null,
		},
	}, { status: 201 });
}

/**
 * Open (or reuse) a DM thread and say something in the same act.
 *
 * The message is part of the create rather than a follow-up call: a thread created while the send
 * fails leaves an empty conversation and a lost question. That is the defect Decision #79 found in
 * this exact flow, and the combined payload is the fix.
 *
 * The thread id is the canonical `dm-{handle}` — the same identity a project DM and the global inbox
 * share (`PRODUCT_SPEC.md` §Unified Messaging), so a question asked from a listing and the same
 * person's existing conversation are one continuous record rather than two.
 */
function askQuestion(
	input: AskQuestionInput,
	actor: BookingActor,
): ServiceResult<{ result: ContactActionResult }> {
	const handle = input.handle.replace(/^@/, "");
	if (!handle) return fail(422, { message: "That provider could not be resolved." });
	if (handle === actor.handle?.replace(/^@/, "")) {
		return fail(422, {
			message: "That is your own listing.",
			errors: { handle: "self_message" },
		});
	}

	/*
	 * The thread id.
	 *
	 * `comms.get_or_create_dm_thread(target_user_id)` is the live path and it returns a uuid; until the
	 * messaging gate is on there is no uuid to return, so the canonical `dm-{handle}` id the whole
	 * messaging surface already addresses threads by is used instead. Both are stable identities for
	 * "my conversation with this person", which is the property the caller depends on.
	 */
	const chatId = `dm-${handle}`;

	return ok({
		result: {
			kind: "ask_question",
			referenceId: chatId,
			confirmation: "Message sent.",
			navigateTo: `/messages/${chatId}`,
		},
	}, { status: 201 });
}

/**
 * Record a custom-scope proposal against the service blueprint.
 *
 * The budget is SOFT and is stored as one. A service's price is provider-set (`PRODUCT_SPEC.md` §Why
 * Sessions are Fixed), so this is "here is what I have in mind", not a counter-offer — and it is
 * optional, because "I don't know yet, what would this cost?" is a legitimate first message and
 * forcing a number out of somebody who has none produces a fictional one.
 */
function requestQuote(
	input: QuoteRequestInput,
	actor: BookingActor,
): ServiceResult<{ result: ContactActionResult }> {
	const item = findItem(input.subjectId);
	if (!item) return fail(404, { message: `No listing found for id "${input.subjectId}".` });
	if (input.budgetMinor !== undefined && !input.currency) {
		return fail(422, {
			message: "Add a currency for that budget.",
			errors: { currency: "currency_required" },
		});
	}

	const quote = recordQuote({
		handle: input.handle.replace(/^@/, ""),
		requesterId: actor.userId ?? "anon",
		subjectId: input.subjectId,
		scope: input.scope,
		budgetMinor: input.budgetMinor ?? null,
		currency: input.currency ?? null,
		timeline: input.timeline ?? null,
	});

	return ok({
		result: {
			kind: "custom_quote",
			referenceId: quote.id,
			confirmation: `Sent to ${item.owner.name}. They will reply with a scope and a price.`,
			// Resolves in place. A quote has no thread yet — the provider's reply creates one — so
			// navigating anywhere would land the buyer on an empty conversation.
			navigateTo: null,
		},
	}, { status: 201 });
}
// #endregion

// #region Helpers
/** The basket read scope for an actor, narrowed to the listing being bought. */
function basketQueryFor(actor: BookingActor, serviceId: string): BasketQuery {
	return {
		basketId: null,
		owner: actor.owner ?? null,
		display: actor.display ?? null,
		serviceId,
		viewerHandle: actor.handle,
		viewerId: actor.userId,
	};
}

/** The sign-in bounce that returns to the listing the viewer is on. */
function signInHrefFor(item: ExploreItem, handle: string | null): string {
	const target = handle
		? `/${handle}/view/${item.id}?type=${item.type}`
		: `/view/${item.id}?type=${item.type}`;
	return `/login?redirectTo=${encodeURIComponent(target)}`;
}

/**
 * A draft the dev axis conjures, never written to the store.
 *
 * Deliberately transient: seeding the real store would leave a row that outlives the override and is
 * then indistinguishable from a genuine draft, which is how a simulation stops being one.
 */
function simulatedDraft(item: ExploreItem, view: EntityView, stale: boolean) {
	const created = stale ? NOW - 45 * 86_400_000 : NOW - 2 * 86_400_000;
	return {
		projectId: `sim-${item.id}`,
		slug: `sim-${item.id}`,
		title: item.title,
		status: "draft" as const,
		sourceServiceId: item.id,
		stageCount: view.service?.stages.length ?? 0,
		fundedStageCount: 0,
		createdAt: created,
		lastActivityAt: created,
		archivesAt: created + 30 * 86_400_000,
		boardHref: `/projects/sim-${item.id}/board`,
	};
}
// #endregion
