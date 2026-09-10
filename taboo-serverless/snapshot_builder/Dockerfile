# Job Cloud Run : s'execute, publie, se termine. Pas un service.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

COPY snapshot_builder/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# La couche semantique est copiee AVEC le job : le registre est la source
# du SQL execute, il ne peut pas vivre ailleurs que dans l'image.
COPY semantique/ ./semantique/
COPY snapshot_builder/ ./snapshot_builder/

# Utilisateur non privilegie : ce conteneur detient un droit de lecture
# sur BigQuery, il n'a aucune raison de tourner en root.
RUN useradd --create-home --uid 1001 taboo && chown -R taboo /app
USER taboo

ENTRYPOINT ["python", "snapshot_builder/main.py"]
