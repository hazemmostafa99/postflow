import type { Metadata } from "next";
import { LandingPage } from "@/components/landing-page";

export const metadata: Metadata = {
  title: "PostFlow — Social publishing built for sales",
  description:
    "Plan, publish, and track social content from one focused sales workspace.",
  alternates: {
    canonical: "/",
    languages: { en: "/", ar: "/ar" },
  },
};

export default function EnglishLandingPage() {
  return <LandingPage locale="en" />;
}
