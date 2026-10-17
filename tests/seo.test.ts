import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TOOLS } from "../src/site";

const LANGS = [
  "hi",
  "bn",
  "mr",
  "ta",
  "te",
  "es",
  "pt",
  "fr",
  "de",
  "it",
  "nl",
  "pl",
  "tr",
  "id",
  "vi",
];
type Entry = { title: string; description: string; keywords?: string[] };
const catalog = (lang: string) =>
  (
    JSON.parse(
      readFileSync(
        new URL(`../src/i18n/${lang}.json`, import.meta.url),
        "utf8",
      ),
    ) as { tools: Record<string, Entry> }
  ).tools;

describe("search copy", () => {
  const sets: [string, Record<string, Entry>][] = [
    ["en", Object.fromEntries(TOOLS.map((t) => [t.slug, t]))],
    ...LANGS.map((l): [string, Record<string, Entry>] => {
      const translated = catalog(l);
      return [l, Object.fromEntries(TOOLS.map((tool) => [tool.slug, { ...tool, ...translated[tool.slug] }]))];
    }),
  ];
  it.each(sets)(
    "%s: every tool has a search-ready title, description and five search phrases",
    (_, tools) => {
      for (const tool of TOOLS) {
        const entry = tools[tool.slug];
        expect(entry, tool.slug).toBeDefined();
        expect(
          entry.title.endsWith(" | Fizzdoc") && entry.title.length <= 70,
          `${tool.slug}: ${entry.title}`,
        ).toBe(true);
        expect(
          entry.description.length,
          `${tool.slug} description`,
        ).toBeGreaterThanOrEqual(80);
        expect(
          entry.description.length,
          `${tool.slug} description`,
        ).toBeLessThanOrEqual(160);
        expect(entry.keywords?.length, `${tool.slug} keywords`).toBe(5);
        for (const k of entry.keywords!)
          expect(k.trim().length, `${tool.slug}: ${k}`).toBeGreaterThan(3);
      }
    },
  );

  it("says free in every English title and description", () => {
    for (const tool of TOOLS) {
      expect(tool.title, tool.slug).toMatch(/Free/);
      expect(tool.description.toLowerCase(), tool.slug).toContain("free");
    }
  });
});
