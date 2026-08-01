/* Esquema por defecto de variables para el generador de perfiles sintéticos ACOMPAÑAR.
   Fuentes:
   - [ALGO] ACOMPAÑAR_Algoritmo_v1.pdf, sección 4 (Variables de Entrada del Sistema)
   - [EFEN] Efendioglu et al. 2021, "Malnutrition and Depressive Symptoms in Elderly
     Palliative Care Patients" (correlaciones MNA-SF / GDS-15 / ADL / IADL / MMSE)
   - [GONT] Gontijo Garcia et al. 2023, "Anxiety and depression disorders in
     oncological patients under palliative care" (funcionalidad, fatiga, apetito,
     náusea como factores de riesgo/protectores de depresión-ansiedad)
   Todo lo definido aquí es un punto de partida editable desde la interfaz: el
   usuario puede cambiar pesos, correlaciones, agregar o quitar variables.
*/

function buildDefaultState() {
  return {
    numericOrder: [
      "angustia", "soledad", "miedo_muerte", "sentido_vida", "tendencia_emocional",
      "gravedad_depresion", "dolor", "burnout_zarit", "nutricion_mna", "adl_barthel",
      "iadl_lawton", "mmse", "funcionalidad_global", "fatiga", "perdida_apetito",
      "nausea_vomito"
    ],
    numeric: {
      angustia: { id: "angustia", label: "Nivel de angustia (ESAS)", dim: "emocional", unit: "0-10", min: 0, max: 10, mean: 5, sd: 2.0, enabled: true, source: "[ALGO] Escala ESAS adaptada" },
      soledad: { id: "soledad", label: "Sensación de soledad (ESAS)", dim: "emocional", unit: "0-10", min: 0, max: 10, mean: 5, sd: 2.2, enabled: true, source: "[ALGO] Métrica principal del sistema" },
      miedo_muerte: { id: "miedo_muerte", label: "Miedo a la muerte (ESAS)", dim: "emocional", unit: "0-10", min: 0, max: 10, mean: 4.5, sd: 2.3, enabled: true, source: "[ALGO] Indicador Logoterapia vs TCC" },
      sentido_vida: { id: "sentido_vida", label: "Sentido de vida (ESAS)", dim: "emocional", unit: "0-10", min: 0, max: 10, mean: 5.5, sd: 2.2, enabled: true, source: "[ALGO] 0=vacío existencial, 10=sentido claro" },
      tendencia_emocional: { id: "tendencia_emocional", label: "Tendencia emocional 7 días (ESAS)", dim: "emocional", unit: "0-10", min: 0, max: 10, mean: 5, sd: 1.8, enabled: true, source: "[ALGO] Promedio ponderado últimos 7 registros" },
      gravedad_depresion: { id: "gravedad_depresion", label: "Índice de gravedad depresiva", dim: "clinica", unit: "0-27 (proxy tipo GDS/HAM-D)", min: 0, max: 27, mean: 10, sd: 6, enabled: true, source: "[EFEN] Proxy continuo para severidad DSM-5" },
      dolor: { id: "dolor", label: "Dolor crónico", dim: "fisica", unit: "0-10", min: 0, max: 10, mean: 4, sd: 2.6, enabled: true, source: "[ALGO] Afecta estado emocional y participación" },
      burnout_zarit: { id: "burnout_zarit", label: "Burnout del cuidador (ZARIT)", dim: "relacional", unit: "0-88", min: 0, max: 88, mean: 38, sd: 16, enabled: true, source: "[ALGO] Afecta calidad del reporte" },
      nutricion_mna: { id: "nutricion_mna", label: "Puntaje nutricional (MNA-SF)", dim: "clinica", unit: "0-14", min: 0, max: 14, mean: 9, sd: 3, enabled: true, source: "[EFEN] r=-.750 con depresión (GDS-15)" },
      adl_barthel: { id: "adl_barthel", label: "Autonomía funcional (Barthel ADL)", dim: "fisica", unit: "0-100", min: 0, max: 100, mean: 55, sd: 22, enabled: true, source: "[EFEN] r=.755 con MNA-SF, r=-.820 con GDS-15" },
      iadl_lawton: { id: "iadl_lawton", label: "Autonomía instrumental (Lawton-Brody IADL)", dim: "fisica", unit: "0-8", min: 0, max: 8, mean: 4, sd: 2, enabled: true, source: "[EFEN] r=.626 con MNA-SF, r=-.614 con GDS-15" },
      mmse: { id: "mmse", label: "Función cognitiva (MMSE)", dim: "fisica", unit: "0-30", min: 0, max: 30, mean: 23, sd: 5, enabled: true, source: "[EFEN] Corte 23/24 para deterioro" },
      funcionalidad_global: { id: "funcionalidad_global", label: "Funcionalidad global (Overall Performance)", dim: "fisica", unit: "0-10", min: 0, max: 10, mean: 5.5, sd: 2.3, enabled: true, source: "[GONT] Factor protector de depresión/ansiedad" },
      fatiga: { id: "fatiga", label: "Fatiga", dim: "clinica", unit: "0-10", min: 0, max: 10, mean: 5, sd: 2.4, enabled: true, source: "[GONT] OR=1.22-1.24 para depresión/ansiedad" },
      perdida_apetito: { id: "perdida_apetito", label: "Pérdida de apetito", dim: "clinica", unit: "0-10", min: 0, max: 10, mean: 3.8, sd: 2.6, enabled: true, source: "[GONT] OR=1.12 para depresión/ansiedad" },
      nausea_vomito: { id: "nausea_vomito", label: "Náusea / vómito", dim: "clinica", unit: "0-10", min: 0, max: 10, mean: 2.5, sd: 2.3, enabled: true, source: "[GONT] OR=1.21-1.22 para depresión/ansiedad" }
    },

    categoricalOrder: [
      "enfermedad_neurologica_base", "estadio_enfermedad", "diagnostico_depresivo_dsm",
      "episodio_depresivo", "comorbilidades_psiquiatricas", "sintomas_somaticos",
      "medicacion_psicoactiva", "edad", "genero", "entorno_vida", "nivel_socioeconomico",
      "nivel_educativo", "religiosidad", "idioma_materno", "tipo_cuidador",
      "frecuencia_contacto", "señales_cuidador", "calidad_relacion", "red_apoyo_familiar",
      "capacidad_comunicativa", "movilidad", "control_motor_fino"
    ],
    categorical: {
      enfermedad_neurologica_base: { id: "enfermedad_neurologica_base", label: "Enfermedad neurológica base", dim: "clinica", enabled: true, source: "[ALGO]", options: [{ label: "Parkinson", weight: 35 }, { label: "ELA", weight: 15 }, { label: "Alzheimer", weight: 30 }, { label: "Huntington", weight: 5 }, { label: "Esclerosis múltiple", weight: 10 }, { label: "Otra", weight: 5 }] },
      estadio_enfermedad: { id: "estadio_enfermedad", label: "Estadio de la enfermedad", dim: "clinica", enabled: true, source: "[ALGO]", options: [{ label: "Estadio 1 (Leve)", weight: 25 }, { label: "Estadio 2 (Moderado)", weight: 35 }, { label: "Estadio 3 (Avanzado)", weight: 25 }, { label: "Terminal", weight: 15 }] },
      diagnostico_depresivo_dsm: { id: "diagnostico_depresivo_dsm", label: "Diagnóstico depresivo (DSM-5)", dim: "clinica", enabled: true, source: "[ALGO]", options: [{ label: "Trastorno de depresión mayor", weight: 40 }, { label: "Distimia", weight: 20 }, { label: "Depresión subclínica", weight: 25 }, { label: "Sin diagnóstico formal", weight: 15 }] },
      episodio_depresivo: { id: "episodio_depresivo", label: "Episodio depresivo", dim: "clinica", enabled: true, source: "[ALGO]", options: [{ label: "Único", weight: 45 }, { label: "Recurrente", weight: 55 }] },
      comorbilidades_psiquiatricas: { id: "comorbilidades_psiquiatricas", label: "Comorbilidades psiquiátricas", dim: "clinica", enabled: true, source: "[ALGO]", options: [{ label: "Ansiedad", weight: 40 }, { label: "TOC", weight: 8 }, { label: "Trastorno de personalidad", weight: 7 }, { label: "Sin comorbilidad", weight: 45 }] },
      sintomas_somaticos: { id: "sintomas_somaticos", label: "Síntomas somáticos", dim: "clinica", enabled: true, source: "[ALGO]", options: [{ label: "Insomnio", weight: 30 }, { label: "Hipersomnia", weight: 10 }, { label: "Anorexia", weight: 15 }, { label: "Fatiga severa", weight: 25 }, { label: "Agitación psicomotora", weight: 10 }, { label: "Sin síntomas", weight: 10 }] },
      medicacion_psicoactiva: { id: "medicacion_psicoactiva", label: "Medicación psicoactiva actual", dim: "clinica", enabled: true, source: "[ALGO]", options: [{ label: "Antidepresivos", weight: 45 }, { label: "Ansiolíticos", weight: 20 }, { label: "Antipsicóticos", weight: 10 }, { label: "Sin medicación", weight: 25 }] },
      edad: { id: "edad", label: "Edad", dim: "demografica", enabled: true, source: "[ALGO]", options: [{ label: "18-35", weight: 10 }, { label: "36-55", weight: 25 }, { label: "56-70", weight: 35 }, { label: "71+", weight: 30 }] },
      genero: { id: "genero", label: "Género", dim: "demografica", enabled: true, source: "[ALGO]", options: [{ label: "Femenino", weight: 52 }, { label: "Masculino", weight: 45 }, { label: "No binario", weight: 2 }, { label: "Prefiere no decir", weight: 1 }] },
      entorno_vida: { id: "entorno_vida", label: "Entorno de vida", dim: "demografica", enabled: true, source: "[ALGO]", options: [{ label: "Hogar familiar", weight: 55 }, { label: "Hogar unipersonal", weight: 15 }, { label: "Clínica", weight: 10 }, { label: "Residencia geriátrica", weight: 20 }] },
      nivel_socioeconomico: { id: "nivel_socioeconomico", label: "Nivel socioeconómico", dim: "demografica", enabled: true, source: "[ALGO]/[EFEN]", options: [{ label: "Estrato 1-2", weight: 40 }, { label: "Estrato 3-4", weight: 40 }, { label: "Estrato 5-6", weight: 20 }] },
      nivel_educativo: { id: "nivel_educativo", label: "Nivel educativo", dim: "demografica", enabled: true, source: "[ALGO]", options: [{ label: "Sin escolaridad", weight: 10 }, { label: "Primaria", weight: 30 }, { label: "Secundaria", weight: 35 }, { label: "Universitario", weight: 20 }, { label: "Posgrado", weight: 5 }] },
      religiosidad: { id: "religiosidad", label: "Religiosidad / Espiritualidad", dim: "demografica", enabled: true, source: "[ALGO]", options: [{ label: "Alta", weight: 35 }, { label: "Media", weight: 35 }, { label: "Baja", weight: 20 }, { label: "Sin creencia", weight: 10 }] },
      idioma_materno: { id: "idioma_materno", label: "Idioma materno", dim: "demografica", enabled: true, source: "[ALGO]", options: [{ label: "Español", weight: 90 }, { label: "Lengua indígena", weight: 5 }, { label: "Otro", weight: 5 }] },
      tipo_cuidador: { id: "tipo_cuidador", label: "Tipo de cuidador", dim: "relacional", enabled: true, source: "[ALGO]", options: [{ label: "Familiar directo", weight: 65 }, { label: "Cuidador profesional", weight: 20 }, { label: "Voluntario", weight: 5 }, { label: "Sin cuidador identificado", weight: 10 }] },
      frecuencia_contacto: { id: "frecuencia_contacto", label: "Frecuencia de contacto", dim: "relacional", enabled: true, source: "[ALGO]", options: [{ label: "24/7 en hogar", weight: 40 }, { label: "Visitas diarias", weight: 30 }, { label: "Visitas semanales", weight: 20 }, { label: "Contacto esporádico", weight: 10 }] },
      "señales_cuidador": { id: "señales_cuidador", label: "Señales que detecta el cuidador", dim: "relacional", enabled: true, source: "[ALGO]", options: [{ label: "Llanto frecuente", weight: 25 }, { label: "Aislamiento", weight: 25 }, { label: "Rechazo a comer", weight: 15 }, { label: "Insomnio visible", weight: 20 }, { label: "Sin señales de alerta", weight: 15 }] },
      calidad_relacion: { id: "calidad_relacion", label: "Calidad de la relación", dim: "relacional", enabled: true, source: "[ALGO]", options: [{ label: "Muy cercana", weight: 35 }, { label: "Cercana", weight: 35 }, { label: "Distante", weight: 20 }, { label: "Conflictiva", weight: 10 }] },
      red_apoyo_familiar: { id: "red_apoyo_familiar", label: "Red de apoyo familiar", dim: "relacional", enabled: true, source: "[ALGO]", options: [{ label: "Extensa (5+ personas)", weight: 25 }, { label: "Moderada (2-4)", weight: 40 }, { label: "Mínima (1)", weight: 25 }, { label: "Sin red de apoyo", weight: 10 }] },
      capacidad_comunicativa: { id: "capacidad_comunicativa", label: "Capacidad comunicativa", dim: "fisica", enabled: true, source: "[ALGO]", options: [{ label: "Verbal fluida", weight: 50 }, { label: "Verbal limitada", weight: 25 }, { label: "Solo gestual", weight: 15 }, { label: "Sin comunicación verbal", weight: 10 }] },
      movilidad: { id: "movilidad", label: "Movilidad", dim: "fisica", enabled: true, source: "[ALGO]", options: [{ label: "Autónoma", weight: 30 }, { label: "Con apoyo", weight: 30 }, { label: "En silla de ruedas", weight: 25 }, { label: "Postrado en cama", weight: 15 }] },
      control_motor_fino: { id: "control_motor_fino", label: "Control motor fino", dim: "fisica", enabled: true, source: "[ALGO]", options: [{ label: "Conservado", weight: 40 }, { label: "Parcialmente conservado", weight: 35 }, { label: "Perdido", weight: 25 }] }
    },

    derivedOrder: [
      "estado_nutricional", "dependencia_adl", "gravedad_depresion_dsm",
      "burnout_cuidador_nivel", "dolor_cronico_nivel", "capacidad_cognitiva",
      "estado_animo_diario", "ideacion_suicida"
    ],
    derived: {
      estado_nutricional: { id: "estado_nutricional", label: "Estado nutricional (MNA-SF)", dim: "clinica", enabled: true, kind: "bins", sourceNumeric: "nutricion_mna", source: "[EFEN] Cortes MNA-SF estándar", bins: [{ max: 7, label: "Malnutrición" }, { max: 11, label: "Riesgo de malnutrición" }, { max: 14, label: "Normal" }] },
      dependencia_adl: { id: "dependencia_adl", label: "Dependencia funcional (Barthel ADL)", dim: "fisica", enabled: true, kind: "bins", sourceNumeric: "adl_barthel", source: "[EFEN] Cortes Barthel estándar", bins: [{ max: 20, label: "Dependencia total" }, { max: 60, label: "Dependencia severa" }, { max: 90, label: "Dependencia moderada" }, { max: 99, label: "Dependencia leve" }, { max: 100, label: "Independencia" }] },
      gravedad_depresion_dsm: { id: "gravedad_depresion_dsm", label: "Gravedad depresión (DSM-5)", dim: "clinica", enabled: true, kind: "bins", sourceNumeric: "gravedad_depresion", source: "[ALGO] Especificadores DSM-5 / CIE-10 F32.x", bins: [{ max: 7, label: "Leve (F32.0)" }, { max: 14, label: "Moderado (F32.1)" }, { max: 21, label: "Grave (F32.2)" }, { max: 27, label: "Con características psicóticas (F32.3)" }] },
      burnout_cuidador_nivel: { id: "burnout_cuidador_nivel", label: "Nivel de burnout del cuidador", dim: "relacional", enabled: true, kind: "bins", sourceNumeric: "burnout_zarit", source: "[ALGO] Cortes ZARIT estándar", bins: [{ max: 46, label: "Sin burnout" }, { max: 55, label: "Leve" }, { max: 63, label: "Moderado" }, { max: 88, label: "Severo" }] },
      dolor_cronico_nivel: { id: "dolor_cronico_nivel", label: "Dolor crónico (nivel)", dim: "fisica", enabled: true, kind: "bins", sourceNumeric: "dolor", source: "[ALGO]", bins: [{ max: 0, label: "Sin dolor" }, { max: 3.9, label: "Leve" }, { max: 6.9, label: "Moderado" }, { max: 10, label: "Severo" }] },
      capacidad_cognitiva: { id: "capacidad_cognitiva", label: "Capacidad cognitiva", dim: "fisica", enabled: true, kind: "bins", sourceNumeric: "mmse", source: "[EFEN] Corte 23/24 MMSE", bins: [{ max: 9, label: "Severa" }, { max: 18, label: "Moderadamente deteriorada" }, { max: 23, label: "Levemente deteriorada" }, { max: 30, label: "Intacta" }] },
      estado_animo_diario: { id: "estado_animo_diario", label: "Estado de ánimo diario", dim: "emocional", enabled: true, kind: "formula", formula: "estado_animo", source: "[ALGO] Emoji de 5 niveles, derivado de angustia/soledad" },
      ideacion_suicida: { id: "ideacion_suicida", label: "Ideación suicida", dim: "emocional", enabled: true, kind: "formula", formula: "ideacion_suicida", source: "[ALGO] Activa protocolo de alerta máxima" }
    },

    // Correlaciones por pares entre variables numéricas latentes. Clave: "a|b" con a<b alfabéticamente.
    correlations: {
      "gravedad_depresion|nutricion_mna": -0.75,
      "adl_barthel|nutricion_mna": 0.755,
      "iadl_lawton|nutricion_mna": 0.626,
      "mmse|nutricion_mna": 0.286,
      "adl_barthel|gravedad_depresion": -0.82,
      "gravedad_depresion|iadl_lawton": -0.614,
      "gravedad_depresion|mmse": -0.273,
      "adl_barthel|iadl_lawton": 0.838,
      "adl_barthel|mmse": 0.417,
      "iadl_lawton|mmse": 0.608,
      "angustia|gravedad_depresion": 0.28,
      "fatiga|gravedad_depresion": 0.19,
      "funcionalidad_global|gravedad_depresion": -0.25,
      "angustia|tendencia_emocional": 0.39,
      "angustia|miedo_muerte": 0.22,
      "angustia|soledad": 0.22,
      "angustia|sentido_vida": -0.19,
      "soledad|sentido_vida": -0.14,
      "burnout_zarit|soledad": 0.17,
      "fatiga|dolor": 0.22,
      "fatiga|perdida_apetito": 0.19,
      "fatiga|nausea_vomito": 0.17,
      "perdida_apetito|nausea_vomito": 0.22,
      "dolor|perdida_apetito": 0.14,
      "funcionalidad_global|dolor": -0.19,
      "funcionalidad_global|fatiga": -0.22
    },
    correlationMeta: {
      "gravedad_depresion|nutricion_mna": "[EFEN] Tabla 3, r=-.750",
      "adl_barthel|nutricion_mna": "[EFEN] Tabla 3, r=.755",
      "iadl_lawton|nutricion_mna": "[EFEN] Tabla 3, r=.626",
      "mmse|nutricion_mna": "[EFEN] Tabla 3, r=.286",
      "adl_barthel|gravedad_depresion": "[EFEN] Tabla 3, r=-.820",
      "gravedad_depresion|iadl_lawton": "[EFEN] Tabla 3, r=-.614",
      "gravedad_depresion|mmse": "[EFEN] Tabla 3, r=-.273",
      "adl_barthel|iadl_lawton": "[EFEN] Tabla 3, r=.838",
      "adl_barthel|mmse": "[EFEN] Tabla 3, r=.417",
      "iadl_lawton|mmse": "[EFEN] Tabla 3, r=.608",
      "angustia|gravedad_depresion": "Estimación clínica orientativa (moderada para consistencia matemática del sistema completo)",
      "fatiga|gravedad_depresion": "[GONT] OR 1.20-1.24, moderada para consistencia del sistema",
      "funcionalidad_global|gravedad_depresion": "[GONT] OR .80-.82 (protector), convertido a r y moderado para consistencia del sistema",
      "angustia|tendencia_emocional": "Definicional (misma escala, ventana temporal), moderada para consistencia del sistema",
      "angustia|miedo_muerte": "Estimación clínica orientativa",
      "angustia|soledad": "Estimación clínica orientativa",
      "angustia|sentido_vida": "Estimación clínica orientativa (vacío existencial)",
      "soledad|sentido_vida": "Estimación clínica orientativa",
      "burnout_zarit|soledad": "Estimación clínica orientativa",
      "fatiga|dolor": "Estimación clínica orientativa (cluster de carga sintomática)",
      "fatiga|perdida_apetito": "[GONT] cluster de carga sintomática EORTC",
      "fatiga|nausea_vomito": "[GONT] cluster de carga sintomática EORTC",
      "perdida_apetito|nausea_vomito": "[GONT] cluster de carga sintomática EORTC, OR 1.12/1.21-1.22",
      "dolor|perdida_apetito": "Estimación clínica orientativa (cluster de carga sintomática)",
      "funcionalidad_global|dolor": "Estimación clínica orientativa",
      "funcionalidad_global|fatiga": "[GONT] funcionalidad como protector, moderada para consistencia del sistema"
    },

    // Reglas de influencia: una categoría de una variable categórica desplaza (en desviaciones
    // estándar) la media de una variable numérica latente para ese perfil.
    influenceRules: [
      { id: "r1", catVar: "nivel_socioeconomico", catOption: "Estrato 1-2", targetNumeric: "nutricion_mna", effect: -0.4, source: "[EFEN] OR=.10 malnutrición en ingreso bajo" },
      { id: "r2", catVar: "nivel_socioeconomico", catOption: "Estrato 1-2", targetNumeric: "gravedad_depresion", effect: 0.4, source: "[EFEN] OR=.06 depresión en ingreso bajo" },
      { id: "r3", catVar: "edad", catOption: "71+", targetNumeric: "nutricion_mna", effect: -0.3, source: "[EFEN] Subgrupo ≥85 años" },
      { id: "r4", catVar: "edad", catOption: "71+", targetNumeric: "gravedad_depresion", effect: 0.25, source: "[EFEN] Subgrupo ≥85 años" },
      { id: "r5", catVar: "estadio_enfermedad", catOption: "Terminal", targetNumeric: "funcionalidad_global", effect: -0.7, source: "[GONT] Funcionalidad como protector" },
      { id: "r6", catVar: "estadio_enfermedad", catOption: "Terminal", targetNumeric: "fatiga", effect: 0.6, source: "[GONT] Carga sintomática en fase avanzada" },
      { id: "r7", catVar: "estadio_enfermedad", catOption: "Terminal", targetNumeric: "perdida_apetito", effect: 0.5, source: "[GONT] Carga sintomática en fase avanzada" },
      { id: "r8", catVar: "estadio_enfermedad", catOption: "Terminal", targetNumeric: "nausea_vomito", effect: 0.4, source: "[GONT] Carga sintomática en fase avanzada" },
      { id: "r9", catVar: "estadio_enfermedad", catOption: "Estadio 3 (Avanzado)", targetNumeric: "funcionalidad_global", effect: -0.4, source: "Estimación clínica orientativa (gradiente)" },
      { id: "r10", catVar: "red_apoyo_familiar", catOption: "Sin red de apoyo", targetNumeric: "soledad", effect: 0.6, source: "Estimación clínica orientativa" },
      { id: "r11", catVar: "red_apoyo_familiar", catOption: "Sin red de apoyo", targetNumeric: "gravedad_depresion", effect: 0.3, source: "Estimación clínica orientativa" },
      { id: "r12", catVar: "movilidad", catOption: "Postrado en cama", targetNumeric: "funcionalidad_global", effect: -0.5, source: "Estimación clínica orientativa" },
      { id: "r13", catVar: "movilidad", catOption: "Postrado en cama", targetNumeric: "adl_barthel", effect: -0.8, source: "Consistencia definicional" },
      { id: "r14", catVar: "calidad_relacion", catOption: "Conflictiva", targetNumeric: "soledad", effect: 0.4, source: "Estimación clínica orientativa" },
      { id: "r15", catVar: "capacidad_comunicativa", catOption: "Sin comunicación verbal", targetNumeric: "soledad", effect: 0.3, source: "Estimación clínica orientativa" }
    ],

    dimensions: [
      { id: "clinica", label: "Clínica" },
      { id: "emocional", label: "Emocional (ESAS)" },
      { id: "demografica", label: "Demográfica y contextual" },
      { id: "relacional", label: "Relacional (cuidador)" },
      { id: "fisica", label: "Condición física" }
    ]
  };
}

window.SCHEMA_BUILDER = { buildDefaultState };
