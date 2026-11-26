/**
 * swimlanes-player.js: play a swimlanes.io sequence diagram one message at a time.
 *
 * No dependencies. Works from file:// or any static host.
 *
 *   SwimlanesPlayer.decode(input)  -> Promise<string>  swimlanes.io URL, #hash or base64 payload -> text (plain text passes through)
 *   SwimlanesPlayer.encode(text)   -> Promise<string>  text -> base64 payload for https://swimlanes.io/#<payload>
 *   SwimlanesPlayer.toUrl(text)    -> Promise<string>  text -> full swimlanes.io URL
 *   SwimlanesPlayer.parse(text)                        text -> model (lanes, rows, warnings), parsed as swimlanes.io parses it
 *   SwimlanesPlayer.mount(element, options)            -> player { load(text), go(n), play(), pause(), model, step, on(event, fn) }
 *   SwimlanesPlayer.iconHtml(text)                     text -> HTML with its {fa-…} icons drawn and the rest escaped
 *
 * Icons: {fas-user}, {far-bell fa-lg}, {fab-github} draw Font Awesome Free 6 icons. The player loads its
 * stylesheet from cdnjs only when a diagram has an icon (mount option icons: a stylesheet URL, or false).
 *
 * Extensions: `//` lines are comments on swimlanes.io, so these annotations stay valid diagrams there:
 *   // explain: <text>        explanation of the message above
 *   // state <Lane>: <text>   what <Lane> holds after the message above
 *   // phase: <name>          a named phase that starts with the next message
 */
