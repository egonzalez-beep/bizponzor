FROM node:18-alpine
RUN apk add --no-cache python3 make g++ gcc
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN mkdir -p uploads
RUN mkdir -p data
EXPOSE 3000
CMD ["node", "server.js"]
