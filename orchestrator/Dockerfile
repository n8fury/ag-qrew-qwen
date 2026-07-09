# Playwright base image — version MUST match the `playwright` version in package-lock.json
# (browsers are pre-installed for exactly that version).
FROM mcr.microsoft.com/playwright:v1.61.1-noble

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY prompts ./prompts
COPY src ./src

# qa/ is the shared artifact volume (bus, SQLite DB, reports, generated specs)
RUN mkdir -p qa

EXPOSE 8787
CMD ["npx", "tsx", "src/server.ts"]
