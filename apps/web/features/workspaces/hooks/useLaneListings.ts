import { type Signal, useSignal } from "@preact/signals";
import { CatalogueService } from "@features/catalogue/core/CatalogueService.ts";
import { LANE_LISTING_PARAMS, laneListingsOf, type LaneListingsRead } from "../core/lane-model.ts";

/** Where the lane's Catalogue read stands: not asked for yet, in flight, or answered. */
export type LaneListingsState =
	| { phase: "idle" }
	| { phase: "loading" }
	| { phase: "done"; read: LaneListingsRead };

/** The Catalogue section's read and the two ways to ask for it. */
export interface LaneListingsHandle {
	state: Signal<LaneListingsState>;
	/** Read the listings once: a no-op while a read is in flight or has been answered. */
	ensure: () => void;
	/** Read them again — the failure state's Try again. */
	reload: () => void;
}

/**
 * useLaneListings — the team lane's Catalogue listings (Decision #316). A team catalogue route seeds
 * them from the first byte; anywhere else nothing is read until the section is opened, so a console
 * page never pays for a catalogue read its reader did not ask for. Reads as `team` through
 * `/api/catalogue/list?team=`, which verifies the viewer before answering.
 *
 * @param team The team's handle, or `null` when the lane has no Catalogue section.
 * @param seed The server's read, when the page rendered one.
 */
export function useLaneListings(
	team: string | null,
	seed: LaneListingsRead | null,
): LaneListingsHandle {
	const state = useSignal<LaneListingsState>(
		seed ? { phase: "done", read: seed } : { phase: "idle" },
	);

	const load = async (): Promise<void> => {
		if (!team) return;
		state.value = { phase: "loading" };
		const res = await CatalogueService.list(LANE_LISTING_PARAMS, team);
		state.value = {
			phase: "done",
			read: res.ok && res.data
				? { ok: true, listings: laneListingsOf(res.data.page) }
				: { ok: false, message: res.message ?? "We couldn't load the listings just now." },
		};
	};

	return {
		state,
		ensure: () => {
			if (state.peek().phase === "idle") void load();
		},
		reload: () => {
			if (state.peek().phase !== "loading") void load();
		},
	};
}
