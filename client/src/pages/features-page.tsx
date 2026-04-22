import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Mail, Send, Users, BarChart3, Shield, CheckCircle, ArrowRight,
  Clock, MousePointerClick, Sparkles, Target, Eye, Inbox, Brain,
  Flame, Thermometer, Database, ClipboardList, MessageSquare,
  FileText, Star, RefreshCw, Globe, Activity, Key, Zap
} from "lucide-react";
import { FaGoogle, FaMicrosoft } from "react-icons/fa";

interface FeaturesPageProps {
  onGoogleLogin: () => void;
  onMicrosoftLogin: () => void;
}

export default function FeaturesPage({ onGoogleLogin, onMicrosoftLogin }: FeaturesPageProps) {
  const categories = [
    {
      name: 'Sending & Campaigns',
      accent: 'from-blue-500 to-indigo-600',
      items: [
        { icon: Send, title: 'Multi-step Campaigns', desc: 'Launch sequences with per-step delays, throttling, and per-account daily send limits. Pause/resume anytime.' },
        { icon: Mail, title: 'Personalized Mail Merge', desc: 'Dynamic merge tags like {{firstName}}, {{company}}, {{customField}} — with fallbacks and AI-assisted variables.' },
        { icon: Clock, title: 'Sending Windows & Timezones', desc: 'Emails respect each recipient\'s local business hours. Automatically defer outside window; resume on open.' },
        { icon: RefreshCw, title: 'Automated Follow-ups', desc: 'Multi-step follow-up sequences that thread on Gmail/Outlook, stop on reply, and recover after server restarts.' },
        { icon: Shield, title: 'Bounce Surge Auto-Pause', desc: 'If bounces spike past a safe threshold, the campaign auto-pauses before you torch your sender reputation.' },
      ],
    },
    {
      name: 'Inbox & Replies',
      accent: 'from-emerald-500 to-teal-600',
      items: [
        { icon: Inbox, title: 'Unified Inbox', desc: 'Every reply across all connected accounts, in one searchable thread view with forward, log, and quick-reply actions.' },
        { icon: Brain, title: 'Reply Classifier', desc: '30+ hardened patterns + AI fallback tag replies as positive, negative, OOO, auto-reply, bounce, or general.' },
        { icon: Star, title: 'Reply-Quality Score', desc: 'Azure OpenAI scores every human reply as hot / warm / cold so reps focus on what matters.' },
        { icon: MessageSquare, title: 'Smart Draft Replies', desc: 'AI drafts responses grounded in your knowledge base — past wins, pricing, product docs — not generic fluff.' },
        { icon: Flame, title: 'Hot-Lead Nudges', desc: '"Suggested Won" and "Suggested Meeting" signals detected from new replies so nothing ages out.' },
      ],
    },
    {
      name: 'AI Lead Intelligence',
      accent: 'from-purple-500 to-pink-600',
      items: [
        { icon: Brain, title: 'Deep Inbox Scan', desc: 'Reads 6–12 months of email history from linked Gmail/Outlook accounts into a local knowledge store.' },
        { icon: Target, title: 'Lead Buckets', desc: 'Classifies contacts into 11 buckets: past_customer, hot_lead, warm_lead, engaged, cold, never_contacted, and more.' },
        { icon: FileText, title: 'AI-Written Proposals', desc: 'Context Engine assembles org docs + contact history and drafts proposals in your voice.' },
        { icon: Sparkles, title: 'Custom AI Prompts', desc: 'Admins can edit the classifier prompt per org to match their segmentation.' },
        { icon: Star, title: 'Contact Rating (A–F)', desc: 'Every contact scored from opens, clicks, reply quality, and recency. Bulk rescore on demand.' },
      ],
    },
    {
      name: 'Prospecting & Data',
      accent: 'from-amber-500 to-orange-600',
      items: [
        { icon: Database, title: 'Apollo Search & Import', desc: 'Search Apollo by title, industry, location, company; preview dedup against your existing contacts; import with saved-first credit savings.' },
        { icon: RefreshCw, title: 'Apollo List Sync', desc: 'Sync entire saved Apollo labels as aimailpilot lists. Batches + auto-resume on Apollo rate limits.' },
        { icon: Users, title: 'Contacts CRM', desc: 'Tags, custom fields, lists, assignees, bulk actions, notes, and activity timeline per contact.' },
        { icon: Globe, title: 'CSV / Google Sheets / Excel', desc: 'Smart-mapped imports with preview, dedup, and column auto-detection.' },
        { icon: Key, title: 'Suppression List', desc: 'Sender-safe guard prevents your own connected accounts from ever getting suppressed. One source of truth for blocks.' },
      ],
    },
    {
      name: 'Deliverability & Warmup',
      accent: 'from-rose-500 to-red-600',
      items: [
        { icon: Thermometer, title: 'Inbox Warmup Engine', desc: 'Connected accounts warm each other via scheduled sends with opens, stars, marks important, and auto-replies.' },
        { icon: Shield, title: 'SMTP Rotation', desc: 'Multiple senders per campaign with automatic rotation to stay under provider-side rate limits.' },
        { icon: Activity, title: 'Per-Account Daily Limits', desc: 'Atomic reservation of daily quota so concurrent campaigns never double-dip or exceed your limit.' },
        { icon: CheckCircle, title: 'Gmail & Outlook Threading', desc: 'Follow-ups land in the same thread via stored threadId — not a fragile re-fetch that breaks on token expiry.' },
        { icon: Zap, title: 'Auto-Recovery on Restart', desc: 'Active campaigns, rate-limited Apollo jobs, and in-flight follow-ups all resume cleanly after server restart.' },
      ],
    },
    {
      name: 'Analytics & Team',
      accent: 'from-cyan-500 to-sky-600',
      items: [
        { icon: BarChart3, title: 'Real-time Analytics', desc: 'Opens, clicks, replies, bounces, reply-quality breakdown — per campaign, per account, per member.' },
        { icon: MousePointerClick, title: 'Open & Click Tracking', desc: 'Every open and link click tracked — including on Steps 2, 3, 4 of follow-up sequences.' },
        { icon: ClipboardList, title: 'Team Scorecard', desc: 'Per-member emails sent, hot leads, not-replied (3-day aged), activities logged. Admins see the whole org.' },
        { icon: Target, title: 'Daily Task Queue', desc: 'Each rep gets a daily list of hot replies, overdue follow-ups, and stale leads with targets for calls/meetings/WhatsApp.' },
        { icon: Eye, title: 'Drill-Down Reports', desc: 'Click any scorecard number to see the exact contacts, messages, or replies behind it.' },
      ],
    },
    {
      name: 'Platform & Security',
      accent: 'from-gray-600 to-gray-800',
      items: [
        { icon: Users, title: 'Multi-Tenant Orgs', desc: 'Owner / admin / member / viewer roles. Member scope: own accounts only. Admin: org-wide.' },
        { icon: Key, title: 'OAuth First', desc: 'Google and Microsoft OAuth for both sign-in and sender accounts. Tokens auto-refresh; 401s retry before falling through.' },
        { icon: Shield, title: 'PostgreSQL + Guardrails', desc: 'Production runs on Azure PostgreSQL with runtime guardrails that block destructive file operations.' },
        { icon: RefreshCw, title: 'Schema Safe Migrations', desc: 'Columns added with ALTER TABLE IF NOT EXISTS. Zero-downtime; no reset-database endpoints exist.' },
        { icon: Sparkles, title: 'Invitations & SSO-ready', desc: 'Invite teammates by email; auto-accept on OAuth sign-in with invite token. Superadmin impersonation for support.' },
      ],
    },
  ];

  return (
    <div className="min-h-screen bg-white">
      {/* Nav */}
      <nav className="border-b border-gray-100 bg-white/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <a href="/" className="flex items-center gap-2.5">
            <div className="bg-gradient-to-br from-blue-600 to-indigo-600 p-2 rounded-xl shadow-lg shadow-blue-200">
              <Mail className="h-5 w-5 text-white" />
            </div>
            <span className="text-xl font-bold bg-gradient-to-r from-gray-900 to-gray-600 bg-clip-text text-transparent">AImailPilot</span>
          </a>
          <div className="flex items-center gap-1 sm:gap-3">
            <a href="/" className="hidden sm:inline text-sm font-medium text-gray-600 hover:text-gray-900 px-3 py-2">Home</a>
            <Button variant="ghost" className="text-gray-600 font-medium" onClick={onGoogleLogin}>
              Sign in
            </Button>
            <Button className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-lg shadow-blue-200/50 font-medium" onClick={onGoogleLogin}>
              Get Started Free
              <ArrowRight className="h-4 w-4 ml-1.5" />
            </Button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-blue-50/80 via-white to-white" />
        <div className="relative max-w-4xl mx-auto px-6 pt-20 pb-12 text-center">
          <Badge className="bg-blue-50 text-blue-700 border-blue-100 mb-4 text-xs font-semibold">Feature Tour</Badge>
          <h1 className="text-4xl sm:text-5xl font-extrabold text-gray-900 leading-[1.15] mb-5 tracking-tight">
            The outreach stack that <span className="bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 bg-clip-text text-transparent">replaces three tools</span>
          </h1>
          <p className="text-lg text-gray-500 max-w-2xl mx-auto leading-relaxed">
            Stop duct-taping Mailmeteor + a CRM + a warmup service + an inbox tool. AImailPilot does it all in one, natively on Gmail and Outlook — with AI that actually reads your replies.
          </p>
        </div>
      </section>

      {/* Positioning strip */}
      <section className="max-w-6xl mx-auto px-6 pb-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { vs: 'vs Mailmeteor', point: 'They stop at mail merge in Google Sheets. We do sequences, inbox, AI reply scoring, warmup, Apollo, and a team scorecard — Gmail + Outlook both.' },
            { vs: 'vs HubSpot', point: 'HubSpot starts at $800/mo per seat and needs an ops team to configure. AImailPilot is free to start, set up in 60 seconds, and the AI is on by default.' },
            { vs: 'vs Salesforce', point: 'Salesforce is for 50-rep enterprises. AImailPilot is for the first 1 to 50 reps — the same outreach muscle, without the six-figure contract or three-week onboarding.' },
          ].map((x, i) => (
            <div key={i} className="bg-gradient-to-br from-gray-50 to-white rounded-2xl border border-gray-100 p-5">
              <Badge className="bg-blue-50 text-blue-700 border-blue-100 mb-3 text-[10px] font-semibold">{x.vs}</Badge>
              <p className="text-sm text-gray-600 leading-relaxed">{x.point}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Categories */}
      <section className="max-w-6xl mx-auto px-6 pb-16">
        {categories.map((cat, ci) => (
          <div key={ci} className="mb-14">
            <div className="flex items-center gap-3 mb-6">
              <div className={`h-8 w-1.5 rounded-full bg-gradient-to-b ${cat.accent}`} />
              <h2 className="text-2xl font-bold text-gray-900">{cat.name}</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {cat.items.map((item, i) => (
                <div key={i} className="bg-white rounded-2xl border border-gray-100 p-5 hover:border-blue-200 hover:shadow-md hover:shadow-blue-50/50 transition-all">
                  <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${cat.accent} flex items-center justify-center mb-3 shadow-sm`}>
                    <item.icon className="h-5 w-5 text-white" />
                  </div>
                  <h3 className="text-sm font-semibold text-gray-900 mb-1.5">{item.title}</h3>
                  <p className="text-xs text-gray-500 leading-relaxed">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>

      {/* CTA */}
      <section className="max-w-6xl mx-auto px-6 pb-20">
        <div className="relative bg-gradient-to-br from-blue-600 via-indigo-600 to-purple-700 rounded-3xl p-12 text-center overflow-hidden">
          <div className="relative">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">See it in action</h2>
            <p className="text-blue-100 text-lg mb-8 max-w-lg mx-auto">Free to start. Connect Gmail or Outlook — everything above is unlocked on day one.</p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Button onClick={onGoogleLogin} size="lg" className="bg-white text-gray-800 hover:bg-gray-50 shadow-xl px-6 py-6 text-base font-medium">
                <FaGoogle className="mr-2.5 h-5 w-5 text-[#4285F4]" />
                Continue with Google
              </Button>
              <Button onClick={onMicrosoftLogin} size="lg" className="bg-white text-gray-800 hover:bg-gray-50 shadow-xl px-6 py-6 text-base font-medium">
                <FaMicrosoft className="mr-2.5 h-5 w-5 text-[#00A4EF]" />
                Continue with Microsoft
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-100 py-8 bg-gray-50/30">
        <div className="max-w-6xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-gray-400">
          <div className="flex items-center gap-2">
            <div className="bg-gradient-to-br from-blue-600 to-indigo-600 p-1.5 rounded-lg">
              <Mail className="h-3.5 w-3.5 text-white" />
            </div>
            <span className="font-medium text-gray-600">AImailPilot</span>
            <span className="text-gray-300 ml-2">|</span>
            <span className="text-xs ml-2">Powered by <span className="font-semibold text-gray-600">AIProductFactory</span></span>
          </div>
          <div className="flex items-center gap-6 flex-wrap justify-center">
            <a href="/" className="hover:text-gray-600 cursor-pointer transition-colors">Home</a>
            <a href="/termsofservice" className="hover:text-gray-600 cursor-pointer transition-colors">Terms of Service</a>
            <a href="/privacystatement" className="hover:text-gray-600 cursor-pointer transition-colors">Privacy Statement</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
