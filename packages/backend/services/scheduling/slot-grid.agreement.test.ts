import { assert } from "@std/assert";
import {
	addDays,
	type AvailabilityRuleDraft,
	type Band,
	evaluate,
	type IsoDate,
	type RulePattern,
	type SlotQuery,
} from "@projective/types/scheduling";
import { buildGrid, type GridBand, type GridSource, judgeCustomStart } from "./slot-grid.ts";

/**
 * slot-grid.agreement_test — the grid never offers a slot the booking gate refuses.
 *
 * Two hundred generated presets, each compiled by the real evaluator into a stubbed occurrence store
 * over a random part of the rail (so the weekly-band fallback is exercised past it), are drawn as
 * grids; every slot the grid lists, and every random custom start it accepts, must pass a gate
 * written here from the SQL of `scheduling.fn_band_covers` + `fn_occurrence_covers` — independently
 * of the grid's own predicate.
 */

// #region Generator
function prng(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const ZONES = ["Europe/London", "America/New_York", "Australia/Sydney", "Asia/Tokyo", "UTC"];
const TODAY = "2026-03-20" as IsoDate;
const NOW = Date.parse("2026-03-20T00:00:00Z");
const RAIL_DAYS = 21;

function pick<T>(rand: () => number, list: readonly T[]): T {
	return list[Math.floor(rand() * list.length)];
}

function int(rand: () => number, lo: number, hi: number): number {
	return lo + Math.floor(rand() * (hi - lo + 1));
}

function bands(rand: () => number, max: number): Band[] {
	const out: Band[] = [];
	let cursor = int(rand, 0, 40) * 15;
	for (let i = int(rand, 1, max); i > 0 && cursor < 1425; i--) {
		const end = Math.min(1440, cursor + int(rand, 2, 24) * 15);
		out.push({ start: cursor, end });
		cursor = end + int(rand, 1, 12) * 15;
	}
	return out.length ? out : [{ start: 540, end: 1020 }];
}

function pattern(rand: () => number): { pattern: RulePattern; startsOn: IsoDate } {
	const startsOn = addDays(TODAY, -int(rand, 0, 20));
	const kind = rand();
	if (kind < 0.55) {
		const days = [0, 1, 2, 3, 4, 5, 6].filter(() => rand() < 0.45);
		return {
			pattern: {
				type: "weekly",
				days: days.length ? days : [int(rand, 0, 6)],
				interval: int(rand, 1, 2),
			},
			startsOn,
		};
	}
	if (kind < 0.8) {
		return { pattern: { type: "monthly_date", days: [int(rand, 1, 28)], interval: 1 }, startsOn };
	}
	const date = addDays(TODAY, int(rand, 0, RAIL_DAYS));
	return { pattern: { type: "once", date }, startsOn: date };
}

function rule(rand: () => number, i: number): AvailabilityRuleDraft {
	const effect = rand() < 0.7 ? "add" : rand() < 0.5 ? "replace" : "subtract";
	return {
		id: `r${i}`,
		layer: rand() < 0.8 ? "working_hours" : "call_window",
		effect,
		...pattern(rand),
		condition: { unlessWeekdays: [] },
		bands: effect === "subtract" && rand() < 0.3 ? [] : bands(rand, 3),
		endsOn: null,
		priority: int(rand, 0, 99),
		label: "",
		active: rand() < 0.9,
	};
}

function weeklyBands(rand: () => number): GridBand[] {
	const out: GridBand[] = [];
	for (let weekday = 0; weekday < 7; weekday++) {
		if (rand() < 0.4) continue;
		for (const b of bands(rand, 2)) out.push({ weekday, startMinute: b.start, endMinute: b.end });
	}
	return out;
}
// #endregion

// #region The gate, from the SQL
const partsFormatters = new Map<string, Intl.DateTimeFormat>();

/** `(t AT TIME ZONE tz)` as date, weekday and minute of day. */
function wall(t: number, tz: string): { date: string; weekday: number; minute: number } {
	let fmt = partsFormatters.get(tz);
	if (!fmt) {
		fmt = new Intl.DateTimeFormat("en-US", {
			timeZone: tz,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			weekday: "short",
			hourCycle: "h23",
		});
		partsFormatters.set(tz, fmt);
	}
	const p = Object.fromEntries(fmt.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
	return {
		date: `${p.year}-${p.month}-${p.day}`,
		weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday),
		minute: Number(p.hour) * 60 + Number(p.minute),
	};
}

interface OccurrenceStore {
	compiledFrom: string;
	compiledThrough: string;
	spans: Array<{ startsAt: number; endsAt: number }>;
}

/** `scheduling.fn_band_covers(schedule, 'working_hours', from, to, blueprint)`. */
function sqlBandCovers(
	tz: string,
	rules: readonly GridBand[],
	store: OccurrenceStore,
	from: number,
	to: number,
): boolean {
	const s = wall(from, tz);
	const e = wall(to, tz);
	if (store.compiledFrom <= s.date && store.compiledThrough >= e.date) {
		return store.spans.some((o) => o.startsAt <= from && o.endsAt >= to);
	}
	return rules.some((r) =>
		r.weekday === s.weekday && r.startMinute <= s.minute && (
			(r.weekday === e.weekday && r.endMinute >= e.minute) ||
			(r.endMinute === 1440 && e.minute === 0 && e.date === addDays(s.date as IsoDate, 1))
		)
	);
}
// #endregion

Deno.test("slot grid ⇔ booking gate: 200 generated presets × every listed slot and random starts", () => {
	const rand = prng(217);
	let listed = 0;
	let accepted = 0;
	let compiledSlots = 0;

	for (let n = 0; n < 200; n++) {
		const tz = pick(rand, ZONES);
		const preset = {
			timezone: tz,
			rules: Array.from({ length: int(rand, 1, 5) }, (_, i) => rule(rand, i)),
		};
		const through = addDays(TODAY, int(rand, 0, RAIL_DAYS + 2));
		const store: OccurrenceStore = {
			compiledFrom: TODAY,
			compiledThrough: through,
			spans: evaluate(preset, { from: TODAY, to: through })
				.filter((o) => o.kind === "working_hours")
				.map((o) => ({ startsAt: o.startsAt, endsAt: o.endsAt })),
		};
		const weekly = weeklyBands(rand);
		const source: GridSource = {
			timezone: tz,
			bands: weekly,
			compiled: {
				from: TODAY,
				through,
				spans: store.spans.map((o) => ({ start: o.startsAt, end: o.endsAt })),
			},
			blackouts: [],
			busy: [],
			rules: {
				minNoticeMinutes: 0,
				maxAdvanceDays: 60,
				bufferBeforeMinutes: pick(rand, [0, 0, 5]),
				bufferAfterMinutes: pick(rand, [0, 10]),
			},
			closedReason: null,
		};
		const query: SlotQuery = {
			subjectId: "svc-agreement",
			purpose: "session",
			timezone: pick(rand, ZONES),
			from: NOW,
			days: RAIL_DAYS,
		};
		const request = {
			purpose: query.purpose,
			subjectId: query.subjectId,
			sessionCount: 1,
			durationMinutes: pick(rand, [15, 30, 45, 60, 90]),
			seatsPerSession: null,
			now: NOW,
		};

		const grid = buildGrid(query, source, request);
		const offered = Object.values(grid.slots).flat();
		for (const slot of offered) {
			listed++;
			if (wall(slot.endsAt, tz).date <= through) compiledSlots++;
			assert(
				sqlBandCovers(tz, weekly, store, slot.startsAt, slot.endsAt),
				`preset ${n}: the grid lists ${
					new Date(slot.startsAt).toISOString()
				} but the gate refuses it`,
			);
		}

		// Half the custom starts land near an offered slot, so acceptances are common enough to test.
		for (let k = 0; k < 8; k++) {
			const start = k % 2 === 0 && offered.length
				? pick(rand, offered).startsAt + pick(rand, [-15, 0, 5, 15, 30]) * 60_000
				: NOW + int(rand, 0, RAIL_DAYS * 96) * 15 * 60_000;
			const judged = judgeCustomStart(query, source, request, start);
			const gate = sqlBandCovers(
				tz,
				weekly,
				store,
				start,
				start + request.durationMinutes * 60_000,
			);
			if ("slot" in judged) {
				accepted++;
				assert(
					gate,
					`preset ${n}: custom start ${new Date(start).toISOString()} accepted, gate refuses`,
				);
			}
		}
	}

	assert(
		listed > 5_000,
		`only ${listed} slots were listed — the generator is too sparse to prove much`,
	);
	assert(compiledSlots > 1_000, `only ${compiledSlots} slots came from compiled occurrences`);
	assert(accepted > 200, `only ${accepted} custom starts were accepted`);
});