(function (global) {
  "use strict";

  /* ---------- swimlanes.io links ---------- */

  function extractPayload(input) {
    const s = String(input == null ? "" : input).trim();
    if (!s || /\n/.test(s)) return null;
    const hashAt = s.indexOf("#");
    let p = null;
    if (/swimlanes\.io/i.test(s) && hashAt >= 0) p = s.slice(hashAt + 1);
    else if (s.charAt(0) === "#" && s.length > 24) p = s.slice(1);
    else if (/^[A-Za-z0-9+/_=-]{24,}$/.test(s)) p = s;
    if (!p) return null;
    try { return decodeURIComponent(p); } catch (e) { return p; }
  }

  function b64ToBytes(b64) {
    let s = b64.replace(/-/g, "+").replace(/_/g, "/").replace(/\s/g, "");
    while (s.length % 4) s += "=";
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function bytesToB64(bytes) {
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  async function pipe(bytes, stream) {
    const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
    return new Uint8Array(await res.arrayBuffer());
  }

  function isLink(input) { return extractPayload(input) !== null; }

  async function decode(input) {
    const payload = extractPayload(input);
    if (payload === null) return String(input == null ? "" : input);
    if (typeof DecompressionStream === "undefined") {
      throw new Error("This browser cannot unpack swimlanes.io links. Paste the diagram text instead.");
    }
    let bytes;
    try { bytes = b64ToBytes(payload); } catch (e) {
      throw new Error("The link is not a swimlanes.io diagram link. Copy the whole address, including the part after #.");
    }
    for (const format of ["deflate-raw", "deflate"]) {
      try { return new TextDecoder().decode(await pipe(bytes, new DecompressionStream(format))); } catch (e) { /* try the next format */ }
    }
    throw new Error("The link did not unpack. Copy the whole swimlanes.io address, including the part after #.");
  }

  async function encode(text) {
    if (typeof CompressionStream === "undefined") throw new Error("This browser cannot make swimlanes.io links.");
    const bytes = await pipe(new TextEncoder().encode(String(text)), new CompressionStream("deflate-raw"));
    return bytesToB64(bytes).replace(/=+$/, "");
  }

  async function toUrl(text) { return "https://swimlanes.io/#" + (await encode(text)); }

  /* ---------- Inline formatting (bold, italic, strike, code, links; icons inside any of them) ---------- */

  const INLINE = /(\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;

  function tokens(text) {
    const s = String(text || "");
    const out = [];
    let last = 0, m;
    INLINE.lastIndex = 0;
    while ((m = INLINE.exec(s))) {
      if (m.index > last) out.push(["t", s.slice(last, m.index)]);
      const t = m[0];
      if (t.startsWith("**") || t.startsWith("__")) out.push(["b", t.slice(2, -2)]);
      else if (t.startsWith("~~")) out.push(["s", t.slice(2, -2)]);
      else if (t.startsWith("`")) out.push(["c", t.slice(1, -1)]);
      else if (t.startsWith("[")) { const mm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(t); out.push(["a", mm[1], mm[2]]); }
      else out.push(["i", t.slice(1, -1)]);
      last = m.index + t.length;
    }
    if (last < s.length) out.push(["t", s.slice(last)]);
    return out;
  }

  const esc = t => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  // Text without formatting or icons, for labels, sizes and screen readers.
  const plain = text => unescBrace(tokens(text).map(t => t[1]).join("").replace(FA_ALL, "")).replace(/\s+/g, " ").trim();
  // Visible length in characters: an icon counts as about two characters per em.
  const iconChars = token => "x".repeat(Math.round(2 * parseIcon(token).size));
  const vlen = text => plain(String(text || "").replace(FA_ALL, iconChars)).length;

  function svgText(text) {
    return tokens(text).map(([k, s]) => {
      const e = withIcons(s, iconSvg);
      if (k === "b") return `<tspan font-weight="600">${e}</tspan>`;
      if (k === "i") return `<tspan font-style="italic">${e}</tspan>`;
      if (k === "s") return `<tspan text-decoration="line-through">${e}</tspan>`;
      if (k === "c") return `<tspan class="slp-code">${e}</tspan>`;
      if (k === "a") return `<tspan text-decoration="underline">${e}</tspan>`;
      return e;
    }).join("");
  }

  function htmlText(text) {
    return tokens(text).map(([k, s, href]) => {
      const e = withIcons(s, iconHtmlOf);
      if (k === "b") return `<b>${e}</b>`;
      if (k === "i") return `<i>${e}</i>`;
      if (k === "s") return `<s>${e}</s>`;
      if (k === "c") return `<code>${e}</code>`;
      if (k === "a") return /^https?:\/\//i.test(href) ? `<a href="${esc(href)}" target="_blank" rel="noopener">${e}</a>` : e;
      return e;
    }).join("");
  }

  /* ---------- Font Awesome icons: {fas-user}, {far-bell fa-lg}, as on swimlanes.io ---------- */

  // swimlanes.io turns {fa<style>-<name> <modifiers>} into a Font Awesome Pro 5 icon. The player loads
  // Font Awesome Free 6, which keeps the version 5 names, only when a diagram has an icon. It draws each
  // icon as a glyph of the Font Awesome font, so one icon works in SVG text and in HTML alike.
  const FA_CSS = "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.7.2/css/all.min.css";
  const FA_SRI = "sha512-Evv84Mr4kqVGRNSgIGL/F/aIDqQb7xQ2vcrdIwxfjThSH8CSR7PBEakCr51Ck+w+/U6swU2Im1vVX0SVk9ABhg==";
  const FA_SRC = "\\{fa[bsrld]?-[^}]*\\}";
  const FA_ALL = new RegExp(FA_SRC, "gi");
  const FA_SPLIT = new RegExp(`(${FA_SRC})`, "i");
  const FA_SIZE = { xs: 0.75, sm: 0.875, lg: 1.25, xl: 1.5, "2xl": 2 };
  // Free has solid, regular and brands. Each style tries the closest free styles in turn: light falls
  // back to regular, duotone to solid, and a name that its style lacks to the other styles.
  const FA_TRY = { "": ["fa", "fas", "far", "fab"], s: ["fas", "far", "fab"], r: ["far", "fas", "fab"], l: ["fal", "far", "fas", "fab"], d: ["fad", "fas", "far", "fab"], b: ["fab", "fas", "far"] };
  const FA_MISSING = { style: "r", name: "question-circle", size: 1, fw: false };
  // swimlanes.io draws no icons in a code block of a note: it hides each "{" there, as the player does.
  const FA_ESC = "\u0001";
  const unescBrace = s => String(s).split(FA_ESC).join("{");

  function parseIcon(token) {
    const m = /^\{fa([bsrld]?)-([^}]*)\}$/i.exec(token);
    const words = m[2].trim().toLowerCase().split(/\s+/);
    const icon = { style: m[1].toLowerCase(), name: /^[a-z0-9-]+$/.test(words[0]) ? words[0] : "", size: 1, fw: false };
    words.slice(1).forEach(w => {
      const s = /^fa-(xs|sm|lg|xl|2xl|(\d+)x)$/.exec(w);
      // Rows have a fixed height, so sizes above 2x draw at 2x.
      if (s) icon.size = Math.max(0.75, Math.min(2, s[2] ? Number(s[2]) : FA_SIZE[s[1]]));
      else if (w === "fa-fw") icon.fw = true;
    });
    return icon;
  }

  const faKey = i => i.style + ":" + i.name;
  const faGlyphs = new Map(); // faKey -> { ch, family, weight }, or null when no free style has the icon
  const faJobs = new Map();
  let faSheet = null, faState = ""; // "", then "ready", "failed" (the stylesheet did not load) or "off"
  // The glyphs in each Font Awesome Free 6.7.2 font, read from the fonts' cmap tables: 4 hex digits per
  // code point. The stylesheet names a glyph for every icon in every style, but each font has only some.
  // The solid font has every free icon except brand icons (and a few code points it shares with brands).
  const FA_FONT = {
    regular: "e185e1fef003f004f005f006f007f014f016f017f01af01bf01df022f024f02ef03ef044f045f046f057f058f059f05cf05df067f069f06e" +
      "f070f073f075f07bf07cf080f086f087f088f089f08af094f096f097f09df0a0f0a2f0a4f0a5f0a6f0a7f0c5f0c7f0c8f0e0f0e5f0e6f0ea" +
      "f0ebf0f3f0f6f0f7f0f8f0fef10cf111f114f115f118f119f11af11cf11df123f128f12af133f144f146f147f14af14df14ef150f151f152" +
      "f155f15bf15cf164f165f185f186f18ef190f191f192f196f1adf1c1f1c2f1c3f1c4f1c5f1c6f1c7f1c8f1c9f1cdf1d8f1d9f1dbf1e3f1ea" +
      "f1f6f1f7f1f9f1faf20af247f248f249f24af24df250f252f254f255f256f257f258f259f25af25bf25df271f272f273f274f278f279f27a" +
      "f27bf283f28bf28cf28df28ef292f295f29cf2b4f2b5f2b6f2b7f2b9f2baf2bbf2bcf2bdf2bef2c0f2c1f2c2f2c3f2d0f2d1f2d2f2d4f2dc" +
      "f2edf302f328f358f359f35af35bf3a5f3d1f410f425f43af43ff441f443f445f447f45cf47df4adf4daf4e6f52cf531f536f541f556f567" +
      "f579f57af57ff580f581f582f583f584f585f586f587f588f589f58af58bf58cf596f597f598f599f59af59bf59cf5a4f5a5f5b3f5b4f5b8" +
      "f5c0f5c2f5c8",
    brands: "e007e013e01ae01ee049e052e055e056e057e077e078e079e07ae07be07ce07de07ee07fe080e081e082e083e084e087e088e1fee2d0e340" +
      "e360e3d9e40fe43ae44ae499e49be4a0e530e531e570e5ace5ade5aee5c6e5c7e60be60ce618e619e61ae61be62be62de62ee62fe63be63c" +
      "e63de640e641e65ce663e671e67be67ce682e683e684e693e694e69fe6a2e6a3f067f069f081f082f08cf092f099f09af09bf0d2f0d3f0d4" +
      "f0d5f0e1f113f128f12af136f13bf13cf155f15af166f167f168f169f16af16bf16cf16df16ef170f171f172f173f174f179f17af17bf17c" +
      "f17df17ef180f181f184f189f18af18bf18cf18df194f198f19af19bf19ef1a0f1a1f1a2f1a3f1a4f1a5f1a6f1a7f1a8f1a9f1aaf1b4f1b5" +
      "f1b6f1b7f1bcf1bdf1bef1caf1cbf1ccf1d0f1d1f1d2f1d3f1d4f1d5f1d6f1d7f1e7f1e8f1e9f1edf1eef1f0f1f1f1f2f1f3f1f4f1f5f1fa" +
      "f202f203f208f209f20df20ef210f211f212f213f214f215f216f230f231f232f237f23af23bf23cf23df23ef24bf24cf25ef260f261f263" +
      "f264f265f266f267f268f269f26af26bf26df26ef270f27cf27df27ef280f281f282f284f285f286f287f288f289f28af292f293f294f295" +
      "f296f297f298f299f29bf2a5f2a6f2a9f2aaf2abf2acf2adf2aef2b0f2b1f2b2f2b3f2b4f2b8f2c4f2c5f2c6f2d5f2d6f2d7f2d8f2d9f2da" +
      "f2ddf2def2e0f35cf368f369f36af36bf36cf36df36ef36ff370f371f372f373f374f375f378f379f37af37bf37cf37df37ff380f383f384" +
      "f385f388f38bf38cf38df38ef38ff391f392f393f394f395f396f397f399f39af39df39ef39ff3a1f3a2f3a3f3a4f3a6f3a7f3a8f3a9f3aa" +
      "f3abf3acf3adf3aef3aff3b0f3b1f3b2f3b4f3b5f3b6f3b7f3b8f3b9f3baf3bbf3bcf3bdf3c0f3c3f3c4f3c6f3c7f3c8f3caf3cbf3ccf3d0" +
      "f3d2f3d3f3d4f3d5f3d6f3d7f3d8f3d9f3daf3dbf3dcf3dff3e1f3e2f3e3f3e4f3e6f3e7f3e8f3e9f3eaf3ebf3ecf3eef3eff3f3f3f5f3f6" +
      "f3f7f3f8f3f9f3fef402f403f404f405f407f408f409f40af40bf40cf40df411f412f413f414f415f416f417f419f41af41bf41cf41df41e" +
      "f41ff420f421f423f425f426f427f428f429f42af42bf42cf42df42ef42ff430f431f44df452f457f459f4d5f4e4f4e5f4e6f4e7f4e8f4e9" +
      "f4eaf4ebf4ecf4edf4eef4eff4f0f4f1f4f2f4f3f4f4f4f5f4f6f4f7f4f8f4f9f50af50bf50cf50df50ef50ff510f511f512f513f514f52c" +
      "f531f536f541f592f59ef5a3f5a8f5b2f5b5f5bef5c6f5ccf5cff5f1f5f7f5faf60ff612f63ff642f69df6c9f6caf6ccf6dcf730f731f75d" +
      "f77af77bf785f789f78df790f791f797f798f799f7aff7b0f7b1f7b3f7bbf7bcf7c6f7d3f7d6f7dff7e0f7e1f7e3f834f835f836f837f838" +
      "f839f83af83bf83cf83df83ff840f841f842f89ef8a6f8caf8d2f8e1f8e8",
    shared: "e1fee682f067f069f128f12af155f1faf292f295f2b4f425f4e6f52cf531f536f541",
  };
  const FA_SET = {};
  Object.keys(FA_FONT).forEach(k => { FA_SET[k] = new Set(FA_FONT[k].match(/.{4}/g)); });

  // The glyph that <i class="<cls> fa-<name>"> shows, read from the page's Font Awesome stylesheet.
  function faProbe(cls, name) {
    const el = document.createElement("i");
    el.className = `${cls} fa-${name}`;
    el.style.cssText = "position:absolute;left:-9999px;top:0;visibility:hidden";
    document.body.appendChild(el);
    const content = getComputedStyle(el, "::before").content;
    const cs = getComputedStyle(el);
    const glyph = { family: cs.fontFamily, weight: cs.fontWeight };
    el.remove();
    const m = /^"(.+)"$/.exec(content || "");
    if (!m || !/font ?awesome/i.test(glyph.family)) return null;
    glyph.ch = m[1].replace(/\\([0-9a-f]{1,6}) ?|\\(.)/gi, (_, hex, c) => (hex ? String.fromCodePoint(parseInt(hex, 16)) : c));
    return glyph;
  }

  // Whether the glyph's font has it. Another Font Awesome on the page (Pro, or version 5): trust its stylesheet.
  function faHasGlyph(g) {
    const cp = g.ch.codePointAt(0).toString(16);
    if (/Font Awesome 6 Brands/i.test(g.family)) return FA_SET.brands.has(cp);
    if (!/Font Awesome 6 Free/i.test(g.family)) return true;
    if (Number(g.weight) < 600) return FA_SET.regular.has(cp);
    return !FA_SET.brands.has(cp) || FA_SET.shared.has(cp);
  }

  function faLoadSheet(url) {
    if (faSheet) return faSheet;
    faSheet = new Promise(resolve => {
      if (faProbe("fas", "user")) { resolve("ready"); return; } // the page has Font Awesome already
      if (!url) { resolve("off"); return; }
      const link = document.createElement("link");
      link.rel = "stylesheet";
      if (url === FA_CSS) { link.integrity = FA_SRI; link.crossOrigin = "anonymous"; }
      link.onload = () => resolve("ready");
      link.onerror = () => resolve("failed");
      link.href = url;
      document.head.appendChild(link);
    }).then(state => { faState = state; return state === "ready"; });
    return faSheet;
  }

  async function faFind(icon) {
    for (const cls of FA_TRY[icon.style]) {
      const g = faProbe(cls, icon.name);
      if (!g) continue;
      try { if (document.fonts) await document.fonts.load(`${g.weight} 16px ${g.family}`, g.ch); } catch (e) { continue; }
      if (faHasGlyph(g)) return g;
    }
    return null;
  }

  function faJob(icon) {
    const k = faKey(icon);
    if (!faJobs.has(k)) faJobs.set(k, faFind(icon).catch(() => null).then(g => { faGlyphs.set(k, g); }));
    return faJobs.get(k);
  }

  // True while some icon of the list still needs the stylesheet or a font.
  function faPending(icons) {
    if (!icons.length || faState === "failed" || faState === "off") return false;
    if (faState === "") return true;
    const named = icons.filter(i => i.name);
    return named.some(i => !faGlyphs.has(faKey(i))) || (named.some(i => faGlyphs.get(faKey(i)) === null) && !faGlyphs.has(faKey(FA_MISSING)));
  }

  async function faResolve(icons, url) {
    if (!(await faLoadSheet(url))) return;
    const named = icons.filter(i => i.name);
    await Promise.all(named.map(faJob));
    if (named.some(i => faGlyphs.get(faKey(i)) === null)) await faJob(FA_MISSING);
  }

  // How to draw an icon: its glyph, or a muted question mark when Font Awesome Free has no such icon.
  // Nothing while the font loads, or when it cannot load.
  function faDraw(icon) {
    let g = icon.name ? faGlyphs.get(faKey(icon)) : undefined, missing = false;
    if (g === null) { g = faGlyphs.get(faKey(FA_MISSING)); missing = true; }
    if (!g) return null;
    return { ch: g.ch, missing, style: `font-family:${g.family};font-weight:${g.weight}` + (icon.size !== 1 ? `;font-size:${icon.size}em` : "") };
  }

  function iconSvg(icon) {
    const d = faDraw(icon);
    return d ? `<tspan class="slp-fa${d.missing ? " slp-fa-missing" : ""}" style="${esc(d.style)}">${esc(d.ch)}</tspan>` : "";
  }

  function iconHtmlOf(icon) {
    const d = faDraw(icon);
    if (!d) return "";
    const tip = d.missing ? ` title="${esc(`Font Awesome Free has no “${icon.name}” icon`)}"` : "";
    return `<span class="slp-fa${d.missing ? " slp-fa-missing" : ""}${icon.fw ? " slp-fa-fw" : ""}" style="${esc(d.style)}" aria-hidden="true"${tip}>${esc(d.ch)}</span>`;
  }

  // Escaped text with its {fa-…} icons drawn by draw(icon).
  function withIcons(text, draw) {
    return String(text).split(FA_SPLIT).map((part, i) => (i % 2 ? draw(parseIcon(part)) : esc(unescBrace(part)))).join("");
  }

  // Text as HTML with only its icons drawn, as swimlanes.io draws titles and lane names.
  const iconHtml = text => withIcons(text == null ? "" : text, iconHtmlOf);

  function iconWarnings(model) {
    if (model._iconsChecked || !model.icons.length || faState === "" || faState === "off") return;
    model._iconsChecked = true;
    if (faState === "failed") {
      model.warnings.push("The icons need Font Awesome from cdnjs.cloudflare.com, which did not load, so the player leaves them out.");
      return;
    }
    const seen = new Set();
    model.icons.forEach(({ no, icon }) => {
      const k = no + ":" + icon.name;
      if (!icon.name || seen.has(k) || faGlyphs.get(faKey(icon)) !== null) return;
      seen.add(k);
      model.warnings.push(`Line ${no + 1}: Font Awesome Free has no “${icon.name}” icon (it may be a Pro icon), so the player shows a question mark.`);
    });
  }

  /* ---------- Parser: follows swimlanes.io's web client parser, same patterns, same order ---------- */

  const P = {
    message: /^(([^:<>]|\{.*?\})+?)(<{0,2}| x)(--|-|=)(x\s|>{0,2}|><)((\{.*\}|[^<>:])+?):(.*)/i,
    line: /^(-|--|=|_)\s*:(.*)/,
    note: /^note([^:]*?:|\s|$)(.*)/i,
    todo: /^todo([^:]*?:|\s|$)(.*)/i,
    if: /^(?:if|group)(?:$|\s*:)(.*)/i,
    else: /^else(?:$|\s*:)(.*)/i,
    end: /^end(?:$|\s*:$)/i,
    comment: /^(?:\/\/|#)(.+)*/,
    name: /^name\s*:(.*)/i,
    title: /^title\s*:(.*)/i,
    order: /^order\s*:/i,
    delay: /^(\.\.\.)\s*:(.*)/,
    alias: /^alias (.*): (.*)/i,
    autonumber: /^autonumber$/i,
  };
  const DIVIDER = { "_": "thin", "-": "regular", "--": "dashed", "=": "bold" };
  const HEAD = a => (a === "closed" ? ">" : a === "open" ? ">>" : a === "dropped" ? "x" : "");
  const arrowOf = s => (!s ? null : s.trim().toLowerCase() === "x" ? "dropped" : s === "><" ? "closed" : s.length === 1 ? "closed" : "open");

  // swimlanes.io's elements, in source order.
  function scan(text) {
    const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
    const els = [], icons = [];
    let note = null, openIfs = 0, name = "", autonumber = false;
    const closeNote = () => { if (note) { els.push(note); note = null; } };
    const inCodeBlock = () => !!note && (note.text.match(/```/g) || []).length % 2 === 1;
    lines.forEach((raw, no) => {
      const line = raw.trim();
      let m;
      if (!note && line === "") return;
      if (inCodeBlock()) { note.text += "\n" + raw.replace(/\t/g, "  ").replace(/\{/g, FA_ESC); note.end = no; return; }
      if (P.comment.test(line)) { closeNote(); els.push({ type: "comment", text: line, no }); return; }
      (line.match(FA_ALL) || []).forEach(token => icons.push({ no, icon: parseIcon(token) }));
      if (P.order.test(line)) {
        closeNote();
        els.push({ type: "order", lanes: line.split(":")[1].split(",").map(s => s.trim().toLowerCase()), no });
        return;
      }
      if ((m = P.message.exec(line)) && m[1].trim() && m[6].trim() && (m[3] || m[5])) {
        closeNote();
        els.push({ type: "message", from: { lane: m[1].trim(), arrow: arrowOf(m[3]) }, to: { lane: m[6].trim(), arrow: arrowOf(m[5]) }, line: m[4], text: m[8].trim(), op: (m[3] + m[4] + m[5]).trim(), m, no });
        if (m[5] === "><" && m[1].trim() !== m[6].trim()) {
          els.push({ type: "message", from: { lane: m[6].trim(), arrow: null }, to: { lane: m[1].trim(), arrow: "closed" }, line: "-", text: "", op: "->", auto: true, no });
        }
        return;
      }
      if ((m = P.line.exec(line))) { closeNote(); els.push({ type: "divider", style: DIVIDER[m[1]], text: m[2].trim(), no }); return; }
      if ((m = P.if.exec(line))) { closeNote(); els.push({ type: "block", text: (m[1] || "").trim(), no }); openIfs++; return; }
      if (openIfs && (m = P.else.exec(line))) { closeNote(); els.push({ type: "else", text: (m[1] || "").trim(), no }); return; }
      if (openIfs && P.end.test(line)) { closeNote(); els.push({ type: "end", no }); openIfs--; return; }
      const isNote = P.note.test(line);
      if (isNote || P.todo.test(line)) {
        m = (isNote ? P.note : P.todo).exec(line);
        closeNote();
        let from = null, to = null;
        if (m[1] && m[1].trim() && m[1].trim() !== ":") {
          const lanes = m[1].replace(":", "").trim();
          if (lanes.indexOf(",") > -1) { from = lanes.split(",")[0].trim(); to = lanes.split(",")[1].trim(); } else from = to = lanes;
        } else {
          for (let i = els.length - 1; i >= 0; i--) if (els[i].from && els[i].from.lane) { from = els[i].from.lane; to = els[i].to.lane; break; }
        }
        note = { type: "note", todo: !isNote, from: { lane: from }, to: { lane: to }, text: m[2] ? m[2].trim() : "", no, end: no };
        return;
      }
      if ((m = P.name.exec(line))) { closeNote(); name = m[1].trim(); return; }
      if ((m = P.title.exec(line))) { closeNote(); els.push({ type: "title", text: m[1].trim(), no }); return; }
      if ((m = P.delay.exec(line))) { closeNote(); els.push({ type: "delay", text: m[2].trim(), no }); return; }
      if ((m = P.alias.exec(line))) { closeNote(); els.push({ type: "alias", from: m[1].trim().toLowerCase(), to: m[2].trim(), no }); return; }
      if (P.autonumber.test(line)) { closeNote(); autonumber = true; return; }
      if (note) { if (note.text) note.text += "\n"; note.text += raw; note.end = no; return; }
      els.push({ type: "error", text: line, no });
    });
    closeNote();
    while (openIfs-- > 0) els.push({ type: "end", no: null });

    // A lost end ("x") that sits next to an arrow head on the other end was part of a lane name.
    els.forEach(e => {
      if (e.type !== "message" || e.auto) return;
      if (e.from.arrow === "dropped") {
        if (e.to.arrow === "dropped") { e.type = "error"; e.why = "an arrow can’t be lost at both ends"; }
        else if (e.to.arrow) { e.from.arrow = null; e.from.lane += e.m[3]; }
      } else if (e.to.arrow === "dropped" && e.from.arrow) {
        e.to.arrow = null;
        e.to.lane = e.m[5] + e.to.lane;
      }
    });
    return { els, name, autonumber, icons };
  }

  function parse(text) {
    const { els, name, autonumber, icons } = scan(text);
    const model = { title: "", autonumber, lanes: [], rows: [], states: [], intro: "", warnings: [], total: 0, icons };
    const warn = (no, msg) => model.warnings.push(no == null ? msg : `Line ${no + 1}: ${msg}`);

    // Lanes: in the order messages first name them; names match without case and keep their first spelling.
    let lanes = [];
    const find = n => lanes.find(l => l.toLowerCase() === String(n).toLowerCase());
    els.forEach(e => {
      if (e.type !== "message") return;
      ["from", "to"].forEach(p => {
        if (!e[p].lane) return;
        const hit = find(e[p].lane);
        if (hit) e[p].lane = hit; else lanes.push(e[p].lane);
      });
    });

    // order: the listed lanes come first, in the listed order. Only the first valid order line counts.
    let orderAt = null;
    els.forEach(e => {
      if (e.type !== "order") return;
      if (orderAt !== null) { warn(e.no, `order is already set on line ${orderAt + 1}, so swimlanes.io shows this line as an error.`); return; }
      const first = [];
      e.lanes.forEach(o => { const hit = lanes.find(l => l.toLowerCase() === o); if (hit) { first.push(hit); lanes.splice(lanes.indexOf(hit), 1); } });
      lanes = first.concat(lanes);
      if (first.length) orderAt = e.no; else warn(e.no, "order names no lane of this diagram.");
    });

    // alias X: Y shows lane X as Y.
    const alias = {};
    els.forEach(e => {
      if (e.type !== "alias") return;
      if (!e.to) warn(e.no, "an alias can’t be blank.");
      else if (!lanes.find(l => l.toLowerCase() === e.from)) warn(e.no, `alias names no lane of this diagram.`);
      else if (alias[e.from]) warn(e.no, `${e.from} already has an alias.`);
      else alias[e.from] = e.to;
    });

    // title: the first one counts; name: is the fallback.
    els.forEach(e => {
      if (e.type !== "title") return;
      if (!model.title) model.title = e.text; else warn(e.no, "the title is already set, so swimlanes.io shows this line as an error.");
    });
    if (!model.title) model.title = name;

    // Notes on unknown lanes, or with no message above, span every lane.
    els.forEach(e => {
      if (e.type !== "note") return;
      ["from", "to"].forEach(p => { if (e[p].lane) e[p].lane = find(e[p].lane) || null; });
      if (e.from.lane === null || e.to.lane === null) { e.from.lane = lanes[0] || null; e.to.lane = lanes[lanes.length - 1] || null; }
    });

    const key = n => String(n).toLowerCase();
    model.lanes = lanes.map((n, i) => ({ name: alias[key(n)] || n, key: key(n), i }));
    model.laneByKey = new Map(model.lanes.map(l => [l.key, l]));

    // Rows for the player, plus the player's own // lines. Each row knows its first source line
    // (srcLine), and rowByLine finds the row that a line belongs to, as swimlanes.io links them.
    let count = 0, lastMsg = null;
    const stack = [], rowByLine = new Map();
    const own = (row, first, last) => {
      row.srcLine = first;
      for (let k = first; k <= (last == null ? first : last); k++) if (!rowByLine.has(k)) rowByLine.set(k, row);
      return row;
    };
    els.forEach(e => {
      switch (e.type) {
        case "message": {
          const fa = e.from.arrow, ta = e.to.arrow;
          let from = e.from.lane, to = e.to.lane, startHead = "", endHead = "";
          if (ta && fa) { endHead = HEAD(ta); startHead = HEAD(fa); }
          else if (ta) endHead = HEAD(ta);
          else { from = e.to.lane; to = e.from.lane; endHead = HEAD(fa); }
          lastMsg = { type: "msg", n: ++count, from: key(from), to: key(to), self: key(from) === key(to), line: e.line, startHead, endHead, label: e.text, op: e.op, auto: !!e.auto };
          model.rows.push(own(lastMsg, e.no));
          break;
        }
        case "comment": {
          const c = e.text.startsWith("//") ? e.text.slice(2).trim() : "";
          let m;
          // explain and state lines belong to the message above them.
          if (lastMsg && /^(explain\s*:|state\s)/i.test(c) && !rowByLine.has(e.no)) rowByLine.set(e.no, lastMsg);
          if ((m = /^explain\s*:\s*(.*)$/i.exec(c))) {
            if (lastMsg) lastMsg.explain = (lastMsg.explain ? lastMsg.explain + " " : "") + m[1];
            else model.intro = (model.intro ? model.intro + " " : "") + m[1];
          } else if ((m = /^state\s+([^:]+?)\s*:\s*(.*)$/i.exec(c))) {
            model.states.push({ after: count, lane: key(m[1].trim()), laneName: m[1].trim(), text: m[2], line: e.no + 1 });
          } else if ((m = /^phase\s*:\s*(.*)$/i.exec(c))) {
            model.rows.push(own({ type: "phase", text: m[1] }, e.no));
          }
          break;
        }
        case "note":
          model.rows.push(own({ type: "note", todo: e.todo, text: e.text, lanes: [e.from.lane, e.to.lane].filter(Boolean).map(key) }, e.no, e.end));
          break;
        case "divider": model.rows.push(own({ type: "divider", style: e.style, text: e.text }, e.no)); break;
        case "delay": model.rows.push(own({ type: "delay", text: e.text }, e.no)); break;
        case "block": { const row = own({ type: "block", text: e.text, depth: stack.length }, e.no); model.rows.push(row); stack.push(row); break; }
        case "else": model.rows.push(own({ type: "else", text: e.text, depth: Math.max(0, stack.length - 1) }, e.no)); break;
        case "end": {
          const row = { type: "end", srcLine: e.no };
          model.rows.push(row);
          const open = stack.pop();
          if (open) { open.endRow = row; if (e.no != null && !rowByLine.has(e.no)) rowByLine.set(e.no, open); } // "end" selects its section
          break;
        }
        case "error":
          warn(e.no, e.why ? `${e.why}, so swimlanes.io shows this line as an error.` : `not swimlanes.io syntax, so swimlanes.io shows it as an error: ${e.text.length > 60 ? e.text.slice(0, 57) + "…" : e.text}`);
          break;
        default:
      }
    });
    model.total = count;
    model.rows = model.rows.filter(r => r.type !== "note" || r.lanes.length);
    model.rows.forEach((r, i) => { r.idx = i; });
    rowByLine.forEach((r, k) => { if (model.rows[r.idx] !== r) rowByLine.delete(k); });
    model.rowByLine = rowByLine;

    // When each row shows: a message at its own step, a note with the message above it,
    // dividers, delays, phases and section starts with the next message.
    let seen = 0;
    model.rows.forEach(r => {
      if (r.type === "msg") { seen = r.n; r.showAt = r.n; }
      else if (r.type === "note" || r.type === "end") r.showAt = seen;
      else r.showAt = Math.min(seen + 1, count);
    });
    model.states.forEach(s => { if (!model.laneByKey.has(s.lane)) warn(s.line - 1, `"// state ${s.laneName}" names no lane of this diagram.`); });
    return model;
  }

  /* ---------- Layout and drawing ---------- */

  // A word is a run without spaces; an icon such as {fas-duck fa-lg} stays whole inside one.
  const WORD = new RegExp(`(?:${FA_SRC}|[^\\s{]+|\\{)+`, "gi");
  const rawLen = text => String(text).replace(FA_ALL, iconChars).length;

  function wrap(text, width) {
    const out = [];
    String(text).split("\n").forEach(par => {
      let line = par.replace(/^\s*[*-]\s+/, "• ").trimEnd();
      if (!line.trim()) { out.push(""); return; }
      const words = line.match(WORD) || [];
      let cur = "";
      words.forEach(w => {
        if (rawLen((cur + " " + w).trim()) > width && cur) { out.push(cur); cur = w; } else cur = (cur ? cur + " " : "") + w;
      });
      if (cur) out.push(cur);
    });
    while (out.length && !out[out.length - 1]) out.pop();
    return out.length ? out : [""];
  }

  function layout(model) {
    const n = Math.max(1, model.lanes.length);
    const longest = Math.max(4, ...model.lanes.map(l => rawLen(l.name)));
    const S = Math.max(124, Math.min(180, longest * 8 + 48));
    const X0 = 92;
    const xs = {};
    model.lanes.forEach((l, i) => { xs[l.key] = X0 + i * S; });
    const W = Math.max(560, X0 + (n - 1) * S + Math.round(S / 2) + 24);
    let y = 14;
    model.rows.forEach(r => {
      let h = 34;
      if (r.type === "msg") h = r.self ? 66 : 48;
      else if (r.type === "note") {
        const lx = r.lanes.map(k => xs[k]);
        const xa = Math.max(44, Math.min(...lx) - S * 0.42), xb = Math.min(W - 12, Math.max(...lx) + S * 0.42);
        r._x = xa; r._w = xb - xa;
        r._lines = wrap(vlen(r.text) ? r.text : " ", Math.max(12, Math.floor((r._w - 20) / 6.9)));
        h = 22 + r._lines.length * 17;
      } else if (r.type === "block") h = 38;
      else if (r.type === "else") h = 32;
      else if (r.type === "end") h = 18;
      r._top = y; r._h = h;
      r._y = r.type === "msg" ? y + h / 2 + 7 : y + h / 2;
      y += h;
    });
    return { S, X0, xs, W, H: y + 26 };
  }

  function head(x, y, d, kind) {
    if (kind === ">") return `<polygon class="slp-hd" points="${x},${y} ${x - d * 11},${y - 6} ${x - d * 11},${y + 6}"/>`;
    if (kind === ">>") return `<polyline class="slp-hd slp-open" points="${x - d * 11},${y - 6} ${x},${y} ${x - d * 11},${y + 6}"/>`;
    if (kind === "x") return `<path class="slp-hd slp-open" d="M${x - 6} ${y - 6}L${x + 6} ${y + 6}M${x + 6} ${y - 6}L${x - 6} ${y + 6}"/>`;
    return "";
  }

  function lineClass(r) {
    return "slp-ln" + (r.line === "--" || r.line === "==" ? " slp-dash" : "") + (r.line === "=" || r.line === "==" ? " slp-bold" : "");
  }

  // A message's label as drawn by draw(): swimlanes.io's autonumber writes "[n] " before each message.
  function numbered(model, r, draw) {
    const text = r.label ? draw(r.label) : "";
    return model.autonumber ? `[${r.n}]` + (text ? " " + text : "") : text;
  }

  function msgSvg(model, L, r, state, colorBy) {
    const y = r._y;
    const x1 = L.xs[r.from], x2 = L.xs[r.to];
    const lane = model.laneByKey.get(colorBy === "source" ? r.from : r.to);
    const color = colorBy === "none" ? "slp-k" : `slp-c${lane.i % 9}`;
    const cur = state === "cur";
    let body;
    if (r.self) {
      const top = y - 10, bot = y + 14;
      body = `<g class="slp-ln-wrap" style="transform-origin:${x1}px ${y}px"><path class="${lineClass(r)}" d="M${x1} ${top}H${x1 + 44}V${bot}H${x1 + (r.endHead === ">" ? 10 : 2)}" fill="none"/></g>` +
        `<g class="slp-hd-wrap">${head(x1, bot, -1, r.endHead)}${r.startHead ? head(x1, top, -1, r.startHead) : ""}</g>` +
        `<text class="slp-lbl" x="${x1 + 54}" y="${y + 6}">${numbered(model, r, svgText)}</text>`;
    } else {
      const d = Math.sign(x2 - x1);
      const lost = r.endHead === "x";
      const xe = lost ? x1 + (x2 - x1) * 0.82 : x2 - d * (r.endHead === ">" ? 9 : r.endHead === ">>" ? 2 : 0);
      const xs = x1 + d * (r.startHead === ">" ? 9 : r.startHead === ">>" ? 2 : 0);
      const xh = lost ? xe : x2;
      body = `<g class="slp-ln-wrap" style="transform-origin:${x1}px ${y}px"><line class="${lineClass(r)}" x1="${xs}" y1="${y}" x2="${xe}" y2="${y}"/></g>` +
        `<g class="slp-hd-wrap">${head(xh, y, d, r.endHead)}${r.startHead ? head(x1, y, -d, r.startHead) : ""}</g>` +
        `<text class="slp-lbl" x="${(x1 + x2) / 2}" y="${y - 10}" text-anchor="middle">${numbered(model, r, svgText)}</text>` +
        (cur ? `<circle class="slp-pkt" cx="${x1}" cy="${y}" r="5" style="--slp-dx:${(lost ? xe : x2) - x1}px"/>` : "");
    }
    return `<g class="slp-msg slp-${state} ${color}" data-n="${r.n}" data-row="${r.idx}" tabindex="0" role="button" aria-label="Go to step ${r.n}${r.label ? ": " + esc(plain(r.label)) : ""}">` +
      `<rect class="slp-hit" x="0" y="${r._top}" width="${L.W}" height="${r._h}"/>` +
      (cur ? `<rect class="slp-band" x="0" y="${r._top + 2}" width="${L.W}" height="${r._h - 4}" rx="8"/>` : "") +
      body +
      `<circle class="slp-badge" cx="30" cy="${y}" r="12"/><text class="slp-bnum" x="30" y="${y + 4}" text-anchor="middle">${r.n}</text></g>`;
  }

  function render(model, L, step, opts) {
    const ghost = !!opts.ghost;
    const vis = r => (r.showAt <= step ? (r.type === "msg" && r.n === step ? "cur" : r.type === "msg" ? "past" : "on") : ghost ? "ghost" : null);
    let lastBottom = 40;
    model.rows.forEach(r => { if (r.showAt <= step) lastBottom = Math.max(lastBottom, r._top + r._h); });
    const H = ghost ? L.H : Math.max(90, lastBottom + 22);
    let out = "";
    model.lanes.forEach(l => { out += `<line class="slp-life slp-c${l.i % 9}" x1="${L.xs[l.key]}" y1="0" x2="${L.xs[l.key]}" y2="${H}"/>`; });

    // Sections first, so messages draw over their frames.
    model.rows.forEach(r => {
      if (r.type !== "block") return;
      const v = vis(r);
      if (!v) return;
      const inset = 46 + r.depth * 10;
      const endShown = r.endRow && (r.endRow.showAt <= step || ghost);
      const bottom = endShown ? r.endRow._top + r.endRow._h - 4 : Math.max(r._top + r._h, lastBottom + 6);
      const len = vlen(r.text);
      const tw = Math.min(L.W - inset - 20, len * 7 + 22);
      out += `<g class="slp-block slp-${v === "ghost" ? "ghost" : "on"}${r === opts.focus ? " slp-focus" : ""}" data-row="${r.idx}"><rect class="slp-frame" x="${inset}" y="${r._top + 6}" width="${L.W - inset - 12 - r.depth * 10}" height="${bottom - r._top - 6}" rx="8"/>` +
        (len ? `<path class="slp-tab" d="M${inset} ${r._top + 14}a8 8 0 0 1 8 -8H${inset + tw}v16l-8 8H${inset}Z"/><text class="slp-tabtext" x="${inset + 10}" y="${r._top + 23}">${svgText(r.text)}</text>` : "") + `</g>`;
    });

    model.rows.forEach(r => {
      const v = vis(r);
      if (!v) return;
      if (r.type === "msg") { out += msgSvg(model, L, r, v, opts.colorBy); return; }
      const cls = `slp-row slp-${v}${r === opts.focus ? " slp-focus" : ""}`;
      if (r.type === "note") {
        out += `<g class="${cls} slp-note${r.todo ? " slp-todo" : ""}" data-row="${r.idx}"><rect x="${r._x}" y="${r._top + 6}" width="${r._w}" height="${r._h - 10}" rx="6"/>` +
          r._lines.map((ln, i) => `<text x="${r._x + 10}" y="${r._top + 23 + i * 17}">${svgText(ln)}</text>`).join("") + `</g>`;
      } else if (r.type === "divider" || r.type === "phase" || r.type === "delay") {
        const label = (r.type === "delay" ? "⋯ " : "") + r.text;
        const tw = vlen(label) * 7 + 24;
        const style = r.type === "phase" ? "phase" : r.type === "delay" ? "delay" : r.style;
        out += `<g class="${cls} slp-div slp-div-${style}" data-row="${r.idx}"><line x1="44" y1="${r._y}" x2="${L.W - 12}" y2="${r._y}"/>` +
          (vlen(label) ? `<rect x="${(L.W - tw) / 2}" y="${r._y - 11}" width="${tw}" height="22" rx="11"/><text x="${L.W / 2}" y="${r._y + 4}" text-anchor="middle">${svgText(label)}</text>` : "") + `</g>`;
      } else if (r.type === "else") {
        const inset = 46 + r.depth * 10;
        const label = vlen(r.text) ? svgText(r.text) : "else";
        out += `<g class="${cls} slp-else" data-row="${r.idx}"><line x1="${inset}" y1="${r._y}" x2="${L.W - 12 - r.depth * 10}" y2="${r._y}"/><text x="${inset + 10}" y="${r._y - 5}">${label}</text></g>`;
      }
    });
    return { svg: out, H };
  }

  /* ---------- Player ---------- */

  let instances = 0;
  const svgIcon = d => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
  const ICON = {
    restart: svgIcon('<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4.5v4h4"/>'),
    back: svgIcon('<path d="M6.5 5v14"/><path d="M18 5.5 9.5 12l8.5 6.5Z" fill="currentColor"/>'),
    play: svgIcon('<path d="M7.5 5.5v13L18.5 12Z" fill="currentColor"/>'),
    pause: svgIcon('<path d="M8.5 5.5v13M15.5 5.5v13"/>'),
    next: svgIcon('<path d="M6 5.5v13L14.5 12Z" fill="currentColor"/><path d="M17.5 5v14"/>'),
    full: svgIcon('<path d="M4.5 9V4.5H9M19.5 9V4.5H15M4.5 15v4.5H9M19.5 15v4.5H15"/>'),
    exitFull: svgIcon('<path d="M9 4.5V9H4.5M15 4.5V9h4.5M9 19.5V15H4.5M15 19.5V15h4.5"/>'),
  };
  const setButton = (b, icon, label) => { b.innerHTML = icon; b.setAttribute("aria-label", label); b.title = label; };
  const STYLE_WORDS = { "-": "solid", "--": "dashed", "=": "bold", "==": "bold dashed" };
  const HEAD_WORDS = { ">": "arrow", ">>": "open arrow", "x": "lost message" };

  function mount(root, options) {
    const opts = Object.assign({ ghost: true, speed: 2600, colorBy: "target", icons: FA_CSS }, options || {});
    const id = "slp" + (++instances);
    root.innerHTML = `
<div class="slp">
  <div class="slp-controls">
    <button type="button" class="slp-icon" data-act="restart" aria-label="Restart" title="Restart">${ICON.restart}</button>
    <button type="button" class="slp-icon" data-act="back" aria-label="Back (←)" title="Back (←)">${ICON.back}</button>
    <button type="button" class="slp-icon" data-act="play" aria-pressed="false" aria-label="Play (space)" title="Play (space)">${ICON.play}</button>
    <button type="button" class="slp-icon slp-primary" data-act="next" aria-label="Next (→)" title="Next (→)">${ICON.next}</button>
    <input type="range" class="slp-scrub" id="${id}-scrub" min="0" max="0" step="1" value="0" aria-label="Step">
    <label class="slp-check" title="Show the upcoming steps faintly"><input type="checkbox" class="slp-ghost" id="${id}-ghost"${opts.ghost ? " checked" : ""}> Upcoming</label>
    <select class="slp-speed" id="${id}-speed" aria-label="Play speed" title="Play speed"><option value="1500">Fast</option><option value="2600" selected>Normal speed</option><option value="4200">Slow</option></select>
    <select class="slp-colorby" id="${id}-colorby" aria-label="Arrow colour" title="Arrow colour"><option value="target">Colour: target lane</option><option value="source">Colour: source lane</option><option value="none">No colour</option></select>
    <button type="button" class="slp-icon" data-act="full" aria-pressed="false" aria-label="Full screen (F)" title="Full screen (F)">${ICON.full}</button>
  </div>
  <div class="slp-phases"></div>
  <div class="slp-card" aria-live="polite">
    <div class="slp-numbox"><span class="slp-num">0</span><span class="slp-of">of 0</span></div>
    <div class="slp-meta"></div>
    <div class="slp-arrow"></div>
    <div class="slp-label"></div>
    <p class="slp-explain"></p>
  </div>
  <div class="slp-scroll"><div class="slp-seq"><div class="slp-head"></div><svg class="slp-svg" role="img" aria-label="Sequence diagram"></svg></div></div>
  <p class="slp-foot">Click a row or its number to jump to that step. Keys: ← → step, space plays, F full screen. Lane cards show <b>state</b> from <code>// state</code> lines and the last message that touched the lane.</p>
</div>`;
    if (opts.fill) root.querySelector(".slp").classList.add("slp-fill");
    const q = sel => root.querySelector(sel);
    const ui = {
      scrub: q(".slp-scrub"), ghost: q(".slp-ghost"), speed: q(".slp-speed"), colorBy: q(".slp-colorby"),
      phases: q(".slp-phases"), card: q(".slp-card"), num: q(".slp-num"), of: q(".slp-of"), meta: q(".slp-meta"),
      arrow: q(".slp-arrow"), label: q(".slp-label"), explain: q(".slp-explain"),
      scroll: q(".slp-scroll"), seq: q(".slp-seq"), head: q(".slp-head"), svg: q(".slp-svg"),
      play: q('[data-act="play"]'), next: q('[data-act="next"]'), back: q('[data-act="back"]'),
    };
    ui.colorBy.value = opts.colorBy;
    const listeners = {};
    const emit = (ev, data) => (listeners[ev] || []).forEach(fn => fn(data));
    let model = parse(""), L = layout(model), step = 0, timer = null, refocus = null;
    // The chosen row: the current message, or the row that a click or the editor picked. Its source
    // line is the line that the page highlights in its editor ("select" event, select(line)).
    let focus = null;
    const reduce = global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function phaseList() {
      return model.rows.filter(r => (r.type === "phase" || r.type === "divider") && vlen(r.text)).map(r => ({ html: htmlText(r.text), start: Math.max(1, r.showAt) }));
    }

    function buildStatic() {
      L = layout(model);
      ui.seq.style.width = L.W + "px";
      ui.svg.setAttribute("width", String(L.W));
      ui.head.innerHTML = model.lanes.map(l => {
        const w = L.S - 14;
        return `<div class="slp-lh slp-c${l.i % 9}" data-lane="${esc(l.key)}" style="left:${L.xs[l.key] - w / 2}px; width:${w}px"><div class="slp-lh-name">${iconHtml(l.name)}</div><div class="slp-lh-state"></div><div class="slp-lh-last"></div></div>`;
      }).join("");
      const phases = phaseList();
      ui.phases.innerHTML = phases.map(p => `<button type="button" class="slp-phase" data-start="${p.start}">${p.html}</button>`).join("");
      ui.phases.hidden = !phases.length;
      ui.scrub.max = String(model.total);
      ui.of.textContent = `of ${model.total}`;
    }

    function laneCards() {
      const lastBy = {};
      model.rows.forEach(r => {
        if (r.type !== "msg" || r.n > step) return;
        lastBy[r.from] = { dir: "→", other: r.to, r };
        lastBy[r.to] = { dir: "←", other: r.from, r };
        if (r.self) lastBy[r.from] = { dir: "↺", other: r.from, r };
      });
      const stateBy = {}, changed = new Set();
      model.states.forEach(s => { if (s.after <= step) stateBy[s.lane] = s.text; if (s.after === step && step > 0) changed.add(s.lane); });
      const cur = model.rows.find(r => r.type === "msg" && r.n === step);
      ui.head.querySelectorAll(".slp-lh").forEach(el => {
        const k = el.dataset.lane;
        const st = stateBy[k];
        el.querySelector(".slp-lh-state").innerHTML = st ? htmlText(st) : "";
        el.querySelector(".slp-lh-state").hidden = !st;
        const last = lastBy[k];
        el.querySelector(".slp-lh-last").innerHTML = last
          ? `${last.dir} ${last.r.self ? "self" : iconHtml(model.laneByKey.get(last.other).name)}: ${vlen(last.r.label) || model.autonumber ? numbered(model, last.r, htmlText) : "(no label)"}`
          : "no messages yet";
        el.classList.toggle("slp-act", !!cur && (cur.from === k || cur.to === k));
        el.classList.toggle("slp-chg", changed.has(k));
      });
    }

    function card() {
      const r = model.rows.find(x => x.type === "msg" && x.n === step);
      ui.num.textContent = String(step);
      const phases = phaseList().filter(p => p.start <= Math.max(step, 1));
      ui.meta.innerHTML = step === 0 ? (model.title ? iconHtml(model.title) : "Start") : (phases.length ? phases[phases.length - 1].html : iconHtml(model.title));
      if (!r) {
        ui.card.className = "slp-card";
        ui.arrow.innerHTML = model.total ? `<span class="slp-start">Press <b>Next</b> or <b>Play</b>. Each step draws one message.</span>` : `<span class="slp-start">No messages yet. Add a line such as <code>Alice -&gt; Bob: Hello</code>.</span>`;
        ui.label.textContent = "";
        ui.explain.innerHTML = model.intro ? htmlText(model.intro) : "";
        return;
      }
      const from = model.laneByKey.get(r.from), to = model.laneByKey.get(r.to);
      const style = `${STYLE_WORDS[r.line] || "solid"}${r.startHead && r.endHead ? ", both ways" : ""}, ${HEAD_WORDS[r.endHead] || "arrow"}`;
      ui.card.className = `slp-card slp-c${(opts.colorBy === "source" ? from : to).i % 9}`;
      ui.arrow.innerHTML = `<span class="slp-chip slp-c${from.i % 9}">${iconHtml(from.name)}</span>` +
        (r.self ? "" : `<span class="slp-to">${r.startHead ? "↔" : "→"}</span><span class="slp-chip slp-c${to.i % 9}">${iconHtml(to.name)}</span>`) +
        `<span class="slp-kind"><code>${esc(r.op)}</code> ${style}</span>`;
      ui.label.innerHTML = r.label || model.autonumber ? `“${numbered(model, r, htmlText)}”` : `<span class="slp-muted">(no label)</span>`;
      ui.explain.innerHTML = r.explain ? htmlText(r.explain) : `<span class="slp-muted">No explanation. Add <code>// explain: …</code> under this message.</span>`;
    }

    function draw(animate) {
      const { svg, H } = render(model, L, step, { ghost: ui.ghost.checked, colorBy: ui.colorBy.value, focus });
      ui.svg.setAttribute("viewBox", `0 0 ${L.W} ${H}`);
      ui.svg.setAttribute("height", String(H));
      ui.svg.classList.toggle("slp-animate", !!animate);
      ui.svg.innerHTML = svg;
      laneCards();
      card();
      ui.scrub.value = String(step);
      ui.back.disabled = step === 0;
      ui.next.disabled = step >= model.total;
      ui.phases.querySelectorAll(".slp-phase").forEach((b, i, all) => {
        const start = Number(b.dataset.start);
        const nextStart = i + 1 < all.length ? Number(all[i + 1].dataset.start) : Infinity;
        b.classList.toggle("slp-on", step >= start && step < nextStart);
        b.classList.toggle("slp-done", step >= nextStart);
      });
      scrollToCurrent(true);
      // The rows were redrawn: give keyboard focus back to the row the keys moved to.
      if (refocus !== null) {
        const el = ui.svg.querySelector(`[data-n="${refocus}"]`);
        if (el) el.focus({ preventScroll: true });
        refocus = null;
      }
      emit("step", step);
    }

    function scrollToCurrent(smooth) {
      const r = focus || model.rows.find(x => x.type === "msg" && x.n === step);
      if (r && r._y != null) {
        const top = r._y + ui.head.offsetHeight - ui.scroll.clientHeight * 0.55;
        ui.scroll.scrollTo({ top: Math.max(0, top), behavior: smooth && !reduce ? "smooth" : "auto" });
      } else if (step === 0) ui.scroll.scrollTo({ top: 0 });
    }

    // Go to step n. The chosen row becomes row, or else the message of step n; "select" tells the page,
    // unless quiet (the page itself chose the row).
    function go(n, animate, row, quiet) {
      step = Math.max(0, Math.min(model.total, n));
      focus = row !== undefined ? row : model.rows.find(r => r.type === "msg" && r.n === step) || null;
      draw(animate !== false);
      if (!quiet) emit("select", focus ? focus.srcLine : null);
    }

    // A row picked in the player: a message goes to its step, a divider or phase to the step it starts;
    // a note or section stays on the current step if it shows there.
    function pick(row) {
      pause();
      if (row.type === "msg") go(row.n, true, row);
      else if (row.type === "divider" || row.type === "phase" || row.type === "delay") go(row.showAt, true, row);
      else go(Math.max(step, row.showAt), false, row);
    }

    // The editor's caret moved to a source line: choose the row that owns it, as swimlanes.io does.
    function select(line) {
      const row = line == null ? null : model.rowByLine.get(line) || null;
      if (row === focus) return;
      if (!row) { focus = null; draw(false); return; }
      pause();
      if (row.type === "msg") go(row.n, true, row, true);
      else go(Math.max(step, row.showAt), false, row, true);
    }
    function pause() {
      if (timer) { clearInterval(timer); timer = null; }
      setButton(ui.play, ICON.play, "Play (space)");
      ui.play.setAttribute("aria-pressed", "false");
    }
    function play() {
      if (!model.total) return;
      if (step >= model.total) go(0, false);
      setButton(ui.play, ICON.pause, "Pause (space)");
      ui.play.setAttribute("aria-pressed", "true");
      timer = setInterval(() => { if (step >= model.total) pause(); else go(step + 1); }, Number(ui.speed.value) || opts.speed);
    }
    function load(text, keepStep) {
      const prev = step;
      const prevLine = focus ? focus.srcLine : null;
      const m = model = parse(text);
      const icons = m.icons.map(x => x.icon);
      const pending = faPending(icons);
      if (!pending) iconWarnings(m);
      buildStatic();
      step = keepStep ? Math.min(prev, model.total) : 0;
      // While the text is edited, keep the chosen row if a row still starts on its line.
      focus = keepStep && prevLine != null && (model.rowByLine.get(prevLine) || {}).srcLine === prevLine ? model.rowByLine.get(prevLine) : null;
      draw(false);
      emit("load", model);
      // Icons draw once Font Awesome and its fonts load; the "icons" event tells the page to redraw too.
      if (pending) {
        faResolve(icons, opts.icons).then(() => {
          if (m !== model) return;
          iconWarnings(m);
          buildStatic();
          draw(false);
          emit("icons", m);
        });
      }
      return model;
    }

    root.addEventListener("click", e => {
      const b = e.target.closest("button");
      if (!b || !root.contains(b)) return;
      if (b.classList.contains("slp-phase")) { pause(); go(Number(b.dataset.start)); return; }
      const act = b.dataset.act;
      if (act === "next") { pause(); go(step + 1); }
      else if (act === "back") { pause(); go(step - 1); }
      else if (act === "restart") { pause(); go(0, false); }
      else if (act === "play") { if (timer) pause(); else play(); }
      else if (act === "full") toggleFull();
    });
    ui.scrub.addEventListener("input", () => { pause(); go(Number(ui.scrub.value), false); });
    // A click on a row picks it: a message row (its number, line or label) or a divider jumps to its
    // step, and the slider, card, lane cards and the page's editor follow.
    const rowOf = el => model.rows[Number(el.dataset.row)];
    ui.svg.addEventListener("click", e => {
      const el = e.target.closest && e.target.closest(".slp-svg [data-row]");
      if (el && rowOf(el)) pick(rowOf(el));
    });
    ui.svg.addEventListener("keydown", e => {
      const el = e.target.closest && e.target.closest(".slp-svg [data-n]");
      if (!el || (e.key !== "Enter" && e.key !== " ")) return;
      e.preventDefault();
      e.stopPropagation();
      refocus = Number(el.dataset.n);
      pick(rowOf(el));
    });
    ui.ghost.addEventListener("change", () => draw(false));
    ui.colorBy.addEventListener("change", () => draw(false));
    ui.speed.addEventListener("change", () => { if (timer) { pause(); play(); } });
    document.addEventListener("keydown", e => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target;
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
      const onRow = !!(t && t.closest && t.closest(".slp-svg [data-n]"));
      if (e.key === "Escape" && box.classList.contains("slp-full")) { exitFull(); e.preventDefault(); return; }
      if (e.key === "f" || e.key === "F") { toggleFull(); e.preventDefault(); return; }
      if (e.key === "ArrowRight") { pause(); if (onRow) refocus = Math.min(model.total, step + 1); go(step + 1); e.preventDefault(); }
      else if (e.key === "ArrowLeft") { pause(); if (onRow) refocus = Math.max(1, step - 1); go(step - 1); e.preventDefault(); }
      else if (e.key === " " && !(t && t.tagName === "BUTTON")) { if (timer) pause(); else play(); e.preventDefault(); }
    });

    // Full screen: the browser's Fullscreen API where the page may use it; where it is refused
    // (some embeds, phones), the player covers the window instead. Esc or the button leaves both.
    const box = root.querySelector(".slp");
    const fullBtn = q('[data-act="full"]');
    const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;
    const isFull = () => fsElement() === box || box.classList.contains("slp-full");
    function syncFull() {
      const on = isFull();
      setButton(fullBtn, on ? ICON.exitFull : ICON.full, on ? "Exit full screen (Esc)" : "Full screen (F)");
      fullBtn.setAttribute("aria-pressed", String(on));
      box.classList.toggle("slp-is-full", on);
      document.documentElement.classList.toggle("slp-lock", box.classList.contains("slp-full"));
      requestAnimationFrame(() => scrollToCurrent(false));
      emit("fullscreen", on);
    }
    function fallbackFull() { box.classList.add("slp-full"); syncFull(); }
    let fullGen = 0;
    function enterFull() {
      const gen = ++fullGen;
      // A late answer to an old request must not reopen full screen after Esc.
      const fallback = () => { if (gen === fullGen && !isFull()) fallbackFull(); };
      const request = box.requestFullscreen || box.webkitRequestFullscreen;
      if (!request) { fallbackFull(); return; }
      let pending;
      try { pending = request.call(box); } catch (err) { fallbackFull(); return; }
      if (pending && pending.catch) pending.catch(fallback);
      // Some frames neither grant nor refuse: cover the window if nothing happened.
      setTimeout(fallback, 500);
    }
    async function exitFull() {
      fullGen++;
      if (fsElement() === box) {
        const exit = document.exitFullscreen || document.webkitExitFullscreen;
        try { await exit.call(document); } catch (err) { /* already left */ }
      }
      box.classList.remove("slp-full");
      syncFull();
    }
    function toggleFull() { if (isFull()) exitFull(); else enterFull(); }
    document.addEventListener("fullscreenchange", syncFull);
    document.addEventListener("webkitfullscreenchange", syncFull);

    return {
      load, go: n => { pause(); go(n); }, select, play, pause,
      fullscreen(on) { if (on === undefined ? !isFull() : on) enterFull(); else exitFull(); },
      on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
      get model() { return model; },
      get step() { return step; },
    };
  }

  global.SwimlanesPlayer = { decode, encode, toUrl, isLink, parse, mount, iconHtml, version: "1.2.1" };
})(typeof window !== "undefined" ? window : globalThis);
