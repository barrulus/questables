# Deploy Guide

This is a comprehensive React application ready for deployment!
Here's a complete deployment guide:

## 🚀 Deployment Strategy

## Database Setup (Supabase + PostGIS)

First, set up your production database:

Create Supabase Project:

Go to supabase.com and create a new project
Enable PostGIS extension in your project:

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
```

Deploy Database Schema:

Run the `/database/schema.sql` in the Supabase SQL editor
Import any Azgaar's FMG map data you have

## Frontend Deployment Options

Option A: Vercel (Recommended)

```bash
# Install Vercel CLI
npm install -g vercel

# Deploy from your project directory
vercel

# Follow prompts to connect your repo
```

Option B: Netlify

```bash
# Build your project
npm run build

# Deploy to Netlify
- Drag dist folder to netlify.com
- Or connect GitHub repo
```

Option C: Custom Server

```bash
# Build project
npm run build

# Serve with any static hosting
(Apache, Nginx, etc.)
```

## Environment Variables Setup

You'll need to configure these environment variables in your hosting platform:

```env
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
VITE_SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

For Vercel:
Go to your project dashboard → Settings → Environment Variables

For Netlify:
Go to Site settings → Environment variables

## Build Configuration

Create a `package.json` if you don't have one:

```json
{
  "name": "dnd-web-app",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "@supabase/supabase-js": "^2.38.0",
    "ol": "^8.0.0",
    "lucide-react": "^0.263.1",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.0.0",
    "tailwind-merge": "^1.14.0"
  },
  "devDependencies": {
    "@types/react": "^18.2.15",
    "@types/react-dom": "^18.2.7",
    "@vitejs/plugin-react": "^4.0.3",
    "typescript": "^5.0.2",
    "vite": "^4.4.5",
    "@tailwindcss/vite": "^4.0.0-alpha.15"
  }
}
```

## Vite Configuration

Create `vite.config.ts`:

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": "/src",
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
  server: {
    port: 3000,
  },
});
```

## Update File Paths for Production

Update your `/utils/supabase/info.tsx` to use environment variables:

## TypeScript Configuration

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "baseUrl": ".",
    "paths": {
      "@/": ["./src/"]
    }
  },
  "include": ["src", "components", "utils", "styles"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

## Deployment Steps

For Vercel Deployment:

Push to GitHub:

```bash
git init
git add .
git commit -m "Initial D&D app deployment"
git branch -M main
git remote add origin your-github-repo-url
git push -u origin main
```

Connect to Vercel:
Go to vercel.com
Import your GitHub repository
Set environment variables
Deploy!

Configure Build Settings:
Build Command: `npm run build`
Output Directory: `dist`
Install Command: `npm install`

## Domain & SSL

Custom Domain (Optional):

Add your domain in Vercel/Netlify dashboard
Configure DNS records to point to your hosting provider
SSL certificates are automatically provided

## Post-Deployment Checklist

✅ Test Core Features:

User authentication (login/register)
Role-based dashboards (Player/DM/Admin)
Map rendering with OpenLayers
Database connectivity
Real-time chat functionality

✅ Performance Optimization:

Enable gzip compression
Configure CDN for static assets
Optimize images and map tiles
Set up error monitoring (optional)

✅ Security:

Verify environment variables are secure
Test database permissions
Enable CORS properly in Supabase
Set up proper authentication flows

## Monitoring & Updates

Analytics (Optional):

Add Google Analytics or Vercel Analytics
Monitor performance and user engagement

Continuous Deployment:

Set up automatic deployments on Git push
Configure staging environment for testing

---

## 🎯 Quick Start Commands

```bash
# Clone/setup your project
git clone your-repo-url
cd dnd-web-app

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env.local

# Edit .env.local with your Supabase credentials

# Test locally
npm run dev

# Build for production
npm run build

# Deploy to Vercel
npx vercel

# Set environment variables in Vercel dashboard
```

Option 1: Vercel (Recommended)

```bash
# Install dependencies
npm install

# Create .env.local with your Supabase credentials
cp .env.example .env.local

# Edit .env.local with your actual Supabase URL and keys

# Test locally
npm run dev

# Deploy to Vercel
npx vercel
```

Option 2: Netlify

```bash
# Build the project
npm run build

# Deploy the dist folder to Netlify
# Set environment variables in Netlify dashboard
```

Option 3: Any Static Host

```bash
# Build for production
npm run build

#Upload dist folder to your hosting provider
```

📋 Deployment Checklist

✅ Environment Variables Set:

`VITE_SUPABASE_URL` - Your Supabase project URL
`VITE_SUPABASE_ANON_KEY` - Your Supabase anon key

✅ Database Ready:

PostGIS extension enabled
Database schema deployed (`/database/schema.sql`)
Azgaar's FMG data imported (optional for initial testing)

✅ Build Configuration:

All dependencies properly configured
TypeScript compilation working
Vite build process ready
