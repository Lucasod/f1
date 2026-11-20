FROM node:current-alpine3.24

WORKDIR /app

COPY package*.json ./
COPY deps/ioredis-mock-8.13.1.tgz ./deps/ioredis-mock-8.13.1.tgz

RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

COPY scripts ./scripts

EXPOSE 3000
CMD ["node", "dist/index.js"]