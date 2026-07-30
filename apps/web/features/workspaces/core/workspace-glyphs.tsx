import { cloneElement, type JSX, type VNode } from "preact";

/**
 * workspace-glyphs — the icon register for the multi-member entity console (`/teams`, `/businesses`).
 *
 * Exported as **VNode constants, not components** — the repo convention shared with
 * `projects/components/glyphs.tsx` and `wallet/core/glyphs.tsx` — so consumers write `{MembersGlyph}`
 * and never `<MembersGlyph />`.
 *
 * **The reuse hazard, and the one thing you must remember:** a single VNode object may not be mounted
 * in two places in the same tree at once. This surface renders the SAME module glyph in up to three
 * places simultaneously (the expanded lane nav, the collapsed 48px rail, and the header tab strip), so
 * pass every reused glyph through {@link cloneGlyph} at the point of use. That is cheap, explicit, and
 * keeps the registry able to carry a glyph as data rather than as a factory.
 *
 * Every glyph is a `0 0 24 24` box drawn at **`1em`** in `currentColor` with `stroke-width: 1.8`,
 * byte-consistent with the projects / messaging / wallet sets so a workspace lane reads as one icon
 * system with the global sidebar (§B.6). Sizing therefore follows the surrounding type ramp — a caller
 * scales a glyph with `font-size`, never a width attribute. All are `aria-hidden`: the control's label
 * or its portal `Tooltip` carries the accessible name (§B.6 — never a native `title`).
 */

// #region Base
function Svg(props: JSX.SVGAttributes<SVGSVGElement>): VNode {
	return (
		<svg
			viewBox="0 0 24 24"
			width="1em"
			height="1em"
			fill="none"
			stroke="currentColor"
			stroke-width="1.8"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
			focusable="false"
			{...props}
		/>
	);
}

/**
 * Return a fresh copy of a glyph so the same constant can be mounted twice concurrently (the lane and
 * the rail, or a tab strip and its overflow menu). Preact reuses VNode objects by identity, so mounting
 * one in two positions drops it from the second — cloning is the sanctioned escape.
 */
export function cloneGlyph(glyph: VNode): VNode {
	return cloneElement(glyph, {});
}
// #endregion

// #region Module glyphs
/** Overview — the console hub: one hero panel over supporting bands. */
export const OverviewGlyph: VNode = (
	<Svg>
		<rect x="3.5" y="4" width="17" height="6.5" rx="1.6" />
		<rect x="3.5" y="13.5" width="7.5" height="6.5" rx="1.6" />
		<rect x="13" y="13.5" width="7.5" height="6.5" rx="1.6" />
	</Svg>
);

/** Projects — the briefcase, matching the global sidebar's Projects rail item. */
export const ProjectsGlyph: VNode = (
	<Svg>
		<rect x="3" y="7.5" width="18" height="12" rx="2.2" />
		<path d="M9 7.5V6a1.8 1.8 0 0 1 1.8-1.8h2.4A1.8 1.8 0 0 1 15 6v1.5" />
		<path d="M3 12.5h18" />
	</Svg>
);

/** Catalogue — the listing grid (team only), matching `/catalogue`'s own mark. */
export const CatalogueGlyph: VNode = (
	<Svg>
		<rect x="3.5" y="4" width="7" height="7" rx="1.4" />
		<rect x="13.5" y="4" width="7" height="7" rx="1.4" />
		<rect x="3.5" y="14" width="7" height="6" rx="1.4" />
		<path d="M14 16.5h6M14 19h4" />
	</Svg>
);

/** Calendar — the shared schedule. */
export const CalendarGlyph: VNode = (
	<Svg>
		<rect x="4" y="5" width="16" height="15" rx="2" />
		<path d="M4 9.5h16M8.5 3v4M15.5 3v4" />
	</Svg>
);

/** Messages — the entity's inbox. */
export const MessagesGlyph: VNode = (
	<Svg>
		<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4A1.5 1.5 0 0 1 4 14.5z" />
	</Svg>
);

