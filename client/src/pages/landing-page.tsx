import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  Mail, Send, Users, BarChart3, Zap, Shield, CheckCircle, 
  ArrowRight, Star, Globe, Clock, MousePointerClick, Sparkles
} from "lucide-react";
import { FaGoogle, FaMicrosoft } from "react-icons/fa";

interface LandingPageProps {
  onLogin?: () => void;
}

export default function LandingPage({ onLogin }: LandingPageProps) {
  const handleGoogleLogin = async () => {
    window.location.href = '/api/auth/google';
  };

  const handleMicrosoftLogin = () => {
    window.location.href = '/api/auth/microsoft';
  };

  const features = [
    { icon: Send, title: 'Mail Merge', desc: 'Send personalized emails at scale with dynamic merge tags' },
    { icon: BarChart3, title: 'Real-time Tracking', desc: 'Track opens, clicks, replies, and bounces in real-time' },
    { icon: Clock, title: 'Smart Scheduling', desc: 'Schedule campaigns and automate follow-up sequences' },
    { icon: Users, title: 'Contact Management', desc: 'Import, organize, and segment your contacts with ease' },
    { icon: MousePointerClick, title: 'Click Tracking', desc: 'Know exactly which links get clicked and by whom' },
    { icon: Shield, title: 'Deliverability', desc: 'Built-in throttling and warm-up to keep you out of spam' },
  ];

  const stats = [
    { value: '99.1%', label: 'Delivery Rate' },
    { value: '2,000', label: 'Daily Emails' },
    { value: '62%', label: 'Avg Open Rate' },
    { value: '5s', label: 'Setup Time' },
  ];

  return (
    <div className="min-h-screen bg-white">
      {/* Nav */}
      <nav className="border-b border-gray-100 bg-white/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="bg-gradient-to-br from-blue-600 to-indigo-600 p-2 rounded-xl shadow-lg shadow-blue-200">
              <Mail className="h-5 w-5 text-white" />
            </div>
            <span className="text-xl font-bold bg-gradient-to-r from-gray-900 to-gray-600 bg-clip-text text-transparent">MailFlow</span>
          </div>
          <div className="flex items-center gap-3">
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
        {/* Background decoration */}
        <div className="absolute inset-0 bg-gradient-to-b from-blue-50/80 via-white to-white" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[800px] bg-gradient-to-br from-blue-100/40 to-indigo-100/40 rounded-full blur-3xl -translate-y-1/2" />
        
        <div className="relative max-w-6xl mx-auto px-6 pt-20 pb-16">
          <div className="text-center max-w-3xl mx-auto">
            <div className="inline-flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-full px-4 py-1.5 mb-6">
              <Sparkles className="h-4 w-4 text-blue-600" />
              <span className="text-sm font-medium text-blue-700">AI-Powered Email Campaigns</span>
            </div>

            <h1 className="text-5xl sm:text-6xl font-extrabold text-gray-900 leading-[1.1] mb-6 tracking-tight">
              Send emails that
              <span className="bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 bg-clip-text text-transparent"> actually get opened</span>
            </h1>

            <p className="text-lg sm:text-xl text-gray-500 mb-10 max-w-2xl mx-auto leading-relaxed">
              Personalized mail merge, automated follow-ups, and real-time analytics. 
              Connect your Gmail or Outlook and start sending in under 60 seconds.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-12">
              <Button
                onClick={handleGoogleLogin}
                size="lg"
                className="w-full sm:w-auto bg-white hover:bg-gray-50 text-gray-800 border border-gray-200 shadow-sm px-6 py-6 text-base font-medium"
              >
                <FaGoogle className="mr-2.5 h-5 w-5 text-[#4285F4]" />
                Continue with Google
              </Button>
              <Button
                onClick={handleMicrosoftLogin}
                size="lg"
                className="w-full sm:w-auto bg-white hover:bg-gray-50 text-gray-800 border border-gray-200 shadow-sm px-6 py-6 text-base font-medium"
              >
                <FaMicrosoft className="mr-2.5 h-5 w-5 text-[#00A4EF]" />
                Continue with Microsoft
              </Button>
            </div>

            <div className="flex items-center justify-center gap-6 text-sm text-gray-400">
              <span className="flex items-center gap-1.5"><CheckCircle className="h-4 w-4 text-green-500" /> Free to start</span>
              <span className="flex items-center gap-1.5"><CheckCircle className="h-4 w-4 text-green-500" /> No credit card</span>
              <span className="flex items-center gap-1.5"><CheckCircle className="h-4 w-4 text-green-500" /> 2,000 emails/day</span>
            </div>
          </div>

          {/* Stats Bar */}
          <div className="max-w-3xl mx-auto mt-16">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-xl shadow-gray-100/50 p-1">
              <div className="grid grid-cols-4 divide-x divide-gray-100">
                {stats.map((stat, i) => (
                  <div key={i} className="text-center py-5 px-4">
                    <div className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">{stat.value}</div>
                    <div className="text-xs text-gray-400 mt-1 font-medium">{stat.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="max-w-6xl mx-auto px-6 py-20">
        <div className="text-center mb-14">
          <h2 className="text-3xl font-bold text-gray-900 mb-3">Everything you need for email outreach</h2>
          <p className="text-gray-500 max-w-xl mx-auto">Powerful features to help you send better emails, track performance, and close more deals.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {features.map((feature, i) => (
            <div key={i} className="group relative bg-white rounded-2xl border border-gray-100 p-6 hover:border-blue-200 hover:shadow-lg hover:shadow-blue-50 transition-all duration-300">
              <div className="bg-gradient-to-br from-blue-50 to-indigo-50 w-12 h-12 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300">
                <feature.icon className="h-6 w-6 text-blue-600" />
              </div>
              <h3 className="text-base font-semibold text-gray-900 mb-2">{feature.title}</h3>
              <p className="text-sm text-gray-500 leading-relaxed">{feature.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Social Proof */}
      <section className="bg-gradient-to-br from-gray-900 via-gray-900 to-indigo-950 py-20">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-12">
            <div className="flex items-center justify-center gap-1 mb-3">
              {[...Array(5)].map((_, i) => (
                <Star key={i} className="h-5 w-5 fill-yellow-400 text-yellow-400" />
              ))}
            </div>
            <h2 className="text-3xl font-bold text-white mb-3">Trusted by 10,000+ users</h2>
            <p className="text-gray-400">Join professionals who send smarter emails every day</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { quote: "MailFlow completely changed how we do outreach. Our open rates jumped from 15% to 62% in the first week.", name: "Sarah K.", role: "Head of Sales, TechCorp" },
              { quote: "The automated follow-ups are a game changer. I set it once and it keeps working while I focus on closing deals.", name: "Mike R.", role: "Founder, StartupIO" },
              { quote: "Best email tool for Gmail hands down. The personalization and tracking features are exactly what we needed.", name: "Lisa T.", role: "Marketing Director, Agency Co" },
            ].map((testimonial, i) => (
              <div key={i} className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-6">
                <div className="flex gap-1 mb-3">
                  {[...Array(5)].map((_, j) => (
                    <Star key={j} className="h-3.5 w-3.5 fill-yellow-400 text-yellow-400" />
                  ))}
                </div>
                <p className="text-gray-300 text-sm leading-relaxed mb-4">"{testimonial.quote}"</p>
                <div>
                  <div className="text-white font-medium text-sm">{testimonial.name}</div>
                  <div className="text-gray-500 text-xs">{testimonial.role}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-6xl mx-auto px-6 py-20">
        <div className="relative bg-gradient-to-br from-blue-600 via-indigo-600 to-purple-700 rounded-3xl p-12 text-center overflow-hidden">
          <div className="absolute inset-0 bg-[url('data:image/svg+xml,%3Csvg%20width%3D%2260%22%20height%3D%2260%22%20viewBox%3D%220%200%2060%2060%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cg%20fill%3D%22none%22%20fill-rule%3D%22evenodd%22%3E%3Cg%20fill%3D%22%23ffffff%22%20fill-opacity%3D%220.05%22%3E%3Cpath%20d%3D%22M36%2034v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6%2034v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6%204V0H4v4H0v2h4v4h2V6h4V4H6z%22%2F%3E%3C%2Fg%3E%3C%2Fg%3E%3C%2Fsvg%3E')] opacity-40" />
          <div className="relative">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">Ready to send smarter emails?</h2>
            <p className="text-blue-100 text-lg mb-8 max-w-lg mx-auto">
              Get started in under 60 seconds. No credit card required.
            </p>
            <Button
              onClick={handleGoogleLogin}
              size="lg"
              className="bg-white text-blue-700 hover:bg-blue-50 shadow-xl shadow-black/20 px-8 py-6 text-base font-semibold"
            >
              Start Sending Free
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-100 py-8">
        <div className="max-w-6xl mx-auto px-6 flex items-center justify-between text-sm text-gray-400">
          <div className="flex items-center gap-2">
            <div className="bg-gradient-to-br from-blue-600 to-indigo-600 p-1.5 rounded-lg">
              <Mail className="h-3.5 w-3.5 text-white" />
            </div>
            <span className="font-medium text-gray-600">MailFlow</span>
          </div>
          <div className="flex items-center gap-6">
            <span>Terms</span>
            <span>Privacy</span>
            <span>Security</span>
            <span>Help</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
