import { Code2 } from "lucide-react";
import { cn } from "./ui/utils";

/**
 * AGPL-3.0 §13 source offer.
 *
 * Questables is licensed AGPL-3.0-only. Section 13 requires that anyone who runs a *modified*
 * version and lets users interact with it over a network must offer those users the Corresponding
 * Source of the version they are actually talking to.
 *
 * This link is the offer, and it must remain reachable from every application state. If you deploy
 * a modified Questables, point `VITE_SOURCE_URL` at *your* source — leaving it at upstream does not
 * discharge the obligation, because upstream is not the code your users are running.
 *
 * `VITE_SOURCE_REVISION` is optional but strongly recommended: "the source" means the exact
 * revision being served, so publishing the commit makes the offer verifiable rather than
 * approximate.
 */

const UPSTREAM_SOURCE_URL = "https://github.com/barrulus/questables";

const viteEnv = (import.meta as { env?: Record<string, unknown> }).env ?? {};

const readEnv = (key: string): string | undefined => {
  const value = viteEnv[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
};

export const sourceUrl = readEnv("VITE_SOURCE_URL") ?? UPSTREAM_SOURCE_URL;
export const sourceRevision = readEnv("VITE_SOURCE_REVISION");

export interface SourceNoticeProps {
  className?: string;
}

/**
 * Fixed, unobtrusive source link. Rendered once at the app root so it survives every top-level
 * state change (landing, dashboard, game, character creation).
 *
 * The wrapper is `pointer-events-none` so it can sit over the full-screen map without swallowing
 * clicks; only the anchor itself is interactive.
 */
export function SourceNotice({ className }: SourceNoticeProps) {
  const label = sourceRevision
    ? `Source code (AGPL-3.0, revision ${sourceRevision})`
    : "Source code (AGPL-3.0)";

  return (
    <div
      className={cn(
        "pointer-events-none fixed bottom-0 left-0 z-50 p-1.5 print:hidden",
        className,
      )}
    >
      <a
        href={sourceUrl}
        target="_blank"
        rel="noreferrer noopener license"
        title={label}
        aria-label={label}
        className={cn(
          "pointer-events-auto inline-flex items-center gap-1 rounded-md px-1.5 py-0.5",
          "text-[10px] leading-none text-muted-foreground/40",
          "bg-background/60 backdrop-blur-sm",
          "transition-colors hover:text-foreground hover:bg-background/90",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          "focus-visible:text-foreground focus-visible:bg-background",
        )}
      >
        <Code2 className="h-3 w-3" aria-hidden="true" />
        <span>Source</span>
        {sourceRevision ? (
          <span className="font-mono opacity-70">{sourceRevision.slice(0, 7)}</span>
        ) : null}
      </a>
    </div>
  );
}

export default SourceNotice;
