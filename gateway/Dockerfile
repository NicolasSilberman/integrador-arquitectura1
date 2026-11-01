# Gateway de autenticación y autorización (ADR-006)
FROM node:22-alpine

WORKDIR /app

# Primero solo las dependencias: si no cambian, Docker reutiliza esta capa (cache)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Después el código
COPY src ./src

EXPOSE 8000
# Mínimo privilegio (ADR-008): el proceso corre con el usuario sin privilegios "node" de la imagen oficial, no como root
USER node
CMD ["node", "src/index.js"]
