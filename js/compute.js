/**
 * compute.js — Main calculation loop (Stewart core).
 *
 * `computeAll()` is the single entry-point called on every input
 * change.  It reads all inputs, runs the Stewart acid-base
 * calculations, writes the results panel and mobile header, and
 * delegates visualisation to `renderGamblegram()`.
 *
 * Depends on: helpers.js, units.js, physiology.js, gamblegram.js
 */

"use strict";

const RESULT_RANGES = {
  "res-side": { min: 35, max: 40 },
  "res-sida": { min: 37, max: 43 },
  "res-sig": { min: 0, max: 6 },
  "res-ag": { min: 12, max: 20 },
};

const MOBILE_RESULT_MAP = {
  "res-side": "mh-side",
  "res-sida": "mh-sida",
  "res-sig": "mh-sig",
};

function setRangeState(resultId, value) {
  const range = RESULT_RANGES[resultId];
  const valueEl = el(resultId);
  const labelEl = document.querySelector('dt[data-result-for="' + resultId + '"]');
  const mobileEl = MOBILE_RESULT_MAP[resultId] ? el(MOBILE_RESULT_MAP[resultId]) : null;
  const inRange = !range || !Number.isFinite(value)
    ? true
    : value >= range.min && value <= range.max;

  if (valueEl) valueEl.classList.toggle("out-of-range", !inRange);
  if (labelEl) labelEl.classList.toggle("out-of-range", !inRange);
  if (mobileEl) mobileEl.classList.toggle("out-of-range", !inRange);
}

/**
 * Read every input, run the Stewart calculations, update the results
 * panel / mobile-header summary, and re-render the Gamblegram.
 *
 * Called on every input change (debounced via events.js), on reset,
 * and on window resize.
 */
