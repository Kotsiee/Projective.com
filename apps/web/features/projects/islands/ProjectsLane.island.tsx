import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import type { JSX, RefObject } from "preact";
import "../styles/projects-lane.css";
import { Popover } from "@projective/ui/feedback";
import { ProjectCard } from "../components/ProjectCard.tsx";
import { LaneTabs } from "../components/LaneTabs.tsx";
import { RoleToggle } from "../components/RoleToggle.tsx";
import { ServiceModifier } from "../components/ServiceModifier.tsx";
import { UtilityShortcuts } from "../components/UtilityShortcuts.tsx";
import { IncomingRequests } from "../components/IncomingRequests.tsx";
import { FilterPanel } from "../components/FilterPanel.tsx";
import { CreateMenu } from "../components/CreateMenu.tsx";
import { ProjectCreateModal } from "../components/ProjectCreateModal.tsx";
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
	ProjectCreateFormat,
	ProjectFeedPayload,
	ProjectInvolvement,
	ProjectQuickFilter,
	ProjectSummary,
	ProjectView,
	ScopeOption,
} from "../types/projects-types.ts";
import { IS_DEV } from "@web/utils/dev.ts";
import {
	type DevPersona,
	type DevSeamState,
	personaCanProvide,
	readDevSeam,
	subscribeDevSeam,
} from "@web/utils/dev-seam.ts";

/**
 * ProjectsLane — the spacious, tactile `/projects` middle-nav feed. THIN: no query logic — first
 * paint comes from the SSR `initial` {@link ProjectFeedPayload}, and every refinement is fetched from
 * `/api/projects/*` via the dumb {@link ProjectSidebarService}; the fat `ProjectBackendService` owns
 * filtering/sorting/grouping.
 *
 * The header is deliberately calm: friendly `Projects | Services` tabs at the peak (shown only for
 * accounts that can offer services — a client/business account has no Services side, so the tabs are
 * hidden and the feed stays on `projects`), then a growing search with a single Filter action (the
 * heavy facet surface lives in a glassmorphic Smart Filter popover, so the list keeps its breathing
 * room). A permanent service-queue modifier appears on the Services tab. Below sits the **involvement
 * row**: a prominent ownership toggle (All · Owner · Working — owner/client/admin vs. worker engagements)
 * paired with the permanent quick-filter shortcuts (Starred · Unread · New tickets · Revision requested
 * · Pending review). A **sticky sidebar footer** carries the incoming-request toggles, the Create
 * action, and a lane collapse/expand toggle (dispatched to the shell splitter via
 * {@link MIDDLE_LANE_TOGGLE_EVENT}). Applied filters are cached per context id (the Continuity rule).
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

/**
 * DEV-ONLY. The default feed scope/filtering a simulated {@link DevPersona} lands on — the "Initial
 * Project Scope & Filtering" rule the Dev Tools Context Switcher drives:
 *
 *  - **client**            → all available user projects (`involvement: all`, active context).
 *  - **business**          → scoped to the projects that business owns (`involvement: owner`, the
 *                            business workspace pinned as `scopeId`; the specific workspace is the
 *                            simulated `activeEntity` when it names one, else the first business scope).
 *  - **freelancer / team** → the freelancing context: active assignments (`involvement: worker`).
 *
 * Pure — no `IS_DEV` gate needed here (it is only ever reached from the `IS_DEV`-guarded seam effect,
 * so the whole path tree-shakes out of production).
 */
function personaDefaultParams(
	persona: DevPersona,
	scopes: readonly ScopeOption[],
	entity: string,
): ProjectFeedParams {
	const base = { ...DEFAULT_PROJECT_PARAMS };
	switch (persona) {
		case "business": {
			const named = entity ? scopes.find((s) => s.id === entity || s.handle === entity) : undefined;
			const biz = named ?? scopes.find((s) => s.type === "business");
			return {
				...base,
				view: "projects",
				involvement: "owner",
				scope: "context",
				scopeType: biz?.type ?? null,
				scopeId: biz?.id ?? "",
			};
		}
		case "freelancer":
		case "team":
			return { ...base, view: "projects", involvement: "worker" };
		case "client":
		default:
			return { ...base, view: "projects", involvement: "all" };
	}
}

