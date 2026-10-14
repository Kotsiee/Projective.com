import { assertEquals } from "@std/assert";
import { matchSkillLabels } from "./skill-match.ts";

const TAXONOMY = ["Brand identity", "Design systems", "Figma", "Motion design", "UX", "Web design"];

Deno.test("matchSkillLabels ranks a prefix over a word start over a substring", () => {
	assertEquals(matchSkillLabels(TAXONOMY, "des"), [
		"Design systems",
		"Motion design",
		"Web design",
	]);
	assertEquals(matchSkillLabels(TAXONOMY, "ign"), [
		"Design systems",
		"Motion design",
		"Web design",
	]);
	assertEquals(matchSkillLabels(TAXONOMY, "ident"), ["Brand identity"]);
});

Deno.test("matchSkillLabels ignores case and surrounding space", () => {
	assertEquals(matchSkillLabels(TAXONOMY, "  FIG "), ["Figma"]);
});

Deno.test("matchSkillLabels offers nothing for an empty query and caps the answer", () => {
	assertEquals(matchSkillLabels(TAXONOMY, "   "), []);
	assertEquals(matchSkillLabels(TAXONOMY, "e", 2).length, 2);
});
