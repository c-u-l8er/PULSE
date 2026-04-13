FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-slim
RUN apt-get update -y && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/bin ./bin
COPY --from=build /app/schemas ./schemas
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./

RUN mkdir -p /data
ENV OS_PULSE_DB_PATH=/data/manifests.db

EXPOSE 8080
CMD ["node", "bin/os-pulse.js", "--transport", "http", "--port", "8080", "--db", "/data/manifests.db"]
