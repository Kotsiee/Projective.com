import type { JSX, RefObject } from "preact";
import { useComputed, useSignal } from "@preact/signals";
import { Popover } from "@projective/ui/feedback";
import { Avatar } from "@projective/ui/display";
import { Icon } from "@projective/ui/icons";
import "../styles/service-booking.css";
import { BookingService } from "../core/BookingService.ts";
import { bookingSim } from "../core/booking-seam.ts";
import { announce, currentOffer, openBookingPanel } from "../core/booking-state.ts";
import { useCtaFeedback } from "../core/cta-feedback.ts";
import type { ContactActionKind, ServiceBookingOffer } from "@projective/types/services";

/**
 * ContactPopover — the **Contact Me** secondary control and its context-sensitive menu.
 *
 * Three actions, each routing to a different system: a discovery call (`scheduling.discovery_calls`),
 * a question (`comms.get_or_create_dm_thread`, opened at `/messages/[chatId]`), and a custom-scope
 * proposal against the service blueprint. None of the three creates a project, a stage, a ticket or an
 * escrow — `PRODUCT_SPEC.md` §Discovery & Courtesy Calls states that for a call, and it holds for the
 * whole menu.
 *
 * # Absence, not disablement
 *
 * A seller who takes no discovery calls has NO discovery-call row. That is the opposite of the
 * cohort-full CTA, which is rendered-and-refused, and the difference is real: a full cohort is a
 * capability that exists and is exhausted (information a buyer came for), while a seller who does not
 * take calls has a capability that does not exist. A greyed-out row for the second implies they might,
 * and then refuses — the §D.7.7 defect of an affordance that advertises and declines.
 *
 * # The panel escapes its own lane
 *
 * It renders through `BodyPortal` (which `Popover` does) and claims a layer from `useOverlayStack`.
 * The conversion lane is a stacking context with `overflow: clip` and a `backdrop-filter` on the guest
 * shell, so a panel that stayed in the subtree would be clipped by its own container or re-based
 * against the wrong origin (§B.10, and the trap Decision #50 fixed platform-wide).
 *
 * # The composer is inline, deliberately
 *
 * "Ask a question" opens a textarea inside the panel rather than a second modal. Two overlays for one
 * sentence is a stack the reader has to unwind, and the profile page's quick-message popover already
 * proved the inline form is enough. It does NOT reuse `ChatComposer` — that transitively pulls the
 * asset picker and the `MediaRecorder` engine onto a public, guest-reachable, SEO-facing page for what
 * is a textarea and a Send button.
 */
export interface ContactPopoverProps {
	offer: ServiceBookingOffer;
	/** Rendered as a compact ghost control in the lane, or a full-width one in the mobile buy bar. */
	variant?: "ghost" | "block";
}

