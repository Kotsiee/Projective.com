import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { getAnonClient, getUserClient } from "../../core/supabase.ts";
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
	SessionBookingInput,
} from "@projective/types/services";
import {
	intakeRefusal,
	normaliseIntakeAnswers,
	plural,
	resolveCta,
} from "@projective/types/services";
import type {
	ConferencingProvider,
	PublicCallOffer,
	SlotGrid,
	SlotQuery,
} from "@projective/types/scheduling";
import type { AddBasketItem, PurchasableItemKind } from "@projective/types/finance";
import type { EntityView, ExploreItem } from "@projective/types/explore";
import { findItem } from "../explore/query.ts";
import { composeLoadedViewPage } from "../explore/live-view.ts";
import { peekCatalog } from "../explore/live-catalog.ts";
import {
	ScheduleBackendService,
	type SlotGridRequest,
} from "../scheduling/ScheduleBackendService.ts";
import { type ScheduleOwner, scheduleIdOf } from "../scheduling/live-slots.ts";
import { readPublicCallOffer } from "../scheduling/live-call-offer.ts";
import { findDraft } from "../projects/draft-store.ts";
import { BasketBackendService } from "../finance/BasketBackendService.ts";
import type { BasketQuery } from "../finance/basket-query.ts";
import { MessagingBackendService } from "../messaging/MessagingBackendService.ts";
import type { ReadActor } from "../read-actor.ts";

/**
 * BookingBackendService — the FAT service behind every conversion CTA on a listing page.
 *
 * It is a COMPOSITION service, not a fifth domain. Each booking flow ends somewhere that already
 * exists — a basket line (`finance`), a draft project (`projects`), a discovery call (`scheduling`),
 * a conversation (`comms`), a quote request (`marketplace`) — and this service's job is to decide
 * which, validate the buyer's choices against the listing, and hand off.
 *
 * # Why one service rather than four
 *
 * Because the surface is one decision region. The lane and the ≤767px buy bar render one offer, and a
 * buyer moves between formats by browsing. Splitting the resolution across four services is how a
 * product ends up with four checkouts that price, tax and refund slightly differently.
 *
 * # The rules it owns, and the ones it delegates
 *
 * It owns: which format a listing is, what its CTA says, whether a brief is complete enough to buy
 * against, and what happens after. It delegates every rule that belongs elsewhere — {@link resolveCta}
 * for the control's shape, {@link ScheduleBackendService.resolveSlot} for whether a time can still be
 * taken (the reader that drew the grid), `scheduling.request_discovery_call` for the call itself (the
 * database derives the host, the fee and the status, and its gate judges the slot), and
 * {@link BasketBackendService.addItem} for the line and its money.
 *
 * **It computes no money.** A payload names what is being bought; the basket resolves the price from
 * the listing, and the checkout re-verifies the total against a client-supplied figure.
 *
 * Everything it reads is live: the listing from the discovery catalogue, the seller's call offer and
 * schedule from `scheduling.*`. Writes run as the signed-in buyer, so RLS and the definer RPCs are the
 * real gates.
 */

// #region Actor
/** Who is asking. Chrome-level identity plus the session token every live write is made with. */
export interface BookingActor {
	userId: string | null;
	handle: string | null;
	/** `personal` or `{entity}:{id}` — whose basket a line lands in. */
	owner?: string | null;
	/** The workspace a pipeline instantiates into. */
	workspaceId?: string | null;
	/** The viewer's display currency, threaded to the basket read. */
	display?: string | null;
	/** The raw session token — what RLS evaluates a write with. Absent for a guest. */
	accessToken?: string | null;
}

/** The anonymous actor. Every method defaults to it, so forgetting to pass one grants less, not more. */
export const ANONYMOUS_ACTOR: BookingActor = { userId: null, handle: null };

/** The read-layer identity for the services this one hands off to. */
function readerOf(actor: BookingActor): ReadActor {
	return {
		userId: actor.userId ?? "",
		contextId: actor.userId ?? "",
		contextType: "personal",
		accessToken: actor.accessToken ?? undefined,
	};
}
// #endregion

// #region Listing owner
/** Who a listing belongs to — the schedule it books into, the person who answers for it. */
interface ListingOwner {
	/** The schedule a booking or a call lands on: the team's when team-owned, else the seller's. */
	schedule: ScheduleOwner;
	/** The accountable account — the person a question is addressed to. */
	accountUserId: string;
	/** The blueprint behind a service listing; `null` for a product. */
	blueprintId: string | null;
}

