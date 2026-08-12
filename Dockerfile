FROM python:3.11-slim

WORKDIR /app

# Copiar el proyecto (UI, esquema y módulos de generator; ver .dockerignore)
COPY . .

# Cloud Run inyecta $PORT (por defecto 8080) y espera que el proceso escuche ahí;
# server.py ya lee os.environ["PORT"], así que no se fija un valor aquí.
ENV PYTHONUNBUFFERED=1
EXPOSE 8080


# server.py writes schema/graph_model.json at runtime (PUT /api/schema) — appuser needs write access.
RUN useradd -m appuser && chown -R appuser:appuser /app
USER appuser

CMD ["python3", "server.py"]
