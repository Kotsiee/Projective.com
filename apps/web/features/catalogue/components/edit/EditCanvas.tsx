import type { ComponentType, JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { useSignalEffect } from "@preact/signals";
import "../../styles/edit-sections.css";
import {
	type EditSection,
	formArchetypeOf,
	type ListingDetail,
	sectionsFor,
} from "../../types/catalogue-types.ts";
import { laneOutline } from "../../core/lane-outline.ts";
import { activeSectionOf, SECTION_LABELS } from "../../core/workspace-model.ts";
import { setWorkspaceUrl, workspaceUrl } from "../../core/workspace-store.ts";
import { revealSection, sectionDomId } from "./EditSectionFrame.tsx";
import { MediaShowcaseSection } from "./MediaShowcaseSection.tsx";
import { BasicsSection } from "./BasicsSection.tsx";
import { OfferSection } from "./OfferSection.tsx";
import { PricingSection } from "./PricingSection.tsx";
import { AvailabilitySection } from "./AvailabilitySection.tsx";
import { IntakeSection } from "./IntakeSection.tsx";
import { SeoSection } from "./SeoSection.tsx";

/** What every Edit section is rendered with. */
export interface EditSectionProps {
	listing: ListingDetail;
	/** The seller is a restricted (13–17) account (Decision #208). */
	restricted: boolean;
}

/** The Edit sections this canvas renders, by section. */
const SECTION_VIEWS: Record<EditSection, ComponentType<EditSectionProps>> = {
	media: MediaShowcaseSection,
	basics: BasicsSection,
	offer: OfferSection,
	pricing: PricingSection,
	availability: AvailabilitySection,
	questions: IntakeSection,
	seo: SeoSection,
};

/**
 * The reading line, as a share of the viewport's height: a section is read once its top passes it.
 */
const READING_LINE = 0.3;

/** Visibility steps that wake the scroll-spy often enough to follow a scroll. */
const SPY_THRESHOLDS = [0, 0.25, 0.5, 0.75, 1];

function sectionInView(sections: readonly EditSection[]): EditSection | null {
	const tops = sections.flatMap((section) => {
		const el = document.getElementById(sectionDomId(section));
		return el ? [{ section, top: el.getBoundingClientRect().top }] : [];
	});
	const scroller = document.scrollingElement ?? document.documentElement;
	const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
	return activeSectionOf(tops, globalThis.innerHeight * READING_LINE, atBottom);
}

function whenLaidOut(run: () => void): () => void {
	let frame = 0;
	const go = () => {
		frame = requestAnimationFrame(run);
	};
	if (document.readyState === "complete") go();
	else globalThis.addEventListener("load", go, { once: true });
	return () => {
		cancelAnimationFrame(frame);
		globalThis.removeEventListener("load", go);
	};
}

/**
 * EditCanvas — the Edit tab: the listing's sections in page order for its form archetype, one
 * column, separated by spacing. A scroll-spy keeps `?section=` (replaced, never pushed) and the
 * lane's "On this page" outline on the section being read; `?section=` on load scrolls to that
 * section and focuses its heading.
 */
export function EditCanvas(
	props: { listing: ListingDetail; restricted: boolean; initialSection?: EditSection },
): JSX.Element {
	const { listing } = props;
	const sections = sectionsFor(
		formArchetypeOf(listing.kind, listing.serviceType),
		listing.serviceType,
	);
	const key = sections.join("|");
	const revealing = useRef(!!props.initialSection && sections.includes(props.initialSection));

	useEffect(() => {
		const initial = props.initialSection;
		if (!initial || !revealing.current) return;
		return whenLaidOut(() => {
			revealSection(initial);
			requestAnimationFrame(() => {
				revealing.current = false;
			});
		});
	}, []);

	useEffect(() => {
		laneOutline.value = {
			sections: sections.map((id) => ({ id, label: SECTION_LABELS[id] })),
			active: workspaceUrl.peek().section ?? sections[0] ?? null,
			onSelect: (id) => {
				revealSection(id);
				setWorkspaceUrl({ section: id }, "replace");
			},
		};
		return () => {
			laneOutline.value = null;
		};
	}, [key]);

	useSignalEffect(() => {
		const active = workspaceUrl.value.section ?? null;
		const outline = laneOutline.peek();
		if (outline && active && outline.active !== active) laneOutline.value = { ...outline, active };
	});

	useEffect(() => {
		const observer = new IntersectionObserver(() => {
			if (revealing.current) return;
			const active = sectionInView(sections);
			if (active && active !== workspaceUrl.peek().section) {
				setWorkspaceUrl({ section: active }, "replace");
			}
		}, { threshold: SPY_THRESHOLDS });
		for (const section of sections) {
			const el = document.getElementById(sectionDomId(section));
			if (el) observer.observe(el);
		}
		return () => observer.disconnect();
	}, [key]);

	return (
		<div class="cat-sec-stack">
			{sections.map((section) => {
				const View = SECTION_VIEWS[section];
				return <View key={section} listing={listing} restricted={props.restricted} />;
			})}
		</div>
	);
}