export interface ProjectsLaneProps {
	/** SSR-resolved initial query. */
	initialParams: ProjectFeedParams;
	/** SSR-resolved first page of the feed. */
	initial: ProjectFeedPayload;
	/** The actor's active context id — the cache partition key. */
	activeContextId: string;
	/** Human label of the active context. */
	activeContextLabel: string;
	/**
	 * Whether the acting account can offer/deliver services (freelancer/seller capability). When
	 * `false` (a client/business account) the Projects/Services tab split is redundant — every
	 * engagement is a client-side project — so the tabs and the service-queue modifier are hidden and
	 * the feed stays pinned to the `projects` view.
	 */
	canOfferServices: boolean;
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
	const modalOpen = useSignal<boolean>(false);
	const modalFormat = useSignal<ProjectCreateFormat>("pipeline");
	/** DEV-ONLY. The active simulated persona (from the Dev Tools Context Switcher), or `null` for the
	 * real session. Drives the Projects/Services tabs + ownership toggle visibility. Always `null` in
	 * production (the seam is never written and `readDevSeam` returns `null`). */
	const devPersona = useSignal<DevPersona | null>(null);

	// `ReturnType<typeof setTimeout>` keeps this env-agnostic: the modal chain pulls Quill's types
	// (which include `@types/node`), so a browser `setTimeout` may type as `Timeout` here, not `number`.
	const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const reqId = useRef<number>(0);
	/** DEV-ONLY. The last-applied `persona|entity` seam key, so a mere ownership/role tweak doesn't
	 * needlessly re-scope the feed (only a persona or active-entity change does). */
	const devKey = useRef<string | null>(null);

	/**
	 * Fetch a param set, guarding against out-of-order responses, and (by default) cache it by context.
	 * `cache: false` is used for DEV persona-driven scopes so a simulated context never pollutes the
	 * real per-context filter cache (which would leak into a later real-session reload).
	 */
	async function run(next: ProjectFeedParams, cache = true): Promise<void> {
		params.value = next;
		if (cache) writeCachedParams(props.activeContextId, next);
		const token = ++reqId.current;
		loading.value = true;
		const res = await ProjectSidebarService.list(next);
		if (token !== reqId.current) return; // a newer request superseded this one
		if (res.ok && res.data) payload.value = res.data;
		loading.value = false;
	}

	/** Apply a param change: sync the URL (shareable) then fetch. */
	function apply(next: ProjectFeedParams, cache = true): void {
		const path = serializeProjectParams(next);
		try {
			globalThis.history?.replaceState(null, "", path);
			currentPath.value = globalThis.location?.pathname ?? currentPath.value;
		} catch { /* SSR / history unavailable — non-fatal */ }
		void run(next, cache);
	}

