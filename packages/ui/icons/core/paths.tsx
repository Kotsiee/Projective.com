import type { VNode } from "preact";

/**
 * The canonical glyph registry (DESIGN_SYSTEM.md §B.7.1).
 *
 * Every entry is drawn on the 24-unit grid with the artwork inset ~2 units per side, as pure
 * geometry — no `stroke-width`, no `fill`, no `stroke`, no cap/join. Those are the contract's job
 * ({@link Icon} + icon.css), which is precisely why a glyph added here cannot drift from the set.
 *
 * NAMES ARE THE POINT. The audit that produced this file found one identifier resolving to two
 * unrelated concepts (`PinIcon` was a map pin in auth and a push-pin in projects; `XIcon` was the X
 * brand mark in marketing and a close cross in auth) and one concept drawn eleven separate times
 * (`search`). A registry name is therefore specific enough that it cannot be reused for a second
 * meaning: `pin-location` and `pin-fixed` are different entries, and neither is called `pin`.
 *
 * Feature-local domain glyphs — file-kind marks, wallet fund states, session archetypes — stay in
 * their feature. They are not shared vocabulary and moving them here would make this file a dumping
 * ground. They still render through {@link Icon}, so they still obey the one contract.
 */

// #region Navigation & structure
const NAVIGATION = {
	/** Explore / discovery — a compass. */
	"explore": () => (
		<path d="M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM15 9l-1.8 4.2L9 15l1.8-4.2z" />
	),
	/**
	 * Projects — a briefcase. THE single Projects mark: the desktop rail and the mobile bottom nav
	 * were shipping two different glyphs (a briefcase and an architectural arch) for the same
	 * destination, so a user moving between form factors saw a different mark for the same place.
	 */
	"projects": () => (
		<>
			<rect x="3" y="7.5" width="18" height="12.5" rx="2.4" />
			<path d="M8.5 7.5V6a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v1.5M3 12.5h18" />
		</>
	),
	/** Dashboard — panelled tiles. */
	"dashboard": () => (
		<>
			<rect x="3.5" y="3.5" width="7" height="7" rx="1.6" />
			<rect x="13.5" y="3.5" width="7" height="7" rx="1.6" />
			<rect x="3.5" y="13.5" width="7" height="7" rx="1.6" />
			<rect x="13.5" y="13.5" width="7" height="7" rx="1.6" />
		</>
	),
	/** Analytics — a rising bar series. */
	"analytics": () => <path d="M4 20V13M9.5 20V8M15 20v-5M20.5 20V4" />,
	/** Wallet / finance. */
	"wallet": () => (
		<>
			<rect x="3.5" y="6" width="17" height="13" rx="2.5" />
			<path d="M3.5 10h17" />
			<circle cx="16.5" cy="14" r="1.1" fill="currentColor" stroke="none" />
		</>
	),
	/** Catalogue — stacked cards, the seller's listings. */
	"catalogue": () => (
		<>
			<rect x="3.5" y="7.5" width="17" height="12" rx="2.2" />
			<path d="M6.5 4.5h11M5 7.5V6" />
		</>
	),
	/** Messages / inbox — a tray. */
	"inbox": () => (
		<>
			<path d="M3.5 13h4l1.5 3h6l1.5-3h4" />
			<path d="M5.6 5.5h12.8l2.1 7.5v4.5a2 2 0 0 1-2 2H5.5a2 2 0 0 1-2-2V13z" />
		</>
	),
	/** A hash-marked channel. */
	"channel": () => <path d="M9 4L7 20M17 4l-2 16M4 9h16M3 15h16" />,
	/** Stages — stacked layers. */
	"stages": () => (
		<>
			<path d="M12 3l8 4.5-8 4.5-8-4.5z" />
			<path d="M4 12l8 4.5 8-4.5M4 16.5l8 4.5 8-4.5" />
		</>
	),
	/** A pipeline / Kanban board — columns. */
	"board": () => (
		<>
			<rect x="3" y="4" width="5" height="16" rx="1.2" />
			<rect x="10" y="4" width="5" height="11" rx="1.2" />
			<rect x="17" y="4" width="4" height="7" rx="1.2" />
		</>
	),
	/** A timeline — a track with milestone nodes. */
	"timeline": () => (
		<>
			<path d="M3 12h18" />
			<circle cx="7" cy="12" r="2" />
			<circle cx="13" cy="12" r="2" />
			<circle cx="19" cy="12" r="2" />
		</>
	),
	/** Settings — a gear. */
	"settings": () => (
		<>
			<circle cx="12" cy="12" r="3" />
			<path d="M12 3v2.5M12 18.5V21M4.2 7.5l2.2 1.3M17.6 15.2l2.2 1.3M4.2 16.5l2.2-1.3M17.6 8.8l2.2-1.3" />
		</>
	),
} as const;
// #endregion

