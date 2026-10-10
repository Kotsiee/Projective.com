const PRINT_ROOT_ID = "ins-print-root";
const PRINT_CLASS = "ins-docx-print";

/**
 * Prints the rendered Word pages through the inspector's shared print root: while printing, a
 * `#ins-print-root` element on `<body>` holds clones of the pages and print CSS shows only it;
 * afterwards the clones (and the root, when this printer created it) are removed.
 *
 * Covers both the Print action and the browser's own print command (`beforeprint`), so a menu print
 * never comes out blank.
 */
export class DocxPrinter {
	#release: (() => void) | null = null;

	constructor(private readonly pages: HTMLElement) {}

	/** Listen for the browser's own print command. Returns the detach function. */
	attach(): () => void {
		const before = () => void this.#stage();
		const after = () => this.#clear();
		globalThis.addEventListener("beforeprint", before);
		globalThis.addEventListener("afterprint", after);
		return () => {
			globalThis.removeEventListener("beforeprint", before);
			globalThis.removeEventListener("afterprint", after);
			this.#clear();
		};
	}

	/** Stage the pages, let their images decode, then open the print dialog. Resolves whether it did. */
	async print(): Promise<boolean> {
		const images = this.#stage();
		if (images === null) return false;
		await Promise.allSettled(images.map((img) => img.decode()));
		if (!this.#release) return false;
		globalThis.print();
		return true;
	}

	#stage(): HTMLImageElement[] | null {
		if (this.#release) return [];
		const pages = Array.from(this.pages.querySelectorAll<HTMLElement>(".docx-wrapper > section"));
		if (pages.length === 0) return null;
		const doc = this.pages.ownerDocument;
		let root = doc.getElementById(PRINT_ROOT_ID);
		const created = root === null;
		if (!root) {
			root = doc.createElement("div");
			root.id = PRINT_ROOT_ID;
			doc.body.append(root);
		}
		const holder = doc.createElement("div");
		holder.className = PRINT_CLASS;
		for (const page of pages) {
			const clone = page.cloneNode(true);
			if (!(clone instanceof HTMLElement)) continue;
			for (const withId of Array.from(clone.querySelectorAll("[id]"))) withId.removeAttribute("id");
			holder.append(clone);
		}
		root.append(holder);
		const host = root;
		this.#release = () => {
			holder.remove();
			if (created && host.childElementCount === 0) host.remove();
		};
		return Array.from(holder.querySelectorAll("img"));
	}

	#clear(): void {
		this.#release?.();
		this.#release = null;
	}
}
