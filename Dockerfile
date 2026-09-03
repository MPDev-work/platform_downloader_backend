FROM node:20-bookworm-slim

# Install FFmpeg and Python3 (required by yt-dlp)
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg python3 && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy dependency manifests
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code and build configuration
COPY . .

# Build TypeScript to Javascript (/dist)
RUN npm run build

# Expose server port
EXPOSE 3000

ENV PORT=3000
ENV NODE_ENV=production

# Start compiled application with Node directly (low memory, high performance)
CMD ["node", "dist/server.js"]
