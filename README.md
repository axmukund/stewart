# Stewart / Figge Acid-Base Calculator

A static single-page web app that implements a Stewart-style physicochemical acid-base analysis with Figge/Fencl weak-acid terms. The calculator is intentionally simple to run and inspect: no build step, no framework, and the core physiology lives in plain JavaScript under `js/`.

> Disclaimer: this is an educational calculator. It uses a mix of primary literature, later clinical summaries, and one implementation-specific weak-acid model source for the albumin residue inventory. It has not been validated for clinical decision-making.

## What the app does

The app takes a small chemistry panel / blood-gas style input set and computes:

- `SIDa` (apparent strong ion difference)
- `SIDe` (effective strong ion difference)
- `SIG` (strong ion gap)
- `AG` (anion gap, using the potassium-including form)
- a Gamblegram-style charge balance visualization

The implemented model is not just the short bedside approximation. The core weak-acid terms are:

- bicarbonate from Henderson-Hasselbalch by default
- albumin charge from a full Figge-Fencl v3.0 residue-by-residue macro-ion model
- phosphate charge from the full triprotic equilibrium

If someone wanted to reimplement the app from scratch, the sections below are the calculation pipeline to copy.

## Quick start

No build tools are needed. Serve the directory over HTTP:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Inputs and unit conventions

The app internally works in charge equivalents for the SID sums.

| Input | UI unit | Internal handling |
| --- | --- | --- |
| Na, K, Cl | mmol/L | Monovalent, so `mmol/L == mEq/L` |
| Ionized Ca | mmol/L or mg/dL | Converted to mmol/L, then multiplied by 2 in SID sums |
| Total Mg | mmol/L or mg/dL | Converted to mmol/L, then converted to estimated ionized Mg, then multiplied by 2 in SID sums |
| Lactate | mmol/L or mg/dL | Converted to mmol/L, counted as monovalent anion |
| Albumin | g/dL | Converted to g/L, then to mmol/L with MW `66.5 g/mmol` |
| Phosphate | mmol/L or mg/dL | Converted to mmol/L, then multiplied by its pH-dependent average charge |
| pH | unitless | Used in bicarbonate, albumin, and phosphate calculations |
| pCO2 | mmHg | Used in bicarbonate calculation |
| Additional ions | mmol/L plus integer charge | Counted as fully dissociated strong ions with contribution `concentration * charge` |

Important implementation notes:

- The magnesium input is **total serum magnesium**, not measured ionized magnesium.
- The displayed `AG` is `Na + K - Cl - HCO3`, so its reference range is higher than potassium-free AG conventions.
- The current UI includes an `SBE` field, but `js/compute.js` does not use it in any calculation.

## Core equations at a glance

The app computes, in this order:

$$
\mathrm{HCO_3^-}_{gas} = 0.03 \times pCO_2 \times 10^{(pH - 6.1)}
$$

$$
\mathrm{iMg}_{est} = \operatorname{clamp}\!\left(0,\ \mathrm{Mg}_{total},\ 0.66 \times \mathrm{Mg}_{total} + 0.039\right)
$$

$$
\mathrm{SID_a} =
[\mathrm{Na^+}] + [\mathrm{K^+}] + 2[\mathrm{iCa^{2+}}] + 2[\mathrm{iMg^{2+}}]
- [\mathrm{Cl^-}] - [\mathrm{Lactate^-}]
+ \sum(\text{extra cation concentration} \times \text{charge})
- \sum(\text{extra anion concentration} \times \text{charge})
$$

$$
\mathrm{SID_e} = [\mathrm{HCO_3^-}] + \mathrm{Alb^-} + \mathrm{Phos^-}
$$

$$
\mathrm{SIG} = \mathrm{SID_a} - \mathrm{SID_e}
$$

$$
\mathrm{AG} = [\mathrm{Na^+}] + [\mathrm{K^+}] - [\mathrm{Cl^-}] - [\mathrm{HCO_3^-}]
$$

The details that matter for reproducibility are the weak-acid terms `Alb-` and `Phos-`, plus the branch logic for `HCO3-`. Those are described below.

## Calculation pipeline

### 1. Bicarbonate defaults to Henderson-Hasselbalch

Unless the user explicitly asks the app to use a measured BMP bicarbonate, the calculator derives bicarbonate from pH and pCO2:

