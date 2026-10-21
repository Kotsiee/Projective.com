import { z } from "zod";
import { ServiceType } from "../explore/items.ts";
import { CreateCategory } from "../org/standing.ts";
import { isSlug } from "../slugs/slug.ts";
import {
	WORKSPACE_HANDLE_MAX,
	WORKSPACE_HANDLE_MIN,
	WORKSPACE_HANDLE_PATTERN,
} from "../workspace/workspace.ts";
import { DeliveryModel, deliveryModelOf, EditSection, serviceTypeOf } from "./archetype.ts";
import {
	AnalyticsPeriod,
	CatalogueKind,
	CatalogueSort,
	CatalogueSortDir,
	CatalogueTypeFilter,
	defaultSortDir,
	ListingStatus,
} from "./catalogue.ts";

/**
 * catalogue.url — the URL contract for `/catalogue` (the console) and `/catalogue/[id]` (the item
 * workspace), plan §6.2, and for their team-scoped twins under `/teams/:handle/catalogue`
 * (Decision #312), which address one team's catalogue whatever context the viewer is acting in.
 *
 * Every screen state that matters lives in the URL, so a reload or a shared link restores the same
 * screen. The parsers are TOTAL: an unknown or malformed value falls back to its default and never
 * throws. The builders emit params in one canonical order and omit defaults, so one state has
 * exactly one href and `parse(href(x))` returns `x`. The team is part of the state ({@link
 * ConsoleUrlState.team}), read from the path, so every href built from a parsed state keeps it.
 *
 * Two params share the word "create" and must not be confused: `?category=` is the CREATE-category
 * facet ({@link ConsoleUrlState.create}); `?create=` opens the quick-create modal
 * ({@link ConsoleUrlState.createOpen}).
 */

// #region Vocabularies
/** The console canvas (`?view=`). */
export const ConsoleView = z.enum(["listings", "analytics", "clients"]);
export type ConsoleView = z.infer<typeof ConsoleView>;

/** The item workspace tab (`?tab=`). */
export const WorkspaceTab = z.enum(["edit", "preview", "analytics", "clients"]);
export type WorkspaceTab = z.infer<typeof WorkspaceTab>;

/** The Preview tab's device frame (`?device=`). */
export const PreviewDevice = z.enum(["desktop", "mobile"]);
export type PreviewDevice = z.infer<typeof PreviewDevice>;

/**
 * What the console's analytics and clients views cover (`?scope=`, Decision #217(l)). A listing slug
 * is deliberately NOT a scope: per-item analytics and clients have one home, the workspace
 * ({@link scopeRedirect}).
 */
export const ConsoleScope = z.union([
	z.literal("all"),
	z.literal("product"),
	z.literal("service"),
	z.string().regex(/^model:(pipeline|one_off|direct_deliverable|session|group_session)$/),
	z.string().regex(/^collection:[a-z0-9-]{1,60}$/),
]);
export type ConsoleScope = z.infer<typeof ConsoleScope>;

/** A buyer, addressed by handle — never a uuid (Decision #88). */
export const ClientKey = z.string().regex(/^@[a-z0-9_]{2,30}$/);
export type ClientKey = z.infer<typeof ClientKey>;

/** The longest search string the console carries in its URL. */
export const CONSOLE_SEARCH_MAX = 160;

/** The console's highlight facet (`?highlight=`): needs attention · promoted · best-selling. */
export const ConsoleHighlight = z.enum(["attention", "promoted", "best-selling"]);
export type ConsoleHighlight = z.infer<typeof ConsoleHighlight>;
// #endregion

// #region Seller scope
/** Whether `raw` is a team handle in its canonical, lower-case spelling. */
export function isTeamHandle(raw: string): boolean {
	return raw.length >= WORKSPACE_HANDLE_MIN && raw.length <= WORKSPACE_HANDLE_MAX &&
		WORKSPACE_HANDLE_PATTERN.test(raw);
}

/** The root of a catalogue: the acting seller's `/catalogue`, or one team's. */
export function catalogueBase(team?: string): string {
	return team ? `/teams/${encodeURIComponent(team)}/catalogue` : "/catalogue";
}

/** Where a path sits in the catalogue surface: whose catalogue, and the segments below its root. */
export interface CataloguePath {
	/** The team handle of a `/teams/:handle/catalogue` path; absent on `/catalogue`. */
	team?: string;
	/** The decoded segments after the catalogue root (`["svc-…", "simulate"]`). */
	rest: string[];
}

