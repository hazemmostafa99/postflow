import type { Metadata } from "next";
import { LandingPage } from "@/components/landing-page";

export const metadata: Metadata = {
  title: "iPostFlow for Companies — Organize your sales operation",
  description:
    "Give your sales organization a dedicated iPostFlow workspace with teams, roles, publishing visibility, and guided setup.",
  alternates: {
    canonical: "/companies",
    languages: { en: "/companies", ar: "/ar/companies" },
  },
};

export default function CompaniesLandingPage() {
  return <LandingPage locale="en" audience="company" />;
}
