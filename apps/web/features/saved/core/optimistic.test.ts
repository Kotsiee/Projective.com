import { assertEquals } from "@std/assert";
import { optimistic } from "./optimistic.ts";

Deno.test("optimistic applies at once and keeps the state the server accepted", async () => {
	const seen: boolean[] = [];
	const out = await optimistic(
		"project:a",
		true,
		(v) => seen.push(v),
		() => Promise.resolve({ ok: true, message: "Project starred." }),
		"Saved.",
	);
	assertEquals(out, { ok: true, message: "Project starred." });
	assertEquals(seen, [true]);
});

Deno.test("optimistic rolls back and passes on the server's sentence when refused", async () => {
	const seen: boolean[] = [];
	const out = await optimistic(
		"file:f",
		true,
		(v) => seen.push(v),
		() => Promise.resolve({ ok: false, message: "Saving needs the live backend." }),
		"Saved.",
	);
	assertEquals(out, { ok: false, message: "Saving needs the live backend." });
	assertEquals(seen, [true, false]);
});

Deno.test("optimistic drops a second press on the same key while the first is in flight", async () => {
	const seen: boolean[] = [];
	let release!: () => void;
	const first = optimistic(
		"message:m",
		false,
		(v) => seen.push(v),
		() => new Promise((r) => (release = () => r({ ok: true, message: "" }))),
		"Removed.",
	);
	const second = await optimistic(
		"message:m",
		true,
		(v) => seen.push(v),
		() => Promise.resolve({ ok: true, message: "" }),
		"Saved.",
	);
	assertEquals(second.ok, false);
	release();
	assertEquals(await first, { ok: true, message: "Removed." });
	assertEquals(seen, [false]);
});
