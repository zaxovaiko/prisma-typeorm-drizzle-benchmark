FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json ./
RUN npm install
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npx prisma generate
COPY tsconfig.json nest-cli.json ./
COPY src ./src
RUN npm run build

# Patch Prisma 7 generated CJS output: Alpine tsc emits import.meta.url and .ts requires
RUN find dist/generated -name "*.js" | while read f; do \
      grep -v "globalThis\[" "$f" | grep -v "node_url_1" > /tmp/_patch.js; \
      mv /tmp/_patch.js "$f"; \
      sed -i 's/\.ts")/")/' "$f"; \
    done

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
EXPOSE 3001
CMD ["node", "dist/main.js"]
