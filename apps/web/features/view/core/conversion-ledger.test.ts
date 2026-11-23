import { assertEquals } from "@std/assert";
import type { ProjectStage } from "@projective/types/explore";
import {
	callLedger,
	applyLedger,
	flatLedger,
	type LedgerPrice,
	pipelineLedger,
	seatLedger,
	sessionLedger,
	stageLedger,
} from "./conversion-ledger.ts";

function stage(index: number, min: number, max = min): ProjectStage {
	return {
		id: `stg-${index}`,
		index,
		name: `Stage ${index}`,
		description: "",
		status: "upcoming",
		seatKind: "seats",
		openSeats: 1,
		seatsTotal: 1,
		seatsFilled: 0,
		roles: [],
		price: { min, max, label: "" },
		skills: [],
	};
}

const GBP_60: LedgerPrice = {
	amount: { minor: 6000, currency: "GBP" },
	fallback: "£60",
	unit: "session",
	isFloor: false,
};

Deno.test("stageLedger sums the funded stages' floors in the listing's currency", () => {
	const ledger = stageLedger([stage(1, 400), stage(2, 600)], "GBP");
	assertEquals(ledger.lines.map((l) => l.amount?.minor), [40000, 60000]);
	assertEquals(ledger.total, {
		label: "Due now · 2 stages",
		amount: { minor: 100000, currency: "GBP" },
		isFloor: false,
	});
	assertEquals(ledger.note, null);
});

Deno.test("stageLedger scales by the currency's own exponent, never a fixed ×100", () => {
	assertEquals(stageLedger([stage(1, 5000)], "JPY").total?.amount, {
		minor: 5000,
		currency: "JPY",
	});
});

Deno.test("a ranged stage makes the total a floor and says why", () => {
	const ledger = stageLedger([stage(1, 400, 800)], "GBP");
	assertEquals(ledger.total?.isFloor, true);
	assertEquals(ledger.total?.label, "Due now");
	assertEquals(typeof ledger.note, "string");
});

Deno.test("nothing funded states no total", () => {
	assertEquals(stageLedger([], "GBP").total, null);
});

Deno.test("flatLedger totals at the headline, or defers to the provider without a figure", () => {
	assertEquals(flatLedger(GBP_60, "One deliverable").total?.amount.minor, 6000);
	const quoted = flatLedger(
		{ amount: null, fallback: "Contact us", isFloor: false },
		"One deliverable",
	);
	assertEquals(quoted.total, null);
	assertEquals(quoted.lines[0].text, "Contact us");
});

Deno.test("a single session totals at its price; an unpicked one says so", () => {
	const ledger = sessionLedger(GBP_60, [], 1);
	assertEquals(ledger.lines[0].text, "No time picked yet");
	assertEquals(ledger.total?.amount.minor, 6000);
});

Deno.test("a block quotes per session and leaves its total to checkout", () => {
	const ledger = sessionLedger(GBP_60, ["Tue 14 Nov · 10:00–11:00"], 4);
	assertEquals(ledger.total, null);
	assertEquals(ledger.lines.map((l) => l.key), ["pick-0", "later", "rate"]);
	assertEquals(ledger.lines[1].label, "3 more sessions");
});

Deno.test("callLedger totals only a paid call with a set fee", () => {
	assertEquals(callLedger("courtesy", 20, null, null).total, null);
	assertEquals(callLedger("paid", 45, null, null).total, null);
	assertEquals(
		callLedger("paid", 45, "Tue · 10:00", { minor: 5000, currency: "GBP" }).total?.amount.minor,
		5000,
	);
});

Deno.test("seatLedger multiplies a per-seat price by the seats", () => {
	const ledger = seatLedger({ ...GBP_60, unit: "seat" }, 3, "4 sittings from Tue 14 Nov");
	assertEquals(ledger.total?.amount.minor, 18000);
	assertEquals(ledger.lines[0].key, "sittings");
});

Deno.test("a listing sold by the hour totals its sittings' own prices (SC10)", () => {
	const hourly = { ...GBP_60, unit: "hour" };
	const one = sessionLedger(hourly, ["Tue 14 Nov · 10:00–11:30"], 1, [9000]);
	assertEquals(one.total?.amount.minor, 9000);
	assertEquals(one.lines.find((l) => l.key === "rate")?.label, "Per hour");
	const block = sessionLedger(hourly, [], 3, [10501, 2917, 7001]);
	assertEquals([block.total?.label, block.total?.amount.minor], ["Block total", 20419]);
	const seats = seatLedger({ ...GBP_60, unit: "hour per seat" }, 2, null, [4500, 3000]);
	assertEquals(seats.lines.find((l) => l.key === "seat")?.amount?.minor, 7500);
	assertEquals(seats.total?.amount.minor, 15000);
});

Deno.test("applyLedger names the stage without its index and prices the chosen role", () => {
	const s: ProjectStage = {
		...stage(2, 100, 300),
		name: "Build",
		roles: [
			{ id: "rol-a", name: "Frontend", openSeats: 2, price: { min: 250, max: 250, label: "" } },
			{ name: "Closed role", openSeats: 0, price: { min: 1, max: 1, label: "" } },
		],
	};
	const any = applyLedger(s, "", "USD");
	assertEquals(any.lines.map((l) => l.text ?? l.amount?.minor), ["Build", "Any open role", 10000, "1 open"]);
	assertEquals(any.lines[2].isFloor, true);
	const picked = applyLedger(s, "rol-a", "USD");
	assertEquals(picked.lines.map((l) => l.text ?? l.amount?.minor), ["Build", "Frontend", 25000, "2 open"]);
	assertEquals(picked.total, null);
	assertEquals(applyLedger(null, "", "USD").lines, []);
});

Deno.test("pipelineLedger lists every stage at its own price and states no total", () => {
	const ledger = pipelineLedger([stage(1, 400), stage(2, 600, 900)], "GBP");
	assertEquals(ledger.lines.map((l) => l.amount?.minor), [40000, 60000]);
	assertEquals(ledger.lines.map((l) => l.isFloor), [false, true]);
	assertEquals(ledger.total, null);
	assertEquals(typeof ledger.note, "string");
});
