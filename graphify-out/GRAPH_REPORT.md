# Graph Report - AcompanarIA-perfiles  (2026-09-14)

## Corpus Check
- 52 files · ~77,880 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 413 nodes · 793 edges · 23 communities
- Extraction: 93% EXTRACTED · 7% INFERRED · 0% AMBIGUOUS · INFERRED: 58 edges (avg confidence: 0.84)
- Token cost: 446,179 input · 0 output

## Community Hubs (Navigation)
- UI Graph Editor Frontend
- Core Agent & Schema Hub
- Clinical Instruments & Datasets
- Synthetic Generation Engine
- Synthetic Dataset Layer Pipeline
- TCGA Data Ingestion
- Clinical Consistency Validation
- ACOMPAÑAR Product Modules
- HTTP Server Handler
- DSM-5 Depressive Disorders
- PPS/HADS Undertreatment Studies
- SEER Data Aggregation
- ECOG Bayesian Network Training
- Metastatic Bayesian Network Training
- Therapy Modalities Reference
- DSM-5 Abridged Disorders
- Cachexia-Depression Study
- Family Functioning Study
- Depression-Survival Study
- DSM-IV Depression Screening Study
- Longitudinal Symptom Trajectory Study
- Cultural Variation HADS Study
- ECOG-HADS Correlation Study

## God Nodes (most connected - your core abstractions)
1. `ACOMPAÑAR — Algoritmo de Acompañamiento Paliativo` - 18 edges
2. `build_baseline_profile()` - 14 edges
3. `escapeHtml()` - 14 edges
4. `Real-Data Model Calibration Pipeline Spec` - 14 edges
5. `Data Sources for Synthetic Palliative Care Profile Generation` - 14 edges
6. `renderAll()` - 13 edges
7. `refreshTables()` - 13 edges
8. `Handler` - 12 edges
9. `getNode()` - 12 edges
10. `openNodeInspector()` - 12 edges

## Surprising Connections (you probably didn't know these)
- `Trastorno de Depresión Mayor (MDD)` --semantically_similar_to--> `Trastorno de Depresión Mayor (MDD)`  [INFERRED] [semantically similar]
  context/DSM-5-abreviado.pdf → context/dsm5.txt
- `Algoritmo ACOMPAÑAR (Spotify Analogy)` --semantically_similar_to--> `Data Analyst Agent`  [INFERRED] [semantically similar]
  presentacion_acompanaria.html → .claude/agents/02_data_analyst.md
- `AcompañarIA Generador de Perfiles Sintéticos (README)` --semantically_similar_to--> `graph_model.json Schema Persistence Format`  [INFERRED] [semantically similar]
  README.md → CLAUDE.md
- `Trastorno Depresivo Persistente (Distimia)` --semantically_similar_to--> `Trastorno Depresivo Persistente (Distimia)`  [INFERRED] [semantically similar]
  context/DSM-5-abreviado.pdf → context/dsm5.txt
- `Data Visualizer Agent` --semantically_similar_to--> `Tabbed UI Navigation (Grafo/Variables/Correlaciones/Análisis)`  [INFERRED] [semantically similar]
  .claude/agents/04_data_visualizer.md → ui/index.html

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Four-Stage Approval-Gated Calibration Pipeline** — requirements_stage_status_tracker, requirements_stage1_ecog_bn, requirements_stage2_schema_calibration, requirements_stage3_consistency_verification, requirements_stage4_xgboost_placeholder [EXTRACTED 1.00]
- **Multi-Agent Palliative Graph Build Network** — _claude_agents_00_orchestrator_orchestrator_agent, _claude_agents_01_clinical_researcher_clinical_researcher_agent, _claude_agents_02_data_analyst_data_analyst_agent, _claude_agents_03_frontend_architect_frontend_architect_agent, _claude_agents_04_data_visualizer_data_visualizer_agent, _claude_agents_05_privacy_ethics_privacy_ethics_agent, _claude_agents_06_clinical_consistency_reviewer_clinical_consistency_reviewer_agent [EXTRACTED 1.00]
- **Emotional/Psychological Cluster Drift Diagnosis & Fix** — handoff_emotional_cluster_rebalance, concept_measure_then_rescale, generator_clinical_consistency, _claude_agents_06_clinical_consistency_reviewer_clinical_consistency_reviewer_agent [INFERRED 0.85]
- **DSM-5 MDD Criteria and Specifiers Underpin the ACOMPAÑAR Recommendation Algorithm** — context_dsm5_trastorno_depresion_mayor, context_dsm5_especificadores_trastornos_depresivos, context_acompanar_algoritmo_v1_motor_recomendacion, context_acompanar_algoritmo_v1_documento [EXTRACTED 1.00]
- **HADS Instrument Shared Across Multi-Country Depression-in-Palliative-Care Study Corpus** — context_article_25_hads, context_article_21_hads, context_article_28_hads, context_articulo_13_hads, context_article_39_hads [INFERRED 0.85]
- **ESAS Symptom-Assessment Scale Links Empirical Studies to ACOMPAÑAR's Emotional Dimension** — context_article_27_esas, context_article_29_1_esas, context_acompanar_algoritmo_v1_esas_adapted [INFERRED 0.90]

