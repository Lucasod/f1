FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        libpq-dev \
        curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/backend

COPY requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir --no-deps -r requirements.txt

COPY . /app/backend/

ENV PYTHONPATH=/app/backend

WORKDIR /app/backend/conf

EXPOSE 8000

HEALTHCHECK CMD python manage.py check || exit 1

CMD ["gunicorn", "conf.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "2", "--timeout", "120"]
