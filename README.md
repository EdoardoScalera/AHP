# AHP Stakeholder Survey Web Application

**Project**: ENTRANCE Horizon EU - Analytic Hierarchy Process for KPI Selection in Building Renovation

## 📋 Project Overview

This web application implements the Analytic Hierarchy Process (AHP) to collect stakeholder pairwise comparisons for 8 renovation criteria, calculate priority weights with consistency checking, and automatically save results to a GitHub repository.

**Goal**: Visitors fill in the pairwise comparison matrix behind a shared password, and their responses are automatically committed to `data/submissions/` for analysis.

**Authentication model (no OAuth)**:
- Shared password `ENTRANCE25` gates the submit button (SHA-256 hash checked in JS, plaintext not in source).
- One shared fine-grained GitHub PAT (`contents:write`, this repo only) stored in `js/config.js` performs the commit.
- Respondent identity comes from form fields: **name, role, pilot name, country** — stored in the submission JSON and used as the git commit author.
- ⚠️ **Tradeoff**: a public GitHub Pages site exposes its source, so a determined visitor can extract the PAT or password hash. This is accepted for the project; remedy is token rotation. Do not reuse the PAT elsewhere.

---

## 🗂️ Repository Structure

```
ahp-survey/
├── index.html              # Main survey page (GitHub Pages entry point)
├── css/
│   └── style.css           # Styling
├── js/
│   ├── ahp-core.js         # AHP calculation engine (Phase 1)
│   ├── ui.js               # Survey UI logic (Phase 2)
│   ├── auth.js             # Shared-password gate (Phase 3)
│   ├── storage.js          # GitHub API data persistence (Phase 4)
│   ├── config.js           # PAT, repo name, password hash
│   └── app.js              # Main application initialization
├── data/
│   ├── criteria.json       # Criteria definitions (8 criteria)
│   └── submissions/        # Individual submissions (auto-generated)
│       └── {name}_{timestamp}.json
├── docs/
│   ├── AHP_survey.docx     # Original survey document
│   ├── ENTRANCE_Analytic_Hierarchy_Process_for_KPI_selection.pdf
│   └── stakeholder_matrix_ahp.xlsx
├── .github/
│   └── workflows/
│       └── deploy.yml      # GitHub Pages deployment
├── README.md               # This file
└── package.json            # Optional: for local dev dependencies
```

---

## 📦 Files Required for Implementation

### **Must Provide (from current directory)**

| File | Purpose | Phase |
|------|---------|-------|
| `ENTRANCE_Analytic_Hierarchy_Process_for_KPI_selection.pdf` | Reference paper with AHP equations (Eq 1-9) | 1 |
| `AHP_survey.docx` | Survey instructions, criteria definitions, example matrix | 2 |
| `stakeholder_matrix_ahp.xlsx` | Reference matrix with formulas, RI table, validation values | 1, 2 |
| `Analytic Hierarchy Process.xlsx` | Full KPI list (54 KPIs across 7 groups) for Phase 5 | 5 |

### **You Create Once (before going live)**

| Item | Where | Steps |
|------|-------|-------|
| Fine-grained PAT | GitHub → Settings → Developer settings → Fine-grained tokens | Scope: this repo only, permission **Contents: Read and write**; paste into `js/config.js` |
| Password hash | Computed once | `SHA-256("ENTRANCE25")` hex → paste into `js/config.js` |
| GitHub Pages | Repo → Settings → Pages | Source: **GitHub Actions** |

### **Will Be Created During Implementation**

| File | Created In | Description |
|------|------------|-------------|
| `data/criteria.json` | Phase 1 | 8 criteria with descriptions from survey |
| `data/submissions/*.json` | Phase 4 | Auto-generated on each submission |

---

## 🛣️ Implementation Roadmap

### **Phase 1: Core AHP Engine** ⬅️ START HERE
**File**: `js/ahp-core.js`

**Requirements from documents**:
- 8 criteria from survey: Energy performance, Water use, Climate impact, Economic performance, IEQ, Energy system integration, Technical feasibility, Social impact
- Pairwise comparison matrix (8×8) with reciprocals (Eq 1)
- Normalization by column sums (Eq 2)
- Weight vector as row averages (Eq 3)
- λ_max calculation (Eq 6)
- CI = (λ_max - n)/(n-1) (Eq 7)
- CR = CI/RI_n (Eq 8) with Saaty's RI table
- Threshold: CR ≤ 0.10

**Reference values from Excel**:
- RI values: n=1:0, 2:0, 3:0.58, 4:0.9, 5:1.12, 6:1.24, 7:1.32, 8:1.41, 9:1.45, 10:1.49
- Test matrix in Excel rows 8-15 for validation

**Exports**:
```javascript
{
  calculateWeights(matrix),        // Returns { weights, lambdaMax, CI, CR, consistent }
  normalizeMatrix(matrix),
  calculateLambdaMax(matrix, weights),
  getRI(n),
  validateMatrix(matrix)
}
```

---

### **Phase 2: Survey Interface**
**Files**: `index.html`, `css/style.css`, `js/ui.js`

**Features**:
- Identity fields: **name, role, pilot name, country** (required before submit)
- 8×8 matrix with upper-triangle inputs (lower auto-fills reciprocals)
- Input validation: 1-9 integers, or fractions (1/9 to 1/1)
- Real-time CR display with color coding (green ≤0.10, red >0.10)
- Criteria definitions from `AHP_survey.docx`:
  - Energy performance
  - Water use
  - Climate impact
  - Economic performance
  - Indoor Environmental Quality (IEQ)
  - Energy system integration
  - Technical feasibility
  - Social impact
