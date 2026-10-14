import { z } from "zod";
import { ServiceType } from "../explore/items.ts";
import { CreateCategory } from "../org/standing.ts";
import { isSlug } from "../slugs/slug.ts";
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
 * workspace), plan §6.2.
 *
 * Every screen state that matters lives in the URL, so a reload or a shared link restores the same
 * screen. The parsers are TOTAL: an unknown or malformed value falls back to its default and never
 * throws. The builders emit params in one canonical order and omit defaults, so one state has
 * exactly one href and `parse(href(x))` returns `x`.
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
// #endregion

// #region Console
/** The console's screen state, as its URL encodes it. */
export interface ConsoleUrlState {
	view: ConsoleView;
	type: CatalogueTypeFilter;
	status?: ListingStatus;
	/** Delivery-model facet (`?model=<delivery slug>`). */
	model?: ServiceType;
	/** CREATE-category facet (`?category=`). */
	create?: CreateCategory;
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

/** The console state with nothing chosen. */
export const CONSOLE_DEFAULTS: Readonly<ConsoleUrlState> = {
	view: "listings",
	type: "all",
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
		...parseCreate(q.get("create")),
	};
	const status = pick(ListingStatus, q.get("status"));
	if (status) state.status = status;
	const model = modelFromSlug(q.get("model"));
	if (model) state.model = model;
	const create = pick(CreateCategory, q.get("category"));
	if (create) state.create = create;
	const client = pick(ClientKey, q.get("client"));
	if (client) state.client = client;
	return state;
}

function encode(value: string): string {
	return encodeURIComponent(value).replace(/%3A/gi, ":").replace(/%40/g, "@");
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
	return "/catalogue" + query([
		["view", view === CONSOLE_DEFAULTS.view ? null : view],
		["type", type === CONSOLE_DEFAULTS.type ? null : type],
		["status", state.status],
		["model", state.model ? deliveryModelOf(state.model) : null],
		["category", state.create],
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
	const client = pick(ClientKey, q.get("client"));
	if (client) state.client = client;
	return state;
}

/** The canonical workspace href for a listing slug and a state (fixed order, defaults omitted). */
export function workspaceHref(slug: string, state: Partial<WorkspaceUrlState>): string {
	const tab = state.tab ?? WORKSPACE_DEFAULTS.tab;
	const device = state.device ?? WORKSPACE_DEFAULTS.device;
	const period = state.period ?? WORKSPACE_DEFAULTS.period;
	return `/catalogue/${encodeURIComponent(slug)}` + query([
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
 * the console view, keeping the window and the client. `null` when `?scope=` is not a listing slug.
 */
export function scopeRedirect(url: URL): string | null {
	const scope = url.searchParams.get("scope");
	if (!scope || !isListingSlug(scope)) return null;
	const q = url.searchParams;
	const view = pick(ConsoleView, q.get("view")) ?? CONSOLE_DEFAULTS.view;
	const state: Partial<WorkspaceUrlState> = {
		tab: VIEW_TAB[view],
		period: pick(AnalyticsPeriod, q.get("period")),
	};
	const client = pick(ClientKey, q.get("client"));
	if (client) state.client = client;
	return workspaceHref(scope, state);
}
// #endregion
