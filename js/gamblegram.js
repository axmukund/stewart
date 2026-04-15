/**
 * gamblegram.js — SVG stacked-bar Gamblegram with animation and tooltips.
 *
 * `renderGamblegram(vals)` builds two stacked columns — cations (left)
 * vs anions (right) — with an easeOutCubic transition between states.
 * Includes interactive tooltips on hover / focus / touch.
 *
 * Depends on: helpers.js (parse), units.js (conversion factors)
 */

"use strict";

/* ─────────────────────────────────────────────────────────────────────
 *  Label lookup tables
 * ───────────────────────────────────────────────────────────────────── */

/** Unicode superscript labels for SVG text elements. */
const SVG_LABELS = {
  Na: "Na\u207A", K: "K\u207A",
  iCa: "iCa\u00B2\u207A", Mg: "Mg\u00B2\u207A",
  Cl: "Cl\u207B", Lactate: "Lactate\u207B",
  HCO3: "HCO\u2083\u207B",
  Alb: "Alb\u207B", Phos: "Phos\u207B",
  Unknown: "Unknown",
};

/** HTML labels (with <sup>/<sub>) for legend and tooltip markup. */
const HTML_LABELS = {
  Na: 'Na<sup>+</sup>', K: 'K<sup>+</sup>',
  iCa: 'iCa<sup>2+</sup>', Mg: 'Mg<sup>2+</sup>',
  Cl: 'Cl<sup>\u2212</sup>', Lactate: 'Lactate<sup>\u2212</sup>',
  HCO3: 'HCO<sub>3</sub><sup>\u2212</sup>',
  Alb: 'Alb<sup>\u2212</sup>', Phos: 'Phos<sup>\u2212</sup>',
  Unknown: "Unknown",
};

