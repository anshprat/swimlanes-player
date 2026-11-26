# swimlanes-player

Plays a [swimlanes.io](https://swimlanes.io) sequence diagram one message at a time. Each step draws
one arrow, and a card on top of each lane shows what that lane holds after the step. No
dependencies, no build needed to use it, and it works offline.

Live: https://anshprat.github.io/swimlanes-player/

`https://anshprat.github.io/swimlanes-player/#<payload>` opens a swimlanes.io link's diagram directly:
use the part of the swimlanes.io link after `#` as the payload.

## Use it

1. Open `dist/swimlanes-player.html` in a browser.
2. Paste swimlanes.io text, or a swimlanes.io link (`https://swimlanes.io/#…`, or only the part after `#`),
   into the editor on the left. A link is unpacked into text that you can edit. As on swimlanes.io, the
   editor and the player sit side by side; drag the divider to resize them, or hide the editor.
3. Press **Next**, **Play**, or the → key.

Click a row or its number to jump to that step. As on swimlanes.io, the editor and the player mark the same
line: move the caret in the editor to mark that line's row in the player, or click a row (or step to it) to
mark its line in the editor. **Full screen** (or the F key) gives the player the
whole screen; where a page may not use the browser's full screen (some embeds, phones), the player covers
the window instead. Esc leaves either.

**Theme** switches between Auto (your system setting), Light and Dark, and is remembered.

Edits redraw the player while you type. **Open in swimlanes.io** and **Copy swimlanes.io link** turn
the current text back into a swimlanes.io link, so you can edit in either place.

To open a diagram straight from a link, add its payload to the file's address:
`dist/swimlanes-player.html#vVNNb4JA…`.

## Player lines

swimlanes.io ignores `//` lines, so these annotations keep the diagram valid there:

| Line | Effect |
|---|---|
| `// explain: text` | Explains the message above it, in the step card |
| `// state Lane: text` | Sets what `Lane` holds after the message above it, in the lane card |
| `// phase: name` | Starts a phase with the next message; phases become jump buttons |

Dividers (`_:`, `-:`, `--:`, `=:`) also become phase buttons. A `// explain:` above the first message
is the intro text. Without `// state` lines, each lane card shows the last message that touched it.

```text
title: Release flow
autonumber
// phase: Release
Dev -> Main: PR merges
// explain: A pull request merges into Main.
// state Main: v1.2.0
Main -> QA: Promote v1.2.0
// state QA: v1.2.0
QA -->> Prod: Approved
```

## Supported swimlanes.io syntax

The parser follows the parser in swimlanes.io's public web client: the same patterns, tested in the
same order, with the same rules for lanes, `order:`, notes and errors. A diagram therefore plays with
the lanes and steps that swimlanes.io draws.

- Messages: `A -> B: text`. The `:` is required. Lines `-` (solid), `--` (dashed), `=` (bold); heads
  `>` and `<` (closed), `>>` and `<<` (open), `x` (lost), on either end (`B <- A`, `A <-> B`);
  `A -> A` to self; `A -><  B: text` adds an automatic reply from B to A
- Notes: `note: text`, `note A: text`, `note A, B: text`, and `todo:` for a to-do note. The lines below
  a note continue it until the next element. A note without lanes spans the element above it; a note on
  an unknown lane spans every lane
- Dividers `_:` `-:` `--:` `=:`, delay `...: text`, sections `if:` or `group:`, then `else:` and `end`
- `title:` (the first one counts), `name:`, `alias A: Shown name`, comments `//` and `#`
- `autonumber` (anywhere in the diagram) writes `[n] ` before each message's label, as swimlanes.io does.
  The step badges show the step numbers with or without it
- `order: A, B`: `A` and `B` become the first lanes, in that order; the others follow in the order they
  first appear. Only the first valid `order:` line counts
- Lane names ignore case and keep their first spelling: `PROD` and `Prod` are one lane, shown as
  whichever comes first
- Inline `**bold**`, `_italic_` or `*italic*`, `~~strike~~`, `` `code` ``, `[links](https://…)`
- Font Awesome icons: `{fas-user}` (solid), `{far-bell}` (regular), `{fab-github}` (brands), `{fa-user}`,
  with `fa-xs`, `fa-sm`, `fa-lg`, `fa-xl`, `fa-2x` (larger sizes draw at 2x) and `fa-fw`. They work in the
  title, lane names and aliases, messages, notes, dividers and sections, as on swimlanes.io

### Icons

swimlanes.io draws icons with Font Awesome Pro 5. The player uses Font Awesome Free 6.7.2, which keeps the
version 5 names. It loads the stylesheet from cdnjs only when a diagram has an icon; offline, the player
leaves the icons out and says so under the editor.

- Free has no light (`fal`) or duotone (`fad`) icons: light draws as regular, duotone as solid.
- A regular icon that Free has only as solid (for example `{far-hippo}`) draws as solid.
- A Pro-only icon (for example `{fas-duck}`) draws as a muted question mark, with a warning under the editor.
- Inside a code block in a note, `{fa…}` stays text, as on swimlanes.io.

A line that swimlanes.io would show as an error is listed under the editor, with its line number.

## Embed the player

```html
<link rel="stylesheet" href="swimlanes-player.css">
<script src="swimlanes-player.js"></script>
<div id="player"></div>
<script>
  const player = SwimlanesPlayer.mount(document.getElementById("player"));
  SwimlanesPlayer.decode(location.hash).then(text => player.load(text));
</script>
```

API (global `SwimlanesPlayer`):

| Call | Returns |
|---|---|
| `decode(input)` | `Promise<string>`: diagram text from a swimlanes.io URL, `#hash` or payload; plain text passes through |
| `encode(text)` / `toUrl(text)` | `Promise<string>`: the payload / the full `https://swimlanes.io/#…` URL |
| `isLink(input)` | `true` when `input` is a link or payload |
| `parse(text)` | The model: `title`, `lanes`, `rows` (each with its `srcLine`), `rowByLine`, `states`, `icons`, `total`, `warnings` |
| `mount(element, { ghost, speed, colorBy, fill, icons })` (`fill: true` makes the player fill its container's height; `icons` is the Font Awesome stylesheet URL, or `false` to load none) | A player: `load(text, keepStep)`, `go(n)`, `select(line)`, `play()`, `pause()`, `fullscreen(on)`, `on("step" \| "load" \| "select" \| "icons" \| "fullscreen", fn)`, `model`, `step` |
| `iconHtml(text)` | HTML of `text` with its `{fa-…}` icons drawn and the rest escaped (for a title outside the player) |

`select(line)` marks the row that owns a source line (0-based), as an editor's caret does. The `"select"`
event gives the source line of the row that a click or a step marked, or `null`. The `"icons"` event fires
when a diagram's icons have loaded, so a page can redraw a title or warnings it drew from the model.

A swimlanes.io link is the diagram text, compressed with raw DEFLATE and encoded as base64.
The player uses the browser's `DecompressionStream("deflate-raw")` and `CompressionStream("deflate-raw")`.

## Build

```sh
node build.mjs
```

It writes `dist/swimlanes-player.html`, one self-contained page with `swimlanes-player.css` and
`swimlanes-player.js` inlined. `src/shell.html` is the page around the player. The built file is
committed, so the page works straight from a clone.

## Credits

The diagram syntax and the link format are [swimlanes.io](https://swimlanes.io)'s. This project is not
affiliated with swimlanes.io; it reads and writes swimlanes.io links so that you can move a diagram
between the two.
