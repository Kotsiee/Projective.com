import type { JSX, RefObject } from "preact";
import { ActionMenu, composeMenu } from "@projective/ui/navigation";
import type { MenuItem } from "@ui/types/mod.ts";
import { ctaMirror, mirrorMenuRows } from "../core/cta-mirror.ts";
import { MoneyView } from "@projective/ui/display/money";
import { Icon, type IconName } from "@projective/ui/icons";
import type { PriceAmount } from "@features/explore/core/pricing.ts";
import { type ProjectStage, revisionAllowanceKind } from "@projective/types/explore";
import { toMinorUnits } from "@projective/types/finance";
import { PriceOrigin } from "./entity-view-parts.tsx";
import { jumpToStage } from "../core/view-state.ts";
import type { SeatCapacity } from "../core/entity-archetype.ts";

/**
 * Entity View — the conversion lane's shared parts (`DESIGN_SYSTEM.md` §D.7.2).
 *
 * TWO lanes render these parts in ONE `.evp-card` anatomy: the listing's `EntityLane` and the project's
 * `ProjectLane` (price + kebab · stage list · summary ledger · action stack — no identity band,
 * Decisions #424 and #523). They share these components rather than each carrying a copy, because two
 * kebab menus drift apart, and two price blocks are two ways of raising the pence.
 *
 * Every part here reads the SAME `.evp-lane*` / `.evp-price*` / `.evp-stages*` classes in
 * `entity-view.css`, which is what makes a project's lane and a service's lane one control set rather
 * than two lookalikes. They are plain components (no island of their own) rendered inside the two
 * lane islands, so the `Popover` and the signal reads stay reactive.
 */

// #region Menu
/** One action in the lane's overflow kebab. */
export interface LaneMenuItem {
	key: string;
	label: string;
	icon: IconName;
	/** Moderation / destructive intent — tinted via `[data-danger]`. */
	danger?: boolean;
	onSelect: () => void;
	/**
	 * A submenu beside the row (Decision #522): the row still runs `onSelect` when pressed, and its
	 * chevron opens these rows. Save uses it: press to save, or pick a list.
	 */
	items?: MenuItem[];
	/** Said inside an empty submenu (the lists before they are read). */
	emptyLabel?: string;
}

/** The lane's rows as the menu primitive reads them: one model for the kebab and the right-click menu. */
function laneMenuModel(menu: readonly LaneMenuItem[]): MenuItem[] {
	return menu.map((action) => ({
		key: action.key,
		label: action.label,
		icon: action.icon,
		danger: action.danger,
		command: () => action.onSelect(),
		...(action.items ? { items: action.items, emptyLabel: action.emptyLabel } : {}),
	}));
}

/**
 * The card's overflow kebab, beside the price: every SECONDARY action lives behind it. The card carries
 * no identity (Decision #424: the creator is named once, in the page's byline). No actions, no kebab:
 * a trigger that opens an empty menu is a control that does nothing. An `ActionMenu`, so a row may
 * carry a submenu (Save into a list, Decision #522); `onOpen` lets the lane read what a submenu lists.
 */
export function LaneMenu(
	{ menu, menuLabel, onOpen }: {
		menu: readonly LaneMenuItem[];
		menuLabel: string;
		onOpen?: () => void;
	},
): JSX.Element | null {
	if (menu.length === 0) return null;
	return (
		<ActionMenu
			model={laneMenuModel(menu)}
			aria-label={menuLabel}
			placement="bottom-end"
			class="evp-menu"
			onOpenChange={(open) => {
				if (open) onOpen?.();
			}}
			trigger={(api) => (
				<button
					type="button"
					ref={api.ref as RefObject<HTMLButtonElement>}
					class="evp-lane__kebab"
					aria-label={menuLabel}
					aria-expanded={api.expanded ? "true" : "false"}
					aria-controls={api.expanded ? api.panelId : undefined}
					aria-haspopup="menu"
					onClick={api.toggle}
				>
					<Icon name="kebab" size="sm" />
				</button>
			)}
		/>
	);
}

