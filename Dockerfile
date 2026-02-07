FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --production

COPY server.js ./
COPY web/ ./web/
COPY rootCA.pem ./

EXPOSE 8765 8766

CMD ["node", "server.js"]
