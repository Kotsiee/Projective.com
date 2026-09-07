import { useEffect } from "preact/hooks";
import { IS_DEV } from "@web/utils/dev.ts";

/**
 * ServiceWorkerBridge — registers `/sw.js` in production, and actively removes it everywhere else.
 *
 * Renders nothing. It is mounted once, globally, from `routes/_app.tsx`, because the shell cache is a
 * property of the ORIGIN rather than of any one route: registering it from the surface that needs it
 * (the project editor) would mean the offline shell only ever existed for somebody who had already
 * visited that page online, which is the one case where they did not need it.
 *
 * ## The dev branch is the important half
 *
 * A service worker outlives the page that registered it, the tab, and the build. A developer who
 * runs a production build locally once has that worker intercepting `localhost` for every project
 * they open afterwards, serving cached bundles from an unrelated app and producing failures that
 * look like anything except a stale worker — and the standard advice ("hard refresh") does not
 * remove it. So development does not merely skip registration: it unregisters whatever is there.
 * That is why this branch cannot be `if (IS_DEV) return;`.
 *
 * The registration itself is deliberately unconditional on outcome. A browser with service workers
 * disabled by policy, a private window, and an insecure origin all reject or throw, and every one of
 * those is a perfectly good state for this app — the offline shell is an enhancement, and the queue
 * in `features/projects/core/offline-queue.ts` works without it.
 */
export default function ServiceWorkerBridge(): null {
	useEffect(() => {
		// `serviceWorker` is absent on an insecure origin and in some embedded webviews. Absence is not
		// a failure — the site works, it simply has no shell cache.
		if (!("serviceWorker" in navigator)) return;

		if (IS_DEV) {
			// See the docblock: remove, do not skip.
			void navigator.serviceWorker.getRegistrations()
				.then((registrations) => Promise.all(registrations.map((r) => r.unregister())))
				.catch(() => {});
			return;
		}

		/*
		 * Registered after `load` rather than during hydration.
		 *
		 * The install fetches nothing (there is no precache manifest), but the registration itself
		 * competes with the page's own bundles for the connection, and the one thing a caching layer
		 * must never do is make the first visit — the visit that has nothing cached — slower.
		 */
		const register = () => {
			void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
		};

		if (document.readyState === "complete") {
			register();
			return;
		}
		globalThis.addEventListener("load", register, { once: true });
		return () => globalThis.removeEventListener("load", register);
	}, []);

	return null;
}