/**
 * The lane card's right-click menu: the transaction rig's own controls (read from the CTA mirror, so
 * each row runs the rig's handler), then the same rows the kebab offers. Opens on a right-click, the
 * ContextMenu key or Shift+F10 anywhere on `surface`; any live text selection keeps the browser's own
 * menu, so copy and search still work.
 */
export function LaneContextMenu(
	{ menu, surface, label, onOpen }: {
		menu: readonly LaneMenuItem[];
		surface: () => HTMLElement | null;
		/** The menu's accessible name. */
		label: string;
		onOpen?: () => void;
	},
): JSX.Element {
	const model = composeMenu(mirrorMenuRows(ctaMirror.value), laneMenuModel(menu));
	return (
		<ActionMenu
			model={model}
			surface={surface}
			aria-label={label}
			onOpenChange={(open) => {
				if (open) onOpen?.();
			}}
		/>
	);
}
// #endregion

// #region Price
/**
 * The price block (§D.7.2 item 2). Two registers, one figure — never two equally-weighted numbers,
 * which reads as two prices.
 *
 * "From" is its own eyebrow line rather than a word run into the figure. It is a qualifier on the
 * whole price, not part of the number, and inline it competed for the same baseline as the currency
 * symbol.
 *
 * `MoneyView` splits the figure into symbol / major / minor ITSELF, so the smaller raised pence come
 * from the component rather than from this surface slicing a formatted string. That matters beyond
 * tidiness: the app's currency sweep rebuilds this exact subtree when it re-projects a
 * server-rendered figure, so a hand-split price would lose its pence styling the first time the
 * reader changed currency.
 */
export function PriceBlock(
	{ amount, fallback, unit, isFloor }: {
		amount: PriceAmount | null;
		fallback: string;
		unit?: string;
		isFloor?: boolean;
	},
): JSX.Element {
	return (
		<div class="evp-price">
			{amount
				? (
					<>
						{isFloor && <span class="evp-price__from">From</span>}
						<span class="evp-price__figure">
							<MoneyView
								minor={amount.minor}
								currency={amount.currency}
								size="figure"
								hideOrigin
								class="evp-price__money"
							/>
							{unit && <span class="evp-price__unit">/ {unit}</span>}
						</span>
						<PriceOrigin minor={amount.minor} currency={amount.currency} />
					</>
				)
				: <span class="evp-price__figure evp-price__figure--quote">{fallback}</span>}
		</div>
	);
}
// #endregion

// #region Stage list
/** The most stage rows a purchase card lists before folding the rest into one jump into the body. */
export const CARD_STAGE_LIMIT = 4;

/**
 * The lane's stage quick-jumps: ordinal · (name over its price) · chevron.
 *
 * Each row carries the stage's own price as muted subtext, rendered through the SAME `MoneyView` the
 * body ledger uses so the lane and the stage card cannot state different amounts, and quote the same
 * currency after a switch. ONE figure per stage — the INITIAL per-ticket price, never the 0.75×–1.5×
 * intensity price range, which belongs with the intensity that produces it.
 *
 * A jump drives the DOM of the server-rendered `StageProgressLedger` (`jumpToStage`), so the control
 * reaches something on every page that mounts it (root CLAUDE.md §3 gate 11).
 */
