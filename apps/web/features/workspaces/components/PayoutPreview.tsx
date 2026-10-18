import type { JSX } from "preact";
import type { Signal } from "@preact/signals";
import { cx } from "@ui/core/cx.ts";
import { displayLocale, formatMoney, MoneyView } from "@projective/ui/display";
import { InlineNotice } from "@projective/ui/feedback";
import { FormControl, MoneyInput } from "@projective/ui/fields";
import type { TeamSplitPreview } from "@projective/types/workspace";
import { ledgerRows, PREVIEW_MAX_MINOR } from "../core/payout-model.ts";

/**
 * PayoutPreview — the Payouts module's "Preview": type an amount, read what a stage release of that
 * size pays, cut by cut (Teams work order C4).
 *
 * Every figure is the server's — `finance.preview_team_split(team, gross)` runs the plan the release
 * itself runs, on the team's SAVED rule and stakes at the standard platform fee — and the rows follow
 * the plan's order: Platform fee · Finder · Vault cut · each member (in the stakes' order, as the bar
 * above reads them) · Vault dust, then the total, the server's sum, which equals the amount typed. Rows
 * are separated by one hairline each, figures are tabular `MoneyView`s pinned to the team's currency (a
 * ledger whose rows were each converted could no longer add up), and nothing is boxed.
 *
 * The amount box, the rates and the figures are written in ONE number format, the viewer's locale: the
 * input reads and prints what is typed in it, so each figure is the server's integer minor units
 * formatted in that same locale rather than the server's fixed-locale display string (which would set a
 * total of "US$1,000.00" under a box reading "1000,00 $"), and each rate is that locale's percentage.
 * Only the formatting is local; no amount is computed here.
 *
 * While the editor holds unsaved changes the ledger still prices the saved split, and says so.
 */

// #region Props
export interface PayoutPreviewProps {
	/** The vault's currency — the amount's and every figure's. */
	currency: string;
	/** The amount to price, in minor units (the MoneyInput's bound value). */
	amount: Signal<number | null>;
	/** The latest answer, or `null` before the first one. */
	preview: TeamSplitPreview | null;
	/** A request is in flight. */
	pricing: boolean;
	/** Why the latest request failed, or `null`. */
	error: string | null;
	/** The editor holds unsaved changes, which this ledger does not price. */
	stale: boolean;
	/** The members' user ids in the stakes' order — the order the member rows take. */
	memberOrder: readonly string[];
	/** Ask again after a failure. */
	onRetry: () => void;
}
// #endregion

// #region Component
export function PayoutPreview(props: PayoutPreviewProps): JSX.Element {
	const { preview } = props;
	/** The viewer's locale — the amount box's and every figure's, so the two read as one format. */
	const locale = displayLocale.value;
	return (
		<section class="wsp-payout__section" aria-labelledby="wsp-payout-preview">
			<div class="wsp-payout__head">
				<h2 class="wsp-band__title" id="wsp-payout-preview">Preview</h2>
				<p class="wsp-payout__meta">
					What a release of this size pays under the saved split, at the standard platform fee.
				</p>
			</div>

			<div class="wsp-payout__fields">
				<FormControl label="Release amount" collapseHint>
					{({ id, describedBy }) => (
						<MoneyInput
							id={id}
							aria-describedby={describedBy}
							currency={props.currency}
							locale={locale}
							value={props.amount}
							min={1}
							max={PREVIEW_MAX_MINOR}
							fluid
						/>
					)}
				</FormControl>
			</div>

			{props.stale && (
				<p class="wsp-payout__meta">
					These figures price the saved split. Save to see your changes here.
				</p>
			)}

			{props.error
				? (
					<InlineNotice
						align="start"
						class="wsp-payout__notice"
						actionLabel="Try again"
						onAction={props.onRetry}
						busy={props.pricing}
					>
						{props.error}
					</InlineNotice>
				)
				: preview
				? (
					<ul
						class="wsp-ledger"
						aria-label={`How ${
							formatMoney(preview.gross.minor, preview.gross.currency, locale)
						} splits`}
						aria-busy={props.pricing ? "true" : undefined}
					>
						{ledgerRows(preview, props.memberOrder, locale).map((row) => (
							<li
								key={row.key}
								class={cx("wsp-ledger__row", row.kind === "total" && "wsp-ledger__row--total")}
								data-kind={row.kind}
							>
								<span class="wsp-ledger__label">{row.label}</span>
								<span class="wsp-ledger__rate">{row.rate ?? ""}</span>
								<MoneyView
									class="wsp-ledger__amount"
									minor={row.amount.minor}
									currency={row.amount.currency}
									displayCurrency={preview.currency}
									locale={locale}
									size="body"
									hideOrigin
								/>
							</li>
						))}
					</ul>
				)
				: (
					<p class="wsp-payout__meta" role="status">
						{props.pricing ? "Pricing…" : "Enter an amount to see how it splits."}
					</p>
				)}
		</section>
	);
}
// #endregion
