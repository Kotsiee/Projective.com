/**
 * The demo stage as the server renders it (`flows/LANDING.md` §2.1 notes 10–13, §4.4): one h2 under
 * the "See it work" section header, the always-visible stage note, a tablist of four tabs that are
 * links with no JavaScript, a roving tab stop on the open tab, one panel per tab tied to its tab,
 * the closed ones hidden, every panel with its crawlable description and its poster inside a
 * reserved viewport (the Work board's being the real kanban, held still), the caption, "Start again"
 * holding its room but not shown until a demo is live, one "/features" link beside the tabs where the
 * page asks for it (`/` does), and the host's polite live region. `DemoStage` itself mounts the
 * island, whose stylesheets cannot load under `deno test`, so the stage is rendered from the same
 * parts it composes.
 */
import { assert, assertEquals, assertFalse, assertMatch } from "@std/assert";
import { renderToString } from "npm:preact-render-to-string@^6.7.0";
import type { DemoId } from "../core/demos/demo-contract.ts";
import {
	BOARD_POSTER_LABEL,
	DEMO_IDS,
	DEMO_STAGE_COPY,
	DEMO_TABS,
	demoDescription,
	demoDomIds,
	demoHref,
} from "../core/demo-stage.ts";
import { BOARD_LANES, createBoard, LANE_LABEL, scriptFrames } from "../core/demos/board-model.ts";
import { DEMO_BOARD } from "../core/demos/board-fixtures.ts";
import { DEMO_TITLE_ID, DemoStageHeader, DemoStageView } from "./DemoStageView.tsx";
import { BoardPicture } from "./demos/BoardPicture.tsx";
import { BookingPoster } from "./demos/BookingPicture.tsx";

// #region Fixtures
const FEE_BP = 500;

/** The Work board's poster, exactly as `DemoStage` builds it. */
function boardPoster() {
	const board = createBoard(DEMO_BOARD, { feeBp: FEE_BP });
	const [still] = scriptFrames(board, []);
	return (
		<BoardPicture
			frame={still}
			title={board.title}
			walletMinor={board.walletMinor}
			currency={board.currency}
			lane={1}
		/>
	);
}

/**
 * The posters as `DemoStage` hands them over. Booking's is the real one; Payment protection's and
 * Team pay's draw `MoneyView`, whose stylesheet cannot load under `deno test`, so they stand in as
 * the same named, inert picture (their parts are pinned by their models' tests).
 */
function posters() {
	const standIn = (id: "payments" | "splits") => (
		<div class="lp-demo-poster" role="img" aria-label={DEMO_TABS[id].posterLabel}>
			<div class="lp-demo-poster__still" inert>{id}</div>
		</div>
	);
	return {
		board: boardPoster(),
		payments: standIn("payments"),
		booking: <BookingPoster />,
		splits: standIn("splits"),
	};
}

interface RenderOptions {
	active?: DemoId;
	features?: boolean;
	feeBp?: number | null;
	live?: preact.ComponentChildren | null;
	onReset?: () => void;
	/** The host has hydrated: the tablist is a roving tab stop. */
	roving?: boolean;
}

/** The section as `DemoStage` composes it: the header, then the stage over the poster. */
function render(options: RenderOptions = {}): string {
	return renderToString(
		<section id="demo" class="lp-demo" aria-labelledby={DEMO_TITLE_ID}>
			<div class="lp-demo__inner">
				<DemoStageHeader />
				<DemoStageView
					active={options.active ?? "board"}
					feeBp={options.feeBp === undefined ? FEE_BP : options.feeBp}
					features={options.features ?? false}
					live={options.live ?? null}
					posters={posters()}
					roving={options.roving}
					announcement={{ key: 0, text: "" }}
					onReset={options.onReset}
				/>
			</div>
		</section>,
	);
}

/** Every opening tag carrying `attr="value"`. */
function tagsWith(html: string, attr: string, value: string): string[] {
	return html.match(new RegExp(`<[a-z]+[^>]*\\s${attr}="${value}"[^>]*>`, "g")) ?? [];
}

/** The value of `attr` in one opening tag, or `null`. */
function attrOf(tag: string, attr: string): string | null {
	return tag.match(new RegExp(`\\s${attr}="([^"]*)"`))?.[1] ?? null;
}

/** The markup of the element whose opening tag has `id`, through its matching close (one level). */
function panelOf(html: string, id: DemoId): string {
	const { panel } = demoDomIds(id);
	const start = html.indexOf(`id="${panel}"`);
	assert(start !== -1, `no panel ${panel}`);
	const next = DEMO_IDS.map((other) => html.indexOf(`id="${demoDomIds(other).panel}"`, start + 1))
		.filter((at) => at > start);
	const live = html.indexOf('role="status"', start);
	return html.slice(start, Math.min(...next, live === -1 ? html.length : live));
}

function count(hay: string, needle: string): number {
	return hay.split(needle).length - 1;
}
// #endregion