/**
 * The owner of a listing, from the catalogue snapshot `findItem` resolved it from — the same rows the
 * page rendered, so the owner a question reaches is the owner the page named.
 */
function listingOwner(itemId: string): ListingOwner | null {
	const catalog = peekCatalog();
	if (!catalog) return null;
	const blueprint = catalog.blueprintBySlug.get(itemId);
	if (blueprint) {
		return {
			schedule: blueprint.owner_team_id
				? { type: "team", id: blueprint.owner_team_id }
				: { type: "user", id: blueprint.freelancer_profile_id },
			accountUserId: blueprint.freelancer_profile_id,
			blueprintId: blueprint.id,
		};
	}
	const product = catalog.productBySlug.get(itemId);
	if (product) {
		return {
			schedule: product.owner_team_id
				? { type: "team", id: product.owner_team_id }
				: { type: "user", id: product.owner_user_id },
			accountUserId: product.owner_user_id,
			blueprintId: null,
		};
	}
	return null;
}

/**
 * The owner a `@handle` names, through `org.get_profile_owner` — which answers only for a profile the
 * caller may see, so a private profile resolves to nobody. `undefined` when the database could not
 * answer.
 */
async function profileOwner(handle: string): Promise<ScheduleOwner | null | undefined> {
	try {
		const { data, error } = await getAnonClient().schema("org").rpc("get_profile_owner", {
			p_handle: handle,
		});
		if (error) return undefined;
		const owner = data as { owner_type: ScheduleOwner["type"]; owner_id: string } | null;
		return owner ? { type: owner.owner_type, id: owner.owner_id } : null;
	} catch {
		return undefined;
	}
}

/** The public call offer of an owner; `undefined` when the database could not answer. */
function callOfferOf(owner: ScheduleOwner): Promise<PublicCallOffer | null | undefined> {
	return readPublicCallOffer(getAnonClient(), owner);
}

function unavailable<T>(): ServiceResult<T> {
	return fail(503, { message: "This provider's booking details could not be read. Please try again." });
}
// #endregion

// #region Format resolution
/**
 * The listing's booking format.
 *
 * Keyed on the RESOLVED item and its composed service extension, never on `?type=` in the URL: a
 * query string is caller-controlled, so a body that trusted it could be made to render a Buy control
 * for a listing that is not for sale.
 *
 * A `session` model with `sessionCount > 1` is a BLOCK — the purchase SSOT has always had `set_session`
 * beside `service_session` — and it is expressed as a quantity of the fifth delivery model rather
 * than a sixth.
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
 * The `finance.purchasable_item_kind` a format is bought as — the seven booking formats map onto
 * seven of the ten purchase kinds.
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

/** Whether a format is booked from a schedule. */
function isScheduled(format: ServiceBookingFormat): boolean {
	return format === "session" || format === "set_session" || format === "cohort";
}
// #endregion

// #region Slot-grid inputs
/**
 * The listing's own booking parameters, in the shape the grid wants — the slot length, block size
 * and seat cap the listing page printed. A picker that derived its own would offer 60-minute slots
 * for a service whose page says 90.
 *
 * A session with no stated length is booked at an hour, and the page says so beside it; nothing here
 * invents a second number.
 */
function gridInputFor(view: EntityView, format: ServiceBookingFormat): SlotGridRequest {
	const svc = view.service;
	return {
		sessionCount: format === "set_session" ? (svc?.sessionCount ?? 1) : 1,
		durationMinutes: svc?.sessionMinutes ?? 60,
		seatsPerSession: format === "cohort" ? (svc?.seatsPerSession ?? null) : null,
	};
}

/** The length of a call of the given flavour, from the provider's own settings. */
function callDurationFor(offer: PublicCallOffer, callType: "courtesy" | "paid"): number {
	return callType === "paid" ? offer.paidDurationMinutes : offer.courtesyDurationMinutes;
}
// #endregion

// #region Contact offer
/**
 * What this seller offers by way of pre-purchase contact.
 *
 * **An action the seller does not offer is ABSENT, never disabled.** A seller who takes no calls has
 * no "Book a discovery call" row; a product has no "Request a custom quote" row, because a quote is a
 * proposal against a SERVICE blueprint and there is nothing for a product quote to be recorded
 * against. The one thing that IS rendered-and-refused is the sign-in bounce, because that is a state
 * the viewer can change.
 */
