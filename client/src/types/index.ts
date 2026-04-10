export interface User {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  role: 'admin' | 'manager' | 'operator' | 'viewer';
  organizationId: string;
  profileImageUrl?: string;
}

export interface Organization {
  id: string;
  name: string;
  domain?: string;
  settings?: any;
}

export interface Campaign {
  id: string;
  name: string;
  description?: string;
  status: 'draft' | 'scheduled' | 'active' | 'paused' | 'completed' | 'archived';
  totalRecipients: number;
  sentCount: number;
  openedCount: number;
  clickedCount: number;
  repliedCount: number;
  bouncedCount: number;
  unsubscribedCount: number;
  subject?: string;
  content?: string;
  emailAccountId?: string;
  templateId?: string;
  contactIds?: string[];
  segmentId?: string;
  trackOpens?: boolean;
  trackClicks?: boolean;
  includeUnsubscribe?: boolean;
  scheduledAt?: string;
  createdAt: string;
  updatedAt: string;
  // Enriched fields from API
  createdBy?: string;
  creatorName?: string;
  creatorEmail?: string;
  senderEmail?: string;
  senderName?: string;
  listName?: string;
}

export interface CampaignMessage {
  id: string;
  campaignId: string;
  contactId: string;
  subject: string;
  content: string;
  status: 'sending' | 'sent' | 'failed' | 'bounced';
  trackingId: string;
  stepNumber: number;
  sentAt?: string;
  openedAt?: string;
  clickedAt?: string;
  repliedAt?: string;
  errorMessage?: string;
  createdAt: string;
  contact?: {
    id: string;
    email: string;
    firstName?: string;
    lastName?: string;
    company?: string;
  };
  events?: TrackingEvent[];
  openCount?: number;
  clickCount?: number;
  replyCount?: number;
  firstOpenedAt?: string;
  firstClickedAt?: string;
  firstRepliedAt?: string;
}

export interface TrackingEvent {
  id: string;
  type: 'sent' | 'open' | 'click' | 'reply' | 'bounce' | 'unsubscribe';
  campaignId: string;
  messageId: string;
  contactId: string;
  trackingId: string;
  url?: string;
  userAgent?: string;
  ip?: string;
  metadata?: any;
  createdAt: string;
  contact?: {
    email: string;
    firstName?: string;
    lastName?: string;
    company?: string;
  };
  campaignName?: string;
}

export interface StepAnalytics {
  stepNumber: number;
  label: string;
  description: string | null;
  sent: number;
  opened: number;
  clicked: number;
  replied: number;
  bounced: number;
  unsubscribed: number;
  openRate: string;
  clickRate: string;
  replyRate: string;
}

export interface ActivityTimelineItem {
  type: string;
  label: string;
  timestamp: string;
  icon: string;
}

export interface CampaignDetail {
  campaign: Campaign;
  analytics: CampaignAnalytics;
  messages: CampaignMessage[];
  totalMessages: number;
  recentEvents: TrackingEvent[];
  stepAnalytics: StepAnalytics[];
  followupSequences: any[];
  emailAccount: { id: string; email: string; displayName?: string; provider: string } | null;
  activityTimeline: ActivityTimelineItem[];
  trackingBaseUrl?: string;
}

export interface CampaignAnalytics {
  campaignId: string;
  campaignName: string;
  totalSent: number;
  delivered: number;
  opened: number;
  clicked: number;
  replied: number;
  bounced: number;
  unsubscribed: number;
  openRate: string;
  clickRate: string;
  replyRate: string;
  bounceRate: string;
  unsubscribeRate: string;
  deliveryRate: string;
}

export interface Contact {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  jobTitle?: string;
  status: 'cold' | 'warm' | 'hot' | 'replied' | 'unsubscribed';
  score: number;
  tags?: string[];
  listId?: string;
  customFields?: Record<string, any>;
  source?: string;
  createdAt: string;
}

export interface ContactList {
  id: string;
  name: string;
  source: 'csv' | 'google-sheets' | 'manual';
  headers: string[];
  contactCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ContactSegment {
  id: string;
  name: string;
  description?: string;
  contactCount: number;
  createdAt: string;
}

export interface EmailTemplate {
  id: string;
  name: string;
  category?: string;
  subject: string;
  content: string;
  variables?: string[];
  usageCount: number;
  createdAt: string;
}

export interface EmailAccount {
  id: string;
  provider: 'gmail' | 'outlook' | 'sendgrid' | 'elasticemail';
  email: string;
  displayName?: string;
  dailyLimit: number;
  dailySent: number;
  isActive: boolean;
  lastUsed?: string;
}

export interface LlmConfiguration {
  id: string;
  provider: 'openai' | 'gemini' | 'anthropic' | 'llama';
  model: string;
  isPrimary: boolean;
  monthlyCost: number;
  monthlyLimit: number;
  isActive: boolean;
}

export interface FollowupSequence {
  id: string;
  name: string;
  description?: string;
  isActive: boolean;
  createdAt: string;
}

export interface FollowupStep {
  id: string;
  sequenceId: string;
  stepNumber: number;
  trigger: 'no_reply' | 'no_open' | 'time_delay' | 'link_clicked' | 'specific_reply';
  delayDays: number;
  delayHours: number;
  subject?: string;
  content?: string;
  isActive: boolean;
}

export interface Integration {
  id: string;
  type: string;
  name: string;
  isActive: boolean;
  lastSyncAt?: string;
  syncCount: number;
}

export interface DashboardStats {
  activeCampaigns: number;
  openRate: number;
  replyRate: number;
  deliverability: number;
  totalSent: number;
  totalOpened: number;
  totalClicked: number;
  totalReplied: number;
}

export interface AnalyticsData {
  timeline: Array<{
    date: string;
    opens: number;
    clicks: number;
    replies: number;
  }>;
  leadScoring: {
    hot: number;
    warm: number;
    cold: number;
  };
}