## Communities (23 total, 0 thin omitted)

### Community 0 - "UI Graph Editor Frontend"
Cohesion: 0.07
Nodes (94): applyDimming(), applyEdgeStyle(), applyNodeStyle(), bind(), bindEdgeFieldListeners(), buildCorrHeatmap(), buildSimulation(), buildStaticSvgDefs() (+86 more)

### Community 1 - "Core Agent & Schema Hub"
Cohesion: 0.07
Nodes (42): Orchestrator Agent, Clinical Researcher Agent, Data Analyst Agent, Frontend Architect Agent, Data Visualizer Agent, Distance to Closest Record (DCR), Privacy & Ethics Auditor Agent, graph_model.json Schema Persistence Format (+34 more)

### Community 2 - "Clinical Instruments & Datasets"
Cohesion: 0.05
Nodes (49): El Cuidador como Puerta de Entrada al Sistema, Escala ESAS Adaptada (Dimensión Emocional), Perfil de Paciente (Ejes A/B/C), EORTC QLQ-C30, Hospital Anxiety and Depression Scale (HADS), Psychological Distress as Independent Driver of QoL, Not Merely a Symptom Proxy, Karnofsky Performance Status (KPS), Bužgová et al. 2015 — Anxiety/Depression and QoL (Czech Republic) (+41 more)

### Community 3 - "Synthetic Generation Engine"
Cohesion: 0.13
Nodes (27): model_ref Node Dispatch Mechanism, _apply_formula(), apply_hard_constraints(), _clip(), _clip_to_node(), generate(), _load_model_ref(), load_schema() (+19 more)

### Community 4 - "Synthetic Dataset Layer Pipeline"
Cohesion: 0.16
Nodes (20): _clip(), _cumulative_categorical_draw(), _layer1_demographics_oncology(), _layer2_organ_severity_functional(), _layer3_somatic_symptoms(), _layer4_pharmacology(), _layer5_psychological(), _layer6_caregiver_environment() (+12 more)

### Community 5 - "TCGA Data Ingestion"
Cohesion: 0.22
Nodes (20): best_treatment_outcome(), build_baseline_profile(), clean(), collect_treatments(), days_to_months(), days_to_years(), extract_normalized(), kps_to_ecog() (+12 more)

### Community 6 - "Clinical Consistency Validation"
Cohesion: 0.15
Nodes (18): Clinical Consistency Reviewer Agent, Measure-Then-Rescale Calibration Method, check_caregiver_vs_dependency(), check_demographic_plausibility(), check_ecog_functional_consistency(), check_pharmacology_vs_severity(), consistency_audit(), _present() (+10 more)

### Community 7 - "ACOMPAÑAR Product Modules"
Cohesion: 0.12
Nodes (18): BigQuery, Cloud DLP, Depresión en Pacientes con Enfermedades Neurológicas Degenerativas, ACOMPAÑAR — Algoritmo de Acompañamiento Paliativo, Equipo Iron, Límites del Asistente IA (No Diagnostica / No Prescribe), Módulo 02 — Álbum de Vida con Google Photos, Módulo 01 — Asistente Conversacional 24/7 (+10 more)

