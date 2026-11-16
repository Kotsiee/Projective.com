/**
 * Paying in one's own currency (Decision #435): the TypeScript mirrors of the conversion arithmetic and
 * its tables against the SQL that charges. The rounding vectors are read from the parity probe the
 * database runs, the settlement currencies from their platform param, and the minor-unit exponents
 * from `finance.fn_currency_exponent` — so a figure a buyer is shown and the figure they are charged
 * cannot drift apart without a failure here, on a laptop with no database.
 */
import { assertEquals, assertThrows } from "@std/assert";
import {
	currencyForCountry,
	isSettlementCurrency,
	parseFixedRate,
	pinnedRefundMinor,
	quoteConversionMinor,
	SETTLEMENT_CURRENCIES,
} from "./fx.ts";
import { currencyExponent } from "./wallet.ts";

const PROBE = new URL("../../../supabase/probes/fx_rounding_parity.sql", import.meta.url);
const CORE = new URL(
	"../../../supabase/migrations/00001200_functions_finance_core.sql",
	import.meta.url,
);
const PARAMS = new URL(
	"../../../supabase/migrations/00005001_seed_platform_params.sql",
	import.meta.url,
);
const read = (url: URL) => Deno.readTextFileSync(url).replace(/\r\n/g, "\n");

interface Vector {
	toMinor: number;
	from: string;
	to: string;
	fromRate: string;
	toRate: string;
	spreadBp: number;
	principal: number;
	spread: number;
	fromMinor: number;
}

function probeVectors(): Vector[] {
	const row =
		/^\s*\((\d+), '([A-Z]{3})', '([A-Z]{3})', ([\d.]+), ([\d.]+), (\d+), (\d+), (\d+), (\d+)\),?\s*$/;
	const vectors = read(PROBE).split("\n").flatMap((line) => {
		const m = row.exec(line);
		return m
			? [{
				toMinor: Number(m[1]),
				from: m[2],
				to: m[3],
				fromRate: m[4],
				toRate: m[5],
				spreadBp: Number(m[6]),
				principal: Number(m[7]),
				spread: Number(m[8]),
				fromMinor: Number(m[9]),
			}]
			: [];
	});
	if (vectors.length < 8) {
		throw new Error(`fx_rounding_parity.sql: only ${vectors.length} vectors parsed`);
	}
	return vectors;
}

function exponentLists(): Record<string, number> {
	const sql = read(CORE);
	const start = sql.indexOf("CREATE OR REPLACE FUNCTION finance.fn_currency_exponent");
	const end = sql.indexOf("\n$$;", start);
	if (start < 0 || end < 0) throw new Error("finance.fn_currency_exponent not found in 00001200");
	const body = sql.slice(start, end);
	const out: Record<string, number> = {};
	for (const m of body.matchAll(/ARRAY\[([^\]]+)\]\) THEN (\d)/g)) {
		for (const code of m[1].matchAll(/'([A-Z]{3})'/g)) out[code[1]] = Number(m[2]);
	}
	return out;
}

Deno.test("quoteConversionMinor charges exactly what finance.fn_fx_quote_minor charges, vector for vector", () => {
	for (const v of probeVectors()) {
		const got = quoteConversionMinor({
			toMinor: v.toMinor,
			fromRate: v.fromRate,
			toRate: v.toRate,
			fromExponent: currencyExponent(v.from),
			toExponent: currencyExponent(v.to),
			spreadBp: v.spreadBp,
		});
		assertEquals(
			[got.principalMinor, got.spreadMinor, got.fromMinor],
			[v.principal, v.spread, v.fromMinor],
			`${v.toMinor} ${v.from}→${v.to} at ${v.fromRate}/${v.toRate}, ${v.spreadBp} bp`,
		);
	}
});

Deno.test("the minor-unit exponents are the database's: every listed code, and 2 for the rest", () => {
	const sql = exponentLists();
	assertEquals(Object.keys(sql).length, 24);
	for (const [code, exponent] of Object.entries(sql)) {
		assertEquals(currencyExponent(code), exponent, code);
	}
	assertEquals([currencyExponent("gbp"), currencyExponent("EUR"), currencyExponent("kwd")], [
		2,
		2,
		3,
	]);
});

Deno.test("the settlement currencies are the platform param's, in its order", () => {
	const m = /\('settlement_currencies', '(\[[^']+\])'::jsonb/.exec(read(PARAMS));
	if (!m) throw new Error("settlement_currencies not found in 00005001");
	assertEquals([...SETTLEMENT_CURRENCIES], JSON.parse(m[1]));
	assertEquals([
		isSettlementCurrency(" usd "),
		isSettlementCurrency("AED"),
		isSettlementCurrency(null),
	], [
		true,
		false,
		false,
	]);
});

Deno.test("a billing country pays in its own currency when Projective settles it, else in GBP", () => {
	assertEquals(currencyForCountry("GB"), "GBP");
	assertEquals(currencyForCountry("DE"), "EUR");
	assertEquals(currencyForCountry("US"), "USD");
	assertEquals(currencyForCountry("JP"), "JPY");
	assertEquals(currencyForCountry("AE"), "GBP");
	assertEquals(currencyForCountry("IN"), "GBP");
	assertEquals(currencyForCountry(null), "GBP");
	assertEquals(currencyForCountry(""), "GBP");
});

Deno.test("a pinned refund returns what was paid: whole exactly, part rounded up, never more", () => {
	assertEquals(pinnedRefundMinor(9_000, 9_000, 7_807), 7_807);
	assertEquals(pinnedRefundMinor(4_500, 9_000, 7_807), 3_904);
	assertEquals(pinnedRefundMinor(1, 9_000, 7_807), 1);
	assertEquals(pinnedRefundMinor(9_500, 9_000, 7_807), 7_807);
	assertEquals(pinnedRefundMinor(0, 9_000, 7_807), 0);
});

Deno.test("a stored rate parses to ten exact places, and nothing else is a rate", () => {
	assertEquals(parseFixedRate("1.17"), 11_700_000_000n);
	assertEquals(parseFixedRate("192"), 1_920_000_000_000n);
	assertEquals(parseFixedRate(1.2700000001), 12_700_000_001n);
	for (const bad of ["0", "-1.2", "1.12345678901", "abc", ""]) {
		assertThrows(() => parseFixedRate(bad), RangeError, undefined, bad);
	}
});
