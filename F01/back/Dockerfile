
FROM node:current-alpine3.24

WORKDIR /app

COPY package*.json ./

RUN npm ci

COPY dist ./dist
COPY scripts ./scripts

EXPOSE 3000

CMD ["node", "dist/index.js"]