function contactOfferFor(
	item: ExploreItem,
	actor: BookingActor,
	signInHref: string | null,
	callOffer: PublicCallOffer | null,
): ContactOffer {
	const handle = item.owner.handle.replace(/^@/, "");
	const actions: ContactAction[] = [];
	if (callOffer) {
		actions.push({
			kind: "discovery_call",
			label: callOffer.courtesyEnabled ? "Book a discovery call" : "Book a paid consultation",
			description: callOffer.courtesyEnabled
				? "A free introductory call to see whether this is a fit."
				: "A paid consultation with this provider.",
			href: null,
		});
	}
	actions.push({
		kind: "ask_question",
		label: "Ask a question",
		description: "Start a conversation. This does not commission anything.",
		href: null,
	});
	if (item.type === "services") {
		actions.push({
			kind: "custom_quote",
			label: "Request a custom quote",
			description: "Describe a different scope and let the provider price it.",
			href: null,
		});
	}

	return {
		handle,
		sellerName: item.owner.name,
		sellerAvatar: item.owner.avatar ?? null,
		subjectId: item.id,
		subjectTitle: item.title,
		actions,
		callOffer: callOffer ?? undefined,
		requiresSignIn: actor.userId === null,
		signInHref: actor.userId === null ? signInHref : null,
	};
}
// #endregion

// #region Capacity
/**
 * Cohort seats. The sentence is built HERE because it is the accessible fact: a segmented meter
 * cannot be read aloud.
 *
 * Every seat is reported open: no seat of a future occurrence is held by anything the platform
 * records yet (a seat is held at checkout), so a fill level here would be invented.
 */
function capacityFor(view: EntityView, format: ServiceBookingFormat) {
	if (format !== "cohort") return null;
	const total = view.service?.seatsPerSession ?? 0;
	if (total <= 0) return null;
	return {
		total,
		taken: 0,
		remaining: total,
		sentence: `${total} ${plural(total, "seat")} per session`,
	};
}
// #endregion

