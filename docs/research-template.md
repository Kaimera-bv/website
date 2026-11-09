<!--
How to add a research write-up to kaimera.dev

1. Copy this file to src/content/research/<slug>.md. The file name becomes the URL: /research/<slug>.
2. Put the figure in public/research/<slug>/ and point figure.src at it.
   Use the dark site theme (background #121824) and leave the headline out of the image: the page shows it.
3. Fill in every frontmatter field. The build fails if one is missing or has the wrong type
   (schema: src/content.config.ts).
4. Keep draft: true until it is ready. Drafts are left out of the build.

Rules of thumb
- One study, one question, one finding. If there are two findings, write two studies.
- The finding is a sentence a terminal manager can repeat, with no jargon.
- Say what the model leaves out. limitations must list at least one item.
- Numbers in the text must come from the result files of the study, not from memory.
-->
---
title: "A question a reader would ask, or the answer to it"
finding: "One sentence: what the study found."
summary: "One or two sentences for the card and search results: what was tested and the headline result."
date: 2026-01-01
topic: "Terminal simulation"
tags: ["Tag", "Tag"]
keyNumbers:
  - value: "+0%"
    label: "What this number means, in a few words"
  - value: "14 → 27"
    label: "What this number means"
figure:
  src: "/research/<slug>/figure.png"
  alt: "What the chart shows, written for someone who cannot see it: the axes, the lines, the main values."
  caption: "What is plotted, the units, how many runs. Anything a reader needs to read the chart correctly."
setup:
  - label: "Model"
    value: "Which model, what it simulates"
  - label: "Scenarios"
    value: "What was varied, and over which values"
  - label: "Runs"
    value: "How many runs per case, and what differs between them"
limitations:
  - "What the model does not include, and which way that biases the result."
draft: true
---

## The question

What was tested and why it matters in operations. Name the alternatives that were compared.

## What we found

The result first, in bold, then the numbers. A small table is fine.

## Why it happens

The mechanism behind the result, checked against the model code.

## What it means for your operation

Two or three practical points.

## Next

The question this study raises, and what will be tested next.