### Community 8 - "HTTP Server Handler"
Cohesion: 0.30
Nodes (4): BaseHTTPRequestHandler, _apply_refactor(), Handler, Post-process engine.generate()'s output through refactor_synthetic_dataset's…

### Community 9 - "DSM-5 Depressive Disorders"
Cohesion: 0.25
Nodes (11): Distinguishing Grief from Major Depressive Episode, Especificadores para Trastornos Depresivos, Otro Trastorno Depresivo Especificado, Otro Trastorno Depresivo No Especificado, Trastorno de Depresión Mayor (MDD), Trastorno Depresivo Inducido por una Sustancia/Medicamento, Trastorno Depresivo Debido a Otra Afección Médica, Trastorno Depresivo Persistente (Distimia) (+3 more)

### Community 10 - "PPS/HADS Undertreatment Studies"
Cohesion: 0.20
Nodes (10): Hospital Anxiety and Depression Scale (HADS), McGill Quality of Life Questionnaire — Hong Kong Chinese (MQOL-HK), Psychosocial Adjustment to Illness Scale (PAIS), Chan et al. 2012 — QoL in Advanced Gynecological Cancer (Hong Kong), Palliative Performance Scale (PPS), Under-Recognition and Under-Treatment of Depression in Palliative Settings, Escala Arábiga HADS (Validada por Terkawi et al. 2017), Alotaibi & Alsuhail 2025 — Depression/Anxiety Prevalence (Saudi Arabia) (+2 more)

### Community 11 - "SEER Data Aggregation"
Cohesion: 0.29
Nodes (9): main(), Run this LOCALLY, on the machine where your SEER export lives. Never share the…, Generic yes/no normalizer for chemo/radiation recode fields — SEER typically…, Returns {category: pct} for categories >= min_count, plus a…, Same Roman-numeral logic as training/train_ecog_bn.py's stage_to_bucket — AJCC…, site_to_schema_category(), stage_to_bucket(), suppressed_counter() (+1 more)

### Community 12 - "ECOG Bayesian Network Training"
Cohesion: 0.36
Nodes (9): age_to_bracket(), evaluate(), export_cpts(), load_training_frame(), main(), majority_baseline_accuracy(), Stage 1 — train a Bayesian Network for ecog_performance_status on real TCGA…, stage_to_bucket() (+1 more)

### Community 13 - "Metastatic Bayesian Network Training"
Cohesion: 0.39
Nodes (8): ajcc_m_to_metastatic(), evaluate(), export_cpts(), load_training_frame(), main(), majority_baseline_accuracy(), Stage 2 Tier B — train a Bayesian Network for metastatic_disease on real TCGA…, stage_to_bucket()

### Community 14 - "Therapy Modalities Reference"
Cohesion: 0.25
Nodes (8): Logoterapia de Frankl, Manual de Psicoterapias (Rodríguez Morejón, 2019), Mindfulness / ACT (Terapia de Tercera Generación), Terapia Cognitivo-Conductual (TCC), Terapia Centrada en la Persona (Rogers), Terapia Cognitiva (Beck), Terapia Gestalt, Terapia Racional Emotiva de Conducta (TREC)

### Community 15 - "DSM-5 Abridged Disorders"
Cohesion: 0.25
Nodes (8): Especificadores para Trastornos Depresivos, Trastorno de Depresión Mayor (MDD), Trastorno Depresivo Inducido por una Sustancia/Medicamento, Trastorno Depresivo Debido a Otra Afección Médica, Trastorno Depresivo Persistente (Distimia), Trastorno de Desregulación Disruptiva del Estado de Ánimo (DMDD), Trastorno Disfórico Premenstrual (PMDD), Trastornos Depresivos (DSM-5 Abreviado)

### Community 16 - "Cachexia-Depression Study"
Cohesion: 0.33
Nodes (6): Shared Pathogenesis Between Cachexia and Depression (CNS/HPA Axis), ECOG Performance Status, FAACT Anorexia Cachexia Subscale (FAACT ACS), Nutrition Impact Symptoms (NIS) Scale, Amano et al. 2024 — Nutrition Impact Symptoms and Depression (Japan), Patient Health Questionnaire-9 (PHQ-9)