export class BookingBackendService {
	/**
	 * The complete offer for one listing and one viewer — the object BOTH transactional regions render.
	 *
	 * Resolved server-side and SSR'd, because every fact it branches on is a fact the server owns
	 * (whether this seller takes calls, whether they publish bookable hours, whether this buyer already
	 * has a draft) and because the CTA is the reason the page exists.
	 */
	static async offer(
		subjectId: string,
		actor: BookingActor = ANONYMOUS_ACTOR,
		opts: { handle?: string | null } = {},
	): Promise<ServiceResult<{ offer: ServiceBookingOffer }>> {
		const item = findItem(subjectId);
		if (!item) return fail(404, { message: `No listing found for id "${subjectId}".` });
		const owner = listingOwner(item.id);
		if (!owner) return fail(404, { message: `No listing found for id "${subjectId}".` });

		const view = buildViewPage(item);
		const format = formatOf(view);
		const capacity = capacityFor(view, format);

		// A failed read of the call offer leaves the call row out rather than failing the whole page:
		// the listing is still buyable, and "takes no calls" is the safer thing to show than a row whose
		// every press would error.
		const callOffer = (await callOfferOf(owner.schedule)) ?? null;
		const bookingsOpen = isScheduled(format) ? await publishesSchedule(owner.schedule) : true;

		// The draft that flips "Add to Projects" into "Open Project →".
		const draft = format === "pipeline"
			? findDraft(item.id, actor.userId, actor.workspaceId ?? null)
			: null;

		const signInHref = signInHrefFor(item, opts.handle ?? null);
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
				scheduleHref: scheduleHrefFor(item, opts.handle ?? null),
			}),
			contact: contactOfferFor(item, actor, signInHref, callOffer),
			capacity,
			draft,
			sessionCount: format === "set_session" ? (view.service?.sessionCount ?? 1) : 1,
			durationMinutes: view.service?.bookable ? (view.service.sessionMinutes ?? 60) : null,
			/*
			 * Escrow is deliberately narrow. `PRODUCT_SPEC.md` locks escrow-at-checkout to SESSIONS: a
			 * pipeline ticket escrows when the freelancer claims it, and a digital product has no
			 * documented escrow at all.
			 */
			escrows: isScheduled(format),
			requiresSignIn: actor.userId === null,
			signInHref: actor.userId === null ? signInHref : null,
		};
		return ok({ offer });
	}

	/**
	 * A provider's public call offer, for the seller's PROFILE — the Hire popover's "Book
	 * consultation" row. `null` when the provider takes no calls, which the profile renders as absence.
	 * The same read the listing's Contact menu uses, so a profile cannot advertise a free call beside a
	 * listing whose menu offers only a paid one.
	 */
	static async callOffer(handle: string): Promise<ServiceResult<{ callOffer: PublicCallOffer | null }>> {
		const bare = handle.replace(/^@+/, "");
		if (!bare) return fail(404, { message: "That provider could not be resolved." });
		const owner = await profileOwner(bare);
		if (owner === undefined) return unavailable();
		if (!owner) return fail(404, { message: "That provider could not be resolved." });
		const offer = await callOfferOf(owner);
		if (offer === undefined) return unavailable();
		return ok({ callOffer: offer });
	}

	/**
	 * The bookable slot grid for a listing's Book modal, or for a discovery-call handshake.
	 *
	 * The grid parameters come from the LISTING (or from the provider's own call settings), never from
	 * the caller: a picker that took its duration from a query param would offer whatever length the
	 * URL asked for. Paid work books into the provider's working hours; a call books into their call
	 * windows — "I am working" and "interrupt me" are different claims.
	 */
	static async slots(query: SlotQuery): Promise<ServiceResult<{ grid: SlotGrid }>> {
		if (query.purpose === "discovery_call") {
			const owner = await profileOwner(query.subjectId.replace(/^@+/, ""));
			if (owner === undefined) return unavailable();
			if (!owner) return fail(404, { message: `No profile found for "${query.subjectId}".` });
			const offer = await callOfferOf(owner);
			if (offer === undefined) return unavailable();
			if (!offer) {
				return fail(422, {
					message: "This provider is not taking calls.",
					errors: { subjectId: "calls_not_offered" },
				});
			}
			return ScheduleBackendService.slots(query, {
				sessionCount: 1,
				durationMinutes: callDurationFor(offer, query.callType ?? "courtesy"),
				seatsPerSession: null,
			}, { owner, kind: "call_window" });
		}

		const item = findItem(query.subjectId);
		if (!item) return fail(404, { message: `No listing found for id "${query.subjectId}".` });
		const owner = listingOwner(item.id);
		if (!owner) return fail(404, { message: `No listing found for id "${query.subjectId}".` });
		const view = buildViewPage(item);
		const format = formatOf(view);
		if (!isScheduled(format)) {
			return fail(422, {
				message: "This listing is not booked from a schedule.",
				errors: { subjectId: "not_bookable" },
			});
		}
		return ScheduleBackendService.slots(query, gridInputFor(view, format), {
			owner: owner.schedule,
			kind: "working_hours",
		});
	}

	/**
	 * Reserve the chosen slot(s) and stage the booking for checkout.
	 *
	 * Every slot is re-resolved through the reader that drew the grid before anything is written: a
	 * caller who supplies their own instants can otherwise address a time outside the provider's hours,
	 * inside their blackout, or one somebody else already holds.
	 *
	 * **A set-session block requires exactly ONE slot here.** The remaining `n - 1` are scheduled after
	 * payment — the buyer is committing to a block, not to six specific Tuesdays four months out.
	 */
	static async bookSession(
		input: SessionBookingInput,
		actor: BookingActor = ANONYMOUS_ACTOR,
	): Promise<ServiceResult<{ outcome: BookingOutcome }>> {
		if (!actor.userId) return fail(401, { message: "Sign in to book a session." });

		const item = findItem(input.subjectId);
		if (!item) return fail(404, { message: `No listing found for id "${input.subjectId}".` });
		const owner = listingOwner(item.id);
		if (!owner) return fail(404, { message: `No listing found for id "${input.subjectId}".` });
		const view = buildViewPage(item);
		const format = formatOf(view);
		if (!isScheduled(format)) {
			return fail(422, {
				message: "This listing is not booked from a schedule.",
				errors: { subjectId: "not_bookable" },
			});
		}

		const gridInput = gridInputFor(view, format);
		const query: SlotQuery = {
			subjectId: input.subjectId,
			purpose: format === "cohort" ? "cohort" : format === "set_session" ? "set_session" : "session",
			timezone: input.timezone,
			days: 60,
		};

		// The buyer's answers, held to the listing's own intake by the SAME rule the modal ran.
		const answers = normaliseIntakeAnswers(view.service?.intake ?? [], input.answers);
		const intakeBlock = intakeRefusal(view.service?.intake ?? [], answers);
		if (intakeBlock) {
			return fail(422, {
				message: intakeBlock.message,
				errors: { [`answers.${intakeBlock.fieldId}`]: intakeBlock.code },
			});
		}

		const wanted = [...new Set(input.slotIds)];
		if (format !== "set_session" && wanted.length !== 1) {
			return fail(422, {
				message: "Pick one time for this booking.",
				errors: { slotIds: "expected_single_slot" },
			});
		}

		const target = { owner: owner.schedule, kind: "working_hours" as const };
		const resolved = [];
		for (const slotId of wanted) {
			const check = await ScheduleBackendService.resolveSlot(query, gridInput, target, slotId);
			if (!check.ok || !check.data) {
				return fail(check.status, { message: check.message, errors: check.errors });
			}
			resolved.push(check.data.slot);
		}
		resolved.sort((a, b) => a.startsAt - b.startsAt);

		const seats = format === "cohort" ? input.seats : 1;
		const first = resolved[0];
		if (format === "cohort" && first.seatsRemaining !== null && seats > first.seatsRemaining) {
			return fail(409, {
				message: `Only ${first.seatsRemaining} ${plural(first.seatsRemaining, "seat")} left in that session.`,
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
			// The chosen time rides the LINE, so `/checkout` prices, confirms and later invoices the same
			// instant the buyer picked.
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
				answers,
			},
		};

		const write = await BasketBackendService.addItem(add, basketQueryFor(actor, item.id), readerOf(actor));
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
					? `Seat${seats > 1 ? "s" : ""} selected. Complete checkout to confirm.`
					: total > 1
					? `First session selected. Complete checkout to confirm all ${total}.`
					: "Time selected. Complete checkout to confirm.",
				scheduled: { booked: resolved.length, total, firstStartsAt: first.startsAt },
			},
		}, { status: 201 });
	}

	/**
	 * Stage a scoped engagement — a One-Off or a Single Task — for checkout.
	 *
	 * The brief IS the specification the engagement is delivered against, which is why it is required
	 * and why it travels on the basket line. `fundingScope` defaults to `first_stage` — the smaller
	 * commitment.
	 */
	static async configure(
		input: ServiceBriefInput,
		actor: BookingActor = ANONYMOUS_ACTOR,
	): Promise<ServiceResult<{ outcome: BookingOutcome }>> {
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

		const answers = normaliseIntakeAnswers(view.service?.intake ?? [], input.answers);
		const intakeBlock = intakeRefusal(view.service?.intake ?? [], answers);
		if (intakeBlock) {
			return fail(422, {
				message: intakeBlock.message,
				errors: { [`answers.${intakeBlock.fieldId}`]: intakeBlock.code },
			});
		}

		// An explicit selection is validated against the listing's own stage ids rather than trusted: a
		// caller can otherwise name a stage from a different service and have it funded here.
		const stages = view.service?.stages ?? [];
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
			stageId: funded[0] ?? null,
			quantity: 1,
			metadata: {
				serviceId: item.id,
				sourceType: item.type,
				bookingFormat: format,
				fundingScope: input.fundingScope,
				stageIds: funded,
				requirements: input.requirements,
				answers,
				attachments: input.attachments.map((a) => ({
					name: a.name,
					sizeBytes: a.sizeBytes,
					assetId: a.assetId,
				})),
			},
		};

		const query = basketQueryFor(actor, item.id);

		// Re-configuring REPLACES, it does not stack: a buyer who reopens this modal is re-specifying ONE
		// engagement. `removeItem` is soft, so the replaced configuration stays in the ledger.
		const current = await BasketBackendService.get(query, readerOf(actor));
		if (current.ok && current.data) {
			const prior = current.data.basket.items.find((l) =>
				l.itemId === item.id && l.itemType === itemType && !l.savedForLater
			);
			if (prior) {
				await BasketBackendService.removeItem({ basketItemId: prior.id }, query, readerOf(actor));
			}
		}

		const write = await BasketBackendService.addItem(add, query, readerOf(actor));
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
	 * none enters the delivery state machine (`PRODUCT_SPEC.md` §Discovery & Courtesy Calls).
	 */
	static async contact(
		input: ContactActionInput,
		actor: BookingActor = ANONYMOUS_ACTOR,
	): Promise<ServiceResult<{ result: ContactActionResult }>> {
		if (!actor.userId || !actor.accessToken) {
			return fail(401, { message: "Sign in to contact this provider." });
		}
		switch (input.kind) {
			case "discovery_call":
				return await bookDiscoveryCall(input, actor);
			case "ask_question":
				return await askQuestion(input, actor);
			case "custom_quote":
				return await requestQuote(input, actor);
		}
	}
}

