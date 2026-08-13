import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import type { Signal } from "@preact/signals";
import "../styles/checkout.css";
import "../styles/checkout-payment.css";
import { Dialog } from "@projective/ui/feedback";
import { Button, Checkbox, InputText } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";

/**
 * AddPaymentMethodModal — attaching a new way to pay, without ever touching a card number.
 *
 * ## The custody rule, enforced by construction
 *
 * There is **no PAN field, no expiry field and no CVV field anywhere in this component**, and there
 * is nowhere for one to be added: the payload the platform can send (`SaveCardInput`) has no key to
 * put a number in, and `CardsService`'s own contract says so in as many words. A card is entered
 * into an iframe Stripe serves and this application does not script; what comes back is an opaque
 * payment-method id, and brand/last4/expiry are resolved server-side from Stripe rather than
 * accepted from a client that could mislabel them.
 *
 * That is why the card tab renders a **placeholder region** where the Stripe field will mount rather
 * than a disabled-looking input: an input the buyer can click into, that looks like it wants a card
 * number, is a custody claim — it says "give us your card details" on a surface whose entire design
 * refuses to hold them. A labelled empty frame says the opposite, honestly.
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
 * Neither commit is wired yet: Stripe Elements is not mounted in this build, and bank mandates are
 * arranged with the finance team rather than self-served. Both primaries therefore render
 * **disabled with the reason printed beneath them** — the platform's gate-versus-absence rule
 * (a capability the account does not have is absent; one it is not yet allowed to use is present and
 * locked with the reason attached). The alternative — a button that appears to work and quietly does
 * nothing — is the failure this codebase has already shipped once and fixed.
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
}
// #endregion

/** The tab strip's vocabulary — id, label and the glyph that marks it. */
const TABS: readonly { id: MethodTab; label: string; icon: "catalogue" | "building" }[] = [
	{ id: "card", label: "Pay via card (Stripe)", icon: "catalogue" },
	{ id: "bank", label: "Bank transfer / Direct Debit", icon: "building" },
];

/** Attach a new payment method to the acting account. */
export default function AddPaymentMethodModal(props: AddPaymentMethodModalProps): JSX.Element {
	const { open } = props;

	const tab = useSignal<MethodTab>("card");
	const cardholder = useSignal<string>("");
	const makeDefault = useSignal<boolean>(true);
	const reference = useSignal<string>("");

	const panelId = (id: MethodTab) => `cko-addpm-panel-${id}`;
	const tabId = (id: MethodTab) => `cko-addpm-tab-${id}`;

	/*
	 * A tab strip is a single tab stop with arrow-key movement between its tabs — the roving pattern
	 * the card picker already uses. Home/End are included because a two-tab strip today may not be a
	 * two-tab strip once a wallet or a local scheme is added, and a keyboard model that only works at
	 * one length is a keyboard model that breaks silently.
	 */
	const onTabKey = (event: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
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
		? "Card entry is served by Stripe and isn't connected in this environment yet."
		: "Bank mandates are set up with the finance team, so this can't be completed here yet.";

	const footer = (
		<div class="cko-addpm__foot">
			<p class="cko-addpm__gate" id="cko-addpm-gate">
				<Icon name="lock" />
				<span>{gateReason}</span>
			</p>
			<div class="cko-addpm__acts">
				<Button
					variant="text"
					label="Cancel"
					onClick={() => {
						open.value = false;
					}}
				/>
				<Button
					variant="filled"
					severity="warning"
					disabled
					aria-describedby="cko-addpm-gate"
					label={tab.value === "card" ? "Add card" : "Save bank details"}
				/>
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
						<p class="cko-addpm__lede">
							Your card details are entered directly with Stripe, our payment processor. Projective
							never sees or stores your card number, and there is nowhere on this page to type one.
						</p>

						{
							/*
							 * The mount point, drawn as an empty labelled frame. `aria-hidden` because it is a
							 * reserved space rather than content: announcing "card number, blank" would promise a
							 * field that is not there.
							 */
						}
						<div class="cko-addpm__mount" aria-hidden="true">
							<span class="cko-addpm__mount-mark">
								<Icon name="lock" />
							</span>
							<span class="cko-addpm__mount-text">Secure card field — provided by Stripe</span>
						</div>
						<p class="cko-addpm__mount-note">
							This is where Stripe's secure field appears once payments are connected.
						</p>

						<div class="cko-addpm__field">
							<label class="cko-addpm__label" for="cko-addpm-name">
								Name on the card
							</label>
							<InputText
								id="cko-addpm-name"
								value={cardholder}
								block
								autoComplete="cc-name"
								placeholder="As printed on the card"
								maxLength={120}
							/>
							<p class="cko-addpm__hint">
								Used only to label the card in your list, so you can tell two apart.
							</p>
						</div>

						<div class="cko-addpm__row">
							<Checkbox
								id="cko-addpm-default"
								value={makeDefault}
								label="Use this card by default"
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
