// Central site metadata + content model.

export const SITE = {
  name: "Kaimera",
  role: "Freelance Data Scientist & Systems Engineer",
  tagline:
    "Whatever it takes to bring legacy into the age of AI — real-time digital twins, ML on operational data, and integration layers for legacy systems.",
  domain: "kaimera.dev",
  email: "kenneth@kaimera.dev",

  // The big hero headline. Split into three parts so the middle can be
  // colour-highlighted. Edit these and the visible hero updates.
  hero: {
    titleLead: "Making operations that run on instinct,",
    titleHighlight: "run on data",
    titleTail: "instead.",
    // The paragraph under the headline uses SITE.tagline (above).
  },
};

export type DemoStatus = "live-demo" | "in-progress" | "planned";

export interface Project {
  slug: string;
  title: string;
  kicker: string;
  summary: string;
  /** One-liner used on cards. */
  blurb: string;
  status: DemoStatus;
  accent: "amber" | "data";
  stack: string[];
  /** Whether an interactive demo page is wired up yet. */
  demoReady: boolean;
}

export const PROJECTS: Project[] = [
  {
    slug: "digital-twin",
    title: "Terminal Digital Twin",
    kicker: "Real-time 3D visualisation",
    summary:
      "An interactive, browser-based 3D twin of a container terminal — yard, vessels, cranes and straddle carriers rendered in geographic space.",
    blurb:
      "Explore a live-feeling 3D container terminal: click any vessel or box.",
    status: "live-demo",
    accent: "data",
    stack: ["deck.gl", "WebGL", "Python", "Geospatial"],
    demoReady: false,
  },
  {
    slug: "integration-layer",
    title: "Legacy Integration Layer",
    kicker: "Systems integration",
    summary:
      "A modern REST API that fronts a decades-old mainframe operating system with no API of its own — turning manual terminal data-entry into a programmatic call that completes in under a second.",
    blurb:
      "Submit a move and watch it travel through a simulated mainframe message-queue round-trip, byte by byte.",
    status: "live-demo",
    accent: "amber",
    stack: ["FastAPI", "Message Queues", "JWT", "Mainframe"],
    demoReady: true,
  },
];

export const NAV = [
  { href: "/", label: "Home" },
  { href: "/#demos", label: "Demos" },
  { href: "/#about", label: "About" },
  { href: "/#contact", label: "Contact" },
];
