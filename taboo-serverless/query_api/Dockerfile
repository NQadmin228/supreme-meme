# Service Cloud Run : repond aux requetes de detail.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=8080

WORKDIR /app

COPY query_api/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY query_api/ ./

RUN useradd --create-home --uid 1001 taboo && chown -R taboo /app
USER taboo

EXPOSE 8080
# Un seul worker : le service est un passe-plat vers BigQuery, il attend
# sur le reseau et ne consomme pas de CPU. La concurrence est geree par
# Cloud Run, qui sait mieux quand demarrer une instance de plus.
CMD exec uvicorn main:app --host 0.0.0.0 --port ${PORT} --workers 1
