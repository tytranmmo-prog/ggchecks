# Base image from Microsoft which includes all necessary Playwright system dependencies (Chromium, WebKit, Firefox)
# We specifically pin the OS release (jammy) and the Playwright version matching package.json (1.58.2)
FROM mcr.microsoft.com/playwright:v1.58.2-jammy

# Set non-interactive mode for apt-get
ENV DEBIAN_FRONTEND=noninteractive

# Update system and install basic utilities
RUN apt-get update && apt-get install -y curl unzip && rm -rf /var/lib/apt/lists/*

# Install Bun globally
ENV BUN_INSTALL="/usr/local"
RUN curl -fsSL https://bun.sh/install | bash

# Set working directory
WORKDIR /app

# Copy dependency manifests first to leverage Docker layer caching
COPY package.json bun.lock tsconfig.json ./

# Install project dependencies
RUN bun install --frozen-lockfile

# Install the Playwright Chromium browser binaries explicitly just in case
RUN npx playwright install chromium

# Copy the rest of the application files
COPY . .

# Build the Next.js application
# Note: Since the app reads heavily from environment variables which might not be available at build time,
# you may want to ensure your Next.js build is configured appropriately or pass build args if necessary.
RUN bun run build

# Expose the default Next.js port
EXPOSE 3000

# Specify environment variable defaults for container
ENV PORT=3000
ENV NODE_ENV=production

# The default startup command
CMD ["bun", "run", "start"]
