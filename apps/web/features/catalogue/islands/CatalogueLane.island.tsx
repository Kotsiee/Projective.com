import type { JSX } from "preact";
import { useComputed, useSignal, useSignalEffect } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import "../styles/lane.css";
import { Skeleton } from "@projective/ui/feedback";
import { Icon, type IconName } from "@projective/ui/icons";
import {
	LaneBar,
	LaneCollapseButton,
	LaneCreateMenu,
	type LaneCreateMenuItem,
	LaneEmpty,
	LaneFooter,
	LaneFooterActions,
	LaneHead,
	LaneList,
	LaneSearch,
	LaneSection,
	LaneSections,
	type LaneToggleOption,
	LaneToggleRow,
} from "@projective/ui/navigation";
import { SidebarToggleIcon } from "@web/features/shell/core/nav-icons.tsx";
import { MIDDLE_LANE_TOGGLE_EVENT } from "@web/utils/lane-events.ts";
import { CookieKeys, readStored, SessionKeys, writeStored } from "@web/utils/storage-keys.ts";
import { CatalogueRail } from "../components/CatalogueRail.tsx";
import {
	CatalogueFilterPopover,
	HIGHLIGHT_FILTERS,
	STATUS_FILTERS,
} from "../components/CatalogueFilterPopover.tsx";
import { ListingLaneRow } from "../components/ListingLaneRow.tsx";
import { listingHref } from "../core/catalogue-model.ts";
import { CatalogueService } from "../core/CatalogueService.ts";
import { reloadListings } from "../core/console-actions.ts";
import {
	consoleReady,
	consoleUrl,
	listingsBusy,
	listingsPage,
	listParamsOf,
	listQueryKey,
	mergeConsoleUrl,
	openCreate,
	searchDraft,
	setConsoleUrl,
	setSearch,
	startConsoleSync,
} from "../core/console-store.ts";
import {
	activeFilterCount,
	type CatalogueLaneMemory,
	type LaneListingsRead,
	laneReadOf,
	OWN_SECTION,
	serializeLaneMemory,
	teamSection,
	toggleHighlight,
	toggleStatus,
	visibleTeams,
} from "../core/lane-model.ts";
import {
	catalogueBase,
	type CatalogueKind,
	type ConsoleHighlight,
	consoleHref,
	type ConsoleUrlState,
	type ListingStatus,
} from "../types/catalogue-types.ts";

/**
 * CatalogueLane — the one `/catalogue` and `/catalogue/[id]` lane, on the `/projects` lane's
 * anatomy: a head of search, the shared Filter popover and an icon quick bar (Status ⟷
 * Highlights); a body of collapsible sections, Your listings first and then one per team the viewer
 * may sell for; a footer of the collapse toggle and New listing.
 *
 * The two routes differ only in where the filter lives. On `/catalogue` it IS the console's URL
 * state, so the lane, the canvas and a shared link agree, and Your listings is the console's own
 * read. On `/catalogue/[id]` the lane keeps it locally and reads `/api/catalogue/list` itself. Both
 * write the lane memory cookie (`lane-model.ts`), so the server paints the next page's lane with the
 * same filter, team choice and open sections; the list's scroll offset rides in session storage.
 */

// #region Props
/** A team the viewer may sell for, as the lane names it. */
export interface LaneTeam {
	handle: string;
	name: string;
}

/** Props for {@link CatalogueLane}. */
export interface CatalogueLaneProps {
	/** `console` on `/catalogue`, `outline` on `/catalogue/[id]`. */
	mode: "console" | "outline";
	/** The lane's filter: the address on `/catalogue`, the remembered one on `/catalogue/[id]`. */
	filter: ConsoleUrlState;
	/** Your listings under that filter. */
	own: LaneListingsRead;
	/** The listing the page renders, marked in its row. */
	activeId: string | null;
	teams: LaneTeam[];
	/** The open team sections the server read, by handle. */
	teamReads: Record<string, LaneListingsRead>;
	/** The team sections chosen in the filter popover; empty shows every team. */
	selectedTeams: string[];
	/** The open sections ({@link OWN_SECTION}, {@link teamSection}). */
	open: string[];
}

interface TeamState {
	key: string;
	read: LaneListingsRead | null;
	busy: boolean;
}
// #endregion

