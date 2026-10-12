import { assertEquals } from "@std/assert";
import { inpFrom, LayoutShiftWindows, rateVital } from "./web-vitals-model.ts";

Deno.test("ratings follow the published bands, inclusive of the good edge", () => {
	assertEquals(rateVital("LCP", 2500), "good");
	assertEquals(rateVital("LCP", 4000), "needs-improvement");
	assertEquals(rateVital("LCP", 4001), "poor");
	assertEquals(rateVital("CLS", 0.1), "good");
	assertEquals(rateVital("INP", 501), "poor");
});

Deno.test("CLS is the worst session window, not the lifetime sum", () => {
	const cls = new LayoutShiftWindows();
	cls.add(0.05, 0);
	cls.add(0.05, 500);
	cls.add(0.02, 3000);
	cls.add(0.02, 3500);
	assertEquals(Math.round(cls.value * 1000) / 1000, 0.1);
});

Deno.test("a session window closes after 5 s even with no gap", () => {
	const cls = new LayoutShiftWindows();
	for (let t = 0; t <= 6000; t += 900) cls.add(0.01, t);
	assertEquals(Math.round(cls.value * 1000) / 1000, 0.06);
});

Deno.test("INP skips one outlier per 50 interactions", () => {
	assertEquals(inpFrom([]), null);
	assertEquals(inpFrom([80, 300, 120]), 300);
	const many = Array.from({ length: 100 }, (_, i) => i);
	assertEquals(inpFrom(many), 97);
});
