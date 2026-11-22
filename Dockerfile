FROM node:22-alpine
WORKDIR /app
COPY package.json server.js ./
COPY src ./src
COPY public ./public
RUN mkdir -p /app/data && chown -R node:node /app
USER node
ENV PORT=3000 DB_PATH=/app/data/malt-ember.db TRUST_PROXY=1
EXPOSE 3000
CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