function escapeHTML(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function svgLabel(segment) {
  if (segment && segment.labelText) return segment.labelText;
  const key = segment && segment.k ? segment.k : segment;
  return SVG_LABELS[key] || key;
}

function htmlLabel(segment) {
  if (segment && segment.labelText) return escapeHTML(segment.labelText);
  const key = segment && segment.k ? segment.k : segment;
  return HTML_LABELS[key] || escapeHTML(key);
}

/* ─────────────────────────────────────────────────────────────────────
 *  renderGamblegram()
 * ───────────────────────────────────────────────────────────────────── */

/**
 * Build the Gamblegram SVG visualisation.
 *
 * @param {Object} vals  Ion values in mEq/L (charge equivalents).
 *   Keys: Na, K, iCa, Mg_mmol, Cl, Lac, HCO3, albMinus, piMinus, sig
 *   Note: iCa and Mg_mmol are already multiplied by 2 (divalent) by
 *   the caller (`computeAll`).
 */
function renderGamblegram(vals) {
  const svg       = document.getElementById("gg-svg");
  const legend    = document.getElementById("gg-legend");
  const unknownEl = document.getElementById("gg-unknown");
  if (!svg || !legend || !unknownEl) return;

  if (!window.__ggState) {
    window.__ggState = {
      groupsByKey: {},
      outsidePointerBound: false,
      touchBound: false,
    };
  }
  const ggState = window.__ggState;

  /* ── Unpack values ── */
  const Na       = vals.Na       || 0;
  const K        = vals.K        || 0;
  const iCa      = vals.iCa      || 0;
  const Mg_mmol  = vals.Mg_mmol  || 0;
  const Cl       = vals.Cl       || 0;
  const Lac      = vals.Lac      || 0;
  const HCO3     = vals.HCO3     || 0;
  const albMinus = vals.albMinus || 0;
  const piMinus  = vals.piMinus  || 0;
  const sig      = vals.sig      || 0;
  const extraCations = Array.isArray(vals.extraCations) ? vals.extraCations : [];
  const extraAnions  = Array.isArray(vals.extraAnions)  ? vals.extraAnions  : [];

  /**
   * Tooltip non-SI helper — returns a conventional-unit string or null.
   *
   * iCa and Mg values reaching the Gamblegram are already 2× (mEq/L),
   * so we divide by 2 to recover mmol/L before the mg/dL conversion.
   * The Mg segment reflects estimated ionized Mg derived from the
   * total serum Mg input elsewhere in the UI.
   */
  const toNonSI = (k, v) => {
    if (!Number.isFinite(v)) return null;
    switch (k) {
      case "Mg":      return ((v / 2) / MG_FACTOR).toFixed(2)  + " mg/dL";
      case "iCa":     return ((v / 2) / CA_FACTOR).toFixed(2)  + " mg/dL";
      case "Phos":    return (v / PO4_FACTOR).toFixed(2)        + " mg/dL";
      case "Lactate": return (v / LAC_FACTOR).toFixed(2)        + " mg/dL";
      case "Na": case "K": case "Cl": case "HCO3":
        return v.toFixed(2) + " mEq/L";
      default: return null;
    }
  };

  /* ── Read palette colors from CSS custom properties ──
   *    CSS vars are named --gg-Na, --gg-Cl, --gg-Aminus, etc.
   *    The `map` aliases JS ion keys to their CSS var suffixes
   *    (e.g. "Alb" → "Aminus", "Phos" → "Pi").                     */
  const cssColor = (key, fallback) => {
    const map = { "Alb": "Aminus", "Phos": "Pi", "Lactate": "Lactate", "HCO3": "HCO3", "iCa": "iCa", "Mg": "Mg" };
    const name = map[key] || key;
    const varName = "--gg-" + name;
    const v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    return v || fallback;
  };

  /* ── Build cation / anion stacks (colors read from CSS variables) ── */
  let cations = [
    { k: "Na",  v: Na,      c: cssColor("Na",  "#BFE7FF") },
    { k: "K",   v: K,       c: cssColor("K",   "#FFE9C9") },
    { k: "iCa", v: iCa,     c: cssColor("iCa", "#DFF7ED") },
    { k: "Mg",  v: Mg_mmol, c: cssColor("Mg",  "#E8E9FF") },
  ].concat(extraCations);
  let anions = [
    { k: "Cl",      v: Cl,       c: cssColor("Cl",      "#FFD8DA") },
    { k: "Lactate", v: Lac,      c: cssColor("Lactate", "#FFF6D6") },
    { k: "HCO3",    v: HCO3,     c: cssColor("HCO3",    "#E9FFEA") },
    { k: "Alb",     v: albMinus, c: cssColor("Aminus",  "#F0EAFF") },
    { k: "Phos",    v: piMinus,  c: cssColor("Pi",      "#FFF9DE") },
  ].concat(extraAnions);

  // SIG → "Unknown" segment at the top of the shorter column
  const UNKNOWN_CLR = cssColor("Unknown", "#B347FF");
  if (sig >  0.0001) anions.push({  k: "Unknown", v: sig,           c: UNKNOWN_CLR });
  if (sig < -0.0001) cations.push({ k: "Unknown", v: Math.abs(sig), c: UNKNOWN_CLR });

  // Sort large → small; keep "Unknown" on top (drawn last)
  const lift = (arr) => {
    const known   = arr.filter((x) => x.k !== "Unknown")
                       .sort((a, b) => (b.v || 0) - (a.v || 0));
    const unknown = arr.filter((x) => x.k === "Unknown");
    return known.concat(unknown);
  };
  cations = lift(cations);
  anions  = lift(anions);

  /* ── Responsive geometry ── */
  const container = document.querySelector(".container");
  const canvasEl = svg.closest(".gg-canvas");
  const pad = container ? parseInt(getComputedStyle(container).paddingLeft, 10) || 22 : 22;
  const canvasWidth = canvasEl ? Math.round(canvasEl.clientWidth) : 0;
  const W = Math.max(320, canvasWidth || (container ? container.clientWidth - pad * 2 : 480));
  const rootStyle = getComputedStyle(document.documentElement);

  /*
   * On narrow viewports the surrounding `.gg-canvas` is sized via
   * CSS to ~66vh — use that available height for the internal
   * chart height so the bars actually fill the visible canvas while
   * keeping the legend outside the 2/3 viewport requirement.
  */
  // Compute top padding and chart height. When the surrounding `.gg-canvas`
  // provides a clientHeight (tall canvas on desktop), scale the top padding
  // with that height so the top labels/title area has enough room and
  // doesn't overlap the stacked bars. For small screens keep a sensible
  // minimum padding.
  let H;
  let padTop;
  const isMobile = window.matchMedia && window.matchMedia('(max-width:520px)').matches;
  if (isMobile && canvasEl && canvasEl.clientHeight) {
    // On mobile the canvas is pinned to 66vh via CSS — use that height
    // directly so the bars fill the available vertical space.
    padTop = Math.max(12, Math.round(Math.min(W * 0.06, canvasEl.clientHeight * 0.08)));
    const available = Math.max(180, canvasEl.clientHeight - 28);
    H = Math.max(140, Math.round(available - padTop - 12));
  } else {
    // On desktop size against the actual chart canvas width so the
    // rendered label scale tracks the visible Gamblegram instead of the
    // full page container. Use a broader aspect ratio to give the labels
    // and legend more horizontal room.
    padTop = Math.max(12, Math.round(W * 0.035));
    H = Math.round(W * 1.18);
  }

  // On mobile use narrower bars so labels beside them aren't clipped;
  // on desktop use wider bars since there's more horizontal room.
  const barFraction = isMobile ? 0.28 : 0.40;
  const barW   = Math.round(Math.max(40, W * barFraction));
  const gap    = Math.max(8, Math.round(W * 0.02));
  const barsW  = 2 * barW + gap;
  const leftX  = Math.round((W - barsW) / 2);
  const rightX = leftX + barW + gap;

  // Font size is in SVG coordinate-space units (viewBox), NOT CSS pixels.
  // Use separate scaling for mobile vs desktop so labels remain legible
  // at large desktop sizes without becoming oversized on narrow screens.
  const legendFontPx = parseFloat(rootStyle.getPropertyValue("--gg-legend-font-size")) || 15;
  const labelFontPx = parseFloat(rootStyle.getPropertyValue("--gg-label-font-size")) || 20;
  const resultLabelEl = document.querySelector(".results.compact dd");
  const resultFontPx = resultLabelEl ? parseFloat(getComputedStyle(resultLabelEl).fontSize) : null;

  const computedLabelFontSize = isMobile
    ? Math.max(12, Math.min(Math.round(legendFontPx * (W / 330)), 16))
    : Math.max(72, Math.round((resultFontPx || labelFontPx) * 2));

  const fSizeNum = computedLabelFontSize;
  const baseY  = padTop + H;

  const sum      = (a) => a.reduce((s, x) => s + (x.v || 0), 0);
  const totalC   = sum(cations);
  const totalA   = sum(anions);
  const maxStack = Math.max(totalC, totalA, 1);

  /* ── Keep accessibility tags + layered groups (live-update path) ── */
  let segLayer = svg.querySelector("g.gg-segments");
  if (!segLayer) {
    segLayer = document.createElementNS("http://www.w3.org/2000/svg", "g");
    segLayer.setAttribute("class", "gg-segments");
    svg.appendChild(segLayer);
  }

  // Cull stale groups if state and DOM drift apart.
  Object.keys(ggState.groupsByKey).forEach((k) => {
    const rec = ggState.groupsByKey[k];
    if (!rec || !rec.group || !segLayer.contains(rec.group)) delete ggState.groupsByKey[k];
  });

  svg.setAttribute("viewBox", "0 0 " + W + " " + (H + padTop + 40));
  // On narrow screens fill the canvas height; on desktop fill the width.
  if (isMobile) {
    svg.style.width = "auto";
    svg.style.height = "100%";
  } else {
    svg.style.width  = "100%";
    svg.style.height = "auto";
  }

  /* ── Compute target heights / positions ── */
  let y = baseY;
  const cT = cations.map((item) => {
    const h = Math.max(10, (item.v / maxStack) * H);
    y -= h;
    return { item, ty: y, th: h };
  });
  y = baseY;
  const aT = anions.map((item) => {
    const h = Math.max(10, (item.v / maxStack) * H);
    y -= h;
    return { item, ty: y, th: h };
  });

  /* ── Create rect + label pairs ── */
  const NS   = "http://www.w3.org/2000/svg";
  const anim = [];
  const guideColor = rootStyle.getPropertyValue("--gg-guide").trim() || "#e6eef8";
  const guideUnderlay = rootStyle.getPropertyValue("--gg-guide-underlay").trim() || "#020617";

  function layoutLabelYs(targets) {
    const labelHeight = fSizeNum * (isMobile ? 2.2 : 1.2);
    const half        = labelHeight / 2;
    const top         = padTop + half;
    const bottom      = baseY - half;
    const gapY        = labelHeight + Math.max(4, Math.round(fSizeNum * 0.18));
    const placed = targets.map((t, index) => ({
      index,
      targetY: t.ty + t.th / 2,
    })).sort((a, b) => a.targetY - b.targetY);

    if (!placed.length) return new Map();

    const capacity = bottom - top;
    if (placed.length > 1 && gapY * (placed.length - 1) > capacity) {
      const step = capacity / (placed.length - 1);
      placed.forEach((item, i) => { item.y = top + i * step; });
    } else {
      let cursor = top;
      placed.forEach((item) => {
        item.y = Math.max(item.targetY, cursor);
        cursor = item.y + gapY;
      });

      if (placed[placed.length - 1].y > bottom) {
        placed[placed.length - 1].y = bottom;
        for (let i = placed.length - 2; i >= 0; i--) {
          placed[i].y = Math.min(placed[i].y, placed[i + 1].y - gapY);
        }
        if (placed[0].y < top) {
          placed[0].y = top;
          for (let i = 1; i < placed.length; i++) {
            placed[i].y = Math.max(placed[i].y, placed[i - 1].y + gapY);
          }
        }
      }
    }

    const out = new Map();
    placed.forEach((item) => out.set(item.index, item.y));
    return out;
  }

  const leftLabelYs  = layoutLabelYs(cT);
  const rightLabelYs = layoutLabelYs(aT);

  const labelPad = Math.max(12, Math.round(fSizeNum * 0.85));
  const targets = [];
  cT.forEach((t, i) => {
    targets.push({
      t,
      x: leftX,
      lx: leftX - labelPad,
      anchor: "end",
      labelY: leftLabelYs.get(i),
      order: targets.length,
    });
  });
  aT.forEach((t, i) => {
    targets.push({
      t,
      x: rightX,
      lx: rightX + barW + labelPad,
      anchor: "start",
      labelY: rightLabelYs.get(i),
      order: targets.length,
    });
  });

  const targetMap = {};
  targets.forEach((entry) => {
    const item = entry.t.item;
    targetMap[item.k] = entry;
  });

  function setSegmentDataset(rect, item) {
    rect.dataset.key = item.k;
    rect.dataset.val = (item.v || 0).toFixed(2);
    if (item.labelText) rect.dataset.label = item.labelText;
    else delete rect.dataset.label;
    if (item.isCustom) rect.dataset.custom = "true";
    else delete rect.dataset.custom;
    if (Number.isFinite(item.concentration)) rect.dataset.concentration = item.concentration.toFixed(2);
    else delete rect.dataset.concentration;
    if (Number.isFinite(item.charge)) rect.dataset.charge = String(item.charge);
    else delete rect.dataset.charge;
    if (item.kind) rect.dataset.kind = item.kind;
    else delete rect.dataset.kind;
  }

  function setTextContent(text, item, lx, anchor) {
    while (text.firstChild) text.removeChild(text.firstChild);
    if (isMobile) {
      const tspanLabel = document.createElementNS(NS, "tspan");
      tspanLabel.setAttribute("x", lx);
      tspanLabel.setAttribute("dy", "0em");
      tspanLabel.textContent = svgLabel(item);

      const tspanValue = document.createElementNS(NS, "tspan");
      tspanValue.setAttribute("x", lx);
      tspanValue.setAttribute("dy", "1.2em");
      tspanValue.classList.add("value");
      const indent = isNaN(fSizeNum) ? 6 : Math.round(fSizeNum * 0.18);
      if (anchor === "end") tspanValue.setAttribute("dx", "-" + indent);
      else tspanValue.setAttribute("dx", "" + indent);
      tspanValue.textContent = item.v.toFixed(2);

      text.appendChild(tspanLabel);
      text.appendChild(tspanValue);
    } else {
      const tspanLabel = document.createElementNS(NS, "tspan");
      tspanLabel.textContent = svgLabel(item);

      const tspanValue = document.createElementNS(NS, "tspan");
      tspanValue.classList.add("value");
      tspanValue.setAttribute("dx", "0.35em");
      tspanValue.textContent = item.v.toFixed(2);

      text.appendChild(tspanLabel);
      text.appendChild(tspanValue);
    }
  }

  function wireRectInteractivity(rect, getCurrentTooltip) {
    if (rect.dataset.bound === "true") return;
    rect.dataset.bound = "true";

    const setActiveRect = (r) => {
      svg.classList.add("focused");
      svg.querySelectorAll("rect.gg-rect.active").forEach((x) => x.classList.remove("active"));
      r.classList.add("active");
    };
    const clearActive = () => {
      svg.classList.remove("focused");
      svg.querySelectorAll("rect.gg-rect.active").forEach((x) => x.classList.remove("active"));
    };

    rect.addEventListener("pointerenter", (e) => {
      if (e.pointerType === "touch") return;
      setActiveRect(rect);
      const handlers = getCurrentTooltip();
      if (handlers && typeof handlers.show === "function") handlers.show(rect, e.clientX, e.clientY);
    });
    rect.addEventListener("pointermove", (e) => {
      if (e.pointerType === "touch") return;
      const handlers = getCurrentTooltip();
      if (handlers && typeof handlers.show === "function") handlers.show(rect, e.clientX, e.clientY);
    });
    rect.addEventListener("pointerleave", (e) => {
      if (e.pointerType === "touch") return;
      const handlers = getCurrentTooltip();
      if (handlers && typeof handlers.hide === "function") handlers.hide();
      if (e.pointerType === "mouse" || e.pointerType === "pen") clearActive();
    });
    rect.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "touch") return;
      const handlers = getCurrentTooltip();
      if (!handlers) return;
      if (rect.classList.contains("active")) {
        if (typeof handlers.hide === "function") handlers.hide();
        clearActive();
      } else {
        setActiveRect(rect);
        if (typeof handlers.show === "function") handlers.show(rect, e.clientX, e.clientY);
      }
    });
    rect.addEventListener("focus", () => {
      setActiveRect(rect);
      const b = rect.getBoundingClientRect();
      const handlers = getCurrentTooltip();
      if (handlers && typeof handlers.show === "function") handlers.show(rect, b.left + 8, b.top);
    });
    rect.addEventListener("blur", () => {
      const handlers = getCurrentTooltip();
      if (handlers && typeof handlers.hide === "function") handlers.hide();
      clearActive();
    });
  }

  const currentTooltip = { show: null, hide: null };
  const getCurrentTooltip = () => currentTooltip;

  const centerFor = (entry) => entry.t.ty + entry.t.th / 2;
  const labelNeedsGuide = (entry) => {
    const labelHeight = fSizeNum * 1.2;
    return Math.abs(entry.labelY - centerFor(entry)) > labelHeight * 0.35;
  };

  function upsertGuides(rec, entry) {
    if (!rec) return;
    const needGuide = labelNeedsGuide(entry);
    const x1 = entry.anchor === "end" ? entry.x : entry.x + barW;
    const y1 = centerFor(entry);
    const textEdge = entry.anchor === "end" ? entry.lx + 6 : entry.lx - 6;
    const x2 = textEdge;
    const y2 = entry.labelY;

    if (!needGuide) {
      if (rec.underlay && rec.underlay.parentNode) rec.underlay.parentNode.removeChild(rec.underlay);
      if (rec.guide && rec.guide.parentNode) rec.guide.parentNode.removeChild(rec.guide);
      rec.underlay = null;
      rec.guide = null;
      return;
    }

    if (!rec.underlay) {
      rec.underlay = document.createElementNS(NS, "line");
      rec.underlay.setAttribute("stroke-width", "4.2");
      rec.underlay.setAttribute("stroke-linecap", "round");
      rec.group.insertBefore(rec.underlay, rec.rect);
    }
    if (!rec.guide) {
      rec.guide = document.createElementNS(NS, "line");
      rec.guide.setAttribute("stroke-width", "2.2");
      rec.guide.setAttribute("stroke-linecap", "round");
      rec.group.insertBefore(rec.guide, rec.rect);
    }

    rec.underlay.setAttribute("x1", x1);
    rec.underlay.setAttribute("y1", y1);
    rec.underlay.setAttribute("x2", x2);
    rec.underlay.setAttribute("y2", y2);
    rec.underlay.setAttribute("stroke", guideUnderlay);
    rec.underlay.setAttribute("opacity", "0.9");

    rec.guide.setAttribute("x1", x1);
    rec.guide.setAttribute("y1", y1);
    rec.guide.setAttribute("x2", x2);
    rec.guide.setAttribute("y2", y2);
    rec.guide.setAttribute("stroke", guideColor);
    rec.guide.setAttribute("opacity", "0.96");
  }

  function createSegmentRecord(entry) {
    const item = entry.t.item;
    const group = document.createElementNS(NS, "g");
    group.setAttribute("class", "gg-seg");
    group.dataset.key = item.k;

    const rect = document.createElementNS(NS, "rect");
    rect.setAttribute("class", "gg-rect");
    rect.setAttribute("x", entry.x);
    rect.setAttribute("y", baseY - 8);
    rect.setAttribute("width", barW);
    rect.setAttribute("height", 8);
    rect.setAttribute("rx", 8);
    rect.setAttribute("fill", item.c);
    rect.setAttribute("opacity", "0.95");
    rect.setAttribute("tabindex", "0");
    setSegmentDataset(rect, item);

    const text = document.createElementNS(NS, "text");
    text.classList.add("gg-name");
    text.setAttribute("x", entry.lx);
    text.setAttribute("y", entry.labelY);
    text.setAttribute("dominant-baseline", "middle");
    text.setAttribute("text-anchor", entry.anchor);
    text.setAttribute("font-size", fSizeNum + "px");
    setTextContent(text, item, entry.lx, entry.anchor);

    group.appendChild(rect);
    group.appendChild(text);
    segLayer.appendChild(group);

    const rec = {
      group,
      rect,
      text,
      underlay: null,
      guide: null,
    };
    upsertGuides(rec, entry);
    wireRectInteractivity(rect, getCurrentTooltip);
    return rec;
  }

  const existingKeys = Object.keys(ggState.groupsByKey);
  const targetKeys = Object.keys(targetMap);
  const toRemove = existingKeys.filter((k) => !targetMap[k]);

  // Remove stale keys from selection state.
  toRemove.forEach((k) => {
    const rec = ggState.groupsByKey[k];
    if (rec && rec.rect && rec.rect.classList.contains("active")) {
      rec.rect.classList.remove("active");
    }
  });

  // Update or create target nodes.
  targets.forEach((entry) => {
    const item = entry.t.item;
    let rec = ggState.groupsByKey[item.k];
    const centerY = centerFor(entry);
    const targetY = entry.t.ty;
    const targetH = entry.t.th;

    if (!rec) {
      rec = createSegmentRecord(entry);
      ggState.groupsByKey[item.k] = rec;
    }

    rec.group.dataset.key = item.k;
    rec.rect.setAttribute("x", entry.x);
    rec.rect.setAttribute("width", barW);
    rec.rect.setAttribute("fill", item.c);
    setSegmentDataset(rec.rect, item);

    rec.text.setAttribute("x", entry.lx);
    rec.text.setAttribute("text-anchor", entry.anchor);
    rec.text.setAttribute("font-size", fSizeNum + "px");
    setTextContent(rec.text, item, entry.lx, entry.anchor);

    upsertGuides(rec, entry);

    const sY = parseFloat(rec.rect.getAttribute("y"));
    const sH = parseFloat(rec.rect.getAttribute("height"));
    const startY = Number.isFinite(sY) ? sY : (baseY - 8);
    const startH = Number.isFinite(sH) ? Math.max(4, sH) : 8;
    const textY = parseFloat(rec.text.getAttribute("y"));
    const startTextY = Number.isFinite(textY) ? textY : centerY;

    anim.push({
      rect: rec.rect,
      text: rec.text,
      sY: startY,
      sH: startH,
      ty: targetY,
      th: targetH,
      sTextY: startTextY,
      tTextY: entry.labelY,
    });
  });

  // Animate removed segments out, then prune.
  toRemove.forEach((k) => {
    const rec = ggState.groupsByKey[k];
    if (!rec || !rec.rect || !rec.text) {
      delete ggState.groupsByKey[k];
      return;
    }
    const sY = parseFloat(rec.rect.getAttribute("y"));
    const sH = parseFloat(rec.rect.getAttribute("height"));
    const textY = parseFloat(rec.text.getAttribute("y"));
    anim.push({
      rect: rec.rect,
      text: rec.text,
      sY: Number.isFinite(sY) ? sY : baseY - 8,
      sH: Number.isFinite(sH) ? Math.max(4, sH) : 8,
      ty: baseY - 1,
      th: 1,
      sTextY: Number.isFinite(textY) ? textY : baseY,
      tTextY: baseY,
      removeAfter: rec,
      key: k,
    });
  });

  // Keep stack draw order deterministic.
  targets.sort((a, b) => a.order - b.order).forEach((entry) => {
    const rec = ggState.groupsByKey[entry.t.item.k];
    if (rec && rec.group) segLayer.appendChild(rec.group);
  });

  /* ── "Unknown" label under chart ── */
  if (sig >  0.0001)      unknownEl.textContent = "Unknown anions: "  + sig.toFixed(1)           + " mEq/L";
  else if (sig < -0.0001) unknownEl.textContent = "Unknown cations: " + Math.abs(sig).toFixed(1) + " mEq/L";
  else                    unknownEl.textContent = "Unknown: none";

  /* ── Legend ── */
  const seen  = new Set();
  const items = anions.concat(cations).filter((x) => {
    if (seen.has(x.k)) return false;
    seen.add(x.k); return true;
  });
  legend.innerHTML = "";
  items.forEach((it) => {
    const itemEl = document.createElement("div");
    itemEl.className = "item";

    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = it.c;

    const text = document.createElement("span");
    text.innerHTML = htmlLabel(it) + " \u2014 " + it.v.toFixed(2) + " mEq/L";

    itemEl.appendChild(swatch);
    itemEl.appendChild(text);
    legend.appendChild(itemEl);
  });

  /* ── Wire up shared touch/outside handlers once ── */
  const tooltip = document.getElementById("gg-tooltip");
  if (tooltip && !ggState.touchBound) {
    ggState.touchBound = true;
    svg.addEventListener("touchstart", (e) => {
      const t   = e.changedTouches[0];
      const hit = document.elementFromPoint(t.clientX, t.clientY);
      const rect = hit && (hit.closest
        ? hit.closest("rect.gg-rect")
        : (hit.classList && hit.classList.contains("gg-rect") ? hit : null));
      if (!rect) return;
      e.preventDefault();
      if (rect.classList.contains("active")) {
        hideTT();
        svg.classList.remove("focused");
        svg.querySelectorAll("rect.gg-rect.active").forEach((x) => x.classList.remove("active"));
      } else {
        svg.classList.add("focused");
        svg.querySelectorAll("rect.gg-rect.active").forEach((x) => x.classList.remove("active"));
        rect.classList.add("active");
        showTT(rect, t.clientX, t.clientY);
      }
    }, { passive: false });
  }
  if (!ggState.outsidePointerBound) {
    ggState.outsidePointerBound = true;
    document.addEventListener("pointerdown", (ev) => {
      if (!svg.contains(ev.target)) {
        hideTT();
        svg.classList.remove("focused");
        svg.querySelectorAll("rect.gg-rect.active").forEach((x) => x.classList.remove("active"));
      }
    });
  }

  /* ── EaseOutCubic bar animation ── */
  const DUR  = 360;
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  if (window._ggAF) cancelAnimationFrame(window._ggAF);
  const t0 = performance.now();

  function tick(now) {
    const p = Math.min(1, (now - t0) / DUR);
    const e = ease(p);
    anim.forEach((a) => {
      const cy = a.sY + (a.ty - a.sY) * e;
      const ch = a.sH + (a.th - a.sH) * e;
      a.rect.setAttribute("y",      cy);
      a.rect.setAttribute("height", Math.max(1, ch));
      a.text.setAttribute("y",      a.sTextY + (a.tTextY - a.sTextY) * e);
    });
    if (p < 1) {
      window._ggAF = requestAnimationFrame(tick);
    } else {
      anim.forEach((a) => {
        if (!a.removeAfter) return;
        const rec = a.removeAfter;
        if (rec.group && rec.group.parentNode) rec.group.parentNode.removeChild(rec.group);
        if (a.key) delete ggState.groupsByKey[a.key];
      });
      window._ggAF = null;
    }
  }
  window._ggAF = requestAnimationFrame(tick);

  /* ── Tooltip show / hide (closures over `tooltip` & helpers) ── */

  function showTT(rect, cx, cy) {
    if (!tooltip) return;
    const key = rect.dataset.key;
    const val = parseFloat(rect.dataset.val) || 0;
    const label = rect.dataset.label
      ? escapeHTML(rect.dataset.label)
      : htmlLabel(key);

    // Show the original entered unit if it differs from SI
    const ID_MAP = { Na: "na", K: "k", iCa: "ica", Mg: "mg", Cl: "cl", Lactate: "lac", Phos: "phos" };
    const mid    = ID_MAP[key];
    let extra    = "";
    if (mid) {
      const uel = document.getElementById(mid + "-unit");
      const raw = parse(mid);
      const u = uel && uel.value === "mgdl" ? "mg/dL" : "mmol/L";
      if (key === "Mg" && Number.isFinite(raw)) {
        extra = '<div style="margin-top:4px;color:var(--muted)">'
              + "Total Mg entered: " + raw.toFixed(2) + " " + u + "</div>";
      } else if (uel && uel.value !== "si" && Number.isFinite(raw)) {
        extra = '<div style="margin-top:4px;color:var(--muted)">'
              + raw.toFixed(2) + " " + u + " (entered)</div>";
      }
    }
    if (rect.dataset.custom === "true") {
      const concentration = rect.dataset.concentration || "0.00";
      const charge = rect.dataset.charge || "1";
      const kind = rect.dataset.kind || "anion";
      extra = '<div style="margin-top:4px;color:var(--muted)">'
            + concentration + " mmol/L × " + charge + " charge"
            + (charge === "1" ? "" : "s")
            + " (" + escapeHTML(kind) + ")</div>";
    }

    const ns = toNonSI(key, val);
    const showNon = document.getElementById("show-non-si") &&
                    document.getElementById("show-non-si").checked;
    const nsLine = (ns && showNon)
      ? '<div style="color:var(--muted);margin-top:4px">\u2248 ' + ns +
        (key === "Mg" ? " estimated ionized" : "") + "</div>"
      : "";

    tooltip.innerHTML =
      "<strong>" + label + "</strong>" +
      '<div style="font-weight:700;margin-top:4px">' +
      val.toFixed(2) + " mEq/L</div>" + extra + nsLine;

    const cr = document.querySelector(".container").getBoundingClientRect();
    tooltip.style.left = Math.max(40, Math.min(cx - cr.left, cr.width - 40)) + "px";
    tooltip.style.top  = (cy - cr.top - 10) + "px";
    tooltip.classList.add("visible");
    tooltip.setAttribute("aria-hidden", "false");
  }

  function hideTT() {
    if (!tooltip) return;
    tooltip.classList.remove("visible");
    tooltip.setAttribute("aria-hidden", "true");
  }

  currentTooltip.show = showTT;
  currentTooltip.hide = hideTT;
}