const RAIL_RECENT = 8;
const SEARCH_DEBOUNCE_MS = 260;
const MEMORY_MAX_AGE = 60 * 60 * 24 * 180;
const SKELETON_ROWS = 3;

const STATUS_TOGGLES: readonly LaneToggleOption<ListingStatus>[] = STATUS_FILTERS.map((o) => ({
	key: o.value,
	label: o.label,
	icon: o.icon,
}));

const HIGHLIGHT_TOGGLES: readonly LaneToggleOption<ConsoleHighlight>[] = HIGHLIGHT_FILTERS.map((
	o,
) => ({ key: o.value, label: o.label, icon: o.icon }));

function writeLaneMemory(memory: CatalogueLaneMemory): void {
	document.cookie = `${CookieKeys.CATALOGUE_LANE}=${
		encodeURIComponent(serializeLaneMemory(memory))
	}; path=/catalogue; max-age=${MEMORY_MAX_AGE}; samesite=lax`;
}

export default function CatalogueLane(props: CatalogueLaneProps): JSX.Element {
	const onConsole = props.mode === "console";
	const collapsed = useSignal(false);
	const menuOpen = useSignal(false);
	const local = useSignal<ConsoleUrlState>(props.filter);
	const draft = useSignal(props.filter.search);
	const ownRead = useSignal<LaneListingsRead>(props.own);
	const ownBusy = useSignal(false);
	const open = useSignal<string[]>(props.open);
	const chosen = useSignal<string[]>(props.selectedTeams);
	const teamStates = useSignal<Record<string, TeamState>>(
		Object.fromEntries(
			Object.entries(props.teamReads).map((
				[handle, read],
			) => [handle, { key: listQueryKey(props.filter), read, busy: false }]),
		),
	);

	const rootRef = useRef<HTMLDivElement>(null);
	const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const settleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const lastBase = useRef(listQueryKey({ ...props.filter, search: "" }));
	const ownKey = useRef(listQueryKey(props.filter));
	const ownSeq = useRef(0);

	const filter = useComputed<ConsoleUrlState>(() =>
		onConsole ? (consoleReady.value ? consoleUrl.value : props.filter) : local.value
	);

	// #region Reads
	async function loadOwn(state: ConsoleUrlState, key: string): Promise<void> {
		ownKey.current = key;
		const seq = ++ownSeq.current;
		ownBusy.value = true;
		const res = await CatalogueService.list(listParamsOf(state));
		if (seq !== ownSeq.current) return;
		ownBusy.value = false;
		ownRead.value = res.ok && res.data
			? laneReadOf(res.data.page)
			: { ok: false, message: res.message ?? "We couldn't load your listings just now." };
	}

	async function loadTeam(handle: string, state: ConsoleUrlState, key: string): Promise<void> {
		const prior = teamStates.peek()[handle]?.read ?? null;
		teamStates.value = { ...teamStates.peek(), [handle]: { key, read: prior, busy: true } };
		const res = await CatalogueService.list(listParamsOf(state), handle);
		if (teamStates.peek()[handle]?.key !== key) return;
		const read: LaneListingsRead = res.ok && res.data
			? laneReadOf(res.data.page)
			: { ok: false, message: res.message ?? "We couldn't load this team's listings just now." };
		teamStates.value = { ...teamStates.peek(), [handle]: { key, read, busy: false } };
	}

	function refresh(state: ConsoleUrlState, force = false): void {
		const key = listQueryKey(state);
		if (!onConsole && (force || ownKey.current !== key)) void loadOwn(state, key);
		for (const team of visibleTeams(props.teams, chosen.peek())) {
			if (!open.peek().includes(teamSection(team.handle))) continue;
			const current = teamStates.peek()[team.handle];
			if (!force && current?.key === key) continue;
			void loadTeam(team.handle, state, key);
		}
	}

	useSignalEffect(() => {
		const state = filter.value;
		const base = listQueryKey({ ...state, search: "" });
		const typing = base === lastBase.current;
		lastBase.current = base;
		if (settleTimer.current) clearTimeout(settleTimer.current);
		if (typing) settleTimer.current = setTimeout(() => refresh(state), SEARCH_DEBOUNCE_MS);
		else refresh(state);
	});

	useSignalEffect(() => {
		open.value;
		chosen.value;
		refresh(filter.peek());
	});

	useSignalEffect(() => {
		writeLaneMemory({ filter: filter.value, teams: chosen.value, open: open.value });
	});
	// #endregion

	// #region Mount: console sync, lane density, scroll position
	useEffect(() => {
		if (onConsole) startConsoleSync();
		const splitter = globalThis.document?.querySelector<HTMLElement>(".ui-splitter");
		collapsed.value = splitter?.dataset.mode === "collapsed";

		const list = rootRef.current?.querySelector<HTMLElement>(".ui-lane-list");
		if (!list) return;
		const restore = () => {
			const saved = Number(readStored("session", SessionKeys.CATALOGUE_LANE_SCROLL));
			if (saved > 0) list.scrollTop = saved;
		};
		restore();
		if (document.readyState !== "complete") globalThis.addEventListener("load", restore, { once: true });
		let frame = 0;
		const onScroll = () => {
			if (frame) return;
			frame = requestAnimationFrame(() => {
				frame = 0;
				writeStored("session", SessionKeys.CATALOGUE_LANE_SCROLL, String(Math.round(list.scrollTop)));
			});
		};
		list.addEventListener("scroll", onScroll, { passive: true });
		return () => {
			list.removeEventListener("scroll", onScroll);
			globalThis.removeEventListener("load", restore);
			cancelAnimationFrame(frame);
		};
	}, []);
	// #endregion

	// #region Actions
	function setFilter(patch: Partial<ConsoleUrlState>): void {
		if (onConsole) setConsoleUrl(patch);
		else local.value = mergeConsoleUrl(local.peek(), patch);
	}

	function onSearch(value: string): void {
		if (onConsole) {
			setSearch(value);
			return;
		}
		draft.value = value;
		if (searchTimer.current) clearTimeout(searchTimer.current);
		searchTimer.current = setTimeout(() => setFilter({ search: value }), SEARCH_DEBOUNCE_MS);
	}

	function toggleSection(key: string): void {
		open.value = open.peek().includes(key)
			? open.peek().filter((k) => k !== key)
			: [...open.peek(), key];
	}

	function onCollapse(next: boolean): void {
		collapsed.value = next;
		globalThis.dispatchEvent(
			new CustomEvent(MIDDLE_LANE_TOGGLE_EVENT, { detail: { collapsed: next } }),
		);
	}
	// #endregion

	const state = filter.value;
	const page = onConsole ? listingsPage.value : null;
	const own = page ? laneReadOf(page) : onConsole ? props.own : ownRead.value;
	const busy = onConsole ? listingsBusy.value : ownBusy.value;
	const shownTeams = visibleTeams(props.teams, chosen.value);
	const narrowed = activeFilterCount(state) > 0 || state.search !== "" || state.type !== "all";
	const recent = own.ok ? own.items.slice(0, RAIL_RECENT) : [];

	return (
		<div class="cat-lane" ref={rootRef}>
			<CatalogueRail
				recent={recent}
				activeId={props.activeId}
				newHref={onConsole ? undefined : consoleHref({ createOpen: true })}
				onNew={onConsole ? () => openCreate() : undefined}
				onExpand={() => onCollapse(false)}
			/>

			<div class="cat-lane__full">
				<LaneHead>
					<LaneBar>
						<LaneSearch
							value={onConsole ? (consoleReady.value ? searchDraft.value : state.search) : draft.value}
							placeholder="Search listings"
							label="Search listings"
							icon={<Icon name="search" />}
							onInput={onSearch}
						/>
						<CatalogueFilterPopover
							state={state}
							onChange={setFilter}
							teams={{
								options: props.teams.map((t) => ({ id: t.handle, label: t.name })),
								selected: chosen.value,
								onChange: (handles) => (chosen.value = handles),
							}}
						/>
					</LaneBar>
					<LaneToggleRow
						label="Status"
						options={STATUS_TOGGLES}
						active={state.status}
						onToggle={(s) => setFilter({ status: toggleStatus(state.status, s) })}
						trailing={{
							label: "Highlights",
							options: HIGHLIGHT_TOGGLES,
							active: state.highlights,
							onToggle: (h) => setFilter({ highlights: toggleHighlight(state.highlights, h) }),
						}}
					/>
				</LaneHead>

				<LaneList label="Listings" busy={busy}>
					<LaneSections>
						<LaneSection
							id="cat-lane-own"
							icon={<Icon name="catalogue" />}
							label="Your listings"
							href={consoleHref({})}
							current={onConsole}
							toggleLabel="Your listings contents"
							open={open.value.includes(OWN_SECTION)}
							onToggle={() => toggleSection(OWN_SECTION)}
						>
							<SectionRows
								read={own}
								activeId={props.activeId}
								hrefOf={(id) => listingHref(id)}
								viewAllHref={consoleHref(state)}
								narrowed={narrowed}
								onRetry={() => (onConsole ? void reloadListings() : refresh(state, true))}
							/>
						</LaneSection>

						{shownTeams.map((team) => {
							const key = teamSection(team.handle);
							const entry = teamStates.value[team.handle];
							return (
								<LaneSection
									key={team.handle}
									id={`cat-lane-team-${team.handle}`}
									icon={<Icon name="members" />}
									label={`${team.name} listings`}
									href={catalogueBase(team.handle)}
									toggleLabel={`${team.name} listings contents`}
									open={open.value.includes(key)}
									onToggle={() => toggleSection(key)}
								>
									<SectionRows
										read={entry?.read ?? null}
										activeId={null}
										hrefOf={(id) => listingHref(id, team.handle)}
										viewAllHref={consoleHref({ ...state, team: team.handle })}
										narrowed={narrowed}
										onRetry={() => void loadTeam(team.handle, state, listQueryKey(state))}
									/>
								</LaneSection>
							);
						})}
					</LaneSections>
				</LaneList>

				<LaneFooter>
					<LaneCollapseButton
						collapsed={collapsed.value}
						icon={<SidebarToggleIcon />}
						onToggle={() => onCollapse(!collapsed.value)}
					/>
					<LaneFooterActions>
						<LaneCreateMenu
							open={menuOpen}
							label="New listing"
							icon={<Icon name="plus" />}
							items={newListingItems(onConsole)}
						/>
					</LaneFooterActions>
				</LaneFooter>
			</div>
		</div>
	);
}

