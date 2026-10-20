/// <reference lib="dom" />
import "@ui/kanban/styles/kanban.css";
import "@ui/display/styles/money-view.css";
import "@ui/display/styles/tag.css";
import "../styles/lp-theatre.css";
import "../styles/lp-money-flow.css";
import type { JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { activeStepAt, FLOW_LINE, flowRootMargin } from "../core/money-flow-scroll.ts";

// #region Component
/**
 * MoneyFlow — "How it works"'s small client half (`flows/LANDING.md` §4.3; Decision #288 (F)). It
 * renders nothing visible and never re-renders the server's stage: it finds the section it sits in
 * and, as the visitor scrolls, tells the sticky window which step the reading line has reached
 * (`data-step`) and marks that step's text `data-active`; `data-mf-driven` says it is doing so,
 * and only then does the stylesheet link the window's fills to the scroll. The page scrolls
 * natively; one IntersectionObserver reports each step crossing the line
 * (`core/money-flow-scroll.ts`), and nothing runs while no step crosses it.
 *
 * The stylesheet does the rest: below `--bp-md`, or without scripting, the window is not shown and
 * each step's own still reads in place; under either reduced-motion channel its changes are
 * instant and nothing is scroll-linked. So the island needs no motion gate of its own.
 *
 * It also carries the section's stylesheets — its own, the theatre's card face, and the package
 * sheets its kanban, MoneyView and Tag need: a stylesheet imported by a server component never
 * reaches the page.
 */
export default function MoneyFlow(): JSX.Element {
	const anchor = useRef<HTMLSpanElement>(null);

	useEffect(() => {
		const root = anchor.current?.closest<HTMLElement>(".lp-mf");
		const stage = root?.querySelector<HTMLElement>(".lp-mf__window--live");
		const steps = root ? Array.from(root.querySelectorAll<HTMLElement>(".lp-mf__step")) : [];
		if (!stage || steps.length === 0 || typeof IntersectionObserver !== "function") return;

		let current = -1;
		const show = (index: number) => {
			if (index === current) return;
			current = index;
			stage.dataset.step = String(index + 1);
			steps.forEach((step, at) => step.toggleAttribute("data-active", at === index));
		};
		const update = () => {
			const tops = steps.map((step) => step.getBoundingClientRect().top);
			show(activeStepAt(tops, globalThis.innerHeight * FLOW_LINE));
		};

		const observer = new IntersectionObserver(update, { rootMargin: flowRootMargin() });
		for (const step of steps) observer.observe(step);
		update();
		stage.toggleAttribute("data-mf-driven", true);
		return () => {
			observer.disconnect();
			stage.toggleAttribute("data-mf-driven", false);
		};
	}, []);

	return <span ref={anchor} class="lp-mf__anchor" hidden />;
}
// #endregion
