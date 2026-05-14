/**
 * pickers.js — Native <select> picker population and defaults.
 *
 * Each ion input uses a `<select class="picker">` instead of a
 * numeric slider.  This file defines the picker ranges, step sizes,
 * clinical defaults, and the logic to populate / repopulate picker
 * options (e.g. when units change from mmol/L → mg/dL).
 *
 * Depends on: helpers.js (el, parse), units.js (displayToSI, siToDisplay)
 */

"use strict";

/* ─────────────────────────────────────────────────────────────────────
 *  Picker range configuration
 * ───────────────────────────────────────────────────────────────────── */

const PICKER_CONFIG = [
  { id: "na",   min: 110,  max: 160,   step: 1,    decimals: 0 },
  { id: "k",    min: 0.0,  max: 10.0,  step: 0.1,  decimals: 1 },
  { id: "ica",  min: 0.00, max: 2.00,  step: 0.01, decimals: 2 },
  { id: "mg",   min: 0.00, max: 10.00, step: 0.01, decimals: 2 },
  { id: "cl",   min: 60,   max: 150,   step: 1,    decimals: 0 },
  { id: "lac",  min: 0.0,  max: 30.0,  step: 0.1,  decimals: 1 },
  { id: "alb",  min: 0.0,  max: 6.0,   step: 0.1,  decimals: 1 },
  // Phosphate: configured in SI (mmol/L) but default display is mg/dL
  // Display range requested: 0.0–15.0 mg/dL, step 0.1 → convert to mmol/L
  { id: "phos", min: 0.00, max: 4.85,  step: 0.0323, decimals: 1 },
  { id: "ph",   min: 6.80, max: 8.00,  step: 0.01, decimals: 2 },
  { id: "pco2", min: 0,    max: 200,   step: 1,    decimals: 0 },
  { id: "hco3", min: 0.0,  max: 100.0, step: 0.1,  decimals: 1 },
];

/* ─────────────────────────────────────────────────────────────────────
 *  Clinically typical defaults (SI units)
 *
 *  All values are mmol/L except albumin which is g/dL.
 *  Mg input is total serum magnesium; ionized Mg is estimated later
 *  for the SID / Gamblegram calculation.
 * ───────────────────────────────────────────────────────────────────── */

const PICKER_DEFAULTS_SI = {
  na:   140.0,
  k:    4.0,
  ica:  1.20,
  mg:   0.75,    // total serum Mg ≈ 1.82 mg/dL (normal-range default)
  cl:   104.0,
  lac:  1.0,
  alb:  4.2,     // g/dL
  phos: 1.0,
  ph:   7.40,
  pco2: 40.0,
  hco3: 24.0,
};

/* ─────────────────────────────────────────────────────────────────────
 *  populatePicker()
 * ───────────────────────────────────────────────────────────────────── */

/**
 * Build or rebuild the `<option>` list for one ion picker.
 *
 * On first call the picker is empty (`sel.value === ""`), so NaN
 * is detected and the clinical default from `PICKER_DEFAULTS_SI` is
 * used.  On subsequent calls (e.g. after a unit-selector change) the
 * current SI value is preserved and re-displayed in the new unit.
 *
 * @param {Object} cfg  One entry from `PICKER_CONFIG`.
 */
function populatePicker(cfg, prevUnit) {
  const sel = document.getElementById(cfg.id + "-picker");
  const num = el(cfg.id) || sel; // fall back to picker if numeric input is absent
  if (!sel) return;

  // Snapshot current display-value BEFORE clearing so we can restore
  // it on unit-change repopulation.
  const unitEl   = document.getElementById(cfg.id + "-unit");
  const unit     = unitEl ? unitEl.value : "si";
  // Determine which unit the previous displayed value was in. If the caller
  // provided a `prevUnit` (captured before the unit-select changed), use it;
  // otherwise fall back to any stored dataset.prev on the unit element or
  // assume the current unit.
  const prevUnitUsed = prevUnit || (unitEl && unitEl.dataset && unitEl.dataset.prev) || unit;
  const prevDisp = parseFloat(sel.value);
  const prevSI   = Number.isFinite(prevDisp)
    ? displayToSI(cfg.id, prevDisp, prevUnitUsed) : NaN;

  // Use the preserved SI value if available, otherwise fall back to
  // the clinical default.
  const targetSI = Number.isFinite(prevSI) ? prevSI : PICKER_DEFAULTS_SI[cfg.id];

  // Rebuild <option> list.
  // When converting between units, many adjacent SI-steps can round
  // to the same displayed label (e.g. fine SI step → mg/dL 1-decimal).
  // Group SI values by their rounded display label and create one
  // option per unique label using the mean SI representative so that
  // switching units doesn't produce long duplicate lists.
  sel.innerHTML = "";
  const steps = Math.round((cfg.max - cfg.min) / cfg.step);
  const groups = new Map(); // label -> {sumSI, count, minSI, maxSI}
  for (let i = 0; i <= steps; i++) {
    const vSI = cfg.min + i * cfg.step;
    const displayV = (unit === "si") ? vSI : siToDisplay(cfg.id, vSI, unit);
    const label = Number(displayV).toFixed(cfg.decimals);
    if (!groups.has(label)) {
      groups.set(label, { sumSI: vSI, count: 1, minSI: vSI, maxSI: vSI });
    } else {
      const g = groups.get(label);
      g.sumSI += vSI;
      g.count += 1;
      if (vSI < g.minSI) g.minSI = vSI;
      if (vSI > g.maxSI) g.maxSI = vSI;
    }
  }

  // Sort labels by their mean SI value to preserve numeric order
  const entries = Array.from(groups.entries()).map(([label, g]) => ({
    label,
    meanSI: g.sumSI / g.count,
    minSI: g.minSI,
    maxSI: g.maxSI,
  }));
  entries.sort((a, b) => a.meanSI - b.meanSI);

  for (const e of entries) {
    const opt = document.createElement("option");
    opt.value = e.label;
    opt.textContent = e.label;
    // store mean SI for potential use elsewhere (data attr)
    opt.dataset.meanSi = String(e.meanSI);
    sel.appendChild(opt);
  }

  // Apply target value; append an extra <option> if it falls outside
  // the configured range.
  if (targetSI !== undefined && Number.isFinite(targetSI)) {
    const displayTarget = (unit === "si") ? targetSI : siToDisplay(cfg.id, targetSI, unit);
    const want = Number(displayTarget).toFixed(cfg.decimals);
    if (!Array.from(sel.options).some((o) => o.value === want)) {
      const extra       = document.createElement("option");
      extra.value       = want;
      extra.textContent = want;
      sel.appendChild(extra);
    }
    sel.value = want;
    if (num && num !== sel) num.value = want;
  }

  // Remember the unit we populated for future conversions
  if (unitEl) unitEl.dataset.prev = unit;

  // Keep picker ↔ numeric input in sync
  sel.addEventListener("change", (e) => {
    if (num !== sel) num.value = e.target.value;
    computeAll();
  });

  num.addEventListener("input", () => {
    const v = parseFloat(num.value);
    if (!Number.isFinite(v)) return;
    const s = v.toFixed(cfg.decimals);
    if (!Array.from(sel.options).some((o) => o.value === s)) {
      const extra       = document.createElement("option");
      extra.value       = s;
      extra.textContent = s;
      sel.appendChild(extra);
    }
    sel.value = s;
  });
}
