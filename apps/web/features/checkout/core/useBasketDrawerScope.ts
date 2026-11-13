import { type Signal, useSignal } from "@preact/signals";
import { useCallback, useEffect, useRef } from "preact/hooks";
import { LocalKeys, readStored, removeStored } from "@web/utils/storage-keys.ts";
import { type DevBasketScenario, readDevSeam, subscribeDevSeam } from "@web/utils/dev-seam.ts";
import { type BasketPayload, BasketService } from "./BasketService.ts";
import { isCheckoutPath } from "./basket-model.ts";
import {
	activeBasketId,
	activeOwner,
	applyBasket,
	applyResponse,
	basket as basketSignal,
	BASKET_REFRESH_EVENT,
	chosenCardId,
	chosenProvider,
	currentCheckoutContext,
	owners as ownersSignal,
	rememberedBasketId,
	resetAttempt,
} from "./basket-state.ts";
import { devBasket, devOwners, devReadScope } from "./dev-basket.ts";

/** How the drawer's own read is going — distinct from whether the basket happens to be empty. */
export type BasketLoadPhase = "idle" | "loading" | "ready" | "error";

/** What {@link useBasketDrawerScope} hands the drawer's panel. */
export interface BasketDrawerScope {
	phase: Signal<BasketLoadPhase>;
	/** The latest read or write refusal, in the server's own words; `null` when nothing failed. */
	failure: Signal<string | null>;
	/** The Dev Context Switcher's basket scenario, re-read whenever the seam changes. */
	scenario: Signal<DevBasketScenario | undefined>;
	/** Re-read the basket and the owners for whatever scope is live. */
	load: (background?: boolean) => Promise<void>;
}

/**
 * useBasketDrawerScope — the header basket's data half, run by the always-mounted `BasketDrawer` host
 * so the header's basket dot is right from the first paint, while the drawer's UI loads lazily.
 *
 * **Scope.** On the checkout routes the URL owns `?owner=` / `?basket=`, so the host never seeds the
 * store there. Off them the switcher's choice is a per-viewer preference (`LocalKeys.BASKET_OWNER`),
 * cleared when the shell's acting context changes — which also drops the chosen provider, card and
 * attempt key, all of which belonged to the previous principal.
 *
 * **Reads.** Once on mount (skipped when a surface already painted a basket, and on `/checkout`, whose
 * page seeds the store itself), on every open, on `BASKET_REFRESH_EVENT`, and on a dev-seam change.
 * `background` marks a read the buyer did not ask for: a dead session then fails it into the error
 * state rather than bouncing the page to `/login`. A failed read is recorded here, never folded into
 * the shared `checkoutError`, which belongs to `/checkout`'s body.
 */
export function useBasketDrawerScope(open: Signal<boolean>, owner: string): BasketDrawerScope {
	const phase = useSignal<BasketLoadPhase>("idle");
	const failure = useSignal<string | null>(null);
	const scenario = useSignal<DevBasketScenario | undefined>(readDevSeam()?.basketScenario);
	const shellOwner = useRef(owner);
	shellOwner.current = owner;

	const load = useCallback(async (background = false): Promise<void> => {
		if (phase.value !== "ready") phase.value = "loading";
		const ctx = currentCheckoutContext();
		const [res, ownersRes] = await Promise.all([
			BasketService.get(
				{ ...ctx, ...devReadScope(ctx.owner, ctx.basketId, ownersSignal.peek()) },
				{ background },
			),
			BasketService.owners(ctx, { background }),
		]);
		if (ownersRes.ok && ownersRes.data) ownersSignal.value = ownersRes.data;
		const listed = devOwners(ownersSignal.value, scenario.value)
			.find((entry) => entry.owner === ctx.owner);
		if (
			ownersRes.ok && !listed && ctx.owner !== shellOwner.current &&
			!isCheckoutPath(globalThis.location.pathname)
		) {
			removeStored("local", LocalKeys.BASKET_OWNER);
			activeOwner.value = shellOwner.current;
			activeBasketId.value = null;
			return load(background);
		}
		const asked = listed?.baskets.find((b) => b.id === ctx.basketId) ?? null;
		const landed = applyResponse(res, (data: BasketPayload) =>
			applyBasket({
				...data,
				basket: devBasket(data.basket, scenario.value, { ...ctx, summary: asked }),
			}));
		failure.value = landed ? null : (res.message ?? "We couldn't read your basket just now.");
		phase.value = landed ? "ready" : "error";
	}, []);

	const lastOwner = useRef<string | null>(null);
	useEffect(() => {
		const path = globalThis.location?.pathname ?? "";
		const onCheckout = isCheckoutPath(path);
		const first = lastOwner.current === null;
		const rescoped = !first && lastOwner.current !== owner;
		lastOwner.current = owner;

		if (!onCheckout && first) {
			const remembered = readStored("local", LocalKeys.BASKET_OWNER);
			activeOwner.value = remembered || owner;
			activeBasketId.value = remembered ? rememberedBasketId() : null;
		}

		if (rescoped && !onCheckout) {
			removeStored("local", LocalKeys.BASKET_OWNER);
			activeOwner.value = owner;
			activeBasketId.value = null;
			chosenProvider.value = null;
			chosenCardId.value = null;
			resetAttempt();
			void load(true);
		}

		if (!rescoped && basketSignal.value === null && !onCheckout) void load(true);

		const onRefresh = () => void load(true);
		globalThis.addEventListener?.(BASKET_REFRESH_EVENT, onRefresh);
		const unsubscribe = subscribeDevSeam((seam) => {
			scenario.value = seam?.basketScenario;
			void load(true);
		});
		return () => {
			globalThis.removeEventListener?.(BASKET_REFRESH_EVENT, onRefresh);
			unsubscribe();
		};
	}, [owner, load]);

	useEffect(() => {
		if (open.value) void load();
	}, [open.value, load]);

	return { phase, failure, scenario, load };
}
