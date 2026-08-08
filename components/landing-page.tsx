import { useState } from "react";
import { Button } from "./ui/button";
import { LoginModal } from "./login-modal";
import { sourceUrl } from "./source-notice";

interface LandingPageProps {
  onLogin: () => void;
}

/** The three claims a self-hoster is actually evaluating, in the order they matter. */
const CREED = [
  {
    numeral: "I.",
    lead: "The map is real geometry.",
    body: "Burgs, rivers, routes and biomes live in PostGIS — the world is queried, not drawn.",
  },
  {
    numeral: "II.",
    lead: "Server-authoritative state.",
    body: "Phase, turn order, HP and death saves are rows under lock, not vibes in a chat log.",
  },
  {
    numeral: "III.",
    lead: "Yours to run.",
    body: "AGPL-3.0-only, your Postgres, your model. Run your own instance; there is nothing to buy.",
  },
] as const;

/** Pin colours are lifted from the app itself: terracotta, map water, settlement fields. */
const DATA_POINTS = [
  {
    pin: "#c8511f",
    title: "The DM is a model",
    body: "Enemy turns, NPCs and narration, constrained by schema.",
  },
  {
    pin: "#3f7ea6",
    title: "Full 5e loop",
    body: "Creation, combat, death saves, rests, levels, loot.",
  },
  {
    pin: "#8ba05f",
    title: "Yours to run",
    body: "AGPL-3.0-only. Your Postgres, your model, no SaaS.",
  },
] as const;

const FOOTER_LINKS = [
  { label: "Source", href: sourceUrl },
  { label: "Docs", href: "https://github.com/barrulus/questables/tree/main/docs" },
  {
    label: "SRD 5.1 / 5.2 · CC-BY-4.0",
    href: "https://creativecommons.org/licenses/by/4.0/legalcode",
  },
] as const;

