# Astroman — container image for managed hosting (Render / Railway / Fly).
FROM node:22-bookworm

ENV NODE_ENV=production
WORKDIR /app

# Install production deps first for better layer caching. sweph ships prebuilt
# binaries; this full image also has build tools if a native compile is needed.
COPY package*.json ./
RUN npm ci --omit=dev

# App source
COPY . .

# The host injects PORT; the app reads process.env.PORT (falls back to 3030).
# Accounts + saved people live in Supabase (SUPABASE_URL / SUPABASE_SERVICE_KEY),
# so no persistent disk is required.
EXPOSE 3030
CMD ["node", "server/index.js"]
