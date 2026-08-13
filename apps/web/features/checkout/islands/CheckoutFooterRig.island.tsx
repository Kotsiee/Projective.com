import type { JSX, VNode } from "preact";
import { useSignal } from "@preact/signals";
import "../styles/checkout.css";
import { Tooltip } from "@projective/ui/feedback";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import type { IconName } from "@projective/ui/icons";
import { Amount } from "../components/Amount.tsx";
import { type CheckoutStep, checkoutStepHref, itemKindLabel } from "../core/basket-model.ts";
import { BasketService } from "../core/BasketService.ts";
import {
	activeLines,
	applyBasket,
	applyResponse,
	basket,
	beginLineWrite,
	currentCheckoutContext,
	endLineWrite,
	isSelected,
	notifyBasketChanged,
	payBlocked,
	requestCheckoutSubmit,
	session,
} from "../core/basket-state.ts";
import { requestStepAdvance } from "../core/checkout-state.ts";
import { useCheckoutSeamPassive } from "../core/checkout-seam.ts";
import type { BasketItem, MoneyView } from "../types/checkout-types.ts";

/**
 * CheckoutFooterRig — the middle-nav FOOTER band on **all four** checkout steps: *every action, and
 * nothing else*.
 *
 * The action SET changes per step; the layout never does. On the **basket** step the design reads as
 * two facts at opposite ends of the band — the running **Total** at the inline start, the **Checkout**
 * pill at the inline end — with every selection operation held in the overflow menu behind them. On
 * the three later steps the band is the step's action set, right-aligned, unchanged.
 *
 * Four rules are load-bearing here, and each one is a defect this codebase has already shipped once:
 *
 * 1. **The rig adapts by WIDTH, not by page identity.** `container-type: inline-size` on the root plus
 *    `@container` tiers in `basket-bands.css`; below the narrow tier every label collapses to its
 *    glyph, each keeping its accessible name and its portal `Tooltip` (§B.6). The one exception is the
 *    step's commitment, whose words never collapse — a control that commits a buyer must keep saying
 *    what it commits them to.
 * 2. **Every action is drawn INLINE, at every width.** There is no overflow menu: the kebab and the
 *    density slider were removed on the owner's direction, so a control hidden by a tier would have no
 *    second home and would simply cease to exist — the exact `/wallet` defect
 *    (`nth-child(n + 3) { display: none }` on four pages that had no menu, silently deleting three
 *    money actions). The four selection operations that used to be menu-held are therefore ordinary
 *    rig controls now, and the tiers collapse a LABEL rather than a capability.
 * 3. **One filled commitment per decision region (§B.8.2).** The **amber** commitment on the basket
 *    step belongs to the body's summary card ("Proceed to Checkout"). The band's own Checkout is
 *    therefore the neutral `secondary` pill — a second route to the same step, not a second shout.
 *    On the three later steps the body carries no commitment, so the rig's CTA is the amber one.
 * 4. **The rig owns the ACTIONS; the body owns the facts.** Continue and Buy Now therefore *dispatch*
 *    rather than submitting here — the step's body holds the composition, the form state and the
 *    blockers, and a footer that assembled its own idea of them would be a second answer to what is
 *    being bought. The one fact the band does print, the basket Total, is the server's own
 *    `MoneyView`, rendered through {@link Amount}; nothing here sums, formats or converts.
 *
 * The later steps' CTAs are `severity="warning"` — the amber the build brief names, taken from the
 * token rather than from its hex (root CLAUDE.md §3 is absolute). This is a **flagged conflict**:
 * DESIGN_SYSTEM §A.1 assigns `--warning` to time-sensitive status, and in light mode the token
 * resolves to an ochre rather than the brief's amber. The owner's directive is explicit and repeated,
 * so it ships as written and is logged rather than silently converted to `--primary`.
 */

// #region Props
/** Props for {@link CheckoutFooterRig}. */
export interface CheckoutFooterRigProps {
	/** Which of the four steps the URL addresses — decides the action SET, never the layout. */
	step: CheckoutStep;
	/** The basket the actions target. */
	basketId: string | null;
	/** The acting owner scope, echoed into every link. */
	owner: string;
	/** The display currency, so a link keeps the reader's currency. */
	display: string;
	/**
	 * The step's headline figure, server-computed. Rendered through {@link Amount} so it re-projects
	 * with the currency selector in the band above rather than freezing at the first byte.
	 */
	total: MoneyView | null;
	/** Whether anything currently blocks payment; the commit control is refused while true. */
	blocked: boolean;
	/** The completed order, on the confirmation step. */
	orderId?: string | null;
	/**
	 * Where the confirmation step's invoice PDF is served from. **Absent means absent**: with no
	 * document to serve, the action is not rendered at all rather than rendered and refused — a
	 * download that answers 404 teaches a buyer their receipt was lost.
	 */
	invoiceHref?: string | null;
}

