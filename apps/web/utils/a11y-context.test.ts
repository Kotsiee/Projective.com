import { assertEquals } from "@std/assert";
import {
	A11Y_COOKIE,
	a11yRootAttributes,
	a11ySetCookie,
	DEFAULT_A11Y,
	parseA11y,
	resolveA11yContext,
	serializeA11y,
} from "./a11y-context.ts";

Deno.test("a11y cookie — round-trips every overlay", () => {
	const overlays = {
		contrast: "high",
		font: "dyslexic",
		cvd: "deutan",
		motion: "reduced",
		dir: "rtl",
	} as const;
	assertEquals(
		serializeA11y(overlays),
		"contrast-high_font-dyslexic_cvd-deutan_motion-reduced_dir-rtl",
	);
	assertEquals(parseA11y(serializeA11y(overlays)), overlays);
});

Deno.test("a11y cookie — missing, junk and tampered values degrade field by field to no overlay", () => {
	assertEquals(parseA11y(null), DEFAULT_A11Y);
	assertEquals(parseA11y(""), DEFAULT_A11Y);
	assertEquals(parseA11y("%E0%A4%A"), DEFAULT_A11Y);
	assertEquals(parseA11y("contrast-blinding_font-dyslexic_cvd-<script>"), {
		...DEFAULT_A11Y,
		font: "dyslexic",
	});
	assertEquals(parseA11y(encodeURIComponent("motion-reduced")), {
		...DEFAULT_A11Y,
		motion: "reduced",
	});
});

Deno.test("a11y cookie — the cookie value needs no quoting", () => {
	const value = serializeA11y({
		contrast: "high",
		font: "sans",
		cvd: "none",
		motion: "standard",
		dir: "ltr",
	});
	assertEquals(/^[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]+$/.test(value), true);
	assertEquals(
		a11ySetCookie(DEFAULT_A11Y),
		`${A11Y_COOKIE}=contrast-standard_font-sans_cvd-none_motion-standard_dir-auto; Path=/; Max-Age=31536000; SameSite=Lax`,
	);
});

Deno.test("root attributes — only overlays that are on are written, so the OS media queries still apply", () => {
	assertEquals(a11yRootAttributes(DEFAULT_A11Y), {});
	assertEquals(
		a11yRootAttributes({
			contrast: "high",
			font: "dyslexic",
			cvd: "protan",
			motion: "reduced",
			dir: "rtl",
		}),
		{
			"data-contrast": "high",
			"data-font": "dyslexic",
			"data-cvd": "protan",
			"data-motion": "reduced",
			dir: "rtl",
		},
	);
});

Deno.test("resolveA11yContext — finds the cookie among others, and defaults without it", () => {
	const req = (cookie?: string) => new Request("http://x/", { headers: cookie ? { cookie } : {} });
	assertEquals(resolveA11yContext(req()), DEFAULT_A11Y);
	assertEquals(
		resolveA11yContext(
			req("pj.currency=EUR; pj.a11y=contrast-high_motion-reduced; sb-access-token=x"),
		),
		{ ...DEFAULT_A11Y, contrast: "high", motion: "reduced" },
	);
});

Deno.test("a11y cookie — an older cookie without a direction reads as auto", () => {
	assertEquals(parseA11y("contrast-high_font-sans_cvd-none_motion-standard").dir, "auto");
	assertEquals(parseA11y("dir-sideways").dir, "auto");
	assertEquals(a11yRootAttributes({ ...DEFAULT_A11Y, dir: "auto" }), {});
});
