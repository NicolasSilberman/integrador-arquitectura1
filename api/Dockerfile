# Imagen base oficial de Node sobre Alpine Linux (liviana)
FROM node:22-alpine AS base
WORKDIR /app
# Primero solo los manifiestos: si las dependencias no cambian, Docker reutiliza la capa (caché)
COPY package.json package-lock.json ./

# Etapa de pruebas (la usa docker-compose.test.yml): incluye las dependencias de desarrollo
FROM base AS pruebas
RUN npm ci
COPY src ./src

# Etapa final = la que construye "docker compose up": solo dependencias de producción
FROM base AS produccion
RUN npm ci --omit=dev
COPY src ./src
EXPOSE 3000
CMD ["node", "src/index.js"]
