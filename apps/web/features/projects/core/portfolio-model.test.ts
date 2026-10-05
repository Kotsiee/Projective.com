import { assertEquals } from "@std/assert";
import type { ProjectSummary } from "@projective/types/projects";
import {
	aggregateBurn,
	burnPercent,
	countByFilter,
	filterPortfolio,
	meterSegments,
	parsePortfolioFilter,
	portfolioHref,
	stageBurnOf,
} from "./portfolio-model.ts";

/** A minimal row — only the fields the portfolio model reads vary between cases. */
function row(over: Partial<ProjectSummary>): ProjectSummary {
	return {
		id: "00000000-0000-4000-8000-000000000001",
		slug: "prj-test",
		title: "Test",
		kind: "project",
		format: "pipeline",
		status: "active",
		viewerRole: "owner",
		scopeType: "personal",
		scopeId: "me",
		scopeLabel: "Personal",
		owner: { name: "Me", avatar: null, handle: null },
		counterparty: null,
		serviceId: null,
		unread: false,
		starred: false,
		completedStages: null,
		totalStages: null,
		budgetLabel: null,
		updatedAt: "2026-10-01T00:00:00Z",
		...over,
	};
}

Deno.test("parsePortfolioFilter falls back to all for anything unrecognised", () => {
	assertEquals(parsePortfolioFilter("on_hold"), "on_hold");
	assertEquals(parsePortfolioFilter("cancelled"), "all");
	assertEquals(parsePortfolioFilter(""), "all");
	assertEquals(parsePortfolioFilter(null), "all");
});

Deno.test("portfolioHref gives the default filter the bare address", () => {
	assertEquals(portfolioHref("all"), "/projects");
	assertEquals(portfolioHref("draft"), "/projects?status=draft");
});

Deno.test("countByFilter counts every row under all and each lifecycle under its own", () => {
	const items = [
		row({ status: "draft" }),
		row({ status: "active" }),
		row({ status: "active" }),
		row({ status: "cancelled" }),
	];
	assertEquals(countByFilter(items), { all: 4, draft: 1, active: 2, on_hold: 0, completed: 0 });
	assertEquals(filterPortfolio(items, "active").length, 2);
	assertEquals(filterPortfolio(items, "all").length, 4);
});

Deno.test("stageBurnOf is null without a stage count and clamps a bad completed count", () => {
	assertEquals(stageBurnOf(row({})), null);
	assertEquals(stageBurnOf(row({ completedStages: 0, totalStages: 0 })), null);
	assertEquals(stageBurnOf(row({ completedStages: 9, totalStages: 4 })), {
		completed: 4,
		total: 4,
		ratio: 1,
	});
});

Deno.test("aggregateBurn sums stages rather than averaging percentages", () => {
	const items = [
		row({ completedStages: 1, totalStages: 2 }), // 50%
		row({ completedStages: 0, totalStages: 8 }), // 0%
		row({}), // unstaged — excluded, not counted as 0%
	];
	const burn = aggregateBurn(items)!;
	assertEquals([burn.completed, burn.total, burn.projects], [1, 10, 2]);
	assertEquals(burnPercent(burn), 10);
	assertEquals(aggregateBurn([row({})]), null);
});

Deno.test("meterSegments draws one segment per stage up to the cap, then quantises", () => {
	assertEquals(meterSegments({ completed: 2, total: 5, ratio: 0.4 }), { filled: 2, total: 5 });
	assertEquals(meterSegments({ completed: 15, total: 60, ratio: 0.25 }, 20), {
		filled: 5,
		total: 20,
	});
});
