/**
 * physiology.js — Pure physiology / chemistry calculation functions.
 *
 * No DOM access — these are pure functions of their numeric arguments.
 *
 * Contents:
 *   1. hco3FromPHandPco2()  — Henderson–Hasselbalch
 *   2. ionizedMagnesiumFromTotal() — Estimate iMg from total Mg
 *   3. albuminCharge()      — Full Figge–Fencl v3.0 multi-proton albumin model
 *   4. phosphateCharge()    — Triprotic phosphate equilibrium
 *
 * References:
 *   [1] Figge J, Mydosh T, Fencl V. "Serum proteins and acid-base
 *       equilibria: a follow-up." J Lab Clin Med. 1992;120(5):713-719.
 *   [2] Figge J. figge-fencl.org model v3.0 (2003–2013), archived at
 *       web.archive.org/web/20160327122156/http://figge-fencl.org/model.html
 *   [3] Sendroy J Jr, Hastings AB. "Studies of the solubility of
 *       calcium salts. III." J Biol Chem. 1927;71:797-823.
 *       (Phosphoric acid apparent dissociation constants for plasma, 37 °C)
 *   [4] Henderson–Hasselbalch equation; pKa(CO₂/HCO₃⁻) = 6.1,
 *       CO₂ solubility coefficient α = 0.0307 mmol/L/mmHg at 37 °C.
 *   [5] PubMed 12416286. Adult serum total ↔ ionized magnesium
 *       correlation used here as a pragmatic estimate because iMg
 *       is not routinely measured on standard chemistry panels.
 *   [6] IFCC guideline (PubMed 15899681): iMg binding in plasma is
 *       pH-dependent and should be interpreted alongside pH.
 *   [7] Wang et al. (PubMed 12171493): iMg changes by roughly
 *       0.12 mmol/L per pH unit across the tested range.
 */

"use strict";

const IMG_PH_REFERENCE = 7.40;
const IMG_PH_SLOPE = 0.12;

const MG_COMPLEXING_NAME_RULES = [
  { pattern: /\bcitrate\b/i, label: "citrate", thresholds: [0.5, 1.0], points: [1, 2] },
  { pattern: /\boxalate\b|\bedta\b/i, label: "oxalate/EDTA", thresholds: [0.25, 0.5], points: [1, 2] },
  { pattern: /\bsulfate\b|\bsulphate\b/i, label: "sulfate", thresholds: [1.0, 3.0], points: [1, 2] },
  { pattern: /\bacetate\b/i, label: "acetate", thresholds: [3.0], points: [1] },
  { pattern: /\bketones?\b|\bbeta[- ]?hydroxybut(?:yrate)?\b|\bacetoacet(?:ate|ic)\b/i, label: "ketones", thresholds: [3.0], points: [1] },
];

/* ─────────────────────────────────────────────────────────────────────
 *  Henderson–Hasselbalch
 * ───────────────────────────────────────────────────────────────────── */

/**
 * Derive [HCO₃⁻] from pH and pCO₂ via the Henderson–Hasselbalch
 * equation.
 *
 *   [HCO₃⁻] = α · pCO₂ · 10^(pH − pKa)
 *
 * where α = 0.03 mmol/L/mmHg and pKa = 6.1 at 37 °C.
 *
 * @param {number} pH   Arterial pH
 * @param {number} pCO2 Arterial pCO₂ in mmHg
 * @returns {number}    [HCO₃⁻] in mmol/L
 */
function hco3FromPHandPco2(pH, pCO2) {
  return 0.03 * pCO2 * Math.pow(10, pH - 6.1);
}

/* ─────────────────────────────────────────────────────────────────────
 *  Estimated ionized magnesium
 * ───────────────────────────────────────────────────────────────────── */

/**
 * Estimate ionized magnesium from total serum magnesium.
 *
 * Most chemistry panels report total Mg rather than ionized Mg.
 * Published adult serum data show a strong linear relation between
 * the two, so the calculator accepts total Mg and estimates iMg for
 * the SID / Gamblegram contribution.
 *
 * The estimate starts from the existing total-Mg linear relation and
 * then applies a pH-centred adjustment using the reported pH slope for
 * ionized magnesium. The result is clamped to [0, totalMg] to avoid
 * impossible values at the extreme picker edges.
 *
 * @param {number} totalMg  Total serum magnesium in mmol/L
 * @param {number} pH       Simultaneous blood/serum pH
 * @returns {number}        Estimated ionized magnesium in mmol/L
 */
