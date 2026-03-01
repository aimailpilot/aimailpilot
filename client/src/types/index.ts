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
  status: 'draft' | 'scheduled' | 'active' | 'paused' | 'completed';
  totalRecipients: number;
  sentCount: number;
  openedCount: number;
  clickedCount: number;
  repliedCount: number;
  bouncedCount: number;
  unsubscribedCount: number;
  createdAt: string;
  updatedAt: string;
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
  createdAt: string;
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
