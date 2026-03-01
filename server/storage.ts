// In-memory storage - no database required
import { v4 as uuidv4 } from "crypto";

function genId() {
  return crypto.randomUUID();
}

// In-memory data stores
const orgs: any[] = [
  { id: '550e8400-e29b-41d4-a716-446655440001', name: 'MailFlow Organization', domain: 'mailflow.app', settings: {}, createdAt: new Date(), updatedAt: new Date() }
];

const usersData: any[] = [
  { id: 'user-123', email: 'demo@mailflow.app', firstName: 'Demo', lastName: 'User', role: 'admin', organizationId: '550e8400-e29b-41d4-a716-446655440001', isActive: true, createdAt: new Date(), updatedAt: new Date() }
];

const emailAccountsData: any[] = [];
const llmConfigsData: any[] = [];
const contactsData: any[] = [
  { id: genId(), organizationId: '550e8400-e29b-41d4-a716-446655440001', email: 'john@techcorp.com', firstName: 'John', lastName: 'Smith', company: 'Tech Corp', jobTitle: 'CTO', status: 'warm', score: 75, tags: ['tech', 'enterprise'], customFields: {}, source: 'linkedin', createdAt: new Date(), updatedAt: new Date() },
  { id: genId(), organizationId: '550e8400-e29b-41d4-a716-446655440001', email: 'jane@startup.io', firstName: 'Jane', lastName: 'Doe', company: 'Startup IO', jobTitle: 'CEO', status: 'hot', score: 92, tags: ['startup', 'saas'], customFields: {}, source: 'referral', createdAt: new Date(), updatedAt: new Date() },
  { id: genId(), organizationId: '550e8400-e29b-41d4-a716-446655440001', email: 'mike@enterprise.com', firstName: 'Mike', lastName: 'Johnson', company: 'Enterprise Ltd', jobTitle: 'VP Sales', status: 'cold', score: 30, tags: ['enterprise'], customFields: {}, source: 'cold-outreach', createdAt: new Date(), updatedAt: new Date() },
  { id: genId(), organizationId: '550e8400-e29b-41d4-a716-446655440001', email: 'sarah@consulting.com', firstName: 'Sarah', lastName: 'Wilson', company: 'Consulting Group', jobTitle: 'Director', status: 'warm', score: 65, tags: ['consulting'], customFields: {}, source: 'website', createdAt: new Date(), updatedAt: new Date() },
  { id: genId(), organizationId: '550e8400-e29b-41d4-a716-446655440001', email: 'david@agency.co', firstName: 'David', lastName: 'Brown', company: 'Creative Agency', jobTitle: 'Marketing Lead', status: 'replied', score: 88, tags: ['agency', 'marketing'], customFields: {}, source: 'event', createdAt: new Date(), updatedAt: new Date() },
];

const segmentsData: any[] = [];

const templatesData: any[] = [
  { id: genId(), organizationId: '550e8400-e29b-41d4-a716-446655440001', name: 'Welcome Email', category: 'onboarding', subject: 'Welcome to {{company}}!', content: '<p>Hi {{firstName}},</p><p>Welcome aboard! We are thrilled to have you join us.</p><p>Best regards,<br/>The Team</p>', variables: ['firstName', 'company'], isPublic: false, usageCount: 45, createdAt: new Date('2025-09-01'), updatedAt: new Date('2025-09-01') },
  { id: genId(), organizationId: '550e8400-e29b-41d4-a716-446655440001', name: 'Follow-up Template', category: 'follow-up', subject: 'Quick follow-up - {{topic}}', content: '<p>Hi {{firstName}},</p><p>Just wanted to follow up on our previous conversation about {{topic}}.</p><p>Would you have time for a quick call this week?</p>', variables: ['firstName', 'topic'], isPublic: false, usageCount: 23, createdAt: new Date('2025-08-28'), updatedAt: new Date('2025-08-28') },
  { id: genId(), organizationId: '550e8400-e29b-41d4-a716-446655440001', name: 'Product Launch Announcement', category: 'marketing', subject: 'Introducing {{productName}} - You will love this!', content: '<p>Hi {{firstName}},</p><p>We are excited to announce the launch of {{productName}}!</p><p>Check it out and let us know what you think.</p>', variables: ['firstName', 'productName'], isPublic: true, usageCount: 67, createdAt: new Date('2025-08-25'), updatedAt: new Date('2025-08-25') },
];

