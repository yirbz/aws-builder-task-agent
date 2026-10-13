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
    && echo '<!DOCTYPE html><html><head><meta charset="utf-8"><title>AWS Builder Streak Agent</title><meta http-equiv="refresh" content="0; url=vnc.html?autoconnect=true&resize=remote"><script>window.location.replace("vnc.html?autoconnect=true&resize=remote");</script></head><body style="background:#1a1a1a;color:#eee;font-family:sans-serif;text-align:center;padding-top:60px;"><h2>Connecting to session...</h2><p><a href="vnc.html?autoconnect=true&resize=remote" style="color:#4dabf7;">Click here if not redirected automatically</a></p></body></html>' > /usr/share/novnc/index.html

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
