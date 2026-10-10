# Optional fallback only if native runtime lacks media tools. Not built/deployed.
FROM node:24.19.0-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && ffprobe -version >/dev/null && ffmpeg -version >/dev/null
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY server.js access.js media-validation.js provider-diagnostics.js index.html ./
COPY staging/server.js ./staging/server.js
COPY test/fixtures/mock-video.mp4 ./test/fixtures/mock-video.mp4
ENV NODE_ENV=production DUBBING_ENABLED=false
USER node
EXPOSE 10000
CMD ["node", "staging/server.js"]
