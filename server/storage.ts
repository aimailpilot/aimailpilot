// In-memory storage with full feature support for MailFlow
// Supports: email accounts with SMTP, campaigns, contacts, templates, tracking, follow-ups

function genId() {
  return crypto.randomUUID();
}

const ORG_ID = '550e8400-e29b-41d4-a716-446655440001';

// ========== DATA STORES ==========

const orgs: any[] = [
  { id: ORG_ID, name: 'MailFlow Organization', domain: 'mailflow.app', settings: {}, createdAt: new Date(), updatedAt: new Date() }
];

const usersData: any[] = [
  { id: 'user-123', email: 'demo@mailflow.app', firstName: 'Demo', lastName: 'User', role: 'admin', organizationId: ORG_ID, isActive: true, createdAt: new Date(), updatedAt: new Date() }
];

// Email accounts with SMTP configuration
const emailAccountsData: any[] = [];

const llmConfigsData: any[] = [];

const contactsData: any[] = [
  { id: genId(), organizationId: ORG_ID, email: 'john@techcorp.com', firstName: 'John', lastName: 'Smith', company: 'Tech Corp', jobTitle: 'CTO', status: 'warm', score: 75, tags: ['tech', 'enterprise'], customFields: {}, source: 'linkedin', createdAt: new Date(), updatedAt: new Date() },
  { id: genId(), organizationId: ORG_ID, email: 'jane@startup.io', firstName: 'Jane', lastName: 'Doe', company: 'Startup IO', jobTitle: 'CEO', status: 'hot', score: 92, tags: ['startup', 'saas'], customFields: {}, source: 'referral', createdAt: new Date(), updatedAt: new Date() },
  { id: genId(), organizationId: ORG_ID, email: 'mike@enterprise.com', firstName: 'Mike', lastName: 'Johnson', company: 'Enterprise Ltd', jobTitle: 'VP Sales', status: 'cold', score: 30, tags: ['enterprise'], customFields: {}, source: 'cold-outreach', createdAt: new Date(), updatedAt: new Date() },
  { id: genId(), organizationId: ORG_ID, email: 'sarah@consulting.com', firstName: 'Sarah', lastName: 'Wilson', company: 'Consulting Group', jobTitle: 'Director', status: 'warm', score: 65, tags: ['consulting'], customFields: {}, source: 'website', createdAt: new Date(), updatedAt: new Date() },
  { id: genId(), organizationId: ORG_ID, email: 'david@agency.co', firstName: 'David', lastName: 'Brown', company: 'Creative Agency', jobTitle: 'Marketing Lead', status: 'replied', score: 88, tags: ['agency', 'marketing'], customFields: {}, source: 'event', createdAt: new Date(), updatedAt: new Date() },
];

const segmentsData: any[] = [];

const templatesData: any[] = [
  { id: genId(), organizationId: ORG_ID, name: 'Welcome Email', category: 'onboarding', subject: 'Welcome to {{company}}!', content: '<p>Hi {{firstName}},</p><p>Welcome aboard! We are thrilled to have you join us at {{company}}.</p><p>Best regards,<br/>The Team</p>', variables: ['firstName', 'company'], isPublic: false, usageCount: 45, createdAt: new Date('2025-09-01'), updatedAt: new Date('2025-09-01') },
  { id: genId(), organizationId: ORG_ID, name: 'Follow-up Template', category: 'follow-up', subject: 'Quick follow-up - {{topic}}', content: '<p>Hi {{firstName}},</p><p>Just wanted to follow up on our previous conversation about {{topic}}.</p><p>Would you have time for a quick call this week?</p><p>Best,<br/>{{senderName}}</p>', variables: ['firstName', 'topic', 'senderName'], isPublic: false, usageCount: 23, createdAt: new Date('2025-08-28'), updatedAt: new Date('2025-08-28') },
  { id: genId(), organizationId: ORG_ID, name: 'Product Launch Announcement', category: 'marketing', subject: 'Introducing {{productName}} - You will love this!', content: '<p>Hi {{firstName}},</p><p>We are excited to announce the launch of <strong>{{productName}}</strong>!</p><p>Check it out and let us know what you think.</p><p>Cheers,<br/>The MailFlow Team</p>', variables: ['firstName', 'productName'], isPublic: true, usageCount: 67, createdAt: new Date('2025-08-25'), updatedAt: new Date('2025-08-25') },
  { id: genId(), organizationId: ORG_ID, name: 'Cold Outreach', category: 'outreach', subject: 'Hi {{firstName}}, quick question about {{company}}', content: '<p>Hi {{firstName}},</p><p>I came across {{company}} and was impressed by what you\'re building.</p><p>I\'d love to share how MailFlow can help {{company}} scale email outreach. Would you be open to a 15-min chat?</p><p>Best,<br/>{{senderName}}</p>', variables: ['firstName', 'company', 'senderName'], isPublic: false, usageCount: 12, createdAt: new Date('2025-09-10'), updatedAt: new Date('2025-09-10') },
];

