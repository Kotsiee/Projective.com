import "../styles/scope-select.css";
import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import { cx } from "@ui/core/cx.ts";
import { Icon } from "@projective/ui/icons";
import { useDismiss, useEdgeDetection, useOverlayStack } from "@projective/ui/hooks";
import { BodyPortal } from "@projective/ui/overlay";
import {
	SEARCH_SCOPES,
	type SearchScope,
	searchScopeLabel,
} from "@features/marketing/core/landing-data.ts";

/**
 * ScopeSelect — the ghost search-scope dropdown a discovery bar fuses to its field (the results
 * header, the signed-in shell search): a trigger naming the scope over a body-portalled listbox of the
 * shared `SEARCH_SCOPES`. Arrow Down on the trigger opens it and focuses the first option; the options
 * take Up/Down/Home/End and Enter/Space. A pick hands focus to the host form's text field. The host
 * owns what a pick does and places it with `class`.
 */
export function ScopeSelect(
	{ value, onPick, class: className }: {
		value: SearchScope;
		onPick: (value: SearchScope) => void;
		class?: string;
	},
): JSX.Element {
	const menuOpen = useSignal(false);
	const optionRefs = useRef<Array<HTMLLIElement | null>>([]);

	// Outside press and Escape through the shared overlay stack, which also sets its z-index.
	const stack = useOverlayStack({ active: menuOpen.value });
	// Portalled and anchored, so no sticky or glass ancestor can clip the list or re-base it (§B.10.4).
	const menu = useEdgeDetection<HTMLButtonElement, HTMLUListElement>({
		open: menuOpen.value,
		offset: 8,
		zIndex: stack.zIndex,
	});
	useDismiss({
		open: menuOpen.value,
		enabled: stack.isTop,
		onDismiss: () => (menuOpen.value = false),
		panelRef: menu.ref,
		triggerRef: menu.triggerRef,
	});

	const pick = (next: SearchScope) => {
		menuOpen.value = false;
		onPick(next);
		// Straight on to typing: the host bar's field takes focus (and the bar its in-use state).
		menu.triggerRef.current?.closest("form")?.querySelector<HTMLInputElement>("input")?.focus();
	};
	const focusOption = (index: number) => {
		const n = SEARCH_SCOPES.length;
		optionRefs.current[((index % n) + n) % n]?.focus();
	};
	const onOptionKey =
		(index: number, next: SearchScope) => (e: JSX.TargetedKeyboardEvent<HTMLLIElement>) => {
			switch (e.key) {
				case "Enter":
				case " ":
					e.preventDefault();
					pick(next);
					break;
				case "ArrowDown":
					e.preventDefault();
					focusOption(index + 1);
					break;
				case "ArrowUp":
					e.preventDefault();
					focusOption(index - 1);
					break;
				case "Home":
					e.preventDefault();
					focusOption(0);
					break;
				case "End":
					e.preventDefault();
					focusOption(SEARCH_SCOPES.length - 1);
					break;
			}
		};

	return (
		<div class={cx("ex-scope", className)}>
			<button
				ref={menu.triggerRef}
				type="button"
				class="ex-scope__btn"
				aria-haspopup="listbox"
				aria-expanded={menuOpen.value}
				aria-label={`Search scope: ${searchScopeLabel(value)}`}
				onClick={() => (menuOpen.value = !menuOpen.value)}
				onKeyDown={(e) => {
					if (e.key === "ArrowDown") {
						e.preventDefault();
						menuOpen.value = true;
						requestAnimationFrame(() => focusOption(0));
					}
				}}
			>
				{searchScopeLabel(value)}
				<Icon name="chevron-down" size="2xs" class="ex-scope__caret" />
			</button>
			{menuOpen.value && (
				<BodyPortal>
					<ul
						ref={menu.ref}
						class="ui-anchored ui-menu-surface ex-scope__menu"
						role="listbox"
						aria-label="Search scope"
						style={menu.style}
					>
						{SEARCH_SCOPES.map((opt, i) => (
							<li
								key={opt.value}
								ref={(el) => {
									optionRefs.current[i] = el;
								}}
								role="option"
								aria-selected={value === opt.value}
								class="ui-menu-item ex-scope__option"
								tabIndex={0}
								onClick={() => pick(opt.value)}
								onKeyDown={onOptionKey(i, opt.value)}
							>
								{opt.label}
							</li>
						))}
					</ul>
				</BodyPortal>
			)}
		</div>
	);
}