// #region Direction — the family that replaced 85 Unicode characters
const DIRECTION = {
	"chevron-left": () => <path d="M15 6l-6 6 6 6" />,
	"chevron-right": () => <path d="M9 6l6 6-6 6" />,
	"chevron-up": () => <path d="M6 15l6-6 6 6" />,
	"chevron-down": () => <path d="M6 9l6 6 6-6" />,
	"arrow-left": () => <path d="M20 12H4M10 6l-6 6 6 6" />,
	"arrow-right": () => <path d="M4 12h16M14 6l6 6-6 6" />,
	"arrow-up": () => <path d="M12 20V4M6 10l6-6 6 6" />,
	"arrow-down": () => <path d="M12 4v16M6 14l6 6 6-6" />,
	/** A small solid disclosure marker — the tree/menu triangle, drawn rather than typed. */
	"caret-right": () => <path d="M10 6.5l5.5 5.5-5.5 5.5z" fill="currentColor" stroke="none" />,
	/** The open state of {@link DIRECTION["caret-right"]}. */
	"caret-down": () => <path d="M6.5 10h11L12 15.5z" fill="currentColor" stroke="none" />,
	/** Expand to fill — four corners pushing out. */
	"expand": () => <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
	/** Collapse from full — four corners pulling in. */
	"collapse": () => <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />,
} as const;
// #endregion

