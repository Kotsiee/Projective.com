import { assertEquals } from "@std/assert";
import { addDays, daysInMonth, fromDayNumber, type IsoDate, toDayNumber } from "./civil.ts";
import {
	draftToRRule,
	type RecurrenceInput,
	rruleToDraft,
	type RulePattern,
} from "./recurrence.ts";
import {
	parseRRule,
	type RRuleByDay,
	type RRuleFreq,
	type RRuleParts,
	serialiseRRule,
} from "./rrule.ts";

/**
 * Round-trip properties over seeded random inputs (mulberry32 — deterministic, so a failure
 * reproduces from its seed): `parse ∘ serialise = id` on canonical parts, and
 * `rruleToDraft ∘ draftToRRule = id` on schema-valid drafts.
 */

// #region Generator
function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

class Gen {
	constructor(private readonly next: () => number) {}
	int(min: number, max: number): number {
		return min + Math.floor(this.next() * (max - min + 1));
	}
	bool(p = 0.5): boolean {
		return this.next() < p;
	}
	pick<T>(items: readonly T[]): T {
		return items[this.int(0, items.length - 1)];
	}
	subset(items: readonly number[], min: number, max: number): number[] {
		const size = this.int(min, Math.min(max, items.length));
		const pool = [...items];
		const out: number[] = [];
		while (out.length < size) out.push(pool.splice(this.int(0, pool.length - 1), 1)[0]);
		return out.sort((a, b) => a - b);
	}
	date(): IsoDate {
		return fromDayNumber(
			this.int(toDayNumber("2020-01-01" as IsoDate), toDayNumber("2030-12-31" as IsoDate)),
		);
	}
}

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];
const MONTH_DAYS = [
	...Array.from({ length: 31 }, (_, i) => -31 + i),
	...Array.from({ length: 31 }, (_, i) => i + 1),
];
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

function canonicalByDay(entries: RRuleByDay[]): RRuleByDay[] {
	const seen = new Map<string, RRuleByDay>();
	for (const e of entries) seen.set(`${e.wd}:${e.ordinal ?? ""}`, e);
	return [...seen.values()].sort((a, b) =>
		a.wd - b.wd || (a.ordinal ?? -100) - (b.ordinal ?? -100)
	);
}

function randomParts(g: Gen): RRuleParts {
	const freq = g.pick<RRuleFreq>(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"]);
	const ordinals = freq === "MONTHLY" || freq === "YEARLY";
	const byDay = g.bool() ? [] : canonicalByDay(
		g.subset(WEEKDAYS, 1, 7).map((wd) => {
			if (!ordinals || g.bool()) return { wd };
			const limit = freq === "MONTHLY" ? 5 : 53;
			const n = g.int(1, limit);
			return { wd, ordinal: g.bool() ? n : -n };
		}),
	);
	const byMonthDay = freq === "WEEKLY" || g.bool() ? [] : g.subset(MONTH_DAYS, 1, 4);
	const byMonth = g.bool(0.3) ? g.subset(MONTHS, 1, 3) : [];
	const hasBy = byDay.length > 0 || byMonthDay.length > 0 || byMonth.length > 0;
	const bySetPos = hasBy && g.bool(0.3) ? g.subset([-3, -2, -1, 1, 2, 3, 100, -366], 1, 2) : [];
	const parts: RRuleParts = {
		freq,
		interval: g.bool() ? 1 : g.int(2, 12),
		byDay,
		byMonthDay,
		byMonth,
		bySetPos,
		wkst: g.bool() ? 1 : g.int(0, 6),
	};
	if (g.bool()) parts.until = g.date();
	return parts;
}

function randomPattern(g: Gen, startsOn: IsoDate): { pattern: RulePattern; unless: number[] } {
	const unless = () => (g.bool() ? [] : g.subset(WEEKDAYS, 1, 6));
	switch (g.int(0, 4)) {
		case 0:
			return {
				pattern: { type: "weekly", days: g.subset(WEEKDAYS, 1, 7), interval: g.int(1, 8) },
				unless: [],
			};
		case 1:
			return {
				pattern: { type: "monthly_date", days: g.subset(MONTH_DAYS, 1, 6), interval: g.int(1, 12) },
				unless: unless(),
			};
		case 2:
			return {
				pattern: {
					type: "monthly_weekday",
					ordinal: g.pick([-1, 1, 2, 3, 4]),
					weekday: g.int(0, 6),
					interval: g.int(1, 12),
				},
				unless: [],
			};
		case 3: {
			const month = g.int(1, 12);
			return {
				pattern: { type: "yearly", month, day: g.int(1, daysInMonth(2000, month)) },
				unless: unless(),
			};
		}
		default:
			return { pattern: { type: "once", date: startsOn }, unless: [] };
	}
}

function randomDraft(g: Gen): RecurrenceInput {
	const startsOn = g.date();
	const { pattern, unless } = randomPattern(g, startsOn);
	const endsOn = pattern.type === "once" || g.bool() ? null : addDays(startsOn, g.int(0, 800));
	return { pattern, condition: { unlessWeekdays: unless }, startsOn, endsOn };
}
// #endregion

const RUNS = 2000;

Deno.test("parse ∘ serialise = id over canonical parts", () => {
	const g = new Gen(mulberry32(0x5eed));
	for (let i = 0; i < RUNS; i++) {
		const parts = randomParts(g);
		const text = serialiseRRule(parts);
		const parsed = parseRRule(text);
		if (!parsed.ok) throw new Error(`run ${i}: ${text} refused: ${parsed.reason}`);
		assertEquals(parsed.value, parts, `run ${i}: ${text}`);
	}
});

Deno.test("rruleToDraft ∘ draftToRRule = id over valid drafts", () => {
	const g = new Gen(mulberry32(0xca1));
	const seen = new Set<string>();
	for (let i = 0; i < RUNS; i++) {
		const draft = randomDraft(g);
		seen.add(draft.pattern.type);
		const rrule = draftToRRule(draft);
		assertEquals(
			rruleToDraft(rrule, draft.startsOn),
			{ pattern: draft.pattern, condition: draft.condition, endsOn: draft.endsOn },
			`run ${i}: ${rrule}`,
		);
	}
	assertEquals(seen.size, 5);
});