	// DEV-ONLY. Consume the Dev Tools Context Switcher persona: reflect the persona's capability into the
	// chrome (tabs / role toggle) and re-scope the feed to the persona's default view when the simulated
	// persona or active entity changes. Reverts to the real-context SSR params when the override is off.
	// The whole effect tree-shakes out of production (guarded by `IS_DEV`; the seam is never written).
	useEffect(() => {
		if (!IS_DEV) return;
		const keyOf = (s: DevSeamState | null) => (s?.enabled ? `${s.persona}|${s.entity}` : null);
		const applySeam = (s: DevSeamState | null) => {
			const key = keyOf(s);
			if (key === devKey.current) return; // ownership/role tweak only — no re-scope needed
			devKey.current = key;
			if (s?.enabled) {
				devPersona.value = s.persona;
				const next = personaDefaultParams(s.persona, payload.value.scopes, s.entity);
				queryText.value = next.q;
				apply(next, false); // dev-simulated scope: do not pollute the real filter cache
			} else {
				devPersona.value = null;
				queryText.value = props.initialParams.q;
				apply(props.initialParams, false);
			}
		};
		const initial = readDevSeam();
		devKey.current = keyOf(initial);
		if (initial?.enabled) {
			devPersona.value = initial.persona;
			const next = personaDefaultParams(initial.persona, payload.value.scopes, initial.entity);
			queryText.value = next.q;
			apply(next, false);
		}
		return subscribeDevSeam(applySeam);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Continuity: on a bare `/projects` (no query), restore this context's last-applied filters.
	useEffect(() => {
		// A live DEV persona owns the initial scope instead (see the seam effect above), so don't also
		// restore the real context's cached filters on top of it.
		if (IS_DEV && readDevSeam()?.enabled) return;
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

	/** Switch the ownership axis — owner/client/admin vs. worker/contributor engagements. */
	function onSelectInvolvement(involvement: ProjectInvolvement): void {
		apply({ ...params.value, involvement });
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
		// Reset every filter but keep the resting view controls (the view tab + ownership axis).
		apply({
			...DEFAULT_PROJECT_PARAMS,
			view: params.value.view,
			involvement: params.value.involvement,
		});
	}

	/**
	 * Launch the Project Creation Modal (replacing the retired `/projects/create` page). The picked
	 * menu kind seeds the modal's type toggle — `one_off` maps to the milestone flow, everything else
	 * (project / service) starts on Pipeline; Direct Deliverable is reachable via the in-modal toggle.
	 */
	function openCreate(kind: string): void {
		createOpen.value = false;
		modalFormat.value = kind === "one_off" ? "one_off" : "pipeline";
		modalOpen.value = true;
	}

	/** A drafted engagement — close the modal and route to its new detail sidebar. */
	function onCreated(slug: string): void {
		modalOpen.value = false;
		try {
			globalThis.location.assign(`/projects/${slug}`);
		} catch { /* no-op */ }
	}

	const feed = payload.value;
	const active = params.value;
	// Whether the acting account can offer/deliver services — from the SSR-resolved real context, OR the
	// DEV Context Switcher persona when one is simulated (freelancer/team can provide; client/business
	// cannot). Drives the Projects/Services tabs, the ownership role toggle, and the service-queue
	// modifier. In production `devPersona` is always `null`, so this is exactly `props.canOfferServices`.
	const canProvide = devPersona.value
		? personaCanProvide(devPersona.value)
		: props.canOfferServices;
	// The Services tab only exists for accounts that can deliver services; otherwise everything is a
	// client-side project (the view is pinned to `projects`).
	const isServices = canProvide && active.view === "engagements";
	const filterCount = popoverActiveCount(active);
	const isActiveCard = (slug: string) => currentPath.value === `/projects/${slug}`;

	return (
		<div class="proj-lane" data-loading={loading.value ? "true" : undefined}>
			<div class="proj-lane__top">
				{canProvide && <LaneTabs view={active.view} onSelect={onSelectView} />}

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

				<div class="proj-lane__involvement">
					{
						/* The ownership role toggle (owner-as-client vs. worker-as-contributor) is only
					    meaningful for accounts that both own and deliver work — freelancers & teams. A
					    client/business acts purely in an owner/client capacity, so it is hidden for them
					    (mirrors the Projects/Services tab rule). */
					}
					{canProvide && <RoleToggle value={active.involvement} onSelect={onSelectInvolvement} />}
					<UtilityShortcuts quick={active.quick} onToggleQuick={onQuick} />
				</div>
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

			<ProjectCreateModal
				open={modalOpen.value}
				initialFormat={modalFormat.value}
				view={active.view}
				scopeId={props.activeContextId}
				onClose={() => (modalOpen.value = false)}
				onCreated={onCreated}
			/>
		</div>
	);
}