/** Members — two people, the roster. */
export const MembersGlyph: VNode = (
	<Svg>
		<circle cx="9" cy="8.5" r="3.2" />
		<path d="M3.5 20a5.5 5.5 0 0 1 11 0" />
		<path d="M16 5.6a3.2 3.2 0 0 1 0 6.3M17.5 14.4a5.5 5.5 0 0 1 3 4.9" />
	</Svg>
);

/** Roles — an authority badge on a lanyard, the matrix's subject. */
export const RoleGlyph: VNode = (
	<Svg>
		<path d="M9.5 3h5l-1 3.5h-3z" />
		<rect x="4.5" y="6.5" width="15" height="13.5" rx="2.2" />
		<path d="M9 11h6M9 15h4" />
	</Svg>
);

/** Invitations — a sealed envelope: something addressed, awaiting an answer. */
export const InvitationsGlyph: VNode = (
	<Svg>
		<rect x="3.5" y="5.5" width="17" height="13" rx="2.2" />
		<path d="M4 7.5l8 5.5 8-5.5" />
	</Svg>
);

/** Invite — a person plus, the action rather than the queue. */
export const InviteGlyph: VNode = (
	<Svg>
		<circle cx="10" cy="8.5" r="3.4" />
		<path d="M4 20a6 6 0 0 1 12 0" />
		<path d="M18.5 8v6M15.5 11h6" />
	</Svg>
);

/** Finance — banknotes: the entity's money, whichever direction it flows. */
export const FinanceGlyph: VNode = (
	<Svg>
		<rect x="2.5" y="6" width="19" height="12" rx="2.2" />
		<circle cx="12" cy="12" r="2.8" />
		<path d="M6 10v4M18 10v4" />
	</Svg>
);

/** Payouts — value leaving the vault and splitting to the people who earned it (team only). */
export const PayoutsGlyph: VNode = (
	<Svg>
		<path d="M4 4v16" />
		<path d="M4 8h9a3 3 0 0 1 3 3v0" />
		<path d="M4 16h9a3 3 0 0 0 3-3v0" />
		<path d="M17 11l3 2-3 2" />
	</Svg>
);

/** Spend — a payment card drawn against the pool (business only). */
export const SpendGlyph: VNode = (
	<Svg>
		<rect x="2.5" y="5.5" width="19" height="13" rx="2.4" />
		<path d="M2.5 10h19M6 14.5h4" />
	</Svg>
);

/** Billing — a receipt: what the platform charged, itemised (business only). */
export const BillingGlyph: VNode = (
	<Svg>
		<path d="M6 3h12v18l-3-1.8-3 1.8-3-1.8L6 21z" />
		<path d="M9 8h6M9 12h6M9 16h3" />
	</Svg>
);

/** Talent — a person marked out: the bench a business hires from (business only). */
export const TalentGlyph: VNode = (
	<Svg>
		<circle cx="10.5" cy="8" r="3.4" />
		<path d="M4 20a6.5 6.5 0 0 1 13 0" />
		<path d="M18.5 3.5l1.1 2.2 2.4.4-1.7 1.7.4 2.4-2.2-1.2-2.2 1.2.4-2.4L15 6.1l2.4-.4z" />
	</Svg>
);

/** Analytics — axes with bars: measurement, not a trend claim. */
export const AnalyticsGlyph: VNode = (
	<Svg>
		<path d="M4 4v16h16" />
		<path d="M8 17v-4M12 17V8M16 17v-6" />
	</Svg>
);

/** Standing — rungs climbed: the earned ladder, drawn as progression rather than a prize. */
export const StandingGlyph: VNode = (
	<Svg>
		<path d="M4 20h4V13H4zM10 20h4V8h-4zM16 20h4V4h-4z" />
	</Svg>
);

/** Profile — the public identity card the console never forks, only edits. */
export const ProfileGlyph: VNode = (
	<Svg>
		<rect x="3" y="5" width="18" height="14" rx="2.4" />
		<circle cx="9" cy="11" r="2.4" />
		<path d="M5.5 16.5a4 4 0 0 1 7 0M15 10h3.5M15 13.5h2.5" />
	</Svg>
);

