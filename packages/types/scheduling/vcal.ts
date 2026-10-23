/**
 * scheduling.vcal — what the iCalendar reader needs to also read a vCalendar 1.0 (`.vcs`) file.
 *
 * vCalendar 1.0 is the format RFC 5545 replaced, and phones and older desktop clients still write it.
 * Its envelope is the same `BEGIN:VCALENDAR` / `VEVENT` tree, so `parseIcsCalendar` reads both; three
 * things differ, and each is handled here:
 *
 *  1. **Text may be QUOTED-PRINTABLE** (`ENCODING=QUOTED-PRINTABLE`, often written as a bare
 *     `;QUOTED-PRINTABLE`). Its soft line breaks end a line in `=` and continue WITHOUT the leading
 *     space RFC 5545 folding uses, so they are joined before any field is split, and the value is
 *     decoded as BYTES in the line's `CHARSET` rather than as characters.
 *  2. **Floating times are read at the calendar's `TZ`**, a fixed UTC offset, rather than in the
 *     reader's zone.
 *  3. **The repeat grammar is not RRULE** (`W1 MO TH #10`, not `FREQ=WEEKLY;BYDAY=MO,TH;COUNT=10`).
 *     {@link vcalRuleToRRule} rewrites it into the RFC 5545 form, so a `.vcs` series is expanded by
 *     exactly the code an `.ics` series is.
 *
 * Pure: no clock, no IO, no DOM.
 */

// #region Quoted-printable
const QP_HEAD = /^[^:]*;(?:ENCODING=)?QUOTED-PRINTABLE[;:]/i;

/** Rejoin the soft line breaks of every QUOTED-PRINTABLE property. Runs after RFC 5545 unfolding. */
export function joinQuotedPrintableLines(lines: readonly string[]): string[] {
	const out: string[] = [];
	for (let i = 0; i < lines.length; i++) {
		let line = lines[i];
		if (QP_HEAD.test(line)) {
			while (line.endsWith("=") && i + 1 < lines.length) line = line.slice(0, -1) + lines[++i];
		}
		out.push(line);
	}
	return out;
}

const HEX_PAIR = /^[0-9A-Fa-f]{2}$/;

/**
 * Decode a QUOTED-PRINTABLE value in `charset` (UTF-8 when absent or unknown to the runtime).
 *
 * A `=` that is not followed by two hex digits is kept as a literal `=`, which is what every lenient
 * reader does with a producer that forgot to encode one.
 */
export function decodeQuotedPrintable(value: string, charset?: string): string {
	const encoder = new TextEncoder();
	const bytes: number[] = [];
	for (let i = 0; i < value.length;) {
		const pair = value.slice(i + 1, i + 3);
		if (value[i] === "=" && HEX_PAIR.test(pair)) {
			bytes.push(parseInt(pair, 16));
			i += 3;
			continue;
		}
		const ch = String.fromCodePoint(value.codePointAt(i) ?? 0);
		bytes.push(...encoder.encode(ch));
		i += ch.length;
	}
	return decodeBytes(new Uint8Array(bytes), charset?.trim() || "utf-8");
}

function decodeBytes(bytes: Uint8Array, charset: string): string {
	try {
		return new TextDecoder(charset).decode(bytes);
	} catch (error) {
		if (!(error instanceof RangeError)) throw error;
		return new TextDecoder("utf-8").decode(bytes);
	}
}
// #endregion

// #region Text
/**
 * Unescape a vCalendar 1.0 text value in one left-to-right pass.
 *
 * Only `\;`, `\,` and `\\` are escapes in 1.0. A newline arrives quoted-printable (`=0D=0A`), never as
 * `\n` — so `C:\new` in a description stays a path rather than becoming `C:` and a line break.
 */
export function vcalUnescape(value: string): string {
	let out = "";
	for (let i = 0; i < value.length; i++) {
		const next = value[i + 1];
		if (value[i] === "\\" && (next === ";" || next === "," || next === "\\")) {
			out += next;
			i++;
		} else out += value[i];
	}
	return out;
}
// #endregion