// #region Controls
const CONTROLS = {
	/** The close cross. NOT `x` — `XIcon` already means the X brand mark in marketing. */
	"close": () => <path d="M6 6l12 12M18 6L6 18" />,
	"plus": () => <path d="M12 5v14M5 12h14" />,
	"minus": () => <path d="M5 12h14" />,
	"check": () => <path d="M4.5 12.5l5 5 10-11" />,
	"search": () => (
		<>
			<circle cx="11" cy="11" r="6.5" />
			<path d="M15.8 15.8L20.5 20.5" />
		</>
	),
	/** Filter — a funnel. Supersedes the parallel `sliders` drawing of the same concept. */
	"filter": () => <path d="M3.5 5.5h17l-6.5 7.5v6l-4 2v-8z" />,
	/** Overflow menu, vertical. The set has ONE overflow mark; `more` is not a second one. */
	"kebab": () => (
		<>
			<circle cx="12" cy="5.5" r="1.4" fill="currentColor" stroke="none" />
			<circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
			<circle cx="12" cy="18.5" r="1.4" fill="currentColor" stroke="none" />
		</>
	),
	/** Overflow menu, horizontal — the same concept laid along a row. */
	"kebab-horizontal": () => (
		<>
			<circle cx="5.5" cy="12" r="1.4" fill="currentColor" stroke="none" />
			<circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
			<circle cx="18.5" cy="12" r="1.4" fill="currentColor" stroke="none" />
		</>
	),
	/** A stacked-lines menu trigger. */
	"menu": () => <path d="M4 7h16M4 12h16M4 17h16" />,
	/** A drag handle — six dots. Replaces the typed braille `⠿`, which rendered in the system font. */
	"grip": () => (
		<>
			<circle cx="9" cy="6" r="1.2" fill="currentColor" stroke="none" />
			<circle cx="15" cy="6" r="1.2" fill="currentColor" stroke="none" />
			<circle cx="9" cy="12" r="1.2" fill="currentColor" stroke="none" />
			<circle cx="15" cy="12" r="1.2" fill="currentColor" stroke="none" />
			<circle cx="9" cy="18" r="1.2" fill="currentColor" stroke="none" />
			<circle cx="15" cy="18" r="1.2" fill="currentColor" stroke="none" />
		</>
	),
	/** Grid density — the card view of a zoom-driven explorer. */
	"grid": () => (
		<>
			<rect x="4" y="4" width="7" height="7" rx="1.6" />
			<rect x="13" y="4" width="7" height="7" rx="1.6" />
			<rect x="4" y="13" width="7" height="7" rx="1.6" />
			<rect x="13" y="13" width="7" height="7" rx="1.6" />
		</>
	),
	/** List density — the table view. */
	"list": () => <path d="M4 6.5h16M4 12h16M4 17.5h16" />,
	/**
	 * Show or hide a companion panel on the trailing edge. The frame is the surface and the divided
	 * column is the panel, so the glyph states WHERE the thing appears rather than merely that
	 * something toggles — which a chevron cannot.
	 */
	"panel-right": () => (
		<>
			<rect x="3.5" y="4.5" width="17" height="15" rx="2.4" />
			<path d="M14.5 4.5v15" />
		</>
	),
	/** Sort, no direction chosen. Replaces the typed `⇅`. */
	"sort": () => <path d="M8 4v16M8 4L5 7.5M8 4l3 3.5M16 20V4M16 20l-3-3.5M16 20l3-3.5" />,
	"sort-asc": () => <path d="M12 20V5M12 5L6.5 10.5M12 5l5.5 5.5" />,
	"sort-desc": () => <path d="M12 4v15M12 19l-5.5-5.5M12 19l5.5-5.5" />,
	"edit": () => (
		<>
			<path d="M4 20h4l10-10a2.4 2.4 0 0 0-3.4-3.4L4.6 16.6z" />
			<path d="M14.5 7.5l2.6 2.6" />
		</>
	),
	"trash": () => (
		<>
			<path d="M4.5 6.5h15M9.5 6.5V4.8a1.3 1.3 0 0 1 1.3-1.3h2.4a1.3 1.3 0 0 1 1.3 1.3v1.7" />
			<path d="M6.5 6.5l.9 12.2a1.8 1.8 0 0 0 1.8 1.6h5.6a1.8 1.8 0 0 0 1.8-1.6l.9-12.2" />
		</>
	),
	"download": () => <path d="M12 4v11M7.5 11l4.5 4.5 4.5-4.5M5 19.5h14" />,
	"upload": () => <path d="M12 19V8M7.5 12L12 7.5 16.5 12M5 4.5h14" />,
	"copy": () => (
		<>
			<rect x="8.5" y="8.5" width="11" height="11" rx="2.2" />
			<path d="M15.5 8.5v-2a2 2 0 0 0-2-2H6.5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" />
		</>
	),
	"external-link": () => (
		<path d="M14 4.5h5.5V10M19.5 4.5L11 13M17 14v4.2a1.8 1.8 0 0 1-1.8 1.8H5.8A1.8 1.8 0 0 1 4 18.2V8.8A1.8 1.8 0 0 1 5.8 7H10" />
	),
	/** Copy link — two chain links. */
	"link": () => (
		<>
			<path d="M9.5 13.5l5-5" />
			<path d="M8 11l-2 2a3 3 0 0 0 4.2 4.2l2-2" />
			<path d="M16 13l2-2a3 3 0 0 0-4.2-4.2l-2 2" />
		</>
	),
	"share": () => (
		<>
			<circle cx="18" cy="5.5" r="2.5" />
			<circle cx="6" cy="12" r="2.5" />
			<circle cx="18" cy="18.5" r="2.5" />
			<path d="M8.3 10.8l7.4-4M8.3 13.2l7.4 4" />
		</>
	),
	/** Refresh / retry — a closed cycle. */
	"refresh": () => <path d="M20 12a8 8 0 1 1-2.4-5.7M20 4.5V10h-5.5" />,
	/** Switch context — two paths trading places. */
	"switch": () => <path d="M4 8.5h13M13.5 5l3.5 3.5-3.5 3.5M20 15.5H7M10.5 12L7 15.5l3.5 3.5" />,
	/** Sign out. */
	"logout": () => (
		<path d="M15 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2v-2.5M10.5 12H21M17.5 8.5L21 12l-3.5 3.5" />
	),
} as const;
// #endregion

