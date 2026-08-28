import type { JSX } from "preact";
import { useComputed, useSignal } from "@preact/signals";
import { Icon } from "@projective/ui/icons";
import { CtaButton, CtaLink } from "./CtaButton.tsx";
import { useCtaFeedback } from "../core/cta-feedback.ts";
import { BookingService } from "../core/BookingService.ts";
import { bookingSim } from "../core/booking-seam.ts";
import { announce, applyOffer, currentOffer, openBookingPanel } from "../core/booking-state.ts";
import ContactPopover from "../islands/ContactPopover.island.tsx";
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
 * With a draft in place the primary becomes **Open project →**, and removal moves to a secondary
 * control behind an explicit confirmation. A conversion CTA that turned into a delete would put a
 * destructive action under a cursor that was hovering the primary one render ago, and the reader's
 * next click is aimed at where the button WAS rather than at what it now says (root CLAUDE.md §3).
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
	const offer = useComputed(() => currentOffer.value ?? ssrOffer);
	const cta = offer.value.cta;

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

			case "instantiate_pipeline": {
				if (bouncedGuest()) return false;
				const res = await BookingService.instantiatePipeline({
					serviceId: offer.value.subjectId,
					workspaceId: null,
					/*
					 * A stable key per (listing, tab-session).
					 *
					 * Instantiation creates a project, so a double-press or a retry after an unseen timeout
					 * must resolve to the SAME draft rather than leaving two identical pipelines in someone's
					 * workspace. Deriving it from the listing id plus a per-load nonce is enough: a retry
					 * within one page load is the case that needs protecting, and a genuinely new visit
					 * legitimately wants a new key.
					 */
					idempotencyKey: `${offer.value.subjectId}-${loadNonce()}`,
				});
				if (!res.ok || !res.data) {
					error.value = res.message ?? "Could not add that to your projects.";
					return false;
				}
				announce(
					res.data.created
						? "Added to your projects as a draft."
						: "This service is already in your projects.",
				);
				// Re-read so BOTH regions flip to "Open project" together. Patching the local offer would
				// leave whichever region did not perform the write showing the old verb.
				const fresh = await BookingService.offer(offer.value.subjectId, { sim: bookingSim() });
				if (fresh.ok && fresh.data) applyOffer(fresh.data.offer);
				return true;
			}

			case "buy_now":
			case "add_to_basket":
				// Instant checkout and the basket are the checkout feature's own flows; the lane and the
				// buy bar wire their own handlers to them and pass them in, so this rig never grows a
				// second implementation of a purchase.
				if (bouncedGuest()) return false;
				return onPrimaryPurchase ? await onPrimaryPurchase() : false;

			case "open_project":
			case "unavailable":
				// Neither writes: one is a link (rendered as `CtaLink` below) and the other is refused.
				return false;
		}
		return false;
	}

	async function archiveDraft(): Promise<boolean> {
		const draft = offer.value.draft;
		if (!draft) return false;
		const res = await BookingService.archiveDraft({ projectId: draft.projectId });
		if (!res.ok) {
			error.value = res.message ?? "Could not archive that draft.";
			return false;
		}
		announce("Draft archived.");
		confirmArchive.value = false;
		const fresh = await BookingService.offer(offer.value.subjectId, { sim: bookingSim() });
		if (fresh.ok && fresh.data) applyOffer(fresh.data.offer);
		return true;
	}

	const draft = offer.value.draft;

	return (
		<div class={layout === "bar" ? "evp-cta evp-cta--bar" : "evp-cta"}>
			{cta.primary.href
				? (
					<CtaLink
						label={cta.primary.label}
						ariaLabel={cta.primary.ariaLabel}
						href={cta.primary.href}
						icon={<Icon name="arrow-right" size="sm" aria-hidden />}
					/>
				)
				: (
					<CtaButton
						label={cta.primary.label}
						ariaLabel={cta.primary.ariaLabel}
						settledLabel={settledLabelFor(cta.primary.kind)}
						phase={primary.phase}
						disabled={cta.primary.disabled}
						icon={<Icon name={primaryGlyph(cta.primary.kind)} size="sm" aria-hidden />}
						onClick={() => void primary.run(runPrimary)}
					/>
				)}

			{
				/*
			  A refused primary states its reason NEXT TO ITSELF rather than in a `title` or a tooltip.
			  "Cohort full" with no explanation reads as a bug; the sentence is the difference between a
			  reader leaving and a reader looking at the next available cohort.
			*/
			}
			{cta.primary.disabled && cta.primary.disabledReason && (
				<p class="evp-cta__reason">{cta.primary.disabledReason}</p>
			)}

			{cta.secondary && onAddToBasket && (
				<CtaButton
					label={inBasket ? "In basket" : cta.secondary.label}
					settledLabel="Added"
					tone="brand"
					variant="outlined"
					phase={secondary.phase}
					icon={<Icon name={inBasket ? "check" : "basket"} size="sm" aria-hidden />}
					onClick={() =>
						void secondary.run(async () => {
							if (bouncedGuest()) return false;
							return onAddToBasket ? await onAddToBasket() : false;
						})}
				/>
			)}

			{
				/*
			  The draft's secondary controls. Present only once a draft exists, so the rig does not carry
			  a management affordance for something that has not been created.
			*/
			}
			{draft && (
				<div class="evp-cta__draft">
					{draft.archivesAt !== null && (
						<p class="evp-cta__drafthint">
							Unfunded drafts are archived after 30 days of inactivity.
						</p>
					)}
					{confirmArchive.value
						? (
							<div class="evp-cta__confirm" role="group" aria-label="Confirm archiving this draft">
								<span class="evp-cta__confirmtext">Archive this draft?</span>
								<button
									type="button"
									class="evp-cta__confirmno"
									onClick={() => (confirmArchive.value = false)}
								>
									Keep
								</button>
								<button
									type="button"
									class="evp-cta__confirmyes"
									onClick={() => void archiveDraft()}
								>
									Archive
								</button>
							</div>
						)
						: (
							<button
								type="button"
								class="evp-cta__draftaction"
								onClick={() => (confirmArchive.value = true)}
							>
								<Icon name="archive-box" size="sm" aria-hidden />
								<span>Remove draft</span>
							</button>
						)}
				</div>
			)}

			<ContactPopover offer={offer.value} variant={layout === "bar" ? "block" : "ghost"} />

			{error.value && <p class="evp-cta__reason" role="alert">{error.value}</p>}
		</div>
	);
}

// #region Copy
/** The glyph a primary carries at rest, per action kind. */
function primaryGlyph(
	kind: BookingActionKind,
): "calendar" | "basket" | "plus" | "arrow-right" | "close" {
	switch (kind) {
		case "open_scheduler":
			return "calendar";
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
		default:
			return "Done";
	}
}

/**
 * A per-page-load nonce for idempotency keys.
 *
 * Module-level and computed once, so every press within one page load shares it — which is exactly
 * the window a double-press or a retry lives in. `crypto.randomUUID` where available, and a
 * timestamp-plus-counter fallback where it is not (an insecure context has no `crypto.randomUUID`,
 * and the key only has to be unique per load rather than unguessable).
 */
let nonce: string | null = null;
function loadNonce(): string {
	if (nonce) return nonce;
	try {
		nonce = crypto.randomUUID();
	} catch {
		nonce = `${Date.now().toString(36)}-${Math.floor(performance.now()).toString(36)}`;
	}
	return nonce;
}
// #endregion
