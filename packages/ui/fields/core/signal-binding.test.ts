import { assertEquals } from "@std/assert";
import { computed, signal } from "@preact/signals";
import { isWritableSignal } from "./signal-binding.ts";

Deno.test("a plain signal is writable", () => {
	assertEquals(isWritableSignal(signal(false)), true);
});

Deno.test("a computed signal is read-only, so a control bound to it must not assign it", () => {
	const source = signal<string | null>("scheduler");
	const open = computed(() => source.value === "scheduler");
	assertEquals(isWritableSignal(open), false);
	assertEquals(open.value, true);
});
