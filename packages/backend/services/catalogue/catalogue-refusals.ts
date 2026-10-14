import type { BatchOutcome } from "@projective/types/catalogue";
import { RESTRICTED_REFUSAL } from "@projective/types/auth";
import { AGE_RESTRICTED, isAgeRestricted } from "../../core/age-gate.ts";
import { fail, type ServiceResult } from "../ServiceResult.ts";

/**
 * catalogue-refusals — what the catalogue doors' refusals mean to a caller.
 *
 * Each `catalogue.*` door raises a SQLSTATE and, where a field is at fault, names it in the DETAIL.
 * This module turns those into {@link ServiceResult}s (one write) and {@link BatchOutcome}s (one row of
 * a batch). Pure, so the mapping is tested without a database.
 */

// #region Codes
/** A PostgREST error as the doors raise it. */
export interface DoorError {
	code?: string;
	message: string;
	details?: string | null;
}

/** The sentence a stale save is answered with. */
export const LISTING_CONFLICT_MESSAGE = "This listing changed in another tab.";

const PUBLISH_GATE = "PG422";
const STALE = "PC409";
const NOT_FOUND = "PB404";
const NOT_ALLOWED = "42501";
const INVALID = new Set(["22023", "23514", "23505", "22P02"]);

/** `stage_template.2` → `stageTemplate.2`: the DETAIL's key, as a field path. */
function fieldOf(detail: string): string {
	const [head, ...rest] = detail.split(".");
	return [head.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()), ...rest].join(".");
}

function sentence(message: string, fallback: string): string {
	return message.replace(/\s+/g, " ").trim().slice(0, 200) || fallback;
}

/** What the publish gate's DETAIL (`a cover image|a price`) lists as missing. */
export function gateMissing(detail: string | null | undefined): string[] {
	return (detail ?? "").split("|").map((s) => s.trim()).filter(Boolean);
}
// #endregion

// #region One write
/**
 * A door refusal as the result a route returns. A stale `expected_updated_at` is a 409 carrying the
 * listing's CURRENT `updated_at`, so the editor can reload without a second read. A refusal the
 * caller cannot act on (the database being unavailable) is thrown, for the service's guard to answer
 * as a 503.
 */
export function refusalOf<T>(error: DoorError): ServiceResult<T> {
	if (isAgeRestricted(error)) {
		return fail(AGE_RESTRICTED.status, { message: AGE_RESTRICTED.message });
	}
	const message = sentence(error.message, "That didn't save.");
	switch (error.code) {
		case STALE: {
			const current = (error.details ?? "").replace(/^stale:/, "");
			return fail(409, {
				message: LISTING_CONFLICT_MESSAGE,
				details: { current: current || null },
			});
		}
		case PUBLISH_GATE: {
			if (error.details === "tags_max") return fail(422, { message, errors: { tags: message } });
			return fail(422, { message, errors: { publish: gateMissing(error.details).join(", ") } });
		}
		case NOT_FOUND:
			return fail(404, { message: "No such listing." });
		case NOT_ALLOWED:
			return fail(403, { message });
	}
	if (error.code && INVALID.has(error.code)) {
		return fail(422, {
			message,
			errors: error.details ? { [fieldOf(error.details)]: message } : undefined,
		});
	}
	throw new Error(message);
}
// #endregion

// #region Batch
/** One row of `catalogue.set_listings_status`. */
export interface BatchRow {
	listing_id: string;
	ok: boolean;
	code: string | null;
	detail: string | null;
	message: string | null;
}

function batchMessage(row: BatchRow): string {
	switch (row.code) {
		case PUBLISH_GATE: {
			const missing = gateMissing(row.detail);
			return missing.length
				? `Can't publish yet: add ${missing.join(", ")}.`
				: "This listing can't be published yet.";
		}
		case "PM403":
			return RESTRICTED_REFUSAL;
		case NOT_ALLOWED:
			return "You can't change this listing.";
		case NOT_FOUND:
			return "This listing no longer exists.";
		default:
			return sentence(row.message ?? "", "That change didn't apply.").slice(0, 240);
	}
}

/**
 * The batch's per-row answer, addressed by slug (the console's listing address) and in the order the
 * caller sent them. A row the database did not answer for is reported as not applied, never as done.
 */
export function batchOutcomes(
	rows: readonly BatchRow[],
	requested: ReadonlyArray<{ slug: string; listingId: string | null }>,
): BatchOutcome[] {
	const byId = new Map(rows.map((r) => [r.listing_id, r]));
	return requested.map(({ slug, listingId }) => {
		const row = listingId ? byId.get(listingId) : undefined;
		if (!row) {
			return { id: slug, ok: false, code: NOT_FOUND, message: "This listing no longer exists." };
		}
		if (row.ok) return { id: slug, ok: true };
		return {
			id: slug,
			ok: false,
			code: (row.code ?? "unknown").slice(0, 40),
			message: batchMessage(row),
		};
	});
}
// #endregion