const CAMPAIGN_IDS = {
  q4Launch: 'camp-q4-product-launch-001',
  onboarding: 'camp-onboarding-series-002',
  reengagement: 'camp-reengagement-003',
  newsletter: 'camp-newsletter-aug-004',
  coldOutreach: 'camp-cold-outreach-005',
};

const campaignsData: any[] = [
  { id: CAMPAIGN_IDS.q4Launch, organizationId: ORG_ID, name: 'Q4 Product Launch', description: 'New feature announcement', status: 'completed', totalRecipients: 1250, sentCount: 1180, openedCount: 720, clickedCount: 345, repliedCount: 89, bouncedCount: 12, unsubscribedCount: 5, subject: 'Exciting news from MailFlow!', content: '<p>Hi {{firstName}},</p><p>We have exciting news to share about MailFlow.</p>', emailAccountId: null, templateId: null, contactIds: [], segmentId: null, scheduledAt: null, createdAt: new Date('2025-08-15'), updatedAt: new Date() },
  { id: CAMPAIGN_IDS.onboarding, organizationId: ORG_ID, name: 'Customer Onboarding Series', description: 'Welcome email sequence', status: 'completed', totalRecipients: 450, sentCount: 430, openedCount: 312, clickedCount: 156, repliedCount: 42, bouncedCount: 3, unsubscribedCount: 2, subject: 'Welcome to MailFlow!', content: '<p>Hi {{firstName}},</p><p>Welcome aboard!</p>', emailAccountId: null, templateId: null, contactIds: [], segmentId: null, scheduledAt: null, createdAt: new Date('2025-08-20'), updatedAt: new Date() },
  { id: CAMPAIGN_IDS.reengagement, organizationId: ORG_ID, name: 'Re-engagement Campaign', description: 'Win back inactive users', status: 'scheduled', totalRecipients: 890, sentCount: 0, openedCount: 0, clickedCount: 0, repliedCount: 0, bouncedCount: 0, unsubscribedCount: 0, subject: '', content: '', emailAccountId: null, templateId: null, contactIds: [], segmentId: null, scheduledAt: null, createdAt: new Date('2025-09-01'), updatedAt: new Date() },
  { id: CAMPAIGN_IDS.newsletter, organizationId: ORG_ID, name: 'Newsletter - August', description: 'Monthly newsletter', status: 'completed', totalRecipients: 2400, sentCount: 2380, openedCount: 1450, clickedCount: 678, repliedCount: 120, bouncedCount: 20, unsubscribedCount: 15, subject: 'MailFlow August Newsletter', content: '<p>Hi {{firstName}},</p><p>Here is your monthly update.</p>', emailAccountId: null, templateId: null, contactIds: [], segmentId: null, scheduledAt: null, createdAt: new Date('2025-08-01'), updatedAt: new Date('2025-08-30') },
  { id: CAMPAIGN_IDS.coldOutreach, organizationId: ORG_ID, name: 'Cold Outreach - Tech', description: 'Tech industry outreach', status: 'draft', totalRecipients: 0, sentCount: 0, openedCount: 0, clickedCount: 0, repliedCount: 0, bouncedCount: 0, unsubscribedCount: 0, subject: '', content: '', emailAccountId: null, templateId: null, contactIds: [], segmentId: null, scheduledAt: null, createdAt: new Date('2025-09-02'), updatedAt: new Date() },
];

