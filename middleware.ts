import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";

// Edge-safe: does not import the DB adapter.
export const { auth: middleware } = NextAuth(authConfig);

export default middleware((req) => {
  // The `authorized` callback in authConfig handles the allow/deny decision;
  // Next.js auto-redirects unauthenticated users to `pages.signIn`.
  // This wrapper exists so the middleware file has a default export.
  return;
});

export const config = {
  matcher: [
    "/((?!api/auth|signin|_next/static|_next/image|favicon.ico|brand|icon.svg).*)",
  ],
};