// #region State & meaning
const STATE = {
	/** A circled i. */
	"info": () => (
		<>
			<circle cx="12" cy="12" r="8.5" />
			<path d="M12 11v5" />
			<circle cx="12" cy="7.8" r="0.6" fill="currentColor" stroke="none" />
		</>
	),
	/** A triangular caution. */
	"warning": () => (
		<>
			<path d="M12 3.6l9 15.4H3z" />
			<path d="M12 9.5v4" />
			<circle cx="12" cy="16.4" r="0.6" fill="currentColor" stroke="none" />
		</>
	),
	/** A circled cross — an error, not a close control. */
	"error": () => (
		<>
			<circle cx="12" cy="12" r="8.5" />
			<path d="M9 9l6 6M15 9l-6 6" />
		</>
	),
	/** A circled tick. */
	"success": () => (
		<>
			<circle cx="12" cy="12" r="8.5" />
			<path d="M8 12.3l2.7 2.7L16 9.5" />
		</>
	),
	/** A circled question. */
	"help": () => (
		<>
			<circle cx="12" cy="12" r="8.5" />
			<path d="M9.4 9.4a2.6 2.6 0 1 1 3.8 2.3c-.75.4-1.2 1.1-1.2 1.85v.35" />
			<circle cx="12" cy="16.6" r="0.6" fill="currentColor" stroke="none" />
		</>
	),
	/** Locked — a closed padlock. One concept: a password field and a frozen column are both "locked". */
	"lock": () => (
		<>
			<rect x="4.5" y="10.5" width="15" height="9.5" rx="2.2" />
			<path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
		</>
	),
	"unlock": () => (
		<>
			<rect x="4.5" y="10.5" width="15" height="9.5" rx="2.2" />
			<path d="M8 10.5V7.5a4 4 0 0 1 7.6-1.7" />
		</>
	),
	"clock": () => (
		<>
			<circle cx="12" cy="12" r="8.5" />
			<path d="M12 7.5V12l3 2" />
		</>
	),
	/**
	 * What has already happened — a clock face with the counter-clockwise arrow that distinguishes an
	 * ARCHIVE from a plain `clock` (a time) or `refresh` (a repeat).
	 */
	"history": () => (
		<>
			<path d="M3.6 12a8.4 8.4 0 1 0 2.5-6" />
			<path d="M3.2 3.6v4.2h4.2" />
			<path d="M12 7.8V12l2.9 1.8" />
		</>
	),
	/** Time running out — an hourglass. */
	"hourglass": () => (
		<path d="M7 4h10M7 20h10M7.5 4c0 4 4.5 5.2 4.5 8s-4.5 4-4.5 8M16.5 4c0 4-4.5 5.2-4.5 8s4.5 4 4.5 8" />
	),
	"eye": () => (
		<>
			<path d="M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z" />
			<circle cx="12" cy="12" r="2.8" />
		</>
	),
	"eye-off": () => (
		<>
			<path d="M6.3 6.6C3.9 8.3 2.5 12 2.5 12s3.5 6 9.5 6c2 0 3.7-.7 5.1-1.6M9.8 6.4A9.4 9.4 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-2.6 3.2" />
			<path d="M3 3l18 18" />
		</>
	),
	"bell": () => (
		<>
			<path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6z" />
			<path d="M10 20a2 2 0 0 0 4 0" />
		</>
	),
	"bell-off": () => (
		<>
			<path d="M8.5 4.5A6 6 0 0 1 18 9c0 3 1 4.5 1.6 5.3M6 9c0 5-2 6-2 6h11" />
			<path d="M10 20a2 2 0 0 0 4 0" />
			<path d="M3 3l18 18" />
		</>
	),
	/** Favourite / rate. `data-filled` gives the solid state — never a second component. */
	"star": () => (
		<path d="M12 3.8l2.65 5.37 5.93.86-4.29 4.18 1.01 5.9L12 17.32l-5.3 2.79 1.01-5.9-4.29-4.18 5.93-.86z" />
	),
	/** Verified — a tick inside a scalloped seal. */
	"verified": () => (
		<>
			<path d="M12 3.2l2.2 1.9 2.9-.3 1 2.75 2.6 1.35-.75 2.85.75 2.85-2.6 1.35-1 2.75-2.9-.3L12 20.8l-2.2-1.9-2.9.3-1-2.75-2.6-1.35.75-2.85-.75-2.85 2.6-1.35 1-2.75 2.9.3z" />
			<path d="M8.8 12.2l2.3 2.3 4.1-4.6" />
		</>
	),
	/** Protected — a shield. */
	"shield": () => <path d="M12 3.5l7 2.8v5.4c0 4.2-2.9 7.4-7 8.8-4.1-1.4-7-4.6-7-8.8V6.3z" />,
	/** A flag — report, or a priority marker. */
	"flag": () => <path d="M5.5 21V4.5h11l-1.6 3.4 1.6 3.4h-11" />,
	/** Save for later. `data-filled` gives the saved state. */
	"bookmark": () => <path d="M6 4.5h12v15l-6-4-6 4z" />,
	/** A push-pin — pin a channel or a message. NOT `pin-location`. */
	"pin-fixed": () => (
		<>
			<path d="M9 4h6l-1 6 3 3v2H7v-2l3-3-1-6z" />
			<path d="M12 18v3" />
		</>
	),
	/** A map marker — a physical place. NOT `pin-fixed`. */
	"pin-location": () => (
		<>
			<path d="M12 21s-7-6.5-7-11a7 7 0 0 1 14 0c0 4.5-7 11-7 11z" />
			<circle cx="12" cy="10" r="2.5" />
		</>
	),
} as const;
// #endregion