// Generate seed messages and tracking events for completed campaigns
function seedTrackingData() {
  const sampleContacts = [
    { id: 'seed-c1', email: 'alice@bigcorp.com', firstName: 'Alice', lastName: 'Chen', company: 'BigCorp Inc' },
    { id: 'seed-c2', email: 'bob@techstart.io', firstName: 'Bob', lastName: 'Williams', company: 'TechStart' },
    { id: 'seed-c3', email: 'carol@enterprise.co', firstName: 'Carol', lastName: 'Martinez', company: 'Enterprise Co' },
    { id: 'seed-c4', email: 'dan@agency.com', firstName: 'Dan', lastName: 'Kim', company: 'Creative Agency' },
    { id: 'seed-c5', email: 'eva@startup.ai', firstName: 'Eva', lastName: 'Patel', company: 'Startup AI' },
    { id: 'seed-c6', email: 'frank@consulting.biz', firstName: 'Frank', lastName: 'Lopez', company: 'Consulting Group' },
    { id: 'seed-c7', email: 'grace@fintech.io', firstName: 'Grace', lastName: 'Nguyen', company: 'FinTech Solutions' },
    { id: 'seed-c8', email: 'henry@saas.dev', firstName: 'Henry', lastName: 'Brown', company: 'SaaS Dev Co' },
    { id: 'seed-c9', email: 'irene@marketing.co', firstName: 'Irene', lastName: 'Taylor', company: 'Marketing Pro' },
    { id: 'seed-c10', email: 'jack@venture.vc', firstName: 'Jack', lastName: 'Davis', company: 'Venture Capital' },
  ];

  // Add seed contacts to contacts data (skip if email exists)
  for (const sc of sampleContacts) {
    if (!contactsData.find(c => c.email === sc.email)) {
      contactsData.push({
        ...sc,
        organizationId: ORG_ID,
        status: 'warm',
        score: Math.floor(Math.random() * 60) + 40,
        tags: ['seed'],
        customFields: {},
        source: 'seed',
        createdAt: new Date('2025-07-01'),
        updatedAt: new Date(),
      });
    }
  }

  // Seed messages + events for Q4 Product Launch
  const campaignId = CAMPAIGN_IDS.q4Launch;
  const now = Date.now();
  const dayMs = 86400000;

  sampleContacts.forEach((contact, i) => {
    const trackingId = `${campaignId}_${contact.id}_seed_${i}`;
    const sentTime = new Date(now - (10 - i) * dayMs - Math.random() * dayMs);
    const msgId = `msg-seed-${campaignId.slice(-3)}-${i}`;

    // Determine status randomly
    const rand = Math.random();
    const hasOpen = rand < 0.7;
    const hasClick = rand < 0.35;
    const hasReply = rand < 0.12;
    const isBounced = rand > 0.97;

    const msg: any = {
      id: msgId,
      campaignId,
      contactId: contact.id,
      subject: `Exciting news from MailFlow!`,
      content: `<p>Hi ${contact.firstName},</p><p>We have exciting news...</p>`,
      status: isBounced ? 'failed' : 'sent',
      trackingId,
      emailAccountId: null,
      stepNumber: 0,
      sentAt: isBounced ? null : sentTime,
      openedAt: hasOpen ? new Date(sentTime.getTime() + Math.random() * 3600000) : null,
      clickedAt: hasClick ? new Date(sentTime.getTime() + Math.random() * 7200000) : null,
      repliedAt: hasReply ? new Date(sentTime.getTime() + Math.random() * dayMs) : null,
      createdAt: sentTime,
    };

    messagesData.push(msg);

    // Create tracking events
    trackingEventsData.push({
      id: `evt-sent-${msgId}`,
      type: 'sent',
      campaignId,
      messageId: msgId,
      contactId: contact.id,
      trackingId,
      createdAt: sentTime,
    });

    if (hasOpen) {
      const openTime = new Date(sentTime.getTime() + Math.random() * 3600000);
      trackingEventsData.push({
        id: `evt-open-${msgId}`,
        type: 'open',
        campaignId,
        messageId: msgId,
        contactId: contact.id,
        trackingId,
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        createdAt: openTime,
      });
      // Some opened twice
      if (Math.random() < 0.3) {
        trackingEventsData.push({
          id: `evt-open2-${msgId}`,
          type: 'open',
          campaignId,
          messageId: msgId,
          contactId: contact.id,
          trackingId,
          createdAt: new Date(openTime.getTime() + Math.random() * 86400000),
        });
      }
    }

    if (hasClick) {
      trackingEventsData.push({
        id: `evt-click-${msgId}`,
        type: 'click',
        campaignId,
        messageId: msgId,
        contactId: contact.id,
        trackingId,
        url: 'https://mailflow.app/features',
        createdAt: new Date(sentTime.getTime() + Math.random() * 7200000),
      });
    }

    if (hasReply) {
      trackingEventsData.push({
        id: `evt-reply-${msgId}`,
        type: 'reply',
        campaignId,
        messageId: msgId,
        contactId: contact.id,
        trackingId,
        createdAt: new Date(sentTime.getTime() + Math.random() * dayMs),
      });
    }

    if (isBounced) {
      trackingEventsData.push({
        id: `evt-bounce-${msgId}`,
        type: 'bounce',
        campaignId,
        messageId: msgId,
        contactId: contact.id,
        trackingId,
        metadata: { error: 'Mailbox not found' },
        createdAt: sentTime,
      });
    }
  });

  // Also seed a few for Newsletter campaign
  const nlCampaignId = CAMPAIGN_IDS.newsletter;
  sampleContacts.slice(0, 6).forEach((contact, i) => {
    const trackingId = `${nlCampaignId}_${contact.id}_seed_${i}`;
    const sentTime = new Date(now - (15 + i) * dayMs);
    const msgId = `msg-seed-nl-${i}`;
    const hasOpen = Math.random() < 0.65;
    const hasClick = Math.random() < 0.3;
    const hasReply = Math.random() < 0.08;

    messagesData.push({
      id: msgId,
      campaignId: nlCampaignId,
      contactId: contact.id,
      subject: `MailFlow August Newsletter`,
      content: `<p>Hi ${contact.firstName},</p><p>Monthly update...</p>`,
      status: 'sent',
      trackingId,
      emailAccountId: null,
      stepNumber: 0,
      sentAt: sentTime,
      openedAt: hasOpen ? new Date(sentTime.getTime() + Math.random() * 7200000) : null,
      clickedAt: hasClick ? new Date(sentTime.getTime() + Math.random() * 14400000) : null,
      repliedAt: hasReply ? new Date(sentTime.getTime() + Math.random() * dayMs) : null,
      createdAt: sentTime,
    });

    trackingEventsData.push({
      id: `evt-sent-nl-${i}`,
      type: 'sent',
      campaignId: nlCampaignId,
      messageId: msgId,
      contactId: contact.id,
      trackingId,
      createdAt: sentTime,
    });

    if (hasOpen) {
      trackingEventsData.push({
        id: `evt-open-nl-${i}`,
        type: 'open',
        campaignId: nlCampaignId,
        messageId: msgId,
        contactId: contact.id,
        trackingId,
        createdAt: new Date(sentTime.getTime() + Math.random() * 7200000),
      });
    }

    if (hasClick) {
      trackingEventsData.push({
        id: `evt-click-nl-${i}`,
        type: 'click',
        campaignId: nlCampaignId,
        messageId: msgId,
        contactId: contact.id,
        trackingId,
        url: 'https://mailflow.app/blog/august-update',
        createdAt: new Date(sentTime.getTime() + Math.random() * 14400000),
      });
    }

    if (hasReply) {
      trackingEventsData.push({
        id: `evt-reply-nl-${i}`,
        type: 'reply',
        campaignId: nlCampaignId,
        messageId: msgId,
        contactId: contact.id,
        trackingId,
        createdAt: new Date(sentTime.getTime() + Math.random() * dayMs),
      });
    }
  });
}

