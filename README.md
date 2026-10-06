# AHP Stakeholder Survey — ENTRANCE Horizon EU

Web survey implementing the Analytic Hierarchy Process (AHP) for KPI selection in building renovation. Respondents prioritise criteria through guided pairwise comparisons; submissions are stored privately for analysis.

**Live survey:** https://edoardoscalera.github.io/AHP/

## About the Survey

The Work Package 2 of the Horizon EU ENTRANCE project aims to define a methodology to assess building performance that could support the identification of effective renovation strategies towards more electrified, energy efficient and flexible buildings.

A building renovation involves a multiplicity of, often opposing, objectives, perspectives, constraints, and variables, that must be properly quantified to evaluate alternatives. WP2 employs the Analytic Hierarchy Process (AHP), a multi-criteria decision-making method, to translate subjective opinions into commensurable quantities and priority scores.

The goal of this survey is to gather information on stakeholders to support the selection of performance indicators that can provide meaningful and relevant information for a building renovation.

## How It Works (respondent flow)

1. **Access code** — shared code unlocks the survey, verified server-side (never in page source).
2. **Respondent** — name, role, pilot, country (required), email (optional), renovation under consideration Yes/No + details, consent checkbox.
3. **Decision criteria** — 7 defaults (uncheck irrelevant, add your own; 3–9 active, matrix adapts).
4. **Priority levels** — drag criteria into tiers A (top) / B (mid) / C (low); keyboard accessible (arrows, A/B/C keys).
5. **Guided comparisons** — ~n(n−1)/4 questions from a spanning tree (hub = first Tier-A), Yes/No/Equal + 2–9 scale with tier-based recommended highlights (non-binding) and transitive hints.
6. **Review matrix** — green = your judgment, yellow = estimated via logarithmic least-squares inference (capped at the 1–9 scale, click to override).
7. **Consistency + plot** — CR shown with warn-but-submit over 0.10; live priority bar chart (Chart.js CDN, table fallback offline).
8. **Submit** — stored privately; drafts kept locally in the browser.

## Decision Criteria (7 default)

| # | Criterion | Notes |
|---|-----------|-------|
| 1 | Energy performance | Primary energy, savings, CO₂, energy label |
| 2 | Water use | Consumption efficiency, wastewater, reuse |
| 3 | Climate impact | GHG emissions, carbon footprint, resilience |
| 4 | Economic performance | Costs, savings, payback, NPV, IRR, LCC |
| 5 | Indoor Environmental Quality (IEQ) | Thermal comfort, IAQ, visual, acoustic |
| 6 | Energy system integration | Demand response, flexibility, grid interaction, SRI |
| 7 | Practical implementation | Technical feasibility + social impact merged |

## Architecture

```text
Browser (GitHub Pages, public repo EdoardoScalera/AHP)
  | POST {accessCode + response}  Origin: https://edoardoscalera.github.io
  v
Cloudflare Worker entrance-submission-api  (holds GITHUB_TOKEN + access code as secrets)
  | PUT contents API, branch main
  v
Private repo EdoardoScalera/entrance-survey-responses  data/submissions/<ts>-<uuid>.json
```

The browser never sees the GitHub token or the real access code. The Worker URL in `js/config.js` is public and safe. Raw responses live only in the private repo (schema v5: respondent incl. renovation, criteria/tiers/pairwise provenance, weights, CR).

## Repository Structure (this public repo)

```text
AHP/
├── index.html              # Survey page (entry point)
├── css/style.css
├── js/
│   ├── ahp-core.js         # AHP math + incomplete-matrix LLS completion
│   ├── guided.js           # Spanning-tree order, transitive hints
│   ├── ui.js               # Wizard UI (criteria, tiers, guided, review, drafts)
│   ├── plot.js             # Results chart (Chart.js) + table fallback
│   ├── auth.js             # Access-code gate (server-verified)
│   ├── storage.js          # Worker API client (no secrets)
│   ├── config.js           # WORKER_URL only (public, no secrets)
│   ├── config.example.js
│   └── app.js              # Init + wiring
├── data/criteria.json      # 7 default criteria
├── docs/                   # Survey doc, paper, reference matrices
├── plan_readme.md          # Workflow planning notes
└── .github/workflows/deploy.yml  # Pages deploy
```

Sibling projects (separate checkouts, not in this repo): `entrance-survey-responses` (private data), `entrance-submission-api` (Worker source).

## Submission Schema (v5, no accessCode stored)

```json
{
  "schemaVersion": 5,
  "submissionId": "<uuid>",
  "submittedAt": "<ISO>",
  "respondent": {"name":"...","role":"...","pilot":"...","country":"...","email":"...","renovationUnderConsideration":true,"renovationDetails":"..."},
  "criteria": {"activeIds":[...],"excludedIds":[...],"custom":null,"customCriteria":[],"criteriaSet":"v3-7"},
  "tiers": {"<id>":"A|B|C"},
  "pairwise": {"order":[[...]],"answers":[{"a":"...","b":"...","value":3}],"estimated":[[false]]},
  "ahp": {"matrix":[...],"weights":[...],"cr":0.05,"consistent":true,"missingCriteria":"","consent":true},
  "_meta": {"workflow":"cloudflare-worker"}
}
```

## Local Development

```powershell
cd "C:\Users\scalere1\OneDrive - Tallinna Tehnikaülikool\Documents\GitHub\AHP"
python3 -m http.server 8000
# open http://localhost:8000 (point js/config.js at local Worker for end-to-end)
```

Worker (sibling folder `entrance-submission-api`):

```powershell
npx wrangler dev            # local, reads .dev.vars (never commit)
.\test-local.ps1 -AccessCode "<test-code>"
npx wrangler secret put SUBMISSION_ACCESS_CODE
npx wrangler secret put GITHUB_TOKEN   # fine-grained PAT: private repo, Contents RW
npx wrangler deploy
```

No build step — pure HTML/CSS/JS (+ pinned Chart.js CDN with SRI) for Pages compatibility.

## Operations

* **Change access code:** `npx wrangler secret put SUBMISSION_ACCESS_CODE` (live in seconds, no deploy).
* **Rotate PAT:** new fine-grained token (private repo only) → `npx wrangler secret put GITHUB_TOKEN`; record expiry.
* **Private data:** collaborators minimal + 2FA; GDPR retention/deletion per ENTRANCE plan; never copy submissions to the public repo.
* **Pages:** Settings → Pages → Source: GitHub Actions; deploys on push to `main`.

## AHP Equations Reference

| Eq | Formula | Description |
|----|---------|-------------|
| 1 | a_ji = 1/a_ij, a_ii = 1 | Reciprocal property |
| 2 | ā_ij = a_ij / Σ_k a_kj | Column normalization |
| 3 | w_k = (1/n) Σ_j ā_ij | Weight vector (row averages) |
| 9 | CR = CI / RI_n, CI = (λ_max − n)/(n−1) | Consistency check (warn-but-submit over 0.10) |
| LLS | min Σ (ln a_ij − (y_i − y_j))² over known pairs | Incomplete-matrix completion, capped at 1/9–9 |

RI: n=3: 0.58, 4: 0.9, 5: 1.12, 6: 1.24, 7: 1.32, 8: 1.41, 9: 1.45.

## References

* Survey: `docs/AHP_survey.docx`
* Paper: `docs/ENTRANCE_Analytic_Hierarchy_Process_for_KPI_selection_6.pdf`
* Reference matrices: `docs/stakeholder_matrix_ahp.xlsx`, `docs/stakeholder_matrix_ahp_CIT_260930.xlsx`
* KPI list: `docs/Analytic Hierarchy Process.xlsx`