export function LandingPage({ onLogin }: LandingPageProps) {
  const [showLogin, setShowLogin] = useState(false);

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#f3e4c8] font-alegreya text-[#4a331f]">
      {/* Letterpress tooth. Decorative only, and cheap: a repeating gradient, no image. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-50"
        style={{
          backgroundImage:
            "repeating-linear-gradient(45deg, rgba(120,72,40,.05) 0 1px, transparent 1px 6px)",
        }}
      />

      <div className="relative flex min-h-screen flex-col">
        {/* Header */}
        <header className="flex items-center justify-between border-b-[3px] border-double border-[#2e1c10] px-6 py-6 sm:px-10 lg:px-14 lg:py-[34px]">
          <div className="flex min-w-0 items-center gap-[14px]">
            <img
              src="/questables-icon.png"
              alt=""
              aria-hidden="true"
              width={38}
              height={38}
              className="size-[30px] flex-none border-2 border-[#2e1c10] object-cover sm:size-[38px]"
            />
            <span className="truncate font-fell text-[17px] leading-none tracking-[0.06em] text-[#2e1c10] sm:text-[26px]">
              QUESTABLES
            </span>
          </div>

          <div className="flex flex-none items-center gap-3 lg:gap-[26px]">
            <span className="hidden text-[11px] font-medium uppercase leading-none tracking-[0.22em] text-[#7a5636] lg:inline">
              AGPL-3.0 · self-hosted · invite only
            </span>
            <Button
              variant="slab"
              size="slab"
              className="px-2.5 py-2 text-[10px] tracking-[0.1em] sm:px-[22px] sm:py-[11px] sm:text-[12px] sm:tracking-[0.16em]"
              onClick={() => setShowLogin(true)}
            >
              Sign in with passkey
            </Button>
          </div>
        </header>

        {/* Hero */}
        <div className="grid gap-10 px-6 pb-10 pt-10 sm:px-10 lg:grid-cols-[520px_1fr] lg:gap-14 lg:px-14 lg:pb-10 lg:pt-16">
          {/* Icon plate */}
          <figure className="m-0 mx-auto w-full max-w-[420px] lg:max-w-none">
            <div className="border-[3px] border-[#2e1c10] bg-[#e9d3ab] p-[10px]">
              <picture>
                <source srcSet="/questables-icon.webp" type="image/webp" />
                <img
                  src="/questables-icon.png"
                  alt="Two adventurers, spear and bow"
                  className="block h-auto w-full [filter:saturate(1.05)_contrast(1.02)]"
                />
              </picture>
              <figcaption className="mt-[10px] text-center font-fell text-[15px] italic leading-[1.4] text-[#6b4426]">
                The pair set out at first light. No one at the table was told what waited.
              </figcaption>
            </div>
          </figure>

          {/* Pitch */}
          <div>
            <p className="mb-[14px] text-[11px] font-medium uppercase leading-none tracking-[0.28em] text-[#b4441a]">
              A 5e table for you and your party
            </p>
            <p className="mb-5 text-[11px] uppercase leading-none tracking-[0.24em] text-[#9a6a3c]">
              SRID 0 · pixel space · every burg queryable
            </p>

            <h1 className="mb-[26px] font-fell text-[40px] leading-[0.94] text-balance text-[#2e1c10] sm:text-[56px] lg:text-[84px]">
              No one has to
              <br />
              run the game.
            </h1>

            <p className="mb-[30px] max-w-[520px] text-[21px] leading-[1.55] text-[#4a331f]">
              The Dungeon Master is a model. It narrates, plays every enemy on its own turn, and
              answers to a JSON schema rather than a mood. You and your party declare what your
              characters do; the world answers back. Someone has to be Campaign Director, but that
              is a job of shaping the world, not adjudicating it.
            </p>

            <dl className="max-w-[560px] border-t border-[#c3a377]">
              {CREED.map(({ numeral, lead, body }) => (
                <div
                  key={numeral}
                  className="grid grid-cols-[34px_1fr] gap-4 border-b border-[#c3a377] py-4"
                >
                  <dt className="font-fell text-[20px] leading-none text-[#b4441a]">{numeral}</dt>
                  <dd className="m-0 text-[17px] leading-[1.45] text-[#4a331f]">
                    <b className="font-bold text-[#2e1c10]">{lead}</b> {body}
                  </dd>
                </div>
              ))}
            </dl>

            <div className="mt-[30px] flex flex-wrap items-center gap-5">
              <Button variant="slab" size="slab-lg" onClick={() => setShowLogin(true)}>
                Sign in with passkey
              </Button>
              <p className="font-fell text-[16px] italic leading-[1.4] text-[#7a5636]">
                Accounts are issued by an administrator.
              </p>
            </div>
          </div>
        </div>

        {/* Data-point band */}
        <div className="mx-6 grid gap-6 border-t border-[#c3a377] pb-[30px] pt-[26px] sm:mx-10 sm:grid-cols-2 lg:mx-14 lg:grid-cols-3 lg:gap-10">
          {DATA_POINTS.map(({ pin, title, body }) => (
            <div key={title} className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className="mt-1 size-[15px] flex-none rounded-full border-2 border-[#2e1c10]"
                style={{ backgroundColor: pin }}
              />
              <div>
                <h2 className="font-fell text-[22px] leading-[1.15] text-[#2e1c10]">{title}</h2>
                <p className="mt-1 text-[15px] leading-[1.45] text-[#7a5636]">{body}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="flex-1" />

        {/* Footer */}
        <footer className="flex flex-col items-start justify-between gap-3 border-t-[3px] border-double border-[#2e1c10] px-6 pb-[26px] pt-5 text-[13px] leading-[1.4] text-[#7a5636] sm:px-10 lg:flex-row lg:items-center lg:px-14">
          <p>
            © 2026 Questables · Licensed AGPL-3.0-only · Maps from Azgaar&apos;s FMG · Streets by
            settlemaker
          </p>
          <nav className="flex flex-wrap gap-[22px]">
            {FOOTER_LINKS.map(({ label, href }) => (
              <a
                key={label}
                href={href}
                target="_blank"
                rel="noreferrer noopener"
                className="text-[#7a5636] no-underline transition-colors duration-150 hover:text-[#2e1c10] hover:underline"
              >
                {label}
              </a>
            ))}
          </nav>
        </footer>
      </div>

      <LoginModal open={showLogin} onOpenChange={setShowLogin} onLogin={onLogin} />
    </div>
  );
}
