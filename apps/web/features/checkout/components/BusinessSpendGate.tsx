import type { JSX, Ref } from "preact";
import { InlineNotice } from "@projective/ui/feedback";
import { Button } from "@projective/ui/fields";
import { MetaLine } from "@projective/ui/display";
import { Icon } from "@projective/ui/icons";
import type { BusinessGateView } from "../core/business-gate.ts";

/**
 * BusinessSpendGate — a business checkout's refusal and its one way forward (BP2, Decision #243):
 * the refusal map's sentence as an InlineNotice, its facts as a MetaLine, then ONE control.
 *
 *  - **Request approval** — tier 3 (`severity="primary"`): it files a workflow request and moves no
 *    money, like an approver's Approve (#225 (A)). It opens the reason dialog; it is never a link to
 *    `/spend`, where nothing could redeem the approval for this basket.
 *  - **Add money** — tier 1 (the amber pill): it starts a payment, the business wallet's top-up, and
 *    returns to this checkout (#230 (c) [1]). An anchor, because it navigates.
 *  - **See verification / Verify …** — tier 4, a link to the business's Verification module.
 *  - **Check again** — the notice's own text action, re-reading a pending request.
 *
 * A member who holds none of these reads who to ask instead. The row is never boxed: spacing is the
 * only separation. Request approval and Add money are fills, so while either renders the rail's Buy
 * Now is not rendered at all (`gateTakesCommit`, DESIGN_SYSTEM §B.8.2 — one fill per region, the
 * card-step precedent); with a pending or approved request, Buy Now is the region's commit again.
 */

// #region Props
/** Props for {@link BusinessSpendGate}. */
export interface BusinessSpendGateProps {
	view: BusinessGateView;
	/** Open the request dialog. */
	onRequest: () => void;
	/** Re-read the session (a pending request may have been decided). */
	onCheckAgain: () => void;
	/** Whether that re-read is in flight. */
	reading: boolean;
	/**
	 * The gate's region, focusable by script only: a filing removes the control that opened the
	 * request dialog, and focus is handed here instead of falling to `<body>`.
	 */
	regionRef?: Ref<HTMLElement>;
}
// #endregion

/** The gate's one control, or `null`. */
function Control(props: BusinessSpendGateProps): JSX.Element | null {
	const action = props.view.action;
	switch (action?.type) {
		case "request":
			return (
				<Button
					class="cko-gate__request"
					severity="primary"
					variant="filled"
					icon={<Icon name="send" />}
					label={action.label}
					onClick={props.onRequest}
				/>
			);
		case "add_money":
			return (
				<a
					class="ui-button ui-button--accent ui-button--filled ui-button--size-md ui-button--rounded cko-gate__add"
					href={action.href}
				>
					<span class="ui-button__icon">
						<Icon name="plus" />
					</span>
					<span class="ui-button__label">{action.label}</span>
				</a>
			);
		case "verify":
			return (
				<a
					class="ui-button ui-button--neutral ui-button--outlined ui-button--size-md cko-gate__verify"
					href={action.href}
				>
					<span class="ui-button__icon">
						<Icon name="shield" />
					</span>
					<span class="ui-button__label">{action.label}</span>
				</a>
			);
		default:
			return null;
	}
}

/** Render a business checkout's gate. */
export function BusinessSpendGate(props: BusinessSpendGateProps): JSX.Element {
	const { view } = props;
	const checkAgain = view.action?.type === "check_again" ? view.action : null;
	const control = <Control {...props} />;
	const hasControl = view.action !== null && view.action.type !== "check_again";

	return (
		<section
			ref={props.regionRef}
			class="cko-gate"
			data-gate={view.kind}
			aria-label="Paying as a business"
			tabIndex={-1}
		>
			<InlineNotice
				class="cko-gate__notice"
				align="start"
				icon={<Icon name={view.icon} />}
				text={view.sentence}
				actionLabel={checkAgain?.label}
				onAction={checkAgain ? props.onCheckAgain : undefined}
				busy={props.reading}
			/>
			<MetaLine class="cko-gate__meta" items={view.meta} />
			{(hasControl || view.ask) && (
				<div class="cko-gate__row">
					{hasControl && control}
					{view.ask && <p class="cko-gate__ask">{view.ask}</p>}
				</div>
			)}
		</section>
	);
}
