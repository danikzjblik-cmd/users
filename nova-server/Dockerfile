FROM node:20-alpine

WORKDIR /app

# Copy application files
COPY package*.json ./
COPY database.js security.js server.js admin-keygen.js ./
COPY data ./data

# Expose port (Render, Railway, Koyeb automatically bind to $PORT)
ENV PORT=3030
EXPOSE 3030

CMD ["node", "server.js"]
