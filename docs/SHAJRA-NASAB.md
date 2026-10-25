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
| 3 | API (save and share link), server PDF, units and land area per heir | ✅ Done (see below) |
| 4 | Shia (Ithna Ashari) module | ✅ Done |
| 5 | Christian and Parsi | ✅ Done |
| 6 | Munasakha (chained estates), Urdu polish, SVG export | ✅ Done |
| 7 | Hindu (Mitakshara), behind an on/off setting until legal review | ✅ Done (beta: `?beta=hindu`) |

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

**Interaction (updated 26 Oct 2026):** tapping a person opens a small menu with **Edit details**, **Add relative ▸** (father, mother, spouse, son, daughter, brother or sister, with Urdu names) and **Delete**. The add buttons in the side panel were removed. Keyboard: Tab to a person, Enter to open the menu, arrow keys to move, Escape to close.

**Patwari style:** ink lines on off-white paper, with no boxes. Each person is a short stroke with the name written under it (in Nastaliq when the name is typed in Urdu) and the share in brackets, coloured by result. Children hang from the father's line through a bar over the siblings; the mother's line is dashed and used only when no father is in the tree. A wife is attached beside her husband by a single line. The deceased is underlined and marked "متوفی".

**Matched to a real patwari sketch (26 Oct 2026):** checked against a sketch from a patwari (Zulfiqar Ali, dated 23-10-25).
- **Wives:** the name is written **inside** a sideways heart (a leaf with a small notch), with the point facing away from the husband. The first wife sits on the left of her husband and the second on the right, each joined to him by a line.
- **Children by mother:** each wife's children hang from their own bar, at a different height from the other wife's bar, joined to the husband's line. A family is centred under its parents.
- **People:** a son is a short stroke with the name under it; a daughter is a large Λ with the name under it.
- **Status in red Urdu:** **زندہ** (alive), **پہلے فوت شدہ** (died before the deceased), **بعد میں فوت شدہ** (died after), and **حال متوفی** beside the deceased.
- **Shares:** shown in brackets under the status.
- **Test case:** `frontend/e2e/shajra-patwari-sketch.mjs` recreates the sketch's family. Expected shares: each widow 1/16, each son 7/32, each daughter 7/64, and the predeceased son's daughter 7/32 (MFLO s.4).

**Chart symbols (revenue-record style, updated 26 Oct 2026):**
- **People:** male = short vertical branch line; daughter (or sister) = inverted V (Λ); wife or widow of a relation = heart turned 90° anticlockwise; a woman who is both a daughter of the family and a wife = the inverted V inside the heart.
- **Marks:** diagonal slash = died; dashed box = the deceased; dotted triangle = pregnant.
- **Lines:** double line = marriage; double line with two slashes = divorce; solid line = father line; dashed line = mother line. The legend appears under the chart and on print.

**Tested (Playwright, desktop 1280 px and phone 390 px)**
- Deceased plus widow, son, daughter and mother gives widow 1/8 (9/72), son 17/36 (34/72), daughter 17/72 (17/72), mother 1/6 (12/72), total 1 (72/72).
- No page errors, and the case survives a page reload.

**Known limits and follow-ups**
- **Layout:** works well for normal families. Very wide families scroll inside the chart box; in print they are scaled to the page width. A true "fit to A4" and page splitting for very large trees is planned with the server PDF (Phase 3).
- **Website build time:** about 6½ minutes (21,560 pages), up from about 1½ minutes before React was added. Most of it is the mouza pages. To check: run the React integration only on `/tools/` pages.
- **No QR code or share link yet:** both need the Phase 3 API.
- **Estate:** debts, dower, wills and land area can't be entered in the screen yet. The engine supports wills; area allocation comes in Phase 3.
- **Not done yet:** an accessibility review and a Lighthouse run.

## Phase 3: API, PDF, estate and land area (done, 26 Oct 2026)