// #region Head
Deno.test("one h2 under the section header, labelling the section, and the notes always shown", () => {
	const html = render();
	assertEquals(count(html, "<h2"), 1);
	assertEquals(count(html, "<h1"), 0, "the page's one h1 is the hero's");
	assertMatch(html, new RegExp(`<h2 id="${DEMO_TITLE_ID}"[^>]*>${DEMO_STAGE_COPY.title}</h2>`));
	assertMatch(html, /<section id="demo"[^>]*aria-labelledby="demo-title"/);
	assert(html.includes(`>${DEMO_STAGE_COPY.eyebrow}</p>`));
	assert(html.includes(">Example only. No real money moves.</p>"));
	assert(html.includes(`>${DEMO_STAGE_COPY.role}</p>`));
});
// #endregion

// #region Tabs
Deno.test("a tablist of four tabs, each a link that opens its tab with no JavaScript", () => {
	const html = render();
	assertEquals(tagsWith(html, "role", "tablist").length, 1);
	assertEquals(attrOf(tagsWith(html, "role", "tablist")[0], "aria-label"), "Examples");
	const tabs = tagsWith(html, "role", "tab");
	assertEquals(tabs.length, 4);
	DEMO_IDS.forEach((id, index) => {
		const tab = tabs[index];
		assert(tab.startsWith("<a"), "a link, so it works before hydration");
		assertEquals(attrOf(tab, "id"), demoDomIds(id).tab);
		assertEquals(attrOf(tab, "aria-controls"), demoDomIds(id).panel);
		assertEquals(attrOf(tab, "href"), demoHref(id));
		assert(html.includes(`>${DEMO_TABS[id].label}</a>`));
	});
});

Deno.test("server-rendered, every tab is its own tab stop: with no JavaScript all four are reachable", () => {
	for (const active of DEMO_IDS) {
		const tabs = tagsWith(render({ active }), "role", "tab");
		const selected = tabs.filter((tab) => attrOf(tab, "aria-selected") === "true");
		assertEquals(selected.length, 1, active);
		assertEquals(attrOf(selected[0], "id"), demoDomIds(active).tab);
		for (const tab of tabs) {
			assertEquals(attrOf(tab, "tabindex"), null, `${active}: a plain link, in the tab order`);
			assert(attrOf(tab, "href"), "a link the keyboard reaches and follows");
		}
	}
});

Deno.test("hydrated, exactly the open tab holds the roving tab stop, deep links included", () => {
	for (const active of DEMO_IDS) {
		const tabs = tagsWith(render({ active, roving: true }), "role", "tab");
		const selected = tabs.filter((tab) => attrOf(tab, "aria-selected") === "true");
		assertEquals(selected.length, 1, active);
		assertEquals(attrOf(selected[0], "tabindex"), "0");
		for (const tab of tabs.filter((tab) => tab !== selected[0])) {
			assertEquals(attrOf(tab, "aria-selected"), "false");
			assertEquals(attrOf(tab, "tabindex"), "-1");
		}
	}
});

Deno.test("one link to /features beside the tabs where the page asks for it; none otherwise", () => {
	assertFalse(render().includes('href="/features"'));
	const html = render({ features: true });
	assertEquals(count(html, 'href="/features"'), 1);
	assert(html.includes(`${DEMO_STAGE_COPY.more}<span aria-hidden="true">→</span></a>`));
});

Deno.test("`/` asks for it: the page controller hands the stage `features`", () => {
	const source = Deno.readTextFileSync(new URL("../routes/LandingPage.tsx", import.meta.url));
	assert(source.includes("demo: <DemoStage demo={demo} feeBp={feeBp} features />,"));
});
// #endregion

// #region Panels
Deno.test("one panel per tab, tied to its tab, every closed one hidden", () => {
	for (const active of DEMO_IDS) {
		const panels = tagsWith(render({ active }), "role", "tabpanel");
		assertEquals(panels.length, 4);
		DEMO_IDS.forEach((id, index) => {
			const panel = panels[index];
			assertEquals(attrOf(panel, "id"), demoDomIds(id).panel);
			assertEquals(attrOf(panel, "aria-labelledby"), demoDomIds(id).tab);
			assertEquals(attrOf(panel, "aria-describedby"), demoDomIds(id).desc);
			assertEquals(/\shidden(=|\s|>)/.test(panel), id !== active, `${active}: ${id}`);
			assertEquals(attrOf(panel, "tabindex"), "0", "a poster panel has nothing else to focus");
		});
	}
});

Deno.test("every panel reserves its viewport and carries its crawlable description and caption", () => {
	const html = render();
	assertEquals(tagsWith(html, "data-state", "poster").length, 4, "no viewport is missing");
	for (const id of DEMO_IDS) {
		const panel = panelOf(html, id);
		assertMatch(
			panel,
			/class="lp-demo__window"><div class="lp-demo__viewport" data-state="poster">/,
		);
		assert(
			panel.includes(
				`<p id="${demoDomIds(id).desc}" class="lp-demo__desc">${demoDescription(id, FEE_BP)}</p>`,
			),
			`${id}: its description`,
		);
		assert(
			panel.includes(`>${DEMO_TABS[id].caption}</p>`),
			`${id}: caption`,
		);
	}
});

