# Data Sources for Synthetic Palliative Care Profile Generation

This document outlines open-access and public databases for training a synthetic profile generator for palliative care patients, focused on primary cancer conditions, functional performance, psychiatric comorbidities, and psychosocial/spiritual parameters.

---

## Access Level Overview
All datasets listed below are **fully public or instantly accessible** (requiring at most a simple, automated account creation without DUA, IRB approval, or credentialing processes).

---

## Phase 1: Primary Profile Backbone
*Goal: Establish the baseline joint distribution between primary cancer types, metastatic progression/stage, and functional performance scores (ECOG/Karnofsky).*

| Database | Access Level | Primary Utility | Key Variables Available |
| :--- | :--- | :--- | :--- |
| **1. TCGA Clinical Data** *(The Cancer Genome Atlas)* | **Direct Public Download** (NCI GDC Portal) | Primary Cancer Anchor & Baseline ECOG | Primary tumor site, tissue subtype, AJCC Pathologic Stage (Stage IV = Palliative cohort), baseline ECOG / Karnofsky Performance Scale (KPS) scores, age, sex, race, vital status. |
| **2. SEER Public-Use Data** *(Surveillance, Epidemiology, and End Results)* | **Instant Open Registration** (NCI SEER Portal) | Population-Level Survival & Stage Distribution | Cancer primary site, stage at diagnosis, initial treatment intent, organ-specific metastasis (brain, bone, liver, lung), survival months, basic demographics. |
| **3. cBioPortal for Cancer Genomics** | **Direct Download / Web API** | Aggregated Clinical Trial Cohorts | Combined clinical metadata across dozens of late-stage and metastatic cancer studies, including explicit baseline ECOG scores and systemic treatment histories. |

---

## Phase 2: Psychiatric, Functional & Psychosocial Imputation
*Goal: Train conditional distributions $P(\text{Psychiatric Outcome} \mid \text{Cancer Stage}, \text{ECOG}, \text{Demographics})$ to cross-map psychiatric diagnoses, medications, and spiritual variables onto the primary profiles.*

### A. Longitudinal & Population Health Datasets

1. **Health and Retirement Study (HRS)**
   * **Access:** Instant Open Access via *Gateway to Global Aging*.
   * **Key Variables:** Self-reported cancer history, functional impairment metrics (ADLs/IADLs mapping directly to ECOG), CES-D depression scores, anxiety metrics, antidepressant/psychotropic usage, extensive spiritual and religious practice variables, detailed socio-demographics.

2. **National Health and Aging Trends Study (NHATS)**
   * **Access:** Direct Public Download.
   * **Key Variables:** Late-life cancer diagnoses, physical capacity/mobility measures, PHQ-2 depression screeners, GAD-2 anxiety screeners, socio-demographic support systems, living situation.

3. **MIDUS (Midlife in the United States)**
   * **Access:** Open Access via ICPSR.
   * **Key Variables:** Psychosocial profiles, major depression and generalized anxiety clinical screeners, coping mechanisms, spiritual practice, religiosity, chronic health conditions.

4. **NHANES (National Health and Nutrition Examination Survey)**
   * **Access:** Direct CDC Public Domain Download.
   * **Key Variables:** Standardized PHQ-9 depression scores, prescription drug usage (standardized Multum category codes for antidepressants/anxiolytics), cancer history, detailed socio-demographic and economic variables.

---

### B. Open Psychiatric & Clinical Repositories

5. **OpenPsychiatry / Metapsy Data**
   * **Access:** Direct Download (Zenodo / Open Science Framework).
   * **Key Variables:** Meta-analytic and individual patient-level data containing standardized depression and anxiety rating scale distributions (PHQ-9, GAD-7, BDI).

6. **DAIC-WOZ (Distress Analysis Interview Corpus)**
   * **Access:** Direct Open Research Release.
   * **Key Variables:** Standardized benchmark dataset featuring PHQ-9 depression scores, psychiatric symptom severity, psychiatric history, and basic demographics.

7. **Human Connectome Project for Disordered Emotional States (HCP-DES)**
   * **Access:** Open Access Data Portal.
   * **Key Variables:** Trans-diagnostic depression and anxiety severity scores, clinical psychiatric diagnoses, symptom severity scales, medication profiles.

8. **MIND Set (Mental Illness and Neuroscience Discovery)**
   * **Access:** Open Access Repository.
   * **Key Variables:** Clinical psychiatric diagnoses paired with functional capacity measures, psychotropic medication profiles, and demographic metadata.

---

### C. Open Repositories & Synthetic Datasets

9. **Synthea Open EHR Datasets**
   * **Access:** 100% Open Source (GitHub / Synthea Releases).
   * **Key Variables:** Pre-generated longitudinal synthetic health records featuring mapped ICD-10 psychiatric diagnoses, antidepressant prescriptions, oncology trajectories, functional statuses, and social determinants of health (SDOH).

10. **Zenodo Psycho-Oncology Open Datasets**
    * **Access:** Direct CSV / Open File Downloads.
    * **Key Variables:** Searchable open-access datasets from published psycho-oncology studies linking cancer diagnosis, functional status (ECOG/KPS), and psychometric scale results (HADS, PHQ-9, GAD-7).

11. **Figshare Open Clinical Data**
    * **Access:** Direct CSV / Excel Downloads.
    * **Key Variables:** Open-access clinical datasets published alongside peer-reviewed medical articles containing individual patient rows with psychiatric symptom scores, cancer stages, and quality-of-life parameters.

---

## Strategy Summary for Team Review

```
[Phase 1 Baseline Generator]
  TCGA + SEER + cBioPortal
  ---> Generates: {Primary Cancer, Stage IV / Metastasis, Baseline ECOG, Age, Sex}
          |
          v
[Phase 2 Conditional Mapping]
  HRS + NHANES + NHATS + Open Psych Repos
  ---> Imputes: {Psychiatric Diagnosis, PHQ-9/GAD-7 Scores, Psych Meds, Spiritual Practice}
```