/** Verification — a shield with a tick: identity confirmed, not access confiscated. */
export const VerificationGlyph: VNode = (
	<Svg>
		<path d="M12 3l7.5 3v5.5c0 4.4-3 8-7.5 9.5-4.5-1.5-7.5-5.1-7.5-9.5V6z" />
		<path d="M8.8 12l2.4 2.4 4-4.4" />
	</Svg>
);

/** Settings — the cog. */
export const SettingsGlyph: VNode = (
	<Svg>
		<circle cx="12" cy="12" r="3.1" />
		<path d="M12 3v2.4M12 18.6V21M4.2 7.5l2 1.2M17.8 14.3l2 1.2M4.2 16.5l2-1.2M17.8 9.7l2-1.2" />
	</Svg>
);
// #endregion

// #region Supporting glyphs
/** A shield — governance and guardrails generally, distinct from a completed verification. */
export const ShieldGlyph: VNode = (
	<Svg>
		<path d="M12 3l7.5 3v5.5c0 4.4-3 8-7.5 9.5-4.5-1.5-7.5-5.1-7.5-9.5V6z" />
	</Svg>
);

/** A split — one flow branching into several shares. The payout editor's own mark. */
export const SplitGlyph: VNode = (
	<Svg>
		<path d="M4 12h5" />
		<path d="M9 12l4-5h7M9 12l4 5h7" />
		<circle cx="4" cy="12" r="1.6" />
	</Svg>
);

/** A wallet — the deep link out to `/wallet`, never a second finance UI. */
export const WalletGlyph: VNode = (
	<Svg>
		<rect x="3" y="6" width="18" height="12.5" rx="2.4" />
		<path d="M3 10h13a2 2 0 0 1 0 4.5H3" />
		<circle cx="16.5" cy="12.2" r="1" fill="currentColor" stroke="none" />
	</Svg>
);

/** Approve — a tick inside a ring: a decision granted, sized for a request row. */
export const ApproveGlyph: VNode = (
	<Svg>
		<circle cx="12" cy="12" r="8.4" />
		<path d="M8.4 12.3l2.6 2.6 4.6-5.2" />
	</Svg>
);

/** Archive — the terminal, reversible state. Nothing is ever hard-deleted. */
export const ArchiveGlyph: VNode = (
	<Svg>
		<path d="M4 7.5h16V19a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19z" />
		<path d="M3 4h18v3.5H3zM10 11.5h4" />
	</Svg>
);

/** A trend line — a change over time, as opposed to {@link AnalyticsGlyph}'s measurement. */
export const ChartGlyph: VNode = (
	<Svg>
		<path d="M4 15.5l4.5-4.5 3 3 5.5-6.5" />
		<path d="M13.5 7.5H18v4.5" />
	</Svg>
);

/** A chevron — disclosure. Rotate it with a transform; never swap it for a second glyph. */
export const ChevronGlyph: VNode = (
	<Svg>
		<path d="M9 6l6 6-6 6" />
	</Svg>
);

/** A plus — create. */
export const PlusGlyph: VNode = (
	<Svg>
		<path d="M12 5v14M5 12h14" />
	</Svg>
);

/** Switch — two flows exchanging places: the acting-context switch. */
export const SwitchGlyph: VNode = (
	<Svg>
		<path d="M4 8.5h13l-3-3M20 15.5H7l3 3" />
	</Svg>
);

/** Exit — leaving the entity context and returning to personal. */
export const ExitGlyph: VNode = (
	<Svg>
		<path d="M14 4.5H6.5A1.5 1.5 0 0 0 5 6v12a1.5 1.5 0 0 0 1.5 1.5H14" />
		<path d="M11 12h9M17 8.5l3.5 3.5L17 15.5" />
	</Svg>
);

/** An org chart — the reporting tree the roster can be read as. */
export const OrgChartGlyph: VNode = (
	<Svg>
		<rect x="9" y="3.5" width="6" height="4.5" rx="1.2" />
		<rect x="3" y="16" width="5.5" height="4.5" rx="1.2" />
		<rect x="15.5" y="16" width="5.5" height="4.5" rx="1.2" />
		<path d="M12 8v4M5.75 16v-4h12.5v4" />
	</Svg>
);

