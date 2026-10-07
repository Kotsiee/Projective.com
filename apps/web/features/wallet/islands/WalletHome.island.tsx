import type { JSX } from "preact";
import { effect, useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import "../styles/wallet.css";
import { displayCurrency as storeCurrency } from "@projective/ui/display/money";
import { Icon } from "@projective/ui/icons";
import { useOfflineStall } from "@web/utils/use-offline-stall.ts";
import { type WalletContext, WalletService } from "../core/WalletService.ts";
import { LEDGER_PAGE, type WalletHomeData, type WalletRead } from "../core/wallet-ssr.ts";
import {
	mergeLedger,
	resolveAction,
	resolveHeroActions,
	type UpcomingAction,
	upcomingItems,
} from "../core/wallet-home.ts";
import {
	browserTimeZone,
	defaultPeriodFor,
	type FlowPeriod,
	hasInvoices,
	ledgerFiltered,
	type LedgerFilters as Filters,
	ledgerFiltersFrom,
	ledgerParamsOf,
	periodRange,
	viewShowsRuler,
	walletPageHref,
	type WalletView,
	withLedgerFilters,
} from "../core/wallet-model.ts";
import { openWalletDialog, walletFlowLive, walletOverviewLive } from "../core/wallet-state.ts";
import type {
	ActivityView,
	FundingView,
	InvoicesView,
	LedgerLine,
	MethodsView,
	PayoutsView,
	SpendApprovalView,
	WalletAction,
	WalletOverview,
	WalletSwitcher,
} from "../types/wallet-types.ts";
import { WalletHero } from "../components/WalletHero.tsx";
import { AccountRail } from "../components/AccountRail.tsx";
import { CashFlow } from "../components/CashFlow.tsx";
import { UpcomingList } from "../components/UpcomingList.tsx";
import { LedgerFeed, LedgerPreview } from "../components/LedgerList.tsx";
import { LedgerFilters } from "../components/LedgerFilters.tsx";
import { MethodsList } from "../components/MethodsList.tsx";
import { WalletDialogs } from "../components/WalletDialogs.tsx";
import { AllocationMeter } from "../components/AllocationMeter.tsx";
import { AnalyticsView } from "../components/AnalyticsView.tsx";
import { InvoicesPanel } from "../components/InvoicesPanel.tsx";
import { RangeRuler } from "../components/WalletTools.tsx";
import { VerificationGate } from "../components/VerificationGate.tsx";
import { WalletPageNav } from "../components/WalletPageNav.tsx";

/** Props for {@link WalletHome}. */
export interface WalletHomeProps {
	home: WalletRead<WalletHomeData>;
}

interface Part<T> {
	data: T | null;
	error: string | null;
}

function partOf<T>(read: WalletRead<T> | null): Part<T> | null {
	if (!read) return null;
	return read.ok ? { data: read.data, error: null } : { data: null, error: read.message };
}

/** Ledger lines the overview previews before linking to the full ledger. */
const LEDGER_PREVIEW = 6;

const UNFILTERED: Filters = {
	q: "",
	dir: "all",
	kinds: [],
	period: defaultPeriodFor("transactions"),
};

function reducedMotion(): boolean {
	if (typeof document === "undefined") return true;
	if (document.documentElement.dataset.motion === "reduced") return true;
	return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/** Hands a downloaded file to the browser's save flow, then lets go of it. */
function saveBlob(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	a.rel = "noopener";
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 0);
}

function Failure({ message }: { message: string }): JSX.Element {
	return (
		// A named region, not a second `<main>`: the shell's canvas is the page's one main landmark.
		<section class="wlt" aria-labelledby="wlt-title">
			<section class="wlt-hero wlt-hero--failed">
				<div class="wlt-hero__inner">
					<h1 id="wlt-title" class="wlt-hero__failtitle">Wallet</h1>
					<p class="wlt-hero__note" role="alert">{message}</p>
					<div class="wlt-actions">
						<button type="button" class="wlt-pill" onClick={() => location.reload()}>
							<span class="wlt-pill__icon" aria-hidden="true">
								<Icon name="refresh" size="sm" />
							</span>
							<span class="wlt-pill__label">Try again</span>
						</button>
					</div>
				</div>
			</section>
		</section>
	);
}

function Home({ data }: { data: WalletHomeData }): JSX.Element {
	const overview = useSignal<WalletOverview>(data.overview);
	const switcher = useSignal<WalletSwitcher>(data.switcher);
	const display = useSignal(data.display);
	const timezone = useSignal<string | null>(null);
	const view = data.view;

	const ledgerRead = partOf(data.ledger);
	const lines = useSignal<LedgerLine[]>(ledgerRead?.data?.items ?? []);
	const cursor = useSignal<string | null>(ledgerRead?.data?.nextCursor ?? null);
	const hasMore = useSignal(ledgerRead?.data?.hasMore ?? false);
	const ledgerError = useSignal<string | null>(ledgerRead?.error ?? null);
	const ledgerBusy = useSignal(false);
	const filters = useSignal<Filters>(data.filters ?? UNFILTERED);
	/** Each ledger request's ticket; an answer for a superseded request (an older filter) is dropped. */
	const ledgerTicket = useRef(0);

	const activityRead = partOf(data.activity);
	const period = useSignal<FlowPeriod>(data.period);
	const flows = useSignal<Partial<Record<FlowPeriod, ActivityView>>>(
		activityRead?.data ? { [data.period]: activityRead.data } : {},
	);
	const flowError = useSignal<string | null>(activityRead?.error ?? null);
	const flowBusy = useSignal(false);

	const funding = useSignal<Part<FundingView> | null>(partOf(data.funding));
	const payouts = useSignal<Part<PayoutsView> | null>(partOf(data.payouts));
	const methods = useSignal<Part<MethodsView> | null>(partOf(data.methods));
	const approvals = useSignal<Part<SpendApprovalView[]> | null>(partOf(data.approvals));
	const sideBusy = useSignal(false);

	const invoices = useSignal<Part<InvoicesView> | null>(partOf(data.invoices));
	const invoicesBusy = useSignal(false);

	const mounted = useSignal(false);
	const heroRef = useRef<HTMLElement>(null);
	const sheetRef = useRef<HTMLDivElement>(null);

	const query = (): WalletContext => ({
		wallet: data.wallet,
		display: display.value,
		timezone: timezone.peek(),
	});

	// #region Reads
	const loadActivity = async (next: FlowPeriod) => {
		flowBusy.value = true;
		const res = await WalletService.activity(query(), periodRange(next));
		if (res.ok && res.data) flows.value = { ...flows.peek(), [next]: res.data.activity };
		// A slower answer for a window the reader has already left is cached above, but it must not clear
		// the spinner or set the error of the window they are looking at now.
		if (period.peek() !== next) return;
		flowBusy.value = false;
		flowError.value = res.ok && res.data
			? null
			: res.message ?? "The cash flow couldn't be loaded.";
	};

	/**
	 * The first page (`reset`) or the next keyset page of the ledger, with the page's filters on the
	 * Transactions page. Returns whether it landed, for the offline stall.
	 */
	const fetchLedger = async (reset: boolean): Promise<boolean> => {
		const ticket = ++ledgerTicket.current;
		ledgerBusy.value = true;
		if (reset) {
			ledgerError.value = null;
			cursor.value = null;
		}
		const base = view === "transactions" ? ledgerParamsOf(filters.peek()) : {};
		const res = await WalletService.transactions(query(), {
			...base,
			limit: LEDGER_PAGE,
			cursor: reset ? null : cursor.peek(),
		});
		if (ticket !== ledgerTicket.current) return true;
		ledgerBusy.value = false;
		if (res.ok && res.data) {
			const page = res.data.page;
			lines.value = reset ? page.items : mergeLedger(lines.peek(), page.items);
			cursor.value = page.nextCursor;
			hasMore.value = page.hasMore;
			ledgerError.value = null;
			return true;
		}
		if (reset) lines.value = [];
		return false;
	};

	const loadMore = async () => {
		if (ledgerBusy.peek() || !hasMore.peek() || !cursor.peek() || stall.blocked.peek()) return;
		const ok = await fetchLedger(false);
		// A page that failed OFFLINE stalls the tail with the offline notice and its own Retry; any other
		// failure says so in its own words.
		if (stall.settle(ok) || ok) return;
		ledgerError.value = "The next transactions couldn't be loaded.";
	};
	const stall = useOfflineStall(loadMore);

	const reloadLedger = async () => {
		const ok = await fetchLedger(true);
		if (stall.settle(ok) || ok) return;
		ledgerError.value = "Transactions couldn't be loaded.";
	};

	const loadSide = async () => {
		sideBusy.value = true;
		const ctx = query();
		const [f, p, m, a] = await Promise.all([
			funding.value ? WalletService.funding(ctx) : null,
			payouts.value ? WalletService.payouts(ctx) : null,
			methods.value ? WalletService.methods(ctx) : null,
			approvals.value ? WalletService.access(ctx) : null,
		]);
		sideBusy.value = false;
		if (f) {
			funding.value = f.ok && f.data ? { data: f.data.funding, error: null } : {
				data: funding.value?.data ?? null,
				error: f.message ?? "Recurring deposits couldn't be loaded.",
			};
		}
		if (p) {
			payouts.value = p.ok && p.data ? { data: p.data.payouts, error: null } : {
				data: payouts.value?.data ?? null,
				error: p.message ?? "The payout schedule couldn't be loaded.",
			};
		}
		if (m) {
			methods.value = m.ok && m.data ? { data: m.data.methods, error: null } : {
				data: methods.value?.data ?? null,
				error: m.message ?? "Payment methods couldn't be loaded.",
			};
		}
		if (a) {
			approvals.value = a.ok && a.data ? { data: a.data.access.approvals, error: null } : {
				data: approvals.value?.data ?? null,
				error: a.message ?? "Spend requests couldn't be loaded.",
			};
		}
	};

	const loadInvoices = async () => {
		invoicesBusy.value = true;
		const res = await WalletService.invoices(query());
		invoicesBusy.value = false;
		invoices.value = res.ok && res.data ? { data: res.data.invoices, error: null } : {
			data: invoices.value?.data ?? null,
			error: res.message ?? "Invoices couldn't be loaded.",
		};
	};

	const refresh = async (fresh: WalletOverview | null) => {
		if (fresh) overview.value = fresh;
		const current = period.peek();
		flows.value = {};
		const [main] = await Promise.all([
			WalletService.overview(query()),
			reloadLedger(),
			loadActivity(current),
			loadSide(),
			view === "invoices" && invoices.peek() ? loadInvoices() : null,
		]);
		if (main.ok && main.data) {
			overview.value = main.data.overview;
			switcher.value = main.data.switcher;
		}
	};
	// #endregion

	// #region Effects
	useEffect(() => {
		mounted.value = true;
		// The server drew "Today" and the cash-flow days on the viewer's profile zone (or UTC). Once the
		// browser's own zone is known, a page drawn on a different calendar is read again on this one.
		const zone = browserTimeZone();
		timezone.value = zone;
		const drawnIn = activityRead?.data?.timezone ?? null;
		if (zone && drawnIn && zone !== drawnIn) {
			flows.value = {};
			void loadActivity(period.peek());
			void reloadLedger();
		}
	}, []);

	useEffect(() => {
		let first = true;
		return effect(() => {
			const code = storeCurrency.value;
			if (first) {
				first = false;
				return;
			}
			if (code && code !== display.peek()) {
				display.value = code;
				// A `?display=` link would otherwise reload into the currency the reader just left.
				const url = new URL(location.href);
				if (url.searchParams.has("display")) {
					url.searchParams.set("display", code);
					history.replaceState(history.state, "", url);
				}
				void refresh(null);
			}
		});
	}, []);

	// The lane follows what the page shows, so its actions and gate agree after a money movement.
	useEffect(() => {
		walletOverviewLive.value = overview.value;
	}, [overview.value]);

	useEffect(() => {
		const hero = heroRef.current;
		if (!hero) return;
		const onFocus = (e: FocusEvent) => {
			const sheet = sheetRef.current;
			const target = e.target as HTMLElement | null;
			if (!sheet || !target) return;
			if (target.getBoundingClientRect().bottom > sheet.getBoundingClientRect().top) {
				globalThis.scrollTo({ top: 0, behavior: reducedMotion() ? "auto" : "smooth" });
			}
		};
		hero.addEventListener("focusin", onFocus);
		return () => hero.removeEventListener("focusin", onFocus);
	}, []);

	// Back/forward between filtered addresses re-reads the filters the address names.
	useEffect(() => {
		if (view !== "transactions") return;
		const onPop = () => {
			const next = ledgerFiltersFrom(new URL(location.href).searchParams);
			filters.value = next;
			period.value = next.period;
			void reloadLedger();
		};
		globalThis.addEventListener("popstate", onPop);
		return () => globalThis.removeEventListener("popstate", onPop);
	}, []);
	// #endregion

	// #region Handlers
	/** Applies the Transactions page's filters: written into the address, then the first page re-read. */
	function applyFilters(next: Filters) {
		filters.value = next;
		const url = new URL(location.href);
		url.search = withLedgerFilters(url.searchParams, next).toString();
		history.replaceState(history.state, "", url);
		lines.value = [];
		hasMore.value = false;
		stall.settle(true);
		void reloadLedger();
	}

	function choosePeriod(next: FlowPeriod) {
		period.value = next;
		walletFlowLive.value = next;
		if (view === "transactions") {
			applyFilters({ ...filters.peek(), period: next });
			return;
		}
		flowError.value = null;
		flowBusy.value = false;
		const url = new URL(location.href);
		if (next === defaultPeriodFor(view)) url.searchParams.delete("flow");
		else url.searchParams.set("flow", next);
		history.replaceState(history.state, "", url);
		if (!flows.peek()[next]) void loadActivity(next);
	}

	const exportLedger = async (): Promise<string | null> => {
		const res = await WalletService.exportLedger(query(), ledgerParamsOf(filters.peek()));
		if (!res.ok) return res.message;
		saveBlob(res.blob, res.filename);
		return null;
	};

	const openAction = (action: WalletAction, stageId?: string) =>
		openWalletDialog({ kind: "action", action, stageId });

	const onUpcoming = (a: UpcomingAction) => {
		if (a.kind === "approval") openWalletDialog({ kind: "approval", approvalId: a.approvalId });
		else openAction(a.action, a.stageId);
	};

	const openLine = (line: LedgerLine) => openWalletDialog({ kind: "line", line });
	// #endregion

	const o = overview.value;
	const actions = resolveHeroActions(o);
	const resolve = (action: WalletAction) => resolveAction(action, o.unavailable, o.verification);
	const canDecide = o.capabilities.includes("manage_billing") ||
		o.capabilities.includes("distribute");
	const upcoming = upcomingItems({
		overview: o,
		rules: funding.value?.data?.rules ?? null,
		schedule: payouts.value?.data?.schedule ?? null,
		approvals: approvals.value?.data ?? null,
		canDecide,
	});
	const sideErrors = [funding.value?.error, payouts.value?.error, approvals.value?.error]
		.filter((m): m is string => !!m);
	const activity = flows.value[period.value] ?? null;
	const addMethod = o.quickActions.includes("add_method") ? resolve("add_method") : null;
	const aggregate = o.ref.scope === "aggregate";
	const pageHref = (target: WalletView) =>
		walletPageHref(target, data.wallet, display.value, period.value);

	return (
		<section class="wlt" data-view={view} aria-labelledby="wlt-title">
			{viewShowsRuler(view) && (
				<div class="wlt-rulebar">
					<div class="wlt-rulebar__slot">
						<RangeRuler value={period.value} onChange={choosePeriod} />
					</div>
				</div>
			)}
			<WalletHero
				view={view}
				overview={o}
				switcher={switcher.value}
				actions={actions}
				display={display.value}
				heroRef={heroRef}
				onAction={(item) => openAction(item.action)}
			/>
			<div class="wlt-sheet" ref={sheetRef}>
				{
					/* On a phone the shell removes the lane, so its page links and verification gate move to
					   the top of the sheet — shown there only below the lane's breakpoint, never twice. */
				}
				<div class="wlt-sheet__lanemoved">
					<WalletPageNav
						variant="strip"
						view={view}
						wallet={data.wallet}
						display={display.value}
						flow={period.value}
						business={o.business}
					/>
					<VerificationGate overview={o} />
				</div>

				{view === "overview" && (
					<div class="wlt-sheet__grid" data-methods={methods.value ? "true" : undefined}>
						{!aggregate && <AllocationMeter overview={o} />}
						<AccountRail
							switcher={switcher.value}
							display={display.value}
							pot={o.personal?.taxPot ?? null}
							reducedMotion={reducedMotion}
						/>
						<CashFlow
							period={period.value}
							activity={activity}
							loading={flowBusy.value}
							error={flowError.value}
							onRetry={() =>
								void loadActivity(period.value)}
							moreHref={pageHref("analytics")}
						/>
						<UpcomingList
							items={upcoming}
							errors={sideErrors}
							retrying={sideBusy.value}
							onAction={onUpcoming}
							onRetry={() =>
								void loadSide()}
						/>
						<LedgerPreview
							lines={lines.value}
							limit={LEDGER_PREVIEW}
							href={pageHref("transactions")}
							error={ledgerError.value}
							loading={ledgerBusy.value}
							mounted={mounted.value}
							onOpen={openLine}
							onRetry={() => void reloadLedger()}
						/>
						{methods.value && (
							<MethodsList
								methods={methods.value.data?.methods ?? []}
								error={methods.value.error}
								retrying={sideBusy.value}
								add={addMethod}
								onAdd={(item) => openAction(item.action)}
								onRetry={() => void loadSide()}
							/>
						)}
					</div>
				)}

				{view === "transactions" && (
					<div class="wlt-sheet__page wlt-sheet__page--ledger">
						<section
							class="wlt-section wlt-ledger"
							id="transactions"
							aria-labelledby="wlt-ledger-title"
						>
							<header class="wlt-section__head">
								<h2 id="wlt-ledger-title" class="wlt-section__title">Transactions</h2>
							</header>
							<LedgerFilters
								filters={filters.value}
								onChange={applyFilters}
								onExport={exportLedger}
								canExport={lines.value.length > 0}
							/>
							<LedgerFeed
								lines={lines.value}
								hasMore={hasMore.value}
								loading={ledgerBusy.value}
								error={ledgerError.value}
								stalled={stall.stalled.value}
								retrying={stall.retrying.value}
								filtered={ledgerFiltered(filters.value)}
								mounted={mounted.value}
								onOpen={openLine}
								onMore={() => void loadMore()}
								onRetry={() => {
									ledgerError.value = null;
									void (lines.peek().length === 0 ? reloadLedger() : loadMore());
								}}
								onStallRetry={stall.retry}
								onClearFilters={() =>
									applyFilters({ ...UNFILTERED, period: filters.peek().period })}
							/>
						</section>
					</div>
				)}

				{view === "analytics" && (
					<div class="wlt-sheet__page wlt-sheet__page--analytics">
						<AnalyticsView
							period={period.value}
							activity={activity}
							loading={flowBusy.value}
							error={flowError.value}
							onRetry={() => void loadActivity(period.value)}
							mounted={mounted.value}
						/>
					</div>
				)}

				{view === "invoices" && (
					<div class="wlt-sheet__page">
						<InvoicesPanel
							billed={hasInvoices(o.business)}
							view={invoices.value?.data ?? null}
							loading={invoicesBusy.value}
							error={invoices.value?.error ?? null}
							onRetry={() => void loadInvoices()}
						/>
					</div>
				)}
			</div>
			<WalletDialogs
				overview={o}
				switcher={switcher.value}
				methods={methods.value?.data?.methods ?? []}
				destinations={payouts.value?.data?.destinations ?? []}
				schedule={payouts.value?.data?.schedule ?? null}
				approvals={approvals.value?.data ?? []}
				query={query()}
				resolve={resolve}
				onChanged={(fresh) => void refresh(fresh)}
			/>
		</section>
	);
}

/**
 * Every `/wallet` page: a luminous hero under a dashboard sheet, with every money action in a dialog.
 * The overview's sheet carries the allocation meter, accounts, cash flow, upcoming obligations, recent
 * transactions and payment methods; `/wallet/transactions` the filtered, windowed ledger;
 * `/wallet/analytics` the regional analytics grid; `/wallet/invoices` a business vault's bills. One
 * island serves all four so the dialogs the lane opens are hosted on whichever page is open.
 */
export default function WalletHome({ home }: WalletHomeProps): JSX.Element {
	return home.ok ? <Home data={home.data} /> : <Failure message={home.message} />;
}
