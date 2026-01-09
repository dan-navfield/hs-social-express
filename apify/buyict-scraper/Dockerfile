# Use Apify's base image with Playwright pre-installed (Node 20)
FROM apify/actor-node-playwright-chrome:20

# Copy package files
COPY package*.json ./

# Install ALL dependencies including devDependencies
RUN npm ci

# Copy TypeScript config and source
COPY tsconfig.json ./
COPY src ./src

# Build TypeScript
RUN npx tsc

# Remove dev dependencies after build
RUN npm prune --omit=dev

# Run the actor
CMD npm run start
