# Stage 1 Manual QA Checklist

For Santiago/David/Cristian to verify before approving Stage 1 in `requirements.md` §0.
Run from the repo root (`/home/daemonpalace/Documents/AcompanarIA-perfiles`).

## A. Environment

- [ ] `python3 -c "import pgmpy, pandas, sklearn; print('ok')"` prints `ok` with no error.
- [ ] `models/ecog_bn.pkl`, `models/ecog_bn_cpts.json`, `reports/stage1_ecog_bn_eval.md` all exist.

## B. Schema sanity (read, don't run anything)

- [ ] `schema/graph_model.json` → `metadata.version` is `"1.3.0"`.
- [ ] The `ecog_performance_status` node has `"evidence_tier": "real_data"` and a `"model_ref"` block (`{"model": "ecog_bn.pkl", "predictors": ["disease_stage", "age_bracket"]}`).
- [ ] Edge `e_metastatic_disease_ecog_performance_status` is **gone** from `edges[]` (superseded, per requirements.md Rule 6).

## C. Run the app locally and generate

- [ ] `python3 server.py --port 8765`
- [ ] Open `http://localhost:8765` in a browser.
- [ ] Go to **Grafo Visual** → click the "Generar Dataset" trigger with a default `n` → a CSV/JSON result comes back with no error.
- [ ] Go to **Análisis de Datos** tab → `ecog_performance_status` appears in the stat tiles / frequency bars with no crash.

## D. Confirm the model is actually driving ECOG (not just "not crashing")

- [ ] Generate twice with two different seeds → `ecog_performance_status` values differ between runs (it's sampled stochastically from the model's posterior, not a fixed constant).
- [ ] Compare rows where `disease_stage = "Terminal"` vs `disease_stage = "Stage 1 (Mild)"` — Terminal rows should skew toward higher ECOG on average. **Set expectations honestly here**: the model ties the majority-class baseline in evaluation (see `reports/stage1_ecog_bn_eval.md`), so this trend may be subtle, not dramatic — that's the documented finding, not a bug if it looks weak.
- [ ] Group generated rows by `ecog_performance_status` and check mean `functional_autonomy_adl` — should now descend cleanly across ECOG 0→4 (roughly 95/74/50/26/14 in testing). This is the `refactor_synthetic_dataset.py` integration (see `HANDOFF.md` Round 3 follow-up) — unlike ECOG's own accuracy, this relationship should be visibly strong, not subtle, since it's a deterministic-ish formula, not a sparse-data model.
- [ ] Pick a row with good `functional_autonomy_adl` (>70), `cognitive_function_mmse` >20, and `communication_capacity` = "Fluent verbal" — `instrumental_autonomy_iadl` should be at least ~3-4 (0-8 scale), not near 0. This was a real bug found via manual QA (fixed same round — see `HANDOFF.md`).
- [ ] Confirm `ecog_performance_status` values look real-data-plausible, not literature-formula-plausible — this was the critical regression fixed same round (refactor pass was silently discarding the Stage 1 model's output). No single-row way to fully verify this from the UI alone; if in doubt, ask to see the 0-mismatch verification from this session's transcript.

## E. Read the honest result

- [ ] Open `reports/stage1_ecog_bn_eval.md`. Confirm you understand: 490 usable cases, majority-baseline-tying accuracy (0.500), the coverage-ceiling explanation, and why `primary_site_group` wasn't wired in.

## F. Regression check (nothing else should have changed)

- [ ] **Variables** tab still lets you edit/add/delete nodes normally.
- [ ] **Correlaciones y Relaciones** tab still lets you edit/add/delete edges normally.
- [ ] Export/Import JSON buttons still work.

## G. Docker build (optional — only if you want to check the deploy path too)

- [ ] `docker build -t acompanaria-test .` succeeds.
- [ ] `docker run -e PORT=8080 -p 8080:8080 acompanaria-test`, then `curl http://localhost:8080/api/schema` returns 200.

## H. Privacy / git hygiene

- [ ] `git status` — confirm `data/` and `context/data.json` do **not** appear as untracked files ready to be added (they should be invisible, gitignored — real patient data must never get staged).

---

If everything above checks out, approve Stage 1 by updating its row in `requirements.md` §0 (Status → `Approved`, fill in `Approved by`/`Date`) — that's the literal gate before Stage 2 work can start.