/**
 * The commitment's colour ramp.
 *
 * `warning` is the amber the flow commits in; `secondary` the neutral pill used where the amber
 * already belongs to another control in the same decision region (§B.8.2). Narrowed to the two the
 * rig actually offers rather than typed as the full `Severity` union, so a third can only be added
 * deliberately.
 */
type CtaSeverity = "warning" | "secondary";

/** One action the rig offers, in both its label and its glyph-only presentation. */
interface RigAction {
	key: string;
	label: string;
	icon: IconName;
	/** A navigation action renders as an anchor; everything else is a button. */
	href?: string;
	/** The step's single commitment: filled, rendered last, and never collapsed to a glyph. */
	cta?: boolean;
	/** The commitment's ramp; defaults to the amber `warning`. Ignored on a non-CTA action. */
	ctaSeverity?: CtaSeverity;
	/**
	 * Render the commitment as a label alone, with no leading glyph.
	 *
	 * A glyph earns its place beside a figure — it is what stops "£1,366.15" reading as a bare number.
	 * Beside a plain verb on a pill it is decoration, and the design draws the basket's Checkout as
	 * words.
	 */
	plain?: boolean;
	danger?: boolean;
	disabled?: boolean;
	/**
	 * A server-computed figure rendered inside the label. When present the control takes its accessible
	 * name from its own contents rather than an `aria-label`, so a currency switch moves the spoken
	 * amount as well as the printed one.
	 */
	amount?: MoneyView | null;
	onSelect?: () => void;
}
// #endregion

