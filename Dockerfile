FROM node:alpine@sha256:5209bcaca9836eb3448b650396213dbe9d9a34d31840c2ae1f206cb2986a8543 AS builder

RUN apk add --no-cache openssl=3.5.6-r0

WORKDIR /app

COPY ./package.json ./package.json
COPY ./package-lock.json ./package-lock.json

RUN npm ci --ignore-scripts

COPY ./src ./src
COPY ./tsconfig.json ./tsconfig.json

RUN npm run build

FROM node:alpine@sha256:5209bcaca9836eb3448b650396213dbe9d9a34d31840c2ae1f206cb2986a8543 AS release

RUN apk add --no-cache openssl=3.5.6-r0

WORKDIR /app

COPY --from=builder /app/dist /app/dist
COPY --from=builder /app/package.json /app/package.json
COPY --from=builder /app/package-lock.json /app/package-lock.json

ENV NODE_ENV=production

RUN npm ci --ignore-scripts --omit-dev

USER node

ENTRYPOINT ["node", "dist/index.js"]
