import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Mail, Send, Users, BarChart3, Zap, Shield, CheckCircle,
  ArrowRight, Clock, MousePointerClick, Sparkles,
  ChevronRight, Target, Eye, Lock, Inbox, Brain, Flame,
  Thermometer, Database, ClipboardList, Star, MessageSquare
} from "lucide-react";
import { FaGoogle, FaMicrosoft } from "react-icons/fa";
import FeaturesPage from "./features-page";

interface LandingPageProps {
  onLogin?: () => void;
  oauthError?: string | null;
}

export default function LandingPage({ onLogin, oauthError }: LandingPageProps) {
  const handleGoogleLogin = () => { window.location.href = '/api/auth/google'; };
  const handleMicrosoftLogin = () => { window.location.href = '/api/auth/microsoft'; };

  // Lightweight client-side path switch so /features works pre-auth
  const path = typeof window !== 'undefined' ? window.location.pathname : '/';
  if (path === '/features') {
    return <FeaturesPage onGoogleLogin={handleGoogleLogin} onMicrosoftLogin={handleMicrosoftLogin} />;
  }

  const capabilities = [
    { icon: Send, title: 'Campaigns & Mail Merge', desc: 'Personalized multi-step campaigns with merge tags, throttling, and per-account daily limits. Gmail, Outlook & SMTP.', color: 'bg-blue-50', text: 'text-blue-600' },
    { icon: Clock, title: 'Automated Follow-ups', desc: 'Multi-step sequences that stop on reply, respect sending windows, and thread correctly on Gmail & Outlook.', color: 'bg-purple-50', text: 'text-purple-600' },
    { icon: Inbox, title: 'Unified Inbox & Reply Classifier', desc: 'All replies in one view. Auto-classified as positive, negative, OOO, auto-reply, or bounce — with AI fallback.', color: 'bg-emerald-50', text: 'text-emerald-600' },
    { icon: Brain, title: 'Lead Intelligence (AI)', desc: 'Azure OpenAI scans 6–12 months of email history and buckets contacts: past customer, hot lead, warm lead, cold, and more.', color: 'bg-pink-50', text: 'text-pink-600' },
    { icon: Flame, title: 'Hot Leads & Nudges', desc: 'Suggested Won / Suggested Meeting signals surface automatically from new replies so nothing slips through.', color: 'bg-amber-50', text: 'text-amber-600' },
    { icon: Thermometer, title: 'Inbox Warmup', desc: 'Self-warmup between your connected accounts — opens, stars, replies — to build sender reputation safely.', color: 'bg-orange-50', text: 'text-orange-600' },
    { icon: Database, title: 'Apollo Integration', desc: 'Search Apollo by title, industry, location, company; preview with dedup; import with saved-first credit savings.', color: 'bg-indigo-50', text: 'text-indigo-600' },
    { icon: MessageSquare, title: 'Knowledge Base & AI Drafts', desc: 'Upload case studies, pricing, proposals. Context Engine writes on-brand reply drafts and proposals grounded in your docs.', color: 'bg-cyan-50', text: 'text-cyan-600' },
    { icon: ClipboardList, title: 'Team Scorecard', desc: 'Per-member emails sent, hot leads, not-replied, activities logged. Daily task queue keeps reps on target.', color: 'bg-rose-50', text: 'text-rose-600' },
    { icon: Star, title: 'Contact Rating', desc: 'Every contact gets an A–F engagement grade based on opens, clicks, reply quality and recency — rescored on demand.', color: 'bg-yellow-50', text: 'text-yellow-600' },
    { icon: Shield, title: 'Deliverability & Safety', desc: 'Bounce surge auto-pause, suppression list, sender-safe guards, SMTP rotation, and sending-window enforcement.', color: 'bg-teal-50', text: 'text-teal-600' },
    { icon: BarChart3, title: 'Real-time Analytics', desc: 'Opens, clicks, replies, bounces, reply-quality scores — per campaign, per account, per team member.', color: 'bg-sky-50', text: 'text-sky-600' },
  ];

  const workflows = [
    { step: '01', title: 'Connect', desc: 'Link Gmail or Outlook via OAuth in under a minute', icon: Lock },
    { step: '02', title: 'Import', desc: 'Bring contacts from CSV, Google Sheets, or Apollo', icon: Users },
    { step: '03', title: 'Compose', desc: 'Use merge tags or let AI draft from your knowledge base', icon: Mail },
    { step: '04', title: 'Launch & Track', desc: 'Send, follow up automatically, and watch replies land', icon: BarChart3 },
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
            <a href="/features" className="hidden sm:inline text-sm font-medium text-gray-600 hover:text-gray-900 px-3 py-2">Features</a>
            <Button variant="ghost" className="text-gray-600 font-medium" onClick={handleGoogleLogin}>
              Sign in
            </Button>
            <Button className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-lg shadow-blue-200/50 font-medium" onClick={handleGoogleLogin}>
              Get Started Free
              <ArrowRight className="h-4 w-4 ml-1.5" />
            </Button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-blue-50/80 via-white to-white" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[800px] bg-gradient-to-br from-blue-100/40 to-indigo-100/40 rounded-full blur-3xl -translate-y-1/2" />
        <div className="absolute top-20 right-10 w-[300px] h-[300px] bg-gradient-to-br from-purple-100/30 to-pink-100/30 rounded-full blur-3xl" />

        <div className="relative max-w-6xl mx-auto px-6 pt-20 pb-16">
          <div className="text-center max-w-3xl mx-auto">
            <div className="inline-flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-full px-4 py-1.5 mb-6">
              <Sparkles className="h-4 w-4 text-blue-600" />
              <span className="text-sm font-medium text-blue-700">The AI outreach platform built on Gmail & Outlook</span>
            </div>

            <h1 className="text-5xl sm:text-6xl font-extrabold text-gray-900 leading-[1.1] mb-6 tracking-tight">
              Mail merge is table stakes.
              <span className="block bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 bg-clip-text text-transparent">This is what comes next.</span>
            </h1>

            <p className="text-lg sm:text-xl text-gray-500 mb-10 max-w-2xl mx-auto leading-relaxed">
              Campaigns, automated follow-ups, unified inbox, AI reply scoring, inbox warmup, Apollo prospecting, knowledge-base drafts, and team scorecards — in one tool. All the power of HubSpot or Salesforce without the six-figure contract or three-week onboarding.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-8">
              <Button onClick={handleGoogleLogin} size="lg" className="w-full sm:w-auto bg-white hover:bg-gray-50 text-gray-800 border border-gray-200 shadow-sm px-6 py-6 text-base font-medium">
                <FaGoogle className="mr-2.5 h-5 w-5 text-[#4285F4]" />
                Continue with Google
              </Button>
              <Button onClick={handleMicrosoftLogin} size="lg" className="w-full sm:w-auto bg-white hover:bg-gray-50 text-gray-800 border border-gray-200 shadow-sm px-6 py-6 text-base font-medium">
                <FaMicrosoft className="mr-2.5 h-5 w-5 text-[#00A4EF]" />
                Continue with Microsoft
              </Button>
            </div>

            <div className="flex items-center justify-center gap-6 text-sm text-gray-400 flex-wrap">
              <span className="flex items-center gap-1.5"><CheckCircle className="h-4 w-4 text-green-500" /> Free to start</span>
              <span className="flex items-center gap-1.5"><CheckCircle className="h-4 w-4 text-green-500" /> No credit card</span>
              <span className="flex items-center gap-1.5"><CheckCircle className="h-4 w-4 text-green-500" /> 2,000 emails/day</span>
            </div>

            {oauthError && (
              <div className="mt-4 mx-auto max-w-md bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-700 text-sm">
                {oauthError === 'oauth_not_configured'
                  ? 'OAuth is not configured yet. Please contact your administrator.'
                  : oauthError === 'oauth_denied'
                  ? 'Sign-in was cancelled. Please try again.'
                  : oauthError === 'oauth_callback_failed'
                  ? 'Authentication failed. Please try again.'
                  : `Authentication error: ${oauthError}`}
              </div>
            )}
          </div>

          {/* Dashboard Mockup */}
          <div className="max-w-4xl mx-auto mt-16">
            <div className="bg-white rounded-2xl border border-gray-200 shadow-2xl shadow-gray-200/60 overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 bg-gray-50 border-b border-gray-200">
                <div className="flex gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-red-400" />
                  <div className="w-3 h-3 rounded-full bg-amber-400" />
                  <div className="w-3 h-3 rounded-full bg-emerald-400" />
                </div>
                <div className="flex-1 mx-4">
                  <div className="bg-white border border-gray-200 rounded-lg px-4 py-1.5 text-xs text-gray-400 max-w-sm mx-auto flex items-center gap-2">
                    <Lock className="h-3 w-3 text-emerald-500" />
                    aimailpilot.com/dashboard
                  </div>
                </div>
              </div>
              <div className="p-6 bg-gray-50/50">
                <div className="flex gap-4 mb-5">
                  <div className="w-48 hidden md:block">
                    <div className="flex items-center gap-2 mb-4 pl-1">
                      <div className="bg-gradient-to-br from-blue-600 to-indigo-600 p-1.5 rounded-lg">
                        <Mail className="h-3.5 w-3.5 text-white" />
                      </div>
                      <span className="text-sm font-bold text-gray-900">AImailPilot</span>
                    </div>
                    <div className="space-y-1">
                      {[
                        { label: 'Campaigns', active: true },
                        { label: 'Inbox' },
                        { label: 'Hot Leads' },
                        { label: 'Contacts' },
                        { label: 'Scorecard' },
                      ].map((item) => (
                        <div key={item.label} className={`text-xs px-3 py-2 rounded-lg ${item.active ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-gray-400'}`}>
                          {item.label}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="flex-1 space-y-4">
                    <div className="grid grid-cols-4 gap-3">
                      {[
                        { label: 'Sent', value: '3,990', color: 'text-blue-600' },
                        { label: 'Opened', value: '61.8%', color: 'text-emerald-600' },
                        { label: 'Clicked', value: '1,179', color: 'text-purple-600' },
                        { label: 'Replied', value: '6.3%', color: 'text-amber-600' },
                      ].map((kpi) => (
                        <div key={kpi.label} className="bg-white rounded-xl border border-gray-100 p-3 shadow-sm">
                          <div className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">{kpi.label}</div>
                          <div className={`text-lg font-bold ${kpi.color} mt-0.5`}>{kpi.value}</div>
                        </div>
                      ))}
                    </div>
                    <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
                      {[
                        { name: 'Q4 Product Launch', status: 'completed', sent: '1,180', open: '61.0%' },
                        { name: 'Customer Onboarding', status: 'active', sent: '430', open: '72.6%' },
                        { name: 'Re-engagement', status: 'scheduled', sent: '—', open: '—' },
                      ].map((campaign, i) => (
                        <div key={i} className={`flex items-center gap-3 px-4 py-2.5 text-xs ${i < 2 ? 'border-b border-gray-50' : ''}`}>
                          <span className="flex-1 font-medium text-gray-700 truncate">{campaign.name}</span>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium capitalize ${campaign.status === 'completed' ? 'bg-gray-100 text-gray-600' : campaign.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'}`}>{campaign.status}</span>
                          <span className="w-14 text-right text-gray-500">{campaign.sent}</span>
                          <span className="w-14 text-right text-gray-500">{campaign.open}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="h-20 bg-gradient-to-b from-gray-100/40 to-transparent -mt-1 mx-8 rounded-b-3xl" />
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="max-w-6xl mx-auto px-6 py-16">
        <div className="text-center mb-12">
          <Badge className="bg-indigo-50 text-indigo-700 border-indigo-100 mb-3 text-xs font-semibold">How It Works</Badge>
          <h2 className="text-3xl font-bold text-gray-900 mb-3">From zero to first reply in minutes</h2>
          <p className="text-gray-500 max-w-md mx-auto">No complex setup. Just connect, import, and send.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {workflows.map((flow, i) => (
            <div key={i} className="relative group">
              <div className="text-center">
                <div className="relative inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-100/50 mb-4 group-hover:scale-110 group-hover:shadow-lg group-hover:shadow-blue-100/50 transition-all duration-300">
                  <flow.icon className="h-7 w-7 text-blue-600" />
                  <div className="absolute -top-2 -right-2 w-6 h-6 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-full text-white text-[10px] font-bold flex items-center justify-center shadow-md">{flow.step}</div>
                </div>
                <h3 className="text-base font-bold text-gray-900 mb-1.5">{flow.title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{flow.desc}</p>
              </div>
              {i < 3 && (
                <div className="hidden md:block absolute top-8 -right-3 w-6">
                  <ChevronRight className="h-5 w-5 text-gray-200" />
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Capabilities Grid */}
      <section className="bg-gray-50/60 border-y border-gray-100">
        <div className="max-w-6xl mx-auto px-6 py-20">
          <div className="text-center mb-14">
            <Badge className="bg-blue-50 text-blue-700 border-blue-100 mb-3 text-xs font-semibold">Capabilities</Badge>
            <h2 className="text-3xl font-bold text-gray-900 mb-3">A full outreach stack — not just a mail-merge tool</h2>
            <p className="text-gray-500 max-w-xl mx-auto">Everything you need to find prospects, send, follow up, classify replies, and coach your team — built in.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {capabilities.map((c, i) => (
              <div key={i} className="group relative bg-white rounded-2xl border border-gray-100 p-6 hover:border-blue-200 hover:shadow-lg hover:shadow-blue-50 transition-all duration-300">
                <div className={`${c.color} w-12 h-12 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300`}>
                  <c.icon className={`h-6 w-6 ${c.text}`} />
                </div>
                <h3 className="text-base font-semibold text-gray-900 mb-2">{c.title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{c.desc}</p>
              </div>
            ))}
          </div>

          <div className="text-center mt-10">
            <a href="/features">
              <Button variant="outline" className="font-medium">
                Explore all features
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </a>
          </div>
        </div>
      </section>

      {/* Comparison — vs Mailmeteor / HubSpot / Salesforce */}
      <section className="max-w-6xl mx-auto px-6 py-20">
        <div className="text-center mb-10">
          <Badge className="bg-rose-50 text-rose-700 border-rose-100 mb-3 text-xs font-semibold">How we compare</Badge>
          <h2 className="text-3xl font-bold text-gray-900 mb-3">More than mail merge. Less than a 6-figure CRM.</h2>
          <p className="text-gray-500 max-w-2xl mx-auto">Mailmeteor stops at mail merge. HubSpot and Salesforce need a team to configure. AImailPilot is the one tool between them.</p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm border border-gray-100 rounded-2xl overflow-hidden bg-white">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-gray-700 w-[34%]">Capability</th>
                <th className="px-3 py-3 font-semibold text-blue-700 bg-blue-50/60">AImailPilot</th>
                <th className="px-3 py-3 font-semibold text-gray-500">Mailmeteor</th>
                <th className="px-3 py-3 font-semibold text-gray-500">HubSpot</th>
                <th className="px-3 py-3 font-semibold text-gray-500">Salesforce</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {[
                ['Personalized mail merge',               true, true, true, true],
                ['Multi-step automated follow-ups',       true, 'limited', true, true],
                ['Unified inbox across all accounts',     true, false, true, true],
                ['AI reply classification (positive / OOO / bounce)', true, false, 'add-on', 'add-on'],
                ['AI lead buckets from inbox history',    true, false, false, false],
                ['Reply-quality scoring (hot / warm)',    true, false, false, false],
                ['Inbox warmup built-in',                 true, false, false, false],
                ['Apollo search + dedup import',          true, false, 'add-on', 'add-on'],
                ['Knowledge-base grounded AI drafts',     true, false, 'add-on', 'add-on'],
                ['Team scorecard + daily task queue',     true, false, true, true],
                ['Gmail & Outlook thread-native',         true, 'Gmail', false, false],
                ['Setup time',                            '60 seconds', '60 seconds', '2–3 weeks', '3+ weeks'],
                ['Starting price',                        'Free', 'Free', '$800+/mo', '$1,500+/mo'],
              ].map((row, i) => (
                <tr key={i} className="hover:bg-gray-50/40">
                  <td className="px-4 py-3 text-gray-700">{row[0]}</td>
                  {row.slice(1).map((cell, ci) => (
                    <td key={ci} className={`px-3 py-3 text-center ${ci === 0 ? 'bg-blue-50/30' : ''}`}>
                      {cell === true ? (
                        <CheckCircle className={`h-4 w-4 inline ${ci === 0 ? 'text-blue-600' : 'text-emerald-500'}`} />
                      ) : cell === false ? (
                        <span className="text-gray-300">—</span>
                      ) : (
                        <span className={`text-xs ${ci === 0 ? 'text-blue-700 font-semibold' : 'text-gray-500'}`}>{cell as string}</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-center text-xs text-gray-400 mt-4">Pricing reflects published list prices as of 2026. Not an endorsement or affiliation.</p>
      </section>

      {/* Deep-Dive Strip: AI that actually helps you sell */}
      <section className="max-w-6xl mx-auto px-6 py-20">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-10 items-center">
          <div>
            <Badge className="bg-purple-50 text-purple-700 border-purple-100 mb-3 text-xs font-semibold">AI inside</Badge>
            <h2 className="text-3xl font-bold text-gray-900 mb-4 leading-tight">AI that reads your inbox so you don't have to</h2>
            <p className="text-gray-500 leading-relaxed mb-5">
              Every reply is classified — positive, negative, out-of-office, auto-reply, bounce — with an Azure OpenAI fallback for edge cases.
              Hot leads surface automatically. Contacts get an A–F engagement grade. Draft replies are grounded in <em>your</em> case studies, pricing, and past wins.
            </p>
            <ul className="space-y-2 text-sm text-gray-600">
              {[
                'Reply-quality scoring (hot / warm / cold)',
                'Lead buckets: past customer, hot, warm, engaged, cold',
                'Suggested Won & Meeting nudges from new replies',
                'Smart draft replies grounded in your knowledge base',
                'AI-written proposals from your org documents',
              ].map((item, i) => (
                <li key={i} className="flex items-start gap-2">
                  <CheckCircle className="h-4 w-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div className="bg-gradient-to-br from-purple-50 to-indigo-50 rounded-3xl p-6 border border-purple-100/50">
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 mb-3">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center text-white text-xs font-bold">PK</div>
                <div className="flex-1">
                  <div className="text-xs font-semibold text-gray-900">priya@acme.com</div>
                  <div className="text-[10px] text-gray-400">Replied 2 min ago</div>
                </div>
                <Badge className="bg-emerald-50 text-emerald-700 border-emerald-100 text-[10px]">Positive · Hot</Badge>
              </div>
              <p className="text-xs text-gray-600 leading-relaxed">"Yes, this is exactly what our team needs. Can we hop on a 15-min call this week?"</p>
            </div>
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="h-3.5 w-3.5 text-purple-500" />
                <span className="text-[10px] uppercase tracking-wide font-semibold text-purple-600">AI suggested action</span>
              </div>
              <p className="text-xs text-gray-700 font-medium mb-2">Log as Meeting + mark Suggested Won</p>
              <p className="text-xs text-gray-500">Uses the Q3 case study and pricing doc for your reply draft.</p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-6xl mx-auto px-6 pb-20">
        <div className="relative bg-gradient-to-br from-blue-600 via-indigo-600 to-purple-700 rounded-3xl p-12 text-center overflow-hidden">
          <div className="absolute inset-0 bg-[url('data:image/svg+xml,%3Csvg%20width%3D%2260%22%20height%3D%2260%22%20viewBox%3D%220%200%2060%2060%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cg%20fill%3D%22none%22%20fill-rule%3D%22evenodd%22%3E%3Cg%20fill%3D%22%23ffffff%22%20fill-opacity%3D%220.05%22%3E%3Cpath%20d%3D%22M36%2034v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6%2034v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6%204V0H4v4H0v2h4v4h2V6h4V4H6z%22%2F%3E%3C%2Fg%3E%3C%2Fg%3E%3C%2Fsvg%3E')] opacity-40" />
          <div className="relative">
            <div className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-sm rounded-full px-4 py-1.5 mb-6 border border-white/20">
              <Zap className="h-4 w-4 text-yellow-300" />
              <span className="text-sm font-medium text-white/90">Free forever for personal use</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">Ready to send smarter emails?</h2>
            <p className="text-blue-100 text-lg mb-8 max-w-lg mx-auto">
              Get started in under 60 seconds. No credit card required.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Button onClick={handleGoogleLogin} size="lg" className="bg-white text-blue-700 hover:bg-blue-50 shadow-xl shadow-black/20 px-8 py-6 text-base font-semibold">
                Start Sending Free
                <ArrowRight className="h-4 w-4 ml-2" />
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
            <a href="/features" className="hover:text-gray-600 cursor-pointer transition-colors">Features</a>
            <a href="/termsofservice" className="hover:text-gray-600 cursor-pointer transition-colors">Terms of Service</a>
            <a href="/privacystatement" className="hover:text-gray-600 cursor-pointer transition-colors">Privacy Statement</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