function ionizedMagnesiumFromTotal(totalMg, pH) {
  if (!Number.isFinite(totalMg)) return NaN;
  if (totalMg <= 0) return 0;
  let estimate = 0.66 * totalMg + 0.039;
  if (Number.isFinite(pH)) {
    estimate += IMG_PH_SLOPE * (IMG_PH_REFERENCE - pH);
  }
  return Math.max(0, Math.min(totalMg, estimate));
}

function magnesiumComplexingConfidence(phosphate, extraAnions) {
  let points = 0;
  const reasons = [];

  function addReason(text) {
    if (!text || reasons.includes(text)) return;
    reasons.push(text);
  }

  function scoreFromThresholds(value, thresholds, perThresholdPoints) {
    let out = 0;
    for (let i = 0; i < thresholds.length; i++) {
      if (value >= thresholds[i]) out = perThresholdPoints[i];
    }
    return out;
  }

  function joinReasons(items) {
    if (!items.length) return "";
    if (items.length === 1) return items[0];
    if (items.length === 2) return items[0] + " and " + items[1];
    return items.slice(0, -1).join(", ") + ", and " + items[items.length - 1];
  }

  if (Number.isFinite(phosphate)) {
    if (phosphate >= 2.5) {
      points += 2;
      addReason("phosphate " + phosphate.toFixed(2) + " mmol/L");
    } else if (phosphate >= 1.5) {
      points += 1;
      addReason("phosphate " + phosphate.toFixed(2) + " mmol/L");
    }
  }

  if (Array.isArray(extraAnions)) {
    extraAnions.forEach((ion) => {
      if (!ion || !Number.isFinite(ion.concentration) || ion.concentration <= 0) return;
      const displayName = (ion.labelText || "additional anion").trim();
      const matchedRule = MG_COMPLEXING_NAME_RULES.find((rule) => rule.pattern.test(displayName));
      if (matchedRule) {
        const ionPoints = scoreFromThresholds(
          ion.concentration,
          matchedRule.thresholds,
          matchedRule.points
        );
        if (ionPoints > 0) {
          points += ionPoints;
          addReason(displayName + " " + ion.concentration.toFixed(1) + " mmol/L");
        }
        return;
      }

      const charge = Number.isFinite(ion.charge) ? ion.charge : 1;
      const equivalentBurden = Number.isFinite(ion.v) ? ion.v : ion.concentration * charge;
      if (charge >= 2 && equivalentBurden >= 3) {
        points += 1;
        addReason(displayName + " " + ion.concentration.toFixed(1) + " mmol/L");
      }
    });
  }

  let levelKey = "high";
  if (points >= 3) levelKey = "low";
  else if (points >= 1) levelKey = "medium";

  const label = levelKey.charAt(0).toUpperCase() + levelKey.slice(1);
  const shownReasons = reasons.slice(0, 3);
  if (reasons.length > 3) shownReasons.push("other added anions");
  const summary = shownReasons.length
    ? "Reduced by " + joinReasons(shownReasons) + "."
    : "No flagged phosphate or custom complexing-anion burden.";

  return { label, levelKey, points, summary };
}

/* ─────────────────────────────────────────────────────────────────────
 *  Figge–Fencl v3.0 albumin charge model
 * ───────────────────────────────────────────────────────────────────── */

/**
 * Full Figge–Fencl v3.0 albumin charge model.
 *
 * Treats human serum albumin (MW = 66 500 Da) as a macro-ion with
 * individual pKa values for every ionisable amino-acid residue,
 * fitted to potentiometric titration data.  Histidine pKa values
 * (His 1–13) were determined by ¹H-NMR spectroscopy; His 14–16
 * were assigned or optimised.
 *
 * Residue inventory per albumin molecule:
 *   Basic (+)  : 16 His (individual pKa), 59 Lys (7 sub-groups),
 *                24 Arg (pKa 12.5), 1 α-NH₂ (pKa 8.0)
 *   Acidic (−) : 98 Asp+Glu (pKa 3.9), 1 α-COOH (pKa 3.1),
 *                1 Cys (pKa 8.5), 18 Tyr (pKa 11.7)
 *
 * The N→B conformational transition (Figge v3.0) shifts the pKa
 * of 5 domain-1 histidines down by up to 0.4 pH units as the
 * protein transitions from the N-form to the B-form above pH ≈ 6.9.
 *
 * At pH 7.40, Alb 4.0 g/dL (40 g/L) → A⁻ ≈ 11.2 mEq/L.
 *
 * @param {number} albGperL  Albumin concentration in g/L
 * @param {number} pH        Arterial pH
 * @returns {number}         A⁻ in mEq/L (positive = net negative charge)
 */
