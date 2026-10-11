import type { Metadata } from "next";
import { LandingPage } from "@/components/landing-page";

export const metadata: Metadata = {
  title: "PostFlow للشركات — نظّم شغل فريق المبيعات",
  description:
    "ادي شركتك مساحة شغل مخصصة على PostFlow لتنظيم الفرق والصلاحيات والنشر والمتابعة.",
  alternates: {
    canonical: "/ar/companies",
    languages: { en: "/companies", ar: "/ar/companies" },
  },
};

export default function ArabicCompaniesLandingPage() {
  return <LandingPage locale="ar" audience="company" />;
}
