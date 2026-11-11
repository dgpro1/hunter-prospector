// Precompila las plantillas de webs demo (templates/sites/*.html) a src/sites/*.json.
// En el worker no se parsea HTML (cuesta 20-85 ms de CPU): solo se rellenan los huecos ya localizados aquí.
// Uso: node scripts/compile-sites.mjs   (correrlo cada vez que cambie una plantilla)
// Motor portado de eternitydevzz/web-creator-360 (src/sitegen/compile.js).
import { parse } from "parse5";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";

const SKIP = new Set(["script", "style", "noscript", "math", "iframe"]);
const TEXT_ATTRS = ["alt", "title", "aria-label", "placeholder", "data-ph-en", "data-ph-es"];
const META_TEXT = /^(description|og:title|og:description|twitter:title|twitter:description)$/i;
const hasLetters = (s) => /\p{L}/u.test(s) || /^\s*(19|20)\d\d\s*$/.test(s);
const attr = (node, name) => node.attrs?.find((a) => a.name === name)?.value;

function attrValueRange(source, loc) {
  const raw = source.slice(loc.startOffset, loc.endOffset);
  const eq = raw.indexOf("=");
  if (eq < 0) return null;
  let start = eq + 1;
  while (/\s/.test(raw[start])) start++;
  let end = raw.length;
  if (raw[start] === '"' || raw[start] === "'") { start++; end--; }
  return [loc.startOffset + start, loc.startOffset + end];
}

export function compileTemplate(sourceRaw, key) {
  const source = String(sourceRaw).replace(/\r\n?/g, "\n");
  const doc = parse(source, { sourceCodeLocationInfo: true });
  const units = [];
  const optional = [];
  let slot = "page";
  let pendingOptional = null;
  let openRegion = null;
  let seq = 0;
  const addUnit = (u) => { const unit = { id: `u${++seq}`, slot, ...u }; units.push(unit); return unit; };

  function visitAttrs(node) {
    const loc = node.sourceCodeLocation?.startTag?.attrs || node.sourceCodeLocation?.attrs;
    if (!loc) return;
    const names = [...TEXT_ATTRS];
    if (node.tagName === "meta" && META_TEXT.test(attr(node, "name") || attr(node, "property") || "")) names.push("content");
    for (const name of names) {
      const value = attr(node, name);
      if (!value || !hasLetters(value) || !loc[name]) continue;
      const range = attrValueRange(source, loc[name]);
      if (range) addUnit({ kind: "attr", attr: name, lang: name.endsWith("-es") ? "es" : name.endsWith("-en") ? "en" : null, range, text: source.slice(...range) });
    }
  }

  function walk(parent) {
    let lastEn = null;
    const kids = parent.nodeName === "template" ? parent.content.childNodes : parent.childNodes;
    for (const node of kids || []) {
      if (node.nodeName === "#comment") {
        const text = node.data.trim();
        const loc = node.sourceCodeLocation;
        if (/^\/OPTIONAL/i.test(text)) {
          if (openRegion && loc) { optional.push({ name: openRegion.name, range: [openRegion.start, loc.endOffset] }); openRegion = null; }
          continue;
        }
        if (/^OPTIONAL/i.test(text) && loc) {
          openRegion = { start: loc.startOffset, name: /rese(ñ|n)as|reviews/i.test(text) ? "reviews" : null };
          continue;
        }
        const m = text.match(/slot:\s*([^·(\n]+?)\s*(?:[·(]|$)/i) || text.match(/slot:\s*(\S+)/i);
        if (m) { slot = m[1].trim(); if (openRegion && !openRegion.name) openRegion.name = slot.split(/[\s/]/)[0].toLowerCase(); }
        const opt = text.match(/slot:\s*([\w-]+)[^\n]*OPTIONAL/i);
        if (opt) pendingOptional = opt[1].toLowerCase();
        continue;
      }
      if (node.nodeName === "#text") {
        const loc = node.sourceCodeLocation;
        if (!loc || !hasLetters(node.value)) continue;
        const raw = source.slice(loc.startOffset, loc.endOffset);
        const lead = raw.length - raw.trimStart().length;
        const trail = raw.length - raw.trimEnd().length;
        addUnit({ kind: "text", range: [loc.startOffset + lead, loc.endOffset - trail], text: raw.trim() });
        continue;
      }
      if (!node.tagName || !node.sourceCodeLocation) continue;
      if (pendingOptional) {
        optional.push({ name: pendingOptional, range: [node.sourceCodeLocation.startOffset, node.sourceCodeLocation.endOffset] });
        pendingOptional = null;
      }
      if (SKIP.has(node.tagName)) { if (node.tagName !== "script" && node.tagName !== "style") visitAttrs(node); continue; }
      visitAttrs(node);
      const lang = attr(node, "data-en") !== undefined ? "en" : attr(node, "data-es") !== undefined ? "es" : null;
      const { startTag, endTag } = node.sourceCodeLocation;
      if (lang && startTag && endTag) {
        const range = [startTag.endOffset, endTag.startOffset];
        const unit = addUnit({ kind: "html", lang, range, text: source.slice(...range) });
        if (lang === "en") lastEn = { unit, tag: node.tagName };
        else if (lastEn && lastEn.tag === node.tagName && !lastEn.unit.pair) { lastEn.unit.pair = unit.id; unit.pair = lastEn.unit.id; lastEn = null; }
        continue;
      }
      lastEn = null;
      walk(node);
    }
  }
  walk(doc);

  const facts = {
    emails: [...new Set([...source.matchAll(/mailto:([^"'?\s>]+)/gi)].map((m) => m[1].toLowerCase()))],
    phones: [...new Set([...source.matchAll(/tel:\+?1?(\d{10})/gi)].map((m) => m[1]))],
    mapQueries: [...new Set([...source.matchAll(/maps\.google\.com\/(?:maps)?\?q=([^&"'\s]+)/gi)].map((m) => m[1]))],
    directions: [...new Set([...source.matchAll(/destination=([^&"'\s]+)/gi)].map((m) => m[1]))],
  };
  return { key, source, units, optional, facts };
}

const dir = new URL("../templates/sites/", import.meta.url);
const out = new URL("../src/sites/", import.meta.url);
for (const file of readdirSync(dir).filter((f) => f.endsWith(".html"))) {
  const key = file.replace(/\.html$/, "");
  const compiled = compileTemplate(readFileSync(new URL(file, dir), "utf8"), key);
  writeFileSync(new URL(`${key}.json`, out), JSON.stringify(compiled));
  console.log(`${key}: ${compiled.units.length} textos, ${compiled.optional.length} bloques opcionales`);
}