// #region Contact branches
/**
 * The sentence (and the field) a discovery-call refusal is reported with. The database names the
 * reason (`scheduling.fn_call_request_refusal`, `request_discovery_call`); this maps it onto the modal
 * control it belongs to.
 */
const CALL_REFUSAL: Record<string, { field: string; message: string }> = {
	calls_not_offered: { field: "kind", message: "This provider is not taking calls." },
	courtesy_not_offered: { field: "callType", message: "This provider does not offer free calls." },
	paid_not_offered: { field: "callType", message: "This provider does not offer paid consultations." },
	duration_mismatch: { field: "startsAt", message: "That call length does not match the provider's." },
	duration_exceeds_platform_max: { field: "startsAt", message: "That call is longer than calls may run." },
	inside_minimum_notice: { field: "startsAt", message: "That is too soon — this provider needs more notice." },
	beyond_booking_horizon: {
		field: "startsAt",
		message: "That is further ahead than this provider's calendar is open.",
	},
	outside_call_window: { field: "startsAt", message: "The provider does not take calls at that time." },
	slot_unavailable: { field: "startsAt", message: "Someone booked that time first. Pick another slot." },
	weekly_courtesy_cap_reached: {
		field: "startsAt",
		message: "This provider has no free calls left that week.",
	},
	requester_in_cooldown: {
		field: "callType",
		message: "You have had a free call with this provider recently. Try again later.",
	},
	agenda_required: { field: "agenda", message: "This provider asks what the call is about before confirming." },
	platform_not_offered: { field: "platform", message: "This provider does not take calls on that platform." },
	platform_required: { field: "platform", message: "Choose which platform the call should be on." },
	listing_mismatch: { field: "subjectId", message: "That listing is not this provider's." },
	self_booking: { field: "handle", message: "You cannot book a call with yourself." },
	not_signed_in: { field: "kind", message: "Sign in to book a call." },
};