function computeAll() {

  /* ── Read inputs (all converted to mmol/L) ── */
  const Na   = getIonSI("na");
  const K    = getIonSI("k");
  const iCa  = getIonSI("ica");
  const MgTotal = getIonSI("mg");
  const Cl   = getIonSI("cl");
  const Lac  = getIonSI("lac");
  const Alb  = parse("alb");           // albumin — g/dL
  const Phos = getIonSI("phos");
  const pH   = parse("ph");
  const pCO2 = parse("pco2");
  const iMg  = ionizedMagnesiumFromTotal(MgTotal);
  const extraIons = typeof getAdditionalIonSegments === "function"
    ? getAdditionalIonSegments()
    : { cations: [], anions: [], totalCations: 0, totalAnions: 0 };

  /* ── HCO₃ handling ──
   *    By default HCO₃ is derived from the blood-gas (Henderson–
   *    Hasselbalch).  If the user checks "use BMP HCO₃" the field
   *    becomes editable and that value is used instead.            */
  const hco3FromGas =
    Number.isFinite(pH) && Number.isFinite(pCO2)
      ? hco3FromPHandPco2(pH, pCO2) : NaN;

  const hco3El = el("hco3");
  const hco3PickerEl = el("hco3-picker");
  const useBmpRequested =
    document.getElementById("use-bmp-hco3") &&
    document.getElementById("use-bmp-hco3").checked;
  const fixedSig =
    document.getElementById("fix-sig") &&
    document.getElementById("fix-sig").checked;
  const sigTargetEl = el("sig-target");
  const useBmp = useBmpRequested && !fixedSig;
  const bmpHCO3 = hco3PickerEl ? parseFloat(hco3PickerEl.value) : NaN;
  const manualHCO3 = hco3El ? parseFloat(hco3El.value) : NaN;
  let HCO3 =
    (useBmp && Number.isFinite(bmpHCO3)) ? bmpHCO3
    : Number.isFinite(hco3FromGas)       ? hco3FromGas
    :                                      manualHCO3;

  /* ── Stewart core (all in mEq/L — divalent cations carry 2× charge) ── */
  const sidA =
    (Na || 0) + (K || 0) + 2 * (iCa || 0) + 2 * (iMg || 0)
    - (Cl || 0) - (Lac || 0)
    + extraIons.totalCations - extraIons.totalAnions;

  // Albumin: g/dL → g/L for the Figge model
  const Alb_gL   = Number.isFinite(Alb) ? Alb * 10 : NaN;
  const albMinus = Number.isFinite(Alb_gL) && Number.isFinite(pH)
    ? albuminCharge(Alb_gL, pH) : 0;
  const piMinus  = Number.isFinite(Phos) && Number.isFinite(pH)
    ? phosphateCharge(Phos, pH) : 0;

  const baselineSidE = (HCO3 || 0) + albMinus + piMinus;
  const baselineSig = sidA - baselineSidE;
  let sigTarget = sigTargetEl ? parseFloat(sigTargetEl.value) : NaN;
  if (fixedSig && !Number.isFinite(sigTarget)) {
    sigTarget = baselineSig;
    if (sigTargetEl) sigTargetEl.value = sigTarget.toFixed(1);
  }
  if (fixedSig) {
    HCO3 = sidA - (sigTarget || 0) - albMinus - piMinus;
  }

  if (hco3El) {
    hco3El.disabled = true;
    if (fixedSig) {
      hco3El.value = Number.isFinite(HCO3) ? HCO3.toFixed(2) : "";
    } else if (useBmp) {
      hco3El.value = "";
    } else {
      hco3El.value = Number.isFinite(hco3FromGas)
        ? hco3FromGas.toFixed(2)
        : (Number.isFinite(HCO3) ? HCO3.toFixed(2) : "");
    }
  }

  const sidE = (HCO3 || 0) + albMinus + piMinus;
  const sig  = sidA - sidE;
  const ag   = (Na || 0) + (K || 0) - ((Cl || 0) + (HCO3 || 0));

  window.__lastCalculatedSig = sig;
  window.__lastCalculatedHCO3 = HCO3;

  // Round to one decimal for display
  const sidAR = Math.round(sidA * 10) / 10;
  const sidER = Math.round(sidE * 10) / 10;
  const sigR  = Math.round(sig  * 10) / 10;

  /* ── Write results panel ── */
  el("res-sida").textContent = sidAR.toFixed(1) + " mEq/L";
  el("res-side").textContent = sidER.toFixed(1) + " mEq/L";
  el("res-sig").textContent  = sigR.toFixed(1)  + " mEq/L";
  el("res-ag").textContent   = ag.toFixed(2)    + " mEq/L";
  setRangeState("res-sida", sidA);
  setRangeState("res-side", sidE);
  setRangeState("res-sig", sig);
  setRangeState("res-ag", ag);

  /* ── Mobile header ── */
  const mhSida = el("mh-sida");
  const mhSide = el("mh-side");
  const mhSig  = el("mh-sig");
  if (mhSida) mhSida.textContent = sidAR.toFixed(1) + " mEq/L";
  if (mhSide) mhSide.textContent = sidER.toFixed(1) + " mEq/L";
  if (mhSig)  mhSig.textContent  = sigR.toFixed(1)  + " mEq/L";

  /* ── Extra result rows (if present) ── */
  const albEl  = el("res-alb");
  const piEl   = el("res-pi");
  const atotEl = el("res-atot");
  if (albEl)  albEl.textContent  = albMinus.toFixed(3) + " mEq/L (Alb⁻)";
  if (piEl)   piEl.textContent   = piMinus.toFixed(3)  + " mEq/L (Phos⁻)";
  if (atotEl) atotEl.textContent =
    ((0.123 * (Number.isFinite(Alb_gL) ? Alb_gL : 0)) +
     (0.309 * (Phos || 0))).toFixed(3) + " mmol/L (Atot)";

  /* ── Gamblegram HCO₃ choice ── */
  const ggHCO3 =
    fixedSig                            ? (HCO3 || 0)
    : (useBmp && Number.isFinite(bmpHCO3)) ? bmpHCO3
    : Number.isFinite(hco3FromGas)         ? hco3FromGas
    :                                        (HCO3 || 0);

  /* ── Render Gamblegram (values in mEq/L = charge equivalents) ── */
  renderGamblegram({
    Na, K,
    iCa: 2 * (iCa || 0),                            // divalent → 2 mEq/mmol
    Mg_mmol: 2 * (Number.isFinite(iMg) ? iMg : 0),  // estimated ionized Mg → charge eq
    Cl, Lac,
    HCO3: ggHCO3,
    albMinus, piMinus,
    sig: sigR,
    extraCations: extraIons.cations,
    extraAnions: extraIons.anions,
  });
}
