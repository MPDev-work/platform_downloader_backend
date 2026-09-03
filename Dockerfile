FROM node:22-bookworm-slim

# Install system dependencies: FFmpeg, Python 3, build tools, curl, ca-certificates
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ffmpeg \
        python3 \
        python-is-python3 \
        build-essential \
        curl \
        ca-certificates && \
    ln -sf /usr/bin/python3 /usr/bin/python && \
    rm -rf /var/lib/apt/lists/*

# Install standalone yt-dlp binary globally
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app

# Copy dependency manifests
COPY package*.json ./

# Install all dependencies (force inclusion of dev packages even if NODE_ENV=production)
RUN npm install --include=dev

# Copy application source code
COPY . .

# Ensure yt-dlp is placed where yt-dlp-exec expects it
RUN mkdir -p /app/node_modules/yt-dlp-exec/bin && \
    cp /usr/local/bin/yt-dlp /app/node_modules/yt-dlp-exec/bin/yt-dlp && \
    chmod a+rx /app/node_modules/yt-dlp-exec/bin/yt-dlp

# Build TypeScript to Javascript (/dist)
RUN npm run build

# Expose server port
EXPOSE 3000

ENV PORT=3000
ENV NODE_ENV=production

# Start compiled application directly with Node
CMD ["node", "dist/server.js"]