### Community 17 - "Family Functioning Study"
Cohesion: 0.40
Nodes (5): ECOG Performance Status, FACES-III (Family Adaptability and Cohesion Evaluation Scales), Quality of Family Functioning as Depression Predictor (Not Presence/Frequency), Hospital Anxiety and Depression Scale (HADS), Park et al. 2018 — Family Adaptability/Cohesion Study

### Community 18 - "Depression-Survival Study"
Cohesion: 0.40
Nodes (5): Depression Severity as Independent Mortality Risk Factor, Eastern Cooperative Oncology Group Performance Status (ECOG-PS), Jung & Yun 2025 — Comorbid Depression, Proactive Coping & 1-Year Survival (Korea), Patient Health Questionnaire-9 (PHQ-9), Smart Management Strategy for Health Assessment Tool (SAT-SF)

### Community 19 - "DSM-IV Depression Screening Study"
Cohesion: 0.40
Nodes (5): DSM-IV, ECOG Performance Status (ECOG-PS), Edinburgh Depression Scale (EDS), Lloyd-Williams & Payne 2014 — Self-Harm Thoughts & Depression as Prognostic Factors (UK), Patient Health Questionnaire-9 (PHQ-9)

### Community 20 - "Longitudinal Symptom Trajectory Study"
Cohesion: 0.50
Nodes (4): EORTC QLQ-C15-PAL, Hospital Anxiety and Depression Scale (HADS), Depression as Trajectory Rather Than Static State, Rojas-Concha et al. 2023 — Longitudinal Symptom Study (Denmark)

### Community 21 - "Cultural Variation HADS Study"
Cohesion: 0.67
Nodes (3): Regional/Cultural Variation in Prevalence Beyond Clinical Factors, Hospital Anxiety and Depression Scale (HADS), Atinafu et al. 2022 — Anxiety/Depression in Palliative Cancer Patients (Ethiopia)

### Community 22 - "ECOG-HADS Correlation Study"
Cohesion: 0.67
Nodes (3): ECOG Performance Status Scale, Hospital Anxiety and Depression Scale (HADS), Islam & Biswas 2022 — Depression/Anxiety in Metastatic Breast Cancer (Bangladesh)

## Ambiguous Edges - Review These
- `Rojas-Concha et al. 2023 — Longitudinal Symptom Study (Denmark)` → `EORTC QLQ-C15-PAL`  [AMBIGUOUS]
  context/Article 16.txt · relation: references

## Knowledge Gaps
- **66 isolated node(s):** `FIXTURE_GRAPH`, `NODE_TYPES`, `RELATION_TYPES`, `STRENGTHS`, `state` (+61 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 129 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Rojas-Concha et al. 2023 — Longitudinal Symptom Study (Denmark)` and `EORTC QLQ-C15-PAL`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
- **Why does `Tabbed Graph UI Rebuild (Round 2)` connect `Core Agent & Schema Hub` to `UI Graph Editor Frontend`?**
  _High betweenness centrality (0.109) - this node is a cross-community bridge._
- **Why does `Real-Data Model Calibration Pipeline Spec` connect `Core Agent & Schema Hub` to `Synthetic Generation Engine`, `TCGA Data Ingestion`, `Clinical Consistency Validation`?**
  _High betweenness centrality (0.084) - this node is a cross-community bridge._
- **Why does `Round 3 — ECOG Bayesian Network Calibration Pipeline` connect `Synthetic Generation Engine` to `Core Agent & Schema Hub`, `ECOG Bayesian Network Training`, `TCGA Data Ingestion`?**
  _High betweenness centrality (0.047) - this node is a cross-community bridge._
- **What connects `FIXTURE_GRAPH`, `NODE_TYPES`, `RELATION_TYPES` to the rest of the system?**
  _66 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `UI Graph Editor Frontend` be split into smaller, more focused modules?**
  _Cohesion score 0.06951754385964912 - nodes in this community are weakly interconnected._
- **Should `Core Agent & Schema Hub` be split into smaller, more focused modules?**
  _Cohesion score 0.06547619047619048 - nodes in this community are weakly interconnected._