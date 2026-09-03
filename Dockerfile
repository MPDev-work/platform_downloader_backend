FROM node:20-alpine

# Install FFmpeg and Python (required for yt-dlp)
RUN apk add --no-cache ffmpeg python3

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build || true # Build if needed, else run with ts-node

EXPOSE 3000

CMD ["npx", "ts-node", "src/server.ts"]
