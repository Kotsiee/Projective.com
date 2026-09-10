import type { JSX, RefObject } from "preact";
import { Popover } from "@projective/ui/feedback";
import { Avatar } from "@projective/ui/display";
import { MoneyView } from "@projective/ui/display/money";
import { Icon, type IconName } from "@projective/ui/icons";
import { StatusChip } from "@features/explore/components/StatusChip.tsx";
import type { CardSignal } from "@features/explore/core/card-signals.ts";
import type { PriceAmount } from "@features/explore/core/pricing.ts";
import { type ProjectStage, revisionAllowanceKind } from "@projective/types/explore";
import type { ExploreItem } from "@projective/types/explore";
import { PriceOrigin } from "./entity-view-parts.tsx";
import { jumpToStage } from "../core/view-state.ts";

/**
 * Entity View — the conversion lane's shared parts (`DESIGN_SYSTEM.md` §D.7.2).
 *
 * The lane's anatomy is fixed — identity band · price · stage list · summary ledger · pinned action
 * footer — and TWO lanes render it: the commerce `EntityLane` and the project `ProjectLane`. They
 * share these components rather than each carrying a copy, because two copies of the identity band
 * are two kebab menus that drift apart, and two price blocks are two ways of raising the pence.
 *
 * Every part here reads the SAME `.evp-lane*` / `.evp-price*` / `.evp-stages*` classes in
 * `entity-view.css`, which is what makes a project's lane and a service's lane one control set rather
 * than two lookalikes. They are plain components (no island of their own) rendered inside the two
 * lane islands, so the `Popover` and the signal reads stay reactive.
 */

// #region Identity band
/** One action in the lane's overflow kebab. */
export interface LaneMenuItem {
	key: string;
	label: string;
	icon: IconName;
	/** Moderation / destructive intent — tinted via `[data-danger]`. */
	danger?: boolean;
	onSelect: () => void;
}

/**
 * The identity band: the uploader's face and DISPLAY NAME — not their handle — with their earned
 * badges beside it, and the overflow kebab at the end. A buyer decides whether to trust a person,
 * and "@fernanda-ruiz" is an address where "Fernanda Ruiz" is a name; the handle survives as the
 * link target and in the hero.
 *
 * The badges are `.ex-status` chips, the same component and the same derivation rule the Explore
 * card that linked here uses, so a seller cannot be "Top rated" on the card and unmarked on the
 * page. They are the sanctioned container case (§B.11.3): a required disclosure of an earned,
 * changeable state.
 *
 * Every SECONDARY action lives behind the kebab. No `label` on the `Popover`: a labelled panel is
 * promoted to `role="dialog"` while the trigger advertises `aria-haspopup="menu"`, and a screen
 * reader then announces a menu and lands the user in a dialog. The panel's own `role="menu"` and
 * its `menuitem` children already name and describe it.
 */
export function LaneIdentity(
	{ item, badges, menu, menuLabel }: {
		item: ExploreItem;
		badges: readonly CardSignal[];
		menu: readonly LaneMenuItem[];
		/** The kebab's accessible name — names the noun ("More listing actions"). */
		menuLabel: string;
	},
): JSX.Element {
	return (
		<header class="evp-lane__id">
			<a class="evp-lane__owner" href={`/${item.owner.handle}`}>
				<Avatar
					image={item.owner.avatar}
					label={item.owner.name}
					size="md"
					shape={item.owner.kind === "business" ? "square" : "circle"}
					class="evp-lane__avatar"
				/>
				<span class="evp-lane__identity">
					<span class="evp-lane__name">
						{item.owner.name}
						{item.owner.verified && (
							<Icon
								name="verified"
								size="sm"
								filled
								class="evp-lane__crest"
								aria-label="Verified"
							/>
						)}
					</span>
					{badges.length > 0 && (
						<span class="evp-lane__badges">
							{badges.map((signal) => <StatusChip key={signal.id} signal={signal} />)}
						</span>
					)}
				</span>
			</a>

			<Popover
				placement="bottom-end"
				class="evp-menu"
				trigger={(api) => (
					<button
						type="button"
						ref={api.ref as RefObject<HTMLButtonElement>}
						class="evp-lane__kebab"
						aria-label={menuLabel}
						aria-expanded={api.expanded ? "true" : "false"}
						aria-controls={api.panelId}
						aria-haspopup="menu"
						onClick={api.toggle}
					>
						<Icon name="kebab" size="sm" />
					</button>
				)}
			>
				<div class="evp-menu__list" role="menu">
					{menu.map((action) => (
						<button
							key={action.key}
							type="button"
							class="evp-menu__item"
							role="menuitem"
							data-danger={action.danger ? "true" : undefined}
							onClick={action.onSelect}
						>
							<Icon name={action.icon} size="sm" aria-hidden />
							<span>{action.label}</span>
						</button>
					))}
				</div>
			</Popover>
		</header>
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
/**
 * The lane's stage quick-jumps: ordinal · (name over its price) · chevron.
 *
 * Each row carries the stage's own price as muted subtext, rendered through the SAME `MoneyView` the
 * body ledger uses so the lane and the stage card cannot state different amounts, and quote the same
 * currency after a switch. ONE figure per stage — the INITIAL per-ticket price, never the 0.5×–2.0×
 * workload range, which belongs with the intensity that produces it.
 *
 * A jump drives the DOM of the server-rendered `StageProgressLedger` (`jumpToStage`), so the control
 * reaches something on every page that mounts it (root CLAUDE.md §3 gate 11).
 */
export function LaneStages(
	{ stages, currency, label }: {
		stages: readonly ProjectStage[];
		currency: string;
		label: string;
	},
): JSX.Element | null {
	if (!stages.length) return null;
	return (
		<nav class="evp-stages" aria-label={label}>
			{stages.map((s) => (
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
								minor={Math.round(s.price.min * 100)}
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