// #region People & entities
const PEOPLE = {
	/** One person. */
	"user": () => (
		<>
			<circle cx="12" cy="8" r="3.6" />
			<path d="M4.8 20a7.2 7.2 0 0 1 14.4 0" />
		</>
	),
	/** Several people — members of anything. The set has ONE people mark; `teams` is not a second. */
	"members": () => (
		<>
			<circle cx="9" cy="9" r="3" />
			<path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
			<path d="M16 6.2a3 3 0 0 1 0 5.6M17.5 19a5.5 5.5 0 0 0-3-4.9" />
		</>
	),
	"user-plus": () => (
		<>
			<circle cx="9.5" cy="8.5" r="3.4" />
			<path d="M3.5 19.5a6 6 0 0 1 12 0" />
			<path d="M18 8v6M15 11h6" />
		</>
	),
	"user-minus": () => (
		<>
			<circle cx="9.5" cy="8.5" r="3.4" />
			<path d="M3.5 19.5a6 6 0 0 1 12 0" />
			<path d="M15 11h6" />
		</>
	),
	/** A business or organisation — a building. */
	"building": () => (
		<>
			<path d="M4 20.5V6.2l8-2.7v17M4 20.5h16M20 20.5V10l-8-2.6" />
			<path d="M7 9.5v.01M7 13v.01M7 16.5v.01" />
		</>
	),
	/** A chat bubble — a direct message. */
	"message": () => <path d="M5 5h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H9l-4 3.5V7a2 2 0 0 1 2-2z" />,
	/** An envelope. */
	"mail": () => (
		<>
			<rect x="3" y="5.5" width="18" height="13" rx="2.2" />
			<path d="M3.6 7l8.4 6 8.4-6" />
		</>
	),
} as const;
// #endregion

