import type { JSX } from "preact";
import { useComputed, useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { readDevSeam, subscribeDevSeam } from "@web/utils/dev-seam.ts";
import { previewWaitlistOffer, type WaitlistPreview } from "../core/waitlist-preview.ts";
import { Icon } from "@projective/ui/icons";
import { Button } from "@projective/ui/fields";
import { Tooltip } from "@projective/ui/feedback";
import { CtaButton, CtaLink } from "./CtaButton.tsx";
import { useCtaFeedback } from "../core/cta-feedback.ts";
import { BookingService } from "../core/BookingService.ts";
import {
	announce,
	applyOffer,
	currentOffer,
	openBookingPanel,
	requestContact,
	waitlistJoined,
} from "../core/booking-state.ts";
import { publishCtaMirror } from "../core/cta-mirror.ts";
import ContactPopover from "../islands/ContactPopover.island.tsx";
import { commitArchiveDraft, commitWaitlist } from "../core/booking-commits.ts";
import { SIMULATED_SETTLED_LABEL, simulating } from "../core/simulation.ts";
import { SimulationOutcome } from "./SimulationNotices.tsx";
import type { BookingActionKind, ServiceBookingOffer } from "@projective/types/services";

/**
 * BookingCtaRig — the action rig BOTH transactional regions render.
 *
 * The conversion lane above `--bp-md` and the ≤767px buy bar are two components, and §D.7.4's whole
 * point is that they must never offer different transactions. They share this one rig — which reads
 * the server-resolved offer, so it does not decide anything either — and the only difference between
 * the two mounts is which classes they hang on it.
 *
 * # The pipeline CTA is never destructive
 *
 * **Add to projects** opens the pipeline dialog (the buyer's requirements and the seller's questions)
 * rather than writing on press. With a draft in place the primary becomes **Open project →**, and
 * removal is a circular icon-only ghost beside it, behind an explicit confirmation. A conversion CTA
 * that turned into a delete would put a destructive action under a cursor that was hovering the
 * primary one render ago (root CLAUDE.md §3). Helper text sits ABOVE the primary, so the reader meets
 * the condition before the control it qualifies.
 *
 * # It dispatches on `kind`, not on format
 *
 * Every branch below is a {@link BookingActionKind}, so a new delivery model that reuses an existing
 * flow needs no change here at all — the format only has to resolve to a kind. That is why the CTA
 * descriptor carries the kind rather than the surface re-deriving it from the format.
 */
export interface BookingCtaRigProps {
	/**
	 * The server-resolved offer, which is the rig's ONLY source of truth.
	 *
	 * It deliberately takes no `item`. Everything a control needs — the label, the action kind, the
	 * refusal reason, the seller's contact menu, the sign-in bounce — is on the offer, and accepting the
	 * listing alongside it would invite a branch that read one and ignored the other. That is precisely
	 * how the lane and the buy bar came to derive different verbs for one listing.
	 */
	offer: ServiceBookingOffer;
	/**
	 * The PRIMARY's purchase handler — instant checkout for a product, the basket for everything whose
	 * primary is an add.
	 *
	 * Separate from {@link onAddToBasket} rather than one shared callback, and that separation is a bug
	 * fix rather than tidiness. A single handler had to ask the offer which control had fired it, read
	 * `primary.kind === "buy_now"`, and open instant checkout — so on a digital product the SECONDARY
	 * "Add to basket" opened the Buy-Now modal and added nothing. Measured: the panel opened, the basket
	 * was unchanged, and the control's own feedback cycle never ran because the handler had already
	 * returned false. Two controls, two callbacks; there is now no question for either to get wrong.
	 */
	onPrimaryPurchase?: () => Promise<boolean>;
	/** The SECONDARY basket control's handler. Absent when the listing has no basket line. */
	onAddToBasket?: () => Promise<boolean>;
	/** Whether the listing is already in the basket — the secondary reads "In basket". */
	inBasket?: boolean;
	/** `lane` renders the compact rig; `bar` the mobile block. Presentation only. */
	layout?: "lane" | "bar";
}

export function BookingCtaRig(props: BookingCtaRigProps): JSX.Element {
	const { offer: ssrOffer, onPrimaryPurchase, onAddToBasket, inBasket, layout = "lane" } = props;
	const preview = useSignal<WaitlistPreview | undefined>(undefined);
	const mounted = useSignal(false);
	const offer = useComputed(() =>
		previewWaitlistOffer(currentOffer.value ?? ssrOffer, preview.value, Date.now())
	);
	const cta = offer.value.cta;

	useEffect(() => {
		mounted.value = true;
		const sync = () => (preview.value = readDevSeam()?.waitlistPlace);
		sync();
		return subscribeDevSeam(sync);
	}, []);

	const primary = useCtaFeedback();
	const secondary = useCtaFeedback();
	const confirmArchive = useSignal(false);
	const error = useSignal<string | null>(null);

	/** Bounce a guest to sign-in with a return path. Returns true when it bounced. */
	function bouncedGuest(): boolean {
		if (!offer.value.requiresSignIn) return false;
		const href = offer.value.signInHref;
		if (href) {
			try {
				globalThis.location.href = href;
			} catch { /* SSR / no window — non-fatal */ }
		}
		return true;
	}

	/** The primary's handler, dispatched on the resolved action kind. */
	async function runPrimary(): Promise<boolean> {
		error.value = null;
		switch (cta.primary.kind) {
			case "open_scheduler":
				if (bouncedGuest()) return false;
				openBookingPanel("scheduler");
				return false;

			case "open_scope":
				if (bouncedGuest()) return false;
				openBookingPanel("scope");
				return false;

			case "reserve_seat":
				if (bouncedGuest()) return false;
				openBookingPanel("scheduler");
				return false;

			case "join_waitlist": {
				if (bouncedGuest()) return false;
				const out = await commitWaitlist(offer.value.subjectId);
				if (out.simulated) return true;
				const res = out.value;
				if (!res.ok || !res.data) {
					error.value = res.message ?? "Could not join the waitlist.";
					return false;
				}
				waitlistJoined.value = true;
				announce(
					res.data.already
						? "You were already on the waitlist for this listing."
						: "You're on the waitlist. When a seat is yours, it's held for you.",
				);
				// Re-read so BOTH regions state the place the server gave (the queue position).
				const fresh = await BookingService.offer(offer.value.subjectId);
				if (fresh.ok && fresh.data) applyOffer(fresh.data.offer);
				return true;
			}

			case "instantiate_pipeline":
				if (bouncedGuest()) return false;
				openBookingPanel("pipeline");
				return false;

			case "buy_now":
			case "add_to_basket":
				// Instant checkout and the basket are the checkout feature's own flows; the lane and the
				// buy bar wire their own handlers to them and pass them in, so this rig never grows a
				// second implementation of a purchase.
				if (bouncedGuest()) return false;
				return onPrimaryPurchase ? await onPrimaryPurchase() : false;

			case "open_project":
			case "unavailable":
				// Neither writes: one is a link (rendered as `CtaLink` below) and one is refused.
				return false;
		}
		return false;
	}

	async function archiveDraft(): Promise<boolean> {
		const draft = offer.value.draft;
		if (!draft) return false;
		const out = await commitArchiveDraft({ projectId: draft.projectId });
		if (out.simulated) {
			confirmArchive.value = false;
			return true;
		}
		const res = out.value;
		if (!res.ok) {
			error.value = res.message ?? "Could not archive that draft.";
			return false;
		}
		announce("Draft archived.");
		confirmArchive.value = false;
		const fresh = await BookingService.offer(offer.value.subjectId);
		if (fresh.ok && fresh.data) applyOffer(fresh.data.offer);
		return true;
	}

	const draft = offer.value.draft;
	const waitlist = cta.primary.kind === "join_waitlist";
	const joined = waitlist && waitlistJoined.value;
	const heldUntil = mounted.value && offer.value.waitlist?.status === "invited"
		? offer.value.waitlist.holdExpiresAt
		: null;

	useEffect(() => {
		publishCtaMirror({
			primary: {
				label: joined ? "On the waitlist" : cta.primary.label,
				icon: cta.primary.href
					? "arrow-right"
					: joined
					? "check"
					: primaryGlyph(cta.primary.kind),
				href: cta.primary.href ?? undefined,
				run: cta.primary.href ? undefined : () => void primary.run(runPrimary),
				disabled: cta.primary.disabled || joined,
				tone: "accent",
			},
			secondary: cta.secondary?.kind === "add_to_basket" && onAddToBasket
				? {
					label: inBasket ? "In basket" : cta.secondary.label,
					icon: inBasket ? "check" : "basket",
					run: () =>
						void secondary.run(async () => {
							if (bouncedGuest()) return false;
							return onAddToBasket ? await onAddToBasket() : false;
						}),
				}
				: null,
			contact: { label: "Contact seller", icon: "message", run: () => void requestContact() },
		});
	});

	const primaryControl = cta.primary.href
		? (
			<CtaLink
				label={cta.primary.label}
				ariaLabel={cta.primary.ariaLabel}
				href={cta.primary.href}
				tone="accent"
				icon={<Icon name="arrow-right" size="sm" aria-hidden />}
			/>
		)
		: (
			<CtaButton
				label={joined ? "On the waitlist" : cta.primary.label}
				ariaLabel={joined ? "You're on the waitlist for the next cohort" : cta.primary.ariaLabel}
				settledLabel={simulating.value
					? SIMULATED_SETTLED_LABEL
					: settledLabelFor(cta.primary.kind)}
				phase={primary.phase}
				tone={waitlist ? "neutral" : "accent"}
				disabled={cta.primary.disabled || joined}
				icon={<Icon name={joined ? "check" : primaryGlyph(cta.primary.kind)} size="sm" aria-hidden />}
				spark={cta.primary.kind === "instantiate_pipeline"}
				onClick={() => void primary.run(runPrimary)}
			/>
		);

	return (
		<div class={layout === "bar" ? "evp-cta evp-cta--bar" : "evp-cta"}>
			{cta.primary.disabled && cta.primary.disabledReason && (
				<p class="evp-cta__reason">
					{cta.primary.disabledReason}
				</p>
			)}
			{!cta.primary.disabled && cta.primary.note && (
				<p class="evp-cta__reason">
					{cta.primary.note}
					{heldUntil && (
						<>
							{" Reserve it by "}
							<time dateTime={heldUntil}>{HELD_UNTIL.format(new Date(heldUntil))}</time>.
						</>
					)}
				</p>
			)}
			{draft && draft.archivesAt !== null && (
				<p class="evp-cta__drafthint">
					Unfunded drafts are archived after 30 days of inactivity.
				</p>
			)}

			{draft && !confirmArchive.value
				? (
					<div class="evp-cta__draftrow">
						{primaryControl}
						<Tooltip content="Remove draft">
							<Button
								variant="text"
								severity="secondary"
								size="sm"
								rounded
								iconOnly
								class="evp-cta__draftaction"
								icon={<Icon name="archive-box" size="sm" />}
								aria-label="Remove draft"
								onClick={() => (confirmArchive.value = true)}
							/>
						</Tooltip>
					</div>
				)
				: primaryControl}

			{/* The SECONDARY: the basket line — a write, with its own pending/settled cycle and handler. */}
			{cta.secondary?.kind === "add_to_basket" && onAddToBasket && (
				<CtaButton
					label={inBasket ? "In basket" : cta.secondary.label}
					settledLabel={simulating.value ? SIMULATED_SETTLED_LABEL : "Added"}
					tone="neutral"
					phase={secondary.phase}
					icon={<Icon name={inBasket ? "check" : "basket"} size="sm" aria-hidden />}
					onClick={() =>
						void secondary.run(async () => {
							if (bouncedGuest()) return false;
							return onAddToBasket ? await onAddToBasket() : false;
						})}
				/>
			)}

			{draft && confirmArchive.value && (
				<div class="evp-cta__confirm" role="group" aria-label="Confirm archiving this draft">
					<span class="evp-cta__confirmtext">Archive this draft?</span>
					<Button
						severity="secondary"
						variant="text"
						size="sm"
						label="Keep"
						onClick={() => (confirmArchive.value = false)}
					/>
					<Button
						severity="danger"
						variant="text"
						size="sm"
						label="Archive"
						onClick={() => void archiveDraft()}
					/>
				</div>
			)}

			<ContactPopover offer={offer.value} variant={layout === "bar" ? "block" : "ghost"} />

			{error.value && <p class="evp-cta__reason" role="alert">{error.value}</p>}

			{/* The owner's buyer simulation: what the last commit would have done, beside the rig. */}
			{simulating.value && <SimulationOutcome />}
		</div>
	);
}

// #region Copy
const HELD_UNTIL = new Intl.DateTimeFormat(undefined, {
	weekday: "short",
	day: "numeric",
	month: "short",
	hour: "numeric",
	minute: "2-digit",
});

/** The glyph a primary carries at rest, per action kind. */
function primaryGlyph(
	kind: BookingActionKind,
): "calendar" | "basket" | "plus" | "arrow-right" | "close" | "ticket" | "bell" {
	switch (kind) {
		case "open_scheduler":
			return "calendar";
		case "reserve_seat":
			return "ticket";
		case "join_waitlist":
			return "bell";
		case "instantiate_pipeline":
			return "plus";
		case "open_scope":
			return "arrow-right";
		case "unavailable":
			return "close";
		default:
			return "basket";
	}
}

/**
 * What a settled primary says.
 *
 * A verb in the past tense that matches what actually happened. "Done" would be true of all of them
 * and informative about none — and the settled state is the only confirmation a buyer gets before the
 * page moves.
 */
function settledLabelFor(kind: BookingActionKind): string {
	switch (kind) {
		case "instantiate_pipeline":
			return "Added";
		case "add_to_basket":
			return "In basket";
		case "join_waitlist":
			return "On the waitlist";
		default:
			return "Done";
	}
}

// #endregion
