# Build the frontend, then run the Express server which serves both the API
# and the built static app on PORT (default 3001).

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY server ./server
COPY tsconfig.json ./

EXPOSE 3001
# Required env at runtime: ASANA_TOKEN, ASANA_WORKSPACE_GID, APP_PASSWORD
# Optional: PORT, OCCUPANCY_FILE (mount the spreadsheet and point at it)
CMD ["npx", "tsx", "server/index.ts"]