const campaignsData: any[] = [
  { id: genId(), organizationId: '550e8400-e29b-41d4-a716-446655440001', name: 'Q4 Product Launch', description: 'New feature announcement', status: 'active', totalRecipients: 1250, sentCount: 1180, openedCount: 720, clickedCount: 345, repliedCount: 89, bouncedCount: 12, unsubscribedCount: 5, createdAt: new Date('2025-08-15'), updatedAt: new Date() },
  { id: genId(), organizationId: '550e8400-e29b-41d4-a716-446655440001', name: 'Customer Onboarding Series', description: 'Welcome email sequence', status: 'active', totalRecipients: 450, sentCount: 430, openedCount: 312, clickedCount: 156, repliedCount: 42, bouncedCount: 3, unsubscribedCount: 2, createdAt: new Date('2025-08-20'), updatedAt: new Date() },
  { id: genId(), organizationId: '550e8400-e29b-41d4-a716-446655440001', name: 'Re-engagement Campaign', description: 'Win back inactive users', status: 'scheduled', totalRecipients: 890, sentCount: 0, openedCount: 0, clickedCount: 0, repliedCount: 0, bouncedCount: 0, unsubscribedCount: 0, createdAt: new Date('2025-09-01'), updatedAt: new Date() },
  { id: genId(), organizationId: '550e8400-e29b-41d4-a716-446655440001', name: 'Newsletter - August', description: 'Monthly newsletter', status: 'completed', totalRecipients: 2400, sentCount: 2380, openedCount: 1450, clickedCount: 678, repliedCount: 120, bouncedCount: 20, unsubscribedCount: 15, createdAt: new Date('2025-08-01'), updatedAt: new Date('2025-08-30') },
  { id: genId(), organizationId: '550e8400-e29b-41d4-a716-446655440001', name: 'Cold Outreach - Tech', description: 'Tech industry outreach', status: 'draft', totalRecipients: 0, sentCount: 0, openedCount: 0, clickedCount: 0, repliedCount: 0, bouncedCount: 0, unsubscribedCount: 0, createdAt: new Date('2025-09-02'), updatedAt: new Date() },
];

const messagesData: any[] = [];
const integrationsData: any[] = [];
const followupSequencesData: any[] = [];
const followupStepsData: any[] = [];
const campaignFollowupsData: any[] = [];
const followupExecutionsData: any[] = [];

export class DatabaseStorage {
  // Organization operations
  async getOrganization(id: string) {
    return orgs.find(o => o.id === id);
  }

  async createOrganization(org: any) {
    const newOrg = { id: genId(), ...org, createdAt: new Date(), updatedAt: new Date() };
    orgs.push(newOrg);
    return newOrg;
  }

  // User operations
  async getUser(id: string) {
    return usersData.find(u => u.id === id);
  }

  async getUserByEmail(email: string) {
    return usersData.find(u => u.email === email);
  }

  async createUser(user: any) {
    const newUser = { id: genId(), ...user, createdAt: new Date(), updatedAt: new Date() };
    usersData.push(newUser);
    return newUser;
  }

  async updateUser(id: string, data: any) {
    const idx = usersData.findIndex(u => u.id === id);
    if (idx >= 0) { usersData[idx] = { ...usersData[idx], ...data, updatedAt: new Date() }; return usersData[idx]; }
    throw new Error('User not found');
  }

  // Email Account operations
  async getEmailAccounts(organizationId: string) {
    return emailAccountsData.filter(a => a.organizationId === organizationId);
  }

  async getEmailAccount(id: string) {
    return emailAccountsData.find(a => a.id === id);
  }

  async createEmailAccount(account: any) {
    const newAccount = { id: genId(), ...account, createdAt: new Date() };
    emailAccountsData.push(newAccount);
    return newAccount;
  }

  async updateEmailAccount(id: string, data: any) {
    const idx = emailAccountsData.findIndex(a => a.id === id);
    if (idx >= 0) { emailAccountsData[idx] = { ...emailAccountsData[idx], ...data }; return emailAccountsData[idx]; }
    throw new Error('Email account not found');
  }

  // LLM Configuration operations
  async getLlmConfigurations(organizationId: string) {
    return llmConfigsData.filter(c => c.organizationId === organizationId);
  }

