import { assert, assertEquals, assertFalse } from "@std/assert";
import { renderToString } from "npm:preact-render-to-string@^6.7.0";
import { CommitLabel, CommitReviewBody } from "./CommitReviewBody.tsx";
import {
	commitLinkClass,
	commitReviewActions,
	commitReviewDialog,
	commitReviewRefocusIndex,
} from "../core/commit-review.ts";

const css = Deno.readTextFileSync(new URL("../styles/commit-review.css", import.meta.url));

/** The declarations of one top-level rule in commit-review.css. */
function rule(selector: string): string {
	const at = css.indexOf(`${selector} {`);
	assert(at >= 0, `missing rule ${selector}`);
	return css.slice(at, css.indexOf("}", at));
}

// #region Body
Deno.test("the body is the figure, the facts as label · value pairs, then the consequence", () => {
	const html = renderToString(
		<CommitReviewBody
			total="US$640.00"
			rows={[
				{ label: "From", value: "Helia Finance wallet" },
				{ label: "Balance after", value: "US$8,233.00", tabular: true },
			]}
			consequence="This can't be reversed."
		/>,
	);
	assertEquals(
		html,
		'<div class="ui-commit-review">' +
			'<p class="ui-commit-review__total">US$640.00</p>' +
			'<dl class="ui-commit-review__rows">' +
			'<div class="ui-commit-review__row"><dt class="ui-commit-review__label">From</dt>' +
			'<dd class="ui-commit-review__value">Helia Finance wallet</dd></div>' +
			'<div class="ui-commit-review__row"><dt class="ui-commit-review__label">Balance after</dt>' +
			'<dd class="ui-commit-review__value ui-commit-review__value--tabular">' +
			'<span class="ui-commit-review__figure">US$8,233.00</span></dd></div>' +
			"</dl>" +
			`<p class="ui-commit-review__note">This can't be reversed.</p>` +
			"</div>",
	);
});

Deno.test("an absent figure, fact list or consequence renders nothing in its place", () => {
	const html = renderToString(<CommitReviewBody rows={[]} notice={<p>Refused</p>} />);
	assertEquals(html, '<div class="ui-commit-review"><p>Refused</p></div>');
});
// #endregion

// #region Actions
Deno.test("an in-place commit: Cancel first, then exactly one amber pill", () => {
	const actions = commitReviewActions({
		mode: "action",
		commitLabel: "Pay US$640.00",
		busy: false,
		failed: false,
	});
	assertEquals(actions.map((a) => a.role), ["cancel", "commit"]);
	assertEquals(actions.filter((a) => a.severity === "accent").length, 1);
	assertEquals(actions.filter((a) => a.variant === "filled").map((a) => a.role), ["commit"]);
	const [cancel, commit] = actions;
	assertEquals([cancel.label, cancel.variant, cancel.rounded], ["Cancel", "text", false]);
	assertEquals([commit.label, commit.element, commit.rounded], ["Pay US$640.00", "button", true]);
});

Deno.test("in flight, Cancel is disabled and the commit spins; refused, it offers Try again", () => {
	const busy = commitReviewActions({
		mode: "action",
		commitLabel: "Pay",
		busy: true,
		failed: false,
	});
	assertEquals(busy.map((a) => [a.disabled, a.loading]), [[true, false], [true, true]]);
	const failed = commitReviewActions({
		mode: "action",
		commitLabel: "Pay",
		busy: false,
		failed: true,
	});
	assertEquals(failed[1].label, "Try again");
});

Deno.test("a hand-off commit is an anchor in the amber pill's classes", () => {
	const [, link] = commitReviewActions({
		mode: "link",
		commitLabel: "Top up the wallet",
		busy: false,
		failed: true,
	});
	assertEquals([link.element, link.label, link.loading], ["link", "Top up the wallet", false]);
	assertEquals(
		commitLinkClass(link),
		"ui-button ui-button--accent ui-button--filled ui-button--size-md ui-button--rounded ui-commit-review__link",
	);
});

