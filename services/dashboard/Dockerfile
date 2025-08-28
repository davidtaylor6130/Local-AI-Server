# Build frontend
FROM node:18-alpine AS webbuild
WORKDIR /app/web
COPY web/package.json web/package-lock.json* ./
RUN npm install --no-audit --no-fund || npm install --no-audit --no-fund
COPY web ./
RUN npm run build

# Build server
FROM node:18-alpine AS server
WORKDIR /app/server
COPY server/package.json server/package-lock.json* ./
RUN npm install --no-audit --no-fund || npm install --no-audit --no-fund
COPY server ./
COPY --from=webbuild /app/web/dist ./public

ENV PORT=3000
EXPOSE 3000
CMD ["npm","start"]

