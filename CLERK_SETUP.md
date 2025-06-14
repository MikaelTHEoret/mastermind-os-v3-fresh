# Clerk Authentication Setup Guide

MasterMind OS v3.0 uses [Clerk](https://clerk.com) for secure, modern authentication with beautiful cyberpunk theming.

## 🚀 Quick Setup

### 1. Local Development

1. **Copy environment variables:**
   ```bash
   cp .env.local.example .env.local
   ```

2. **The `.env.local` file contains:**
   ```bash
   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="pk_test_cHJpbWFyeS1rYW5nYXJvby01MS5jbGVyay5hY2NvdW50cy5kZXYk"
   CLERK_SECRET_KEY="sk_test_tMkstZauUBT7doefmbAhuYhrrCr6VjIjNeGThb7dCS"
   ```

3. **Restart your development server:**
   ```bash
   npm run dev
   ```

4. **Test authentication:**
   - Click the "SIGN IN" button in the top right
   - Create an account or sign in
   - Enjoy the cyberpunk-themed authentication experience!

### 2. Production Deployment (Vercel)

1. **Go to your Vercel dashboard**
2. **Select your project** (mastermind-os-v3-fresh)
3. **Navigate to:** Settings → Environment Variables
4. **Add the following variables:**

   | Variable Name | Value | Environment |
   |---------------|-------|-------------|
   | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | `pk_test_cHJpbWFyeS1rYW5nYXJvby01MS5jbGVyay5hY2NvdW50cy5kZXYk` | Production |
   | `CLERK_SECRET_KEY` | `sk_test_tMkstZauUBT7doefmbAhuYhrrCr6VjIjNeGThb7dCS` | Production |

5. **Redeploy your application**
6. **Verify authentication works** on your live site

## 🎨 Cyberpunk Theme Features

The authentication system includes comprehensive cyberpunk styling:

- **Dark gradient backgrounds** with electric blue and purple
- **Glowing borders and effects** using CSS animations
- **Orbitron and Rajdhani fonts** for futuristic typography
- **Hover animations** with scale and glow effects
- **Glass morphism effects** with backdrop blur
- **Custom color palette** matching the app aesthetic

## 🔧 Authentication Features

### Sign-In/Sign-Up Modal
- Beautiful modal overlay with cyberpunk styling
- Email + password authentication
- OAuth providers (Google, GitHub, etc.)
- Password strength indicators
- Responsive design

### User Profile Dashboard
- Complete account management
- Profile picture upload
- Security settings
- Session management
- Device management

### UserButton Component
- Customized with cyberpunk appearance
- Glowing avatar border
- Dropdown menu with styled actions
- Seamless integration with app design

## 🛠️ Customization

### Theme Configuration
The Clerk appearance is configured in `src/lib/clerk-config.ts`:
- `clerkAppearance` - Main authentication theme
- `userButtonAppearance` - UserButton specific styling

### Environment Variables
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` - Client-side configuration
- `CLERK_SECRET_KEY` - Server-side configuration (keep secure!)

## 🔒 Security Notes

- **Never commit** `.env.local` to version control
- **Keep secret keys secure** and rotate them periodically
- **Use different keys** for development and production
- **Enable two-factor authentication** in Clerk dashboard

## 🆘 Troubleshooting

### "SETUP AUTH" Button Showing
This means environment variables aren't configured. Follow steps above.

### Authentication Modal Not Opening
Check browser console for Clerk-related errors and verify environment variables.

### Styling Issues
Ensure Google Fonts are loading properly and CSS variables are applied.

## 📞 Support

If you encounter issues:
1. Check the browser console for errors
2. Verify environment variables are set correctly
3. Ensure Clerk dashboard configuration matches your setup
4. Try clearing browser cache and localStorage

---

**Enjoy your cyberpunk-themed authentication system! 🚀✨**
