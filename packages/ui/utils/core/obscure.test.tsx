import { assert, assertEquals, assertFalse } from "@std/assert";
import { renderToString } from "npm:preact-render-to-string@^6.7.0";
import type { ComponentChildren } from "preact";
import { ObscureMarkup as Obscure, type ObscureTier } from "./obscure.tsx";
import { ScreenShareContext } from "./screen-share.ts";

const SECRET = "sk_live_51Hq8ZQ2eZvKYlo2C";

function shared(children: ComponentChildren, active: boolean): string {
	return renderToString(
		<ScreenShareContext.Provider value={{ active }}>{children}</ScreenShareContext.Provider>,
	);
}

/** Stands in for an island: Fresh serializes an island's props only when it renders. */
function spyIsland(rendered: string[]) {
	return function SecretReveal(props: { secret: string }) {
		rendered.push(props.secret);
		return <code>{props.secret}</code>;
	};
}

Deno.test("Obscure — off, every tier renders its children and no masked marker", () => {
	for (const tier of ["mask", "solid", "blur", "omit"] as ObscureTier[]) {
		const html = shared(<Obscure tier={tier}>ines@example.com</Obscure>, false);
		assert(html.includes("ines@example.com"), tier);
		assert(html.includes(`data-obscure="${tier}"`), tier);
		assertFalse(html.includes("data-obscure-masked"), tier);
	}
});

Deno.test("Obscure — on, mask and solid never render the value, and name what is hidden", () => {
	const mask = shared(<Obscure tier="mask">GB29 NWBK 6016 1331 9268 19</Obscure>, true);
	assertFalse(/\d/.test(mask), mask);
	assert(mask.includes("ui-obscure__mask"));
	assert(mask.includes("Hidden while screen sharing"));
	const solid = shared(
		<Obscure tier="solid" label="Email hidden while screen sharing">ines@example.com</Obscure>,
		true,
	);
	assertFalse(solid.includes("ines@"), solid);
	assert(solid.includes("ui-obscure__placeholder"));
	assert(solid.includes("Email hidden while screen sharing"));
	assert(solid.includes("data-obscure-masked"));
});

Deno.test("Obscure — on, the solid placeholder is the same whatever the value's length", () => {
	const short = shared(<Obscure tier="solid">a@b.co</Obscure>, true);
	const long = shared(
		<Obscure tier="solid">a.very.long.address@example-company.co.uk</Obscure>,
		true,
	);
	assertEquals(short, long);
});

Deno.test("Obscure — on, omit renders nothing but its stand-in, and never renders a child island", () => {
	const rendered: string[] = [];
	const SecretReveal = spyIsland(rendered);
	const html = shared(
		<Obscure tier="omit">
			<SecretReveal secret={SECRET} />
		</Obscure>,
		true,
	);
	assertEquals(rendered, []);
	assertFalse(html.includes(SECRET));
	assert(html.includes(`data-obscure="omit"`));
	assert(html.includes("data-obscure-masked"));
	const named = shared(<Obscure tier="omit" standIn="the client">Acme Holdings Ltd</Obscure>, true);
	assert(named.includes("the client"));
	assertFalse(named.includes("Acme"));
});

Deno.test("Obscure — on, mask and solid never render a child island either", () => {
	for (const tier of ["mask", "solid"] as ObscureTier[]) {
		const rendered: string[] = [];
		const SecretReveal = spyIsland(rendered);
		shared(
			<Obscure tier={tier}>
				<SecretReveal secret={SECRET} />
			</Obscure>,
			true,
		);
		assertEquals(rendered, [], tier);
	}
});

Deno.test("Obscure — on, blur keeps the media and marks it masked", () => {
	const html = shared(
		<Obscure tier="blur">
			<img src="/thumb.webp" alt="" />
		</Obscure>,
		true,
	);
	assert(html.includes(`src="/thumb.webp"`));
	assert(html.includes("data-obscure-masked"));
	assert(html.includes("ui-obscure--blur"));
});

Deno.test("Obscure — block content renders as a div", () => {
	const html = shared(<Obscure tier="solid" as="div">A statement</Obscure>, false);
	assert(html.startsWith("<div"));
});
