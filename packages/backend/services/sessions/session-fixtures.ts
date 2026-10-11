import type { RawCohortOffer, RawWorkspace } from "./workspace-model.ts";

/**
 * session-fixtures — the fixture world's session data, for `deno task dev:mock` (no database). It is
 * shaped as the SQL reads' own jsonb and goes through the same `workspace-model` mapper, so the fixture
 * path exercises the real mapping instead of a parallel one. Sittings are placed relative to `now`, on
 * the hour, so a fixture cohort always has one sitting behind it and three ahead.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Deterministic fixture ids, so a lesson ticked in the island addresses the same row on re-render. */
function fid(slug: string, n: number): string {
	let h = 0;
	for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0;
	const hex = (h.toString(16) + n.toString(16).padStart(4, "0")).padStart(12, "0").slice(-12);
	return `00000000-0000-4000-8000-${hex}`;
}

function sittingsFor(slug: string, cohortId: string, now: number, base: number) {
	const anchor = Math.floor(now / HOUR) * HOUR;
	return [-7, 2, 9, 16].map((d, i) => ({
		id: fid(slug, base + i),
		cohort_id: cohortId,
		title: `Session ${i + 1}`,
		starts_at: new Date(anchor + d * DAY).toISOString(),
		ends_at: new Date(anchor + d * DAY + 90 * 60_000).toISOString(),
		status: d < 0 ? "completed" : "scheduled",
	}));
}

/** A fixture session engagement's workspace read, for `role`. */
export function fixtureWorkspace(
	projectId: string,
	slug: string,
	kind: "normal" | "group",
	role: RawWorkspace["role"],
	now: number,
): RawWorkspace {
	const group = kind === "group";
	const cohortA = fid(slug, 1);
	const cohortB = fid(slug, 2);
	const sittings = sittingsFor(slug, cohortA, now, 100);
	const curriculum = sittings.slice(0, 3).map((s, i) => ({
		id: fid(slug, 200 + i),
		title: ["Foundations", "Working session", "Review and next steps"][i],
		summary: "",
		starts_at: s.starts_at,
		lessons: [0, 1].map((j) => ({
			id: fid(slug, 300 + i * 10 + j),
			title: `Lesson ${i + 1}.${j + 1}`,
			duration_minutes: 30,
			done: role === "attendee" ? i === 0 : null,
		})),
	}));
	const next = sittings.find((s) => Date.parse(s.ends_at) > now) ?? null;
	return {
		project_id: projectId,
		slug,
		session_kind: kind,
		role,
		seat_price_minor: group ? 9000 : 18000,
		currency: "USD",
		terms: {},
		cohorts: [
			{
				id: cohortA,
				name: group ? "Foundations cohort" : "Your sessions",
				status: "active",
				max_seats: group ? 12 : 1,
				taken: group ? 9 : 1,
				joined: role === "attendee",
				next_start: next?.starts_at ?? null,
				next_end: next?.ends_at ?? null,
			},
			...(group
				? [{
					id: cohortB,
					name: "Advanced studio",
					status: "enrolling" as const,
					max_seats: 8,
					taken: 3,
					joined: false,
					next_start: null,
					next_end: null,
				}]
				: []),
		],
		sittings,
		membership: role === "attendee"
			? {
				id: fid(slug, 3),
				cohort_id: cohortA,
				status: "active",
				seats: 1,
				escrow: {
					status: "held",
					amount_minor: group ? 9000 : 18000,
					currency: "USD",
					claim_open: false,
				},
				first_start: sittings[0].starts_at,
			}
			: null,
		hold: null,
		host_escrows: role === "host"
			? { held_minor: group ? 81000 : 18000, held_count: group ? 9 : 1, released_minor: 0, currency: "USD" }
			: null,
		curriculum,
		join: next && role !== "prospect"
			? {
				event_id: next.id,
				role: role === "host" ? "host" : "attendee",
				state: "upcoming",
				opens_at: new Date(Date.parse(next.starts_at) - 10 * 60_000).toISOString(),
				closes_at: next.ends_at,
				url: null,
			}
			: null,
		reschedule: null,
	};
}

/** A fixture listing's enrolling cohort. */
export function fixtureCohortOffer(listingId: string, maxSeats: number, now: number): RawCohortOffer {
	const sittings = sittingsFor(listingId, fid(listingId, 1), now, 100).slice(1);
	// No seat is sold in the fixture world; the Dev Context Switcher's "Seat full" previews a full one.
	return {
		cohort_id: fid(listingId, 1),
		name: "Next cohort",
		max_seats: maxSeats,
		taken: 0,
		remaining: maxSeats,
		first_start: sittings[0].starts_at,
		sittings,
		curriculum: sittings.map((s, i) => ({
			id: fid(listingId, 200 + i),
			title: ["Foundations", "Working session", "Review and next steps"][i] ?? `Module ${i + 1}`,
			summary: "",
			starts_at: s.starts_at,
			lessons: [{ id: fid(listingId, 300 + i), title: `Lesson ${i + 1}`, duration_minutes: 45 }],
		})),
	};
}
