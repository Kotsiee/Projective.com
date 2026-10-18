import { type BenchEntry, BenchEntrySchema, type BusinessBench } from "@projective/types/workspace";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { publicObjectUrl } from "../../core/storage-url.ts";
import { clamp, clampOr } from "../../core/text.ts";
import { callRpc, type LiveActor } from "./live-support.ts";
import { avatarOf, dateLabel, isoOf } from "./mappers.ts";

/**
 * live-bench — a business's bench, read live: the freelancers and teams it has hired (the Talent
 * module, Decision #230 (i), #241).
 *
 * `org.get_business_bench` is the module's ONE read. Under the caller's session it decides who may see
 * it (an active member holding `hire`), what counts as an engagement (a project billed to the business
 * on which the party holds a live or completed stage seat), how many there were, when the party last
 * delivered, the business's own rating of them, and — per row, for the caller — whether the party's
 * profile opens and whether the caller manages it; so this layer only bounds strings, builds the public
 * avatar URL and formats the date. A team's Message reaches its owner, whose handle rides the row. A
 * non-member or a member without `hire` is `forbidden`, an unknown reference `not_found`.
 */

// #region I/O seam

/** Everything the bench read reaches outside this module; a unit test stubs `rpc` to count calls. */
export interface BenchIo {
	rpc: typeof callRpc;
}

/** The live implementation of {@link BenchIo}. */
export const benchIo: BenchIo = { rpc: callRpc };

// #endregion

// #region Raw shapes

/** One bench row as `org.get_business_bench` answers it. */
export interface RawBenchEntry {
	kind: string;
	handle: string | null;
	name: string | null;
	avatar_bucket: string | null;
	avatar_path: string | null;
	contact_handle: string | null;
	contact_name: string | null;
	engagements: number | string | null;
	live_now: boolean | null;
	last_worked_at: string | null;
	rating_average: number | string | null;
	rating_count: number | string | null;
	profile_visible: boolean | null;
	viewer_manages: boolean | null;
}

/** The definer's answer: the entries, or why there are none to show this caller. */
export type RawBenchAnswer =
	| { status: "ok"; entries: RawBenchEntry[] | null }
	| { status: "not_found" }
	| { status: "forbidden" };

// #endregion

// #region Mapping

/** A mean rounded to two places, kept only inside the 1–5 scale reviews are written on. */
function averageOf(raw: number | string | null, count: number): number | null {
	if (count <= 0 || raw === null) return null;
	const value = Math.round(Number(raw) * 100) / 100;
	return Number.isFinite(value) && value >= 1 && value <= 5 ? value : null;
}

/**
 * One raw row → a {@link BenchEntry}, or `null` when its shape drifted (logged). A row that fails the
 * schema is DROPPED rather than repaired: inventing a handle or an engagement count would put a party on
 * the bench the business never hired.
 */
export function toBenchEntry(raw: RawBenchEntry, nowMs: number): BenchEntry | null {
	const handle = clamp(raw.handle, 40);
	const liveNow = raw.live_now === true;
	const lastWorkedAt = isoOf(raw.last_worked_at) || null;
	const count = Math.max(0, Math.trunc(Number(raw.rating_count) || 0));
	const avatar = raw.avatar_bucket && raw.avatar_path
		? publicObjectUrl(raw.avatar_bucket, raw.avatar_path)
		: null;
	const parsed = BenchEntrySchema.safeParse({
		kind: raw.kind,
		handle,
		name: clampOr(raw.name, 120, handle),
		avatar: avatarOf(avatar),
		contact: raw.contact_handle
			? {
				handle: clamp(raw.contact_handle, 40),
				name: clampOr(raw.contact_name, 120, raw.contact_handle),
			}
			: null,
		// Only an explicit `true` opens a link: a drifted or missing flag leaves the row without one.
		profileVisible: raw.profile_visible === true,
		viewerManages: raw.viewer_manages === true,
		engagements: Math.trunc(Number(raw.engagements) || 0),
		liveNow,
		lastWorkedAt,
		lastWorkedLabel: liveNow ? "Now" : lastWorkedAt ? dateLabel(lastWorkedAt, nowMs) : "–",
		rating: { average: averageOf(raw.rating_average, count), count },
	});
	if (parsed.success) return parsed.data;
	console.warn("[workspace:bench] row shape drifted; dropped", parsed.error.issues[0]?.message);
	return null;
}

// #endregion

// #region Read

/**
 * A business's bench, addressed by its handle (or row id), as the caller. Exactly ONE RPC. `404` when no
 * business holds the reference, `403` when the caller is not a member holding `hire`.
 */
export async function readBench(
	ref: string,
	actor: LiveActor,
	nowMs: number = Date.now(),
): Promise<ServiceResult<BusinessBench>> {
	const res = await benchIo.rpc<RawBenchAnswer>(actor, "org", "get_business_bench", {
		p_handle: ref.trim(),
	});
	if (!res.ok) return res.refusal;
	const answer = res.data;
	if (!answer || answer.status === "not_found") {
		return fail(404, { message: `No business found for "${ref}".` });
	}
	if (answer.status === "forbidden") {
		return fail(403, { message: "Only members who can hire see the bench." });
	}
	return ok({
		entries: (answer.entries ?? []).flatMap((raw) => {
			const entry = toBenchEntry(raw, nowMs);
			return entry ? [entry] : [];
		}),
	});
}

// #endregion