Deno.test("the commit says its amount as a figure, and drops it when it reads Try again", () => {
	const input = {
		mode: "action" as const,
		commitLabel: "Pay",
		commitFigure: "US$640.00",
		busy: false,
	};
	const [cancel, commit] = commitReviewActions({ ...input, failed: false });
	assertEquals([cancel.figure, commit.label, commit.figure], [null, "Pay", "US$640.00"]);
	assertEquals(commitReviewActions({ ...input, failed: true })[1].figure, null);
	assertEquals(
		renderToString(<CommitLabel label={commit.label} figure={commit.figure} />),
		'Pay <span class="ui-commit-review__commit-figure">US$640.00</span>',
	);
	assertEquals(renderToString(<CommitLabel label="Try again" figure={null} />), "Try again");
	const figure = rule(".ui-commit-review__commit-figure");
	for (const decl of ["tabular-nums", "direction: ltr", "unicode-bidi: isolate"]) {
		assert(figure.includes(decl), decl);
	}
});

Deno.test("an alertdialog that opens on Cancel and cannot be dismissed while committing", () => {
	assertEquals(commitReviewDialog(false), {
		role: "alertdialog",
		closable: true,
		closeOnEscape: true,
		dismissableMask: true,
		initialFocus: "actions",
	});
	const sending = commitReviewDialog(true);
	assertEquals(
		[sending.role, sending.closable, sending.closeOnEscape, sending.dismissableMask],
		["alertdialog", false, false, false],
	);
	// Focus opens on the action group, whose first control is the text Cancel — never the commit.
	const [first] = commitReviewActions({
		mode: "action",
		commitLabel: "Pay",
		busy: false,
		failed: false,
	});
	assertEquals([first.role, first.variant, first.severity], ["cancel", "text", "primary"]);
});

Deno.test("with nothing to commit, the review offers only a way out — no fill at all", () => {
	const actions = commitReviewActions({
		mode: "none",
		commitLabel: "Pay",
		busy: false,
		failed: false,
	});
	assertEquals(actions.map((a) => [a.role, a.label, a.variant]), [["close", "Close", "text"]]);
});

Deno.test("a refusal hands focus back to Try again, or to the lone Close when nothing is left", () => {
	const retry = commitReviewActions({
		mode: "action",
		commitLabel: "Pay",
		busy: false,
		failed: true,
	});
	assertEquals(retry[commitReviewRefocusIndex(retry)].label, "Try again");
	const handOff = commitReviewActions({
		mode: "link",
		commitLabel: "Top up the wallet",
		busy: false,
		failed: true,
	});
	assertEquals(handOff[commitReviewRefocusIndex(handOff)].role, "commit");
	const final = commitReviewActions({
		mode: "none",
		commitLabel: "Pay",
		busy: false,
		failed: true,
	});
	assertEquals(final[commitReviewRefocusIndex(final)].label, "Close");
});
// #endregion

// #region Stylesheet
Deno.test("the figure leads on size and weight, set tabular and centred", () => {
	const total = rule(".ui-commit-review__total");
	for (
		const decl of ["var(--text-2xl)", "var(--fw-medium)", "tabular-nums", "text-align: center"]
	) {
		assert(total.includes(decl), decl);
	}
});

Deno.test("every money figure is isolated left-to-right, as a hand-built figure must be", () => {
	for (const selector of [".ui-commit-review__total", ".ui-commit-review__figure"]) {
		const decls = rule(selector);
		assert(decls.includes("direction: ltr"), `${selector} direction`);
		assert(decls.includes("unicode-bidi: isolate"), `${selector} isolation`);
	}
});

Deno.test("facts are separated by one hairline, never boxed", () => {
	assert(rule(".ui-commit-review__row").includes("border-block-end: var(--hairline)"));
	assert(rule(".ui-commit-review__row:last-child").includes("border-block-end: 0"));
	assert(rule(".ui-commit-review__value--tabular").includes("tabular-nums"));
	assertFalse(/(^|[^-])border:/.test(css), "a four-sided border");
	assertFalse(/background/.test(css), "a fill");
});

Deno.test("token-only: no literal colour, radius, duration or weight", () => {
	assertFalse(/#[0-9a-f]{3,8}\b/i.test(css), "hex");
	assertFalse(/rgba?\(/.test(css), "rgb");
	assertFalse(/\d+m?s\b/.test(css), "duration");
	assertFalse(/font-weight:\s*\d/.test(css), "weight");
	assertFalse(
		/\b(left|right|top|bottom|margin-left|margin-right|padding-left|padding-right):/.test(css),
	);
});
// #endregion
