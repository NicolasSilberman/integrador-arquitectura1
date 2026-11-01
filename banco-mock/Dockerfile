# Banco simulado: servicio SOAP de ejemplo, sin dependencias externas
FROM node:22-alpine

WORKDIR /app
COPY index.js ./

EXPOSE 8090
# Mínimo privilegio (ADR-008): el proceso corre con el usuario sin privilegios "node" de la imagen oficial, no como root
USER node
CMD ["node", "index.js"]
