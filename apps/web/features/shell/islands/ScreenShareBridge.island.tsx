import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { Toast, useToast } from "@projective/ui/feedback";
import { screenShareActive, setScreenShareActive } from "@projective/ui/utils/screen-share";
import { LocalKeys } from "@web/utils/storage-keys.ts";
import { SCREEN_SHARE_COOKIE_ON } from "@web/utils/screen-share-context.ts";
import {
	persistScreenShare,
	readDeviceScreenShare,
	restoreServerNodes,
	SCREEN_SHARE_ANNOUNCEMENT,
	SCREEN_SHARE_EVENT,
	type ScreenShareRequest,
	sweepServerNodes,
	writeScreenShareAttribute,
} from "@web/features/shell/core/screen-share-state.ts";

const KEPT_SUMMARY = "Some details stay hidden";
const KEPT_DETAIL =
	"They were hidden before this page loaded, so they show again the next time you open it.";

/**
 * ScreenShareBridge — the one owner of a screen sharing mode change (Decision #297). Renders only a
 * polite live region (and a toast stack when it needs one).
 *
 * A change arrives as a `pj:screen-share` event (`setScreenShareMode`, devtools) or as another tab's
 * `storage` event, and is applied in order: store → attribute → sweep or restore → cookie →
 * `localStorage` → announcement. Mounted in `_app.tsx`, so every route has it.
 */
export default function ScreenShareBridge(): JSX.Element {
	const announcement = useSignal("");
	const toastMounted = useSignal(false);
	const toast = useToast();

	useEffect(() => {
		function change(next: boolean, persist: boolean): void {
			if (next === screenShareActive.value) {
				if (persist) persistScreenShare(next);
				return;
			}
			setScreenShareActive(next);
			writeScreenShareAttribute(next);
			let kept = 0;
			if (next) sweepServerNodes();
			else kept = restoreServerNodes();
			if (persist) persistScreenShare(next);
			announcement.value = next ? SCREEN_SHARE_ANNOUNCEMENT.on : SCREEN_SHARE_ANNOUNCEMENT.off;
			if (kept > 0) {
				if (!toastMounted.value && !document.querySelector(".ui-toast")) toastMounted.value = true;
				toast.show({ severity: "info", summary: KEPT_SUMMARY, detail: KEPT_DETAIL, life: 6000 });
			}
		}

		function onRequest(event: Event): void {
			const active = (event as CustomEvent<ScreenShareRequest | null>).detail?.active;
			change(typeof active === "boolean" ? active : !screenShareActive.value, true);
		}

		function onStorage(event: StorageEvent): void {
			if (event.key !== null && event.key !== LocalKeys.SCREEN_SHARE) return;
			change(event.key !== null && event.newValue === SCREEN_SHARE_COOKIE_ON, false);
		}

		function onPageShow(event: PageTransitionEvent): void {
			if (event.persisted) change(readDeviceScreenShare(), false);
		}

		let sweepTimer: ReturnType<typeof setTimeout> | undefined;
		function sweepAfterHydration(): void {
			sweepTimer = setTimeout(() => {
				if (screenShareActive.value) sweepServerNodes();
			}, 0);
		}

		if (readDeviceScreenShare()) {
			setScreenShareActive(true);
			writeScreenShareAttribute(true);
			persistScreenShare(true);
			if (document.readyState === "complete") sweepAfterHydration();
			else addEventListener("load", sweepAfterHydration, { once: true });
		}

		document.addEventListener(SCREEN_SHARE_EVENT, onRequest);
		addEventListener("storage", onStorage);
		addEventListener("pageshow", onPageShow);
		return () => {
			clearTimeout(sweepTimer);
			removeEventListener("load", sweepAfterHydration);
			document.removeEventListener(SCREEN_SHARE_EVENT, onRequest);
			removeEventListener("storage", onStorage);
			removeEventListener("pageshow", onPageShow);
		};
	}, []);

	return (
		<>
			<span class="ui-visually-hidden" role="status" aria-live="polite">
				{announcement.value}
			</span>
			{toastMounted.value ? <Toast position="bottom-center" /> : null}
		</>
	);
}
