import { EmptyState } from "@projective/ui/utils";
import { Icon } from "@projective/ui/icons";
import "../styles/portfolio.css";

/**
 * PortfolioStyleAnchor — carries the `/projects` portfolio index's stylesheet onto the page.
 *
 * The portfolio is a SERVER component, and a stylesheet imported by a server component alone reaches
 * no page: feature CSS ships only inside an island's bundle. This island exists to be that bundle — it
 * imports `portfolio.css` and renders the two `@projective/ui` atoms the page uses (hidden), so their
 * sheets ride along too. It hydrates to nothing.
 */
export default function PortfolioStyleAnchor() {
	return (
		<div hidden aria-hidden="true">
			<EmptyState title="" />
			<Icon name="projects" />
		</div>
	);
}
