FROM oven/bun:1-alpine
COPY . .
ENV PORT=3000
EXPOSE 3000
CMD ["bun", "server.js"]
