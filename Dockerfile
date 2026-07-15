# Step 1: Build Stage
FROM node:20-alpine AS builder
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy all application code
COPY . .

# Compile TypeScript to JavaScript (assumes you have a "build" script in package.json)
RUN npm run build

# Step 2: Production Run Stage
FROM node:20-alpine AS runner
WORKDIR /app

# Only install production dependencies to keep the image lightweight
COPY package*.json ./
RUN npm install --only=production

# Copy compiled JavaScript files from the builder stage
COPY --from=builder /app/dist ./dist

EXPOSE 3000
CMD ["node", "dist/Book_API.js"]