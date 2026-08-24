# Frontend: build de Vite servido por nginx. Build context = RAÍZ del repo
# (docker-compose.yml), de ahí el prefijo frontend/ en todos los COPY.
FROM node:22-slim AS build

WORKDIR /app

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./

# Subruta donde se sirve la app. En producción es "/" (nginx la sirve en la raíz);
# en GitHub Pages, el workflow usa /coipo_nexe/ (ver .github/workflows).
ARG BASE_PATH=/
ENV VITE_BASE=${BASE_PATH}
RUN npm run build

# ── Imagen final ────────────────────────────────────────────────────────────
FROM nginx:1.27-alpine

COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8000