**Engine (`packages/inheritance-engine/src/units.ts`)**
- **Exact land units:** murabba (25 acres), acre, kanal (1/8 acre), marla (1/20 kanal), sarsai (1/9 marla), ghunta (1/40 acre), sq ft, sq yd. Every conversion goes through square feet as an exact fraction.
- **Display:** `toMixed` / `formatMixed` split an area into whole units with an exact remainder, for example 1/7 kanal = "2 Marla 7 Sarsai (+5/7 Sarsai)".
- **Legacy money:** `toRupeeAnnaPie` (1 rupee = 16 anna, 1 anna = 12 pie).
- **Area per heir:** `compute()` adds `area` to every share for each property; the areas always add up to the property's total.
- **Tests:** 35 in all, 4 new for units.

**Server (dashboard backend, public, no login, no cookies)**

| Endpoint | What it does | Limit per connection |
|---|---|---|
| `POST /api/public/shajra/cases` `{ case }` | Checks the case by running the engine on the server, saves it, returns `{ id, shareUrl }` | 30 per hour |
| `GET /api/public/shajra/cases/:id` | Returns the saved case (the share link) | 300 per 15 min |
| `GET /api/public/shajra/law/:policyVersion` | Citation data (`law/citations.json`) | 300 per 15 min |
| `POST /api/public/shajra/pdf` `{ case }` | Saves the case, opens the website print view in Puppeteer, returns an A4 PDF | 10 per 10 min |

- **Storage:** `ShajraCase` model; cases are deleted automatically after **30 days**.
- **Checks:** at most 300 KB and 400 persons per case. A case the engine can't compute is refused (422). Nothing personal is logged.
- **The PDF and the screen are identical by construction:** Puppeteer prints the same React page with the same engine, using `?case=<id>&pdf=1`, and waits for the page to signal it has finished (`data-shajra-ready="1"`).
- **Server engine:** loaded straight from `packages/inheritance-engine/src` (Node 22.18+ runs TypeScript directly), so there's no build step. On the VPS, `packages/` must sit beside `backend/` in the checkout, which it does.
- **Security token:** `/api/public/shajra/` is exempt from the security-token check (public, no session).
- **Optional setting:** `SHAJRA_PRINT_BASE` changes the page Puppeteer prints from. The default is `SITE_URL`.
- **Server tests:** 37 in all, including the case checks.
- **Unrelated fix:** the per-user rate limit for All Mouzas could be bypassed using IPv6 addresses; it now uses the library's IPv6-safe helper (`ipKeyGenerator`).

**Website tool**
- **Estate section** (folded away by default):
  - Estate value, funeral costs, debts, unpaid dower.
  - Wills: beneficiary plus a share such as "1/4"; the engine limits wills to 1/3.
  - Properties: title, mouza, khewat/khatooni, and area in Kanal–Marla–Sarsai, Acre–Kanal–Marla, Murabba–Acre–Kanal, Acre–Ghunta, sq ft or sq yd.
- **Share table:** one area column per property, plus a total row showing the full property area.
- **New buttons:**
  - **Save & get link:** a 30-day link, copied to the clipboard.
  - **Download PDF:** made on the server. If it fails, the tool suggests **Print / Save PDF**.
- **Shared link:** opening `?case=<id>` loads that case without overwriting the visitor's own saved case.
- **Print / PDF header:** the deceased (with s/o), date of death, law, case ID, policy version, share link and a **QR code** for it.
- **Tested (browser, server answers simulated):**
  - 16 Kanal shared by widow, son and daughter: 2 Kanal / 9 Kanal 6 Marla 6 Sarsai / 4 Kanal 13 Marla 3 Sarsai, total 16 Kanal.
  - The share link appeared.
  - The shared-link print view loaded, signalled ready, and showed the QR code.
  - A PDF was produced from it, with no errors.
- **Not tested yet:** the server endpoints with a real database, and Puppeteer on the VPS. Both need testing after deploy.

