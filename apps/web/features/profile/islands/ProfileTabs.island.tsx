import type { JSX, RefObject } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { Popover } from "@projective/ui/feedback";
import "../styles/profile.css";
import { arrangeTabs, TAB_LABEL, tabHref } from "../core/profile-model.ts";
import { ProfileIcon, tabIcon } from "../components/profile-glyphs.tsx";
import type { ProfileTab, ProfileView } from "../types/profile-types.ts";

/**
 * ProfileTabs — the entity-driven tab bar (root CLAUDE.md Part 2/3). The tab set + arrangement come from
 * {@link arrangeTabs} on {@link ProfileView.kind}; each tab is a real anchor into its `/[handle]/<tab>`
 * sub-route (URL-driven active state, so deep-links + refresh land right). Underlined-text tabs, NOT
 * boxed pills (§B.4 / §D.4): a 2px `--primary` underline marks the active tab on the shared hairline.
 *
 * It is an island for two overflow behaviours (Part 3):
 *  - **Reviews is pinned last** on the right, always, with its own icon (via `arrangeTabs.trailing`).
 *  - **Wheel → horizontal scroll**: the strip hides its native scrollbar (`overflow-x: auto` +
 *    `scrollbar-width: none`) and a non-passive `wheel` listener translates vertical wheel delta into
 *    `scrollLeft`, so tabs never clip in a narrow viewport.
 *  - **`More ▾` dropdown**: when the kind has more than the overflow threshold of tabs, secondary tabs
 *    collapse into a portal menu while the key tabs (Services · Projects · Portfolio) + Reviews stay
 *    directly visible.
 */
export interface ProfileTabsProps {
	profile: ProfileView;
	active: ProfileTab | null;
}

export default function ProfileTabs({ profile, active }: ProfileTabsProps): JSX.Element {
	const { primary, overflow, trailing } = arrangeTabs(profile.kind);
	const strip = useRef<HTMLElement>(null);
	const menuOpen = useSignal(false);

	// Non-passive wheel → horizontal scroll. Attached imperatively because a JSX `onWheel` handler is
	// registered passive by some engines, which makes `preventDefault()` a no-op (the page would scroll
	// vertically instead). Only intercepts when the strip actually overflows AND the gesture is vertical.
	useEffect(() => {
		const el = strip.current;
		if (!el) return;
		const onWheel = (e: WheelEvent) => {
			if (el.scrollWidth <= el.clientWidth) return;
			if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return; // already a horizontal gesture
			el.scrollLeft += e.deltaY;
			e.preventDefault();
		};
		el.addEventListener("wheel", onWheel, { passive: false });
		return () => el.removeEventListener("wheel", onWheel);
	}, []);

	const overflowActive = active != null && overflow.includes(active);

	function tabLink(tab: ProfileTab): JSX.Element {
		const isActive = active === tab;
		return (
			<li class="pf-tabs__item" key={tab}>
				<a
					class="pf-tab"
					href={tabHref(profile.handle, tab)}
					data-active={isActive ? "true" : undefined}
					aria-current={isActive ? "page" : undefined}
				>
					<span class="pf-tab__icon" aria-hidden="true">{tabIcon(tab)}</span>
					<span class="pf-tab__label">{TAB_LABEL[tab]}</span>
				</a>
			</li>
		);
	}

	return (
		<nav class="pf-tabs" aria-label="Profile sections" ref={strip}>
			<ul class="pf-tabs__list" role="list">
				{primary.map(tabLink)}

				{overflow.length
					? (
						<li class="pf-tabs__item pf-tabs__item--more" key="__more">
							<Popover
								open={menuOpen}
								placement="bottom-start"
								trigger={(api) => (
									<button
										type="button"
										ref={api.ref as RefObject<HTMLButtonElement>}
										class="pf-tab pf-tab--more"
										data-active={overflowActive ? "true" : undefined}
										data-open={api.expanded ? "true" : undefined}
										aria-haspopup="menu"
										aria-expanded={api.expanded}
										aria-controls={api.panelId}
										onClick={api.toggle}
									>
										<span class="pf-tab__label">More</span>
										<ProfileIcon name="chevron" class="pf-tab__more-caret" />
									</button>
								)}
							>
								<div class="pf-tabs__menu" role="menu" aria-label="More sections">
									{overflow.map((tab) => (
										<a
											key={tab}
											role="menuitem"
											class="pf-tabs__menu-item"
											href={tabHref(profile.handle, tab)}
											data-active={active === tab ? "true" : undefined}
											aria-current={active === tab ? "page" : undefined}
											onClick={() => (menuOpen.value = false)}
										>
											<span class="pf-tabs__menu-icon" aria-hidden="true">{tabIcon(tab)}</span>
											<span>{TAB_LABEL[tab]}</span>
										</a>
									))}
								</div>
							</Popover>
						</li>
					)
					: null}

				{trailing.map(tabLink)}
			</ul>
		</nav>
	);
}