$$
[\mathrm{HCO_3^-}] = \alpha \cdot pCO_2 \cdot 10^{(pH - pK')}
$$

with:

- `alpha = 0.03 mmol/L/mmHg`
- `pK' = 6.1`

So the exact code path is:

```text
HCO3_gas = 0.03 * pCO2 * 10^(pH - 6.1)
```

This is the standard clinical Henderson-Hasselbalch blood-gas rearrangement rather than a Stewart-specific identity. The constants correspond to the classical blood-serum `pK'` and CO2 solubility work cited in the reference list below. In Stewart language, bicarbonate is a dependent variable; the app still computes it this conventional way unless the user turns on fixed-SIG mode.

### 2. Magnesium is estimated before entering the strong-ion sum

The app does **not** ask for measured ionized magnesium. Instead it takes total serum magnesium and estimates ionized magnesium with a linear rule:

```text
iMg_est = 0.66 * Mg_total + 0.039
iMg = clamp(iMg_est, lower=0, upper=Mg_total)
```

The clamp is there to avoid impossible values at extreme picker settings.

This is an implementation heuristic, not a canonical Stewart equation. The physiological reason for the step is straightforward: the strong-ion sum should count the freely dissociated divalent cation contribution, but routine chemistry panels usually report total magnesium. If you are reproducing the app exactly, use the equation above. If you are building a more rigorous clinical implementation and have measured ionized magnesium, you would normally use measured `iMg` directly instead.

### 3. Apparent SIDa is a charge-equivalent sum

After unit conversion, the app computes apparent strong ion difference as:

$$
\mathrm{SID_a} =
[\mathrm{Na^+}] + [\mathrm{K^+}] + 2[\mathrm{iCa^{2+}}] + 2[\mathrm{iMg^{2+}}]
- [\mathrm{Cl^-}] - [\mathrm{Lactate^-}]
+ \sum \mathrm{ExtraCations}
- \sum \mathrm{ExtraAnions}
$$

where each additional ion contributes:

```text
segment_value = concentration_mmol_per_L * integer_charge
```

That means:

- sulfate at `2 mmol/L` and charge `2` contributes `4 mEq/L` to the anion side
- lithium at `1 mmol/L` and charge `1` contributes `1 mEq/L` to the cation side
- citrate at `1 mmol/L` and charge `3` contributes `3 mEq/L` to the anion side

This follows the Stewart framing directly: strong ions are treated as fully dissociated species whose concentrations constrain electroneutrality and therefore the dependent acid-base variables.

### 4. Albumin uses the full Figge-Fencl v3.0 macro-ion model

This is the most implementation-specific part of the calculator.

The app converts albumin from `g/dL` to `g/L`, then to `mmol/L` using a molecular weight of `66.5 kDa`:

$$
[\mathrm{Alb}]_{mmol/L} = \frac{[\mathrm{Alb}]_{g/L}}{66.5}
$$

It then computes the net charge per albumin molecule from protonated basic groups and deprotonated acidic groups. The final reported `Alb-` is the magnitude of albumin's net negative charge in `mEq/L`, so the code returns the negative of the molecular net charge:

$$
\mathrm{Alb^-} = -[\mathrm{Alb}]_{mmol/L} \times Z_{albumin}
$$

where `Z_albumin` is:

```text
Z_albumin = His + Lys + Arg + NH2 + alphaCOOH + AspGlu + Cys + Tyr
```

The protonation/deprotonation templates are:

- for basic sites: `+1 / (1 + 10^(pH - pKa))`
- for acidic sites: `-1 / (1 + 10^(pKa - pH))`

#### 4a. N to B conformational shift

The code applies the Figge-Fencl v3.0 N to B transition to five domain-1 histidines:

$$
NB = 0.4 \times \left(1 - \frac{1}{1 + 10^{(pH - 6.9)}}\right)
$$

For histidines 1 through 5, the effective pKa becomes:

```text
pKa_effective = pKa_listed - NB
```

#### 4b. Exact residue inventory used by the app

To reproduce the code exactly, use the following residue counts and pKa values.

Histidines:

- His 1-5, each shifted by `NB`: `7.12, 7.22, 7.10, 7.49, 7.01`
- His 6-16, no shift: `7.31, 6.75, 6.36, 4.85, 5.76, 6.17, 6.73, 5.82, 5.10, 6.70, 6.20`

Lysines:

- 2 residues at `pKa 5.800`
- 2 residues at `pKa 6.150`
- 2 residues at `pKa 7.510`
- 2 residues at `pKa 7.685`
- 1 residue at `pKa 7.860`
- 50 residues at `pKa 10.30`

Other basic groups:

- 24 arginines at `pKa 12.5`
- 1 alpha-amino terminus at `pKa 8.0`

Acidic groups:

- 1 alpha-carboxyl terminus at `pKa 3.1`
- 98 Asp/Glu residues at `pKa 3.9`
- 1 cysteine thiol at `pKa 8.5`
- 18 tyrosines at `pKa 11.7`

#### 4c. Exact albumin equation as implemented

In code form, the model is:

```text
Alb_mmol = Alb_gL / 66.5

NB = 0.4 * (1 - 1 / (1 + 10^(pH - 6.9)))

His =
  sum over [7.12, 7.22, 7.10, 7.49, 7.01] of 1 / (1 + 10^(pH - (pKa - NB))) +
  sum over [7.31, 6.75, 6.36, 4.85, 5.76, 6.17, 6.73, 5.82, 5.10, 6.70, 6.20] of 1 / (1 + 10^(pH - pKa))

Lys =
    2 / (1 + 10^(pH - 5.800))
  + 2 / (1 + 10^(pH - 6.150))
  + 2 / (1 + 10^(pH - 7.510))
  + 2 / (1 + 10^(pH - 7.685))
  + 1 / (1 + 10^(pH - 7.860))
  + 50 / (1 + 10^(pH - 10.30))

Arg = 24 / (1 + 10^(pH - 12.5))
NH2 = 1 / (1 + 10^(pH - 8.0))

alphaCOOH = -1 / (1 + 10^(3.1 - pH))
AspGlu    = -98 / (1 + 10^(3.9 - pH))
Cys       = -1 / (1 + 10^(8.5 - pH))
Tyr       = -18 / (1 + 10^(11.7 - pH))

Z_albumin = His + Lys + Arg + NH2 + alphaCOOH + AspGlu + Cys + Tyr
Alb_minus = -Alb_mmol * Z_albumin
```

At the code comment's reference point, `Alb = 4.0 g/dL` and `pH = 7.40` gives `Alb- ≈ 11.2 mEq/L`.

### 5. Phosphate uses the full triprotic equilibrium

The app does not use the bedside linear approximation for phosphate charge. It uses the full average-charge expression for inorganic phosphate:

$$
\mathrm{H_3PO_4} \rightleftharpoons \mathrm{H_2PO_4^-} \rightleftharpoons \mathrm{HPO_4^{2-}} \rightleftharpoons \mathrm{PO_4^{3-}}
$$

with:

- `pKa1 = 1.915`
- `pKa2 = 6.66`
- `pKa3 = 11.78`
- `K1 = 10^-pKa1`
- `K2 = 10^-pKa2`
- `K3 = 10^-pKa3`
- `H = 10^-pH`

The average negative charge per mmol phosphate is:

$$
z =
\frac{K_1H^2 + 2K_1K_2H + 3K_1K_2K_3}
{H^3 + K_1H^2 + K_1K_2H + K_1K_2K_3}
$$

and the phosphate contribution is:

$$
\mathrm{Phos^-} = [\mathrm{Phosphate}] \times z
$$

In code form:

```text
K1 = 10^(-1.915)
K2 = 10^(-6.66)
K3 = 10^(-11.78)
H  = 10^(-pH)

d = H^3 + K1*H^2 + K1*K2*H + K1*K2*K3
z = (K1*H^2 + 2*K1*K2*H + 3*K1*K2*K3) / d
Phos_minus = Phosphate_total_mmol_per_L * z
```

At `pH = 7.40` and phosphate `1.0 mmol/L`, the code comment gives `Phos- ≈ 1.85 mEq/L`.

### 6. SIDe is bicarbonate plus weak-acid anions

Once `HCO3-`, `Alb-`, and `Phos-` are known, effective SID is:

$$
\mathrm{SID_e} = [\mathrm{HCO_3^-}] + \mathrm{Alb^-} + \mathrm{Phos^-}
$$

This is the standard bedside Stewart/Figge structure: bicarbonate plus the major measured weak-acid contributions. The app does not separately model every weak acid in plasma, so anything not captured here ends up in the gap term.

### 7. SIG is the residual unmeasured charge

The strong ion gap is:

$$
\mathrm{SIG} = \mathrm{SID_a} - \mathrm{SID_e}
$$

In the app, this is the "unknown" or unmeasured remainder after accounting for:

- strong measured ions
- albumin
- phosphate
- bicarbonate
- any user-added extra strong ions

### 8. Optional fixed-SIG mode solves bicarbonate backward

If the user enables **Fix SIG and make HCO3- the dependent variable**, the app freezes `SIG` at a target value and solves:

$$
[\mathrm{HCO_3^-}] = \mathrm{SID_a} - \mathrm{SIG}_{target} - \mathrm{Alb^-} - \mathrm{Phos^-}
$$

That branch is important conceptually because it reflects the Stewart view more directly: once strong ions and weak acids are fixed, bicarbonate is not independent.

Implementation detail:

- if fixed-SIG mode is enabled and no target has been entered yet, the app first captures the currently calculated SIG and uses that as the initial target
- after solving the new `HCO3-`, it recomputes `SIDe` and `SIG`

### 9. Anion gap is reported as a conventional cross-check

The app also shows:

$$
\mathrm{AG} = [\mathrm{Na^+}] + [\mathrm{K^+}] - [\mathrm{Cl^-}] - [\mathrm{HCO_3^-}]
$$

This is not the Stewart variable of interest, but it is a familiar bedside cross-check. Because potassium is included, the README and UI use a higher "typical" range than potassium-free AG conventions.

## Exact reproduction recipe

If you want to reproduce the app's physiologic logic outside the browser, this is the shortest faithful algorithm:

```text
Inputs:
  Na, K, iCa, Mg_total, Cl, Lactate, Albumin_g_dL, Phosphate,
  pH, pCO2, optional extra strong ions, optional BMP_HCO3,
  optional fixed_SIG_target

Convert:
  Albumin_gL = Albumin_g_dL * 10
  iMg = clamp(0, Mg_total, 0.66 * Mg_total + 0.039)

Default bicarbonate:
  HCO3_gas = 0.03 * pCO2 * 10^(pH - 6.1)

Branch:
  if fixed_SIG_mode:
      provisional_HCO3 = HCO3_gas
  else if use_BMP_HCO3_mode:
      provisional_HCO3 = BMP_HCO3
  else:
      provisional_HCO3 = HCO3_gas

Strong ions:
  SIDa = Na + K + 2*iCa + 2*iMg - Cl - Lactate
       + sum(extra_cation_concentration * charge)
       - sum(extra_anion_concentration * charge)

Weak acids:
  Alb_minus  = full_Figge_Fencl_v3_albumin_charge(Albumin_gL, pH)
  Phos_minus = full_triprotic_phosphate_charge(Phosphate, pH)

If fixed SIG:
  HCO3 = SIDa - SIG_target - Alb_minus - Phos_minus
else:
  HCO3 = provisional_HCO3

Then:
  SIDe = HCO3 + Alb_minus + Phos_minus
  SIG  = SIDa - SIDe
  AG   = Na + K - Cl - HCO3
```

If you implement the exact albumin residue inventory and the phosphate constants above, you will reproduce the app's core acid-base outputs.

## Where the formulas come from

### Stewart framework

Peter Stewart's quantitative acid-base framework treats pH and bicarbonate as dependent variables governed by three independent variable groups: strong ions, total weak acids, and CO2. That is the conceptual reason the app is organized around `SIDa`, `SIDe`, and `SIG`, not just bicarbonate and AG.

### Figge/Fencl weak-acid refinements

The original Stewart framework is general, but clinicians need tractable plasma weak-acid terms. Figge, Rossing, and Fencl derived quantitative albumin and phosphate contributions, then Figge and colleagues later refined the serum protein treatment further. The app's simple bedside outputs (`SIDe`, `SIG`) are Stewart/Figge/Fencl quantities even though the actual albumin term implemented here is more detailed than the compact bedside linear approximation.

### Full albumin model provenance

The exact residue-by-residue albumin model in `js/physiology.js` matches the Figge-Fencl v3.0 model description rather than only the short clinical linear approximation. That source is important because it explains:

- the 16 explicit histidine sites
- the nonuniform lysine subgroups
- the N to B conformational transition
- the exact residue inventory used in the code

This is the least conventional source in the README. It is an author-maintained model page, not a peer-reviewed journal article, so it should be read as **implementation provenance** rather than as the sole evidentiary basis for Stewart acid-base physiology. The underlying Stewart/Figge/Fencl clinical framework is peer-reviewed; the precise v3.0 residue inventory is documented on that model page and reproduced in the code.

### Phosphate constants

The phosphate pKa values are old, but they are the constants explicitly used in the implementation and reproduced in the Figge model materials. Because the app needs exact constants to be reproducible, those fixed values matter more here than a later bedside simplification would.

## References

Foundational and primary sources:

1. Peter A. Stewart. *Modern quantitative acid-base chemistry.* Can J Physiol Pharmacol. 1983;61(12):1444-1461. PubMed: <https://pubmed.ncbi.nlm.nih.gov/6423247/>
2. Figge J, Rossing TH, Fencl V. *The role of serum proteins in acid-base equilibria.* J Lab Clin Med. 1991;117(6):453-467. PubMed: <https://pubmed.ncbi.nlm.nih.gov/2037853/>
3. Figge J, Mydosh T, Fencl V. *Serum proteins and acid-base equilibria: a follow-up.* J Lab Clin Med. 1992;120(5):713-719. PubMed: <https://pubmed.ncbi.nlm.nih.gov/1431499/>
4. Fencl V, Jabor A, Kazda A, Figge J. *Diagnosis of metabolic acid-base disturbances in critically ill patients.* Am J Respir Crit Care Med. 2000;162(6):2246-2251. PubMed: <https://pubmed.ncbi.nlm.nih.gov/11112147/>
5. Kellum JA. *Clinical review: reunification of acid-base physiology.* Crit Care. 2005;9(5):500-507. PubMed: <https://pubmed.ncbi.nlm.nih.gov/16277737/>
6. Hastings AB, Sendroy J Jr, Van Slyke DD. *Studies of gas and electrolyte equilibria in blood. XII. The value of pK' in the Henderson-Hasselbalch equation for blood serum.* J Biol Chem. 1928;79:183-192. DOI: <https://doi.org/10.1016/S0021-9258(18)83945-X>
7. Van Slyke DD, Sendroy J Jr, Hastings AB, Neill JM. *Studies of gas and electrolyte equilibria in blood. X. The solubility of carbon dioxide at 38° in water, salt solution, serum, and blood cells.* J Biol Chem. 1928;78:765-799. DOI trail: <https://ouci.dntb.gov.ua/en/works/73YRpoRl/>

Implementation-specific and supporting sources:

8. James Figge. *The Figge-Fencl quantitative physicochemical model of human acid-base physiology* (model v3.0 description). Current site: <https://www.acid-base.org/figge-fencl-model> . Archived model page: <https://web.archive.org/web/20160327122156/http://figge-fencl.org/model.html>
9. Figge J, Bellomo R, Egi M. *Quantitative relationships among plasma lactate, inorganic phosphorus, albumin, unmeasured anions and the anion gap in lactic acidosis.* J Crit Care. 2018;44:101-110. PubMed: <https://pubmed.ncbi.nlm.nih.gov/29128625/>
10. Longstreet D, Vink R. *Does the ionized magnesium concentration reflect the total serum magnesium concentration?* Clin Chem. 2009;55(9):1685-1686. PubMed: <https://pubmed.ncbi.nlm.nih.gov/19608851/>

How to interpret the source mix:

- References 1-5 are the main peer-reviewed physiologic and clinical basis for the Stewart/Figge/Fencl variables used here.
- References 6-7 are the historical physicochemical sources behind the `pK' = 6.1` and `alpha = 0.03` style Henderson-Hasselbalch constants used by the implementation.
- Reference 8 is the key source for the **exact** v3.0 albumin residue inventory, N to B transition, and phosphate constants that the code reproduces; it is useful for implementation fidelity but should not be treated as equivalent in weight to a peer-reviewed trial or review.
- Reference 9 bridges the implementation constants to later peer-reviewed Figge work.
- Reference 10 supports the general idea that total and ionized magnesium correlate, but the exact linear estimator in this app should still be treated as a pragmatic implementation choice.

## Project structure

```text
├── index.html           App shell, controls, formulas panel, references
├── style.css            All styling
├── js/
│   ├── helpers.js
│   ├── units.js
│   ├── physiology.js    Henderson-Hasselbalch, magnesium estimate, albumin, phosphate
│   ├── additionalIons.js
│   ├── gamblegram.js
│   ├── export.js
│   ├── compute.js       Main calculation pipeline
│   ├── pickers.js
│   └── events.js
├── .nojekyll
├── .gitignore
└── README.md
```

If you only want the physiologic core, start with `js/physiology.js` and `js/compute.js`.

## License

MIT
