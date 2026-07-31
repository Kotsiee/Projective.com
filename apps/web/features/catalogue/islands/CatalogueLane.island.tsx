import type { JSX, RefObject } from "preact";
import { useComputed, useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import "../styles/catalogue.css";
import { Popover } from "@projective/ui/feedback";
import {
	LaneBar,
	LaneCollapseButton,
	LaneEmpty,
	LaneFooter,
	LaneFooterActions,
	LaneHead,
	LaneIconButton,
	LaneList,
	LaneSearch,
	LaneSection,
	LaneSections,
	LaneTabs,
	type LaneToggleOption,
	LaneToggleRow,
} from "@projective/ui/navigation";
import { SidebarToggleIcon } from "@web/features/shell/core/nav-icons.tsx";
import { MIDDLE_LANE_TOGGLE_EVENT } from "@web/utils/lane-events.ts";
import { CatalogueRail } from "../components/CatalogueRail.tsx";
import { CatalogueFilterPanel } from "../components/CatalogueFilterPanel.tsx";
import { ListingLaneRow } from "../components/ListingLaneRow.tsx";
import CatalogueCreateModal from "./CatalogueCreateModal.island.tsx";
import { openCreate } from "../core/catalogue-state.ts";
import { listingHref, segmentHref, STATUS_SECTIONS, TYPE_TABS } from "../core/catalogue-model.ts";
import {
	AlertIcon,
	BoxIcon,
	PlusIcon,
	SearchIcon,
	ServiceIcon,
	SlidersIcon,
	StarGlyph,
	TrendIcon,
} from "../components/catalogue-glyphs.tsx";
import type {
	CataloguePage,
	CatalogueTypeFilter,
	ListingStatus,
	ListingSummary,
	ServiceType,
} from "../types/catalogue-types.ts";
import { Icon } from "@projective/ui/icons";

/**
 * CatalogueLane — the `/catalogue` navigation lane. Like `ProjectSidebar`/`MessagesSidebar` it renders
 * BOTH presentations at once and lets CSS reveal exactly one via `.ui-splitter[data-mode="collapsed"]`:
 * an expanded stack (the primary `＋ New` popover CTA in the header · a `ui-lane-bar` search + Filter
 * popover · subtle `ui-lane-toggles` icon rows for the type switch and quick filters · the status-section
 * accordion) and a collapsed {@link CatalogueRail}. Chrome is composed entirely from the shared
 * `@projective/ui/navigation` lane primitives — so this lane, the `/projects` sidebar, and the
 * `/messages` inbox render ONE control set; parity is structural.
 *
 * THIN: it paints from the SSR page (all statuses for the active `?type=` segment). The type switch is a
 * full navigation (so the console updates too), while the search, quick/model filters, and status
 * grouping are client-side narrows over the loaded set. It mounts the {@link CatalogueCreateModal}
 * (driven by the shared `catalogue-state` signals so the console empty-state can open it too).
 */

// #region Props + constants
export interface CatalogueLaneProps {
	initial: CataloguePage;
	type: CatalogueTypeFilter;
	seller: boolean;
	path: string;
}

const QUICK_TOGGLES: readonly LaneToggleOption<QuickKey>[] = [
	{ key: "attention", label: "Needs attention", icon: <AlertIcon /> },
	{ key: "promoted", label: "Promoted", icon: <StarGlyph /> },
	{ key: "bestSelling", label: "Best-selling", icon: <TrendIcon /> },
];
type QuickKey = "attention" | "promoted" | "bestSelling";
// #endregion

/** The active listing id from the pathname (`/catalogue/{id}`), or null. */
function listingIdFromPath(path: string): string | null {
	const segs = path.split("/").filter(Boolean);
	return segs[0] === "catalogue" && segs.length >= 2 ? segs[1] : null;
}

export default function CatalogueLane(props: CatalogueLaneProps): JSX.Element {
	const activeId = listingIdFromPath(props.path);

	// #region State
	const listings = useSignal<ListingSummary[]>(props.initial.items);
	const collapsed = useSignal(false);
	const query = useSignal("");
	const attention = useSignal(false);
	const promoted = useSignal(false);
	const bestSelling = useSignal(false);
	const models = useSignal<ServiceType[]>([]);
	const createOpen = useSignal(false);
	const filterOpen = useSignal(false);
	// Published + Drafts open by default; Paused/Archived collapsed.
	const open = useSignal<Record<ListingStatus, boolean>>({
		published: true,
		draft: true,
		paused: false,
		archived: false,
	});
	// #endregion

	// Seed the collapse toggle from the splitter's persisted density (matches the other lanes).
	useEffect(() => {
		try {
			const el = globalThis.document?.querySelector(".ui-splitter");
			collapsed.value = (el as HTMLElement | null)?.dataset.mode === "collapsed";
		} catch { /* no DOM — non-fatal */ }
	}, []);

	// #region Derived (apply search + quick + model filters → group by status)
	const filtered = useComputed<ListingSummary[]>(() => {
		const ms = new Set(models.value);
		const q = query.value.trim().toLowerCase();
		return listings.value.filter((l) => {
			if (q && !l.title.toLowerCase().includes(q)) return false;
			if (attention.value && !l.needsAttention) return false;
			if (promoted.value && !l.promoted) return false;
			if (bestSelling.value && l.metrics.orders <= 0) return false;
			if (ms.size > 0 && (l.kind !== "service" || !l.serviceType || !ms.has(l.serviceType))) {
				return false;
			}
			return true;
		});
	});

	const grouped = useComputed<Record<ListingStatus, ListingSummary[]>>(() => {
		const g: Record<ListingStatus, ListingSummary[]> = {
			published: [],
			draft: [],
			paused: [],
			archived: [],
		};
		for (const l of filtered.value) g[l.status].push(l);
		return g;
	});

	const activeQuick = useComputed<QuickKey[]>(() => {
		const keys: QuickKey[] = [];
		if (attention.value) keys.push("attention");
		if (promoted.value) keys.push("promoted");
		if (bestSelling.value) keys.push("bestSelling");
		return keys;
	});
	// #endregion

	function onQuick(key: QuickKey): void {
		if (key === "attention") attention.value = !attention.value;
		else if (key === "promoted") promoted.value = !promoted.value;
		else bestSelling.value = !bestSelling.value;
	}

	function toggleModel(m: ServiceType): void {
		const set = new Set(models.value);
		set.has(m) ? set.delete(m) : set.add(m);
		models.value = [...set];
	}

	/** The type switch is a real navigation — the console body is scoped by the same `?type=`. */
	function onSelectType(type: CatalogueTypeFilter): void {
		try {
			globalThis.location.assign(segmentHref(type));
		} catch { /* SSR / no window — non-fatal */ }
	}

	function setLaneCollapsed(next: boolean): void {
		collapsed.value = next;
		try {
			globalThis.dispatchEvent(
				new CustomEvent(MIDDLE_LANE_TOGGLE_EVENT, { detail: { collapsed: next } }),
			);
		} catch { /* SSR / no window — non-fatal */ }
	}

	const totalShown = filtered.value.length;

	return (
		<div class="cat-lane">
			{/* Collapsed rail — CSS reveals it only at the narrow density. */}
			<CatalogueRail
				recent={listings.value.slice(0, 8)}
				activeId={activeId}
				onNew={() => openCreate()}
				onExpand={() => setLaneCollapsed(false)}
			/>

			{/* Expanded stack. */}
			<div class="cat-lane__full">
				<LaneHead>
					{
						/*
						 * The type switch at the very peak of the lane, the position `/projects` gives its
						 * Projects | Services strip. It NAVIGATES rather than filtering in place: `?type=` also
						 * scopes the console body, and the two roots can only agree on the address.
						 */
					}
					<LaneTabs<CatalogueTypeFilter>
						label="Catalogue type"
						value={props.type}
						options={TYPE_TABS}
						onSelect={onSelectType}
					/>

					<LaneBar>
						<LaneSearch
							value={query.value}
							placeholder="Search listings"
							label="Search listings"
							icon={<SearchIcon size={16} />}
							onInput={(v) => (query.value = v)}
						/>

						<Popover
							open={filterOpen}
							placement="bottom-end"
							avoid={[".ui-app-shell__sidebar"]}
							allowOverflow={["bottom"]}
							class="cat-filter-pop"
							trigger={(api) => (
								<LaneIconButton
									triggerRef={api.ref as RefObject<HTMLElement>}
									icon={<SlidersIcon />}
									label={models.value.length > 0
										? `Filters (${models.value.length} active)`
										: "Filters"}
									tooltip="Filters"
									active={models.value.length > 0}
									dot={models.value.length > 0}
									ariaHasPopup="dialog"
									ariaExpanded={api.expanded}
									ariaControls={api.panelId}
									onClick={api.toggle}
								/>
							)}
						>
							<CatalogueFilterPanel
								type={props.type}
								models={models.value}
								onToggleModel={toggleModel}
								onReset={() => (models.value = [])}
							/>
						</Popover>
					</LaneBar>

					<LaneToggleRow
						label="Quick filters"
						options={QUICK_TOGGLES}
						active={activeQuick.value}
						onToggle={onQuick}
					/>
				</LaneHead>

				<LaneList label="Listings">
					{totalShown === 0
						? (
							<LaneEmpty
								title="No listings match"
								note="Try clearing a filter, or create your first listing."
							/>
						)
						: (
							<LaneSections>
								{STATUS_SECTIONS.map((s) => {
									const rows = grouped.value[s.status];
									if (rows.length === 0) return null;
									return (
										<LaneSection
											key={s.status}
											id={`cat-${s.status}`}
											icon={<StatusDot status={s.status} />}
											label={s.label}
											open={open.value[s.status]}
											onToggle={() => (open.value = {
												...open.value,
												[s.status]: !open.value[s.status],
											})}
											hasUnread={s.status === "draft" && rows.some((r) => r.needsAttention)}
										>
											{rows.map((l) => (
												<ListingLaneRow
													key={l.id}
													listing={l}
													href={listingHref(l.id)}
													active={activeId === l.id}
												/>
											))}
										</LaneSection>
									);
								})}
							</LaneSections>
						)}
				</LaneList>

				<LaneFooter>
					<LaneCollapseButton
						collapsed={collapsed.value}
						icon={<SidebarToggleIcon />}
						onToggle={() => setLaneCollapsed(!collapsed.value)}
					/>

					<LaneFooterActions>
						<Popover
							open={createOpen}
							placement="top-end"
							avoid={[".ui-app-shell__sidebar"]}
							allowOverflow={["top"]}
							class="cat-newmenu-pop"
							trigger={(api) => (
								<button
									type="button"
									ref={api.ref as RefObject<HTMLButtonElement>}
									class="cat-lane__newbtn"
									aria-haspopup="menu"
									aria-expanded={api.expanded}
									aria-controls={api.panelId}
									onClick={api.toggle}
								>
									<span class="cat-lane__newicon" aria-hidden="true">
										<PlusIcon size={18} />
									</span>
									<span class="cat-lane__newlabel">New listing</span>
									<Icon name="chevron-down" class="cat-lane__newcaret" />
								</button>
							)}
						>
							<div class="cat-newmenu" role="menu">
								<button
									type="button"
									role="menuitem"
									class="cat-newmenu__item"
									onClick={() => {
										createOpen.value = false;
										openCreate("product");
									}}
								>
									<BoxIcon size={18} /> New product
								</button>
								<button
									type="button"
									role="menuitem"
									class="cat-newmenu__item"
									onClick={() => {
										createOpen.value = false;
										openCreate("service", "One-Off");
									}}
								>
									<ServiceIcon size={18} /> New service
								</button>
							</div>
						</Popover>
					</LaneFooterActions>
				</LaneFooter>
			</div>

			<CatalogueCreateModal />
		</div>
	);
}

// #region Local bits
/** A small tonal dot glyph for a status section header. */
function StatusDot({ status }: { status: ListingStatus }): JSX.Element {
	return <span class="cat-secdot" data-status={status} aria-hidden="true" />;
}
// #endregion