export function LaneStages(
	{ stages, currency, label, limit }: {
		stages: readonly ProjectStage[];
		currency: string;
		label: string;
		/**
		 * The most rows to list; the rest fold into one jump to the first hidden stage in the body. The
		 * purchase card passes it so its height is bounded and it never needs a scroll of its own.
		 */
		limit?: number;
	},
): JSX.Element | null {
	if (!stages.length) return null;
	const shown = limit && stages.length > limit + 1 ? stages.slice(0, limit) : stages;
	const hidden = stages.length - shown.length;
	return (
		<nav class="evp-stages" aria-label={label}>
			{shown.map((s) => (
				<button
					type="button"
					class="evp-stages__item"
					key={s.id}
					data-status={s.status}
					onClick={() => jumpToStage(s.id)}
				>
					<span class="evp-stages__n" aria-hidden="true">{s.index}</span>
					<span class="evp-stages__body">
						<span class="evp-stages__name">{s.name}</span>
						<span class="evp-stages__price">
							<MoneyView
								minor={toMinorUnits(s.price.min, currency) ?? 0}
								currency={currency}
								size="micro"
								hideOrigin
							/>
							{s.revisions && (
								<>
									<span class="evp-stages__pricesep" aria-hidden="true">·</span>
									<span class="evp-stages__revisions">{revisionLabel(s)}</span>
								</>
							)}
						</span>
					</span>
					<Icon name="chevron-right" size="sm" class="evp-stages__chevron" aria-hidden />
				</button>
			))}
			{hidden > 0 && (
				<button
					type="button"
					class="evp-stages__more"
					onClick={() => jumpToStage(stages[shown.length].id)}
				>
					{hidden} more {hidden === 1 ? "stage" : "stages"}
				</button>
			)}
		</nav>
	);
}

/**
 * The lane's one-phrase revision label.
 *
 * Deliberately carries no figure: the row already holds the stage's ticket price, and a second amount
 * beside it turns a scannable line into two numbers a reader has to tell apart. The amount belongs to
 * the stage ledger in the body, where there is room for the sentence that explains it.
 */
function revisionLabel(stage: ProjectStage): string {
	const revisions = stage.revisions!;
	switch (revisionAllowanceKind(revisions)) {
		case "unlimited":
			return "unlimited revisions";
		case "metered":
			return "revisions billed";
		default:
			return `${revisions.free} free rev${revisions.free === 1 ? "" : "s"}`;
	}
}
// #endregion

// #region Seats
/**
 * The cohort's ONE seat meter (Decision #424 — the hero no longer repeats it): the purchase card's and
 * the buy bar's, whichever region is on screen. The meter is decorative and the sentence is the fact
 * (§D.8.4); the widths are `flex-grow` integers, never animated, so a frozen animation clock cannot draw
 * an empty cohort as full (§8 Decision #60).
 */
export function SeatSummary({ capacity }: { capacity: SeatCapacity }): JSX.Element {
	const segments = capacity.total <= 20 ? capacity.total : 20;
	const taken = capacity.total <= 20 ? capacity.taken : Math.round((capacity.taken / capacity.total) * 20);
	return (
		<div class="evp-lane__seats">
			<div class="evp-lane__seatstrack" aria-hidden="true">
				{Array.from(
					{ length: segments },
					(_, i) => <span class="evp-lane__seatseg" key={i} data-state={i < taken ? "taken" : "open"} />,
				)}
			</div>
			<p class="evp-lane__seatsfact">{capacity.sentence}</p>
		</div>
	);
}
// #endregion

// #region Summary ledger
/** One row of the lane's summary ledger: a label, the fact, and an optional muted qualifier under it. */
export interface LaneLedgerRow {
	label: string;
	value: string;
	note?: string;
}

/**
 * The summary ledger (§D.7.2 item 6). Two columns — label at the inline start, value at the end with
 * an optional muted note beneath it. Facts, not controls, so none of them is a chip (§B.11.2), and
 * no row draws a rule: the rows are separated by spacing alone.
 *
 * The note exists because several of these facts genuinely are two — "3 files" and how big they are,
 * "stage 2 of 4" and which stage that is. Stacking the qualifier under the value is what lets the
 * value itself stay scannable.
 */
export function LaneLedger({ rows }: { rows: readonly LaneLedgerRow[] }): JSX.Element | null {
	if (!rows.length) return null;
	return (
		<dl class="evp-lane__ledger">
			{rows.map((row) => (
				<div class="evp-lane__ledgerrow" key={row.label}>
					<dt class="evp-lane__ledgerlabel">{row.label}</dt>
					<dd class="evp-lane__ledgervalue">
						<span class="evp-lane__ledgerfact">{row.value}</span>
						{row.note && <span class="evp-lane__ledgernote">{row.note}</span>}
					</dd>
				</div>
			))}
		</dl>
	);
}
// #endregion
