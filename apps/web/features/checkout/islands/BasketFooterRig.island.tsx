import type { JSX, RefObject, VNode } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import "../styles/checkout.css";
import { Popover, Tooltip } from "@projective/ui/feedback";
import { Button, ZoomSlider } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import type { IconName } from "@projective/ui/icons";
import { basketHref, checkoutHref } from "../core/basket-model.ts";
import { BasketService } from "../core/BasketService.ts";
import {
	activeLines,
	applyBasket,
	applyResponse,
	basketTotalDisplay,
	basketZoom,
	beginLineWrite,
	currentCheckoutContext,
	endLineWrite,
	isSelected,
	notifyBasketChanged,
	payBlocked,
	payTotalDisplay,
	persistZoom,
	requestCheckoutSubmit,
	restoreZoom,
} from "../core/basket-state.ts";
import { useCheckoutSeamPassive } from "../core/checkout-seam.ts";
import type { CheckoutView } from "../types/checkout-types.ts";

/**
 * BasketFooterRig — the middle-nav FOOTER band on EVERY `/basket` and `/checkout` route: **every
 * action, and nothing else**.
 *
 * Three rules from the region contract are load-bearing here, and each one is a bug this codebase has
 * already shipped once:
 *
 * 1. **The rig adapts by WIDTH, not by page identity.** `container-type: inline-size` on the root plus
 *    `@container` tiers in `basket-bands.css`; below the narrow tier every label collapses to its glyph,
 *    each keeping its `aria-label` and its portal `Tooltip` (§B.6).
 * 2. **The menu holds EVERY action at EVERY tier.** `/wallet` shipped a
 *    `nth-child(n + 3) { display: none }` mobile rule on four pages that had no menu, which silently
 *    deleted three money actions. Here the overflow menu is rendered at all widths and always lists the
 *    complete set, so collapsing a label can never remove a capability.
 * 3. **The band never contributes its own min-content width.** The frame's content column is a
 *    `minmax(0, 1fr)` track, and a single `nowrap` rig once raised the whole surface's floor to 739px
 *    and crushed the lane to 2px. `container-type: inline-size` supplies the containment that stops it.
 *
 * The rig owns the ACTIONS; the body owns the facts. Pay therefore dispatches
 * {@link requestCheckoutSubmit} rather than charging here — the checkout body holds the composition and
 * the blockers, and a footer that submitted its own idea of them would be a second answer to what is
 * being bought.
 */

// #region Props
/** Props for {@link BasketFooterRig}. */
export interface BasketFooterRigProps {
	/** Which of the two steps the URL addresses — decides the action SET, never the layout. */
	view: CheckoutView;
	/** The basket the actions target. */
	basketId: string | null;
	/** The acting owner scope, echoed into every link. */
	owner: string;
	/** The display currency, so a link keeps the reader's currency. */
	display: string;
	/** The server-computed total, already formatted — rendered verbatim, never recomposed. */
	totalDisplay: string | null;
	/** Whether anything currently blocks payment; the Pay control is refused while true. */
	blocked: boolean;
}

/** One action the rig offers, in both its label and its glyph-only presentation. */
interface RigAction {
	key: string;
	label: string;
	icon: IconName;
	/** A navigation action renders as an anchor; everything else is a button. */
	href?: string;
	primary?: boolean;
	danger?: boolean;
	disabled?: boolean;
	onSelect?: () => void;
}
// #endregion

