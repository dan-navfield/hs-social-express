# Use Apify's base image with Playwright pre-installed (Node 20)
FROM apify/actor-node-playwright-chrome:20

# Copy package files
COPY package*.json ./

# Install all dependencies including dev (explicit flag)
RUN npm install --include=dev

# Verify TypeScript is installed
RUN ls -la node_modules/.bin/ | head -20

# Copy TypeScript config and source
COPY tsconfig.json ./
COPY src ./src

# Build TypeScript using the locally installed tsc
RUN ./node_modules/.bin/tsc

# Remove dev dependencies after build
RUN npm prune --omit=dev

# Run the actor
CMD npm run start
