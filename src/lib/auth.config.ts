import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import { isManager } from "./managers";

const allowedDomain = process.env.ALLOWED_EMAIL_DOMAIN;

// Edge-safe config — no database adapter, no Node-only modules.
// The middleware uses this for gating; the full auth() in ./auth.ts
// attaches the Drizzle adapter for the Node runtime.
export const authConfig: NextAuthConfig = {
  session: { strategy: "jwt" },
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    }),
  ],
  pages: {
    signIn: "/signin",
  },
  callbacks: {
    signIn({ profile }) {
      if (!allowedDomain) return true;
      const email = profile?.email;
      if (!email) return false;
      return email.toLowerCase().endsWith(`@${allowedDomain.toLowerCase()}`);
    },
    jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
      return token;
    },
    session({ session, token }) {
      if (session.user && token.sub) session.user.id = token.sub;
      return session;
    },
    authorized({ auth: session, request }) {
      const path = request.nextUrl.pathname;
      if (path.startsWith("/signin") || path.startsWith("/api/auth")) {
        return true;
      }
      if (!session?.user) return false;
      // /dashboard and /api/dashboard are manager-only. Cron routes have
      // their own header-based secret check; they don't need a session.
      if (path.startsWith("/dashboard") || path.startsWith("/api/dashboard")) {
        return isManager(session.user.email);
      }
      return true;
    },
  },
};
