# Shajra Nasab & Inheritance Calculator: project log

A public tool on the website, at **https://naqsha-zameen.com/tools/shajra-nasab/** (menu: **Tools → Shajra Nasab & Inheritance**). The user builds the family of a deceased person and gets each heir's exact share, the legal reason for it, and a printable pedigree chart.

> Every output carries this disclaimer: *Computational aid, not legal advice. Verify with a lawyer / revenue officer.*

## Where the code lives

| Part | Path | Notes |
|---|---|---|
| Engine | `packages/inheritance-engine/` | Pure TypeScript with no dependencies, using exact `BigInt` fractions. Runs in the browser and in Node 22.18+ directly. Documentation: its [README](../packages/inheritance-engine/README.md) |
| Legal data | `packages/inheritance-engine/law/citations.json` | Versioned by `policyVersion`; every entry `verified: false` until legal review |
| Website tool (React island) | `site/src/tools/shajra/` | `ShajraApp.tsx` (screen), `Tree.tsx` (SVG chart), `layout.ts` (tree layout), `model.ts` (editing, autosave), `labels.ts` (EN/UR relation names, rule texts) |
| Pages | `site/src/pages/tools/index.astro`, `site/src/pages/tools/shajra-nasab/index.astro` | SEO metadata, structured data (WebApplication), print styles |
| Website config | `site/astro.config.mjs` | `@astrojs/react` added; `inheritance-engine` alias points at the package source |

**Decisions**
- **Location:** the tool is on the website (public, good for search), not on the dashboard.
- **React:** added to the website for this one page only; every other page stays plain HTML.
- **Engine:** an npm workspace package (`packages/*` added to the root workspaces). Its tests use Node's built-in test runner.
- **PDF (Phase 3):** reuse the server's existing Puppeteer to render the website's print view, so the screen and the PDF match.
- **Defaults:** Punjab, units kanal–marla–sarsai.

## Phase status

| Phase | Content | Status |
|---|---|---|
| 1 | Engine: fractions, relations, pipeline, Hanafi rules, aul/radd, MFLO s.4, explain log, tests | ✅ Done (31 tests) |
| 2 | Website route, menu entry, tree builder, live shares, share table, print view, autosave | ✅ Done (see below) |
| 3 | API (save and share link), server PDF, units and land area per heir | ⏳ Next |
| 4 | Shia (Ithna Ashari) module | — |
| 5 | Christian and Parsi | — |
| 6 | Munasakha (chained estates), Urdu polish, SVG export | — |
| 7 | Hindu (Mitakshara), behind an on/off setting until legal review | — |

## Phase 1: engine (done, 26 Oct 2026)

- **Pipeline:**
  1. Net estate.
  2. Will: at most 1/3, and no bequest to an heir without the other heirs' consent.
  3. Candidate heirs, derived from the family graph.
  4. Capacity bars: homicide, religion, adoption, illegitimacy, divorce, predeceased or simultaneous death.
  5. Hanafi rules.
  6. Aul, radd, distant kindred, escheat.
  7. MFLO s.4.
  8. Reservations: pregnancy and missing heirs.
  9. Invariants: shares sum to exactly 1, none negative.
- **Tests:** 25 textbook cases, 3 randomised checks (400 families) and fraction tests. The textbook cases are Umariyyatan, Minbariyya, aul to 7, 8, 9, 10, 13, 15 and 17, Himariyya and Akdariyya (Hanafi outcomes), radd, MFLO s.4, pregnancy, bars and wills.
- **Commands:** `npm test -w packages/inheritance-engine` · `npm run demo -w packages/inheritance-engine` · `npm run check:no-floats -w packages/inheritance-engine`
- **Known limits:**
  - Distant kindred is simplified and flagged "verify".
  - The non-Hanafi grandfather-with-siblings rule is flagged "verify".
  - Pregnancy and a missing heir together use only the "son" scenario.

## Phase 2: website tool (done, 26 Oct 2026)

**What the user can do**
1. **Law:** pick the law system. Sunni Hanafi, Shafi'i, Maliki and Hanbali are available; Shia, Christian, Parsi and Hindu are listed as "coming soon".
2. **Deceased:** enter the name, father's name, gender and date of death.
3. **Settings:** switch MFLO s.4 and "sole spouse takes the surplus" on or off.
4. **Family:** click any person on the tree to add a father, mother, spouse, son, daughter, brother or sister. Unbounded depth up and down.
   - Brothers and sisters are full siblings by default. Changing a person's Father or Mother in the editor makes them consanguine or uterine.
   - Parents who are missing when a sibling is added are created automatically and marked as having died.
5. **Person editor:** name, gender, alive or died with date (before or after the deceased matters), religion and CNIC. Special facts: pregnant widow, divorce type (revocable within iddat / irrevocable / khula), missing, adopted, born outside marriage, caused the death.
6. **Live results** on every change:
   - **Chart:** a share badge and colour on each person. Green = heir, grey hatched = excluded, amber = reserved, blue dashed = MFLO s.4.
   - **Share table:** name, relation in English and Urdu, CNIC, fraction, sihaam over the common base, percentage, and a total row proving the shares add up to 1.
   - **Not inheriting:** each excluded person with the reason.
   - **Computation notes:** numbered, with citation keys, the policy version, the settings used and the case ID.
7. **Save and share:** autosaves in the browser. Export and import the case as JSON. **Print / Save PDF** uses the browser's print with an A4 portrait layout, hiding the website header, footer and buttons.

**Chart symbols:** square = male, circle = female, diagonal slash = died, double border = the deceased, double line = marriage, double line with two slashes = divorce, dotted triangle = pregnant, solid line = father line, dashed line = mother line. The legend appears under the chart and on print.

**Tested (Playwright, desktop 1280 px and phone 390 px)**
- Deceased plus widow, son, daughter and mother gives widow 1/8 (9/72), son 17/36 (34/72), daughter 17/72 (17/72), mother 1/6 (12/72), total 1 (72/72).
- No page errors, and the case survives a page reload.

**Known limits and follow-ups**
- **Layout:** works well for normal families. Very wide families scroll inside the chart box; in print they are scaled to the page width. A true "fit to A4" and page splitting for very large trees is planned with the server PDF (Phase 3).
- **Website build time:** about 6½ minutes (21,560 pages), up from about 1½ minutes before React was added. Most of it is the mouza pages. To check: run the React integration only on `/tools/` pages.
- **No QR code or share link yet:** both need the Phase 3 API.
- **Estate:** debts, dower, wills and land area can't be entered in the screen yet. The engine supports wills; area allocation comes in Phase 3.
- **Not done yet:** an accessibility review and a Lighthouse run.

## Phase 3 plan (next)

- **API** (`backend/routes/shajraRoutes.js`, public and rate-limited):
  - `POST /api/public/shajra/cases` saves a case and returns `{ id, shareUrl }` (expires after 30 days).
  - `GET /api/public/shajra/cases/:id` returns a saved case.
  - `POST /api/public/shajra/pdf` returns a PDF made by Puppeteer from the website print view.
  - `GET /api/public/shajra/law/:policyVersion` returns the citation data.
- **Estate screen:** debts, funeral costs, dower, will(s), and properties with area in kanal–marla–sarsai, acre–ghunta, sq ft, sq yd or murabba.
- **Area per heir:** exact mixed units with exact remainders.
- **Print:** QR code for the case link on the printed page.
