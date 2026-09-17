import { createFileRoute } from "@tanstack/react-router";
import { FamiliaSteamApp } from "@/components/familia-steam-app";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Família Steam — Nossa retrospectiva de jogos" },
      { name: "description", content: "Compras, presentes, rankings e memórias da biblioteca Steam da família." },
      { property: "og:title", content: "Família Steam — Nossa retrospectiva de jogos" },
      { property: "og:description", content: "Compras, presentes, rankings e memórias da biblioteca Steam da família." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: FamiliaSteamApp,
});