  async getPrimaryLlmConfiguration(organizationId: string) {
    return llmConfigsData.find(c => c.organizationId === organizationId && c.isPrimary && c.isActive);
  }

  async createLlmConfiguration(config: any) {
    const newConfig = { id: genId(), ...config, createdAt: new Date() };
    llmConfigsData.push(newConfig);
    return newConfig;
  }

  async updateLlmConfiguration(id: string, data: any) {
    const idx = llmConfigsData.findIndex(c => c.id === id);
    if (idx >= 0) { llmConfigsData[idx] = { ...llmConfigsData[idx], ...data }; return llmConfigsData[idx]; }
    throw new Error('LLM config not found');
  }

  // Contact operations
  async getContacts(organizationId: string, limit = 50, offset = 0) {
    return contactsData.filter(c => c.organizationId === organizationId).slice(offset, offset + limit);
  }

  async getContact(id: string) {
    return contactsData.find(c => c.id === id);
  }

  async getContactByEmail(organizationId: string, email: string) {
    return contactsData.find(c => c.organizationId === organizationId && c.email === email);
  }

  async createContact(contact: any) {
    const newContact = { id: genId(), ...contact, createdAt: new Date(), updatedAt: new Date() };
    contactsData.push(newContact);
    return newContact;
  }

  async updateContact(id: string, data: any) {
    const idx = contactsData.findIndex(c => c.id === id);
    if (idx >= 0) { contactsData[idx] = { ...contactsData[idx], ...data, updatedAt: new Date() }; return contactsData[idx]; }
    throw new Error('Contact not found');
  }

  async searchContacts(organizationId: string, query: string) {
    const q = query.toLowerCase();
    return contactsData.filter(c => c.organizationId === organizationId && (
      (c.firstName || '').toLowerCase().includes(q) ||
      (c.lastName || '').toLowerCase().includes(q) ||
      c.email.toLowerCase().includes(q) ||
      (c.company || '').toLowerCase().includes(q)
    )).slice(0, 20);
  }

  // Contact Segment operations
  async getContactSegments(organizationId: string) {
    return segmentsData.filter(s => s.organizationId === organizationId);
  }

  async getContactSegment(id: string) {
    return segmentsData.find(s => s.id === id);
  }

  async createContactSegment(segment: any) {
    const newSegment = { id: genId(), ...segment, createdAt: new Date(), updatedAt: new Date() };
    segmentsData.push(newSegment);
    return newSegment;
  }

  // Email Template operations
  async getEmailTemplates(organizationId: string) {
    return templatesData.filter(t => t.organizationId === organizationId);
  }

  async getEmailTemplate(id: string) {
    return templatesData.find(t => t.id === id);
  }

  async createEmailTemplate(template: any) {
    const newTemplate = { id: genId(), ...template, createdAt: new Date(), updatedAt: new Date() };
    templatesData.push(newTemplate);
    return newTemplate;
  }

  async updateEmailTemplate(id: string, data: any) {
    const idx = templatesData.findIndex(t => t.id === id);
    if (idx >= 0) { templatesData[idx] = { ...templatesData[idx], ...data, updatedAt: new Date() }; return templatesData[idx]; }
    throw new Error('Template not found');
  }

  // Campaign operations
  async getCampaigns(organizationId: string, limit = 20, offset = 0) {
    return campaignsData
      .filter(c => c.organizationId === organizationId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(offset, offset + limit);
  }

  async getCampaign(id: string) {
    return campaignsData.find(c => c.id === id);
  }

  async createCampaign(campaign: any) {
    const newCampaign = { id: genId(), ...campaign, sentCount: 0, openedCount: 0, clickedCount: 0, repliedCount: 0, bouncedCount: 0, unsubscribedCount: 0, createdAt: new Date(), updatedAt: new Date() };
    campaignsData.push(newCampaign);
    return newCampaign;
  }

  async updateCampaign(id: string, data: any) {
    const idx = campaignsData.findIndex(c => c.id === id);
    if (idx >= 0) { campaignsData[idx] = { ...campaignsData[idx], ...data, updatedAt: new Date() }; return campaignsData[idx]; }
    throw new Error('Campaign not found');
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
    };
  }

