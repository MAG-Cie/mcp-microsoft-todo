FROM node:20-alpine

WORKDIR /app

# Install only prod deps
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Copy built code
COPY dist ./dist

# Stdio MCP server, no port to expose
CMD ["node", "dist/index.js"]