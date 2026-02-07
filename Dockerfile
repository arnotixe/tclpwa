FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --production

COPY server.js ./
COPY web/ ./web/

EXPOSE 8765

CMD ["node", "server.js"]