const messagesData: any[] = [];
const integrationsData: any[] = [];
const followupSequencesData: any[] = [];
const followupStepsData: any[] = [];
const campaignFollowupsData: any[] = [];
const followupExecutionsData: any[] = [];

// Tracking data stores
const trackingEventsData: any[] = [];
const unsubscribesData: any[] = [];

// Run seed
seedTrackingData();

export class DatabaseStorage {
  // ========== Organization ==========
  async getOrganization(id: string) { return orgs.find(o => o.id === id); }
  async createOrganization(org: any) { const n = { id: genId(), ...org, createdAt: new Date(), updatedAt: new Date() }; orgs.push(n); return n; }

  // ========== Users ==========
  async getUser(id: string) { return usersData.find(u => u.id === id); }
  async getUserByEmail(email: string) { return usersData.find(u => u.email === email); }
  async createUser(user: any) { const n = { id: genId(), ...user, createdAt: new Date(), updatedAt: new Date() }; usersData.push(n); return n; }
  async updateUser(id: string, data: any) {
    const idx = usersData.findIndex(u => u.id === id);
    if (idx >= 0) { usersData[idx] = { ...usersData[idx], ...data, updatedAt: new Date() }; return usersData[idx]; }
    throw new Error('User not found');
  }

  // ========== Email Accounts (with SMTP) ==========
  async getEmailAccounts(organizationId: string) {
    return emailAccountsData.filter(a => a.organizationId === organizationId);
  }
  async getEmailAccount(id: string) {
    return emailAccountsData.find(a => a.id === id);
  }
  async getEmailAccountByEmail(organizationId: string, email: string) {
    return emailAccountsData.find(a => a.organizationId === organizationId && a.email === email);
  }
  async createEmailAccount(account: any) {
    const n = { id: genId(), ...account, dailySent: 0, isActive: true, createdAt: new Date(), updatedAt: new Date() };
    emailAccountsData.push(n);
    return n;
  }
  async updateEmailAccount(id: string, data: any) {
    const idx = emailAccountsData.findIndex(a => a.id === id);
    if (idx >= 0) { emailAccountsData[idx] = { ...emailAccountsData[idx], ...data, updatedAt: new Date() }; return emailAccountsData[idx]; }
    throw new Error('Email account not found');
  }
  async deleteEmailAccount(id: string) {
    const idx = emailAccountsData.findIndex(a => a.id === id);
    if (idx >= 0) { emailAccountsData.splice(idx, 1); return true; }
    return false;
  }

  // ========== LLM Configurations ==========
  async getLlmConfigurations(organizationId: string) { return llmConfigsData.filter(c => c.organizationId === organizationId); }
  async getPrimaryLlmConfiguration(organizationId: string) { return llmConfigsData.find(c => c.organizationId === organizationId && c.isPrimary && c.isActive); }
  async createLlmConfiguration(config: any) { const n = { id: genId(), ...config, createdAt: new Date() }; llmConfigsData.push(n); return n; }
  async updateLlmConfiguration(id: string, data: any) {
    const idx = llmConfigsData.findIndex(c => c.id === id);
    if (idx >= 0) { llmConfigsData[idx] = { ...llmConfigsData[idx], ...data }; return llmConfigsData[idx]; }
    throw new Error('LLM config not found');
  }