export default function BasketFooterRig(props: BasketFooterRigProps): JSX.Element {
	const menuOpen = useSignal(false);
	const busy = useSignal(false);

	useCheckoutSeamPassive({
		basketId: props.basketId,
		owner: props.owner,
		display: props.display,
	});

	useEffect(() => {
		restoreZoom();
	}, []);

	/**
	 * Apply a patch to every currently-selected line.
	 *
	 * There is no bulk endpoint, so this is N sequential writes — each answering with the whole basket,
	 * which is why they cannot be parallelised without the last response winning arbitrarily. **Flagged**
	 * for the live path: `finance.basket_items` wants a single multi-row mutation.
	 */
	const forSelected = async (
		run: (lineId: string) => Promise<boolean>,
	) => {
		const targets = activeLines.value.filter(isSelected).map((line) => line.id);
		if (targets.length === 0) return;
		busy.value = true;
		for (const id of targets) {
			beginLineWrite(id);
			await run(id);
			endLineWrite(id);
		}
		busy.value = false;
		notifyBasketChanged();
	};

	const setSelection = async (selected: boolean) => {
		const targets = activeLines.value.map((line) => line.id);
		busy.value = true;
		const ctx = currentCheckoutContext();
		for (const id of targets) {
			beginLineWrite(id, selected);
			const res = await BasketService.updateItem(
				{ basketItemId: id, isSelectedForCheckout: selected },
				ctx,
			);
			applyResponse(res, applyBasket);
			endLineWrite(id);
		}
		busy.value = false;
		notifyBasketChanged();
	};

	const saveSelected = () =>
		forSelected(async (id) => {
			const res = await BasketService.moveItem(
				{ basketItemId: id, toBasketId: props.basketId, savedForLater: true },
				currentCheckoutContext(),
			);
			return applyResponse(res, applyBasket);
		});

	const removeSelected = () =>
		forSelected(async (id) => {
			const res = await BasketService.removeItem(
				{ basketItemId: id },
				currentCheckoutContext(),
			);
			return applyResponse(res, applyBasket);
		});

	const selectedCount = activeLines.value.filter(isSelected).length;
	const hasLines = activeLines.value.length > 0;

	/*
	 * The LIVE total, falling back to the SSR prop only until the first client read lands.
	 *
	 * `props.totalDisplay` is a snapshot of the first byte, and this control PRINTS AN AMOUNT: the
	 * moment a line is deselected or a promo lands, the server's figure moves and the prop does not.
	 * A control that names a figure must name the current one.
	 */
	const total = (props.view === "checkout" ? payTotalDisplay.value : basketTotalDisplay.value) ??
		props.totalDisplay;

	const actions: RigAction[] = props.view === "basket"
		? [
			{
				key: "checkout",
				label: total ? `Checkout · ${total}` : "Checkout",
				icon: "wallet",
				href: checkoutHref(props.basketId, props.owner),
				primary: true,
				disabled: selectedCount === 0,
			},
			{
				key: "select_all",
				label: selectedCount === activeLines.value.length && hasLines
					? "Clear selection"
					: "Select all",
				icon: "check",
				disabled: !hasLines || busy.value,
				onSelect: () =>
					void setSelection(!(selectedCount === activeLines.value.length && hasLines)),
			},
			{
				key: "save_selected",
				label: "Save for later",
				icon: "bookmark",
				disabled: selectedCount === 0 || busy.value,
				onSelect: () => void saveSelected(),
			},
			{
				key: "remove_selected",
				label: "Remove",
				icon: "trash",
				danger: true,
				disabled: selectedCount === 0 || busy.value,
				onSelect: () => void removeSelected(),
			},
		]
		: [
			{
				key: "pay",
				// The amount is the SERVER's string, rendered verbatim. The rig never composes a figure.
				label: total ? `Pay ${total}` : "Pay",
				icon: "wallet",
				primary: true,
				/*
				 * `props.blocked` is the server's first-byte answer; `payBlocked` is the live one, folding
				 * in the session's current blockers, the body's client-owned gates and an in-flight charge.
				 * Before hydration the second is inert and the first governs — after it, the control and
				 * the reason printed in the body describe the same moment.
				 */
				disabled: props.blocked || payBlocked.value,
				onSelect: requestCheckoutSubmit,
			},
			{
				key: "back",
				label: "Back to basket",
				icon: "arrow-left",
				href: basketHref(props.basketId, props.owner),
			},
		];

	return (
		<div class="bsk-rig" data-view={props.view} data-busy={busy.value ? "true" : undefined}>
			<div class="bsk-rig__row">
				{props.view === "basket" && (
					<div class="bsk-rig__density">
						<ZoomSlider
							value={basketZoom}
							onValueChange={persistZoom}
							aria-label="Basket row density"
							formatValue={(v) => (v < 0.5 ? "List view" : "Card view")}
						/>
					</div>
				)}

				<div class="bsk-rig__actions">
					{actions.map((action) => <RigControl key={action.key} action={action} />)}

					{
						/*
					  The complete set, at EVERY tier. Never a spill-over of what did not fit: an action
					  that is present here and nowhere else is still reachable, and one that is present in
					  both is merely convenient.
					*/
					}
					<Popover
						open={menuOpen}
						placement="top-end"
						label="All basket actions"
						class="bsk-menu"
						trigger={(api) => (
							<button
								type="button"
								class="bsk-rig__more"
								aria-label="All actions"
								aria-haspopup="dialog"
								aria-expanded={api.expanded ? "true" : "false"}
								aria-controls={api.panelId}
								onClick={api.toggle}
								ref={api.ref as RefObject<HTMLButtonElement>}
							>
								<Icon name="kebab" />
							</button>
						)}
					>
						{actions.map((action) =>
							action.href
								? (
									<a key={action.key} class="bsk-menu__item" href={action.href}>
										<Icon name={action.icon} />
										<span>{action.label}</span>
									</a>
								)
								: (
									<button
										key={action.key}
										type="button"
										class="bsk-menu__item"
										data-danger={action.danger ? "true" : undefined}
										disabled={action.disabled}
										onClick={() => {
											menuOpen.value = false;
											action.onSelect?.();
										}}
									>
										<Icon name={action.icon} />
										<span>{action.label}</span>
									</button>
								)
						)}
					</Popover>
				</div>
			</div>
		</div>
	);
}

// #region Controls
/**
 * One rig control. The label is always in the accessible name, so the glyph-only tier still satisfies
 * "label in name" (WCAG 2.5.3), and the Tooltip carries the words a sighted reader loses.
 */
function RigControl({ action }: { action: RigAction }): VNode {
	const glyph = <Icon name={action.icon} />;
	const inner = action.href
		? (
			<a
				class="bsk-rig__btn"
				href={action.disabled ? undefined : action.href}
				aria-label={action.label}
				aria-disabled={action.disabled ? "true" : undefined}
				data-primary={action.primary ? "true" : undefined}
			>
				{glyph}
				<span class="bsk-rig__label">{action.label}</span>
			</a>
		)
		: (
			<Button
				severity={action.danger ? "danger" : "primary"}
				variant={action.primary ? "filled" : "text"}
				size="sm"
				icon={glyph}
				disabled={action.disabled}
				aria-label={action.label}
				class="bsk-rig__btn"
				onClick={action.onSelect}
			>
				<span class="bsk-rig__label">{action.label}</span>
			</Button>
		);

	return <Tooltip content={action.label} placement="top">{inner}</Tooltip>;
}
// #endregion
