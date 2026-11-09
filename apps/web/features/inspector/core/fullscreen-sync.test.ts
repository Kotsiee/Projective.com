import { assertEquals } from "@std/assert";
import { createFullscreenSync, type FullscreenHost } from "./fullscreen-sync.ts";

interface FakeHost extends FullscreenHost {
	requests: number;
	exits: number;
	/** The browser leaving fullscreen on its own (Escape). */
	escape(): void;
	/** Something else on the page going fullscreen. */
	other(): void;
}

function fakeHost(
	opts: { supported?: boolean; refuse?: boolean; throws?: boolean } = {},
): FakeHost {
	let active = false;
	const listeners = new Set<() => void>();
	const fire = () => listeners.forEach((l) => l());
	const host: FakeHost = {
		requests: 0,
		exits: 0,
		supported: () => opts.supported ?? true,
		active: () => active,
		request() {
			host.requests += 1;
			if (opts.throws) throw new TypeError("not allowed");
			if (opts.refuse) return Promise.reject(new TypeError("Permissions check failed"));
			active = true;
			fire();
			return Promise.resolve();
		},
		exit() {
			host.exits += 1;
			active = false;
			fire();
			return Promise.resolve();
		},
		onChange(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		escape() {
			active = false;
			fire();
		},
		other() {
			active = true;
			fire();
		},
	};
	return host;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

Deno.test("fullscreen-sync: the theater takes the whole document fullscreen and gives it back", async () => {
	const host = fakeHost();
	let left = 0;
	const sync = createFullscreenSync(host, () => left++);
	sync.enter();
	await settle();
	assertEquals([host.requests, host.active()], [1, true]);
	sync.leave();
	await settle();
	assertEquals([host.exits, host.active(), left], [1, false, 0]);
});

Deno.test("fullscreen-sync: Escape in the browser's fullscreen closes the theater once", async () => {
	const host = fakeHost();
	let left = 0;
	const sync = createFullscreenSync(host, () => {
		left++;
		sync.leave();
	});
	sync.enter();
	await settle();
	host.escape();
	await settle();
	assertEquals([left, host.exits], [1, 0]);
});

Deno.test("fullscreen-sync: a refusal, a throw or no support leaves the theater standing alone", async () => {
	for (const opts of [{ refuse: true }, { throws: true }, { supported: false }]) {
		const host = fakeHost(opts);
		let left = 0;
		const sync = createFullscreenSync(host, () => left++);
		sync.enter();
		await settle();
		sync.leave();
		await settle();
		assertEquals([host.active(), host.exits, left], [false, 0, 0], JSON.stringify(opts));
	}
});

Deno.test("fullscreen-sync: a fullscreen somebody else entered is never taken over or exited", async () => {
	const host = fakeHost();
	let left = 0;
	const sync = createFullscreenSync(host, () => left++);
	host.other();
	sync.enter();
	await settle();
	assertEquals(host.requests, 0);
	sync.leave();
	host.escape();
	await settle();
	assertEquals([host.exits, left], [0, 0]);
});

Deno.test("fullscreen-sync: closing before the browser answers still gives the screen back", async () => {
	let active = false;
	let resolve: () => void = () => {};
	let exits = 0;
	const host: FullscreenHost = {
		supported: () => true,
		active: () => active,
		request: () =>
			new Promise<void>((r) => (resolve = () => {
				active = true;
				r();
			})),
		exit() {
			exits += 1;
			active = false;
			return Promise.resolve();
		},
		onChange: () => () => {},
	};
	const sync = createFullscreenSync(host, () => {});
	sync.enter();
	sync.leave();
	resolve();
	await settle();
	assertEquals([active, exits], [false, 1]);
});

Deno.test("fullscreen-sync: after dispose the browser's changes reach nobody", async () => {
	const host = fakeHost();
	let left = 0;
	const sync = createFullscreenSync(host, () => left++);
	sync.enter();
	await settle();
	sync.dispose();
	host.escape();
	assertEquals(left, 0);
});
