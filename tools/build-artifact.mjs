// Builds the claude.ai artifact version of Mana Compass from index.html.
//
// The artifact publisher wraps the page in its own <head>, so this keeps only the body,
// puts the artifact's <title> first, and drops the site-only block (service worker and
// update toast), which cannot run inside an artifact. Everything else, including the
// account sync and the downloads-capability export, is the same code as the website.
//
// Usage: node tools/build-artifact.mjs      -> build/artifact.html
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const TITLE = "Legend of Mana Compass"; // gallery and tab name on claude.ai (a name, no colon explainer)

let html = readFileSync(join(root, "index.html"), "utf8");
const body = html.indexOf("<body>");
if (body < 0) throw new Error("index.html has no <body>");
html = html.slice(body + "<body>".length);

const start = html.indexOf("<!-- site-only:start"), end = html.indexOf("<!-- site-only:end -->");
if (start < 0 || end < start) throw new Error("site-only markers not found in index.html");
html = html.slice(0, start) + html.slice(end + "<!-- site-only:end -->".length);

html = html.replace(/\s*<\/body><\/html>\s*$/, "\n");
if (/serviceWorker|manifest\.webmanifest/.test(html)) throw new Error("site-only code left in the artifact build");

mkdirSync(join(root, "build"), { recursive: true });
const out = join(root, "build", "artifact.html");
writeFileSync(out, `<title>${TITLE}</title>\n` + html.replace(/^\s+/, ""));
console.log(`build/artifact.html (${(Buffer.byteLength(readFileSync(out)) / 1024).toFixed(1)} KB)`);