function decodeSegment(raw: string): string | null {
	try {
		return decodeURIComponent(raw);
	} catch {
		return null;
	}
}

/**
 * Read a pathname against the catalogue surface, or `null` when it is not a catalogue path. A team
 * path whose handle is not canonical (upper case, a row id) is not a catalogue path: the console
 * route answers it with a 308 before anything renders.
 */
export function parseCataloguePath(pathname: string): CataloguePath | null {
	const raw = pathname.split("/").filter(Boolean);
	const segs = raw.map(decodeSegment);
	if (segs.some((s) => s === null)) return null;
	const parts = segs as string[];
	if (parts[0] === "catalogue") return { rest: parts.slice(1) };
	if (parts[0] === "teams" && parts[2] === "catalogue" && isTeamHandle(parts[1] ?? "")) {
		return { team: parts[1], rest: parts.slice(3) };
	}
	return null;
}

/** The team a catalogue pathname is scoped to, or `undefined` for the acting seller's own. */
export function teamOfCataloguePath(pathname: string): string | undefined {
	return parseCataloguePath(pathname)?.team;
}

/**
 * An `/api/catalogue/*` path carrying the team scope (`?team=`), which the route verifies before
 * reading or writing as that team. Unchanged when there is no team, or when the path already names
 * one — a caller that scoped its own call keeps its team.
 */
export function teamScopedApiPath(path: string, team: string | undefined): string {
	if (!team) return path;
	const at = path.indexOf("?");
	if (at >= 0 && new URLSearchParams(path.slice(at + 1)).has("team")) return path;
	return `${path}${at >= 0 ? "&" : "?"}team=${encodeURIComponent(team)}`;
}
// #endregion

// #region Console
/** The console's screen state, as its URL encodes it. */
export interface ConsoleUrlState {
	/** The team whose catalogue this is (`/teams/:handle/catalogue`); absent on `/catalogue`. */
	team?: string;
	view: ConsoleView;
	type: CatalogueTypeFilter;
	/** Lifecycle facet (`?status=draft,paused`), canonical order; never empty. */
	status: ListingStatus[];
	/** Delivery-model facet (`?model=<delivery slug>,…`); empty = every model. */
	model: ServiceType[];
	/** CREATE-category facet (`?category=`); empty = every category. */
	create: CreateCategory[];
	/** Highlight facet (`?highlight=`); the chosen highlights combine, empty = no narrowing. */
	highlights: ConsoleHighlight[];
	sort: CatalogueSort;
	dir: CatalogueSortDir;
	search: string;
	period: AnalyticsPeriod;
	scope: ConsoleScope;
	/** The client drawer's buyer (`view=clients`). */
	client?: ClientKey;
	/** Whether the quick-create modal is open (`?create=`). */
	createOpen: boolean;
	/** The kind the modal opens on (`?create=product` / `?create=service[:<model>]`). */
	createKind?: CatalogueKind;
	/** The delivery model the modal opens on (services only). */
	createModel?: ServiceType;
}

/** The statuses the console opens on: everything but `archived`. */
export const DEFAULT_CONSOLE_STATUSES: readonly ListingStatus[] = ["draft", "published", "paused"];

/** The console state with nothing chosen. */
export const CONSOLE_DEFAULTS: Readonly<ConsoleUrlState> = {
	view: "listings",
	type: "all",
	status: [...DEFAULT_CONSOLE_STATUSES],
	model: [],
	create: [],
	highlights: [],
	sort: "recent",
	dir: defaultSortDir("recent"),
	search: "",
	period: "30d",
	scope: "all",
	createOpen: false,
};

function pick<T>(schema: z.ZodType<T>, raw: string | null): T | undefined {
	if (raw === null) return undefined;
	const parsed = schema.safeParse(raw);
	return parsed.success ? parsed.data : undefined;
}

function modelFromSlug(raw: string | null): ServiceType | undefined {
	const model = pick(DeliveryModel, raw);
	return model ? serviceTypeOf(model) : undefined;
}

/** `values` deduplicated and in `order`, dropping anything `order` does not hold. */
export function canonicalSet<T>(order: readonly T[], values: Iterable<T>): T[] {
	const held = new Set(values);
	return order.filter((v) => held.has(v));
}

function pickList<T>(
	order: readonly T[],
	raw: string | null,
	read: (s: string) => T | undefined,
): T[] {
	if (!raw) return [];
	const picked = raw.split(",").map((s) => read(s.trim())).filter((v): v is T => v !== undefined);
	return canonicalSet(order, picked);
}

