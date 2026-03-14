FROM node:24.14.0-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps ./apps
COPY db ./db
COPY packages ./packages
COPY tsconfig.base.json ./

RUN npm install
RUN npm run build:runtimes

ENV PORT=8080
EXPOSE 8080

CMD ["npm", "run", "start", "--workspace", "@agent/agent-api"]
