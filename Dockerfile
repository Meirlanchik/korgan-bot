FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache \
    chromium \
    ca-certificates \
    freetype \
    harfbuzz \
    nss \
    ttf-freefont \
    python3 \
    make \
    g++

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && apk del python3 make g++

COPY src ./src

ENV NODE_ENV=production
ENV PORT=3000
ENV KASPI_BROWSER_PATH=/usr/bin/chromium-browser

EXPOSE 3000

CMD ["npm", "start"]
