FROM node:20-slim
USER root
RUN apt-get update && apt-get install -y\
    xvfb x11vnc novnc websockify fluxbox \
    chromium\
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 libasound2 --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app 

COPY package*.json ./
RUN npm install
RUN npx playwright install --with-deps chromium
COPY . .
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV NODE_ENV=production

EXPOSE 8080
EXPOSE 6080

ENTRYPOINT ["/entrypoint.sh"]