Deno.test("the Work board's poster is the real kanban, held still and named as one picture", () => {
	const board = panelOf(render(), "board");
	assertMatch(board, new RegExp(`role="img" aria-label="${BOARD_POSTER_LABEL}"`));
	assert(board.includes("inert"));
	assertEquals(count(board, 'class="ui-kanban__column"'), 5);
	for (const lane of BOARD_LANES) assert(board.includes(`aria-label="${LANE_LABEL[lane]}"`), lane);
	assert(board.includes("Homepage design"));
	assert(board.includes("Needs funding"), "the product's tag (#288 (G))");
	assert(board.includes("£600.00"), "the client's wallet");
	const poster = board.slice(board.indexOf('role="img"'), board.indexOf("lp-demo__desc"));
	assertFalse(/<button|<select|role="button"|tabindex=/.test(poster), "nothing to press");
	assertEquals(
		count(poster, 'class="lp-ticket__approve"'),
		2,
		"Pay and Approve, drawn as pictures",
	);
	assertMatch(poster, /data-lane="1"/);
});

Deno.test("every poster is a server-rendered still of its demo, named as one picture — no placeholder", () => {
	const html = render({ active: "booking" });
	assertFalse(html.includes("placehold.co"), "§8: the placeholders are retired");
	for (const id of DEMO_IDS) {
		const panel = panelOf(html, id);
		assertMatch(panel, new RegExp(`role="img" aria-label="${DEMO_TABS[id].posterLabel}"`), id);
		assert(panel.includes("inert"), `${id}: held still`);
		assertFalse(/<img[^>]*placehold/.test(panel), id);
	}
	const booking = panelOf(html, "booking");
	const still = booking.slice(booking.indexOf('role="img"'), booking.indexOf("lp-demo__desc"));
	assert(still.includes("Times shown in your time zone (London). The freelancer is in New York."));
	assert(still.includes("Brand workshop"), "the group session beside the times");
	assertFalse(/<button|<select|role="button"|tabindex=/.test(still), "nothing to press");
});

Deno.test("DemoStage hands every poster to the island, each the demo's own server-rendered parts", () => {
	const source = Deno.readTextFileSync(new URL("./DemoStage.tsx", import.meta.url));
	assert(source.includes("paymentsPoster={<PaymentsPoster feeBp={feeBp} />}"));
	assert(source.includes("bookingPoster={<BookingPoster />}"));
	assert(source.includes("splitsPoster={<TeamPayPoster feeBp={feeBp} />}"));
});

Deno.test("no fee from the server: every description drops its fee clause", () => {
	const html = render({ feeBp: null });
	for (const id of DEMO_IDS) {
		assertFalse(/fee/.test(demoDescription(id, null)));
		assert(panelOf(html, id).includes(demoDescription(id, null)));
	}
});
// #endregion

// #region Controls
Deno.test("Start again keeps its room on the server but is not shown until a demo is live", () => {
	const html = render();
	const resets = tagsWith(html, "data-ready", "false");
	assertEquals(resets.length, 4);
	for (const reset of resets) {
		assertEquals(attrOf(reset, "aria-label"), null, "named by its visible words (WCAG 2.5.3)");
		assertMatch(reset, /\sdisabled/);
	}
	assert(html.includes(">Start again</button>"));
});

Deno.test("live: the open panel shows the demo, keeps its description quietly, and can reset", () => {
	const html = render({ live: <div id="live-demo" />, onReset: () => {} });
	const board = panelOf(html, "board");
	assert(board.includes('<div id="live-demo"></div>'));
	assert(board.includes('data-state="live"'));
	assertFalse(board.includes(BOARD_POSTER_LABEL), "the poster gives way to the demo");
	assert(board.includes('class="lp-demo__desc lp-demo__desc--quiet"'));
	const reset = tagsWith(board, "data-ready", "true");
	assertEquals(reset.length, 1);
	assertFalse(/\sdisabled/.test(reset[0]));
	assertEquals(attrOf(tagsWith(html, "role", "tabpanel")[0], "tabindex"), null);
	assertEquals(tagsWith(html, "data-state", "poster").length, 3);
});

Deno.test("the host's live region is polite and starts silent", () => {
	const html = render();
	assertMatch(
		html,
		/<div class="ui-visually-hidden" role="status" aria-live="polite" aria-atomic="true"><\/div>/,
	);
});

Deno.test("DemoStage composes exactly these parts around the island", () => {
	const source = Deno.readTextFileSync(new URL("./DemoStage.tsx", import.meta.url));
	assert(
		source.includes(
			'<section id={DEMO_SECTION_ID} class="lp-demo" aria-labelledby={DEMO_TITLE_ID}>',
		),
	);
	assert(source.includes("<DemoStageHeader />"));
	assertMatch(
		source,
		/<DemoHost\s+initial=\{demo\}\s+feeBp=\{feeBp\}\s+features=\{features\}[\s\S]*?\n\t\t\t\t>\s*<BoardPicture/,
	);
});
// #endregion