// #region Objects & work
const OBJECTS = {
	"calendar": () => (
		<>
			<rect x="4" y="5" width="16" height="15" rx="2" />
			<path d="M4 9h16M8 3v4M16 3v4" />
		</>
	),
	"calendar-plus": () => (
		<>
			<rect x="4" y="5" width="16" height="15" rx="2" />
			<path d="M4 9h16M8 3v4M16 3v4M12 12v5M9.5 14.5h5" />
		</>
	),
	/** A document. */
	"document": () => (
		<>
			<rect x="5" y="3.5" width="14" height="17" rx="2" />
			<path d="M8.5 8h7M8.5 12h7M8.5 16h4" />
		</>
	),
	"folder": () => (
		<path d="M3.5 7.5a2 2 0 0 1 2-2h3.3l2 2.5h7.7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
	),
	/** An attachment — a paperclip. */
	"attachment": () => <path d="M8 12.5l6.5-6.5a3 3 0 0 1 4.2 4.2l-8 8a5 5 0 0 1-7-7l7.5-7.5" />,
	/** A submission — an outbox tray with an up arrow. */
	"submission": () => (
		<>
			<path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
			<path d="M12 16V4M8 8l4-4 4 4" />
		</>
	),
	/** A ticket. */
	"ticket": () => (
		<>
			<path d="M3.5 9.5V7a1.5 1.5 0 0 1 1.5-1.5h14A1.5 1.5 0 0 1 20.5 7v2.5a2.5 2.5 0 0 0 0 5V17a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 17v-2.5a2.5 2.5 0 0 0 0-5z" />
			<path d="M14 5.5v13" />
		</>
	),
	/** A product — a box. */
	"box": () => (
		<>
			<path d="M12 3.2l8.5 4.4v8.8L12 20.8l-8.5-4.4V7.6z" />
			<path d="M3.8 7.8L12 12l8.2-4.2M12 12v8.6" />
		</>
	),
	/** A service — layered planes. */
	"service": () => <path d="M12 3 3 8l9 5 9-5zM3 13l9 5 9-5M3 8v5m18-5v5" />,
	/** Archive an item — a lidded storage box. A compressed-file glyph is a FILE KIND, not this. */
	"archive-box": () => (
		<>
			<path d="M4 7.5h16V19a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19z" />
			<path d="M3 4h18v3.5H3zM10 11.5h4" />
		</>
	),
	/** A shopping basket. */
	"basket": () => (
		<>
			<path d="M3.5 9h17l-1.6 9.2a1.8 1.8 0 0 1-1.8 1.5H6.9a1.8 1.8 0 0 1-1.8-1.5z" />
			<path d="M8.5 9l2-5M15.5 9l-2-5" />
		</>
	),
	"tag": () => (
		<>
			<path d="M11.4 3.5H20v8.6l-8.5 8.5a1.6 1.6 0 0 1-2.3 0l-6.3-6.3a1.6 1.6 0 0 1 0-2.3z" />
			<circle cx="16.3" cy="7.7" r="1.3" fill="currentColor" stroke="none" />
		</>
	),
	"image": () => (
		<>
			<rect x="3.5" y="4.5" width="17" height="15" rx="2.4" />
			<circle cx="8.8" cy="9.8" r="1.6" />
			<path d="M4 17l4.8-4.6a1.8 1.8 0 0 1 2.5 0L16 17M14.2 15.2l1.6-1.5a1.8 1.8 0 0 1 2.5 0l2.2 2.1" />
		</>
	),
	"play": () => <path d="M8 5.4l10 6.6-10 6.6z" />,
	"pause": () => <path d="M9.5 5v14M14.5 5v14" />,
	/** A video call — a camera body with a lens spout. A video FILE is a file-kind glyph, not this. */
	"video-camera": () => (
		<>
			<rect x="3" y="6.5" width="12.5" height="11" rx="2.2" />
			<path d="M15.5 10.5L21 7.5v9l-5.5-3z" />
		</>
	),
	"mic": () => (
		<>
			<rect x="9" y="3" width="6" height="11" rx="3" />
			<path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" />
		</>
	),
	"send": () => <path d="M20.5 3.5L10.5 13.5M20.5 3.5l-6.4 17-3.6-7-7-3.6z" />,
	"globe": () => (
		<>
			<circle cx="12" cy="12" r="8.5" />
			<path d="M3.5 12h17M12 3.5c2.2 2.4 3.4 5.4 3.4 8.5S14.2 18.1 12 20.5c-2.2-2.4-3.4-5.4-3.4-8.5S9.8 5.9 12 3.5z" />
		</>
	),
} as const;
// #endregion

/**
 * The complete registry, flattened.
 *
 * Values are THUNKS, not VNode constants. Preact mutates a VNode during diff (`_parent`, `_dom`,
 * `_depth`), so mounting one constant in two places at once corrupts the first mount's reference —
 * the reuse hazard this codebase already hit once, and worked around at a call site with
 * `cloneElement`. A thunk hands every call site its own tree and removes the hazard at the source.
 */
export const ICON_PATHS = {
	...NAVIGATION,
	...DIRECTION,
	...CONTROLS,
	...STATE,
	...PEOPLE,
	...OBJECTS,
} as const satisfies Record<string, () => VNode>;

/** Every canonical glyph name. Adding a glyph widens this union automatically. */
export type IconName = keyof typeof ICON_PATHS;
