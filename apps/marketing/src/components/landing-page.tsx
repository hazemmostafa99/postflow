import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Building2,
  CalendarClock,
  Check,
  ChevronRight,
  CircleCheck,
  Clock3,
  Globe2,
  Layers3,
  Languages,
  MessageCircle,
  MousePointerClick,
  Phone,
  Send,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  UserRound,
  UsersRound,
  Zap,
} from "lucide-react";

const whatsappNumber = (process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? "").replace(/\D/g, "");
const salesAppUrl = (process.env.NEXT_PUBLIC_SALES_APP_URL ?? "http://localhost:3001").replace(/\/$/, "");
const salesSignInHref = `${salesAppUrl}/sign-in`;
const salesSignUpHref = `${salesAppUrl}/sign-up`;

const features = [
  {
    icon: CalendarClock,
    title: "Plan once. Publish everywhere.",
    description:
      "Prepare campaigns ahead of time, schedule each post, and keep your daily outreach moving without tab-hopping.",
  },
  {
    icon: Target,
    title: "Reach the right groups",
    description:
      "Organize Facebook groups and select the exact audiences you want to reach for every campaign.",
  },
  {
    icon: BarChart3,
    title: "Know what is working",
    description:
      "Follow publishing status and engagement from a single view, so the next action is always clear.",
  },
  {
    icon: Phone,
    title: "Turn attention into leads",
    description:
      "Collect and organize contact opportunities discovered through your social selling workflow.",
  },
  {
    icon: UsersRound,
    title: "Built for real sales teams",
    description:
      "Give each rep a focused workspace, while leaders keep visibility across teams and activity.",
  },
  {
    icon: ShieldCheck,
    title: "Stay in control",
    description:
      "Role-based access, clear publishing states, and dedicated company workspaces keep operations organized.",
  },
];

const arabicFeatures = [
  {
    icon: CalendarClock,
    title: "خطّط مرة وانشر في كل مكان",
    description:
      "حضّر حملاتك بدري، وجدول كل بوست، وكمّل شغلك اليومي من غير ما تفضل تتنقل بين صفحات كتير.",
  },
  {
    icon: Target,
    title: "وصل للجروبات الصح",
    description:
      "نظّم جروبات فيسبوك واختار الجمهور المناسب اللي عايز توصل له في كل حملة.",
  },
  {
    icon: BarChart3,
    title: "اعرف إيه اللي بيجيب نتيجة",
    description:
      "تابع حالة النشر والتفاعل من شاشة واحدة، واعرف دايمًا خطوتك الجاية إيه.",
  },
  {
    icon: Phone,
    title: "حوّل التفاعل لعملاء محتملين",
    description:
      "اجمع فرص التواصل ونظّمها جوه مسار البيع بتاعك على السوشيال ميديا.",
  },
  {
    icon: UsersRound,
    title: "مبني لفرق المبيعات الحقيقية",
    description:
      "ادي لكل مندوب مساحة شغل مركزة، وخلي قادة الفرق شايفين النشاط والصورة كاملة.",
  },
  {
    icon: ShieldCheck,
    title: "خليك متحكم",
    description:
      "صلاحيات حسب الدور، وحالة نشر واضحة، ومساحات مخصصة للشركات تخلي الشغل منظم.",
  },
];

const companyFeatures = [
  {
    icon: UsersRound,
    title: "Bring every team into one system",
    description:
      "Organize managers, team leaders, and sales reps without losing visibility across the company.",
  },
  {
    icon: ShieldCheck,
    title: "Give everyone the right access",
    description:
      "Role-based permissions keep company-wide controls with leadership and daily work with each team.",
  },
  {
    icon: BarChart3,
    title: "See the full sales picture",
    description:
      "Follow publishing activity, team performance, and lead generation from one management view.",
  },
  {
    icon: Globe2,
    title: "Own a dedicated workspace",
    description:
      "Your company gets its own iPostFlow subdomain with a setup shaped around the way your teams work.",
  },
  {
    icon: CalendarClock,
    title: "Keep publishing consistent",
    description:
      "Help every team plan, schedule, and track outreach from a repeatable company workflow.",
  },
  {
    icon: Target,
    title: "Turn activity into direction",
    description:
      "Give leaders the information they need to coach teams, improve campaigns, and focus effort.",
  },
];

const arabicCompanyFeatures = [
  {
    icon: UsersRound,
    title: "اجمع كل الفرق في نظام واحد",
    description:
      "نظّم المديرين وقادة الفرق ومندوبي المبيعات، وخليك شايف الشغل في الشركة كلها.",
  },
  {
    icon: ShieldCheck,
    title: "ادي كل شخص الصلاحية المناسبة",
    description:
      "صلاحيات حسب الدور تخلي التحكم مع الإدارة، والشغل اليومي مع كل فريق.",
  },
  {
    icon: BarChart3,
    title: "شوف صورة المبيعات كاملة",
    description:
      "تابع نشاط النشر وأداء الفرق والعملاء المحتملين من شاشة إدارة واحدة.",
  },
  {
    icon: Globe2,
    title: "مساحة شغل مخصوص لشركتك",
    description:
      "شركتك بتاخد نطاق فرعي خاص على iPostFlow، بإعداد يناسب طريقة شغل فرقك.",
  },
  {
    icon: CalendarClock,
    title: "خلي النشر منتظم",
    description:
      "ساعد كل فريق يخطط ويجدول ويتابع التواصل من خلال طريقة شغل ثابتة.",
  },
  {
    icon: Target,
    title: "حوّل النشاط لقرارات أوضح",
    description:
      "ادي القادة المعلومات اللي تساعدهم يوجهوا الفرق ويحسنوا الحملات ويركزوا المجهود.",
  },
];

