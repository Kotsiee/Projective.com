import { assert, assertEquals, assertFalse } from "@std/assert";
import { renderToString } from "npm:preact-render-to-string@^6.7.0";
import type { ComponentChildren } from "preact";
import { MoneyView } from "./money-view.tsx";
import {
	ScreenShareContext,
	setAmbientScreenShareResolver,
} from "../../utils/core/screen-share.ts";
import type { MoneyValue } from "./currency-store.ts";

const CONVERTED: MoneyValue = {
	minor: 123456,
	currency: "GBP",
	display: "£1,234.56",
	origin: { minor: 140078, currency: "EUR", display: "€1,400.78", fxRate: 0.8813 },
};

function shared(children: ComponentChildren, active: boolean): string {
	return renderToString(
		<ScreenShareContext.Provider value={{ active }}>{children}</ScreenShareContext.Provider>,
	);
}

function attributes(html: string): string[] {
	return [...html.matchAll(/\s([a-z-]+)="([^"]*)"/g)].map((m) => `${m[1]}=${m[2]}`);
}

Deno.test("MoneyView masked — no figure in text, data-*, title or aria-*", () => {
	const html = shared(<MoneyView value={CONVERTED} displayCurrency="GBP" />, true);
	assertFalse(/\d/.test(html), html);
	assertFalse(html.includes("title="));
	assertFalse(html.includes("data-money-minor"));
	for (const attr of attributes(html)) assertFalse(/\d/.test(attr), attr);
	assert(html.includes("data-money-masked"));
	assert(html.includes(">£<"));
	assert(html.includes("••••••"));
	assert(html.includes("Amount hidden while screen sharing"));
	assert(html.includes("ui-obscure--mask"));
});

Deno.test("MoneyView masked — the sign and a trailing symbol stay, the run never varies", () => {
	const small = shared(<MoneyView minor={5} currency="GBP" sign="−" />, true);
	const large = shared(<MoneyView minor={987654321} currency="GBP" sign="−" />, true);
	assertEquals(small, large);
	assert(small.includes(`class="ui-money__sign">−<`));
	const suffixed = shared(<MoneyView minor={125050} currency="SEK" locale="sv-SE" />, true);
	assertFalse(/\d/.test(suffixed), suffixed);
	assert(suffixed.includes("kr"));
});

Deno.test("MoneyView masked — an exact figure drops its reference and carries no data-money", () => {
	const html = shared(
		<MoneyView
			value={{ minor: 9000, currency: "EUR", display: "€90.00", origin: null }}
			exact
			reference={{
				value: { minor: 7850, currency: "GBP", display: "£78.50", origin: null },
				rateLabel: "1 GBP = 1.15 EUR",
			}}
		/>,
		true,
	);
	assertFalse(/\d/.test(html), html);
	assertFalse(html.includes("data-money="));
	assertFalse(html.includes("Listed at"));
	assert(html.includes("data-money-masked"));
});

Deno.test("MoneyView masked — the ambient resolver masks where the context does not reach", () => {
	setAmbientScreenShareResolver(() => ({ active: true }));
	try {
		const html = renderToString(<MoneyView value={CONVERTED} displayCurrency="GBP" />);
		assertFalse(/\d/.test(html), html);
	} finally {
		setAmbientScreenShareResolver(null);
	}
});

Deno.test("MoneyView unmasked — unchanged: the figure, its origin and the bridge contract", () => {
	const html = shared(<MoneyView value={CONVERTED} displayCurrency="GBP" />, false);
	assert(html.includes(`data-money-minor="140078"`));
	assert(html.includes("1,234"));
	assert(html.includes("title="));
	assertFalse(html.includes("data-money-masked"));
	assertFalse(html.includes("ui-obscure"));
});
