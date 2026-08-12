# ACOMPAÑAR · Generador de Perfiles Sintéticos

Aplicación web para diseñar, editar y generar el dataset de entrenamiento sintético descrito en el roadmap de `ACOMPANAR_Algoritmo_v1.pdf` — perfiles de paciente paliativo ficticios que cubren la matriz de combinaciones de variables clínicas, emocionales, demográficas, relacionales y físicas.

**Demo en producción:** [acompanaria-perfiles1-148425349822.europe-west1.run.app](https://acompanaria-perfiles1-148425349822.europe-west1.run.app/)

<p align="center">
  <a href="https://acompanaria-perfiles1-148425349822.europe-west1.run.app/" target="_blank">
    <img alt="Abrir la app" src="https://img.shields.io/badge/Abrir%20la%20app-Cloud%20Run-4285F4?style=for-the-badge">
  </a>
</p>

## Qué es

Editor tipo grafo (nodos = variables, aristas = relaciones causales/inhibitorias) para:

1. **Definir variables** — ~45+ variables de 5 dimensiones (clínica, emocional/ESAS, demográfica, relacional/cuidador, física), con tipo (`continuous`, `ordinal`, `categorical`, `binary`), rango, media y desviación estándar basal.
2. **Definir relaciones** — aristas causales/inhibitorias/compuestas con peso y fórmula (`target += source * peso`), más correlaciones editables entre variables numéricas latentes.
3. **Editar visualmente** — panel de inspección de parámetros sin tocar código; importar/exportar el esquema como JSON versionado.
4. **Generar el dataset** — botón "Generar" que llama al motor Python y produce perfiles sintéticos en CSV o JSON, con semilla opcional para reproducibilidad.
5. **Auditar** — resumen estadístico (medias, correlaciones logradas) y auditoría de privacidad/reidentificación sobre la muestra generada.

## Arquitectura

```
ui/                  Frontend (HTML/CSS/JS puro, sin build step) — editor de grafo + inspector + gráficos
server.py            Servidor HTTP stdlib-only: sirve ui/ y expone la API
generator/
  engine.py          Motor de generación: consume cualquier schema válido, sin nombres de variable hardcodeados
  stats.py           Estadísticas resumen (medias, correlaciones logradas) sobre el dataset generado
  privacy.py         Auditoría de riesgo de reidentificación/sobreajuste del esquema + muestra
schema/
  graph_model.json   Esquema persistido (nodos, aristas, metadata) — versionado y editable desde la UI
context/             Fuentes clínicas (PDFs/artículos) usadas para calibrar variables y correlaciones
Dockerfile           Imagen para despliegue en Cloud Run / cualquier host de contenedores
```

### API

| Método | Ruta | Función |
|---|---|---|
| `GET` | `/api/schema` | Devuelve el esquema actual (`schema/graph_model.json`) |
| `POST` | `/api/schema` | Valida y persiste un esquema editado desde la UI |
| `POST` | `/api/generate` | Genera `n` perfiles a partir de un esquema, devuelve CSV o JSON |
| `POST` | `/api/analyze` | Genera una muestra, devuelve resumen estadístico + auditoría de privacidad |

## Formato del esquema (`schema/graph_model.json`)

```json
{
  "metadata": {
    "model_name": "Palliative Care Baseline",
    "version": "1.2.0",
    "last_modified": "2026-08-10"
  },
  "nodes": [
    {
      "id": "pain_scale",
      "label": "Pain Severity",
      "type": "ordinal",
      "range": [0, 10],
      "baseline_mean": 3.0,
      "baseline_std": 1.5
    }
  ],
  "edges": [
    {
      "id": "e_pain_opioid",
      "source": "pain_scale",
      "target": "opioid_daily_mme",
      "relationType": "causal",
      "weight": 15.0,
      "formula": "target += source * 15.0"
    }
  ]
}
```

## Cómo funciona el motor de generación

Por cada perfil sintético:

1. Muestrea las variables categóricas independientes.
2. Genera el vector de variables numéricas correlacionadas (normales truncadas a su rango clínico, cópula gaussiana vía descomposición de Cholesky — si el usuario edita las correlaciones a una combinación matemáticamente inconsistente, el sistema regulariza automáticamente hacia la matriz identidad lo mínimo necesario).
3. Aplica los desplazamientos de las aristas causales/inhibitorias según las categorías ya elegidas.
4. Aplica un paso de reparación de restricciones clínicas rígidas (hard constraints) para evitar combinaciones imposibles.
5. Deriva variables categóricas dependientes de una variable numérica por cortes clínicos o por fórmula.

## Ejecutar en local

Requiere solo Python 3 (sin dependencias externas — stdlib only).

```bash
python3 server.py --port 8765
# abrir http://localhost:8765
```

La variable de entorno `PORT` también es respetada (para despliegue zero-config en Render/Railway/Fly/Cloud Run).

## Despliegue

Incluye `Dockerfile` listo para Cloud Run u otro host de contenedores:

```bash
docker build -t acompanaria-perfiles .
docker run -p 8080:8080 acompanaria-perfiles
```

La instancia desplegada actual: **https://acompanaria-perfiles1-148425349822.europe-west1.run.app/**

## Limitaciones conocidas

- Los marginales de las variables numéricas se aproximan como normales truncadas a su rango clínico — simplificación razonable para bootstrapping de un modelo, no para generar historias clínicas realistas variable por variable.
- Las correlaciones "estimación clínica orientativa" (no respaldadas por un estudio citado) están moderadas para que el sistema completo de variables permanezca matemáticamente consistente como matriz de correlación válida; si se añaden más correlaciones fuertes hacia un mismo nodo, es esperable que el sistema tenga que regularizar — la UI lo advierte.
- `schema/graph_model.json` se sobreescribe en cada guardado desde la UI (`PUT /api/schema`) — no hay historial de versiones más allá del campo `metadata.last_modified`.
</content>