export default function ContactPopover(
	{ offer: ssrOffer, variant = "ghost" }: ContactPopoverProps,
): JSX.Element {
	const offer = useComputed(() => currentOffer.value ?? ssrOffer);
	const contact = useComputed(() => offer.value.contact);
	/*
	 * The panel's open state is OWNED here rather than left uncontrolled.
	 *
	 * `Popover`'s children are plain nodes, not a render prop, so the panel's own contents have no
	 * handle on the trigger api — and this panel closes itself from three places (a row that opens a
	 * modal, a successful send, the Back control). A controlled signal is the only way all three reach
	 * the same close.
	 */
	const open = useSignal(false);
	const composing = useSignal(false);
	const draft = useSignal("");
	const error = useSignal<string | null>(null);
	const cta = useCtaFeedback();

	function close(): void {
		open.value = false;
	}

	/** Route a menu row. A guest is bounced first, with a return path to this listing. */
	function act(kind: ContactActionKind): void {
		if (contact.value.requiresSignIn) {
			const href = contact.value.signInHref;
			close();
			if (href) {
				try {
					globalThis.location.href = href;
				} catch { /* SSR / no window — non-fatal */ }
			}
			return;
		}
		switch (kind) {
			case "discovery_call":
				close();
				openBookingPanel("call");
				break;
			case "custom_quote":
				close();
				openBookingPanel("quote");
				break;
			case "ask_question":
				// Stays in the panel: the composer is right here, and closing to reopen something else
				// would cost the reader the context they pressed from.
				composing.value = true;
				break;
		}
	}

	async function send(): Promise<boolean> {
		const message = draft.value.trim();
		if (!message) {
			error.value = "Write your question first.";
			return false;
		}
		error.value = null;
		const res = await BookingService.contact({
			kind: "ask_question",
			handle: contact.value.handle,
			subjectId: contact.value.subjectId,
			message,
		}, bookingSim());
		if (!res.ok || !res.data) {
			// The draft is deliberately KEPT on failure. A composer that eats what somebody typed is
			// worse than one that refuses to open.
			error.value = res.message ?? "Could not start that conversation. Your message has been kept.";
			return false;
		}
		announce(res.data.result.confirmation);
		const to = res.data.result.navigateTo;
		draft.value = "";
		setTimeout(() => {
			close();
			if (to) {
				try {
					globalThis.location.href = to;
				} catch { /* SSR / no window — non-fatal */ }
			}
		}, 700);
		return true;
	}

	return (
		<Popover
			open={open}
			placement="top-start"
			avoid={[".ui-app-shell__sidebar"]}
			class="sbk-contact"
			onOpenChange={(next) => {
				if (next) return;
				// Closing resets the panel to its menu. Re-opening onto a half-written question the reader
				// has already dismissed once is a panel arguing with them.
				composing.value = false;
				error.value = null;
				cta.reset();
			}}
			trigger={(api) => (
				<button
					type="button"
					ref={api.ref as RefObject<HTMLButtonElement>}
					class={variant === "block" ? "evp-cta__ghost sbk-contact__trigger--block" : "evp-cta__ghost"}
					aria-expanded={api.expanded ? "true" : "false"}
					aria-controls={api.panelId}
					aria-haspopup="menu"
					onClick={api.toggle}
				>
					<Icon name="message" size="sm" aria-hidden />
					<span>Contact me</span>
				</button>
			)}
		>
			<div class="sbk-contact__panel">
					<header class="sbk-contact__head">
						<Avatar
							image={contact.value.sellerAvatar ?? undefined}
							label={contact.value.sellerName}
							size={28}
							shape="circle"
						/>
						<div class="sbk-contact__who">
							<span class="sbk-contact__name">{contact.value.sellerName}</span>
							<span class="sbk-contact__handle">@{contact.value.handle}</span>
						</div>
					</header>

					{composing.value
						? (
							<div class="sbk-contact__compose">
								<p class="sbk-contact__about">
									About <span class="sbk-contact__subject">{contact.value.subjectTitle}</span>
								</p>
								<label class="ui-visually-hidden" for="sbk-contact-msg">
									Your question for {contact.value.sellerName}
								</label>
								<textarea
									id="sbk-contact-msg"
									class="sbk-contact__field"
									rows={4}
									autoFocus
									placeholder={`Hi ${
										contact.value.sellerName.split(/\s+/)[0] ?? contact.value.sellerName
									}, before I buy…`}
									value={draft.value}
									disabled={cta.busy}
									onInput={(e) => (draft.value = (e.target as HTMLTextAreaElement).value)}
								/>
								<p class="sbk-contact__hint">
									This starts a conversation, not a project.
								</p>
								{error.value && <p class="sbk-contact__error" role="alert">{error.value}</p>}
								<div class="sbk-contact__actions">
									<button
										type="button"
										class="sbk-contact__back"
										onClick={() => (composing.value = false)}
									>
										Back
									</button>
									<button
										type="button"
										class="sbk-contact__send"
										disabled={!draft.value.trim() || cta.busy}
										aria-busy={cta.busy ? "true" : undefined}
										data-phase={cta.phase}
										onClick={() => void cta.run(send)}
									>
										{cta.phase === "settled"
											? <Icon name="check" size="sm" aria-hidden />
											: <Icon name="send" size="sm" aria-hidden />}
										<span>
											{cta.phase === "pending"
												? "Sending…"
												: cta.phase === "settled"
												? "Sent"
												: "Send"}
										</span>
									</button>
								</div>
							</div>
						)
						: (
							<div class="sbk-contact__list" role="menu">
								{contact.value.actions.map((action) => (
									<button
										key={action.kind}
										type="button"
										role="menuitem"
										class="sbk-contact__item"
										onClick={() => act(action.kind)}
									>
										<Icon name={glyphFor(action.kind)} size="sm" aria-hidden />
										<span class="sbk-contact__itemtext">
											<span class="sbk-contact__itemlabel">{action.label}</span>
											<span class="sbk-contact__itemhint">{action.description}</span>
										</span>
									</button>
								))}
								{contact.value.requiresSignIn && (
									<p class="sbk-contact__signin">
										You will be asked to sign in first.
									</p>
								)}
							</div>
						)}
			</div>
		</Popover>
	);
}

/**
 * The glyph for a contact action.
 *
 * Three distinct marks for three distinct systems. `calendar` for a booking, `message` for a
 * conversation and `edit` for a written proposal — none of them reused from another meaning in this
 * feature's glyph vocabulary (§B.7.7 — one name, one concept).
 */
function glyphFor(kind: ContactActionKind): "calendar" | "message" | "edit" {
	switch (kind) {
		case "discovery_call":
			return "calendar";
		case "ask_question":
			return "message";
		case "custom_quote":
			return "edit";
	}
}
