FROM node:20-alpine

WORKDIR /app

# Placeholder — Phase 4 will build the real Next.js app
# For now, serve a simple health-check page
RUN npm init -y && npm install next@latest react@latest react-dom@latest

COPY . .

# Create a minimal Next.js app for healthcheck
RUN mkdir -p app && \
    echo 'export default function Home() { return <h1>Vantax Dashboard</h1>; }' > app/page.tsx && \
    echo 'export default function RootLayout({ children }: { children: React.ReactNode }) { return <html><body>{children}</body></html>; }' > app/layout.tsx

RUN npx next build || true

EXPOSE 3000

CMD ["npx", "next", "start"]
