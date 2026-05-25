FROM node:20-alpine

# Install build dependencies for native modules (e.g. for sqlite, chokidar, etc.)
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package configurations
COPY package.json ./
COPY yarn.lock* ./

# Install dependencies automatically (uses yarn if yarn.lock exists, otherwise npm)
# We force nodeLinker to node-modules so that "node server.js" works natively.
RUN if [ -f "yarn.lock" ]; then \
        corepack enable && yarn config set nodeLinker node-modules && yarn install; \
    else \
        npm install; \
    fi

# Copy all project files
COPY . .

# Ensure necessary directories exist and have proper permissions
RUN mkdir -p data public/uploads && chown -R node:node data public/uploads

# Expose the application port (matches .env default)
EXPOSE 3000

# Run the backend application
CMD ["node", "server.js"]
