import { assertEquals } from "@std/assert";
import {
	formatBytes,
	formatDate,
	formatDuration,
	formatNumber,
	formatRating,
	formatRelative,
	toEpoch,
} from "./table-format.ts";

const NOW = Date.UTC(2026, 9, 15, 12, 0, 0);

Deno.test("byte sizes step in binary units with one decimal under ten", () => {
	assertEquals(formatBytes(512, "en-GB"), "512 B");
	assertEquals(formatBytes(2458, "en-GB"), "2.4 KB");
	assertEquals(formatBytes(38 * 1024 * 1024, "en-GB"), "38 MB");
	assertEquals(formatBytes(1.25 * 1024 ** 3, "en-GB"), "1.3 GB");
	assertEquals(formatBytes(3 * 1024 ** 4, "en-GB"), "3 TB");
	assertEquals(formatBytes(-1, "en-GB"), "");
});

Deno.test("numbers format per column style", () => {
	assertEquals(formatNumber(1284.6, "integer", "en-GB"), "1,285");
	assertEquals(formatNumber(3.14159, "decimal", "en-GB", 2), "3.14");
	assertEquals(formatNumber(12_900, "compact", "en-GB"), "12.9K");
	assertEquals(formatNumber(0.125, "percent", "en-GB"), "12.5%");
	assertEquals(formatNumber(Number.NaN, "integer", "en-GB"), "");
});

Deno.test("durations read m:ss, then h:mm:ss", () => {
	assertEquals(formatDuration(65_000), "1:05");
	assertEquals(formatDuration(3_723_000), "1:02:03");
	assertEquals(formatDuration(-5), "");
});

Deno.test("ratings keep one decimal", () => {
	assertEquals(formatRating(4, "en-GB"), "4.0");
	assertEquals(formatRating(4.86, "en-GB"), "4.9");
});

Deno.test("instants normalise from strings, numbers and dates", () => {
	assertEquals(toEpoch("2026-10-15T12:00:00Z"), NOW);
	assertEquals(toEpoch(new Date(NOW)), NOW);
	assertEquals(toEpoch(NOW), NOW);
	assertEquals(toEpoch("nonsense"), null);
	assertEquals(toEpoch(null), null);
});

Deno.test("absolute dates drop the year inside the current year", () => {
	const july = Date.UTC(2026, 6, 14, 14, 30);
	assertEquals(formatDate(july, "date", "en-GB", NOW, "UTC"), "14 Jul");
	assertEquals(formatDate(july, "datetime", "en-GB", NOW, "UTC"), "14 Jul · 14:30");
	assertEquals(formatDate(Date.UTC(2024, 0, 2), "date", "en-GB", NOW, "UTC"), "2 Jan 2024");
});

Deno.test("relative dates pick the largest whole unit", () => {
	assertEquals(formatRelative(NOW - 20_000, NOW, "en-GB"), "now");
	assertEquals(formatRelative(NOW - 5 * 60_000, NOW, "en-GB"), "5 min ago");
	assertEquals(formatRelative(NOW - 26 * 3_600_000, NOW, "en-GB"), "yesterday");
	assertEquals(formatRelative(NOW + 3 * 86_400_000, NOW, "en-GB"), "in 3 days");
});
