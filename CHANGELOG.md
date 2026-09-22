# Changelog

All notable changes to NeuroSentinel AI are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [V4.0.1] — 2026-04-28 · Suspicious-State Reporting Patch

### Fixed
- **Reporting consistency** — eliminated contradictory output where the system simultaneously reported "No Seizure" (result label), "Seizure-pattern activity detected" (SCOUT), and "0 segments flagged" (UI) for the same recording
- **Diagnostic state machine** — introduced canonical 3-state machine (`DETECTED` / `SUSPICIOUS` / `CLEAR`) as single source of truth for all downstream reporting layers

### Added
- `SUSPICIOUS` diagnostic state: fires when model detects seizure-like probability spikes (`raw_prob_max > 0.5` or `seizure_ratio > 0.05`) but post-processing filters suppress all events
- `suppressed_candidates` JSON object emitted in `SUSPICIOUS` state for full transparency
- `_derive_suspicious_risk()` — evidence-burden-weighted risk score (0–10) for `SUSPICIOUS` recordings
- State-aware SCOUT responses (patient narrative, event Q&A, severity guidance, health tips) for all 3 states
- 3-way email logic: `DETECTED` / `SUSPICIOUS` / `CLEAR` subject lines and body copy
- PDF §4 event section now state-aware; `SUSPICIOUS` shows candidate window count and max probability
- Pill-style reliability badge with WCAG AAA contrast (emerald / amber / red)
- `🔍` empty state UI card for `SUSPICIOUS` with suppressed-candidate explanation

### Changed
- `SCOUT` opening line, event detail, and health tips are now diagnostic-state-aware
- Report page header changed from `sticky` → `fixed` to prevent disappearing on client-side nav
- `RELIABILITY_CONFIG` contrast values updated

### Not Changed
- Model weights (`multirep_best_model_v4.pt`)
- Inference pipeline (`inference.py`)
- Post-processing thresholds or domain-adaptive tiers
- Preprocessing pipeline (`preprocessing.py`)
- Training data, splits, or evaluation metrics

---

## [V4.0.0] — 2026-04 · Production Release

### Added
- **MultiRepEEGModel V4** — 3-branch fusion: EEGNetCNN + Transformer | Spectrogram CNN | Band Power MLP (409,154 params)
- Domain-adaptive post-processing: 4-tier adaptive thresholds driven by output-based domain shift detection
- Seizure-aware fallback: retries with permissive thresholds if moderate/high domain shift suppresses real seizures
- 53-configuration post-processing sweep → winning config `ADP_p99_d15_mm0.9_s5`
- Full explainability pipeline: GradCAM (temporal), attention maps (topographic), representative window ID
- Clinical report generation (JSON + Markdown + PDF via ReportLab)
- SCOUT AI assistant (Gemini-powered, seizure-type Q&A)
- Email delivery to clinician on report completion
- FastAPI backend with chunked memory-safe inference (50-window chunks, ≤4 MB each)
- Next.js 14 frontend: upload zone, job polling, interactive report viewer
- Supabase integration (auth, database, EDF storage, PDF storage, model weight storage)
- Docker container for Hugging Face Spaces deployment
- GitHub Actions keep-alive cron for HF Space

### Evaluated
- CHB-MIT test set: Macro F1 = 0.979, ROC-AUC = 0.980, Event Sensitivity = 73.3%, FP/h = 0.98
- Zero-shot Siena Scalp EEG: Event Sensitivity = 80.0%, FP/h = 1.67

---

## [V3.0.0] — Discarded (Alpha Bug)

### Notes
- Same architecture as V1; `alpha=[1.0, 20.13]` corrupted focal loss class weights
- Model trained with incorrect positive-class weight — discarded, not deployed

---

## [V1.0.0] — Discarded (Alpha Bug)

### Notes
- First attempt at MultiRepEEGModel; focal loss `alpha` bug (`alpha=[1.0, 20.13]`)
- Root cause: `n0/n1` ratio computed incorrectly — produced 20× upweighting of seizure class
- Fixed in V4 by recomputing class weights from actual training set counts

---

## [V5.0.0] — Discarded (Overfitting)

### Notes
- Larger, deeper architecture than V4
- Overfit on training set; no improvement on validation
- Discarded in favor of V4

---

## Versioning Note

> V2 was skipped intentionally. V1 → V3 → V4 reflects internal session numbering.
> V5 was evaluated and discarded. V4.0.1 is the current production version.
