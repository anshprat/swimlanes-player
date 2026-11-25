#!/usr/bin/env node
/**
 * Builds dist/swimlanes-player.html, one self-contained HTML file, from src/shell.html and the
 * library. Open it from disk or host it anywhere.
 *
 *   node build.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const read = p => readFileSync(path.join(here, p), "utf8");
const fill = (s, key, val) => s.split(`{{${key}}}`).join(val);
const noScriptEnd = s => s.replace(/<\/(script)/gi, "<\\/$1");

let page = read("src/shell.html");
page = fill(page, "CSS", read("swimlanes-player.css"));
page = fill(page, "JS", noScriptEnd(read("swimlanes-player.js")));

const split = page.indexOf("<main");
const headPart = page.slice(0, split);
const bodyPart = page.slice(split);
const standalone = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${headPart}</head>
<body>
${bodyPart}</body>
</html>
`;

mkdirSync(path.join(here, "dist"), { recursive: true });
writeFileSync(path.join(here, "dist/swimlanes-player.html"), standalone);
console.log(`dist/swimlanes-player.html ${Math.round(standalone.length / 1024)} KB`);
