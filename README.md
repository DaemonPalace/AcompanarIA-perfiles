# ACOMPAÑAR · Generador de Perfiles Sintéticos

Aplicación web local (sin backend, sin dependencias externas) para generar el dataset de entrenamiento sintético mencionado en el paso 2 del roadmap de `ACOMPANAR_Algoritmo_v1.pdf` ("Definir el dataset de entrenamiento sintético — perfiles de paciente ficticios que cubran la matriz de combinaciones de variables").

## Cómo abrirla

Doble clic en `index.html` (o `python3 -m http.server` en esta carpeta y abrir `http://localhost:8000`). No requiere instalación ni conexión a internet.

## Qué hace

1. **Variables** — las ~45 variables de las 5 dimensiones del algoritmo (clínica, emocional/ESAS, demográfica, relacional/cuidador, física) más variables añadidas desde la evidencia científica (estado nutricional MNA-SF, ADL/IADL, MMSE, funcionalidad global, fatiga, apetito, náusea). Puedes activar/desactivar, editar pesos y rangos, o añadir/eliminar variables propias.
2. **Correlaciones** — mapa de calor editable entre las variables numéricas latentes. Los valores por defecto vienen de:
   - Efendioglu et al. 2021 (correlaciones exactas de su Tabla 3: MNA-SF, GDS-15, Barthel ADL, Lawton IADL, MMSE).
   - Gontijo Garcia et al. 2023 (funcionalidad, fatiga, pérdida de apetito y náusea/vómito como factores asociados a depresión/ansiedad, convertidos de odds ratio a una correlación aproximada).
   - Estimaciones clínicas orientativas para el resto (marcadas explícitamente como tal), moderadas para que el sistema completo de 16 variables permanezca matemáticamente consistente (ver nota abajo).
   También se pueden definir "reglas de influencia": cómo una categoría (p. ej. "Estrato 1-2" u "Estadio Terminal") desplaza la media de una variable numérica, replicando los hallazgos de ambos estudios (ingreso bajo → peor nutrición y más depresión; enfermedad terminal → más fatiga/pérdida de apetito/náusea y menor funcionalidad).
3. **Distribuciones y efectos** — histogramas y gráficos de barras en vivo (muestra de 400 perfiles) para cada variable activa, más un gráfico de dispersión configurable para ver el efecto conjunto de dos variables (con color opcional por una tercera variable categórica).
4. **Generar y exportar** — genera de 1 a 2000 perfiles (semilla opcional para reproducibilidad) y descarga CSV o JSON con todas las columnas.

## Cómo funciona el motor (para quien vaya a modificar el código)

- `js/schema.js`: definición por defecto de variables, correlaciones y reglas de influencia.
- `js/stats.js`: PRNG con semilla + normales correlacionadas vía descomposición de Cholesky (cópula gaussiana). Si el usuario edita las correlaciones a una combinación matemáticamente inconsistente (no toda combinación de correlaciones por pares es válida simultáneamente), el sistema regulariza automáticamente hacia la matriz identidad lo mínimo necesario y lo advierte en la pestaña "Generar".
- `js/generator.js`: por cada perfil sintético, (1) muestrea las variables categóricas independientes, (2) genera el vector de variables numéricas correlacionadas, (3) aplica los desplazamientos de las reglas de influencia según las categorías ya elegidas, (4) deriva las variables categóricas que dependen de una variable numérica por cortes clínicos (ej. MNA-SF ≤7 = "Malnutrición") o por fórmula (ideación suicida, estado de ánimo).
- `js/viz.js`: histogramas, mapa de calor y dispersión en `<canvas>`, con paleta validada para daltonismo (ver `references/palette.md` del skill de visualización de datos usado para construir esta app).

## Limitaciones conocidas (para iterar después)

- Los marginales de las variables numéricas se aproximan como normales truncadas a su rango clínico; es una simplificación razonable para bootstrapping de un modelo, no para generar historias clínicas realistas variable por variable.
- Las dos variables derivadas por fórmula ("Estado de ánimo diario", "Ideación suicida") no son editables desde la interfaz más allá de activar/desactivar — están calibradas para una tasa base plausible pero si quieres ajustarlas hay que tocar `evalFormula()` en `js/generator.js`.
- Como se explica arriba, las correlaciones "estimación clínica orientativa" se moderaron respecto a un primer borrador porque, combinadas con las correlaciones empíricas de Efendioglu et al., el sistema de 16 variables dejaba de ser una matriz de correlación matemáticamente válida (más de una variable no puede correlacionar fuertemente con el mismo "hub" sin correlacionar también entre sí). Si sumas más correlaciones fuertes hacia una misma variable, es esperable que la app tenga que regularizar — la advertencia en pantalla te lo indicará.