// #region Section rows
interface SectionRowsProps {
	/** `null` while the first read is in flight. */
	read: LaneListingsRead | null;
	activeId: string | null;
	hrefOf: (id: string) => string;
	viewAllHref: string;
	narrowed: boolean;
	onRetry: () => void;
}

function SectionRows(props: SectionRowsProps): JSX.Element {
	const { read } = props;
	if (!read) {
		return (
			<div class="cat-lane__loading" role="status" aria-label="Loading listings">
				{Array.from({ length: SKELETON_ROWS }, (_, i) => (
					<span key={i} class="cat-lane__skeleton">
						<Skeleton shape="circle" width="1.75rem" />
						<Skeleton shape="text" width={`${70 - i * 12}%`} height="1em" />
					</span>
				))}
			</div>
		);
	}
	if (!read.ok) {
		return (
			<div class="cat-lane__error" role="alert">
				<p class="cat-lane__error-text">{read.message}</p>
				<button type="button" class="cat-lane__retry" onClick={props.onRetry}>Try again</button>
			</div>
		);
	}
	if (read.items.length === 0) {
		return (
			<LaneEmpty
				title={props.narrowed ? "No listings match" : "No listings yet"}
				note={props.narrowed ? "Try clearing a filter." : undefined}
			/>
		);
	}
	return (
		<>
			{read.items.map((l) => (
				<ListingLaneRow
					key={l.id}
					listing={l}
					href={props.hrefOf(l.id)}
					active={l.id === props.activeId}
				/>
			))}
			{read.total > read.items.length && (
				<a class="cat-lane__more" href={props.viewAllHref}>
					View all {read.total.toLocaleString("en-US")} listings
				</a>
			)}
		</>
	);
}
// #endregion

// #region Quick create
const CREATE_KINDS: readonly { kind: CatalogueKind; label: string; icon: IconName }[] = [
	{ kind: "product", label: "New product", icon: "box" },
	{ kind: "service", label: "New service", icon: "service" },
];

function newListingItems(onConsole: boolean): LaneCreateMenuItem[] {
	return CREATE_KINDS.map(({ kind, label, icon }) => ({
		key: kind,
		label,
		icon: <Icon name={icon} size="md" />,
		...(onConsole
			? { onSelect: () => openCreate(kind) }
			: { href: consoleHref({ createOpen: true, createKind: kind }) }),
	}));
}
// #endregion
