import type { JSX } from "preact";
import { Avatar, Carousel } from "@projective/ui/display";
import "../styles/profile.css";
import { profileHref } from "@features/explore/core/routing.ts";
import { ProfileIcon } from "../components/profile-glyphs.tsx";
import type { NotableClient } from "../types/profile-types.ts";

/**
 * WorkedWithCarousel — the "Worked with" trust strip (root CLAUDE.md — Part 2.3), rendered through the
 * reusable {@link Carousel} (`@projective/ui/display`) so the notable-client mini-cards become a
 * responsive, drag-swipeable, looping track instead of a wrapping row. Shows several logo-led cards at
 * once (fewer per breakpoint), with Previous/Next controls, pagination dots, and pointer-drag — the
 * library owns all the interaction; this island only maps `notableClients` to their card template.
 */
export interface WorkedWithCarouselProps {
	clients: NotableClient[];
}

function ClientCard(client: NotableClient): JSX.Element {
	const inner = (
		<>
			<Avatar
				image={client.logo}
				label={client.name}
				size={56}
				shape="square"
				class="pf-clientcard__logo"
			/>
			<span class="pf-clientcard__name">
				{client.name}
				{client.verified ? <ProfileIcon name="verified" class="pf-clientcard__check" /> : null}
			</span>
		</>
	);
	return client.handle
		? <a class="pf-clientcard__link" href={profileHref(client.handle)}>{inner}</a>
		: <span class="pf-clientcard__link pf-clientcard__link--static">{inner}</span>;
}

export default function WorkedWithCarousel({ clients }: WorkedWithCarouselProps): JSX.Element {
	return (
		<Carousel
			class="pf-clients-carousel"
			aria-label="Notable clients worked with"
			value={clients}
			itemTemplate={(client) => (
				<div class="pf-clientcard pf-clientcard--slide">{ClientCard(client)}</div>
			)}
			numVisible={4}
			numScroll={1}
			circular={clients.length > 4}
			responsiveOptions={[
				{ breakpoint: "1200px", numVisible: 3, numScroll: 1 },
				{ breakpoint: "820px", numVisible: 2, numScroll: 1 },
				{ breakpoint: "520px", numVisible: 1, numScroll: 1 },
			]}
		/>
	);
}
