import { signal } from "@preact/signals";
import { catalogueSim } from "@web/utils/dev-seam.ts";
import type {
	CohortCancellation,
	ListingCohorts,
	OpenCohortInput,
} from "@projective/types/projects";
import { getCatalogue, postCatalogue } from "./api.ts";
import { cancelCohortPath, cohortsPath } from "./cohort-model.ts";
import { setWorkspaceUrl, workspaceUrl } from "./workspace-store.ts";
import type { CohortDialog } from "../types/catalogue-types.ts";

/**
 * cohort-store — the Cohorts block's state (Decision #498): the listing's cohorts as the server last
 * answered them, and the two writes. Which dialog is open lives only in the URL (`?cohort=`), through
 * the workspace's own URL setter; nothing here holds a second copy. Every figure and every "may I
 * cancel" is the server's.
 */

/** The listing's cohorts; `null` until the first read answers. */
export const cohorts = signal<ListingCohorts | null>(null);
/** Why the read failed, when it did. */
export const cohortsError = signal<string | null>(null);
/** A write is in flight. */
export const cohortBusy = signal(false);
/** What the last write did, said once in the block's live region. */
export const cohortNotice = signal<string | null>(null);

/** Read the listing's cohorts (with the `clientPipeline` dev axis when set). */
export async function loadCohorts(listing: string): Promise<void> {
	cohortsError.value = null;
	const res = await getCatalogue<ListingCohorts>(
		cohortsPath(listing, catalogueSim("clientPipeline")),
	);
	if (res.ok && res.data) cohorts.value = res.data;
	else cohortsError.value = res.message ?? "We couldn't load this listing's cohorts.";
}

/** Open or close the cohort dialog: opening pushes a history entry, closing replaces it. */
export function setCohortDialog(dialog: CohortDialog | undefined): void {
	if (dialog) setWorkspaceUrl({ tab: "edit", section: "availability", cohort: dialog }, "push");
	else setWorkspaceUrl({ cohort: undefined }, "replace");
}

/** The dialog the URL names now. */
export function cohortDialog(): CohortDialog | undefined {
	return workspaceUrl.value.cohort;
}

/**
 * Open the next cohort. Answers the server's refusal (and field errors) for the form to show; on
 * success the block holds the cohorts as they now stand and the dialog closes.
 */
export async function openCohort(
	input: OpenCohortInput,
): Promise<{ ok: true } | { ok: false; message: string; errors?: Record<string, string> }> {
	if (cohortBusy.peek()) return { ok: false, message: "Still working on the last change." };
	cohortBusy.value = true;
	try {
		const res = await postCatalogue<ListingCohorts>("/api/catalogue/cohorts", input);
		if (!res.ok || !res.data) {
			return {
				ok: false,
				message: res.message ?? "The cohort couldn't be opened.",
				errors: res.errors,
			};
		}
		cohorts.value = res.data;
		cohortNotice.value =
			"Cohort open. Buyers can reserve a seat now, and the waitlist is invited first.";
		setCohortDialog(undefined);
		return { ok: true };
	} finally {
		cohortBusy.value = false;
	}
}

/** Cancel one cohort before it starts; every seat is refunded in full by the server. */
export async function cancelCohort(
	listing: string,
	cohortId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
	if (cohortBusy.peek()) return { ok: false, message: "Still working on the last change." };
	cohortBusy.value = true;
	try {
		const res = await postCatalogue<{ cancellation: CohortCancellation; cohorts: ListingCohorts }>(
			cancelCohortPath(cohortId),
			{ listing },
		);
		if (!res.ok || !res.data) {
			return { ok: false, message: res.message ?? "The cohort couldn't be cancelled." };
		}
		cohorts.value = res.data.cohorts;
		cohortNotice.value = cancelledNotice(res.data.cancellation);
		setCohortDialog(undefined);
		return { ok: true };
	} finally {
		cohortBusy.value = false;
	}
}

function cancelledNotice(c: CohortCancellation): string {
	if (c.seatsRefunded === 0) return "Cohort cancelled. Nobody had booked a seat.";
	return `Cohort cancelled. ${c.seatsRefunded} ${
		c.seatsRefunded === 1 ? "seat was" : "seats were"
	} refunded in full.`;
}
