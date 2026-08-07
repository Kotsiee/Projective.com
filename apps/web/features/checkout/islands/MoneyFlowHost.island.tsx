import type { JSX } from "preact";
import { useCallback, useEffect } from "preact/hooks";
import { MoneyFlowPopover } from "@projective/ui/overlay";
import type { FlowScope, FlowScopeKind, FlowWallet } from "@projective/ui/overlay";
import { WalletService } from "@features/wallet/core/WalletService.ts";
import type { WalletRef } from "@features/wallet/types/wallet-types.ts";
import {
	closeMoneyFlow,
	flowBusy,
	flowError,
	flowLegs,
	flowScope,
	flowScopes,
	flowSelectedWalletId,
	flowWallets,
	hydrateMoneyFlow,
	MONEY_FLOW_OPEN_EVENT,
	moneyFlowOpen,
	moneyFlowPosition,
	moneyFlowSize,
	rememberOpen,
	rememberPosition,
	rememberSize,
} from "../core/money-flow-state.ts";

/**
 * MoneyFlowHost — the single mount for the DEV-ONLY Money Flow debugger, mirroring `ChatPopoutHost`:
 * one instance in the dashboard layout, re-seeded from `localStorage` on every mount, so the window
 * survives full-page navigations and reopens where the developer left it.
 *
 * **It is mounted only through `MoneyFlowMount`**, which returns `null` under `IS_DEV === false`. That
 * makes this island, the `MoneyFlowPopover` it renders and `money-flow-state` all unreachable in a
 * production build, so Vite drops the lot — the same three-layer exclusion `features/devtools/` uses
 * (a statically-replaced flag, an unconditional `return null`, and no other import path in).
 *
 * The popover is fully controlled and performs no arithmetic, so this host supplies every figure from
 * the fat wallet service and never computes one.
 */
export default function MoneyFlowHost(): JSX.Element | null {
	/**
	 * Read the acting wallet and its siblings.
	 *
	 * The ACTING account is read in full (its four-state balance projection is what the debugger is
	 * for); the siblings carry their spendable balance only, and SAY SO in a note. Zero-filling their
	 * escrow and pending would draw three empty slices that look like facts, and an operator inspecting
	 * a money bug is exactly the reader who would act on them.
	 */
	const load = useCallback(async () => {
		flowBusy.value = true;
		const res = await WalletService.overview({ wallet: null, display: null });
		flowBusy.value = false;
		if (!res.ok || !res.data) {
			flowError.value = res.message ?? "The wallet service did not answer.";
			return;
		}
		flowError.value = null;
		const { overview, switcher } = res.data;
		const active = switcher.active;
		const dash = (currency: string) => ({ minor: 0, currency, display: "—" });

		const acting: FlowWallet = {
			id: walletKey(active),
			label: active.name,
			scope: scopeKindOf(active.scope),
			role: "acting",
			currency: overview.available.currency,
			balances: {
				available: overview.available,
				escrow: overview.locked,
				pending: overview.pending,
				// No forecast is published on the overview projection, so none is claimed. The popover
				// draws `projected` as a marker rather than a slice, and a dashed marker reads as
				// "not supplied" where an invented number would read as a prediction.
				projected: dash(overview.available.currency),
				capital: overview.capital,
			},
			note: active.role ? `${active.role} · acting account` : "acting account",
		};

		const others: FlowWallet[] = switcher.accounts
			.filter((ref) => walletKey(ref) !== acting.id && ref.scope !== "aggregate")
			.map((ref) => ({
				id: walletKey(ref),
				label: ref.name,
				scope: scopeKindOf(ref.scope),
				role: "counterparty" as const,
				currency: ref.available.currency,
				balances: {
					available: ref.available,
					escrow: dash(ref.available.currency),
					pending: dash(ref.available.currency),
					projected: dash(ref.available.currency),
				},
				note: "spendable balance only — switch scope to read this account in full",
			}));

		flowWallets.value = [acting, ...others];
		flowScopes.value = [acting, ...others].map((w): FlowScope => ({
			kind: w.scope,
			id: w.id,
			label: w.label,
		}));
		flowScope.value = { kind: acting.scope, id: acting.id, label: acting.label };
		flowSelectedWalletId.value = acting.id;
	}, []);

	useEffect(() => {
		hydrateMoneyFlow();
		const onOpen = () => {
			rememberOpen(true);
			void load();
		};
		globalThis.addEventListener?.(MONEY_FLOW_OPEN_EVENT, onOpen);
		if (moneyFlowOpen.value) void load();
		return () => globalThis.removeEventListener?.(MONEY_FLOW_OPEN_EVENT, onOpen);
	}, [load]);

	if (!moneyFlowOpen.value) return null;

	return (
		<MoneyFlowPopover
			open={moneyFlowOpen.value}
			onOpenChange={(open) => (open ? rememberOpen(true) : closeMoneyFlow())}
			title="Money Flow"
			scope={flowScope.value}
			scopes={flowScopes.value}
			onScopeChange={(scope) => {
				flowScope.value = scope;
				flowSelectedWalletId.value = scope.id;
			}}
			wallets={flowWallets.value}
			selectedWalletId={flowSelectedWalletId.value}
			onSelectWallet={(id) => (flowSelectedWalletId.value = id)}
			legs={flowLegs.value}
			busy={flowBusy.value}
			error={flowError.value}
			// No simulate or force-balance endpoint exists: the `finance.*` money functions are the
			// deferred live path. The debugger states that rather than fabricating a trace — an invented
			// escrow leg is precisely the kind of plausible-and-wrong artefact an operator would trust.
			onSimulate={() => {
				flowError.value =
					"Simulation needs the finance money functions, which are not wired yet. Balances above are live.";
			}}
			onSetBalance={() => {
				flowError.value =
					"Forcing a balance needs the finance money functions, which are not wired yet.";
			}}
			onResetTrace={() => {
				flowLegs.value = [];
				flowError.value = null;
			}}
			defaultPosition={moneyFlowPosition.value ?? undefined}
			onPositionChange={rememberPosition}
			defaultSize={moneyFlowSize.value ?? undefined}
			onSizeChange={rememberSize}
		/>
	);
}

// #region Wallet → flow mapping
/** The `scope:id` key a wallet reference is addressed by, matching the wallet's own `?w=` vocabulary. */
function walletKey(ref: WalletRef): string {
	return ref.scope === "personal" || ref.scope === "aggregate"
		? ref.scope
		: `${ref.scope}:${ref.id}`;
}

/**
 * Map a wallet scope onto the debugger's three-kind vocabulary.
 *
 * An **organisation** folds to `business`: the debugger's kinds describe how a principal SPENDS
 * (individually, as a team, as a company), and an organisation spends as a company. `aggregate` is a
 * read-only rollup rather than a principal and is filtered out before this is called.
 */
function scopeKindOf(scope: WalletRef["scope"]): FlowScopeKind {
	if (scope === "team") return "team";
	if (scope === "business" || scope === "organisation") return "business";
	return "user";
}
// #endregion
