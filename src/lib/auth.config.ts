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
      // Pre-seeded users (created via /admin/users invite) have a row in
      // `user` but no linked `account`. Without this flag, Auth.js refuses
      // to attach the Google account on first sign-in and throws
      // OAuthAccountNotLinked. Safe here because ALLOWED_EMAIL_DOMAIN +
      // the signIn callback restrict to a Google Workspace we control.
      allowDangerousEmailAccountLinking: true,
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
      // Public routes that must not require a session:
      //  - /signin and /api/auth/*: Auth.js itself
      //  - /api/cron/*: Vercel Cron hits these with vercel-cron/1.0 and no
      //    cookies; the route handlers verify CRON_SECRET themselves.
      if (
        path.startsWith("/signin") ||
        path.startsWith("/api/auth") ||
        path.startsWith("/api/cron")
      ) {
        return true;
      }
      if (!session?.user) return false;
      // /dashboard and /api/dashboard are manager-only.
      if (path.startsWith("/dashboard") || path.startsWith("/api/dashboard")) {
        return isManager(session.user.email);
      }
      // /admin/* (role-management UI) is manager-only.
      if (path.startsWith("/admin") || path.startsWith("/api/admin")) {
        return isManager(session.user.email);
      }
      // /production is role-gated, but role lookup needs the DB which the
      // edge runtime can't reach. Let any signed-in domain user past the
      // middleware; the page itself enforces role === "production" (or
      // manager, who is a superset). See app/(app)/production/page.tsx.
      return true;
    },
  },
};
