import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import type { JSX, RefObject } from "preact";
import "../styles/projects-lane.css";
import { Popover } from "@projective/ui/feedback";
import { ProjectCard } from "../components/ProjectCard.tsx";
import { LaneTabs } from "../components/LaneTabs.tsx";
import { ServiceModifier } from "../components/ServiceModifier.tsx";
import { UtilityShortcuts } from "../components/UtilityShortcuts.tsx";
import { IncomingRequests } from "../components/IncomingRequests.tsx";
import { FilterPanel } from "../components/FilterPanel.tsx";
import { CreateMenu } from "../components/CreateMenu.tsx";
import { PlusIcon, SearchIcon, SlidersIcon } from "../components/glyphs.tsx";
import { SidebarToggleIcon } from "@web/features/shell/core/nav-icons.tsx";
import { MIDDLE_LANE_TOGGLE_EVENT } from "@web/utils/lane-events.ts";
import { ProjectSidebarService } from "../core/ProjectSidebarService.ts";
import { readCachedParams, writeCachedParams } from "../core/filter-cache.ts";
import {
	DEFAULT_PROJECT_PARAMS,
	popoverActiveCount,
	serializeProjectParams,
	toSearchParams,
} from "../core/projects-state.ts";
import type { ProjectFeedParams } from "../core/projects-state.ts";
import type {
	ProjectFeedPayload,
	ProjectQuickFilter,
	ProjectSummary,
	ProjectView,
} from "../types/projects-types.ts";

/**
 * ProjectsLane — the spacious, tactile `/projects` middle-nav feed. THIN: no query logic — first
 * paint comes from the SSR `initial` {@link ProjectFeedPayload}, and every refinement is fetched from
 * `/api/projects/*` via the dumb {@link ProjectSidebarService}; the fat `ProjectBackendService` owns
 * filtering/sorting/grouping.
 *
 * The header is deliberately calm: friendly `Projects | Services` tabs at the peak, then a growing
 * search with a single Filter action (the heavy facet surface lives in a glassmorphic Smart Filter
 * popover, so the list keeps its breathing room). A permanent service-queue modifier appears on the
 * Services tab; the permanent involvement quick-filter row (Starred · Unread · New tickets · Revision
 * requested · Pending review · All my involvement) sits just above the cards. A **sticky sidebar
 * footer** carries the incoming-request toggles, the Create action, and a lane collapse/expand toggle
 * (dispatched to the shell splitter via {@link MIDDLE_LANE_TOGGLE_EVENT}). Applied filters are cached
 * per context id (the Continuity rule).
 */

const SEARCH_DEBOUNCE_MS = 220;

/**
 * Higher-level layout zones the lane's `bottom-end` menus must never slide under. The 19rem Smart
 * Filter panel, right-aligned to a trigger near the far edge of the ~280px middle-nav lane, otherwise
 * clamps only to the viewport and overlaps the primary site sidebar. Passed to the {@link Popover}
 * edge-detection so the panel shifts right, clearing the rail; re-measured live, so a
 * collapsed/expanded sidebar stays honoured.
 */
const SHELL_AVOID = [".ui-app-shell__sidebar"] as const;

export interface ProjectsLaneProps {
	/** SSR-resolved initial query. */
	initialParams: ProjectFeedParams;
	/** SSR-resolved first page of the feed. */
	initial: ProjectFeedPayload;
	/** The actor's active context id — the cache partition key. */
	activeContextId: string;
	/** Human label of the active context. */
	activeContextLabel: string;
	/** Pathname at SSR — seeds the focused-card highlight. */
	path: string;
}

