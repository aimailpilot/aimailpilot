import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import session from "express-session";
import cookieParser from "cookie-parser";
import MemoryStore from "memorystore";

// In-memory user store for simplified authentication
const loggedInUsers = new Set<string>();

// Simple auth middleware
const requireAuth = (req: any, res: any, next: any) => {
  const userId = req.cookies?.user_id || req.session?.userId;
  
  if (userId && loggedInUsers.has(userId)) {
    req.user = {
      id: userId,
      organizationId: '550e8400-e29b-41d4-a716-446655440001',
      role: 'admin'
    };
    next();
  } else {
    res.status(401).json({ error: 'Not authenticated' });
  }
};

export async function registerRoutes(app: Express): Promise<Server> {
  app.set('trust proxy', 1);

  // Cookie parser
  app.use(cookieParser());
  
  // Session configuration with memory store
  const MemStore = MemoryStore(session);
  
  app.use(session({
    store: new MemStore({ checkPeriod: 86400000 }),
    secret: process.env.SESSION_SECRET || 'mailflow-dev-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false,
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000,
      sameSite: 'lax'
    },
    name: 'connect.sid'
  }));

  // Simple login endpoint (auto-login for demo)
  app.post('/api/auth/simple-login', (req, res) => {
    const userId = 'user-123';
    const mockUser = {
      id: userId,
      email: 'demo@mailflow.app',
      name: 'Demo User',
      picture: '',
      provider: 'google',
      access_token: 'demo-token',
    };
    
    loggedInUsers.add(userId);
    
    res.cookie('user_id', userId, { maxAge: 7 * 24 * 60 * 60 * 1000, httpOnly: false, secure: false, sameSite: 'lax' });
    res.cookie('user_data', JSON.stringify(mockUser), { maxAge: 7 * 24 * 60 * 60 * 1000, httpOnly: false, secure: false, sameSite: 'lax' });
    
    (req.session as any).userId = userId;
    (req.session as any).user = mockUser;
    
    res.json({ success: true, user: mockUser });
  });

  // Google OAuth redirect (for demo, auto-login)
  app.get('/api/auth/google', (req, res) => {
    const userId = 'google-demo-user';
    const mockUser = {
      id: userId,
      email: 'demo@mailflow.app',
      name: 'Demo User',
      picture: '',
      provider: 'google',
      access_token: 'demo-google-token',
    };
    
    loggedInUsers.add(userId);
    
    res.cookie('user_id', userId, { maxAge: 7 * 24 * 60 * 60 * 1000, httpOnly: false, secure: false, sameSite: 'lax' });
    res.cookie('user_data', JSON.stringify(mockUser), { maxAge: 7 * 24 * 60 * 60 * 1000, httpOnly: false, secure: false, sameSite: 'lax' });
    
    (req.session as any).userId = userId;
    (req.session as any).user = mockUser;
    
    req.session.save(() => {
      res.redirect('/?connected=true');
    });
  });

  // Microsoft OAuth redirect (for demo)
  app.get('/api/auth/microsoft', (req, res) => {
    const userId = 'microsoft-demo-user';
    const mockUser = {
      id: userId,
      email: 'demo@mailflow.app',
      name: 'Demo User',
      picture: '',
      provider: 'microsoft',
      access_token: 'demo-ms-token',
    };
    
    loggedInUsers.add(userId);
    
    res.cookie('user_id', userId, { maxAge: 7 * 24 * 60 * 60 * 1000, httpOnly: false, secure: false, sameSite: 'lax' });
    res.cookie('user_data', JSON.stringify(mockUser), { maxAge: 7 * 24 * 60 * 60 * 1000, httpOnly: false, secure: false, sameSite: 'lax' });
    
    (req.session as any).userId = userId;
    (req.session as any).user = mockUser;
    
    req.session.save(() => {
      res.redirect('/?connected=true');
    });
  });

  // Google Sheets connection status
  app.get('/api/auth/google/status', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    const session = req.session as any;
    if (session?.user?.access_token) {
      return res.json({ connected: true, email: session.user.email, demo: true });
    }
    const userId = req.cookies?.user_id;
    if (userId && loggedInUsers.has(userId)) {
      return res.json({ connected: true, email: 'demo@mailflow.app', demo: true });
    }
    res.json({ connected: false });
  });

  // User info endpoint
  app.get('/api/auth/user', (req, res) => {
    const session = req.session as any;
    if (session?.user) {
      return res.json(session.user);
    }
    
    const userId = req.cookies?.user_id;
    const userData = req.cookies?.user_data;
    
    if (userId && loggedInUsers.has(userId) && userData) {
      try {
        const user = JSON.parse(userData);
        (req.session as any).userId = userId;
        (req.session as any).user = user;
        return res.json(user);
      } catch (err) { /* ignore parse errors */ }
    }
    
    res.status(401).json({ error: 'Not authenticated' });
  });

  // Logout endpoint
  app.post('/api/auth/logout', (req, res) => {
    const userId = req.cookies?.user_id || (req.session as any)?.userId;
    if (userId) loggedInUsers.delete(userId);
    
    res.clearCookie('user_id');
    res.clearCookie('user_data');
    res.clearCookie('connect.sid');
    
    if (req.session) {
      req.session.destroy(() => {});
    }
    
    res.json({ success: true });
  });

  // Test endpoint
  app.get('/api/test', (req, res) => {
    res.json({ message: 'MailFlow server is running!', timestamp: new Date().toISOString() });
  });

  // Apply auth middleware to protected routes
  app.use('/api/campaigns', requireAuth);
  app.use('/api/dashboard', requireAuth);
  app.use('/api/contacts', requireAuth);
  app.use('/api/templates', requireAuth);
  app.use('/api/analytics', requireAuth);
  app.use('/api/llm', requireAuth);
  app.use('/api/email-accounts', requireAuth);
  app.use('/api/integrations', requireAuth);
  app.use('/api/followup', requireAuth);

  // Dashboard APIs
  app.get('/api/dashboard/stats', async (req: any, res) => {
    try {
      const stats = await storage.getCampaignStats(req.user.organizationId);
      const openRate = stats.totalSent > 0 ? ((stats.totalOpened / stats.totalSent) * 100).toFixed(1) : '0';
      const clickRate = stats.totalOpened > 0 ? ((stats.totalClicked / stats.totalOpened) * 100).toFixed(1) : '0';
      const replyRate = stats.totalSent > 0 ? ((stats.totalReplied / stats.totalSent) * 100).toFixed(1) : '0';
      
      res.json({
        activeCampaigns: stats.activeCampaigns || 0,
        openRate: parseFloat(openRate as string),
        replyRate: parseFloat(replyRate as string),
        deliverability: 97.8,
        totalSent: stats.totalSent || 0,
        totalOpened: stats.totalOpened || 0,
        totalClicked: stats.totalClicked || 0,
        totalReplied: stats.totalReplied || 0,
      });
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch dashboard stats' });
    }
  });

  // Campaigns API
  app.get('/api/campaigns', async (req: any, res) => {
    try {
      const limit = parseInt(req.query.limit) || 20;
      const offset = parseInt(req.query.offset) || 0;
      const campaigns = await storage.getCampaigns(req.user.organizationId, limit, offset);
      res.json(campaigns);
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch campaigns' });
    }
  });

  app.get('/api/campaigns/:id', async (req: any, res) => {
    try {
      const campaign = await storage.getCampaign(req.params.id);
      if (!campaign) return res.status(404).json({ message: 'Campaign not found' });
      res.json(campaign);
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch campaign' });
    }
  });

  app.post('/api/campaigns', async (req: any, res) => {
    try {
      const campaign = await storage.createCampaign({
        ...req.body,
        organizationId: req.user.organizationId,
        createdBy: req.user.id,
      });
      res.status(201).json(campaign);
    } catch (error) {
      res.status(500).json({ message: 'Failed to create campaign' });
    }
  });

  // Contacts API
  app.get('/api/contacts', async (req: any, res) => {
    try {
      const limit = parseInt(req.query.limit) || 50;
      const offset = parseInt(req.query.offset) || 0;
      const search = req.query.search as string;
      
      let contacts;
      if (search) {
        contacts = await storage.searchContacts(req.user.organizationId, search);
      } else {
        contacts = await storage.getContacts(req.user.organizationId, limit, offset);
      }
      res.json(contacts);
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch contacts' });
    }
  });

  app.post('/api/contacts', async (req: any, res) => {
    try {
      const contact = await storage.createContact({
        ...req.body,
        organizationId: req.user.organizationId,
      });
      res.status(201).json(contact);
    } catch (error) {
      res.status(500).json({ message: 'Failed to create contact' });
    }
  });

  // Templates API
  app.get('/api/templates', async (req: any, res) => {
    try {
      const templates = await storage.getEmailTemplates(req.user.organizationId);
      res.json(templates);
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch templates' });
    }
  });

  app.post('/api/templates', async (req: any, res) => {
    try {
      const template = await storage.createEmailTemplate({
        ...req.body,
        organizationId: req.user.organizationId,
        createdBy: req.user.id,
      });
      res.status(201).json(template);
    } catch (error) {
      res.status(500).json({ message: 'Failed to create template' });
    }
  });

  // Account Information API
  app.get('/api/account/info', async (req: any, res) => {
    res.json({
      name: 'Demo User',
      email: 'demo@mailflow.app',
      quota: { used: 297, total: 500, resetsAt: 'Tomorrow at 05:36 PM' },
      billing: { plan: 'MailFlow Pro', isEducation: false, members: 'Invite teammates to join' }
    });
  });

  app.get('/api/account/senders', async (req: any, res) => {
    res.json([{ id: 1, name: 'Demo User', email: 'demo@mailflow.app', status: 'Active' }]);
  });

  app.post('/api/account/senders', async (req: any, res) => {
    res.status(201).json({ id: Date.now(), ...req.body, status: 'Pending', createdAt: new Date().toISOString() });
  });

  // Analytics API
  app.get('/api/analytics/:campaignId', async (req: any, res) => {
    res.json({
      campaignId: req.params.campaignId,
      totalSent: 850, delivered: 847, opened: 423, clicked: 187, replied: 45,
      unsubscribed: 8, bounced: 3,
      openRate: 49.9, clickRate: 44.2, replyRate: 10.6, unsubscribeRate: 1.9, bounceRate: 0.4,
      timeData: [
        { date: '2025-01-01', opens: 85, clicks: 32, replies: 7 },
        { date: '2025-01-02', opens: 124, clicks: 54, replies: 12 },
        { date: '2025-01-03', opens: 98, clicks: 38, replies: 8 },
        { date: '2025-01-04', opens: 156, clicks: 67, replies: 18 },
        { date: '2025-01-05', opens: 143, clicks: 59, replies: 14 },
      ]
    });
  });

  // Email Accounts API
  app.get('/api/email-accounts', async (req: any, res) => {
    const userId = req.cookies?.user_id;
    const userData = req.cookies?.user_data;
    if (userId && loggedInUsers.has(userId) && userData) {
      try {
        const user = JSON.parse(userData);
        return res.json([{ id: '1', email: user.email, name: user.name, provider: user.provider, status: 'active', isDefault: true }]);
      } catch (e) { /* ignore */ }
    }
    const accounts = await storage.getEmailAccounts(req.user.organizationId);
    res.json(accounts);
  });

  // Integrations API
  app.get('/api/integrations', async (req: any, res) => {
    const integrations = await storage.getIntegrations(req.user.organizationId);
    res.json(integrations);
  });

  // Personalization APIs
  app.get("/api/personalization/variables", (req, res) => {
    res.json([
      { name: 'firstName', label: 'First Name', category: 'contact' },
      { name: 'lastName', label: 'Last Name', category: 'contact' },
      { name: 'email', label: 'Email', category: 'contact' },
      { name: 'company', label: 'Company', category: 'contact' },
      { name: 'jobTitle', label: 'Job Title', category: 'contact' },
      { name: 'senderName', label: 'Sender Name', category: 'sender' },
      { name: 'senderEmail', label: 'Sender Email', category: 'sender' },
    ]);
  });

  app.post("/api/personalization/validate", (req, res) => {
    const { template } = req.body;
    const variables = (template || '').match(/\{\{(\w+)\}\}/g) || [];
    res.json({ valid: true, variables: variables.map((v: string) => v.replace(/[{}]/g, '')) });
  });

  // Follow-up Sequences API
  app.get('/api/followup-sequences', async (req: any, res) => {
    const sequences = await storage.getFollowupSequences(req.user.organizationId);
    res.json(sequences);
  });

  app.post('/api/followup-sequences', async (req: any, res) => {
    const sequence = await storage.createFollowupSequence({
      ...req.body,
      organizationId: req.user.organizationId,
      createdBy: req.user.id,
    });
    res.status(201).json(sequence);
  });

  // Google Sheets mock endpoints
  app.get('/api/sheets/info/:spreadsheetId', (req, res) => {
    res.json({
      id: req.params.spreadsheetId,
      title: 'Customer Email List',
      sheets: [
        { id: 0, name: 'Contacts', index: 0 },
        { id: 1, name: 'Leads', index: 1 },
      ]
    });
  });

  app.post('/api/sheets/preview', (req, res) => {
    const { sheetName } = req.body;
    res.json({
      range: `${sheetName}!A1:D10`,
      values: [
        ['Name', 'Email', 'Company', 'Status'],
        ['John Smith', 'john@example.com', 'Tech Corp', 'Active'],
        ['Jane Doe', 'jane@company.com', 'Business Inc', 'Active'],
        ['Mike Johnson', 'mike@startup.io', 'Startup LLC', 'Pending'],
      ],
      headers: ['Name', 'Email', 'Company', 'Status']
    });
  });

  // LLM mock endpoint
  app.post('/api/llm/generate', (req: any, res) => {
    const { prompt } = req.body;
    res.json({
      content: `Here's a professionally crafted email based on your request:\n\nSubject: Quick Follow-up\n\nHi {{firstName}},\n\nI hope this message finds you well. I wanted to reach out regarding ${prompt || 'our recent discussion'}.\n\nI'd love to schedule a quick call to discuss further. Would you have 15 minutes this week?\n\nBest regards,\nThe MailFlow Team`,
      model: 'demo',
      tokens: 150
    });
  });

  app.get('/api/llm-configs', async (req: any, res) => {
    const configs = await storage.getLlmConfigurations(req.user.organizationId);
    res.json(configs);
  });

  const httpServer = createServer(app);
  return httpServer;
}
