# Stewart / Figge Acid-Base Calculator

A static browser-based application for physicochemical acid-base analysis based on the Stewart framework with Figge/Fencl weak-acid terms. The implementation is intentionally transparent: it requires no build step, uses no framework, and exposes the physiologic calculations directly in plain JavaScript under `js/`.

> Disclaimer: this software is intended for educational and analytical use. It draws on primary literature, later clinical summaries, and one implementation-specific source for the detailed albumin residue model. It has not been validated for clinical decision support.

## Scope

The application accepts a compact chemistry-panel and blood-gas style input set and reports:

- `SIDa` (apparent strong ion difference)
- `SIDe` (effective strong ion difference)
- `SIG` (strong ion gap)
- `AG` (anion gap, using the potassium-including form)
- a Gamblegram-style visualization of charge balance

The implementation extends beyond the common bedside approximation. Its principal weak-acid terms are:

- bicarbonate, derived by default from the Henderson-Hasselbalch equation
- albumin charge, computed from a full Figge-Fencl v3.0 residue-level macro-ion model
- phosphate charge, computed from the full triprotic equilibrium

## Quick start

No build tooling is required. Serve the repository root over HTTP:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Inputs and unit conventions

All strong-ion calculations are performed in charge equivalents.

| Input | UI unit | Internal handling |
| --- | --- | --- |
| Na, K, Cl | mmol/L | Monovalent species, therefore `mmol/L == mEq/L` |
| Ionized Ca | mmol/L or mg/dL | Converted to mmol/L, then multiplied by 2 in strong-ion sums |
| Total Mg | mmol/L or mg/dL | Converted to mmol/L, converted to estimated ionized Mg with a pH adjustment, then multiplied by 2 in strong-ion sums |
| Lactate | mmol/L or mg/dL | Converted to mmol/L and treated as a monovalent anion |
| Albumin | g/dL | Converted to g/L, then to mmol/L using MW `66.5 g/mmol` |
| Phosphate | mmol/L or mg/dL | Converted to mmol/L, then multiplied by its pH-dependent mean charge |
| pH | unitless | Used in bicarbonate, albumin, and phosphate calculations |
| pCO2 | mmHg | Used in the bicarbonate calculation |
| Additional ions | mmol/L plus integer charge | Treated as fully dissociated strong ions with contribution `concentration * charge` |

Implementation notes:

- The magnesium input is **total serum magnesium**, not measured ionized magnesium.
- The application also reports a qualitative iMg estimate-confidence flag. This flag is interpretive only: it does **not** alter `SIDa`, `SIDe`, `SIG`, or `AG`.
- The displayed `AG` is `Na + K - Cl - HCO3`, so its reference range is higher than potassium-free AG conventions.
- The current UI includes an `SBE` field, but `js/compute.js` does not currently incorporate it into any calculation.

## Core equations at a glance

The computational sequence is:

$$
\mathrm{HCO_3^-}_{gas} = 0.03 \times pCO_2 \times 10^{(pH - 6.1)}
$$

$$
\mathrm{iMg}_{linear} = 0.66 \times \mathrm{Mg}_{total} + 0.039
$$

$$
\mathrm{iMg}_{pH} = \mathrm{iMg}_{linear} + 0.12 \times (7.40 - pH)
$$

$$
\mathrm{iMg}_{est} = \min\!\left(\mathrm{Mg}_{total}, \max\!\left(0, \mathrm{iMg}_{pH}\right)\right)
$$

$$
\mathrm{SID_a} = [\mathrm{Na^+}] + [\mathrm{K^+}] + 2[\mathrm{iCa^{2+}}] + 2[\mathrm{iMg^{2+}}] - [\mathrm{Cl^-}] - [\mathrm{Lactate^-}] + \sum (\text{extra cation concentration} \times \text{charge}) - \sum (\text{extra anion concentration} \times \text{charge})
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

For faithful reproduction of the implementation, the key details are the weak-acid terms `Alb-` and `Phos-`, together with the branch logic governing `HCO3-`.

