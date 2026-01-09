# Use Apify's base image with Playwright pre-installed (Node 20)
FROM apify/actor-node-playwright-chrome:20

# Copy package files
COPY package*.json ./

# Install ALL dependencies (including dev for TypeScript build)
RUN npm install --ignore-scripts --unsafe-perm

# Copy TypeScript config and source
COPY tsconfig.json ./
COPY src ./src

# Build TypeScript
RUN npm run build

# Remove dev dependencies after build to reduce image size
RUN npm prune --production

# Run the actor
CMD npm run start
