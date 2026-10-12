import { assertEquals } from "@std/assert";
import { formatVital, toLogRows, toVitalRows } from "./log-rows.ts";

const NOW = Date.UTC(2026, 9, 12);

Deno.test("only warn and error entries become rows", () => {
	const rows = toLogRows(
		[
			{ id: "a", level: "info", message: "noise", at: NOW },
			{ id: "b", level: "network", message: "GET /x", at: NOW },
			{ id: "c", level: "error", message: "boom", at: NOW, status: 500.4, durationMs: 12.6 },
		],
		{ path: "/explore" },
		NOW,
	);
	assertEquals(rows.length, 1);
	assertEquals(rows[0].client_id, "c");
	assertEquals(rows[0].status, 500);
	assertEquals(rows[0].duration_ms, 13);
	assertEquals(rows[0].source, "client");
	assertEquals(rows[0].path, "/explore");
});

Deno.test("a skewed client clock falls back to the receipt time", () => {
	const [far] = toLogRows(
		[{ id: "a", level: "warn", message: "w", at: NOW + 7 * 86_400_000 }],
		undefined,
		NOW,
	);
	const [bad] = toLogRows(
		[{ id: "b", level: "warn", message: "w", at: Number.NaN }],
		undefined,
		NOW,
	);
	assertEquals(far.occurred_at, new Date(NOW).toISOString());
	assertEquals(bad.occurred_at, new Date(NOW).toISOString());
});

Deno.test("vitals become metric rows keyed by page view and metric", () => {
	const rows = toVitalRows(
		[
			{
				name: "LCP",
				value: 2480.7,
				rating: "good",
				id: "pv1",
				navigationType: "navigate",
				at: NOW,
			},
			{ name: "CLS", value: 0.1234, rating: "needs-improvement", id: "pv1", at: NOW },
		],
		{ path: "/" },
		NOW,
	);
	assertEquals(rows.map((r) => [r.client_id, r.level, r.scope, r.message]), [
		["pv1:LCP", "metric", "web-vitals", "LCP 2481ms (good)"],
		["pv1:CLS", "metric", "web-vitals", "CLS 0.123 (needs-improvement)"],
	]);
	assertEquals(rows[1].data, {
		name: "CLS",
		value: 0.1234,
		rating: "needs-improvement",
		navigationType: null,
	});
});

Deno.test("formatVital prints CLS unitless and timings in ms", () => {
	assertEquals(formatVital({ name: "INP", value: 199.5 }), "INP 200ms");
	assertEquals(formatVital({ name: "CLS", value: 0 }), "CLS 0.000");
});