export default function ProjectsLane(props: ProjectsLaneProps): JSX.Element {
	const params = useSignal<ProjectFeedParams>(props.initialParams);
	const payload = useSignal<ProjectFeedPayload>(props.initial);
	const queryText = useSignal<string>(props.initialParams.q);
	const loading = useSignal<boolean>(false);
	const currentPath = useSignal<string>(props.path);
	const createOpen = useSignal<boolean>(false);
	const filterOpen = useSignal<boolean>(false);
	const collapsed = useSignal<boolean>(false);

	const debounce = useRef<number | undefined>(undefined);
	const reqId = useRef<number>(0);

	/** Fetch a param set, guarding against out-of-order responses, and cache it by context. */
	async function run(next: ProjectFeedParams): Promise<void> {
		params.value = next;
		writeCachedParams(props.activeContextId, next);
		const token = ++reqId.current;
		loading.value = true;
		const res = await ProjectSidebarService.list(next);
		if (token !== reqId.current) return; // a newer request superseded this one
		if (res.ok && res.data) payload.value = res.data;
		loading.value = false;
	}

	/** Apply a param change: sync the URL (shareable) then fetch. */
	function apply(next: ProjectFeedParams): void {
		const path = serializeProjectParams(next);
		try {
			globalThis.history?.replaceState(null, "", path);
			currentPath.value = globalThis.location?.pathname ?? currentPath.value;
		} catch { /* SSR / history unavailable — non-fatal */ }
		void run(next);
	}

	// Continuity: on a bare `/projects` (no query), restore this context's last-applied filters.
	useEffect(() => {
		const bare = toSearchParams(props.initialParams).toString() === "";
		if (!bare) return;
		const cached = readCachedParams(props.activeContextId);
		if (cached && toSearchParams(cached).toString() !== "") {
			queryText.value = cached.q;
			apply(cached);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Seed the collapse toggle's state from the splitter's persisted density so the icon matches on load.
	useEffect(() => {
		try {
			const el = globalThis.document?.querySelector(".ui-splitter");
			collapsed.value = (el as HTMLElement | null)?.dataset.mode === "collapsed";
		} catch { /* no DOM — non-fatal */ }
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	function onSearch(value: string): void {
		queryText.value = value;
		if (debounce.current) clearTimeout(debounce.current);
		debounce.current = setTimeout(
			() => apply({ ...params.value, q: value.trim() }),
			SEARCH_DEBOUNCE_MS,
		);
	}

	function onSelectView(view: ProjectView): void {
		apply({ ...params.value, view });
	}

	function onQuick(key: ProjectQuickFilter): void {
		const cur = params.value.quick;
		const quick = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
		apply({ ...params.value, quick });
	}

	/** The footer Incoming toggle: show every inbound request awaiting acceptance, or clear back. */
	function onToggleIncoming(): void {
		const on = params.value.requests.length > 0;
		apply({ ...params.value, requests: on ? [] : ["client_invite", "service_request"] });
	}

	/** Collapse/expand the whole middle-nav lane — mirrors the main-nav rail toggle via the splitter. */
	function onToggleCollapse(): void {
		const next = !collapsed.value;
		collapsed.value = next;
		try {
			globalThis.dispatchEvent(
				new CustomEvent(MIDDLE_LANE_TOGGLE_EVENT, { detail: { collapsed: next } }),
			);
		} catch { /* SSR / no window — non-fatal */ }
	}

	function onToggleGlobal(): void {
		apply(
			params.value.scope === "global"
				? { ...params.value, scope: "context" }
				: { ...params.value, scope: "global" },
		);
	}

	function onServiceQueue(serviceId: string): void {
		apply({ ...params.value, serviceId });
	}

	function onToggleStar(id: string): void {
		// Optimistic UI flip; real persistence lands with the live backend (fixtures are immutable).
		const flip = (rows: ProjectSummary[]) =>
			rows.map((r) => (r.id === id ? { ...r, starred: !r.starred } : r));
		payload.value = { ...payload.value, items: flip(payload.value.items) };
	}

	function onMenuAction(_id: string, _action: string): void {
		// Report / Leave / Delete need the live backend + confirmation surfaces; wired dumb for now so
		// the menu is fully navigable (open-in-new-tab and share resolve client-side inside the card).
	}

	function resetFilters(): void {
		queryText.value = "";
		// Reset every filter but keep the active view tab.
		apply({ ...DEFAULT_PROJECT_PARAMS, view: params.value.view });
	}

	function openCreate(kind: string): void {
		createOpen.value = false;
		try {
			globalThis.location.assign(`/projects/create?type=${encodeURIComponent(kind)}`);
		} catch { /* no-op */ }
	}

	const feed = payload.value;
	const active = params.value;
	const isServices = active.view === "engagements";
	const filterCount = popoverActiveCount(active);
	const isActiveCard = (slug: string) => currentPath.value === `/projects/${slug}`;

	return (
		<div class="proj-lane" data-loading={loading.value ? "true" : undefined}>
			<div class="proj-lane__top">
				<LaneTabs view={active.view} onSelect={onSelectView} />

				<div class="proj-lane__bar">
					<div class="proj-lane__search">
						<span class="proj-lane__search-icon" aria-hidden="true">{SearchIcon}</span>
						<input
							class="proj-lane__search-input"
							type="search"
							placeholder={isServices ? "Search services & clients" : "Search projects"}
							aria-label="Search"
							value={queryText.value}
							onInput={(e) => onSearch((e.target as HTMLInputElement).value)}
						/>
					</div>

					<Popover
						open={filterOpen}
						placement="bottom-end"
						avoid={SHELL_AVOID}
						allowOverflow={["bottom"]}
						class="proj-filter-pop"
						trigger={(api) => (
							<button
								type="button"
								ref={api.ref as RefObject<HTMLButtonElement>}
								class="proj-iconbtn"
								data-on={filterCount > 0 ? "true" : undefined}
								aria-label={filterCount > 0 ? `Filters (${filterCount} active)` : "Filters"}
								aria-haspopup="dialog"
								aria-expanded={api.expanded}
								aria-controls={api.panelId}
								onClick={api.toggle}
							>
								{SlidersIcon}
								{filterCount > 0 && <span class="proj-iconbtn__dot" aria-hidden="true" />}
							</button>
						)}
					>
						<FilterPanel
							view={active.view}
							params={active}
							scopes={feed.scopes}
							services={feed.services}
							onApply={apply}
							onReset={resetFilters}
						/>
					</Popover>
				</div>

				{isServices && (
					<ServiceModifier
						services={feed.services}
						value={active.serviceId}
						onSelect={onServiceQueue}
					/>
				)}

				<UtilityShortcuts
					quick={active.quick}
					onToggleQuick={onQuick}
					global={active.scope === "global"}
					onToggleGlobal={onToggleGlobal}
				/>
			</div>

			<div class="proj-lane__list" aria-busy={loading.value ? "true" : undefined}>
				{feed.count === 0
					? (
						<div class="proj-lane__empty">
							<p class="proj-lane__empty-title">Nothing here yet</p>
							<p class="proj-lane__empty-note">
								{filterCount > 0 || active.scope === "global" || active.q
									? "Try clearing a filter or widening your scope."
									: isServices
									? "Services you deliver will appear here."
									: "Projects you own or contribute to will appear here."}
							</p>
						</div>
					)
					: feed.items.map((item) => (
						<ProjectCard
							key={item.id}
							item={item}
							active={isActiveCard(item.slug)}
							onToggleStar={onToggleStar}
							onMenuAction={onMenuAction}
						/>
					))}
			</div>

			<div class="proj-lane__footer">
				<button
					type="button"
					class="proj-lane__collapse"
					aria-label={collapsed.value ? "Expand lane" : "Collapse lane"}
					aria-pressed={collapsed.value}
					data-collapsed={collapsed.value ? "true" : undefined}
					onClick={onToggleCollapse}
				>
					<SidebarToggleIcon />
				</button>

				<div class="proj-lane__footer-actions">
					<IncomingRequests
						count={feed.incomingCount}
						active={active.requests.length > 0}
						onToggle={onToggleIncoming}
					/>

					<Popover
						open={createOpen}
						placement="top-end"
						avoid={SHELL_AVOID}
						allowOverflow={["top"]}
						class="proj-menu-pop"
						trigger={(api) => (
							<button
								type="button"
								ref={api.ref as RefObject<HTMLButtonElement>}
								class="proj-lane__create"
								aria-haspopup="menu"
								aria-expanded={api.expanded}
								aria-controls={api.panelId}
								onClick={api.toggle}
							>
								<span class="proj-lane__create-icon" aria-hidden="true">{PlusIcon}</span>
								<span class="proj-lane__create-label">
									{isServices ? "Create service" : "Create project"}
								</span>
							</button>
						)}
					>
						<CreateMenu view={active.view} onPick={openCreate} />
					</Popover>
				</div>
			</div>
		</div>
	);
}