- Example from docx: "Energy performance (A) - Social impact (B): A more important → 7; A less important → 1/7"
- "Did we neglect some criteria?" free-text field
- Save draft / Submit buttons

---

### **Phase 3: Shared-Password Gate**
**File**: `js/auth.js`

**Mechanism** (no OAuth, no server):
1. On load, page shows a password prompt; submission stays locked until it passes.
2. User types `ENTRANCE25`; JS computes SHA-256 and compares against the hash in `js/config.js`.
3. Match → unlock identity fields and Submit; mismatch → error, stay locked.
4. Plaintext password never appears in source; only its hash does (see tradeoff above).

---

### **Phase 4: GitHub Data Persistence**
**File**: `js/storage.js`

**Mechanism**: GitHub REST API via Octokit.js using the shared PAT from `js/config.js`
- On submit: Create file `data/submissions/{name-slug}_{timestamp}.json`
- Commit directly to `main` branch
- Commit author = name (and role/pilot) from the identity form
- File content:
```json
{
  "name": "Jane Doe",
  "role": "Building Owner",
  "pilot": "Tallinn pilot",
  "country": "Estonia",
  "timestamp": "2026-09-30T10:30:00Z",
  "matrix": [[1, 3, ...], [...], ...],
  "weights": [0.25, 0.15, ...],
  "cr": 0.05,
  "consistent": true,
  "missingCriteria": "User comment"
}
```

**Permissions needed**: PAT with `contents: read and write` on this repository only.

---

### **Phase 5: Admin Dashboard** (Optional, later)
**File**: `admin.html` (separate page, password-protected)

**Features**:
- List all submissions with CR status
- Aggregate weights (geometric mean across stakeholders)
- Export CSV for analysis
- Flag inconsistent submissions (CR > 0.10)

---

### **Phase 6: Deployment**
**File**: `.github/workflows/deploy.yml`

```yaml
name: Deploy to GitHub Pages
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v4
      - uses: actions/upload-pages-artifact@v3
        with:
          path: '.'
      - uses: actions/deploy-pages@v4
```

**Enable**: Settings → Pages → Source: GitHub Actions

---

## 🔧 Local Development Setup

```bash
# Clone repo
git clone https://github.com/<username>/ahp-survey.git
cd ahp-survey

# Serve locally (any static server)
npx serve .           # or: python3 -m http.server 8000

# Open http://localhost:8000
```

**No build step required** - pure HTML/CSS/JS for GitHub Pages compatibility.

---

## 📐 AHP Equations Reference (from PDF)

| Eq | Formula | Description |
|----|---------|-------------|
| 1 | a_ji = 1/a_ij, a_ii = 1 | Reciprocal property |
| 2 | ā_ij = a_ij / Σ_k a_kj | Column normalization |
| 3 | w_k = (1/n) Σ_j ā_ij | Weight vector (row averages) |
| 4 | Σ_i p_ik = 1 | Option scores sum to 1 |
| 5 | Aw = λ_max w | Eigenvalue problem |
| 6 | λ_max = (1/n) Σ_i (Aw)_i / w_i | Principal eigenvalue |
| 7 | CI = (λ_max - n)/(n-1) | Consistency Index |
| 8 | CR = CI / RI_n | Consistency Ratio |
| 9 | P_i = Σ_k w_k p_ik | Global priority ranking |

---

## 🎯 Acceptance Criteria

| Criterion | Test |
|-----------|------|
| Password gate | Wrong password keeps submit locked; `ENTRANCE25` unlocks it |
| Matrix input | 8×8, reciprocals auto-fill, 1-9 scale |
| CR calculation | Matches Excel reference (CR ≈ 0.05 for test matrix) |
| Consistency flag | Green ≤0.10, Red >0.10 |
| Identity | Name/role/pilot/country required; commit author = name |
| Data save | JSON file appears in `data/submissions/` after submit |
| Deployment | Live at `https://<user>.github.io/ahp-survey/` |

---

## 📞 Contact & References

- **Paper**: ENTRANCE_Analytic_Hierarchy_Process_for_KPI_selection.pdf
- **Survey**: AHP_survey.docx
- **Reference Implementation**: stakeholder_matrix_ahp.xlsx
- **KPI List**: Analytic Hierarchy Process.xlsx

---

## 🚀 Next Steps (in the new GitHub repo conversation)

1. **Create GitHub repo** named `ahp-survey`
2. **Add these files** to the repo:
   - This `README.md`
   - `ENTRANCE_Analytic_Hierarchy_Process_for_KPI_selection.pdf`
   - `AHP_survey.docx`
   - `stakeholder_matrix_ahp.xlsx`
   - `Analytic Hierarchy Process.xlsx`
3. **Create fine-grained PAT** (this repo, Contents: read/write) — note it down, it goes into `js/config.js`
4. **Enable GitHub Pages** (Settings → Pages → Source: GitHub Actions)
5. **Share repo URL** with the assistant in a clean conversation

Then implementation starts with **Phase 1 (ahp-core.js)**, unit-tested against the Excel reference values, followed by Phases 2–6.

---

*Generated: 2026-09-30 | Project: ENTRANCE Horizon EU*
