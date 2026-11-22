FROM python:3.11-slim AS core
WORKDIR /app
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
COPY backend backend
COPY demo.py .

FROM core AS verify
COPY episodes episodes
COPY trajectories.jsonl verify.py .
CMD ["python", "verify.py"]

FROM node:24-bookworm-slim AS frontend_build
WORKDIR /src
RUN corepack enable
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN corepack pnpm@11.25.0 install --frozen-lockfile
COPY frontend/ .
RUN corepack pnpm@11.25.0 run build

FROM core AS web
RUN python -m pip install --no-cache-dir -r backend/requirements.txt
COPY --from=frontend_build /src/dist frontend/dist
EXPOSE 8000
CMD ["python", "-m", "uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8000"]