  // Campaign Message operations
  async getCampaignMessages(campaignId: string) {
    return messagesData.filter(m => m.campaignId === campaignId);
  }

  async getCampaignMessage(id: string) {
    return messagesData.find(m => m.id === id);
  }

  async createCampaignMessage(message: any) {
    const newMessage = { id: genId(), ...message, createdAt: new Date() };
    messagesData.push(newMessage);
    return newMessage;
  }

  async updateCampaignMessage(id: string, data: any) {
    const idx = messagesData.findIndex(m => m.id === id);
    if (idx >= 0) { messagesData[idx] = { ...messagesData[idx], ...data }; return messagesData[idx]; }
    throw new Error('Message not found');
  }

  // Integration operations
  async getIntegrations(organizationId: string) {
    return integrationsData.filter(i => i.organizationId === organizationId);
  }

  async getIntegration(id: string) {
    return integrationsData.find(i => i.id === id);
  }

  async createIntegration(integration: any) {
    const newIntegration = { id: genId(), ...integration, createdAt: new Date(), updatedAt: new Date() };
    integrationsData.push(newIntegration);
    return newIntegration;
  }

  async updateIntegration(id: string, data: any) {
    const idx = integrationsData.findIndex(i => i.id === id);
    if (idx >= 0) { integrationsData[idx] = { ...integrationsData[idx], ...data, updatedAt: new Date() }; return integrationsData[idx]; }
    throw new Error('Integration not found');
  }

  // Follow-up Sequence operations
  async getFollowupSequences(organizationId: string) {
    return followupSequencesData.filter(s => s.organizationId === organizationId);
  }

  async getFollowupSequence(id: string) {
    return followupSequencesData.find(s => s.id === id);
  }

  async createFollowupSequence(sequence: any) {
    const newSequence = { id: genId(), ...sequence, createdAt: new Date(), updatedAt: new Date() };
    followupSequencesData.push(newSequence);
    return newSequence;
  }

  async updateFollowupSequence(id: string, data: any) {
    const idx = followupSequencesData.findIndex(s => s.id === id);
    if (idx >= 0) { followupSequencesData[idx] = { ...followupSequencesData[idx], ...data, updatedAt: new Date() }; return followupSequencesData[idx]; }
    throw new Error('Sequence not found');
  }

  // Follow-up Step operations
  async getFollowupSteps(sequenceId: string) {
    return followupStepsData.filter(s => s.sequenceId === sequenceId).sort((a, b) => a.stepNumber - b.stepNumber);
  }

  async getFollowupStep(id: string) {
    return followupStepsData.find(s => s.id === id);
  }

  async createFollowupStep(step: any) {
    const newStep = { id: genId(), ...step, createdAt: new Date() };
    followupStepsData.push(newStep);
    return newStep;
  }

  async updateFollowupStep(id: string, data: any) {
    const idx = followupStepsData.findIndex(s => s.id === id);
    if (idx >= 0) { followupStepsData[idx] = { ...followupStepsData[idx], ...data }; return followupStepsData[idx]; }
    throw new Error('Step not found');
  }

  // Campaign Follow-up operations
  async getCampaignFollowups(campaignId: string) {
    return campaignFollowupsData.filter(f => f.campaignId === campaignId && f.isActive);
  }

  async getActiveCampaignFollowups() {
    return campaignFollowupsData.filter(f => f.isActive);
  }

  async createCampaignFollowup(followup: any) {
    const newFollowup = { id: genId(), ...followup, createdAt: new Date() };
    campaignFollowupsData.push(newFollowup);
    return newFollowup;
  }

  // Follow-up Execution operations
  async getFollowupExecution(campaignMessageId: string, stepId: string) {
    return followupExecutionsData.find(e => e.campaignMessageId === campaignMessageId && e.stepId === stepId);
  }

  async getFollowupExecutionById(id: string) {
    return followupExecutionsData.find(e => e.id === id);
  }

  async getPendingFollowupExecutions() {
    return followupExecutionsData.filter(e => e.status === 'pending' && new Date(e.scheduledAt) <= new Date());
  }

  async createFollowupExecution(execution: any) {
    const newExecution = { id: genId(), ...execution, createdAt: new Date() };
    followupExecutionsData.push(newExecution);
    return newExecution;
  }

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
}

export const storage = new DatabaseStorage();
