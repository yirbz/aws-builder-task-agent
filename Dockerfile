FROM mcr.microsoft.com/playwright:v1.52.0-noble

WORKDIR /app

# Install Xvfb, virtual display, and HTML5 noVNC dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb \
    xauth \
    x11vnc \
    novnc \
    websockify \
    fluxbox \
    net-tools \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/share/novnc/vnc.html /usr/share/novnc/index.html

# Install pnpm inside container
RUN npm install -g pnpm@11.7.0

COPY package*.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY src/ ./src/
RUN pnpm run build

COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

# Create runtime directories
RUN mkdir -p /app/data/browser-profile /app/data/screenshots

VOLUME ["/app/data"]
EXPOSE 6080

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["scheduler:start"]
