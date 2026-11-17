# Minimal Dockerfile for the F04 Django backend
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

# System dependencies for building Python wheels (psycopg2-binary) and Django
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        libpq-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies (no requirements.txt present; core deps only)
RUN pip install --no-cache-dir Django django-multitenant psycopg2-binary playwright

# Install Chromium browser for Playwright E2E tests
RUN playwright install chromium --with-deps

# Copy application code
WORKDIR /app/backend/conf
COPY backend/ /app/backend/

EXPOSE 8000

CMD ["python3", "manage.py", "runserver", "0.0.0.0:8000"]
