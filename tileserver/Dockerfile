FROM maptiler/tileserver-gl:v4.10.0

# Switch to root to install packages
USER root

# Install sqlite3 for creating bootstrap MBTiles (Ubuntu-based image)
RUN apt-get update && apt-get install -y sqlite3 && rm -rf /var/lib/apt/lists/*

# Copy init script from scripts directory (context is root directory)
COPY scripts/init-tileserver.sh /usr/local/bin/init-tileserver.sh
RUN chmod +x /usr/local/bin/init-tileserver.sh

# Switch back to original user
USER node

# Use init script as entrypoint
ENTRYPOINT ["/bin/sh", "/usr/local/bin/init-tileserver.sh"]
