# Use Apify's base image with Playwright pre-installed
FROM apify/actor-node-playwright-chrome:18

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production --ignore-scripts --unsafe-perm

# Copy TypeScript config and source
COPY tsconfig.json ./
COPY src ./src

# Build TypeScript
RUN npm run build

# Run the actor
CMD npm run start
