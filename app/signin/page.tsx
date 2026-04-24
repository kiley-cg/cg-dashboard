import { signIn } from "@/lib/auth";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/Button";

type Props = {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
};

export default async function SignInPage({ searchParams }: Props) {
  const { callbackUrl, error } = await searchParams;

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="bg-white border border-cg-n-200 rounded-card p-8 w-full max-w-sm flex flex-col items-center gap-6 shadow-sm">
        <Logo size={72} />
        <div className="text-center">
          <h1 className="text-2xl font-extrabold tracking-tight">
            Inventory Check
          </h1>
          <p className="font-script text-cg-red text-lg mt-1">
            An Alaska Native-Owned Company
          </p>
          <p className="text-cg-n-500 text-sm mt-2">
            Color Graphics internal tool
          </p>
        </div>
        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: callbackUrl ?? "/" });
          }}
          className="w-full"
        >
          <Button type="submit" size="lg" className="w-full">
            Sign in with Google
          </Button>
        </form>
        {error && (
          <p className="text-sm text-cg-danger">
            Sign-in failed. Make sure you&apos;re using your Color Graphics
            account.
          </p>
        )}
      </div>
    </main>
  );
}