/** The reason code inside a `Discovery call refused: <reason>` exception, or `null`. */
function refusalCode(message: string): string | null {
	const match = /Discovery call refused: ([a-z_]+)/.exec(message);
	return match ? match[1] : null;
}

/**
 * Book a discovery call.
 *
 * The slot is re-resolved through the reader that drew the grid (so the refusal names the control
 * the buyer used), then requested through `scheduling.request_discovery_call`, which derives the host,
 * the fee and the status from the schedule — and whose BEFORE INSERT gate re-judges the slot with the
 * same rules. The caller never writes the row directly: there is no client INSERT policy.
 */
async function bookDiscoveryCall(
	input: DiscoveryCallRequest,
	actor: BookingActor,
): Promise<ServiceResult<{ result: ContactActionResult }>> {
	const handle = input.handle.replace(/^@+/, "");
	if (!handle) return fail(422, { message: "That provider could not be resolved." });

	// The owner: the listing's when the call was booked from one, else the profile's.
	let owner: ScheduleOwner;
	let hostName = "The provider";
	let blueprintId: string | null = null;
	if (input.subjectId) {
		const item = findItem(input.subjectId);
		const lo = item ? listingOwner(item.id) : null;
		if (!item || !lo) return fail(404, { message: `No listing found for id "${input.subjectId}".` });
		owner = lo.schedule;
		hostName = item.owner.name;
		blueprintId = lo.blueprintId;
	} else {
		const resolved = await profileOwner(handle);
		if (resolved === undefined) return unavailable();
		if (!resolved) return fail(404, { message: "That provider could not be resolved." });
		owner = resolved;
	}

	const call = await callOfferOf(owner);
	if (call === undefined) return unavailable();
	if (!call) return refused("calls_not_offered");
	if (input.callType === "courtesy" && !call.courtesyEnabled) return refused("courtesy_not_offered");
	if (input.callType === "paid" && !call.paidEnabled) return refused("paid_not_offered");
	if (call.agendaRequired && !input.agenda?.trim()) return refused("agenda_required");

	// A provider with platforms takes only one of THEIRS. A buyer who did not choose (the listing's
	// modal asks only for a time) gets the host's own first choice — their stated order is a
	// preference, not a random pick. With none, the host arranges the room, and a named platform is a
	// claim about a connection that does not exist.
	let platform: ConferencingProvider | null = null;
	if (call.platforms.length > 0) {
		if (input.platform && !call.platforms.includes(input.platform)) return refused("platform_not_offered");
		platform = input.platform ?? call.platforms[0];
	} else if (input.platform) {
		return fail(422, {
			message: "This provider arranges the call room themselves.",
			errors: { platform: "platform_not_offered" },
		});
	}

	const query: SlotQuery = {
		subjectId: handle,
		purpose: "discovery_call",
		timezone: input.timezone,
		days: 60,
		callType: input.callType,
	};
	const gridInput: SlotGridRequest = {
		sessionCount: 1,
		durationMinutes: callDurationFor(call, input.callType),
		seatsPerSession: null,
	};
	const target = { owner, kind: "call_window" as const };

	let startsAt: number;
	let endsAt: number;
	if (input.startsAt !== undefined) {
		const check = await ScheduleBackendService.resolveCustomStart(query, gridInput, target, input.startsAt);
		if (!check.ok || !check.data) return fail(check.status, { message: check.message, errors: check.errors });
		startsAt = check.data.slot.startsAt;
		endsAt = check.data.slot.endsAt;
	} else {
		const check = await ScheduleBackendService.resolveSlot(query, gridInput, target, input.slotId ?? "");
		if (!check.ok || !check.data) return fail(check.status, { message: check.message, errors: check.errors });
		startsAt = check.data.slot.startsAt;
		endsAt = check.data.slot.endsAt;
	}

	const scheduleId = await scheduleIdOf(owner);
	if (scheduleId === undefined) return unavailable();
	if (!scheduleId) return refused("calls_not_offered");

	const { data, error } = await getUserClient(actor.accessToken!).schema("scheduling")
		.rpc("request_discovery_call", {
			p_schedule: scheduleId,
			p_call_type: input.callType,
			p_starts_at: new Date(startsAt).toISOString(),
			p_ends_at: new Date(endsAt).toISOString(),
			p_agenda: input.agenda ?? null,
			p_requester_timezone: input.timezone ?? null,
			p_provider_slug: platform,
			p_service_blueprint_id: blueprintId,
		});
	if (error) {
		const code = refusalCode(error.message);
		if (code) return refused(code);
		console.error("[booking] request_discovery_call failed", error.message);
		return unavailable();
	}
	const booking = data as { id: string; status: "proposed" | "confirmed" };

	return ok({
		result: {
			kind: "discovery_call",
			referenceId: booking.id,
			// `proposed` is not `confirmed`, and a surface that said "your call is booked" for a request
			// the host has not answered would be wrong in a way the buyer discovers when nobody joins.
			confirmation: booking.status === "confirmed"
				? "Your call is booked."
				: `Requested. ${hostName} has been told and will confirm the time.`,
			navigateTo: null,
		},
	}, { status: 201 });
}

