import type { Metadata } from "next";
import { LandingPage } from "@/components/landing-page";

export const metadata: Metadata = {
  title: "PostFlow for Companies — Organize your sales operation",
  description:
    "Give your sales organization a dedicated PostFlow workspace with teams, roles, publishing visibility, and guided setup.",
  alternates: {
    canonical: "/companies",
    languages: { en: "/companies", ar: "/ar/companies" },
  },
};

export default function CompaniesLandingPage() {
  return <LandingPage locale="en" audience="company" />;
}
