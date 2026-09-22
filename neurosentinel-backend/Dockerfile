# neurosentinel-backend/Dockerfile
FROM python:3.11-slim

# System dependencies for MNE (needs some libs)
RUN apt-get update && apt-get install -y \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY pyproject.toml .
RUN pip install --no-cache-dir -e .

COPY . .

# HF Spaces requires port 7860
EXPOSE 7860

CMD ["uvicorn", "app.main:app", \
     "--host", "0.0.0.0", \
     "--port", "7860", \
     "--workers", "1"]