function albuminCharge(albGperL, pH) {
  const albMM = albGperL / 66.5; // g/L → mmol/L

  /* ── N→B conformational transition (affects domain-1 His 1–5) ── */
  const NB = 0.4 * (1 - 1 / (1 + Math.pow(10, pH - 6.9)));

  /* ── 16 histidine residues — individual pKa at 37 °C ──
   *    His 1–5 : domain 1 — pKa shifted down by NB
   *    His 6–16: remaining domains — no shift                    */
  const HIS_NB = [7.12, 7.22, 7.10, 7.49, 7.01];
  const HIS_STD = [
    7.31, 6.75, 6.36, 4.85, 5.76, // His 6–10  (NMR)
    6.17, 6.73, 5.82,             // His 11–13 (NMR)
    5.10, 6.70, 6.20,             // His 14–16 (fit / assigned)
  ];

  let his = 0;
  for (let i = 0; i < HIS_NB.length; i++)
    his += 1 / (1 + Math.pow(10, pH - (HIS_NB[i] - NB)));
  for (let i = 0; i < HIS_STD.length; i++)
    his += 1 / (1 + Math.pow(10, pH - HIS_STD[i]));

  /* ── 59 lysine residues — 7 sub-groups ──
   *    9 "low-titrating" Lys in 5 anomalous groups (buried / shifted),
   *    plus 50 normal Lys with textbook pKa ≈ 10.3                    */
  const lys =
      2 / (1 + Math.pow(10, pH - 5.800))   // group N1 (2 residues)
    + 2 / (1 + Math.pow(10, pH - 6.150))   // group N2 (2 residues)
    + 2 / (1 + Math.pow(10, pH - 7.510))   // group N3 (2 residues)
    + 2 / (1 + Math.pow(10, pH - 7.685))   // group N4 (2 residues)
    + 1 / (1 + Math.pow(10, pH - 7.860))   // group N5 (1 residue)
   + 50 / (1 + Math.pow(10, pH - 10.30));  // group N7 (50 normal)

  /* ── Other basic groups ── */
  const arg = 24 / (1 + Math.pow(10, pH - 12.5)); // 24 arginine
  const nh2 =  1 / (1 + Math.pow(10, pH - 8.0));  // α-amino terminus

  /* ── Acidic groups (contribute negative charge when deprotonated) ── */
  const acooh  =  -1 / (1 + Math.pow(10, 3.1 - pH));  // α-COOH
  const aspGlu = -98 / (1 + Math.pow(10, 3.9 - pH));  // 36 Asp + 62 Glu
  const cys    =  -1 / (1 + Math.pow(10, 8.5 - pH));  // Cys-34 free thiol
  const tyr    = -18 / (1 + Math.pow(10, 11.7 - pH)); // 18 tyrosine

  /* ── Net charge per mol → mEq/L ── */
  const netPerMol = his + lys + arg + nh2 + acooh + aspGlu + cys + tyr;
  return -albMM * netPerMol; // positive = mEq/L of net anionic charge
}

/* ─────────────────────────────────────────────────────────────────────
 *  Triprotic phosphate equilibrium
 * ───────────────────────────────────────────────────────────────────── */

/**
 * Average negative charge per mmol of total inorganic phosphate,
 * computed from the full triprotic equilibrium:
 *
 *   H₃PO₄  ⇌  H₂PO₄⁻  ⇌  HPO₄²⁻  ⇌  PO₄³⁻
 *
 * pKa values (apparent, plasma 37 °C) from Sendroy & Hastings (1927):
 *   pKa₁ = 1.915    pKa₂ = 6.66    pKa₃ = 11.78
 *
 * At pH 7.40, Phos 1.0 mmol/L → Pi⁻ ≈ 1.85 mEq/L.
 *
 * @param {number} phos  Total phosphate in mmol/L
 * @param {number} pH    Arterial pH
 * @returns {number}     Pi⁻ in mEq/L
 */
function phosphateCharge(phos, pH) {
  const K1 = Math.pow(10, -1.915);
  const K2 = Math.pow(10, -6.66);
  const K3 = Math.pow(10, -11.78);
  const H  = Math.pow(10, -pH);

  const d = H * H * H + K1 * H * H + K1 * K2 * H + K1 * K2 * K3;
  const z = (K1 * H * H + 2 * K1 * K2 * H + 3 * K1 * K2 * K3) / d;
  return phos * z;
}
