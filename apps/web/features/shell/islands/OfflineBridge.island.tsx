import type { JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { Dialog, Ribbon, Toast, useToast } from "@projective/ui/feedback";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import "../styles/offline.css";
import { isOnline, watchNetwork } from "@web/utils/network.ts";
import {
	installOfflineFetchGuard,
	installOfflineNavigationGuard,
} from "@web/utils/offline-guards.ts";
import {
	blockedNavigation,
	dismissBlockedNavigation,
	lastWriteRefusal,
	offlineModalOpen,
} from "@web/utils/offline-state.ts";
import {
	OFFLINE_NAV_BODY,
	OFFLINE_NAV_TITLE,
	OFFLINE_RIBBON_TEXT,
	ONLINE_RIBBON_TEXT,
} from "@web/utils/offline.ts";

/**
 * OfflineBridge — the one hydration root that turns "the browser is offline" into behaviour.
 *
 * Mounted once, globally, from `routes/_app.tsx` beside the other bridges, because connectivity is a
 * property of the SESSION and not of any route: a guest reading a listing and an owner editing a
 * project lose the network the same way. It does four things, and renders nothing visible while the
 * connection is fine:
 *
 * 1. Keeps the shared `isOnline` signal (`utils/network.ts`) in step with the browser.
 * 2. Installs the two guards (`utils/offline-guards.ts`): the delegated click listener that owns
 *    internal navigations, and the `fetch` wrapper that refuses user-facing writes.
 * 3. Draws the status **Ribbon** — pinned to the bottom, "You are offline…" while the connection is
 *    gone and a brief "Back online." when it returns — which also reserves its own height for the
 *    footer bands and toast stacks beneath it. By default the strip is EMPTY: "Back online." is a
 *    transition OUT of an offline state, never a greeting, and until an outage has actually been
 *    established the strip is handed no words at all.
 * 4. Hosts the offline **interstitial**: the `Dialog` a refused navigation opens, on the heavy scrim
 *    tier, with the same words the service worker's fallback page uses; and the notice stack that
 *    says a write was not sent.
 *
 * ## What it does NOT do
 *
 * It queues nothing. The project editor already owns an offline-first write queue
 * (`features/projects/core/offline-queue.ts`) and checks `isOnline` BEFORE it sends, so its writes
 * never reach the guard; every other write is refused with a sentence, because replaying a POST
 * this bridge did not understand is how a purchase happens twice. And it never supersedes the
 * service worker's fallback page — a navigation no in-page listener can see (a cold load, a
 * programmatic `location.assign`, a click an island stopped propagating) still lands there.
 */

// #region Constants
/** How long the "Back online." confirmation stays before the strip withdraws. */
const RESTORED_MS = 2_500;

/** Refused writes closer together than this share one notice. */
const REFUSAL_DEDUPE_MS = 4_000;

type RibbonPhase = "hidden" | "offline" | "restored";

/** The two phases that put words on the strip. */
type RibbonNotice = Exclude<RibbonPhase, "hidden">;

/**
 * The strip's phase on the FIRST client render. Read from the browser directly rather than from the
 * signal (which starts optimistic) so a page opened while already offline hydrates with the strip
 * open — and keeps the `data-ribbon` reservation `_app.tsx` pre-painted — instead of first closing
 * it and then re-opening it a frame later, which moved the footer band down and back up under the
 * reader. Under SSR there is no `navigator`, and the strip renders closed and empty.
 */
function initialPhase(): RibbonPhase {
	const nav = (globalThis as { navigator?: { onLine?: boolean } }).navigator;
	return nav?.onLine === false ? "offline" : "hidden";
}
// #endregion

export default function OfflineBridge(): JSX.Element {
	const initial = initialPhase();
	const phase = useSignal<RibbonPhase>(initial);
	/**
	 * The last notice the strip carried, held across the `hidden` phase so the exit slide leaves with
	 * the words it arrived with. `null` until the first offline state — and while it is null the strip
	 * is given no content, so "Back online." cannot be drawn before an outage has actually happened,
	 * whatever the phase machine does.
	 */
	const lastNotice = useSignal<RibbonNotice | null>(initial === "offline" ? "offline" : null);
	/** Mounted only once there is a notice, and never beside a stack another island already put up. */
	const toastMounted = useSignal(false);
	const toast = useToast();
	const footerRef = useRef<HTMLDivElement>(null);
	const restoredTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const lastRefusalShown = useRef(0);

	// #region Wiring
	useEffect(() => {
		const stopNetwork = watchNetwork();
		const uninstallFetch = installOfflineFetchGuard();
		const uninstallNav = installOfflineNavigationGuard();

		const clearRestored = () => {
			if (restoredTimer.current !== null) {
				clearTimeout(restoredTimer.current);
				restoredTimer.current = null;
			}
		};
		const show = (notice: RibbonNotice) => {
			lastNotice.value = notice;
			phase.value = notice;
		};

		// `subscribe` fires once with the current value: a page opened while already offline shows the
		// strip immediately, while a page opened online shows nothing — the "restored" confirmation
		// is only ever a transition OUT of "offline", never a greeting.
		const stopPhase = isOnline.subscribe((online) => {
			if (!online) {
				clearRestored();
				show("offline");
				return;
			}
			if (phase.peek() !== "offline") return;
			show("restored");
			restoredTimer.current = setTimeout(() => {
				phase.value = "hidden";
				restoredTimer.current = null;
			}, RESTORED_MS);
		});

		// A refused write → one notice. The guard only ever records the LATEST refusal; a burst inside
		// the window is one sentence, because the reader owes one action, not three.
		const stopRefusals = lastWriteRefusal.subscribe((refusal) => {
			if (!refusal) return;
			if (refusal.at - lastRefusalShown.current < REFUSAL_DEDUPE_MS) return;
			lastRefusalShown.current = refusal.at;
			// A stack already on the page renders from the same module-level signal, so pushing into it
			// is enough; a second one at the same anchor would draw every toast twice.
			if (!document.querySelector(".ui-toast")) toastMounted.value = true;
			toast.show({
				severity: "warning",
				summary: "You are offline",
				detail: refusal.message,
				life: 5_000,
			});
		});

		return () => {
			stopRefusals();
			stopPhase();
			clearRestored();
			uninstallNav();
			uninstallFetch();
			stopNetwork();
		};
		// Everything above reads signals or refs; nothing here has a render-time identity to track.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);
	// #endregion

	// #region Interstitial
	const online = isOnline.value;
	const dest = blockedNavigation.value;

	const stay = () => dismissBlockedNavigation();
	const proceed = () => {
		const href = dest?.href;
		dismissBlockedNavigation();
		if (href) location.assign(href);
	};
	// #endregion

	// #region Ribbon content
	// The words are the LAST notice's, not a function of "online right now": while hidden the strip
	// keeps them only for the exit slide, and before any outage there are none to keep.
	const current = phase.value;
	const notice = current === "hidden" ? lastNotice.value : current;
	const offline = notice === "offline";
	// #endregion

	return (
		<>
			<Ribbon
				visible={current !== "hidden"}
				live={offline ? "assertive" : "polite"}
				icon={notice ? <Icon name={offline ? "cloud-off" : "check"} /> : null}
				text={notice ? (offline ? OFFLINE_RIBBON_TEXT : ONLINE_RIBBON_TEXT) : undefined}
			/>

			<Dialog
				visible={offlineModalOpen}
				onVisibleChange={(open) => {
					if (!open) dismissBlockedNavigation();
				}}
				role="alertdialog"
				header={OFFLINE_NAV_TITLE}
				backdropIntensity="heavy"
				width="28rem"
				initialFocusRef={footerRef}
				class="offline-interstitial"
				footer={
					<div ref={footerRef} class="offline-interstitial__actions">
						{
							/* Appears only once the connection is back: a control that navigates into the dark
						    would be a control that reaches nothing. Then it is the primary — the reader
						    asked to go somewhere, and now they can. */
						}
						{online && dest && <Button label="Continue to page" onClick={proceed} />}
						<Button
							variant={online && dest ? "outlined" : "filled"}
							label="Stay on this page"
							onClick={stay}
						/>
					</div>
				}
			>
				<p class="offline-interstitial__body">{OFFLINE_NAV_BODY}</p>
			</Dialog>

			{toastMounted.value ? <Toast position="bottom-center" /> : null}
		</>
	);
}
