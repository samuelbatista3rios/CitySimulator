# ---- build: compila o frontend e instala deps do servidor ----
FROM node:22-slim AS build
WORKDIR /app

# deps do frontend
COPY package.json package-lock.json* ./
RUN npm install

# código + build do frontend (gera /app/dist)
COPY . .
RUN npm run build

# deps do servidor
WORKDIR /app/server
RUN npm install

# ---- runtime: roda o servidor 24/7 (sim + WebSocket + serve o dist) ----
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

# frontend buildado, core da simulação e o servidor (com node_modules)
COPY --from=build /app/dist ./dist
COPY --from=build /app/src ./src
COPY --from=build /app/server ./server

EXPOSE 8080
WORKDIR /app/server
# tsx roda o TS direto (inclui o core importado de ../../src)
CMD ["npm", "start"]
