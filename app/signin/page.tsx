import { signIn } from "@/lib/auth";
import { Logo } from "@/components/Logo";

type Props = {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
};

export default async function SignInPage({ searchParams }: Props) {
  const { callbackUrl, error } = await searchParams;

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="bg-cg-surface border border-cg-border rounded-card p-8 w-full max-w-sm flex flex-col items-center gap-6">
        <Logo size={72} />
        <div className="text-center">
          <h1 className="text-xl font-bold">Inventory Check</h1>
          <p className="text-cg-muted text-sm mt-1">Color Graphics internal tool</p>
        </div>
        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: callbackUrl ?? "/" });
          }}
          className="w-full"
        >
          <button
            type="submit"
            className="w-full bg-cg-red hover:brightness-110 text-white font-semibold py-2 rounded-card transition"
          >
            Sign in with Google
          </button>
        </form>
        {error && (
          <p className="text-sm text-cg-red">
            Sign-in failed. Make sure you&apos;re using your Color Graphics
            account.
          </p>
        )}
      </div>
    </main>
  );
}