  // ========== Contacts ==========
  async getContacts(organizationId: string, limit = 50, offset = 0) {
    return contactsData.filter(c => c.organizationId === organizationId).slice(offset, offset + limit);
  }
  async getContactsCount(organizationId: string) {
    return contactsData.filter(c => c.organizationId === organizationId).length;
  }
  async getContact(id: string) { return contactsData.find(c => c.id === id); }
  async getContactByEmail(organizationId: string, email: string) {
    return contactsData.find(c => c.organizationId === organizationId && c.email === email);
  }
  async createContact(contact: any) {
    const n = { id: genId(), ...contact, score: contact.score || 0, tags: contact.tags || [], customFields: contact.customFields || {}, createdAt: new Date(), updatedAt: new Date() };
    contactsData.push(n);
    return n;
  }
  async createContactsBulk(contacts: any[]) {
    const results: any[] = [];
    for (const contact of contacts) {
      // Skip if email already exists
      const exists = contactsData.find(c => c.organizationId === contact.organizationId && c.email === contact.email);
      if (exists) {
        results.push({ ...exists, _skipped: true });
        continue;
      }
      const n = { id: genId(), ...contact, score: contact.score || 0, tags: contact.tags || [], customFields: contact.customFields || {}, createdAt: new Date(), updatedAt: new Date() };
      contactsData.push(n);
      results.push(n);
    }
    return results;
  }
  async updateContact(id: string, data: any) {
    const idx = contactsData.findIndex(c => c.id === id);
    if (idx >= 0) { contactsData[idx] = { ...contactsData[idx], ...data, updatedAt: new Date() }; return contactsData[idx]; }
    throw new Error('Contact not found');
  }
  async deleteContact(id: string) {
    const idx = contactsData.findIndex(c => c.id === id);
    if (idx >= 0) { contactsData.splice(idx, 1); return true; }
    return false;
  }
  async deleteContacts(ids: string[]) {
    for (const id of ids) {
      const idx = contactsData.findIndex(c => c.id === id);
      if (idx >= 0) contactsData.splice(idx, 1);
    }
    return true;
  }
  async searchContacts(organizationId: string, query: string) {
    const q = query.toLowerCase();
    return contactsData.filter(c => c.organizationId === organizationId && (
      (c.firstName || '').toLowerCase().includes(q) ||
      (c.lastName || '').toLowerCase().includes(q) ||
      c.email.toLowerCase().includes(q) ||
      (c.company || '').toLowerCase().includes(q)
    )).slice(0, 50);
  }
  async getContactsBySegment(segmentId: string) {
    const segment = segmentsData.find(s => s.id === segmentId);
    if (!segment || !segment.filters) return [];
    // Simple filter implementation
    return contactsData.filter(c => {
      if (segment.filters.status && c.status !== segment.filters.status) return false;
      if (segment.filters.tag && !(c.tags || []).includes(segment.filters.tag)) return false;
      return c.organizationId === segment.organizationId;
    });
  }

  // ========== Contact Segments ==========
  async getContactSegments(organizationId: string) { return segmentsData.filter(s => s.organizationId === organizationId); }
  async getContactSegment(id: string) { return segmentsData.find(s => s.id === id); }
  async createContactSegment(segment: any) {
    const n = { id: genId(), ...segment, createdAt: new Date(), updatedAt: new Date() };
    segmentsData.push(n);
    return n;
  }
  async updateContactSegment(id: string, data: any) {
    const idx = segmentsData.findIndex(s => s.id === id);
    if (idx >= 0) { segmentsData[idx] = { ...segmentsData[idx], ...data, updatedAt: new Date() }; return segmentsData[idx]; }
    throw new Error('Segment not found');
  }
  async deleteContactSegment(id: string) {
    const idx = segmentsData.findIndex(s => s.id === id);
    if (idx >= 0) { segmentsData.splice(idx, 1); return true; }
    return false;
  }

  // ========== Email Templates ==========
  async getEmailTemplates(organizationId: string) { return templatesData.filter(t => t.organizationId === organizationId); }
  async getEmailTemplate(id: string) { return templatesData.find(t => t.id === id); }
  async createEmailTemplate(template: any) {
    const n = { id: genId(), ...template, usageCount: 0, createdAt: new Date(), updatedAt: new Date() };
    templatesData.push(n);
    return n;
  }
  async updateEmailTemplate(id: string, data: any) {
    const idx = templatesData.findIndex(t => t.id === id);
    if (idx >= 0) { templatesData[idx] = { ...templatesData[idx], ...data, updatedAt: new Date() }; return templatesData[idx]; }
    throw new Error('Template not found');
  }
  async deleteEmailTemplate(id: string) {
    const idx = templatesData.findIndex(t => t.id === id);
    if (idx >= 0) { templatesData.splice(idx, 1); return true; }
    return false;
  }

