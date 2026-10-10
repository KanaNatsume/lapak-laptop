FROM node:22-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build:frontend

RUN useradd --system --create-home --uid 10001 pos-laptop \
  && mkdir -p /var/lib/pos-laptop/data /var/lib/pos-laptop/backups /var/backups/pos-laptop \
  && chown -R pos-laptop:pos-laptop /app /var/lib/pos-laptop /var/backups/pos-laptop

ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_PATH=/var/lib/pos-laptop/data/pos.sqlite \
    BACKUP_DIR=/var/lib/pos-laptop/backups

USER pos-laptop
EXPOSE 3000

CMD ["node", "src/server.js"]