// #region Time zone
/** A vCalendar `TZ` value (`-05:00`, `+0530`, `+01`) as milliseconds ahead of UTC, or `null`. */
export function parseVcalOffset(value: string): number | null {
	const m = /^([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(value.trim());
	if (!m) return null;
	const hours = Number(m[2]);
	const minutes = Number(m[3] ?? 0);
	if (hours > 14 || minutes > 59) return null;
	const ms = (hours * 60 + minutes) * 60_000;
	return m[1] === "-" ? -ms : ms;
}
// #endregion

// #region Repeat rules
/** The outcome of {@link vcalRuleToRRule}: an RFC 5545 rule, or why there is none. */
export type VcalRuleTranslation = { ok: true; rrule: string } | { ok: false; reason: string };

const DAY_CODES = new Set(["SU", "MO", "TU", "WE", "TH", "FR", "SA"]);
const FREQ_OF: Record<string, string> = {
	D: "DAILY",
	W: "WEEKLY",
	MP: "MONTHLY",
	MD: "MONTHLY",
	YM: "YEARLY",
};
const UNREADABLE: VcalRuleTranslation = { ok: false, reason: "its repeat rule could not be read" };

/**
 * Rewrite a vCalendar 1.0 repeat rule as an RFC 5545 `RRULE` value.
 *
 * Covers the five forms producers actually write — `D` (daily), `W` (weekly on days), `MD` (monthly
 * on day numbers, `LD` and `1-` counting from the end), `MP` (monthly by position, `1+ MO` · `1- FR`)
 * and `YM` (yearly in months) — with an end of `#n` occurrences, `#0` for ever, or a date. 1.0 says a
 * rule with NO end repeats twice (`#2`), and that default is applied rather than guessed at.
 *
 * Refused, with a reason the reader is shown: `YD` (days of the year — the expander has no BYYEARDAY),
 * a daily rule with a list of times, and any compound or malformed rule.
 */
export function vcalRuleToRRule(rule: string): VcalRuleTranslation {
	const tokens = rule.trim().toUpperCase().split(/\s+/).filter(Boolean).map((t) =>
		t.replace(/\$$/, "")
	);
	const head = /^(D|W|MP|MD|YM|YD)(\d{1,4})$/.exec(tokens.shift() ?? "");
	if (!head || Number(head[2]) < 1) return UNREADABLE;
	const [, freq, interval] = head;
	if (freq === "YD") return { ok: false, reason: "it repeats on numbered days of the year" };

	const parts = [`FREQ=${FREQ_OF[freq]}`];
	if (Number(interval) > 1) parts.push(`INTERVAL=${Number(interval)}`);

	let count: number | null = 2;
	let until: string | null = null;
	const last = tokens[tokens.length - 1];
	if (last !== undefined && /^#\d{1,6}$/.test(last)) {
		tokens.pop();
		count = Number(last.slice(1)) || null;
	} else if (last !== undefined && /^\d{8}(T\d{6}Z?)?$/.test(last)) {
		tokens.pop();
		count = null;
		until = last;
	}

	if (freq === "D") {
		if (tokens.length > 0) {
			return tokens.every((t) => /^\d{4}$/.test(t))
				? { ok: false, reason: "it repeats at several times of day" }
				: UNREADABLE;
		}
	} else if (freq === "W") {
		if (!tokens.every((t) => DAY_CODES.has(t))) return UNREADABLE;
		if (tokens.length) parts.push(`BYDAY=${tokens.join(",")}`);
	} else if (freq === "MD") {
		const days: number[] = [];
		for (const t of tokens) {
			const m = /^(\d{1,2})([+-])?$/.exec(t);
			if (t === "LD") days.push(-1);
			else if (m && Number(m[1]) >= 1 && Number(m[1]) <= 31) {
				days.push(m[2] === "-" ? -Number(m[1]) : Number(m[1]));
			} else return UNREADABLE;
		}
		if (days.length) parts.push(`BYMONTHDAY=${days.join(",")}`);
	} else if (freq === "MP") {
		const byDay: string[] = [];
		let pending: number[] = [];
		let afterDay = false;
		for (const t of tokens) {
			const m = /^([1-5])([+-])$/.exec(t);
			if (m) {
				if (afterDay) pending = [];
				afterDay = false;
				pending.push(m[2] === "-" ? -Number(m[1]) : Number(m[1]));
			} else if (DAY_CODES.has(t) && pending.length) {
				afterDay = true;
				for (const n of pending) byDay.push(`${n}${t}`);
			} else return UNREADABLE;
		}
		if (!byDay.length || !afterDay) return UNREADABLE;
		parts.push(`BYDAY=${byDay.join(",")}`);
	} else {
		if (!tokens.every((t) => /^\d{1,2}$/.test(t) && Number(t) >= 1 && Number(t) <= 12)) {
			return UNREADABLE;
		}
		if (tokens.length) parts.push(`BYMONTH=${tokens.map(Number).join(",")}`);
	}

	if (until !== null) parts.push(`UNTIL=${until}`);
	if (count !== null) parts.push(`COUNT=${count}`);
	return { ok: true, rrule: parts.join(";") };
}
// #endregion
