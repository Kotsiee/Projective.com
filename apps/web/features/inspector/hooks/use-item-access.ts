import { useEffect, useMemo } from "preact/hooks";
import {
	accessStoreFor,
	type ItemAccessStore,
	loadAccess,
	storeDirty,
} from "../core/access-store.ts";

/**
 * Bind the Access tab to one file's {@link ItemAccessStore}: read it the first time the tab shows
 * (never before), mark a signed-out visitor without asking, and hold the page while a draft is unsaved.
 */
export function useItemAccess(itemId: string, signedIn: boolean): ItemAccessStore {
	const store = useMemo(() => accessStoreFor(itemId), [itemId]);

	useEffect(() => {
		if (!signedIn) {
			store.phase.value = "signed-out";
			return;
		}
		const phase = store.phase.peek();
		if (phase === "idle" || phase === "signed-out") void loadAccess(store);
	}, [store, signedIn]);

	useEffect(() => {
		const onLeave = (e: BeforeUnloadEvent) => {
			if (!storeDirty(store)) return;
			e.preventDefault();
			e.returnValue = "";
		};
		globalThis.addEventListener("beforeunload", onLeave);
		return () => globalThis.removeEventListener("beforeunload", onLeave);
	}, [store]);

	return store;
}