/** A status set in canonical order; an empty one is the default set. */
export function normaliseStatuses(values: Iterable<ListingStatus>): ListingStatus[] {
	const set = canonicalSet(ListingStatus.options, values);
	return set.length ? set : [...DEFAULT_CONSOLE_STATUSES];
}

/** Whether a status set is the one the console opens on. */
export function isDefaultStatuses(values: readonly ListingStatus[]): boolean {
	const set = normaliseStatuses(values);
	return set.length === DEFAULT_CONSOLE_STATUSES.length &&
		set.every((s, i) => s === DEFAULT_CONSOLE_STATUSES[i]);
}

interface CreateSeed {
	createOpen: boolean;
	createKind?: CatalogueKind;
	createModel?: ServiceType;
}

function parseCreate(raw: string | null): CreateSeed {
	if (raw === "1") return { createOpen: true };
	if (raw === "product") return { createOpen: true, createKind: "product" };
	if (raw === "service") return { createOpen: true, createKind: "service" };
	if (raw?.startsWith("service:")) {
		const createModel = modelFromSlug(raw.slice("service:".length));
		if (createModel) return { createOpen: true, createKind: "service", createModel };
	}
	return { createOpen: false };
}

function createParam(state: Partial<ConsoleUrlState>): string | null {
	if (!state.createOpen) return null;
	if (state.createKind === "product") return "product";
	if (state.createKind === "service") {
		return state.createModel ? `service:${deliveryModelOf(state.createModel)}` : "service";
	}
	return "1";
}

/** Normalise a raw search string the way the console stores it. */
export function normaliseSearch(raw: string | null | undefined): string {
	return (raw ?? "").trim().slice(0, CONSOLE_SEARCH_MAX);
}

/** Resolve the console state from a URL. Total: a bad value yields its default. */
export function parseConsoleUrl(url: URL): ConsoleUrlState {
	const q = url.searchParams;
	const sort = pick(CatalogueSort, q.get("sort")) ?? CONSOLE_DEFAULTS.sort;
	const state: ConsoleUrlState = {
		view: pick(ConsoleView, q.get("view")) ?? CONSOLE_DEFAULTS.view,
		type: pick(CatalogueTypeFilter, q.get("type")) ?? CONSOLE_DEFAULTS.type,
		sort,
		dir: pick(CatalogueSortDir, q.get("dir")) ?? defaultSortDir(sort),
		search: normaliseSearch(q.get("search")),
		period: pick(AnalyticsPeriod, q.get("period")) ?? CONSOLE_DEFAULTS.period,
		scope: pick(ConsoleScope, q.get("scope")) ?? CONSOLE_DEFAULTS.scope,
		status: normaliseStatuses(
			pickList(ListingStatus.options, q.get("status"), (s) => pick(ListingStatus, s)),
		),
		model: pickList(ServiceType.options, q.get("model"), modelFromSlug),
		create: pickList(CreateCategory.options, q.get("category"), (s) => pick(CreateCategory, s)),
		highlights: pickList(
			ConsoleHighlight.options,
			q.get("highlight"),
			(s) => pick(ConsoleHighlight, s),
		),
		...parseCreate(q.get("create")),
	};
	const team = teamOfCataloguePath(url.pathname);
	if (team) state.team = team;
	const client = pick(ClientKey, q.get("client"));
	if (client) state.client = client;
	return state;
}

function encode(value: string): string {
	return encodeURIComponent(value).replace(/%3A/gi, ":").replace(/%40/g, "@").replace(/%2C/gi, ",");
}

function query(pairs: ReadonlyArray<readonly [string, string | null | undefined]>): string {
	const parts = pairs
		.filter((pair): pair is readonly [string, string] => !!pair[1])
		.map(([key, value]) => `${key}=${encode(value)}`);
	return parts.length ? `?${parts.join("&")}` : "";
}

/**
 * The canonical console href for a state. Params are emitted in a fixed order and defaults are
 * omitted, so equal states always produce equal hrefs.
 */
