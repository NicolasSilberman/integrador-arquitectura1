FROM node:22-alpine
WORKDIR /app
# Sin dependencias externas: usa el http y el fetch que ya trae Node
COPY package.json index.js ./
EXPOSE 3001
CMD ["node", "index.js"]
