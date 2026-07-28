FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY server.js finance.mjs currency.mjs group-currency-conversion.mjs expense-currency.mjs exchange-rates.mjs ledger-integer-safety.mjs bank-account.mjs account-simulation.mjs ./
COPY --from=build /app/dist ./dist
EXPOSE 8080
CMD ["node", "server.js"]