export function consoleHref(state: Partial<ConsoleUrlState>): string {
	const sort = state.sort ?? CONSOLE_DEFAULTS.sort;
	const view = state.view ?? CONSOLE_DEFAULTS.view;
	const type = state.type ?? CONSOLE_DEFAULTS.type;
	const scope = state.scope ?? CONSOLE_DEFAULTS.scope;
	const period = state.period ?? CONSOLE_DEFAULTS.period;
	const search = normaliseSearch(state.search);
	const status = normaliseStatuses(state.status ?? []);
	const models = canonicalSet(ServiceType.options, state.model ?? []);
	const creates = canonicalSet(CreateCategory.options, state.create ?? []);
	const highlights = canonicalSet(ConsoleHighlight.options, state.highlights ?? []);
	return catalogueBase(state.team) + query([
		["view", view === CONSOLE_DEFAULTS.view ? null : view],
		["type", type === CONSOLE_DEFAULTS.type ? null : type],
		["status", isDefaultStatuses(status) ? null : status.join(",")],
		["model", models.map(deliveryModelOf).join(",")],
		["category", creates.join(",")],
		["highlight", highlights.join(",")],
		["scope", scope === CONSOLE_DEFAULTS.scope ? null : scope],
		["search", search],
		["sort", sort === CONSOLE_DEFAULTS.sort ? null : sort],
		["dir", state.dir && state.dir !== defaultSortDir(sort) ? state.dir : null],
		["period", period === CONSOLE_DEFAULTS.period ? null : period],
		["client", state.client],
		["create", createParam(state)],
	]);
}
// #endregion

// #region Workspace
/** The item workspace's screen state, as its URL encodes it. */
export interface WorkspaceUrlState {
	/** The team whose listing this is (`/teams/:handle/catalogue/:slug`); absent under `/catalogue`. */
	team?: string;
	tab: WorkspaceTab;
	/** The Edit section scrolled to. */
	section?: EditSection;
	device: PreviewDevice;
	period: AnalyticsPeriod;
	/** The client drawer's buyer (`tab=clients`). */
	client?: ClientKey;
}

/** The workspace state with nothing chosen. */
export const WORKSPACE_DEFAULTS: Readonly<WorkspaceUrlState> = {
	tab: "edit",
	device: "desktop",
	period: "30d",
};

/** Resolve the workspace state from a URL. Total: a bad value yields its default. */
export function parseWorkspaceUrl(url: URL): WorkspaceUrlState {
	const q = url.searchParams;
	const state: WorkspaceUrlState = {
		tab: pick(WorkspaceTab, q.get("tab")) ?? WORKSPACE_DEFAULTS.tab,
		device: pick(PreviewDevice, q.get("device")) ?? WORKSPACE_DEFAULTS.device,
		period: pick(AnalyticsPeriod, q.get("period")) ?? WORKSPACE_DEFAULTS.period,
	};
	const section = pick(EditSection, q.get("section"));
	if (section) state.section = section;
	const team = teamOfCataloguePath(url.pathname);
	if (team) state.team = team;
	const client = pick(ClientKey, q.get("client"));
	if (client) state.client = client;
	return state;
}

/** The canonical workspace href for a listing slug and a state (fixed order, defaults omitted). */
export function workspaceHref(slug: string, state: Partial<WorkspaceUrlState>): string {
	const tab = state.tab ?? WORKSPACE_DEFAULTS.tab;
	const device = state.device ?? WORKSPACE_DEFAULTS.device;
	const period = state.period ?? WORKSPACE_DEFAULTS.period;
	return `${catalogueBase(state.team)}/${encodeURIComponent(slug)}` + query([
		["tab", tab === WORKSPACE_DEFAULTS.tab ? null : tab],
		["section", state.section],
		["device", device === WORKSPACE_DEFAULTS.device ? null : device],
		["period", period === WORKSPACE_DEFAULTS.period ? null : period],
		["client", state.client],
	]);
}
// #endregion

// #region Listing scope redirect
/** Whether `id` is a listing's address — a service or product slug. */
export function isListingSlug(id: string): boolean {
	return isSlug(id, "service") || isSlug(id, "product");
}

const VIEW_TAB: Record<ConsoleView, WorkspaceTab> = {
	listings: "edit",
	analytics: "analytics",
	clients: "clients",
};

/**
 * Where a console URL scoped to ONE listing belongs (Decision #217(l)): the workspace tab matching
 * the console view, keeping the window, the client and the team. `null` when `?scope=` is not a
 * listing slug.
 */
export function scopeRedirect(url: URL): string | null {
	const scope = url.searchParams.get("scope");
	if (!scope || !isListingSlug(scope)) return null;
	const q = url.searchParams;
	const view = pick(ConsoleView, q.get("view")) ?? CONSOLE_DEFAULTS.view;
	const state: Partial<WorkspaceUrlState> = {
		team: teamOfCataloguePath(url.pathname),
		tab: VIEW_TAB[view],
		period: pick(AnalyticsPeriod, q.get("period")),
	};
	const client = pick(ClientKey, q.get("client"));
	if (client) state.client = client;
	return workspaceHref(scope, state);
}
// #endregion