## Calculation sequence

### 1. Bicarbonate calculation

Unless the user explicitly selects a measured BMP bicarbonate, the application derives bicarbonate from pH and pCO2:

$$
[\mathrm{HCO_3^-}] = \alpha \cdot pCO_2 \cdot 10^{(pH - pK')}
$$

with:

- `alpha = 0.03 mmol/L/mmHg`
- `pK' = 6.1`

The exact implemented expression is:

```text
HCO3_gas = 0.03 * pCO2 * 10^(pH - 6.1)
```

This is the standard clinical Henderson-Hasselbalch rearrangement used in blood-gas analysis rather than a Stewart-specific identity. The constants correspond to the classical blood-serum `pK'` and CO2 solubility work cited below. In Stewart terms, bicarbonate remains a dependent variable; however, the default implementation derives it conventionally unless fixed-SIG mode is enabled.

### 2. Magnesium handling

The application does **not** request measured ionized magnesium. Instead, it accepts total serum magnesium and estimates ionized magnesium with a two-step heuristic:

```text
iMg_linear = 0.66 * Mg_total + 0.039
iMg_pH = iMg_linear + 0.12 * (7.40 - pH)
iMg = clamp(iMg_pH, lower=0, upper=Mg_total)
```

The clamp prevents non-physical values at the extremes of the selectable range.

This remains an implementation heuristic rather than a canonical Stewart equation. The rationale is:

- routine chemistry panels commonly report only total magnesium
- the IFCC iMg guideline states that magnesium binding is pH-dependent and that pH should be measured alongside iMg
- Wang et al. reported a pH slope of approximately `0.12 mmol/L per pH unit` for ionized magnesium in the tested specimens

Accordingly, the application keeps the previous total-Mg backbone and applies a small pH-centred correction around `pH 7.40`. Reproduction of the present implementation therefore requires the relation above; a separate implementation with direct ionized magnesium measurements would ordinarily substitute measured `iMg` directly.

### 2b. Qualitative iMg confidence flag

In addition to the point estimate, the results panel shows a qualitative confidence flag for the iMg estimate. This flag does **not** change the strong-ion arithmetic. It is a presentation-layer warning that the total-Mg to iMg mapping is less trustworthy when the entered chemistry suggests a larger complexed magnesium fraction.

The current implementation assigns confidence points as follows:

```text
confidence_points = 0

if phosphate >= 2.5 mmol/L:
  confidence_points += 2
else if phosphate >= 1.5 mmol/L:
  confidence_points += 1

for each additional anion row:
  if name matches citrate:
    +1 at >= 0.5 mmol/L
    +2 at >= 1.0 mmol/L
  else if name matches oxalate or EDTA:
    +1 at >= 0.25 mmol/L
    +2 at >= 0.5 mmol/L
  else if name matches sulfate:
    +1 at >= 1.0 mmol/L
    +2 at >= 3.0 mmol/L
  else if name matches acetate or ketones:
    +1 at >= 3.0 mmol/L
  else if the row is another polyvalent anion with
          concentration * charge >= 3 mEq/L:
    +1

High confidence   => confidence_points = 0
Medium confidence => confidence_points = 1 or 2
Low confidence    => confidence_points >= 3
```

This is a deliberately qualitative rule set. It is informed by the known partition of serum magnesium into ionized, protein-bound, and complexed fractions, and by the fact that citrate can substantially reduce ionized magnesium without a proportionate change in total magnesium. It should therefore be understood as a caution flag, not as a validated uncertainty model.

### 3. Apparent strong ion difference (`SIDa`)

Following unit conversion, the application computes the apparent strong ion difference as:

$$
\mathrm{SID_a} = [\mathrm{Na^+}] + [\mathrm{K^+}] + 2[\mathrm{iCa^{2+}}] + 2[\mathrm{iMg^{2+}}] - [\mathrm{Cl^-}] - [\mathrm{Lactate^-}] + \sum \mathrm{ExtraCations} - \sum \mathrm{ExtraAnions}
$$

Each additional ion contributes:

```text
segment_value = concentration_mmol_per_L * integer_charge
```

Examples:

- sulfate at `2 mmol/L` and charge `2` contributes `4 mEq/L` to the anion side
- lithium at `1 mmol/L` and charge `1` contributes `1 mEq/L` to the cation side
- citrate at `1 mmol/L` and charge `3` contributes `3 mEq/L` to the anion side

This follows the Stewart framework directly: strong ions are treated as fully dissociated species whose concentrations constrain electroneutrality and, consequently, the dependent acid-base variables.

### 4. Albumin charge (`Alb-`)

This is the most implementation-specific component of the model.

The application converts albumin from `g/dL` to `g/L`, then to `mmol/L` using a molecular weight of `66.5 kDa`:

$$
[\mathrm{Alb}]_{mmol/L} = \frac{[\mathrm{Alb}]_{g/L}}{66.5}
$$

The implementation then computes the net charge per albumin molecule from protonated basic groups and deprotonated acidic groups. The reported `Alb-` corresponds to the magnitude of albumin's net negative charge in `mEq/L`, so the code returns the negative of the molecular net charge:

$$
\mathrm{Alb^-} = -[\mathrm{Alb}]_{mmol/L} \times Z_{albumin}
$$

where `Z_albumin` is:

```text
Z_albumin = His + Lys + Arg + NH2 + alphaCOOH + AspGlu + Cys + Tyr
```

The site-specific protonation/deprotonation templates are:

- for basic sites: `+1 / (1 + 10^(pH - pKa))`
- for acidic sites: `-1 / (1 + 10^(pKa - pH))`

#### 4a. N to B conformational transition

The implementation applies the Figge-Fencl v3.0 N to B conformational transition to five domain-1 histidines:

$$
NB = 0.4 \times \left(1 - \frac{1}{1 + 10^{(pH - 6.9)}}\right)
$$

For histidines 1 through 5, the effective pKa becomes:

```text
pKa_effective = pKa_listed - NB
```

#### 4b. Residue inventory used by the implementation

Faithful reproduction requires the following residue counts and pKa values.

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

#### 4c. Implemented albumin equation

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

As noted in the source comments, `Alb = 4.0 g/dL` and `pH = 7.40` yields `Alb- ≈ 11.2 mEq/L`.

### 5. Phosphate charge (`Phos-`)

The implementation does not use a linear bedside approximation for phosphate charge. Instead, it uses the full mean-charge expression for inorganic phosphate:

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

The mean negative charge per mmol of total phosphate is:

$$
z =
\frac{K_1H^2 + 2K_1K_2H + 3K_1K_2K_3}
{H^3 + K_1H^2 + K_1K_2H + K_1K_2K_3}
$$

The resulting phosphate contribution is:

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

At `pH = 7.40` and phosphate `1.0 mmol/L`, the source comment gives `Phos- ≈ 1.85 mEq/L`.

### 6. Effective strong ion difference (`SIDe`)

Once `HCO3-`, `Alb-`, and `Phos-` have been established, the effective strong ion difference is:

$$
\mathrm{SID_e} = [\mathrm{HCO_3^-}] + \mathrm{Alb^-} + \mathrm{Phos^-}
$$

This is the conventional Stewart/Figge form: bicarbonate plus the principal measured weak-acid contributions. The implementation does not model every plasma weak acid explicitly; any residual charge not captured here is absorbed into the gap term.

### 7. Strong ion gap (`SIG`)

The strong ion gap is:

$$
\mathrm{SIG} = \mathrm{SID_a} - \mathrm{SID_e}
$$

Within this implementation, `SIG` is the residual unmeasured charge after accounting for:

- strong measured ions
- albumin
- phosphate
- bicarbonate
- any user-specified additional strong ions

### 8. Optional fixed-SIG mode

If the user enables **Fix SIG and make HCO3- the dependent variable**, the implementation holds `SIG` at a target value and solves:

$$
[\mathrm{HCO_3^-}] = \mathrm{SID_a} - \mathrm{SIG}_{target} - \mathrm{Alb^-} - \mathrm{Phos^-}
$$

This branch is conceptually important because it reflects the Stewart formulation more directly: once strong ions and weak acids are specified, bicarbonate is not independent.

Implementation details:

- if fixed-SIG mode is enabled and no target has yet been entered, the application captures the current calculated `SIG` and uses it as the initial target
- after solving the new `HCO3-`, it recomputes `SIDe` and `SIG`

### 9. Anion gap (`AG`)

The application also reports:

$$
\mathrm{AG} = [\mathrm{Na^+}] + [\mathrm{K^+}] - [\mathrm{Cl^-}] - [\mathrm{HCO_3^-}]
$$

This is not the primary Stewart variable of interest, but it remains a familiar clinical cross-check. Because potassium is included, the README and UI appropriately use a higher typical range than potassium-excluding AG conventions.

## Exact reproduction recipe

The following pseudocode reproduces the implemented physiologic logic outside the browser environment:

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

Implementation of the exact albumin residue inventory and phosphate constants above is sufficient to reproduce the core acid-base outputs generated by the application.

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
11. Ben Rayana MC, Burnett RW, Covington AK, et al. *Guidelines for sampling, measuring and reporting ionized magnesium in undiluted serum, plasma or blood: International Federation of Clinical Chemistry and Laboratory Medicine (IFCC): IFCC Scientific Division, Committee on Point of Care Testing.* Clin Chem Lab Med. 2005;43(5):564-569. PubMed: <https://pubmed.ncbi.nlm.nih.gov/15899681/>
12. Wang S, McDonnell EH, Sedor FA, Toffaletti JG. *pH effects on measurements of ionized calcium and ionized magnesium in blood.* Arch Pathol Lab Med. 2002;126(8):947-950. PubMed: <https://pubmed.ncbi.nlm.nih.gov/12171493/>
13. Kisters K, Spieker C, Tepel M, Zidek W. *Magnesium fractions in serum of healthy individuals and CAPD patients, measured by an ion-selective electrode and ultrafiltration.* Nephrol Dial Transplant. 1996;11(10):2026-2031. PubMed: <https://pubmed.ncbi.nlm.nih.gov/8740513/>
14. Ryzen E, Elbaum N, Singer FR, Rude RK. *Importance of ionized magnesium measurement for monitoring of citrate-anticoagulated plateletpheresis.* Transfusion. 1997;37(4):418-422. PubMed: <https://pubmed.ncbi.nlm.nih.gov/9111280/>

Interpretation of the source base:

- References 1-5 provide the principal peer-reviewed physiologic and clinical basis for the Stewart/Figge/Fencl variables used here.
- References 6-7 provide the historical physicochemical basis for the `pK' = 6.1` and `alpha = 0.03` Henderson-Hasselbalch constants used in the implementation.
- Reference 8 provides the key implementation source for the **exact** v3.0 albumin residue inventory, N to B transition, and phosphate constants reproduced by the code; it is valuable for implementation fidelity but should not be weighted equivalently to a peer-reviewed clinical review or trial.
- Reference 9 connects those implementation constants to later peer-reviewed Figge work.
- Reference 10 supports the general premise that total and ionized magnesium correlate, although the exact total-Mg backbone used here remains a pragmatic implementation choice.
- Reference 11 is a high-reliability laboratory-medicine guideline and supports the decision to incorporate pH into the estimate.
- Reference 12 provides the approximate `0.12 mmol/L per pH unit` slope used for the implemented pH-centred adjustment.
- Reference 13 supports the broader physiology behind the qualitative confidence flag by describing ionized, protein-bound, and complexed magnesium fractions in serum.
- Reference 14 supports treating citrate burden as a confidence-lowering feature, because citrate infusion can markedly lower ionized magnesium despite much smaller changes in total magnesium.

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

For the physiologic core, begin with `js/physiology.js` and `js/compute.js`.

## License

MIT
