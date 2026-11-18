import { assertEquals } from "@std/assert";
import { renderToString } from "npm:preact-render-to-string@^6.7.0";
import {
	maskFigures,
	screenShareActive,
	ScreenShareContext,
	setAmbientScreenShareResolver,
	setScreenShareActive,
	useMaskFigures,
	useScreenShareActive,
} from "./screen-share.ts";

function Probe() {
	return <i>{useScreenShareActive() ? "on" : "off"}</i>;
}

function render(context: boolean | null): string {
	return renderToString(
		context === null ? <Probe /> : (
			<ScreenShareContext.Provider value={{ active: context }}>
				<Probe />
			</ScreenShareContext.Provider>
		),
	);
}

Deno.test("screen share store — off with no document", () => {
	assertEquals(screenShareActive.value, false);
	assertEquals(render(null), "<i>off</i>");
});

Deno.test("screen share store — the request context wins over the store", () => {
	setScreenShareActive(true);
	try {
		assertEquals(render(false), "<i>off</i>");
		setScreenShareActive(false);
		assertEquals(render(true), "<i>on</i>");
	} finally {
		setScreenShareActive(false);
	}
});

Deno.test("screen share store — the ambient resolver answers where the context does not reach", () => {
	setAmbientScreenShareResolver(() => ({ active: true }));
	try {
		assertEquals(render(null), "<i>on</i>");
		assertEquals(render(false), "<i>off</i>");
	} finally {
		setAmbientScreenShareResolver(null);
	}
	setAmbientScreenShareResolver(() => null);
	try {
		setScreenShareActive(true);
		assertEquals(render(null), "<i>on</i>");
	} finally {
		setScreenShareActive(false);
		setAmbientScreenShareResolver(null);
	}
});

Deno.test("useMaskFigures — masks a label's amount only while the mode is on", () => {
	function Label() {
		return <b>{useMaskFigures()("Pay £1,200.00 now")}</b>;
	}
	const on = renderToString(
		<ScreenShareContext.Provider value={{ active: true }}>
			<Label />
		</ScreenShareContext.Provider>,
	);
	const off = renderToString(
		<ScreenShareContext.Provider value={{ active: false }}>
			<Label />
		</ScreenShareContext.Provider>,
	);
	assertEquals(on, "<b>Pay £•••••• now</b>");
	assertEquals(off, "<b>Pay £1,200.00 now</b>");
});

Deno.test("maskFigures — money becomes its symbol and the fixed run; dates and counts stay", () => {
	const M = "••••••";
	const cases: Array<[string, string]> = [
		["Design · £1,200.50", `Design · £${M}`],
		["Stage 2 · €1.400,78 split", `Stage 2 · €${M} split`],
		["US$12,000 retainer", `US$${M} retainer`],
		["GBP 950 deposit", `GBP ${M} deposit`],
		["Paid 1 250,50 kr", `Paid ${M} kr`],
		["2 £400 invoices", `2 £${M} invoices`],
		["12 Mar → 18 Apr", "12 Mar → 18 Apr"],
		["3 tickets, 40% done", "3 tickets, 40% done"],
		["R2 review in Q4 2026", "R2 review in Q4 2026"],
		["-£5", `-£${M}`],
	];
	for (const [input, want] of cases) assertEquals(maskFigures(input), want, input);
	assertEquals(maskFigures("£5"), maskFigures("£987,654,321"));
});
