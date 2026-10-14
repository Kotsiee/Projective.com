import { z } from "zod";
import { ListingStatus } from "./catalogue.ts";

/**
 * catalogue.batch — one action applied to many listings from the console's batch bar.
 *
 * A batch is not all-or-nothing: each listing passes or fails on its own (a draft without a cover
 * cannot publish even when its neighbours can), so the response is one outcome per listing.
 */

// #region Input
/** The most listings one batch acts on. */
export const BATCH_MAX = 100;

/** What the batch does to each listing. */
export const BatchActionSchema = z.discriminatedUnion("action", [
	z.object({ action: z.literal("status"), status: ListingStatus }),
	z.object({ action: z.literal("collection"), name: z.string().trim().min(1).max(80) }),
	z.object({ action: z.literal("duplicate") }),
]);
export type BatchAction = z.infer<typeof BatchActionSchema>;

/** A batch request: the listing slugs and the action, flat (`{ ids, action: "status", status }`). */
export const BatchInputSchema = z.intersection(
	z.object({
		ids: z.array(z.string().min(1).max(120)).min(1).max(BATCH_MAX)
			.refine((ids) => new Set(ids).size === ids.length, "Each listing can appear only once."),
	}),
	BatchActionSchema,
);
export type BatchInput = z.infer<typeof BatchInputSchema>;
// #endregion

// #region Outcome
/** How one listing fared. */
export const BatchOutcomeSchema = z.object({
	id: z.string().min(1).max(120),
	ok: z.boolean(),
	/** The refusal code when `ok` is false (`PG422`, `publish_gate`, …). */
	code: z.string().max(40).optional(),
	/** A short sentence the batch bar shows for a failure. */
	message: z.string().max(240).optional(),
});
export type BatchOutcome = z.infer<typeof BatchOutcomeSchema>;
// #endregion
