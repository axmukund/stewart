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

  /* ── Snapshot previous bar positions for smooth animation ── */
  const prevRects = {};
  svg.querySelectorAll("rect.gg-rect").forEach((r) => {
    const k = r.dataset.key;
    if (k) prevRects[k] = {
      y: parseFloat(r.getAttribute("y")) || 0,
      h: parseFloat(r.getAttribute("height")) || 0,
    };
  });

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
  const fSize = isMobile
    ? Math.max(12, Math.min(Math.round(legendFontPx * (W / 330)), 16))
    : Math.max(legendFontPx, Math.min(Math.round(legendFontPx * (W / 560)), 19));
  const fSizeNum = fSize;
  const baseY  = padTop + H;

  const sum      = (a) => a.reduce((s, x) => s + (x.v || 0), 0);
  const totalC   = sum(cations);
  const totalA   = sum(anions);
  const maxStack = Math.max(totalC, totalA, 1);

  /* ── Reset SVG (preserve <title> / <desc> for accessibility) ── */
  const titleTag = svg.querySelector("title");
  const descTag  = svg.querySelector("desc");
  svg.innerHTML =
    (titleTag ? titleTag.outerHTML : "") +
    (descTag  ? descTag.outerHTML  : "");
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
    const labelHeight = fSizeNum * 1.2;
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

  function addSeg(t, x, lx, anchor, labelY) {
    const item = t.item;
    const prev = prevRects[item.k];
    const sH   = prev ? Math.max(4, prev.h) : 8;
    const sY   = prev ? prev.y : baseY - sH;
    const centerY = t.ty + t.th / 2;
    const startTextY = sY + sH / 2;

    const rect = document.createElementNS(NS, "rect");
    rect.setAttribute("class", "gg-rect");
    rect.setAttribute("x",      x);
    rect.setAttribute("y",      sY);
    rect.setAttribute("width",  barW);
    rect.setAttribute("height", sH);
    rect.setAttribute("rx",     8);
    rect.setAttribute("fill",   item.c);
    rect.setAttribute("opacity","0.95");
    rect.setAttribute("tabindex","0");
    rect.dataset.key = item.k;
    rect.dataset.val = (item.v || 0).toFixed(2);
    if (item.labelText) rect.dataset.label = item.labelText;
    if (item.isCustom) rect.dataset.custom = "true";
    if (Number.isFinite(item.concentration)) rect.dataset.concentration = item.concentration.toFixed(2);
    if (Number.isFinite(item.charge)) rect.dataset.charge = String(item.charge);
    if (item.kind) rect.dataset.kind = item.kind;
    svg.appendChild(rect);

    const labelHeight = fSizeNum * 1.2; // estimate text height
    if (Math.abs(labelY - centerY) > labelHeight * 0.35) {
      const textEdge = anchor === "end" ? lx + 6 : lx - 6;
      const x1 = anchor === "end" ? x : x + barW;
      const y1 = centerY;
      const x2 = textEdge;
      const y2 = labelY;

      const underlay = document.createElementNS(NS, "line");
      underlay.setAttribute("x1", x1);
      underlay.setAttribute("y1", y1);
      underlay.setAttribute("x2", x2);
      underlay.setAttribute("y2", y2);
      underlay.setAttribute("stroke", guideUnderlay);
      underlay.setAttribute("stroke-width", "4.2");
      underlay.setAttribute("stroke-linecap", "round");
      underlay.setAttribute("opacity", "0.9");
      svg.appendChild(underlay);

      const guide = document.createElementNS(NS, "line");
      guide.setAttribute("x1", x1);
      guide.setAttribute("y1", y1);
      guide.setAttribute("x2", x2);
      guide.setAttribute("y2", y2);
      guide.setAttribute("stroke", guideColor);
      guide.setAttribute("stroke-width", "2.2");
      guide.setAttribute("stroke-linecap", "round");
      guide.setAttribute("opacity", "0.96");
      svg.appendChild(guide);
    }

    const text = document.createElementNS(NS, "text");
    text.classList.add("gg-name");
    text.setAttribute("x",                lx);
    text.setAttribute("y",                labelY);
    text.setAttribute("dominant-baseline","middle");
    text.setAttribute("text-anchor",      anchor);
    text.setAttribute("font-size",        fSize);
    text.textContent = svgLabel(item) + " " + item.v.toFixed(2);
    svg.appendChild(text);

    anim.push({
      rect, text,
      sY, sH,
      ty: t.ty, th: t.th,
      sTextY: startTextY,
      tTextY: labelY,
    });
  }

  const labelPad = Math.max(12, Math.round(fSize * 0.85));
  cT.forEach((t, i) => addSeg(t, leftX,  leftX - labelPad,         "end",   leftLabelYs.get(i)));
  aT.forEach((t, i) => addSeg(t, rightX, rightX + barW + labelPad, "start", rightLabelYs.get(i)));

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

  /* ── Wire up tooltip / selection events (pointer + keyboard + touch) ── */
  const tooltip = document.getElementById("gg-tooltip");
  if (tooltip) {
    // helpers to mark/unmark the active rect and to clear focused state
    const setActiveRect = (r) => {
      svg.classList.add("focused");
      svg.querySelectorAll("rect.gg-rect.active").forEach((x) => x.classList.remove("active"));
      r.classList.add("active");
    };
    const clearActive = () => {
      svg.classList.remove("focused");
      svg.querySelectorAll("rect.gg-rect.active").forEach((x) => x.classList.remove("active"));
    };

    svg.querySelectorAll("rect.gg-rect").forEach((rect) => {
      // pointerenter / pointermove work for mouse & pen
      rect.addEventListener("pointerenter", (e) => {
        if (e.pointerType === "touch") return; // handled by touchstart below
        setActiveRect(rect);
        showTT(rect, e.clientX, e.clientY);
      });
      rect.addEventListener("pointermove", (e) => {
        if (e.pointerType !== "touch") showTT(rect, e.clientX, e.clientY);
      });

      // on leaving with a mouse pointer, hide + clear selection
      rect.addEventListener("pointerleave", (e) => {
        if (e.pointerType === "touch") return;
        hideTT();
        if (e.pointerType === "mouse" || e.pointerType === "pen") clearActive();
      });

      // mouse/pen click
      rect.addEventListener("pointerdown", (e) => {
        if (e.pointerType === "touch") return; // handled below
        if (rect.classList.contains("active")) {
          hideTT(); clearActive();
        } else {
          setActiveRect(rect);
          showTT(rect, e.clientX, e.clientY);
        }
      });

      // keyboard navigation
      rect.addEventListener("focus", () => {
        setActiveRect(rect);
        const b = rect.getBoundingClientRect();
        showTT(rect, b.left + 8, b.top);
      });
      rect.addEventListener("blur", () => { hideTT(); clearActive(); });
    });

    // ── Single SVG-level touch handler for reliable mobile tap ──
    // Using touchstart (passive:false so we can preventDefault to
    // stop scroll steal) + elementFromPoint to locate the target rect.
    svg.addEventListener("touchstart", (e) => {
      const t   = e.changedTouches[0];
      const hit = document.elementFromPoint(t.clientX, t.clientY);
      const rect = hit && (hit.closest
        ? hit.closest("rect.gg-rect")
        : (hit.classList && hit.classList.contains("gg-rect") ? hit : null));
      if (!rect) return;
      e.preventDefault(); // prevent scroll steal only when over a segment
      if (rect.classList.contains("active")) {
        hideTT(); clearActive();
      } else {
        setActiveRect(rect);
        showTT(rect, t.clientX, t.clientY);
      }
    }, { passive: false });

    // Remove the old SVG-level pointerdown delegation (replaced by touchstart above)

    // clicking / tapping outside the SVG clears any active selection
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
    if (p < 1) window._ggAF = requestAnimationFrame(tick);
    else       window._ggAF = null;
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
}
