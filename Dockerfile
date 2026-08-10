FROM python:3.11-slim

WORKDIR /app

# Copiar el proyecto completo (UI, esquema y módulos de generator)
COPY . .

# Comando de ejecución
CMD ["python3", "server.py"]
