# Phytospectra API — CPU inference (SegFormer + ViT)
# Weights: bind-mount ./models locally, or download from Supabase on startup.
FROM python:3.12-slim-bookworm

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

RUN pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir \
        $(grep -vE '^(torch|torchvision)\s' requirements.txt | tr '\n' ' ')

COPY . .

RUN chmod +x entrypoint.sh \
    && mkdir -p models /tmp/phytospectra_output/tmp /tmp/phytospectra_output/local_uploads

ENV PYTHONUNBUFFERED=1 \
    DEVICE=cpu \
    HOST=0.0.0.0 \
    PORT=8000 \
    OUTPUT_FOLDER=/tmp/phytospectra_output

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=300s --retries=3 \
    CMD python -c "import os,urllib.request; p=os.environ.get('PORT','8000'); urllib.request.urlopen(f'http://127.0.0.1:{p}/api/health', timeout=5)"

ENTRYPOINT ["./entrypoint.sh"]
