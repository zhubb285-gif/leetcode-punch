FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
# 零依赖项目；保留 install 以兼容未来加包；若仍为空也无害
RUN npm install --omit=dev || true
COPY . .
# 后端监听 process.env.PORT（云平台会自动注入）；容器内默认 3000
ENV PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]