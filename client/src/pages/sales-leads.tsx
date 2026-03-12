import { useState } from "react";
import { useSalesLeads } from "@/hooks/use-sales-leads";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Flame,
  Mail,
  Search,
  Sparkles,
} from "lucide-react";

export default function SalesLeadsPage() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [minScore, setMinScore] = useState<number | undefined>(undefined);
  const [productDescription, setProductDescription] = useState<string>("");
  const [callToAction, setCallToAction] = useState<string>("Would you be open to a quick 20-minute call next week?");
  const [tone, setTone] = useState<string>("friendly and professional");
  const [activeLeadId, setActiveLeadId] = useState<string | null>(null);
  const [draftResult, setDraftResult] = useState<{ subject: string; body: string } | null>(null);

  const { leads = [], isLoading, draftEmail, isDrafting } = useSalesLeads({
    status: statusFilter,
    minScore,
    limit: 100,
  });

  const handleDraft = async (leadId: string) => {
    if (!productDescription.trim()) {
      alert("Please enter a short product description first.");
      return;
    }
    setActiveLeadId(leadId);
    setDraftResult(null);
    try {
      const result = await draftEmail({
        contactId: leadId,
        productDescription,
        tone,
        callToAction,
      });
      setDraftResult(result);
    } catch (e) {
      alert("Failed to draft email. Please try again.");
    } finally {
      setActiveLeadId(null);
    }
  };

  const formatName = (lead: any) => {
    if (lead.firstName || lead.lastName) {
      return `${lead.firstName || ""} ${lead.lastName || ""}`.trim();
    }
    return lead.email;
  };

  const formatStatusBadge = (status?: string) => {
    if (!status) return <Badge variant="outline">Unknown</Badge>;
    const map: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
      cold: { label: "Cold", variant: "secondary" },
      warm: { label: "Warm", variant: "default" },
      hot: { label: "Hot", variant: "default" },
      replied: { label: "Replied", variant: "default" },
      unsubscribed: { label: "Unsubscribed", variant: "secondary" },
    };
    const cfg = map[status] || { label: status, variant: "outline" };
    return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Flame className="h-5 w-5 text-orange-500" />
            Sales Leads
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Prioritized leads based on engagement and scores, with AI-drafted outbound emails.
          </p>
        </div>
      </div>

      {/* Controls */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">Lead status</label>
              <div className="flex gap-1 flex-wrap">
                {["all", "cold", "warm", "hot", "replied"].map((s) => (
                  <button
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                      statusFilter === s
                        ? "bg-blue-600 text-white border-blue-600"
                        : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                    }`}
                  >
                    {s === "all" ? "All leads" : s[0].toUpperCase() + s.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">Minimum score</label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  placeholder="e.g. 20"
                  value={minScore ?? ""}
                  onChange={(e) => {
                    const val = e.target.value;
                    setMinScore(val === "" ? undefined : Number(val));
                  }}
                  className="h-8 text-sm"
                />
                <span className="text-xs text-gray-400">Optional</span>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">Tone</label>
              <Input
                value={tone}
                onChange={(e) => setTone(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-3">
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">
                Product pitch (what you’re selling)
              </label>
              <Textarea
                value={productDescription}
                onChange={(e) => setProductDescription(e.target.value)}
                placeholder="Describe your product and the value for this type of lead."
                className="min-h-[60px] text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">
                Call to action
              </label>
              <Textarea
                value={callToAction}
                onChange={(e) => setCallToAction(e.target.value)}
                className="min-h-[60px] text-sm"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Leads table */}
      <Card>
        <CardContent className="p-0">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <Search className="h-4 w-4 text-gray-400" />
              <span>
                {isLoading ? "Loading leads..." : `${leads.length} prioritized lead${leads.length === 1 ? "" : "s"}`}
              </span>
            </div>
          </div>

          {leads.length === 0 && !isLoading ? (
            <div className="py-12 flex flex-col items-center text-center text-gray-500">
              <Mail className="h-10 w-10 text-gray-300 mb-3" />
              <p className="font-medium text-gray-700 mb-1">No leads match your filters</p>
              <p className="text-xs text-gray-400 max-w-sm">
                Try clearing the status/score filters, or send campaigns to generate engagement so the rating engine has data.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {leads.map((lead) => (
                <div
                  key={lead.id}
                  className="px-4 py-3 flex items-start gap-3 hover:bg-gray-50/70 transition-colors"
                >
                  <div className="mt-1">
                    <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center text-xs font-semibold text-blue-600">
                      {formatName(lead).charAt(0).toUpperCase()}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="font-medium text-sm text-gray-900 truncate">
                        {formatName(lead)}
                      </div>
                      {formatStatusBadge(lead.status)}
                      {typeof lead.emailRating === "number" && (
                        <Badge variant="outline" className="text-[11px] border-amber-200 text-amber-700 bg-amber-50">
                          <Sparkles className="h-3 w-3 mr-1 text-amber-500" />
                          Rating {lead.emailRating}{lead.emailRatingGrade ? ` (${lead.emailRatingGrade})` : ""}
                        </Badge>
                      )}
                      {typeof lead.score === "number" && (
                        <Badge variant="outline" className="text-[11px]">
                          Score {lead.score}
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {lead.email}
                      {lead.company && <span className="text-gray-300"> • {lead.company}</span>}
                      {lead.jobTitle && <span className="text-gray-300"> • {lead.jobTitle}</span>}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {lead.tags?.slice(0, 4).map((tag) => (
                        <Badge key={tag} variant="outline" className="text-[10px]">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2 min-w-[160px]">
                    <Button
                      size="sm"
                      className="h-8 text-xs px-3"
                      onClick={() => handleDraft(lead.id)}
                      disabled={isDrafting && activeLeadId === lead.id}
                    >
                      <Mail className="h-3.5 w-3.5 mr-1.5" />
                      {isDrafting && activeLeadId === lead.id ? "Drafting..." : "AI Draft Email"}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Draft preview */}
      {draftResult && (
        <Card>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-blue-500" />
              <span className="text-sm font-semibold text-gray-800">Latest AI draft</span>
            </div>
            <div className="text-xs text-gray-500">
              You can copy this into a template or a campaign email and edit before sending.
            </div>
            <div className="mt-2 space-y-2">
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">Subject</label>
                <Input value={draftResult.subject} readOnly className="text-sm" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">Body</label>
                <Textarea value={draftResult.body} readOnly className="text-sm min-h-[140px]" />
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

