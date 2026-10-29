FROM node:22-alpine

WORKDIR /app

COPY package*.json ./

RUN npm ci

COPY tsconfig.json tsconfig.node.json vite.config.ts index.html ./
COPY src ./src

EXPOSE 5173
RUN npm run build

CMD ["npm", "run", "preview", "--", "--host", "--port", "5173"]