**Notes**
- **Website build time:** about 5½ minutes for 21,560 pages, even with React limited to `/tools/`. The time comes from the number of mouza pages, not from React.
- **Grandchildren:** they currently get the same area unit as their property; the mixed-unit display is chosen from the property's first unit.

## Land units update (27 Oct 2026)

- **Default units:** **Kanal – Marla – Feet**, using the government standard **1 marla = 272 sq ft** (1 kanal = 20 marla = 5,440 sq ft). The engine units are `gkanal` and `gmarla`; the revenue standard (1 marla = 272.25 sq ft, with sarsai) is still available.
- **Whole feet per heir** (`allocateWholeSqft`): when a share doesn't divide into whole square feet, everyone first gets the whole feet below their exact share. The few feet left over go one each to the heirs with the largest leftover fractions; equal leftovers are settled by list order. The heirs' feet, plus any reserve or State share, then add up **exactly** to the property.
  - Example: 1 kanal (5,440 sq ft) among a widow (1/8), son (7/12) and daughter (7/24) gives 680 + 3,173 + 1,587 = 5,440.
  - A note is added to the computation notes whenever feet were rounded.
- **Share table:** for feet-based properties it shows these whole-feet results.

## Phase 4: Shia (done)

`src/rules/shia.ts` is a separate module, not a variation of the Hanafi rules.
- **Three classes:** I = parents and descendants; II = grandparents and siblings; III = uncles and aunts. A nearer class excludes all remoter ones; the spouse inherits with every class.
- **Representation:** descendants take a predeceased ancestor's place per stirpes (2 : 1), with no male-line preference.
- **No aul:** a shortfall falls on the daughters or sisters.
- **Radd:** the surplus goes to the blood heirs. The mother is left out of radd when she's reduced by brothers; there's no radd to a spouse. A sole husband takes everything; a sole widow follows the setting.
- **Mother's reduction to 1/6:** the father is alive together with 2 brothers, or 1 brother and 2 sisters, or 4 sisters.
- **No Umariyyatan:** the mother takes 1/3 of the whole estate.
- **Class II:** the father's side (full siblings, else half-siblings through the father, plus the paternal grandparents) shares 2 : 1. The mother's side (half-siblings through the mother, plus the maternal grandparents) shares equally: 1/6 for one person, 1/3 for more.
- **Class III:** paternal 2/3 and maternal 1/3. Classes II and III are flagged "verify".
- **Notes always added:** the childless-widow land setting (classical or equal) and Habwa.
- **Bars:** only intentional killing bars; a child born outside marriage inherits from neither parent.
- **Tests:** 8 golden cases.

## Phase 5: Christian and Parsi (done)

`src/rules/succession-act.ts`
- **Christian / other (Part V):**
  - Spouse: 1/3 with lineal descendants, 1/2 with other kindred, all with neither.
  - Descendants share equally regardless of gender, per stirpes.
  - Then: father (s.42); mother and siblings equally (s.43); mother alone (s.44); siblings (s.45); nearest kindred by degree (s.46–48, flagged "verify").
  - Full and half blood are equal. A child born outside marriage is not kindred. No religion bar.
- **Parsi (Chapter III, 1939 text, which Pakistan kept; India's 1991 amendment doesn't apply):**
  - s.51 (male): widow = son; daughter = half a son; father = half a son; mother = half a daughter.
  - s.52 (female): widower and each child equal.
  - With no children: spouse 1/2, the rest to parents, then siblings.
  - Always flagged "verify text".
- **Tests:** 6 golden cases.

## Phase 6: Munasakha, export and Urdu (done)

- **Engine** `combine(root, links)`: works out every final person's share of the **original** estate through chained sub-cases (to any depth). The shares, reserve and State share still sum to exactly 1.
- **Tool:**
  - An heir who died **after** the deceased gets a **Distribute onward →** button in the share table.
  - That button creates an "Onward" estate: the same family tree, with that heir as the deceased on their own date of death. Its law and family can be changed, and the heir's own new relatives added.
  - Tabs switch between estates, and an onward estate can be removed (with any below it).
  - A **Final shares of the original estate** table lists every person with the chain they inherit through.
  - Onward estates are saved, shared and exported together with the main case.
