import { type Signal, signal } from "@preact/signals";
import { type SavedEntityType, savedKey } from "@projective/types/org";
import type { ExploreEntity } from "@projective/types/explore";
import { subscribeDevSeam } from "@web/utils/dev-seam.ts";
import { SavedService } from "./SavedService.ts";
import { optimistic, type ToggleOutcome } from "./optimistic.ts";

export type { ToggleOutcome };

/**
 * saved-state — the client half every star / save control shares (Decision #180).
 *
 * {@link toggleSaved} is the one optimistic write: flip at once, persist through `/api/saved`, roll
 * back on refusal, and hand back the sentence to announce. Controls whose own read already carries the
 * flag (a project's `starred`, a message's `favorited`, a file's `starred`, a channel's `starred`) pass
 * their own setter. Cards and lanes whose read does NOT (an Explore listing or profile, the view lanes)
 * read a shared {@link savedFlag}: the first one asked on a page queues a key, and one batched
 * `GET /api/saved/state` answers every key queued in the same tick — a grid of 40 cards is one request.
 */

/** The saved kind of an Explore entity — the four profile shapes are one kind, `profile`. */
export function savedTypeOf(entity: ExploreEntity): SavedEntityType {
	switch (entity) {
		case "services":
			return "service";
		case "products":
			return "product";
		case "articles":
			return "article";
		case "projects":
			return "project";
		default:
			return "profile";
	}
}

/**
 * Save or un-save optimistically. `apply` writes the visible state; it is called with `next` at once
 * and with `!next` again if the server refuses. A second press while one is in flight is dropped.
 */
export function toggleSaved(
	type: SavedEntityType,
	ref: string,
	next: boolean,
	apply: (saved: boolean) => void,
): Promise<ToggleOutcome> {
	return optimistic(
		savedKey(type, ref),
		next,
		apply,
		() => SavedService.toggle({ type, ref, saved: next }),
		next ? "Saved." : "Removed from saved.",
	);
}

// #region Shared flags (cards and lanes)

/** `null` = not known yet (the batched read has not answered). */
type Flag = Signal<boolean | null>;

const flags = new Map<string, Flag>();
const queued = new Set<string>();
let scheduled = false;

async function flush(): Promise<void> {
	scheduled = false;
	const keys = [...queued];
	queued.clear();
	for (let i = 0; i < keys.length; i += 100) {
		const batch = keys.slice(i, i + 100);
		const saved = await SavedService.state(batch);
		// A failed lookup leaves the flags unknown rather than claiming "not saved".
		if (saved) { for (const k of batch) flags.get(k)!.value = saved.has(k); }
	}
}

/**
 * The shared saved flag for a listing, profile or project a card or lane shows. In the browser the
 * same key always answers the same signal, so two controls for one thing stay in step. On the server
 * every call is a fresh signal — module state there would be shared across requests.
 */
export function savedFlag(type: SavedEntityType, ref: string): Flag {
	if (typeof document === "undefined") return signal(null);
	const key = savedKey(type, ref);
	let flag = flags.get(key);
	if (!flag) {
		flag = signal<boolean | null>(null);
		flags.set(key, flag);
		queued.add(key);
		if (!scheduled) {
			scheduled = true;
			queueMicrotask(() => void flush());
		}
	}
	return flag;
}

/** Toggle a shared flag (see {@link savedFlag}) optimistically. */
export function toggleFlag(type: SavedEntityType, ref: string): Promise<ToggleOutcome> {
	const flag = savedFlag(type, ref);
	return toggleSaved(type, ref, !flag.value, (v) => (flag.value = v));
}

/** Forget every known flag so the next read asks again — after the dev axis changes the saved set. */
function resetSavedFlags(): void {
	for (const [key, flag] of flags) {
		flag.value = null;
		queued.add(key);
	}
	if (!scheduled && queued.size > 0) {
		scheduled = true;
		queueMicrotask(() => void flush());
	}
}

subscribeDevSeam(resetSavedFlags);

// #endregion