/** A bare tick — a satisfied checklist step or a set matrix cell. */
export const CheckGlyph: VNode = (
	<Svg>
		<path d="M5 12.5l4.5 4.5L19 7" />
	</Svg>
);
// #endregion

// #region Chrome glyphs
/**
 * The marks the lane, the collapsed rail and the two shell bands need that no module owns: going
 * back, finding, opening a menu, and the four utilities a kebab offers.
 *
 * They live here rather than inside a band component for the same reason the module glyphs do — the
 * surface must read as ONE icon system with the global sidebar (§B.6), and three chrome files each
 * drawing their own magnifier is how a nav starts looking assembled rather than designed.
 */

/** Back — a leading arrow. Carries `.wsp-icon--dir` at the point of use so it mirrors under RtL. */
export const BackGlyph: VNode = (
	<Svg>
		<path d="M19 12H5M10.5 6.5L5 12l5.5 5.5" />
	</Svg>
);

/** Search — the magnifier the lane's `LaneSearch` and the header band's find control share. */
export const SearchGlyph: VNode = (
	<Svg>
		<circle cx="10.8" cy="10.8" r="6.3" />
		<path d="M15.4 15.4L20 20" />
	</Svg>
);

/** A kebab — three dots stacked, for a menu opened from a row or a band. */
export const KebabGlyph: VNode = (
	<Svg>
		<circle cx="12" cy="5.5" r="1.4" fill="currentColor" stroke="none" />
		<circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
		<circle cx="12" cy="18.5" r="1.4" fill="currentColor" stroke="none" />
	</Svg>
);

/** Overflow — three dots in a row, for the footer band's collapsed action cluster. */
export const MoreGlyph: VNode = (
	<Svg>
		<circle cx="5.5" cy="12" r="1.4" fill="currentColor" stroke="none" />
		<circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
		<circle cx="18.5" cy="12" r="1.4" fill="currentColor" stroke="none" />
	</Svg>
);

/** Share — a node passing outward to two others. */
export const ShareGlyph: VNode = (
	<Svg>
		<circle cx="6" cy="12" r="2.4" />
		<circle cx="17.5" cy="6.5" r="2.4" />
		<circle cx="17.5" cy="17.5" r="2.4" />
		<path d="M8.2 10.9l7.1-3.3M8.2 13.1l7.1 3.3" />
	</Svg>
);

/** A link — two joined segments, for copying an address. */
export const LinkGlyph: VNode = (
	<Svg>
		<path d="M10.5 13.5a3.4 3.4 0 0 1 0-4.8l2.6-2.6a3.4 3.4 0 0 1 4.8 4.8l-1.3 1.3" />
		<path d="M13.5 10.5a3.4 3.4 0 0 1 0 4.8l-2.6 2.6a3.4 3.4 0 0 1-4.8-4.8l1.3-1.3" />
	</Svg>
);

/** A bell — notification preferences, never an alarm state. */
export const BellGlyph: VNode = (
	<Svg>
		<path d="M6.5 10.5a5.5 5.5 0 0 1 11 0v3.2l1.5 2.8H5l1.5-2.8z" />
		<path d="M10 19.5a2.2 2.2 0 0 0 4 0" />
	</Svg>
);
// #endregion

// #region Control glyphs
/** A cross — dismiss. Distinct from {@link DeclineGlyph}, which answers a question rather than hiding it. */
export const CloseGlyph: VNode = (
	<Svg>
		<path d="M6 6l12 12M18 6L6 18" />
	</Svg>
);

/** Decline — a cross inside a ring, sized to sit beside {@link ApproveGlyph} in a decision pair. */
export const DeclineGlyph: VNode = (
	<Svg>
		<circle cx="12" cy="12" r="8.4" />
		<path d="M9.2 9.2l5.6 5.6M14.8 9.2l-5.6 5.6" />
	</Svg>
);

// #endregion
