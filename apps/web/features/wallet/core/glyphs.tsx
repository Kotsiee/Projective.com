import type { JSX, VNode } from "preact";

/**
 * glyphs — the Wallet surface's icon register.
 *
 * Exported as **VNode constants, not components** (the repo convention across
 * `projects/components/glyphs.tsx` and `catalogue/components/catalogue-glyphs.tsx`): consumers write
 * `{OverviewGlyph}`, never `<OverviewGlyph />`. A VNode may not be mounted twice at once — clone it
 * (`cloneElement`) if the same glyph must appear in two places in one tree.
 *
 * All strokes are `currentColor` at `1.8` on a `0 0 24 24` box, matching the shared glyph metrics so
 * the wallet's rail reads as one set with the global sidebar.
 *
 * **Two glyphs are deliberately absent from this file: a PADLOCK and a WARNING TRIANGLE.** Escrowed
 * capital is drawn as a strongbox (stored value) and contested capital as a pause (held, under
 * review) — because a lock says confiscation and a triangle says danger, and neither is true of money
 * the user still owns (BUILD CONTRACT §I.3 G1 / RULE C-1). The one permitted lock-shackle glyph is
 * {@link GateGlyph}, which marks a *verification process step*, never money.
 */

function svg(path: JSX.Element, size = 20): VNode {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width={1.8}
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
			focusable="false"
		>
			{path}
		</svg>
	);
}

// #region Fund-state marks (the four states, as static shape channels)
/** Available — a filled disc. Settled, whole, no texture: money that is simply here. */
export const AvailableMark: VNode = (
	<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
		<circle cx="6" cy="6" r="5" fill="currentColor" />
	</svg>
);

/** Available at zero — the same disc as an outline ring, so the shape channel survives (RULE H-4). */
export const AvailableMarkZero: VNode = (
	<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
		<circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" stroke-width="1.4" />
	</svg>
);

/** In escrow — a strongbox. Stored value with a handle, NOT a padlock. */
export const EscrowMark: VNode = (
	<svg
		width="13"
		height="13"
		viewBox="0 0 14 14"
		fill="none"
		stroke="currentColor"
		stroke-width="1.5"
		stroke-linejoin="round"
		aria-hidden="true"
		focusable="false"
	>
		<rect x="1.4" y="3.2" width="11.2" height="8.4" rx="1.4" />
		<path d="M1.4 6.2h11.2" />
		<path d="M5.6 9h2.8" stroke-linecap="round" />
	</svg>
);

/** On hold — two pause bars. Held, resumable, under review. NOT a warning triangle. */
export const HoldMark: VNode = (
	<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
		<rect x="2.4" y="1.6" width="2.6" height="8.8" rx="1.1" fill="currentColor" />
		<rect x="7" y="1.6" width="2.6" height="8.8" rx="1.1" fill="currentColor" />
	</svg>
);
// #endregion

// #region Ledger direction
/** A credit — money arriving. */
export const CreditGlyph: VNode = svg(
	<>
		<path d="M12 19V5" />
		<path d="m6 11 6-6 6 6" />
	</>,
	16,
);

/** A debit — money leaving. Neutral by design; a debit is a movement, not a failure. */
export const DebitGlyph: VNode = svg(
	<>
		<path d="M12 5v14" />
		<path d="m18 13-6 6-6-6" />
	</>,
	16,
);
// #endregion

// #region Lane / section navigation
/** Overview — the stacked bands of the surface itself. */
export const OverviewGlyph: VNode = svg(
	<>
		<rect x="3" y="4" width="18" height="5.5" rx="1.6" />
		<path d="M3 13.5h18M3 18h11" />
	</>,
);

/** Transactions — a ledger of ruled lines. */
export const TransactionsGlyph: VNode = svg(
	<>
		<path d="M4 6h16M4 12h16M4 18h10" />
		<circle cx="18.5" cy="18" r="1.6" />
	</>,
);

/** Activity — a movement trace. */
export const ActivityGlyph: VNode = svg(<path d="M3 15.5 8 9l4 4 3.5-5.5L21 13" />);

/** Payouts — money leaving to a destination. */
export const PayoutsGlyph: VNode = svg(
	<>
		<path d="M12 3v11" />
		<path d="m8 10 4 4 4-4" />
		<path d="M4 17.5v1.9A1.6 1.6 0 0 0 5.6 21h12.8a1.6 1.6 0 0 0 1.6-1.6v-1.9" />
	</>,
);

/** Funding — money arriving from a source. */
export const FundingGlyph: VNode = svg(
	<>
		<path d="M12 14V3" />
		<path d="m8 7 4-4 4 4" />
		<path d="M4 17.5v1.9A1.6 1.6 0 0 0 5.6 21h12.8a1.6 1.6 0 0 0 1.6-1.6v-1.9" />
	</>,
);

/** Methods — a tokenized instrument. */
export const MethodsGlyph: VNode = svg(
	<>
		<rect x="2.5" y="5" width="19" height="14" rx="2.4" />
		<path d="M2.5 10h19" />
		<path d="M6 15h3.5" />
	</>,
);

/** Invoices — a statement. */
export const InvoicesGlyph: VNode = svg(
	<>
		<path d="M6 3h9l4 4v14H6z" />
		<path d="M15 3v4h4" />
		<path d="M9.5 13h5M9.5 17h3" />
	</>,
);

