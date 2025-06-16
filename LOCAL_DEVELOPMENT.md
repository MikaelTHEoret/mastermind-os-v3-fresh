# Local Development Setup Guide

## 🚀 Quick Start

1. **Install Dependencies:**
   ```bash
   npm install
   ```

2. **Start Development Server:**
   ```bash
   npm run dev
   ```

3. **Open in Browser:**
   Visit [http://localhost:3000](http://localhost:3000)

## 🔧 Development Commands

- `npm run dev` - Start development server (hot reload)
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run lint` - Run ESLint
- `npm run clean` - Clean build cache

## 📝 Environment Variables

The project uses these environment variables (already configured):

```env
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
```

## 🔄 Dual Deployment Setup

### Local Development (VS Code)
- Runs on `localhost:3000`
- Hot reload for instant changes
- Development mode with debug info
- Full TypeScript support

### Vercel Deployment  
- Production optimized builds
- Automatic deployments on git push
- Edge functions and optimizations
- No conflicts with local development

**Both can run simultaneously without any conflicts!**

## 🎯 Key Features Available Locally

- ✅ Clerk Authentication (test mode)
- ✅ All sections with full functionality
- ✅ Real-time data updates
- ✅ Framer Motion animations
- ✅ Tailwind CSS styling
- ✅ TypeScript support
- ✅ Hot module replacement

## 🛠️ VS Code Extensions (Recommended)

- Tailwind CSS IntelliSense
- ES7+ React/Redux/React-Native snippets
- TypeScript Importer
- Auto Rename Tag
- Prettier - Code formatter
- GitLens

## 📱 Testing Authentication

The Clerk test keys allow you to:
- Create test user accounts
- Sign in/out functionality
- Protected route testing
- User profile management

## 🚀 Production Deployment

When ready for production:
1. Push to GitHub repository
2. Vercel auto-deploys from main branch
3. Environment variables sync automatically
4. Production domain gets live updates

**No configuration changes needed between local and production!**