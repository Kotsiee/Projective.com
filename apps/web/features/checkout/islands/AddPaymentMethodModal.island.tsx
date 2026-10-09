import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import type { Signal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import "../styles/checkout.css";
import "../styles/checkout-payment.css";
import { Alert, Dialog } from "@projective/ui/feedback";
import { Button, Checkbox, InputText } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import type { CardOwnerScope, CheckoutOwner } from "@projective/types/finance";
import { StripeElementMount } from "@features/payments/components/StripeElementMount.tsx";
import { PaymentsService } from "@features/payments/core/PaymentsService.ts";
import { useStripeCardSetup } from "@features/payments/hooks/useStripeElement.ts";
import { selectPaymentMethod, session } from "../core/basket-state.ts";

/**
 * AddPaymentMethodModal — attaching a new way to pay, without ever touching a card number.
 *
 * ## The custody rule, enforced by construction
 *
 * There is **no PAN field, no expiry field and no CVV field anywhere in this component**, and there
 * is nowhere for one to be added. A card is entered into Stripe's Payment Element — an iframe Stripe
 * serves and this application does not script — confirmed as a SetupIntent, and recorded by the server
 * from Stripe's own answer: brand, last four, expiry and the `pm_…` reference, never a value a client
 * could mislabel. Nothing is typed here that Projective keeps: the card's name on the list is the
 * network and last four, read from Stripe.
 *
 * ## Card first
 *
 * The card form is on screen the moment the card tab is: Stripe's deferred-intent flow mounts the
 * Element before any SetupIntent exists (`GET /api/finance/cards/setup` → the Element). Save — in the
 * footer, beside Cancel — runs `elements.submit()` → `POST /api/finance/cards/setup` (the owner is
 * authorised and the SetupIntent opened) → `stripe.confirmSetup` → `POST /api/finance/cards/confirm`.
 * The recorded card becomes the selected way to pay.
 *
 * ## Two tabs because they are two different arrangements, not two skins
 *
 * A card is attached instantly and charged per purchase. A bank transfer / Direct Debit is set up
 * once with a reference the finance team matches payments against, and settles on its own terms. The
 * facts each needs share nothing, so folding them into one form with a mode switch would leave every
 * field conditional on something.
 *
 * ## What is honestly refused
 *
 * Bank mandates are arranged with the finance team rather than self-served, so that tab's primary
 * renders **disabled with the reason printed beneath it** — the gate-versus-absence rule (a capability
 * the account is not yet allowed to use is present and locked with the reason attached). The card tab
 * is locked the same way only where cards genuinely cannot be added: the processor is not connected in
 * this environment, or the paying account is one a card cannot be saved to from here.
 *
 * The panel renders through `Dialog`, which portals to `document.body`: the checkout regions carry
 * `container-type: inline-size`, which makes each of them a containing block for `position: fixed`,
 * so a hand-rolled fixed panel here would be re-based and clipped.
 */

// #region Props
/** The two arrangements this modal can set up. */
type MethodTab = "card" | "bank";

/** Props for {@link AddPaymentMethodModal}. */
export interface AddPaymentMethodModalProps {
	/** Controlled visibility, so the payment screen owns when it opens. */
	open: Signal<boolean>;
	/** The account paying — the card is saved to IT. */
	owner: Pick<CheckoutOwner, "ownerType" | "ownerId">;
	/** Whether cards can be saved in this environment (the server's answer, from the session). */
	cardsConnected: boolean;
	/**
	 * Called with the new card's id once the server has recorded it — by then it is already the
	 * selected payment method (`selectPaymentMethod`).
	 */
	onSaved: (cardId: string) => void;
}
// #endregion

/** The tab strip's vocabulary — id, label and the glyph that marks it. */
const TABS: readonly { id: MethodTab; label: string; icon: "catalogue" | "building" }[] = [
	{ id: "card", label: "Pay via card (Stripe)", icon: "catalogue" },
	{ id: "bank", label: "Bank transfer / Direct Debit", icon: "building" },
];

/** Which card owner a checkout account is, or `null` when a card cannot be saved to it from here. */
function cardScopeOf(ownerType: string): CardOwnerScope | null {
	if (ownerType === "user" || ownerType === "freelancer") return "personal";
	if (ownerType === "team" || ownerType === "business") return ownerType;
	return null;
}

/** Attach a new payment method to the acting account. */
export default function AddPaymentMethodModal(props: AddPaymentMethodModalProps): JSX.Element {
	const { open } = props;

	const tab = useSignal<MethodTab>("card");
	const makeDefault = useSignal<boolean>(true);
	const reference = useSignal<string>("");
	/** `saving` — Stripe confirmed the card and the server is recording it. */
	const phase = useSignal<"entry" | "saving">("entry");
	/** The SetupIntent Stripe confirmed — kept so a failed record retries the record, never the card. */
	const confirmed = useSignal<string | null>(null);
	const failure = useSignal<string | null>(null);

	const scope = cardScopeOf(props.owner.ownerType);
	const contextId = scope === "personal" ? null : props.owner.ownerId;

	// A closed modal forgets its attempt: a card the buyer walked away from is not resumed.
	const isOpen = open.value;
	useEffect(() => {
		if (isOpen) return;
		phase.value = "entry";
		confirmed.value = null;
		failure.value = null;
	}, [isOpen]);

	const cardGate = !props.cardsConnected
		? "Card entry is served by Stripe and isn't connected in this environment yet."
		: !scope
		? "Cards can't be added to this account from checkout — pay from its wallet."
		: null;
	const liveCard = tab.value === "card" && cardGate === null;

	const card = useStripeCardSetup({
		enabled: isOpen && liveCard,
		// The basket's currency; in setup mode it only filters methods, and a card saves in any.
		currency: session.value?.currency ?? "USD",
		createIntent: async () => {
			if (!scope) return { ok: false, message: cardGate ?? "Cards can't be added here." };
			const res = await PaymentsService.createCardSetup({ scope, contextId });
			return res.ok && res.data
				? { ok: true, setupIntentId: res.data.setupIntentId, clientSecret: res.data.clientSecret }
				: { ok: false, message: res.message ?? "Couldn't start adding a card. Try again." };
		},
	});
	const busy = card.confirming.value || phase.value === "saving";

	const panelId = (id: MethodTab) => `cko-addpm-panel-${id}`;
	const tabId = (id: MethodTab) => `cko-addpm-tab-${id}`;

	/*
	 * A tab strip is a single tab stop with arrow-key movement between its tabs — the roving pattern
	 * the card picker already uses. Home/End are included because a two-tab strip today may not be a
	 * two-tab strip once a wallet or a local scheme is added, and a keyboard model that only works at
	 * one length is a keyboard model that breaks silently.
	 */
	const onTabKey = (event: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
		if (busy) return;
		const at = TABS.findIndex((entry) => entry.id === tab.value);
		let next = at;
		switch (event.key) {
			case "ArrowRight":
			case "ArrowDown":
				next = (at + 1) % TABS.length;
				break;
			case "ArrowLeft":
			case "ArrowUp":
				next = (at - 1 + TABS.length) % TABS.length;
				break;
			case "Home":
				next = 0;
				break;
			case "End":
				next = TABS.length - 1;
				break;
			default:
				return;
		}
		event.preventDefault();
		const chosen = TABS[next];
		if (!chosen) return;
		tab.value = chosen.id;
		document.getElementById(tabId(chosen.id))?.focus();
	};

	const gateReason = tab.value === "card"
		? cardGate
		: "Bank mandates are set up with the finance team, so this can't be completed here yet.";

	const close = () => {
		open.value = false;
	};

	/**
	 * Stripe confirmed the card; the server re-reads the SetupIntent and records it, and the new card
	 * becomes the selected way to pay — one list, one selection, so the wallet cannot stay chosen.
	 */
	const record = async (setupIntentId: string) => {
		if (!scope) return;
		phase.value = "saving";
		failure.value = null;
		const saved = await PaymentsService.confirmCard({
			setupIntentId,
			scope,
			contextId,
			makeDefault: makeDefault.value,
		});
		if (!saved.ok || !saved.data) {
			failure.value = saved.message ?? "The card couldn't be saved. Try again.";
			phase.value = "entry";
			return;
		}
		selectPaymentMethod(`card:${saved.data.cardId}`);
		props.onSaved(saved.data.cardId);
		close();
	};

	/** Save: Stripe validates and confirms the card first; a confirmed card is only re-recorded. */
	const save = async () => {
		if (confirmed.value) return record(confirmed.value);
		failure.value = null;
		const result = await card.confirm();
		if (!result.ok) return;
		confirmed.value = result.id;
		await record(result.id);
	};

	const footer = (
		<div class="cko-addpm__foot">
			{gateReason && (
				<p class="cko-addpm__gate" id="cko-addpm-gate">
					<Icon name="lock" />
					<span>{gateReason}</span>
				</p>
			)}
			<div class="cko-addpm__acts">
				<Button variant="text" rounded label="Cancel" disabled={busy} onClick={close} />
				{!liveCard
					? (
						<Button
							severity="accent"
							variant="filled"
							rounded
							disabled
							aria-describedby="cko-addpm-gate"
							label={tab.value === "card" ? "Save card" : "Save bank details"}
						/>
					)
					: (
						<Button
							severity="accent"
							variant="filled"
							rounded
							label={confirmed.value ? "Try again" : "Save card"}
							loading={busy}
							disabled={busy || (!confirmed.value && !card.canConfirm.value)}
							onClick={() => void save()}
						/>
					)}
			</div>
		</div>
	);

	return (
		<Dialog
			visible={open}
			modal
			class="cko-addpm"
			header="Add a payment method"
			footer={footer}
			width="34rem"
		>
			<div
				class="cko-addpm__tabs"
				role="tablist"
				aria-label="Payment method type"
				onKeyDown={onTabKey}
			>
				{TABS.map((entry) => (
					<button
						key={entry.id}
						type="button"
						id={tabId(entry.id)}
						class="cko-addpm__tab"
						role="tab"
						aria-selected={tab.value === entry.id ? "true" : "false"}
						aria-controls={panelId(entry.id)}
						tabIndex={tab.value === entry.id ? 0 : -1}
						disabled={entry.id !== tab.value && busy}
						onClick={() => {
							tab.value = entry.id;
						}}
					>
						<Icon name={entry.icon} />
						<span class="cko-addpm__tab-label">{entry.label}</span>
					</button>
				))}
			</div>

			{tab.value === "card"
				? (
					<div
						class="cko-addpm__panel"
						id={panelId("card")}
						role="tabpanel"
						aria-labelledby={tabId("card")}
					>
						{liveCard ? <StripeElementMount controller={card} /> : (
							<>
								{
									/*
									 * The mount point, drawn as an empty labelled frame while cards cannot be added.
									 * `aria-hidden` because it is a reserved space rather than content: announcing
									 * "card number, blank" would promise a field that is not there.
									 */
								}
								<div class="cko-addpm__mount" aria-hidden="true">
									<span class="cko-addpm__mount-mark">
										<Icon name="lock" />
									</span>
									<span class="cko-addpm__mount-text">Secure card field — provided by Stripe</span>
								</div>
							</>
						)}

						{failure.value && <Alert severity="danger">{failure.value}</Alert>}

						<div class="cko-addpm__row">
							<Checkbox
								id="cko-addpm-default"
								value={makeDefault}
								label="Use this card by default"
								disabled={busy}
							/>
						</div>
					</div>
				)
				: (
					<div
						class="cko-addpm__panel"
						id={panelId("bank")}
						role="tabpanel"
						aria-labelledby={tabId("bank")}
					>
						<p class="cko-addpm__lede">
							Pay by bank transfer or Direct Debit instead of a card. You'll be sent the account
							details to pay into, and the reference below is how your payment is matched to this
							account.
						</p>

						<div class="cko-addpm__field">
							<label class="cko-addpm__label" for="cko-addpm-ref">
								Your payment reference
							</label>
							<InputText
								id="cko-addpm-ref"
								value={reference}
								block
								placeholder="e.g. a purchase order number"
								maxLength={60}
							/>
							<p class="cko-addpm__hint">
								Anything your own finance team will recognise. No bank details are collected here.
							</p>
						</div>

						<p class="cko-addpm__aside">
							<Icon name="info" />
							<span>
								Bank payments settle on your usual terms rather than immediately, so an order placed
								this way is confirmed once the transfer clears.
							</span>
						</p>
					</div>
				)}
		</Dialog>
	);
}
