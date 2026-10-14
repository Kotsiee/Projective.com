import type { JSX, RefObject } from "preact";
import { type Signal, useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import "../styles/lane.css";
import { Popover } from "@projective/ui/feedback";
import { SortControl } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import {
	LaneBar,
	LaneCollapseButton,
	LaneCreateButton,
	LaneEmpty,
	LaneFooter,
	LaneFooterActions,
	LaneHead,
	LaneList,
	LaneSection,
	LaneSections,
	LaneTabs,
	type LaneToggleOption,
	LaneToggleRow,
	Menu,
	type MenuItem,
} from "@projective/ui/navigation";
import { SidebarToggleIcon } from "@web/features/shell/core/nav-icons.tsx";
import { MIDDLE_LANE_TOGGLE_EVENT } from "@web/utils/lane-events.ts";
import { CatalogueRail } from "../components/CatalogueRail.tsx";
import { CatalogueFilterPanel } from "../components/CatalogueFilterPanel.tsx";
import { ListingLaneRow } from "../components/ListingLaneRow.tsx";
import { TrendIcon } from "../components/catalogue-glyphs.tsx";
import { listingHref, SERVICE_MODELS, SORT_OPTIONS, TYPE_TABS } from "../core/catalogue-model.ts";
import {
	consoleView,
	listingsPage,
	openCreate,
	type QuickFilters,
	quickFilters,
	setConsoleUrl,
	setQuickFilter,
	startConsoleSync,
} from "../core/console-store.ts";
import { laneOutline, type LaneOutlineSection, outlineAnchor } from "../core/lane-outline.ts";
import { useConsoleSort } from "../hooks/useConsoleSort.ts";
import {
	type CatalogueKind,
	type CatalogueStatusCounts,
	consoleHref,
	type ConsoleUrlState,
	type EditSection,
	type ListingSummary,
	type ServiceType,
} from "../types/catalogue-types.ts";

/**
 * CatalogueLane — the `/catalogue*` navigation lane, in one of two modes.
 *
 * **Console** (`/catalogue`): the type tabs at the peak, sort, the quick filters, and the facets —
 * status (presence dots, never counts), delivery model and CREATE category — every one of which
 * writes the console URL, so the canvas, the header count and a shared link all agree. The footer's
 * New listing menu opens the quick-create modal in place (`?create=`).
 *
 * **Outline** (`/catalogue/[id]`): the current listing pinned, the workspace's "On this page"
 * sections (published by the workspace through `lane-outline`), and the seller's other listings. Its
 * New listing menu links to the console's `?create=` deep links.
 *
 * Both render the collapsed {@link CatalogueRail} beside the expanded stack and let
 * `.ui-splitter[data-mode="collapsed"]` reveal one.
 */

// #region Props
/** The console lane's server-resolved facts. */
export interface ConsoleLaneProps {
	mode: "console";
	url: ConsoleUrlState;
	statusCounts: CatalogueStatusCounts;
	/** The first listings, for the collapsed rail. */
	recent: ListingSummary[];
}

/** The outline lane's server-resolved facts. */
export interface OutlineLaneProps {
	mode: "outline";
	/** The workspace's listing slug. */
	activeId: string;
	/** The seller's listings, newest first. */
	listings: ListingSummary[];
}

export type CatalogueLaneProps = ConsoleLaneProps | OutlineLaneProps;

interface LaneChrome {
	collapsed: boolean;
	onCollapse: (next: boolean) => void;
}
// #endregion

const RAIL_RECENT = 8;

const QUICK_TOGGLES: readonly LaneToggleOption<keyof QuickFilters>[] = [
	{ key: "attention", label: "Needs attention", icon: <Icon name="warning" /> },
	{ key: "promoted", label: "Promoted", icon: <Icon name="star" /> },
	{ key: "bestSelling", label: "Best-selling", icon: <TrendIcon /> },
];

export default function CatalogueLane(props: CatalogueLaneProps): JSX.Element {
	const collapsed = useSignal(false);

	useEffect(() => {
		const el = globalThis.document?.querySelector<HTMLElement>(".ui-splitter");
		collapsed.value = el?.dataset.mode === "collapsed";
	}, []);

	function onCollapse(next: boolean): void {
		collapsed.value = next;
		globalThis.dispatchEvent(
			new CustomEvent(MIDDLE_LANE_TOGGLE_EVENT, { detail: { collapsed: next } }),
		);
	}

	const chrome: LaneChrome = { collapsed: collapsed.value, onCollapse };
	return props.mode === "console"
		? <ConsoleLane {...props} {...chrome} />
		: <OutlineLane {...props} {...chrome} />;
}

// #region Quick create
/** What a New listing entry does: open the modal in place, or link to the console's deep link. */
type CreateTarget =
	| { go: (kind: CatalogueKind, serviceType?: ServiceType) => void }
	| { href: (kind: CatalogueKind, serviceType?: ServiceType) => string };

function newListingMenu(target: CreateTarget): MenuItem[] {
	const entry = (
		key: string,
		label: string,
		kind: CatalogueKind,
		serviceType?: ServiceType,
	): MenuItem =>
		"href" in target
			? { key, label, url: target.href(kind, serviceType) }
			: { key, label, command: () => target.go(kind, serviceType) };
	return [
		entry("product", "New product", "product"),
		{
			key: "service",
			label: "New service",
			items: SERVICE_MODELS.map((m) => entry(m, m, "service", m)),
		},
	];
}

function QuickCreate({ open, model }: { open: Signal<boolean>; model: MenuItem[] }): JSX.Element {
	return (
		<Popover
			open={open}
			placement="top-end"
			avoid={[".ui-app-shell__sidebar"]}
			allowOverflow={["top"]}
			class="cat-newmenu-pop"
			trigger={(api) => (
				<LaneCreateButton
					label="New listing"
					icon={<Icon name="plus" />}
					triggerRef={api.ref as RefObject<HTMLElement>}
					ariaHasPopup="menu"
					ariaExpanded={api.expanded}
					ariaControls={api.panelId}
					onClick={api.toggle}
				/>
			)}
		>
			<Menu model={model} aria-label="New listing" class="cat-newmenu" />
		</Popover>
	);
}
// #endregion

// #region Console mode
function ConsoleLane(props: ConsoleLaneProps & LaneChrome): JSX.Element {
	const menuOpen = useSignal(false);

	useEffect(() => startConsoleSync(), []);

	const state = consoleView(props.url);
	const page = listingsPage.value;
	const counts = page?.statusCounts ?? props.statusCounts;
	const recent = (page?.items ?? props.recent).slice(0, RAIL_RECENT);
	const quick = quickFilters.value;
	const activeQuick = QUICK_TOGGLES.map((o) => o.key).filter((k) => quick[k]);
	const sort = useConsoleSort(state);

	const model = newListingMenu({
		go: (kind, serviceType) => {
			menuOpen.value = false;
			openCreate(kind, serviceType);
		},
	});

	return (
		<div class="cat-lane">
			<CatalogueRail
				recent={recent}
				activeId={null}
				onNew={() => openCreate()}
				onExpand={() => props.onCollapse(false)}
			/>

			<div class="cat-lane__full">
				<LaneHead>
					<LaneTabs
						label="Catalogue type"
						value={state.type}
						options={TYPE_TABS}
						onSelect={(type) => setConsoleUrl({ type })}
					/>
					<LaneBar>
						<SortControl
							options={[...SORT_OPTIONS]}
							value={sort.sort}
							direction={sort.dir}
							onValueChange={sort.onSort}
							onDirectionChange={sort.onDir}
							size="sm"
							class="cat-lane__sort"
							aria-label="Sort listings"
						/>
					</LaneBar>
					<LaneToggleRow
						label="Quick filters"
						options={QUICK_TOGGLES}
						active={activeQuick}
						onToggle={(key) => setQuickFilter(key, !quick[key])}
					/>
				</LaneHead>

				<LaneList label="Filters">
					<CatalogueFilterPanel
						state={state}
						statusCounts={counts}
						onChange={(patch) => setConsoleUrl(patch)}
					/>
				</LaneList>

				<LaneFooter>
					<LaneCollapseButton
						collapsed={props.collapsed}
						icon={<SidebarToggleIcon />}
						onToggle={() => props.onCollapse(!props.collapsed)}
					/>
					<LaneFooterActions>
						<QuickCreate open={menuOpen} model={model} />
					</LaneFooterActions>
				</LaneFooter>
			</div>
		</div>
	);
}
// #endregion

// #region Outline mode
function OutlineRow(
	{ section, active, onSelect }: {
		section: LaneOutlineSection;
		active: boolean;
		onSelect?: (id: EditSection) => void;
	},
): JSX.Element {
	const cls = active ? "cat-outline__row cat-outline__row--active" : "cat-outline__row";
	if (onSelect) {
		return (
			<button
				type="button"
				class={cls}
				aria-current={active ? "location" : undefined}
				onClick={() => onSelect(section.id)}
			>
				{section.label}
			</button>
		);
	}
	return (
		<a
			class={cls}
			href={`#${outlineAnchor(section.id)}`}
			aria-current={active ? "location" : undefined}
		>
			{section.label}
		</a>
	);
}

function OutlineLane(props: OutlineLaneProps & LaneChrome): JSX.Element {
	const menuOpen = useSignal(false);
	const open = useSignal({ page: true, listings: true });
	const outline = laneOutline.value;
	const current = props.listings.find((l) => l.id === props.activeId) ?? null;
	const others = props.listings.filter((l) => l.id !== props.activeId);
	const model = newListingMenu({
		href: (kind, serviceType) =>
			consoleHref({ createOpen: true, createKind: kind, createModel: serviceType }),
	});

	return (
		<div class="cat-lane">
			<CatalogueRail
				recent={props.listings.slice(0, RAIL_RECENT)}
				activeId={props.activeId}
				newHref={consoleHref({ createOpen: true })}
				onExpand={() => props.onCollapse(false)}
			/>

			<div class="cat-lane__full">
				<LaneHead>
					<a class="cat-lane__back" href="/catalogue">
						<Icon name="arrow-left" /> Catalogue
					</a>
				</LaneHead>

				<LaneList label="Listings">
					{current && (
						<div class="cat-lane__pinned">
							<ListingLaneRow listing={current} href={listingHref(current.id)} active />
						</div>
					)}
					<LaneSections>
						{outline && outline.sections.length > 0 && (
							<LaneSection
								id="cat-outline"
								icon={<Icon name="list" />}
								label="On this page"
								open={open.value.page}
								onToggle={() => (open.value = { ...open.value, page: !open.value.page })}
							>
								<nav class="cat-outline" aria-label="On this page">
									{outline.sections.map((s) => (
										<OutlineRow
											key={s.id}
											section={s}
											active={outline.active === s.id}
											onSelect={outline.onSelect}
										/>
									))}
								</nav>
							</LaneSection>
						)}
						<LaneSection
							id="cat-listings"
							icon={<Icon name="catalogue" />}
							label="Your listings"
							open={open.value.listings}
							onToggle={() => (open.value = { ...open.value, listings: !open.value.listings })}
						>
							{others.length === 0
								? <LaneEmpty title="No other listings" />
								: others.map((l) => (
									<ListingLaneRow key={l.id} listing={l} href={listingHref(l.id)} active={false} />
								))}
						</LaneSection>
					</LaneSections>
				</LaneList>

				<LaneFooter>
					<LaneCollapseButton
						collapsed={props.collapsed}
						icon={<SidebarToggleIcon />}
						onToggle={() => props.onCollapse(!props.collapsed)}
					/>
					<LaneFooterActions>
						<QuickCreate open={menuOpen} model={model} />
					</LaneFooterActions>
				</LaneFooter>
			</div>
		</div>
	);
}
// #endregion
