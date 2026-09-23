import type { UserContext } from "@projective/types/auth";
import { toDisplayCurrency } from "@projective/types/finance";
import type { ReadActor } from "@server/services/read-actor.ts";
import type { ServiceResult } from "@server/services/ServiceResult.ts";
import { WalletBackendService } from "@server/services/finance/WalletBackendService.ts";
import { defaultWalletParam, toActivityRange, walletParam, walletQueryFrom } from "./wallet-model.ts";
import type {
	AccessView,
	ActivityView,
	FundingView,
	InvoicesView,
	MethodsView,
	PayoutsView,
	TransactionListParams,
	TransactionPage,
	WalletOverview,
	WalletSwitcher,
} from "../types/wallet-types.ts";

/**
 * wallet-ssr — the server-only bootstraps for the Wallet surface's first paint. They call the fat
 * {@link WalletBackendService} directly (no HTTP hop), as the signed-in viewer, so the overview, the
 * deep pages and the lane / header / footer bands ship their first byte resolved from the live
 * wallet; the islands then refine via the thin `WalletService`. Never imported by an island.
 *
 * Every resolver answers a {@link WalletRead}: the data, or the reason it could not be read. A failed
 * read is never papered over with an empty wallet — £0.00 drawn where a balance could not be read is
 * a false statement about someone's money — so the caller renders the failure instead.
 */

/** A first-paint read: the projection, or why it could not be produced. */
export type WalletRead<T> = { ok: true; data: T } | { ok: false; message: string };

/** Everything the Overview page, the lane and the header band share. */
export interface WalletOverviewBootstrap {
	overview: WalletOverview;
	switcher: WalletSwitcher;
}

// #region Request-scoped memo
/**
 * One read per kind per request, however many regions ask.
 *
 * The page handler, the lane, the header band and the footer rig each need the overview; resolving it
 * four times would read the viewer's wallets four times for one page. Keyed on the `URL` OBJECT (the
 * `calendar-slots` precedent): Fresh hands the handler and every resolver in one request the same
 * instance and a new request a new one, so an entry cannot outlive the request that made it — which
 * matters here more than anywhere, because a wallet read after a transfer must see the transfer. The
 * stored value is the PROMISE, so the three bands, resolved concurrently, share one read in flight.
 */
const READS = new WeakMap<URL, Map<string, Promise<unknown>>>();

function once<T>(url: URL, actor: ReadActor, kind: string, run: () => Promise<T>): Promise<T> {
	let reads = READS.get(url);
	if (!reads) {
		reads = new Map();
		READS.set(url, reads);
	}
	const key = `${kind}|${actor.userId}|${actor.contextId}`;
	const hit = reads.get(key) as Promise<T> | undefined;
	if (hit) return hit;
	const promise = run();
	reads.set(key, promise);
	return promise;
}

/** Fold a service result into a {@link WalletRead}. */
function toRead<T, U>(res: ServiceResult<T>, pick: (data: T) => U): WalletRead<U> {
	if (res.ok && res.data) return { ok: true, data: pick(res.data) };
	return {
		ok: false,
		message: res.message ?? "We couldn't reach your wallet just now. Try again in a moment.",
	};
}
// #endregion

// #region Resolvers
/** The Overview hub + the wallet switcher, from one resolution of the viewer's wallets. */
export function resolveWalletOverview(
	context: UserContext,
	url: URL,
	actor: ReadActor,
): Promise<WalletRead<WalletOverviewBootstrap>> {
	return once(url, actor, "overview", async () => {
		const res = await WalletBackendService.overviewWithSwitcher(walletQueryFrom(url.searchParams, context), actor);
		return toRead(res, (d): WalletOverviewBootstrap => ({ overview: d.overview, switcher: d.switcher }));
	});
}

/** The wallet a page shows and the currency it is drawn in, as its islands thread them into refetches. */
export interface WalletFrame {
	/** The `?w=` param of the wallet the server RESOLVED (a vault the viewer has left falls back). */
	wallet: string;
	/** The currency the service drew the page in: `?display=`, else the viewer's preference. */
	display: string;
}

/**
 * The frame a page threads into its island, read off the switcher so SSR and every later refetch ask
 * for the same wallet in the same currency. When the wallet could not be read, the request's own
 * answers stand in — they only label the failure notice.
 */
export async function resolveWalletFrame(context: UserContext, url: URL, actor: ReadActor): Promise<WalletFrame> {
	const read = await resolveWalletOverview(context, url, actor);
	if (read.ok) {
		const active = read.data.switcher.active;
		return { wallet: walletParam(active.scope, active.id), display: active.available.currency };
	}
	return {
		wallet: url.searchParams.get("w") ?? defaultWalletParam(context),
		display: toDisplayCurrency(url.searchParams.get("display") ?? context.displayCurrency),
	};
}

/** The first page of the ledger. */
export function resolveTransactions(
	context: UserContext,
	url: URL,
	actor: ReadActor,
): Promise<WalletRead<TransactionPage>> {
	return once(url, actor, "transactions", async () => {
		const params: TransactionListParams = { limit: 40 };
		const res = await WalletBackendService.transactions(walletQueryFrom(url.searchParams, context), params, actor);
		return toRead(res, (d) => d.page);
	});
}

/** The Activity projection over the requested range. */
export function resolveActivity(context: UserContext, url: URL, actor: ReadActor): Promise<WalletRead<ActivityView>> {
	return once(url, actor, "activity", async () => {
		const range = toActivityRange(url.searchParams.get("range"));
		const res = await WalletBackendService.activity(walletQueryFrom(url.searchParams, context), range, actor);
		return toRead(res, (d) => d.activity);
	});
}

/** The Payouts projection. */
export function resolvePayouts(context: UserContext, url: URL, actor: ReadActor): Promise<WalletRead<PayoutsView>> {
	return once(url, actor, "payouts", async () => {
		const res = await WalletBackendService.payouts(walletQueryFrom(url.searchParams, context), actor);
		return toRead(res, (d) => d.payouts);
	});
}

/** The Funding projection. */
export function resolveFunding(context: UserContext, url: URL, actor: ReadActor): Promise<WalletRead<FundingView>> {
	return once(url, actor, "funding", async () => {
		const res = await WalletBackendService.funding(walletQueryFrom(url.searchParams, context), actor);
		return toRead(res, (d) => d.funding);
	});
}

/** The Methods projection (also the footer rig's drawers' instruments). */
export function resolveMethods(context: UserContext, url: URL, actor: ReadActor): Promise<WalletRead<MethodsView>> {
	return once(url, actor, "methods", async () => {
		const res = await WalletBackendService.methods(walletQueryFrom(url.searchParams, context), actor);
		return toRead(res, (d) => d.methods);
	});
}

/** The Invoices projection. */
export function resolveInvoices(context: UserContext, url: URL, actor: ReadActor): Promise<WalletRead<InvoicesView>> {
	return once(url, actor, "invoices", async () => {
		const res = await WalletBackendService.invoices(walletQueryFrom(url.searchParams, context), actor);
		return toRead(res, (d) => d.invoices);
	});
}

/** The Access projection. */
export function resolveAccess(context: UserContext, url: URL, actor: ReadActor): Promise<WalletRead<AccessView>> {
	return once(url, actor, "access", async () => {
		const res = await WalletBackendService.access(walletQueryFrom(url.searchParams, context), actor);
		return toRead(res, (d) => d.access);
	});
}
// #endregion
