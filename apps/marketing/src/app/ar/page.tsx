import type { Metadata } from "next";
import { LandingPage } from "@/components/landing-page";

export const metadata: Metadata = {
  title: "PostFlow — النشر على السوشيال ميديا للمبيعات",
  description:
    "خطط وانشر وتابع محتواك على السوشيال ميديا من مساحة شغل واحدة للمبيعات.",
  alternates: {
    canonical: "/ar",
    languages: { en: "/", ar: "/ar" },
  },
};

export default function ArabicLandingPage() {
  return <LandingPage locale="ar" />;
}
