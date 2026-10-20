import type { JSX } from "preact";
import { MoneyView } from "@projective/ui/display/money";
import { DEMO_TABS } from "@features/landing/core/demo-stage.ts";
import {
	approvedStageLine,
	evenSplitOf,
	feeLabel,
	TEAM_PAY_COPY,
	type TeamPayPhase,
	type TeamPayRow,
	type TeamPayView,
	teamPayView,
} from "@features/landing/core/demos/split-model.ts";

/**
 * TeamPayPicture — the Team pay tab's drawn parts (`flows/LANDING.md` §4.4 "Team pay", §6 V5): the
 * stage's release and its fee, and the ledger rows, each member's share then the vault's. Hook-free
 * and fixture-pure, so the live demo, its frames and the stage's server-rendered poster
 * ({@link TeamPayPoster}) draw the same rows. Its stylesheet (`styles/demos/splits.css`) arrives
 * with the DemoHost island and with the demo's own chunk.
 */

// #region Constants
/** The money figures' fixed pins (§4: GBP, en-GB, no conversion table). */
export const MONEY = {
	currency: "GBP",
	displayCurrency: "GBP",
	locale: "en-GB",
	table: null,
} as const;

/** The phases from which each part of the picture shows, in frame order (§4.4 frames 1–6). */
const PHASES: readonly TeamPayPhase[] = ["approved", "vault", "shares", "dust", "custom", "clears"];

/** Whether `phase` has reached `from` (a live picture, `null`, shows everything). */
export function reached(phase: TeamPayPhase | null, from: TeamPayPhase): boolean {
	return phase === null || PHASES.indexOf(phase) >= PHASES.indexOf(from);
}
// #endregion

// #region Parts
/** Props for {@link Row}. */
export interface RowProps {
	row: TeamPayRow;
	/** The member's place in the bar, for its swatch; `null` for the vault. */
	tone: number | null;
	/** The amount to show instead of the row's own (the vault's cut, before the dust). */
	amountMinor?: number | null;
	/** The row a frame speaks about. */
	focus?: boolean;
}

/**
 * One ledger row, "{role} · {pct} · {amount} · clears in 7 days" (§4.4), on the product's ledger
 * recipe (`.wsp-ledger`: label · rate · figure on one shared track set, one hairline between rows).
 * The middots are the row's reading on a phone; from the ledger's width they give way to columns.
 */
export function Row({ row, tone, amountMinor, focus = false }: RowProps): JSX.Element {
	const amount = amountMinor === undefined ? row.amountMinor : amountMinor;
	return (
		<li
			class="lp-split__row"
			data-kind={tone === null ? "vault" : "member"}
			data-focus={focus ? "" : undefined}
		>
			<span class="lp-split__role">
				<span class="lp-split__swatch" data-tone={tone ?? undefined} aria-hidden="true" />
				{row.role}
			</span>
			<span class="lp-split__dot" aria-hidden="true">·</span>
			<span class="lp-split__pct">{row.pct}</span>
			{amount === null ? null : (
				<>
					<span class="lp-split__dot" aria-hidden="true">·</span>
					<span class="lp-split__amount" key={amount}>
						<MoneyView {...MONEY} minor={amount} size="body" />
					</span>
				</>
			)}
			<span class="lp-split__dot" aria-hidden="true">·</span>
			<span class="lp-split__clears">{TEAM_PAY_COPY.clears}</span>
		</li>
	);
}

/** Props for {@link Release}. */
export interface ReleaseProps {
	view: TeamPayView;
	feeBp: number | null;
}

/**
 * The stage's release, in the pricing calculator's labels (§4.9): the stage price, the fee that comes
 * out of the team's payment, and what the team receives. Without the fee only the price is known.
 */
export function Release({ view, feeBp }: ReleaseProps): JSX.Element {
	return (
		<dl class="lp-split__release">
			<div class="lp-split__fact">
				<dt class="lp-split__label">{TEAM_PAY_COPY.stagePrice}</dt>
				<dd class="lp-split__figure">
					<MoneyView {...MONEY} minor={view.stageMinor} size="body" />
				</dd>
			</div>
			{feeBp !== null && view.feeMinor !== null && view.payoutMinor !== null
				? (
					<>
						<div class="lp-split__fact">
							<dt class="lp-split__label">{feeLabel(feeBp)}</dt>
							<dd class="lp-split__figure">
								<MoneyView {...MONEY} minor={view.feeMinor} size="body" sign="−" />
							</dd>
						</div>
						<div class="lp-split__fact">
							<dt class="lp-split__label">{TEAM_PAY_COPY.teamReceives}</dt>
							<dd class="lp-split__figure">
								<MoneyView {...MONEY} minor={view.payoutMinor} size="body" />
							</dd>
						</div>
					</>
				)
				: null}
		</dl>
	);
}

/** Props for {@link Ledger}. */
export interface LedgerProps {
	view: TeamPayView;
	/** A frame's phase: which rows have arrived and which one it speaks about; `null` when live. */
	phase?: TeamPayPhase | null;
}

/**
 * The rows: each member, then the team vault (its cut and, once the dust has landed, the spare penny).
 * In frame mode the rows arrive as the frames tell them.
 */
export function Ledger({ view, phase = null }: LedgerProps): JSX.Element {
	/** Until frame 4 lands the spare penny, the vault shows its cut alone. */
	const vaultOnlyCut = phase === "vault" || phase === "shares";
	return (
		<ul class="lp-split__ledger">
			{reached(phase, "shares")
				? view.members.map((row, index) => (
					<Row
						key={row.key}
						row={row}
						tone={index + 1}
						focus={phase === "shares" || phase === "custom"}
					/>
				))
				: null}
			{reached(phase, "vault")
				? (
					<Row
						row={view.vault}
						tone={null}
						amountMinor={vaultOnlyCut ? view.vaultCutMinor : undefined}
						focus={phase === "vault" || phase === "dust"}
					/>
				)
				: null}
		</ul>
	);
}
// #endregion

// #region Poster
/** Props for {@link TeamPayPoster}. */
export interface TeamPayPosterProps {
	/** The platform fee in basis points from the server, or `null` (only the stage price shows). */
	feeBp: number | null;
}

/**
 * The tab's poster, rendered by the server (`flows/LANDING.md` §8: a real capture of the demo,
 * not a placeholder): the approved stage, its fee and what the team receives, the vault's fixed
 * line and the even split's rows to the penny — the live demo's opening picture without its bar,
 * which is a control (the product's `SplitBar`, an island) — held still and `inert` inside a
 * `role="img"` named for the tab.
 */
export function TeamPayPoster({ feeBp }: TeamPayPosterProps): JSX.Element {
	const view = teamPayView(evenSplitOf(), feeBp);
	return (
		<div class="lp-demo-poster" role="img" aria-label={DEMO_TABS.splits.posterLabel}>
			<div class="lp-demo-poster__still lp-split" data-mode="live" inert>
				<div class="lp-split__top">
					<p class="lp-split__lead">{approvedStageLine(feeBp)}</p>
					<Release view={view} feeBp={feeBp} />
				</div>
				<p class="lp-split__fixed">{TEAM_PAY_COPY.vaultLine}</p>
				<Ledger view={view} />
			</div>
		</div>
	);
}
// #endregion