/** Access — governance over a vault. */
export const AccessGlyph: VNode = svg(
	<>
		<path d="M12 3 4.5 6v5.6c0 4.3 3 8.2 7.5 9.4 4.5-1.2 7.5-5.1 7.5-9.4V6z" />
		<path d="m9.3 12 1.9 1.9 3.6-3.7" />
	</>,
);
// #endregion

// #region Money actions (footer rig)
export const TopUpGlyph: VNode = svg(
	<>
		<circle cx="12" cy="12" r="8.4" />
		<path d="M12 8.4v7.2M8.4 12h7.2" />
	</>,
	18,
);

export const WithdrawGlyph: VNode = svg(
	<>
		<circle cx="12" cy="12" r="8.4" />
		<path d="M8.4 12h7.2" />
	</>,
	18,
);

export const TransferGlyph: VNode = svg(
	<>
		<path d="M4 9h14l-3.4-3.4" />
		<path d="M20 15H6l3.4 3.4" />
	</>,
	18,
);

export const DistributeGlyph: VNode = svg(
	<>
		<circle cx="12" cy="5.2" r="2.4" />
		<circle cx="5.4" cy="18.4" r="2.4" />
		<circle cx="18.6" cy="18.4" r="2.4" />
		<path d="M10.6 7.4 6.7 16M13.4 7.4 17.3 16" />
	</>,
	18,
);

export const FundEscrowGlyph: VNode = svg(
	<>
		<rect x="3" y="7" width="18" height="13" rx="2.2" />
		<path d="M3 12h18" />
		<path d="M12 3v3" />
	</>,
	18,
);

export const RecurringGlyph: VNode = svg(
	<>
		<path d="M20 12a8 8 0 1 1-2.5-5.8" />
		<path d="M20 4v4h-4" />
	</>,
	18,
);

export const RequestSpendGlyph: VNode = svg(
	<>
		<circle cx="12" cy="12" r="8.4" />
		<path d="M12 8v4.4l2.8 1.7" />
	</>,
	18,
);

export const SmootherGlyph: VNode = svg(<path d="M3 15c3.5 0 3.5-6 7-6s3.5 6 7 6 4-2 4-2" />, 18);
// #endregion

// #region Utility
export const ExportGlyph: VNode = svg(
	<>
		<path d="M12 3v11" />
		<path d="m8 10.5 4 3.5 4-3.5" />
		<path d="M4 18v1.4A1.6 1.6 0 0 0 5.6 21h12.8a1.6 1.6 0 0 0 1.6-1.6V18" />
	</>,
	16,
);

export const ExpandGlyph: VNode = svg(
	<>
		<path d="M4 10V5.6A1.6 1.6 0 0 1 5.6 4H10" />
		<path d="M14 4h4.4A1.6 1.6 0 0 1 20 5.6V10" />
		<path d="M20 14v4.4a1.6 1.6 0 0 1-1.6 1.6H14" />
		<path d="M10 20H5.6A1.6 1.6 0 0 1 4 18.4V14" />
	</>,
	16,
);

export const SearchGlyph: VNode = svg(
	<>
		<circle cx="10.8" cy="10.8" r="6.4" />
		<path d="m15.6 15.6 4 4" />
	</>,
	16,
);

export const FilterGlyph: VNode = svg(
	<>
		<path d="M4 6h16" />
		<path d="M7 12h10" />
		<path d="M10 18h4" />
	</>,
	16,
);

export const MoreGlyph: VNode = svg(
	<>
		<circle cx="5.5" cy="12" r="1.4" fill="currentColor" stroke="none" />
		<circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
		<circle cx="18.5" cy="12" r="1.4" fill="currentColor" stroke="none" />
	</>,
	16,
);

export const InfoGlyph: VNode = svg(
	<>
		<circle cx="12" cy="12" r="8.4" />
		<path d="M12 11v5" />
		<circle cx="12" cy="7.9" r="0.9" fill="currentColor" stroke="none" />
	</>,
	15,
);

/**
 * The ONE permitted lock on this surface: a verification gate. It marks a *process step the viewer
 * can complete*, never money. It must never appear on a balance, a segment, or a card.
 */
export const GateGlyph: VNode = svg(
	<>
		<rect x="4.6" y="10.4" width="14.8" height="9.6" rx="2" />
		<path d="M8.4 10.4V7.6a3.6 3.6 0 0 1 7.2 0v2.8" />
	</>,
	16,
);

/** A stretched chevron for "see all" style links; mirrors under RtL via `.wlt-icon--dir`. */
export const ForwardGlyph: VNode = (
	<svg
		width="14"
		height="14"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width={1.8}
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
		focusable="false"
		class="wlt-icon--dir"
	>
		<path d="M5 12h13" />
		<path d="m13 6 6 6-6 6" />
	</svg>
);

/** The lane collapse/expand toggle, reusing the global rail's morphing-divider language. */
export const CollapseGlyph: VNode = (
	<svg
		width="20"
		height="20"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width={1.6}
		stroke-linecap="round"
		aria-hidden="true"
		focusable="false"
	>
		<rect x="3.2" y="4.2" width="17.6" height="15.6" rx="3" />
		<path d="M9.6 6.6v10.8" stroke-dasharray="2.2 2.4" />
	</svg>
);
// #endregion
