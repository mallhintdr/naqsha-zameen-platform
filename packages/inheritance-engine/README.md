# inheritance-engine

A pure TypeScript inheritance (wirasat) calculator with no dependencies. It runs unchanged in the browser and in Node 22.18 and later, which runs `.ts` files directly.

- **Exact arithmetic:** every share is an exact `BigInt` fraction. The only formatted number is the percentage string; `npm run check:no-floats` enforces this.
- **Derived relations:** relations are worked out from the family graph (parents and marriages), never typed in as labels.
- **Explained results:** every share carries an explain log of `{ ruleId, i18nKey, params, citationKey }`. The citations are data in `law/citations.json`, and all are marked `verified: false` until legal review.
- **Disclaimer (print on every output):** *Computational aid, not legal advice. Verify with a lawyer / revenue officer.*

```ts
import { CaseBuilder, compute, toString } from 'inheritance-engine';
const b = new CaseBuilder('sunni-hanafi');
b.spouse(); b.child('M'); b.child('F');
compute(b.build()).shares.map((s) => toString(s.fraction)); // ['1/8', '7/12', '7/24']
```

Scripts: `npm test`, `npm run demo` (5 sample cases), `npm run check:no-floats`.

## Status

| Law system | Status |
|---|---|
| Sunni Hanafi | Phase 1: done |
| Shafi'i / Maliki / Hanbali | Hanafi rules, except the grandfather shares with siblings (best of three, flagged "verify") |
| Shia Ithna Ashari | Phase 4 |
| Christian / Parsi | Phase 5 |
| Hindu (Mitakshara) | Phase 7 |

## Pipeline (`src/compute.ts`)

1. **Net estate:** gross minus funeral costs, debts and dower. Pension is not part of the estate (a note is added).
2. **Wills:** Muslim law allows at most 1/3. Sunni law does not allow a bequest to an heir without the other heirs' consent.
3. **Candidate heirs:** derived from the family graph.
4. **Capacity bars:** homicide, difference of religion, adoption, illegitimacy, irrevocable divorce, predeceased or simultaneous death.
5. **Rule-set:** the shares under the chosen law.
6. **Adjustments:** aul, radd, distant kindred, escheat.
7. **MFLO 1961 s.4:** a predeceased child's share passes to their living children (2 : 1).
8. **Reservations:** a pregnant widow (the larger of a son's or a daughter's share; other heirs get their minimum) and missing heirs.
9. **Munasakha:** cases linked via `parentCaseId` (Phase 6).
10. **Invariants:** the shares, the reserve and the escheat sum to exactly 1, and none is negative.

## Rule IDs (Sunni module, `src/rules/sunni.ts`)

| Rule ID | Rule | Citation key |
|---|---|---|
| sunni.husband.half / .quarter | Husband 1/2, or 1/4 with a child or agnatic descendant | quran-4-12 |
| sunni.wife.quarter / .eighth | Wives jointly 1/4, or 1/8 | quran-4-12 |
| sunni.father.sixth | Father 1/6 with a male descendant | quran-4-11 |
| sunni.father.sixth-plus-residue / .residue | 1/6 + residue with only female descendants | quran-4-11 |
| sunni.father.residuary | Father takes the residue when there are no descendants | hanafi-consensus |
| sunni.grandfather.* | True grandfather takes the father's place; in Hanafi law he excludes siblings | hanafi-consensus |
| sunni.grandfather.best-of-three | Grandfather with siblings (non-Hanafi, toggle) | zayd-ibn-thabit |
| sunni.mother.third / .sixth-children / .sixth-siblings | Mother 1/3; 1/6 with a child or with 2+ siblings (even if excluded) | quran-4-11 |
| sunni.mother.umariyyatan | With a spouse and the father: 1/3 of the remainder | umariyyatan |
| sunni.grandmother.* | True grandmothers 1/6 shared; excluded by the mother, by the father (paternal side) and by a nearer one | hanafi-consensus |
| sunni.daughter.half / sunni.daughters.two-thirds | Daughters 1/2 or 2/3 | quran-4-11 |
| sunni.children.residue-2-1 | With a son: residue 2 : 1 | quran-4-11 |
| sunni.sons-daughter.* | 1/2, 2/3, or 1/6 completing 2/3; excluded by 2+ daughters unless a son's son at or below her level | hanafi-consensus |
| sunni.agnatic-descendants.residue-2-1 | Lower son's son with son's daughters | quran-4-11 |
| sunni.uterine.sixth / .third | Uterine siblings 1/6 or 1/3, male = female; excluded by a child, the father or the grandfather | quran-4-12 |
| sunni.full-sister.* / sunni.full-sisters.* | 1/2 or 2/3; residue 2 : 1 with a full brother; residue with a daughter | quran-4-176 |
| sunni.consanguine-sister.* | Like a full sister; 1/6 with one full sister; excluded by 2+ full sisters | quran-4-176 |
| sunni.siblings.excluded | By a son, son's son, the father or the grandfather (Hanafi) | hanafi-consensus |
| sunni.agnatic-residuary | Residuary walk: nearer line, nearer degree, full blood before consanguine | hanafi-consensus |
| sunni.aul | Shares total more than 1: all reduced proportionally | aul-umar |
| sunni.radd | Surplus to blood sharers in proportion (not to a spouse) | hanafi-consensus |
| sunni.radd.to-spouse | Sole spouse takes the surplus (`raddToSpouseWhenNoOtherHeir`) | pk-practice-radd-spouse |
| sunni.distant-kindred | Nearest class, then nearest degree, male 2 : female 1 (simplified, flagged "verify") | hanafi-dhawil-arham |
| escheat | No heir: Government / Baitul-Mal | escheat |
| mflo.s4.* | Statutory overlay after the sect rules | mflo-1961-s4 |
| bar.* | Capacity bars | bar-* |
| reserve.* | Pregnancy and missing heir | reserve-* |
| will.* | Bequests | will-* |

## Policy toggles (`PolicyToggles`)

| Toggle | Default | Effect |
|---|---|---|
| raddToSpouseWhenNoOtherHeir | true | A sole spouse takes the whole estate instead of it escheating |
| grandfatherExcludesSiblings | true (Hanafi) | false = siblings share with the grandfather |
| applyMFLOs4 | true | Apply MFLO 1961 s.4 |
| shiaChildlessWidowLandRule | classical | Shia module (Phase 4) |
| hinduDaughterOrder | benares | Hindu module (Phase 7) |
| policyVersion | 2026.10-draft | Stamped on every output |

## Known limits (Phase 1)

- **Distant kindred:** a simplified Hanafi order, flagged `needsVerification`.
- **Pregnancy and missing heirs together:** only the "son" scenario is used for the unborn child.
- **Removing an excluded heir:** the property test skips siblings on purpose. An excluded sibling still reduces the mother to 1/6 (hajb al-nuqsan), so removing one can change the result.
