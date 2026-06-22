FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4177
ENV DATA_DIR=/app/data

COPY package.json ./
COPY serve-static.js ./
COPY index.html ./
COPY src ./src
COPY assets ./assets
COPY tools ./tools
COPY docs ./docs

RUN mkdir -p /app/data \
  && chown -R node:node /app

USER node

EXPOSE 4177

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 4177) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "serve-static.js"]
