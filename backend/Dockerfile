FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
WORKDIR /app
COPY backend/requirements.txt /tmp/geocare-requirements.txt
RUN pip install --no-cache-dir -r /tmp/geocare-requirements.txt && useradd --create-home --uid 10001 app
COPY --chown=app:app backend /app/backend
RUN chmod 755 /app/backend/start-render.sh
USER app
EXPOSE 8000
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