function refused<T>(code: string): ServiceResult<T> {
	const refusal = CALL_REFUSAL[code] ?? { field: "kind", message: "That call could not be booked." };
	return fail(code === "slot_unavailable" ? 409 : 422, {
		message: refusal.message,
		errors: { [refusal.field]: code },
	});
}

/**
 * Ask the listing's owner a question — a real conversation with the message posted in the same act,
 * so a thread is never created while the question is lost.
 *
 * Addressed to the ACCOUNTABLE person behind the listing (a team's listing reaches the person who
 * answers for the team), by user id rather than by the listing's `@handle`, which for a team names no
 * person at all.
 */
async function askQuestion(
	input: AskQuestionInput,
	actor: BookingActor,
): Promise<ServiceResult<{ result: ContactActionResult }>> {
	const item = findItem(input.subjectId);
	const owner = item ? listingOwner(item.id) : null;
	if (!item || !owner) return fail(404, { message: `No listing found for id "${input.subjectId}".` });
	if (owner.accountUserId === actor.userId) {
		return fail(422, { message: "That is your own listing.", errors: { handle: "self_message" } });
	}

	const created = await MessagingBackendService.createConversation(
		{ contactIds: [owner.accountUserId], message: input.message },
		readerOf(actor),
	);
	if (!created.ok || !created.data) {
		return fail(created.status, { message: created.message, errors: created.errors });
	}
	if (!created.data.messageAccepted) {
		return fail(502, {
			message: "The conversation was opened, but your message did not send. Try again from Messages.",
		});
	}
	return ok({
		result: {
			kind: "ask_question",
			referenceId: created.data.id,
			confirmation: "Message sent.",
			navigateTo: `/messages/${created.data.id}`,
		},
	}, { status: 201 });
}

