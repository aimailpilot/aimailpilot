import { storage } from "../storage";
import { LLMService } from "./llm";

export interface LeadSummary {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  jobTitle?: string;
  status?: string;
  score?: number;
  emailRating?: number;
  emailRatingGrade?: string;
  tags?: string[];
  lastActivityDate?: string | null;
  createdAt?: string;
}

export interface DraftLeadEmailOptions {
  productDescription: string;
  tone?: string;
  callToAction?: string;
  templateContent?: string;
}

export interface DraftLeadEmailResult {
  subject: string;
  body: string;
}

/**
 * SalesAgentService
 * Lightweight "AI sales agent" built on top of existing contacts + LLM.
 * This is intentionally non-invasive: it does not change schemas or existing behavior.
 */
export class SalesAgentService {
  private llmService: LLMService;

  constructor() {
    this.llmService = new LLMService();
  }

  /**
   * Returns a prioritized list of leads (contacts) for an organization.
   * Uses existing contact fields like score, emailRating, lastActivityDate, and status.
   */
  async getPrioritizedLeads(
    organizationId: string,
    options?: { limit?: number; status?: string; minScore?: number }
  ): Promise<LeadSummary[]> {
    const limit = options?.limit ?? 100;
    // Reuse existing contacts listing; this respects multitenancy and org scoping
    const contacts = await storage.getContacts(organizationId, 1000, 0);

    const filtered = contacts
      .filter((c: any) => {
        if (options?.status && options.status !== "all") {
          if ((c.status || "cold") !== options.status) return false;
        }
        if (options?.minScore != null) {
          const scoreVal = typeof c.score === "number" ? c.score : parseInt(String(c.score || "0"), 10);
          if (Number.isFinite(scoreVal) && scoreVal < options.minScore) return false;
        }
        return true;
      })
      .map((c: any) => ({
        id: c.id,
        email: c.email,
        firstName: c.firstName,
        lastName: c.lastName,
        company: c.company,
        jobTitle: c.jobTitle,
        status: c.status,
        score: typeof c.score === "number" ? c.score : undefined,
        emailRating: typeof c.emailRating === "number" ? c.emailRating : undefined,
        emailRatingGrade: c.emailRatingGrade,
        tags: Array.isArray(c.tags) ? c.tags : [],
        lastActivityDate: c.lastActivityDate || null,
        createdAt: c.createdAt,
      })) as LeadSummary[];

    // Simple prioritization: hottest by emailRating, then score, then recency
    const sorted = filtered.sort((a, b) => {
      const aRating = a.emailRating ?? -1;
      const bRating = b.emailRating ?? -1;
      if (bRating !== aRating) return bRating - aRating;

      const aScore = a.score ?? 0;
      const bScore = b.score ?? 0;
      if (bScore !== aScore) return bScore - aScore;

      const aDate = a.lastActivityDate || a.createdAt || "";
      const bDate = b.lastActivityDate || b.createdAt || "";
      if (aDate && bDate) {
        return aDate > bDate ? -1 : aDate < bDate ? 1 : 0;
      }
      return 0;
    });

    return sorted.slice(0, limit);
  }

  /**
   * Draft a personalized outbound email for a specific lead using the existing LLMService.
   */
  async draftEmailForLead(
    organizationId: string,
    contactId: string,
    options: DraftLeadEmailOptions
  ): Promise<DraftLeadEmailResult> {
    const contact = await storage.getContact(contactId);
    if (!contact || contact.organizationId !== organizationId) {
      throw new Error("Contact not found or not in this organization");
    }

    const template = options.templateContent ?? `
Hi {{firstName}},

I wanted to reach out because I think {{company}} could benefit from our product.

{{productDescription}}

{{callToAction}}

Best,
{{senderName}}
`;

    const mergedTemplate = template
      .replace(/{{firstName}}/g, contact.firstName || contact.lastName || contact.email)
      .replace(/{{company}}/g, contact.company || "your team")
      .replace(/{{productDescription}}/g, options.productDescription)
      .replace(/{{callToAction}}/g, options.callToAction || "Would you be open to a quick 20-minute call?")
      .replace(/{{senderName}}/g, "Your Sales Team");

    const campaignContext = {
      description: options.productDescription,
      tone: options.tone || "friendly and professional",
      callToAction: options.callToAction,
      source: "sales-agent",
    };

    const body = await this.llmService.generatePersonalizedEmail(
      organizationId,
      contact,
      mergedTemplate,
      campaignContext
    );

    const subject = `${contact.firstName || contact.company || "Quick idea"} for ${
      contact.company || "your team"
    }`;

    return { subject, body };
  }
}

export const salesAgentService = new SalesAgentService();