- **Export SVG:** downloads the pedigree chart as an SVG file. JSON import and export already existed.
- **Urdu:** Urdu headings in the share table, relation names in revenue-record terms, and the disclaimer in Urdu.
- **Tested in a browser:** father's widow 1/8 and two sons 7/16 each; the second son dies later, leaving his widow, mother and brother. Final shares: father's widow **13/48**, surviving son **119/192**, second son's widow **7/64**. No errors. Switching the law to Shia recalculates live.

## Phase 7: Hindu (done, beta)

`src/rules/hindu.ts`, shown in the tool only with **`?beta=hindu`**, plus a "Property type" choice.
- **Separate property:**
  - Sons, grandsons and great-grandsons share per stirpes.
  - The widow takes a son's share (1937 Act, limited estate). A predeceased son's widow shares in his branch.
  - With no male issue: the widow takes the whole as a limited estate.
  - Then, in order: daughters (Benares order noted, Bombay equal), daughters' sons, mother, father, full brothers, half-brothers, brothers' sons, father's mother, father's father.
  - Remoter heirs: entered manually.
- **Coparcenary:** the widow takes the deceased's interest under the 1937 Act. With no widow, the interest passes by survivorship to the coparceners, which is not computed.
- **Every result** is flagged "verify" and carries the note "custom may apply".
- **Tests:** 4 golden cases.

## Totals

- **Engine:** 56 tests, and the no-floats check is clean.
- **Server:** 37 tests.
- **Website build:** about 1½ minutes for 21,560 pages. The earlier 5–6-minute builds were caused by test servers left running at the same time.

## Remaining features (done, 27 Oct 2026)

1. **Hindu manual override:**
   - In Hindu mode, **Edit shares manually** turns the share column into input boxes (for example "1/4").
   - The manual shares apply only when they add up to exactly 1, and are then marked **manual**. Otherwise a warning shows the current total and the computed shares stay in place.
   - **Clear manual shares** resets them.
   - Overrides are saved with the case (`manualShares`), so they also travel in share links, PDFs and JSON.
2. **Urdu computation notes:** an **English / اردو** switch above the share table.
   - Every rule explanation is translated in `site/src/tools/shajra/labels-ur.ts`; a missing key falls back to English.
   - Relation names and the disclaimer were already bilingual.
3. **Accessibility:**
   - **Automated check:** axe-core (WCAG rules) on the tool shows **no violations**.
   - **Issues fixed:**
     - Contrast of the Print button and the citation text.
     - The chart was marked as an image while containing buttons; it is now a labelled group.
     - Each person node's accessible name now matches its visible text.
   - **Keyboard:** every person in the chart can be reached with Tab and selected with Enter or Space. The share table is the text alternative to the chart.
   - **Test script:** `frontend/e2e/shajra-a11y.mjs` runs axe and checks keyboard selection, the Urdu notes and the manual override, including the warning for an invalid total.
   - **Lighthouse:** not run, because it needs the deployed site. Run it on https://naqsha-zameen.com/tools/shajra-nasab/ after deploy.

## Still open / for legal review

1. **Legal sign-off:** every citation is `verified: false`. The reviewer should confirm the golden expectations in `packages/inheritance-engine/test/*.test.ts`, especially Shia classes II and III, Parsi s.54 and the Hindu order.
2. **Hindu manual override:** done (see above).
3. **Accessibility:** axe check clean (see above). Lighthouse is to be run on the live site.
4. **Live server check:** test the server PDF and share links on the VPS after deploy.
5. **Urdu rule texts:** done. Have a native reader proof-read `labels-ur.ts`.