/**
 * Record a custom-scope proposal against the service blueprint (`marketplace.quote_requests`), as the
 * buyer — the policy pins the host to the blueprint's seller and requires the listing to be published.
 *
 * The budget is SOFT and is stored as one: a service's price is provider-set, so this is "here is what
 * I have in mind", not a counter-offer, and it is optional.
 */
async function requestQuote(
	input: QuoteRequestInput,
	actor: BookingActor,
): Promise<ServiceResult<{ result: ContactActionResult }>> {
	const item = findItem(input.subjectId);
	const owner = item ? listingOwner(item.id) : null;
	if (!item || !owner) return fail(404, { message: `No listing found for id "${input.subjectId}".` });
	if (!owner.blueprintId) {
		return fail(422, {
			message: "Custom quotes are for services.",
			errors: { subjectId: "not_quotable" },
		});
	}
	if (owner.accountUserId === actor.userId) {
		return fail(422, { message: "That is your own listing.", errors: { handle: "self_quote" } });
	}
	if (input.budgetMinor !== undefined && !input.currency) {
		return fail(422, { message: "Add a currency for that budget.", errors: { currency: "currency_required" } });
	}

	const { data, error } = await getUserClient(actor.accessToken!).schema("marketplace")
		.from("quote_requests")
		.insert({
			blueprint_id: owner.blueprintId,
			host_user_id: owner.accountUserId,
			requester_user_id: actor.userId,
			scope: input.scope,
			budget_cents: input.budgetMinor ?? null,
			currency: input.budgetMinor !== undefined ? input.currency?.toUpperCase() ?? null : null,
			timeline: input.timeline ?? null,
		})
		.select("id")
		.single();
	if (error || !data) {
		console.error("[booking] quote request failed", error?.message);
		return fail(error?.code === "42501" ? 403 : 503, {
			message: "The quote request could not be sent. Please try again.",
		});
	}

	return ok({
		result: {
			kind: "custom_quote",
			referenceId: (data as { id: string }).id,
			confirmation: `Sent to ${item.owner.name}. They will reply with a scope and a price.`,
			// Resolves in place: a quote has no thread yet — the provider's reply creates one.
			navigateTo: null,
		},
	}, { status: 201 });
}
// #endregion

// #region Helpers
/**
 * The listing's composed page, from the catalogue snapshot `findItem` resolved it from a line
 * earlier — so the booking flow reads exactly the intake, session format and stage template the page
 * rendered. The throw is unreachable: `findItem` only returns an item when that snapshot exists.
 */
function buildViewPage(item: ExploreItem): EntityView {
	const view = composeLoadedViewPage(item);
	if (!view) throw new Error("explore catalogue snapshot vanished between two reads");
	return view;
}

/** Whether the owner publishes a schedule a session can be booked into. */
async function publishesSchedule(owner: ScheduleOwner): Promise<boolean> {
	return (await scheduleIdOf(owner)) ? true : false;
}

/** The basket read scope for an actor, narrowed to the listing being bought. */
function basketQueryFor(actor: BookingActor, serviceId: string): BasketQuery {
	return {
		basketId: null,
		owner: actor.owner ?? null,
		display: actor.display ?? null,
		serviceId,
	};
}

/** The listing's full-page schedule leaf, in the namespace the viewer is reading it from. */
function scheduleHrefFor(item: ExploreItem, handle: string | null): string {
	return handle ? `/${handle}/view/${item.id}/schedule` : `/view/${item.id}/schedule`;
}

/** The sign-in bounce that returns to the listing the viewer is on. */
function signInHrefFor(item: ExploreItem, handle: string | null): string {
	const target = handle
		? `/${handle}/view/${item.id}?type=${item.type}`
		: `/view/${item.id}?type=${item.type}`;
	return `/login?redirectTo=${encodeURIComponent(target)}`;
}
// #endregion