export default function CheckoutFooterRig(props: CheckoutFooterRigProps): JSX.Element {
	const busy = useSignal(false);

	useCheckoutSeamPassive({
		basketId: props.basketId,
		owner: props.owner,
		display: props.display,
	});

	// #region Write handlers
	/**
	 * Apply a patch to every currently-selected line.
	 *
	 * There is no bulk endpoint, so this is N sequential writes — each answering with the whole basket,
	 * which is why they cannot be parallelised without the last response winning arbitrarily. **Flagged**
	 * for the live path: `finance.basket_items` wants a single multi-row mutation.
	 */
	const forSelected = async (run: (lineId: string) => Promise<boolean>) => {
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
	// #endregion

	const selectedCount = activeLines.value.filter(isSelected).length;
	const hasLines = activeLines.value.length > 0;
	const allSelected = hasLines && selectedCount === activeLines.value.length;

	/*
	 * The LIVE figure, falling back to the SSR prop only until the first client read lands.
	 *
	 * `props.total` is a snapshot of the first byte, and this band PRINTS AN AMOUNT: the moment a line
	 * is deselected or a promo lands, the server's figure moves and the prop does not. A band that
	 * names a figure must name the current one.
	 */
	const live = props.step === "basket"
		? basket.value?.net ?? null
		: session.value?.totals.total ?? null;
	const total = live ?? props.total;

	const actions = actionsFor(props, {
		total,
		selectedCount,
		hasLines,
		allSelected,
		busy: busy.value,
		blocked: props.blocked || payBlocked.value,
		onSelectAll: () => void setSelection(!allSelected),
		onSaveSelected: () => void saveSelected(),
		onRemoveSelected: () => void removeSelected(),
		onExport: () => exportBasketCsv(activeLines.value, props.basketId),
	});

	/** Every non-committing action, drawn inline — there is no menu to hold anything back. */
	const inline = actions.filter((action) => !action.cta);
	/*
	 * The commitment renders LAST, so it is flush to the band's inline end on every step and in both
	 * writing directions — the one position a buyer never has to look for it in.
	 */
	const commitment = actions.find((action) => action.cta) ?? null;

	return (
		<div class="cko-rig" data-step={props.step} data-busy={busy.value ? "true" : undefined}>
			<div class="cko-rig__row">
				{
					/*
					 * The running total, at the inline start — the band's only FACT, and the reason the
					 * basket's Checkout pill carries no figure of its own. One figure, in one place, from
					 * one server projection.
					 */
				}
				{props.step === "basket" && total && (
					<div class="cko-rig__total">
						<span class="cko-rig__total-label">Total</span>
						<Amount value={total} size="hero" />
					</div>
				)}

				<div class="cko-rig__actions">
					{inline.map((action) => <RigControl key={action.key} action={action} />)}

					{commitment ? <RigCta action={commitment} /> : null}
				</div>
			</div>
		</div>
	);
}

// #region Action sets
/** The live state an action set is derived from, so {@link actionsFor} stays a pure function. */
interface RigContext {
	total: MoneyView | null;
	selectedCount: number;
	hasLines: boolean;
	allSelected: boolean;
	busy: boolean;
	blocked: boolean;
	onSelectAll: () => void;
	onSaveSelected: () => void;
	onRemoveSelected: () => void;
	onExport: () => void;
}

/**
 * The step's action set.
 *
 * Pure, and deliberately exhaustive over {@link CheckoutStep} rather than defaulted: a step added to
 * the flow without an action set should be a type error, not a footer that silently renders nothing.
 */
function actionsFor(props: CheckoutFooterRigProps, ctx: RigContext): RigAction[] {
	switch (props.step) {
		case "basket":
			return [
				/*
				 * TWO band-level operations, and deliberately only two.
				 *
				 * Save for later and Remove used to live here as bulk actions over the selection. They were
				 * removed because every line, every shelf card and every engagement now carries its own
				 * Remove and Save-for-later next to the thing it acts on — which is where a reader looks for
				 * them, and which says WHAT is being removed without them having to remember what is ticked.
				 * A band-level "Remove" over an invisible selection is the one control on this surface that
				 * could destroy something the reader was not looking at.
				 *
				 * What survives is what has no per-line equivalent: a selection toggle over the whole
				 * basket, and an export of it.
				 */
				{
					key: "select_all",
					label: ctx.allSelected ? "Clear selection" : "Select all",
					icon: "check",
					disabled: !ctx.hasLines || ctx.busy,
					onSelect: ctx.onSelectAll,
				},
				{
					key: "export",
					label: "Export",
					icon: "download",
					disabled: !ctx.hasLines,
					onSelect: ctx.onExport,
				},
				{
					/*
					 * The band's route forward, at every width.
					 *
					 * NEUTRAL rather than amber: the body's summary card already carries the step's filled
					 * amber commitment, and §B.8.2 caps one per decision region. It also carries no figure —
					 * the Total at the other end of the band is that figure, and printing it twice in one
					 * strip invites a reader to check whether the two agree.
					 *
					 * It points at Details, the flow's next step, not at Payment: the Details route decides
					 * for itself whether the buyer's saved record lets it be skipped, and a link that jumped
					 * the form would be a second, weaker copy of that decision.
					 */
					key: "checkout",
					label: "Checkout",
					icon: "wallet",
					href: checkoutStepHref("details", props.basketId, props.owner),
					cta: true,
					ctaSeverity: "secondary",
					plain: true,
					disabled: ctx.selectedCount === 0,
				},
			];
		case "details":
			return [
				{
					key: "save_details",
					label: "Save details",
					icon: "check",
					// Target = this step: save, and stay where you are.
					onSelect: () => requestStepAdvance("details"),
				},
				{
					key: "continue",
					label: "Continue",
					icon: "arrow-right",
					cta: true,
					// Target = the next step. The body validates and navigates; the rig only asks.
					onSelect: () => requestStepAdvance("payment"),
				},
			];
		case "payment":
			return [
				{
					key: "change_details",
					label: "Change details",
					icon: "edit",
					// `edit=1` is what makes the form reachable at all once a record is complete — every
					// other route into it redirects straight past.
					href: appendParam(
						checkoutStepHref("details", props.basketId, props.owner),
						"edit",
						"1",
					),
				},
				{
					key: "buy_now",
					label: "Buy Now",
					icon: "wallet",
					cta: true,
					amount: ctx.total,
					disabled: ctx.blocked,
					onSelect: requestCheckoutSubmit,
				},
			];
		case "confirmation":
			return [
				{
					key: "view_order",
					label: "View order",
					icon: "document",
					// The order's permalink. On a confirmation reached without `?order=` this pins the page
					// to this order, which is also the link a buyer can keep.
					href: checkoutStepHref(
						"confirmation",
						props.basketId,
						props.owner,
						undefined,
						props.orderId ?? null,
					),
				},
				...(props.invoiceHref
					? [{
						key: "download_invoice",
						label: "Download invoice",
						icon: "download" as IconName,
						href: props.invoiceHref,
					}]
					: []),
				{
					key: "continue_shopping",
					label: "Continue shopping",
					icon: "explore",
					href: "/explore",
				},
			];
	}
}

/** Append one query param to a path that may or may not already carry a query string. */
function appendParam(path: string, key: string, value: string): string {
	return `${path}${path.includes("?") ? "&" : "?"}${encodeURIComponent(key)}=${
		encodeURIComponent(value)
	}`;
}
// #endregion

// #region Controls
/**
 * One non-committing rig control.
 *
 * The label is always in the accessible name — either as an `aria-label` or, when the control carries
 * a live figure, as its own contents — so the glyph-only tier still satisfies "label in name"
 * (WCAG 2.5.3), and the Tooltip carries the words a sighted reader loses.
 */
function RigControl({ action }: { action: RigAction }): VNode {
	const glyph = <Icon name={action.icon} />;
	/*
	 * A control that prints an amount takes its name from its contents. An `aria-label` would freeze the
	 * spoken figure at the string the server sent, so a buyer using a screen reader would hear the old
	 * currency after switching — on the number they are about to pay.
	 */
	const named = action.amount ? undefined : action.label;
	const body = (
		<>
			<span class="cko-rig__label">{action.label}</span>
			{action.amount ? <Amount value={action.amount} size="body" hideOrigin /> : null}
		</>
	);

	const inner = action.href
		? (
			<a
				class="cko-rig__btn"
				href={action.disabled ? undefined : action.href}
				aria-label={named}
				aria-disabled={action.disabled ? "true" : undefined}
			>
				{glyph}
				{body}
			</a>
		)
		: (
			<Button
				severity={action.danger ? "danger" : "primary"}
				variant="text"
				size="sm"
				icon={glyph}
				disabled={action.disabled}
				aria-label={named}
				class="cko-rig__btn"
				onClick={action.onSelect}
			>
				{body}
			</Button>
		);

	return <Tooltip content={action.label} placement="top">{inner}</Tooltip>;
}

/**
 * The step's commitment: a filled pill, flush to the band's inline end, whose words never collapse.
 *
 * The anchor form wears `@projective/ui`'s own button classes by hand rather than forking a second
 * button family — the same move the body's summary CTA makes. It has to be an anchor: advancing the
 * flow is a navigation and must work with no JavaScript at all, and a `Button` with an `onClick`
 * router would take that away.
 */
function RigCta({ action }: { action: RigAction }): VNode {
	const severity: CtaSeverity = action.ctaSeverity ?? "warning";
	const glyph = action.plain ? null : <Icon name={action.icon} />;

	/*
	 * No `Tooltip` and no `aria-label` on this control, unlike the quiet actions above it.
	 *
	 * The commitment always renders its own words, and when it carries an amount that amount is part
	 * of its accessible name — so a currency switch moves the spoken figure with the visible one. A
	 * tooltip repeating a label the reader can already see is noise for a pointer user and a second
	 * announcement for a screen-reader one; §B.6 asks for one on icon-ONLY controls, which this is
	 * not.
	 */
	if (action.href) {
		return (
			<a
				class={`cko-rig__cta ui-button ui-button--${severity} ui-button--filled ui-button--size-sm ui-button--rounded`}
				href={action.disabled ? undefined : action.href}
				aria-disabled={action.disabled ? "true" : undefined}
			>
				{glyph ? <span class="ui-button__icon">{glyph}</span> : null}
				<span class="ui-button__label">{action.label}</span>
				{action.amount ? <Amount value={action.amount} size="body" hideOrigin /> : null}
			</a>
		);
	}

	return (
		<Button
			severity={severity}
			variant="filled"
			size="sm"
			rounded
			icon={glyph ?? undefined}
			disabled={action.disabled}
			class="cko-rig__cta"
			onClick={action.onSelect}
		>
			<span class="ui-button__label">{action.label}</span>
			{action.amount ? <Amount value={action.amount} size="body" hideOrigin /> : null}
		</Button>
	);
}
// #endregion

// #region Export
/**
 * Download the open basket as a CSV of what the SERVER already computed.
 *
 * Every money column is a server-formatted `display` string copied verbatim — there is no sum, no
 * conversion and no re-formatting here, because a spreadsheet that disagreed with the basket it was
 * exported from would be worse than no export at all.
 *
 * It runs entirely in the browser rather than through an endpoint: the rows are already in the client's
 * hands, so a round trip could only re-answer a question that has already been answered.
 */
function exportBasketCsv(lines: readonly BasketItem[], basketId: string | null): void {
	if (typeof document === "undefined" || lines.length === 0) return;

	const rows: string[][] = [
		["Item", "Type", "Seller", "Quantity", "Unit price", "Line total"],
		...lines.map((line) => [
			line.title,
			itemKindLabel(line),
			line.sellerName ?? "",
			String(line.quantity),
			line.unitPrice.display,
			line.lineTotal.display,
		]),
	];

	// A BOM, so a spreadsheet opens the currency symbols as UTF-8 rather than as mojibake.
	const csv = `﻿${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
	const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = `basket-${basketId ?? "default"}.csv`;
	document.body.appendChild(anchor);
	anchor.click();
	anchor.remove();
	URL.revokeObjectURL(url);
}

/**
 * Quote one CSV cell.
 *
 * The leading apostrophe on a cell that opens with a formula character is not decoration: a
 * spreadsheet treats `=`, `+`, `-` and `@` as the start of a formula, so an item title beginning with
 * one would be EXECUTED on open. A basket export is attacker-influenced text — the title came from a
 * seller's listing.
 */
function csvCell(value: string): string {
	const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
	return `"${safe.replaceAll('"', '""')}"`;
}
// #endregion
