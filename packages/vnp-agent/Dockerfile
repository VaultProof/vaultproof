FROM node:22-alpine

WORKDIR /app

COPY package.json ./
COPY ../../package-lock.json ./
RUN npm install --omit=dev

COPY dist/ ./dist/

ENV GATEWAY_URL=http://localhost:3001
ENV DEVICE_ID=agent-1
ENV DEVICE_IP=127.0.0.1
ENV SYSLOG_PORT=5140

EXPOSE 5140/udp

CMD ["node", "dist/index.js"]
