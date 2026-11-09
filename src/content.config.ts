import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

// Research write-ups. One Markdown file per study in src/content/research/.
// The frontmatter holds everything the page lays out the same way for every study
// (finding, key numbers, figure, setup, limits); the Markdown body holds the story.
// Start a new study from docs/research-template.md.
const research = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/research" }),
  schema: z.object({
    title: z.string(),
    /** The one-sentence result. Shown under the title and on the card. */
    finding: z.string(),
    /** One or two sentences for the card and the meta description. */
    summary: z.string(),
    date: z.coerce.date(),
    /** Short label above the title, e.g. "Terminal simulation". */
    topic: z.string(),
    tags: z.array(z.string()).default([]),
    /** Up to four headline numbers, shown as tiles. */
    keyNumbers: z.array(z.object({ value: z.string(), label: z.string() })).max(4).default([]),
    figure: z.object({
      /** Path under public/, e.g. /research/<slug>/figure.png */
      src: z.string(),
      alt: z.string(),
      caption: z.string(),
    }),
    /** The facts a reader needs to judge the result: model, scenarios, runs. */
    setup: z.array(z.object({ label: z.string(), value: z.string() })),
    /** What the result does not cover. Always filled in. */
    limitations: z.array(z.string()).min(1),
    draft: z.boolean().default(false),
  }),
});

export const collections = { research };