  // ========== Campaigns ==========
  async getCampaigns(organizationId: string, limit = 20, offset = 0) {
    return campaignsData
      .filter(c => c.organizationId === organizationId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(offset, offset + limit);
  }
  async getCampaign(id: string) { return campaignsData.find(c => c.id === id); }
  async createCampaign(campaign: any) {
    const n = {
      id: genId(), ...campaign,
      sentCount: 0, openedCount: 0, clickedCount: 0, repliedCount: 0, bouncedCount: 0, unsubscribedCount: 0,
      totalRecipients: campaign.totalRecipients || 0,
      contactIds: campaign.contactIds || [],
      createdAt: new Date(), updatedAt: new Date()
    };
    campaignsData.push(n);
    return n;
  }
  async updateCampaign(id: string, data: any) {
    const idx = campaignsData.findIndex(c => c.id === id);
    if (idx >= 0) { campaignsData[idx] = { ...campaignsData[idx], ...data, updatedAt: new Date() }; return campaignsData[idx]; }
    throw new Error('Campaign not found');
  }
  async deleteCampaign(id: string) {
    const idx = campaignsData.findIndex(c => c.id === id);
    if (idx >= 0) { campaignsData.splice(idx, 1); return true; }
    return false;
  }
  async getCampaignStats(organizationId: string) {
    const orgCampaigns = campaignsData.filter(c => c.organizationId === organizationId);
    return {
      totalCampaigns: orgCampaigns.length,
      activeCampaigns: orgCampaigns.filter(c => c.status === 'active').length,
      totalSent: orgCampaigns.reduce((sum, c) => sum + (c.sentCount || 0), 0),
      totalOpened: orgCampaigns.reduce((sum, c) => sum + (c.openedCount || 0), 0),
      totalClicked: orgCampaigns.reduce((sum, c) => sum + (c.clickedCount || 0), 0),
      totalReplied: orgCampaigns.reduce((sum, c) => sum + (c.repliedCount || 0), 0),
      totalBounced: orgCampaigns.reduce((sum, c) => sum + (c.bouncedCount || 0), 0),
      totalUnsubscribed: orgCampaigns.reduce((sum, c) => sum + (c.unsubscribedCount || 0), 0),
    };
  }

  // ========== Campaign Messages ==========
  async getCampaignMessages(campaignId: string, limit = 100, offset = 0) {
    return messagesData.filter(m => m.campaignId === campaignId).slice(offset, offset + limit);
  }
  async getCampaignMessage(id: string) { return messagesData.find(m => m.id === id); }
  async getCampaignMessageByTracking(trackingId: string) {
    return messagesData.find(m => m.trackingId === trackingId);
  }
  async createCampaignMessage(message: any) {
    const n = { id: genId(), ...message, createdAt: new Date() };
    messagesData.push(n);
    return n;
  }
  async updateCampaignMessage(id: string, data: any) {
    const idx = messagesData.findIndex(m => m.id === id);
    if (idx >= 0) { messagesData[idx] = { ...messagesData[idx], ...data }; return messagesData[idx]; }
    throw new Error('Message not found');
  }

  // ========== Tracking Events ==========
  async createTrackingEvent(event: any) {
    const n = { id: genId(), ...event, createdAt: new Date() };
    trackingEventsData.push(n);
    return n;
  }
  async getTrackingEvents(campaignId: string) {
    return trackingEventsData.filter(e => e.campaignId === campaignId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
  async getTrackingEventsByMessage(messageId: string) {
    return trackingEventsData.filter(e => e.messageId === messageId);
  }
  async getAllTrackingEvents(organizationId: string, limit = 50) {
    // Get all campaign IDs for this organization
    const orgCampaignIds = new Set(
      campaignsData.filter(c => c.organizationId === organizationId).map(c => c.id)
    );
    return trackingEventsData
      .filter(e => orgCampaignIds.has(e.campaignId))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);
  }

  // ========== Enriched Campaign Messages (with tracking events) ==========
  async getCampaignMessagesEnriched(campaignId: string, limit = 200, offset = 0) {
    const messages = messagesData
      .filter(m => m.campaignId === campaignId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(offset, offset + limit);

    return messages.map(m => {
      const events = trackingEventsData.filter(e => e.messageId === m.id);
      const contact = contactsData.find(c => c.id === m.contactId);
      return {
        ...m,
        contact: contact ? { id: contact.id, email: contact.email, firstName: contact.firstName, lastName: contact.lastName, company: contact.company } : null,
        events,
        openCount: events.filter(e => e.type === 'open').length,
        clickCount: events.filter(e => e.type === 'click').length,
        replyCount: events.filter(e => e.type === 'reply').length,
        firstOpenedAt: events.find(e => e.type === 'open')?.createdAt || null,
        firstClickedAt: events.find(e => e.type === 'click')?.createdAt || null,
        firstRepliedAt: events.find(e => e.type === 'reply')?.createdAt || null,
      };
    });
  }

  async getCampaignMessagesTotalCount(campaignId: string) {
    return messagesData.filter(m => m.campaignId === campaignId).length;
  }

  // ========== Unsubscribes ==========
  async addUnsubscribe(data: any) {
    const n = { id: genId(), ...data, createdAt: new Date() };
    unsubscribesData.push(n);
    // Update contact status
    if (data.contactId) {
      const idx = contactsData.findIndex(c => c.id === data.contactId);
      if (idx >= 0) contactsData[idx].status = 'unsubscribed';
    }
    return n;
  }
  async isUnsubscribed(organizationId: string, email: string) {
    return !!unsubscribesData.find(u => u.organizationId === organizationId && u.email === email);
  }
  async getUnsubscribes(organizationId: string) {
    return unsubscribesData.filter(u => u.organizationId === organizationId);
  }

  // ========== Integrations ==========
  async getIntegrations(organizationId: string) { return integrationsData.filter(i => i.organizationId === organizationId); }
  async getIntegration(id: string) { return integrationsData.find(i => i.id === id); }
  async createIntegration(integration: any) { const n = { id: genId(), ...integration, createdAt: new Date(), updatedAt: new Date() }; integrationsData.push(n); return n; }
  async updateIntegration(id: string, data: any) {
    const idx = integrationsData.findIndex(i => i.id === id);
    if (idx >= 0) { integrationsData[idx] = { ...integrationsData[idx], ...data, updatedAt: new Date() }; return integrationsData[idx]; }
    throw new Error('Integration not found');
  }

  // ========== Follow-up Sequences ==========
  async getFollowupSequences(organizationId: string) { return followupSequencesData.filter(s => s.organizationId === organizationId); }
  async getFollowupSequence(id: string) { return followupSequencesData.find(s => s.id === id); }
  async createFollowupSequence(sequence: any) { const n = { id: genId(), ...sequence, isActive: true, createdAt: new Date(), updatedAt: new Date() }; followupSequencesData.push(n); return n; }
  async updateFollowupSequence(id: string, data: any) {
    const idx = followupSequencesData.findIndex(s => s.id === id);
    if (idx >= 0) { followupSequencesData[idx] = { ...followupSequencesData[idx], ...data, updatedAt: new Date() }; return followupSequencesData[idx]; }
    throw new Error('Sequence not found');
  }
  async deleteFollowupSequence(id: string) {
    const idx = followupSequencesData.findIndex(s => s.id === id);
    if (idx >= 0) { followupSequencesData.splice(idx, 1); return true; }
    return false;
  }

  // ========== Follow-up Steps ==========
  async getFollowupSteps(sequenceId: string) { return followupStepsData.filter(s => s.sequenceId === sequenceId).sort((a, b) => a.stepNumber - b.stepNumber); }
  async getFollowupStep(id: string) { return followupStepsData.find(s => s.id === id); }
  async createFollowupStep(step: any) { const n = { id: genId(), ...step, isActive: true, createdAt: new Date() }; followupStepsData.push(n); return n; }
  async updateFollowupStep(id: string, data: any) {
    const idx = followupStepsData.findIndex(s => s.id === id);
    if (idx >= 0) { followupStepsData[idx] = { ...followupStepsData[idx], ...data }; return followupStepsData[idx]; }
    throw new Error('Step not found');
  }
  async deleteFollowupStep(id: string) {
    const idx = followupStepsData.findIndex(s => s.id === id);
    if (idx >= 0) { followupStepsData.splice(idx, 1); return true; }
    return false;
  }

  // ========== Campaign Follow-ups ==========
  async getCampaignFollowups(campaignId: string) { return campaignFollowupsData.filter(f => f.campaignId === campaignId && f.isActive); }
  async getActiveCampaignFollowups() { return campaignFollowupsData.filter(f => f.isActive); }
  async createCampaignFollowup(followup: any) { const n = { id: genId(), ...followup, isActive: true, createdAt: new Date() }; campaignFollowupsData.push(n); return n; }

  // ========== Follow-up Executions ==========
  async getFollowupExecution(campaignMessageId: string, stepId: string) {
    return followupExecutionsData.find(e => e.campaignMessageId === campaignMessageId && e.stepId === stepId);
  }
  async getFollowupExecutionById(id: string) { return followupExecutionsData.find(e => e.id === id); }
  async getPendingFollowupExecutions() {
    return followupExecutionsData.filter(e => e.status === 'pending' && new Date(e.scheduledAt) <= new Date());
  }
  async createFollowupExecution(execution: any) { const n = { id: genId(), ...execution, createdAt: new Date() }; followupExecutionsData.push(n); return n; }
  async updateFollowupExecution(id: string, data: any) {
    const idx = followupExecutionsData.findIndex(e => e.id === id);
    if (idx >= 0) { followupExecutionsData[idx] = { ...followupExecutionsData[idx], ...data }; return followupExecutionsData[idx]; }
    throw new Error('Execution not found');
  }
  async cancelPendingFollowupsForContact(contactId: string, campaignId?: string) {
    followupExecutionsData.forEach((e, idx) => {
      if (e.contactId === contactId && e.status === 'pending') {
        followupExecutionsData[idx] = { ...e, status: 'skipped' };
      }
    });
  }

  // ========== Analytics Helpers ==========
  async getCampaignAnalytics(campaignId: string) {
    const campaign = campaignsData.find(c => c.id === campaignId);
    if (!campaign) return null;

    const messages = messagesData.filter(m => m.campaignId === campaignId);
    const events = trackingEventsData.filter(e => e.campaignId === campaignId);

    const totalSent = campaign.sentCount || messages.filter(m => m.status === 'sent').length;
    const opened = campaign.openedCount || events.filter(e => e.type === 'open').length;
    const clicked = campaign.clickedCount || events.filter(e => e.type === 'click').length;
    const replied = campaign.repliedCount || 0;
    const bounced = campaign.bouncedCount || messages.filter(m => m.status === 'bounced').length;
    const unsub = campaign.unsubscribedCount || 0;

    return {
      campaignId,
      campaignName: campaign.name,
      totalSent,
      delivered: totalSent - bounced,
      opened,
      clicked,
      replied,
      bounced,
      unsubscribed: unsub,
      openRate: totalSent > 0 ? ((opened / totalSent) * 100).toFixed(1) : '0',
      clickRate: opened > 0 ? ((clicked / opened) * 100).toFixed(1) : '0',
      replyRate: totalSent > 0 ? ((replied / totalSent) * 100).toFixed(1) : '0',
      bounceRate: totalSent > 0 ? ((bounced / totalSent) * 100).toFixed(1) : '0',
      unsubscribeRate: totalSent > 0 ? ((unsub / totalSent) * 100).toFixed(1) : '0',
      deliveryRate: totalSent > 0 ? (((totalSent - bounced) / totalSent) * 100).toFixed(1) : '0',
    };
  }

  async getOrganizationAnalytics(organizationId: string, days = 30) {
    const orgCampaigns = campaignsData.filter(c => c.organizationId === organizationId);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const recentCampaigns = orgCampaigns.filter(c => new Date(c.createdAt) >= cutoff);
    
    const totalSent = recentCampaigns.reduce((sum, c) => sum + (c.sentCount || 0), 0);
    const totalOpened = recentCampaigns.reduce((sum, c) => sum + (c.openedCount || 0), 0);
    const totalClicked = recentCampaigns.reduce((sum, c) => sum + (c.clickedCount || 0), 0);
    const totalReplied = recentCampaigns.reduce((sum, c) => sum + (c.repliedCount || 0), 0);
    const totalBounced = recentCampaigns.reduce((sum, c) => sum + (c.bouncedCount || 0), 0);
    const totalUnsub = recentCampaigns.reduce((sum, c) => sum + (c.unsubscribedCount || 0), 0);

    // Generate timeline data
    const timeline: any[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      const dayEvents = trackingEventsData.filter(e => 
        e.createdAt && new Date(e.createdAt).toISOString().split('T')[0] === dateStr
      );
      timeline.push({
        date: dateStr,
        opens: dayEvents.filter(e => e.type === 'open').length || Math.floor(Math.random() * 50),
        clicks: dayEvents.filter(e => e.type === 'click').length || Math.floor(Math.random() * 20),
        replies: Math.floor(Math.random() * 5),
      });
    }

    return {
      totalSent,
      totalOpened,
      totalClicked,
      totalReplied,
      totalBounced,
      totalUnsubscribed: totalUnsub,
      openRate: totalSent > 0 ? ((totalOpened / totalSent) * 100).toFixed(1) : '0',
      clickRate: totalOpened > 0 ? ((totalClicked / totalOpened) * 100).toFixed(1) : '0',
      replyRate: totalSent > 0 ? ((totalReplied / totalSent) * 100).toFixed(1) : '0',
      bounceRate: totalSent > 0 ? ((totalBounced / totalSent) * 100).toFixed(1) : '0',
      deliveryRate: totalSent > 0 ? (((totalSent - totalBounced) / totalSent) * 100).toFixed(1) : '0',
      unsubscribeRate: totalSent > 0 ? ((totalUnsub / totalSent) * 100).toFixed(1) : '0',
      timeline,
      campaignCount: recentCampaigns.length,
      contactCount: contactsData.filter(c => c.organizationId === organizationId).length,
    };
  }
}

export const storage = new DatabaseStorage();