const platforms = [
  { name: "Facebook", mark: "f", color: "bg-[#1877f2]" },
  { name: "Instagram", mark: "◎", color: "bg-gradient-to-br from-[#833ab4] via-[#fd1d1d] to-[#fcb045]" },
  { name: "TikTok", mark: "♪", color: "bg-[#111]" },
  { name: "WhatsApp", mark: "◔", color: "bg-[#25d366]" },
  { name: "More channels", mark: "+", color: "bg-primary" },
];

const arabicPlatformNames = ["فيسبوك", "إنستغرام", "تيك توك", "واتساب", "منصات تانية"];

function Logo({ inverse = false }: { inverse?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${inverse ? "text-white" : "text-foreground"}`}>
      <span className={`grid h-9 w-9 place-items-center rounded-xl ${inverse ? "bg-white text-[#12352f]" : "bg-primary text-primary-foreground"}`}>
        <Send className="h-4 w-4" />
      </span>
      <span className="text-lg font-bold tracking-[-0.03em]">iPostFlow</span>
    </span>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/15 bg-primary/5 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-primary">
      <Sparkles className="h-3.5 w-3.5" />
      {children}
    </div>
  );
}

export function LandingPage({
  locale,
  audience = "sales",
}: {
  locale: "en" | "ar";
  audience?: "sales" | "company";
}) {
  const isArabic = locale === "ar";
  const isCompany = audience === "company";
  const t = (english: string, arabic: string) => isArabic ? arabic : english;
  const localizedFeatures = isCompany
    ? (isArabic ? arabicCompanyFeatures : companyFeatures)
    : (isArabic ? arabicFeatures : features);
  const localizedPlatforms = platforms.map((platform, index) => ({
    ...platform,
    name: isArabic ? arabicPlatformNames[index] : platform.name,
  }));
  const whatsappMessage = encodeURIComponent(
    t(
      "Hi Tkhayal, I would like to learn more about a iPostFlow company workspace.",
      "أهلًا تخيل، عايز أعرف أكتر عن مساحة iPostFlow المخصصة للشركات.",
    ),
  );
  const whatsappHref = whatsappNumber
    ? `https://wa.me/${whatsappNumber}?text=${whatsappMessage}`
    : "#company";
  const arrowClass = `h-4 w-4 ${isArabic ? "rotate-180" : ""}`;
  const salesHref = isArabic ? "/ar" : "/";
  const companyHref = isArabic ? "/ar/companies" : "/companies";
  const languageHref = isArabic
    ? (isCompany ? "/companies" : "/")
    : (isCompany ? "/ar/companies" : "/ar");
  return (
    <main lang={locale} dir={isArabic ? "rtl" : "ltr"} className={`overflow-hidden bg-[#faf9f4] text-[#17352f] ${isArabic ? "landing-arabic" : ""}`}>
      <header className="absolute inset-x-0 top-0 z-50">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <div className="flex h-20 items-center justify-between gap-4">
            <Logo inverse />
            <nav className="hidden items-center gap-7 text-sm font-medium text-white/70 xl:flex" aria-label={t("Main navigation", "التنقل الرئيسي")}>
              <a className="transition-colors hover:text-white" href="#features">{t("Features", "المميزات")}</a>
              <a className="transition-colors hover:text-white" href="#platforms">{t("Platforms", "المنصات")}</a>
              <a className="transition-colors hover:text-white" href="#pricing">{t("Pricing", "الأسعار")}</a>
            </nav>

            <div className="hidden shrink-0 items-center rounded-2xl border border-white/15 bg-white/8 p-1 shadow-inner shadow-black/10 backdrop-blur-md md:inline-flex">
              <Link
                href={salesHref}
                aria-current={!isCompany ? "page" : undefined}
                className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-bold transition-all ${!isCompany ? "bg-white text-[#17352f] shadow-md shadow-black/15" : "text-white/60 hover:bg-white/7 hover:text-white"}`}
              >
                <UserRound className="h-3.5 w-3.5" /> {t("Sales", "مبيعات")}
              </Link>
              <Link
                href={companyHref}
                aria-current={isCompany ? "page" : undefined}
                className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-bold transition-all ${isCompany ? "bg-white text-[#17352f] shadow-md shadow-black/15" : "text-white/60 hover:bg-white/7 hover:text-white"}`}
              >
                <Building2 className="h-3.5 w-3.5" /> {t("Companies", "شركات")}
              </Link>
            </div>

            <div className="flex items-center gap-2 sm:gap-3">
              <Link
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-2.5 text-xs font-semibold text-white/80 transition-colors hover:bg-white/10 hover:text-white sm:px-3"
                href={languageHref}
                aria-label={isArabic ? "Switch to English" : "التبديل إلى العربية"}
                hrefLang={isArabic ? "en" : "ar"}
              >
                <Languages className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{isArabic ? "English" : "العربية"}</span>
              </Link>
              <Link className="hidden px-2 py-2 text-sm font-semibold text-white/80 transition-colors hover:text-white lg:block" href={salesSignInHref}>
                {t("Sign in", "دخول")}
              </Link>
              {isCompany ? (
                <a className="inline-flex h-10 items-center gap-2 rounded-full bg-white px-3.5 text-xs font-semibold text-[#17352f] shadow-lg shadow-black/10 transition-transform hover:-translate-y-0.5 sm:px-5 sm:text-sm" href={whatsappHref}>
                  {t("Talk to sales", "كلم المبيعات")} <ArrowRight className={arrowClass} />
                </a>
              ) : (
                <Link className="inline-flex h-10 items-center gap-2 rounded-full bg-white px-3.5 text-xs font-semibold text-[#17352f] shadow-lg shadow-black/10 transition-transform hover:-translate-y-0.5 sm:px-5 sm:text-sm" href="#free-trial">
                  {t("Start free", "ابدأ مجانًا")} <ArrowRight className={arrowClass} />
                </Link>
              )}
            </div>
          </div>

          <div className="flex w-full items-center rounded-2xl border border-white/15 bg-white/8 p-1 shadow-inner shadow-black/10 backdrop-blur-md md:hidden">
            <Link
              href={salesHref}
              aria-current={!isCompany ? "page" : undefined}
              className={`inline-flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition-all ${!isCompany ? "bg-white text-[#17352f] shadow-md shadow-black/15" : "text-white/60"}`}
            >
              <UserRound className="h-4 w-4" /> {t("For Sales", "للمبيعات")}
            </Link>
            <Link
              href={companyHref}
              aria-current={isCompany ? "page" : undefined}
              className={`inline-flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition-all ${isCompany ? "bg-white text-[#17352f] shadow-md shadow-black/15" : "text-white/60"}`}
            >
              <Building2 className="h-4 w-4" /> {t("For Companies", "للشركات")}
            </Link>
          </div>
        </div>
      </header>

      <section className="landing-hero relative bg-[#12352f] pb-20 pt-44 text-white sm:pb-28 sm:pt-44 md:pt-40">
        <div className="pointer-events-none absolute -left-32 top-14 h-96 w-96 rounded-full bg-[#78c8a0]/20 blur-3xl" />
        <div className="pointer-events-none absolute -right-24 top-48 h-80 w-80 rounded-full bg-[#e5bd67]/15 blur-3xl" />
        <div className="relative mx-auto grid max-w-7xl items-center gap-14 px-5 sm:px-8 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
          <div className="max-w-2xl">
            <h1 className="text-5xl font-semibold leading-[0.98] tracking-[-0.055em] sm:text-6xl lg:text-[4.75rem]">
              {isCompany
                ? t("One workspace to organize your entire sales operation.", "مساحة شغل واحدة تنظم فريق المبيعات كله.")
                : t("Turn every post into a sales opportunity.", "حوّل كل بوست لفرصة بيع.")}
            </h1>
            <p className="mt-7 max-w-xl text-lg leading-8 text-white/65 sm:text-xl">
              {isCompany
                ? t(
                    "iPostFlow gives every team a clear way to publish, follow activity, and manage leads—while leadership keeps the full company view.",
                    "iPostFlow بيدي كل فريق طريقة واضحة للنشر والمتابعة وإدارة العملاء المحتملين، والإدارة بتفضل شايفة الصورة كاملة.",
                  )
                : t(
                    "iPostFlow brings publishing, tracking, and lead follow-up into one focused workspace—so you spend less time managing posts and more time selling.",
                    "iPostFlow بيجمع النشر والمتابعة وإدارة العملاء المحتملين في مساحة شغل واحدة، عشان متضيعش وقتك في النشر وتركز أكتر في البيع.",
                  )}
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              {isCompany ? (
                <a className="inline-flex h-13 items-center justify-center gap-2 rounded-full bg-[#f4cb73] px-7 text-sm font-bold text-[#17352f] shadow-xl shadow-black/15 transition-all hover:-translate-y-0.5 hover:bg-[#ffda8d]" href={whatsappHref} target={whatsappNumber ? "_blank" : undefined} rel={whatsappNumber ? "noreferrer" : undefined}>
                  <MessageCircle className="h-4 w-4" /> {t("Talk to us on WhatsApp", "كلمنا على واتساب")}
                </a>
              ) : (
                <Link className="inline-flex h-13 items-center justify-center gap-2 rounded-full bg-[#f4cb73] px-7 text-sm font-bold text-[#17352f] shadow-xl shadow-black/15 transition-all hover:-translate-y-0.5 hover:bg-[#ffda8d]" href="#free-trial">
                  {t("Start your free trial", "ابدأ تجربتك المجانية")} <ArrowRight className={arrowClass} />
                </Link>
              )}
              <a className="inline-flex h-13 items-center justify-center gap-2 rounded-full border border-white/18 bg-white/7 px-7 text-sm font-semibold text-white transition-colors hover:bg-white/12" href="#how-it-works">
                {t("See how it works", "شوف بيشتغل إزاي")} <ChevronRight className={arrowClass} />
              </a>
            </div>
            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-3 text-sm text-white/55">
              {(isCompany
                ? (isArabic ? ["نطاق فرعي مخصوص", "صلاحيات للفرق", "تجهيز خطوة بخطوة"] : ["Dedicated subdomain", "Team permissions", "Guided setup"])
                : (isArabic ? ["تجربة مجانية لمدة شهر", "مفيش حدود للنشر دلوقتي", "معمول مخصوص للمبيعات"] : ["One month free trial", "No posting limits for now", "Built for sales"])
              ).map((item) => <span key={item} className="flex items-center gap-2"><CircleCheck className="h-4 w-4 text-[#74d49d]" /> {item}</span>)}
            </div>
          </div>

          <div className="relative lg:pl-4">
            <div className="absolute -inset-6 rotate-2 rounded-[2.5rem] border border-white/10 bg-white/5" />
            <div className="relative overflow-hidden rounded-[1.75rem] border border-white/15 bg-[#f7f5ee] p-2 shadow-2xl shadow-black/35">
              <div className="overflow-hidden rounded-[1.35rem] border border-black/5 bg-[#f3f1e9]">
                <div className="flex h-12 items-center justify-between border-b border-[#17352f]/10 bg-white px-4">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-[#ff8c7b]" />
                    <span className="h-2.5 w-2.5 rounded-full bg-[#f4cb73]" />
                    <span className="h-2.5 w-2.5 rounded-full bg-[#74d49d]" />
                  </div>
                  <div className="rounded-full bg-[#eef2ed] px-4 py-1.5 text-[10px] font-semibold text-[#667b75]">sales.ipostflow.com</div>
                  <div className="h-7 w-7 rounded-full bg-[#dbe9df]" />
                </div>
                <div className="grid min-h-[430px] grid-cols-[64px_1fr] sm:grid-cols-[150px_1fr]">
                  <aside className="bg-[#173c35] p-3 text-white">
                    <div className="mb-8 flex items-center gap-2 px-1 text-xs font-bold"><Send className="h-4 w-4 text-[#86d9aa]" /><span className="hidden sm:inline">iPostFlow</span></div>
                    <div className="space-y-2">
                      {[Layers3, Send, BarChart3, Phone].map((Icon, index) => (
                        <div key={index} className={`flex items-center gap-2 rounded-lg p-2 text-[10px] ${index === 0 ? "bg-white/12 text-white" : "text-white/45"}`}>
                          <Icon className="h-3.5 w-3.5" /><span className="hidden sm:inline">{(
                            isCompany
                              ? (isArabic ? ["الرئيسية", "الفرق", "المستخدمين", "التقارير"] : ["Overview", "Teams", "Users", "Reports"])
                              : (isArabic ? ["الرئيسية", "البوستات", "التقارير", "العملاء"] : ["Overview", "Posts", "Reports", "Leads"])
                          )[index]}</span>
                        </div>
                      ))}
                    </div>
                  </aside>
                  <div className="p-4 sm:p-5">
                    <div className="flex items-center justify-between">
                      <div><p className="text-[10px] font-medium text-[#789089]">{isCompany ? t("COMPANY WORKSPACE", "مساحة الشركة") : t("GOOD MORNING, SARAH", "صباح الخير يا سارة")}</p><p className="mt-1 text-lg font-bold tracking-tight text-[#17352f]">{isCompany ? t("Company overview", "ملخص الشركة") : t("Your sales overview", "ملخص مبيعاتك")}</p></div>
                      <div className="rounded-lg bg-[#1f6b5c] px-3 py-2 text-[9px] font-bold text-white">{isCompany ? t("+ Add team", "+ فريق جديد") : t("+ Create post", "+ بوست جديد")}</div>
                    </div>
                    <div className="mt-5 grid grid-cols-3 gap-2">
                      {[
                        ...(isCompany ? [
                          [t("Sales reps", "مندوبين المبيعات"), "48", UsersRound],
                          [t("Active teams", "فرق نشطة"), "6", Layers3],
                          [t("Campaigns", "حملات"), "24", TrendingUp],
                        ] : [
                          [t("Posts sent", "بوستات اتنشرت"), "248", TrendingUp],
                          [t("Active groups", "جروبات نشطة"), "36", UsersRound],
                          [t("New leads", "عملاء جدد"), "18", Phone],
                        ]),
                      ].map(([label, value, Icon]) => {
                        const StatIcon = Icon as typeof TrendingUp;
                        return <div key={label as string} className="rounded-xl border border-[#17352f]/8 bg-white p-3 shadow-sm"><StatIcon className="h-3.5 w-3.5 text-[#2d806e]" /><p className="mt-3 text-lg font-bold text-[#17352f]">{value as string}</p><p className="text-[8px] text-[#789089] sm:text-[9px]">{label as string}</p></div>;
                      })}
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-[1.4fr_0.8fr]">
                      <div className="rounded-xl border border-[#17352f]/8 bg-white p-4 shadow-sm">
                        <div className="flex items-center justify-between"><p className="text-xs font-bold text-[#17352f]">{isCompany ? t("Team activity", "نشاط الفرق") : t("Publishing activity", "حركة النشر")}</p><span className="text-[8px] text-[#789089]">{t("Last 7 days", "آخر 7 أيام")}</span></div>
                        <div className="mt-5 flex h-24 items-end gap-2">
                          {[42, 67, 48, 82, 58, 93, 74].map((height, index) => <span key={index} className="flex-1 rounded-t bg-[#62b58e]" style={{ height: `${height}%`, opacity: 0.48 + index * 0.07 }} />)}
                        </div>
                        <div className="mt-2 flex justify-between text-[7px] text-[#91a29d]">{(isArabic ? ["اثن", "ثلا", "أرب", "خمي", "جمع", "سبت", "أحد"] : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]).map((day) => <span key={day}>{day}</span>)}</div>
                      </div>
                      <div className="rounded-xl bg-[#e9dfc5] p-4">
                        <p className="text-[9px] font-semibold text-[#6f6a58]">{isCompany ? t("TOP TEAM", "أفضل فريق") : t("NEXT POST", "البوست الجاي")}</p>
                        <div className="mt-4 grid h-9 w-9 place-items-center rounded-full bg-white text-[#1f6b5c]"><Clock3 className="h-4 w-4" /></div>
                        <p className="mt-4 text-sm font-bold text-[#17352f]">{isCompany ? t("North sales", "فريق مبيعات الشمال") : t("Today, 4:30 PM", "النهارده، 4:30 مساءً")}</p>
                        <p className="mt-1 text-[9px] leading-4 text-[#6f6a58]">{isCompany ? t("94% weekly activity", "نشاط أسبوعي 94٪") : t("Scheduled for 12 Facebook groups", "متجدول لـ 12 جروب فيسبوك")}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="absolute -bottom-6 -left-4 hidden items-center gap-3 rounded-2xl border border-white/50 bg-white p-3.5 text-[#17352f] shadow-xl sm:flex">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#dff2e5] text-[#27745f]"><CircleCheck className="h-5 w-5" /></span>
              <div><p className="text-xs font-bold">{isCompany ? t("Teams on track", "الفرق ماشية كويس") : t("Post published", "البوست اتنشر")}</p><p className="mt-0.5 text-[10px] text-[#789089]">{isCompany ? t("6 active teams this week", "6 فرق نشطة الأسبوع ده") : t("12 of 12 groups reached", "وصل لـ 12 من 12 جروب")}</p></div>
            </div>
          </div>
        </div>
      </section>

      <section id="platforms" className="border-b border-[#17352f]/8 bg-white py-8">
        <div className="mx-auto flex max-w-7xl flex-col items-center gap-5 px-5 sm:px-8 lg:flex-row lg:justify-between">
          <p className="text-center text-sm font-semibold text-[#60766f] lg:text-start">{isCompany ? t("One workspace for every channel your teams sell through", "مساحة شغل واحدة لكل منصة فرقك بتبيع من خلالها") : t("One workspace for every channel you sell through", "مساحة شغل واحدة لكل منصة بتبيع من خلالها")}</p>
          <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-5">
            {localizedPlatforms.map((platform) => (
              <div key={platform.name} className="flex items-center gap-2.5 rounded-full border border-[#17352f]/8 bg-[#faf9f4] px-3 py-2">
                <span className={`grid h-7 w-7 place-items-center rounded-full text-sm font-black text-white ${platform.color}`}>{platform.mark}</span>
                <span className="text-xs font-bold text-[#29473f]">{platform.name}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="features" className="py-24 sm:py-32">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <div className="max-w-2xl">
            <SectionLabel>{isCompany ? t("Built for your organization", "معمول لشركتك") : t("Everything in one flow", "كل حاجة في مسار شغل واحد")}</SectionLabel>
            <h2 className="text-4xl font-semibold leading-tight tracking-[-0.045em] sm:text-5xl">{isCompany ? t("Give every sales team structure without slowing them down.", "نظّم كل فرق المبيعات من غير ما تعطّل شغلهم.") : t("Social selling should feel organized, not overwhelming.", "البيع على السوشيال ميديا المفروض يبقى منظم، مش مُرهق.")}</h2>
            <p className="mt-5 text-lg leading-8 text-[#657a74]">{isCompany ? t("iPostFlow connects people, publishing, leads, and reporting in one company workspace—so leaders see more and teams move faster.", "iPostFlow بيجمع الأشخاص والنشر والعملاء والتقارير في مساحة واحدة للشركة، عشان الإدارة تشوف أكتر والفرق تتحرك أسرع.") : t("iPostFlow keeps the work between an idea and a new lead moving—with fewer tools, fewer missed steps, and a much clearer view.", "iPostFlow بيخلّي الشغل ماشي من الفكرة للعميل المحتمل، بأدوات أقل وخطوات ضايعة أقل وصورة أوضح بكتير.")}</p>
          </div>
          <div className="mt-14 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {localizedFeatures.map(({ icon: Icon, title, description }, index) => (
              <article key={title} className={`group rounded-[1.5rem] border border-[#17352f]/8 p-6 transition-all hover:-translate-y-1 hover:shadow-xl hover:shadow-[#17352f]/5 sm:p-7 ${index === 0 ? "bg-[#173c35] text-white" : "bg-white"}`}>
                <div className={`grid h-11 w-11 place-items-center rounded-xl ${index === 0 ? "bg-[#76ca9a] text-[#17352f]" : "bg-[#e7f2e9] text-[#26705d]"}`}><Icon className="h-5 w-5" /></div>
                <h3 className="mt-8 text-xl font-bold tracking-[-0.025em]">{title}</h3>
                <p className={`mt-3 text-sm leading-6 ${index === 0 ? "text-white/60" : "text-[#6a7d77]"}`}>{description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="how-it-works" className="bg-[#eaf0e9] py-24 sm:py-32">
        <div className="mx-auto grid max-w-7xl gap-14 px-5 sm:px-8 lg:grid-cols-[0.85fr_1.15fr] lg:items-center">
          <div>
            <SectionLabel>{isCompany ? t("A clearer operating model", "طريقة شغل أوضح") : t("A simpler daily routine", "روتينك اليومي أبسط")}</SectionLabel>
            <h2 className="text-4xl font-semibold leading-tight tracking-[-0.045em] sm:text-5xl">{isCompany ? t("Set up the company once. Give every team a better flow.", "جهّز الشركة مرة، وادي كل فريق طريقة شغل أحسن.") : t("From content idea to follow-up, without losing the thread.", "من فكرة المحتوى للمتابعة، من غير ما حاجة تقع منك.")}</h2>
            <p className="mt-5 text-lg leading-8 text-[#657a74]">{isCompany ? t("A structured workspace for leadership visibility, team accountability, and consistent social selling across the company.", "مساحة منظمة تخلي الإدارة شايفة، وكل فريق مسؤول عن شغله، والبيع على السوشيال ماشي بنفس النظام في الشركة.") : t("A calm workflow for salespeople who need consistent visibility without spending the whole day managing social media.", "طريقة شغل هادية لمندوبي المبيعات اللي محتاجين يفضلوا ظاهرين، من غير ما يقضوا اليوم كله في إدارة السوشيال ميديا.")}</p>
            {isCompany ? (
              <a className="mt-8 inline-flex items-center gap-2 text-sm font-bold text-[#1f6b5c] hover:gap-3" href={whatsappHref}>{t("Plan your company workspace", "خطط مساحة شركتك")} <ArrowRight className={arrowClass} /></a>
            ) : (
              <Link className="mt-8 inline-flex items-center gap-2 text-sm font-bold text-[#1f6b5c] hover:gap-3" href="#free-trial">{t("Build your first campaign", "اعمل أول حملة ليك")} <ArrowRight className={arrowClass} /></Link>
            )}
          </div>
          <div className="space-y-3">
            {[
              ...(isCompany ? [
                ["01", t("Set up teams and roles", "جهّز الفرق والصلاحيات"), t("Create the company structure and give every person the access they need.", "اعمل هيكل الشركة وادي كل شخص الصلاحية اللي محتاجها."), UsersRound],
                ["02", t("Run one shared workflow", "اشتغلوا بنفس النظام"), t("Give every team a consistent way to publish, track activity, and manage leads.", "ادي كل فريق طريقة ثابتة للنشر والمتابعة وإدارة العملاء."), Layers3],
                ["03", t("See and improve performance", "تابع الأداء وحسّنه"), t("Review company and team activity, then focus support where it creates the most impact.", "راجع نشاط الشركة والفرق، ووجّه الدعم للمكان اللي هيعمل أكبر فرق."), TrendingUp],
              ] : [
                ["01", t("Create your message", "جهّز رسالتك"), t("Write once, add media, and prepare the content you want your audience to see.", "اكتب مرة واحدة، ضيف الصور أو الفيديو، وجهّز المحتوى اللي عايز جمهورك يشوفه."), MousePointerClick],
                ["02", t("Choose where it goes", "اختار هينزل فين"), t("Select your synced Facebook groups and schedule the best time to publish.", "اختار جروبات فيسبوك اللي ربطتها وحدد أنسب وقت للنشر."), Target],
                ["03", t("Track and follow up", "تابع وكمل البيع"), t("Watch delivery, review engagement, and keep new contact opportunities organized.", "راقب النشر والتفاعل، وخلي فرص التواصل الجديدة مترتبة قدامك."), TrendingUp],
              ]),
            ].map(([number, title, description, Icon]) => {
              const StepIcon = Icon as typeof MousePointerClick;
              return (
                <article key={number as string} className="grid grid-cols-[44px_1fr_auto] items-start gap-4 rounded-2xl border border-[#17352f]/8 bg-white p-5 shadow-sm sm:grid-cols-[56px_1fr_auto] sm:p-6">
                  <span className="text-sm font-black text-[#9aab9f]">{number as string}</span>
                  <div><h3 className="text-lg font-bold tracking-tight">{title as string}</h3><p className="mt-2 text-sm leading-6 text-[#6a7d77]">{description as string}</p></div>
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#e7f2e9] text-[#26705d]"><StepIcon className="h-5 w-5" /></span>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="py-24 sm:py-32">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <SectionLabel>{t("Built to grow with you", "بيكبر معاك")}</SectionLabel>
            <h2 className="text-4xl font-semibold tracking-[-0.045em] sm:text-5xl">{t("Start with Facebook. Bring every social channel into one workflow.", "ابدأ بفيسبوك، واجمع كل شغلك على السوشيال في مكان واحد.")}</h2>
            <p className="mt-5 text-lg leading-8 text-[#657a74]">{t("We are starting with a focused Facebook experience. Instagram, TikTok, WhatsApp, and more channels are next.", "بنبدأ بتجربة مركزة على فيسبوك، وبعدها هنوسّع الشغل لإنستغرام وتيك توك وواتساب ومنصات تانية.")}</p>
          </div>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {localizedPlatforms.map((platform) => (
              <article key={platform.name} className="relative overflow-hidden rounded-2xl border border-[#17352f]/8 bg-white p-5">
                <div className={`grid h-11 w-11 place-items-center rounded-xl text-lg font-black text-white ${platform.color}`}>{platform.mark}</div>
                <p className="mt-8 font-bold">{platform.name}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="pricing" className="bg-[#12352f] py-24 text-white sm:py-32">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/8 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-[#8cdbad]"><Zap className="h-3.5 w-3.5" /> {isCompany ? t("Company setup", "تجهيز الشركات") : t("Simple plans", "خطط بسيطة وواضحة")}</div>
            <h2 className="text-4xl font-semibold tracking-[-0.045em] sm:text-5xl">{isCompany ? t("A company workspace shaped around your operation.", "مساحة للشركة متظبطة على طريقة شغلك.") : t("Plans for independent sellers and growing teams.", "خطط تناسبك، سواء بتبيع لوحدك أو مع فريق.")}</h2>
            <p className="mt-5 text-lg leading-8 text-white/55">{isCompany ? t("Your own subdomain, team structure, role-based access, and guided setup—planned with our team.", "نطاق فرعي مخصوص، وتنظيم للفرق، وصلاحيات حسب الدور، وتجهيز مع فريقنا خطوة بخطوة.") : t("A self-service plan for individual salespeople, with the flexibility to choose monthly or yearly billing.", "خطة سهلة لمندوبي المبيعات، مع حرية الاختيار بين الدفع الشهري أو السنوي.")}</p>
          </div>
          <div className="mx-auto mt-14 grid max-w-xl gap-5">
            {!isCompany && (
            <article id="free-trial" className="relative scroll-mt-8 rounded-[1.75rem] bg-white p-7 text-[#17352f] shadow-2xl shadow-black/20 sm:p-9">
              <span className="absolute end-6 top-6 rounded-full bg-[#e6f4e9] px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[#276c59]">{t("For individuals", "للأفراد")}</span>
              <p className="text-sm font-bold text-[#2d806e]">{t("SALES", "المبيعات")}</p>
              <div className="mt-5 flex items-end gap-2"><span className="text-5xl font-semibold tracking-[-0.06em]">{t("One month free", "شهر مجانًا")}</span></div>
              <p className="mt-3 text-sm leading-6 text-[#71837d]">{t("Try every Sales feature free for one full month. Choose monthly or yearly billing when your trial ends.", "جرّب كل مميزات المبيعات مجانًا لمدة شهر كامل، وبعدها اختار الدفع الشهري أو السنوي.")}</p>
              <div className="my-7 h-px bg-[#17352f]/8" />
              <ul className="space-y-3 text-sm">
                {(isArabic ? ["دخول كامل لكل المميزات لمدة شهر", "نشر في جروبات فيسبوك", "جدولة ومتابعة حالة النشر", "مساحة للعملاء وجهات الاتصال", "تقارير للتفاعل"] : ["Full access to every feature for one month", "Facebook group publishing", "Scheduling and status tracking", "Lead and contact workspace", "Engagement reporting"]).map((item) => <li key={item} className="flex items-center gap-3"><span className="grid h-5 w-5 place-items-center rounded-full bg-[#e4f2e7] text-[#26705d]"><Check className="h-3 w-3" /></span>{item}</li>)}
              </ul>
              <Link className="mt-8 inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[#1f6b5c] text-sm font-bold text-white transition-colors hover:bg-[#18584c]" href={salesSignUpHref}>{t("Create your free account", "اعمل حسابك المجاني")} <ArrowRight className={arrowClass} /></Link>
            </article>
            )}
            {isCompany && (
            <article id="company" className="rounded-[1.75rem] border border-white/12 bg-white/7 p-7 backdrop-blur sm:p-9">
              <span className="inline-flex rounded-full bg-[#f4cb73]/15 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[#f4cb73]">{t("For teams", "للفرق")}</span>
              <p className="mt-5 text-sm font-bold text-[#8cdbad]">{t("COMPANY WORKSPACE", "مساحة شغل للشركة")}</p>
              <h3 className="mt-5 text-4xl font-semibold tracking-[-0.045em]">{t("Your own subdomain.", "نطاق فرعي مخصوص لشركتك.")}</h3>
              <p className="mt-4 text-sm leading-6 text-white/55">{t("Give your organization a dedicated", "خلي لشركتك مساحة شغل مخصصة على")} <span dir="ltr" className="inline-block font-semibold text-white">company.ipostflow.com</span> {t("workspace with structured access and guided setup.", "بصلاحيات منظمة وتجهيز خطوة بخطوة.")}</p>
              <div className="my-7 h-px bg-white/10" />
              <ul className="space-y-3 text-sm text-white/80">
                {(isArabic ? ["نطاق فرعي مخصوص للشركة", "صلاحيات للأدمن والمدير وقائد الفريق والمبيعات", "رؤية واضحة لكل فريق", "تجهيز ودعم من مكان واحد", "إعداد على حسب طريقة شغلك"] : ["Dedicated company subdomain", "Admin, manager, leader, and sales roles", "Team-level visibility", "Centralized onboarding and support", "A setup shaped around your workflow"]).map((item) => <li key={item} className="flex items-center gap-3"><span className="grid h-5 w-5 place-items-center rounded-full bg-white/10 text-[#8cdbad]"><Check className="h-3 w-3" /></span>{item}</li>)}
              </ul>
              <a className="mt-8 inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[#f4cb73] text-sm font-bold text-[#17352f] transition-colors hover:bg-[#ffda8d]" href={whatsappHref} target={whatsappNumber ? "_blank" : undefined} rel={whatsappNumber ? "noreferrer" : undefined}><MessageCircle className="h-4 w-4" /> {t("Talk to us on WhatsApp", "كلمنا على واتساب")}</a>
            </article>
            )}
          </div>
        </div>
      </section>

      <section className="py-24 sm:py-32">
        <div className="mx-auto grid max-w-7xl gap-12 px-5 sm:px-8 lg:grid-cols-[0.75fr_1.25fr]">
          <div>
            <SectionLabel>{t("Questions, answered", "أسئلة وإجابات")}</SectionLabel>
            <h2 className="text-4xl font-semibold tracking-[-0.045em] sm:text-5xl">{t("Before you start.", "قبل ما تبدأ.")}</h2>
            <p className="mt-5 text-[#657a74]">{t("Everything you need to know about the first version of iPostFlow.", "كل اللي محتاج تعرفه عن أول نسخة من iPostFlow.")}</p>
          </div>
          <div className="divide-y divide-[#17352f]/10 border-y border-[#17352f]/10">
            {[
              ...(isCompany ? [
                [t("What does a company workspace include?", "مساحة الشركة فيها إيه؟"), t("A dedicated iPostFlow subdomain, team structure, role-based access, company visibility, and guided setup with our team.", "نطاق فرعي مخصوص على iPostFlow، وتنظيم للفرق، وصلاحيات حسب الدور، ورؤية للشركة كلها، وتجهيز مع فريقنا.")],
                [t("Can we organize multiple sales teams?", "ينفع ننظم أكتر من فريق مبيعات؟"), t("Yes. You can structure managers, team leaders, and sales reps while keeping each team clearly organized.", "آه. تقدر تنظم المديرين وقادة الفرق ومندوبي المبيعات، وكل فريق يفضل واضح ومرتب.")],
                [t("How is company pricing decided?", "سعر الشركات بيتحدد إزاي؟"), t("We plan the workspace around your team size and setup needs, then confirm the commercial details directly with you.", "بنفهم عدد الفرق والمستخدمين واحتياجات التجهيز، وبعدها بنتفق معاك على التفاصيل المناسبة.")],
                [t("How do we get started?", "نبدأ إزاي؟"), t("Contact us on WhatsApp. We will understand your workflow, plan the subdomain, and guide your onboarding.", "كلمنا على واتساب. هنفهم طريقة شغلك، ونخطط النطاق الفرعي، ونجهز شركتك خطوة بخطوة.")],
              ] : [
                [t("Which platforms does iPostFlow focus on?", "iPostFlow بيركز على أنهي منصات؟"), t("iPostFlow currently focuses on Facebook publishing, with Instagram, TikTok, WhatsApp, and other channels included in the broader product direction.", "iPostFlow بيركز دلوقتي على النشر في فيسبوك، وإنستغرام وتيك توك وواتساب ومنصات تانية ضمن خطة تطوير المنتج.")],
                [t("Who is iPostFlow for?", "iPostFlow معمول لمين؟"), t("iPostFlow is designed for salespeople and teams that use social media to create visibility, start conversations, and generate new business.", "iPostFlow معمول لمندوبي وفرق المبيعات اللي بيستخدموا السوشيال ميديا عشان يظهروا أكتر، ويبدأوا محادثات، ويجيبوا فرص شغل جديدة.")],
                [t("Is there a free trial?", "في تجربة مجانية؟"), t("Yes. Individual sales users get full access free for one month, then choose monthly or yearly billing.", "آه. مندوب المبيعات بياخد كل المميزات مجانًا لمدة شهر كامل، وبعدها يختار الدفع الشهري أو السنوي.")],
                [t("Can I move to a company workspace later?", "ينفع أنقل لمساحة شركة بعدين؟"), t("Yes. When you need teams, roles, and a dedicated subdomain, contact us to plan the company setup.", "آه. لما تحتاج فرق وصلاحيات ونطاق فرعي مخصوص، كلمنا عشان نجهز مساحة الشركة.")],
              ]),
            ].map(([question, answer]) => (
              <details key={question} className="group py-5 first:pt-0 last:pb-0">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-5 text-base font-bold"><span>{question}</span><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#e7f2e9] text-[#26705d] transition-transform group-open:rotate-45">+</span></summary>
                <p className="max-w-2xl pb-2 pt-3 text-sm leading-6 text-[#6a7d77]">{answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="px-5 pb-5 sm:px-8 sm:pb-8">
        <div className="relative mx-auto max-w-7xl overflow-hidden rounded-[2rem] bg-[#dceadf] px-6 py-16 text-center sm:px-10 sm:py-20">
          <div className="absolute -left-20 -top-20 h-56 w-56 rounded-full border-[40px] border-white/25" />
          <div className="absolute -bottom-24 -right-16 h-64 w-64 rounded-full border-[48px] border-[#2d806e]/10" />
          <div className="relative mx-auto max-w-2xl">
            <h2 className="text-4xl font-semibold tracking-[-0.05em] sm:text-5xl">{isCompany ? t("Ready to give every sales team a better system?", "جاهز تدي كل فرق المبيعات نظام أحسن؟") : t("Ready to put your social selling in motion?", "جاهز تحرّك مبيعاتك على السوشيال ميديا؟")}</h2>
            <p className="mx-auto mt-5 max-w-xl text-lg leading-8 text-[#60766f]">{isCompany ? t("Tell us how your company works, and we will help shape a dedicated iPostFlow workspace around it.", "قولنا شركتك بتشتغل إزاي، وإحنا نساعدك نجهز مساحة iPostFlow مخصوص ليها.") : t("Create your iPostFlow workspace and turn a scattered routine into one clear, repeatable flow.", "اعمل مساحة شغلك على iPostFlow وحوّل روتينك المشتت لمسار واضح تقدر تكرره كل يوم.")}</p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              {isCompany ? (
                <a className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-[#173c35] px-7 text-sm font-bold text-white hover:bg-[#102d28]" href={whatsappHref}><MessageCircle className="h-4 w-4" /> {t("Talk to us on WhatsApp", "كلمنا على واتساب")}</a>
              ) : (
                <>
                  <Link className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-[#173c35] px-7 text-sm font-bold text-white hover:bg-[#102d28]" href="#free-trial">{t("Start your free trial", "ابدأ تجربتك المجانية")} <ArrowRight className={arrowClass} /></Link>
                  <Link className="inline-flex h-12 items-center justify-center gap-2 rounded-full border border-[#17352f]/15 bg-white/70 px-7 text-sm font-bold text-[#17352f] hover:bg-white" href={companyHref}><UsersRound className="h-4 w-4" /> {t("For companies", "للشركات")}</Link>
                </>
              )}
            </div>
          </div>
        </div>
      </section>

      <footer className="bg-[#faf9f4] px-5 py-10 sm:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 border-t border-[#17352f]/10 pt-8 sm:flex-row sm:items-center sm:justify-between">
          <div><Logo /><p className="mt-3 text-xs text-[#7a8b86]">{t("A Tkhayal product.", "منتج من تخيل.")}</p></div>
          <div className="flex flex-wrap gap-x-6 gap-y-3 text-sm font-medium text-[#60766f]"><a href="#features">{t("Features", "المميزات")}</a><a href="#pricing">{t("Pricing", "الأسعار")}</a><Link href={companyHref}>{t("Companies", "الشركات")}</Link><Link href={salesSignInHref}>{t("Sign in", "دخول")}</Link><Link href={languageHref} hrefLang={isArabic ? "en" : "ar"}>{isArabic ? "English" : "العربية"}</Link></div>
          <p className="text-xs text-[#8b9894]">© {new Date().getFullYear()} {t("Tkhayal. All rights reserved.", "تخيل. جميع الحقوق محفوظة.")}</p>
        </div>
      </footer>
    </main>
  );
}
