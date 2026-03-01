import { Router } from 'express';
import crypto from 'crypto';
import multer from 'multer';
import OAuthService from '../services/oauth-service';
import SpreadsheetImporter from '../services/spreadsheet-importer';
import { storage } from '../storage';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// Initialize OAuth service
const oauthService = new OAuthService({
  gmail: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    redirectUri: process.env.GMAIL_REDIRECT_URI || 'http://localhost:5000/api/oauth/gmail/callback'
  },
  outlook: {
    clientId: process.env.MICROSOFT_CLIENT_ID || '',
    clientSecret: process.env.MICROSOFT_CLIENT_SECRET || '',
    tenantId: process.env.MICROSOFT_TENANT_ID || 'common',
    redirectUri: process.env.OUTLOOK_REDIRECT_URI || 'http://localhost:5000/api/oauth/outlook/callback'
  }
});

const spreadsheetImporter = new SpreadsheetImporter();

/**
 * Gmail OAuth Routes
 */

// Initiate Gmail OAuth flow (Demo mode)
router.get('/gmail/auth/:organizationId', async (req, res) => {
  try {
    const { organizationId } = req.params;
    
    // For demo purposes, simulate successful Gmail connection
    // In production, this would redirect to actual Google OAuth
    const demoAccount = {
      id: crypto.randomUUID(),
      organizationId,
      provider: 'gmail' as const,
      email: 'demo@gmail.com',
      displayName: 'Demo Gmail Account',
      accessToken: 'demo_access_token',
      refreshToken: 'demo_refresh_token',
      tokenExpiresAt: new Date(Date.now() + 3600000), // 1 hour from now
      scope: 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly',
      credentials: {
        type: 'oauth2' as const,
        gmail: {
          clientId: 'demo_client_id',
          scopes: ['gmail.send', 'gmail.readonly']
        }
      },
      isVerified: true
    };
    
    // Store the demo account
    await storage.createEmailAccount(demoAccount);
    
    res.json({ 
      success: true,
      message: 'Gmail account connected successfully (Demo mode)',
      accountId: demoAccount.id,
      email: demoAccount.email
    });
  } catch (error) {
    console.error('Gmail auth initiation error:', error);
    res.status(500).json({ error: 'Failed to initiate Gmail authentication' });
  }
});

// Handle Gmail OAuth callback
router.get('/gmail/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;
    
    if (error) {
      return res.redirect(`/campaigns?error=${encodeURIComponent(error as string)}`);
    }
    
    if (!code || !state) {
      return res.redirect('/campaigns?error=missing_parameters');
    }
    
    // Extract organization ID from state
    const [stateToken, organizationId] = (state as string).split(':');
    
    if (!organizationId) {
      return res.redirect('/campaigns?error=invalid_state');
    }
    
    const result = await oauthService.exchangeGmailCode(code as string, organizationId);
    
    res.redirect(`/campaigns?gmail_connected=${result.accountId}&email=${encodeURIComponent(result.email)}`);
  } catch (error) {
    console.error('Gmail callback error:', error);
    res.redirect('/campaigns?error=gmail_auth_failed');
  }
});

/**
 * Outlook OAuth Routes
 */

// Initiate Outlook OAuth flow (Demo mode)
router.get('/outlook/auth/:organizationId', async (req, res) => {
  try {
    const { organizationId } = req.params;
    
    // For demo purposes, simulate successful Outlook connection
    const demoAccount = {
      id: crypto.randomUUID(),
      organizationId,
      provider: 'outlook' as const,
      email: 'demo@outlook.com',
      displayName: 'Demo Outlook Account',
      accessToken: 'demo_access_token',
      refreshToken: 'demo_refresh_token',
      tokenExpiresAt: new Date(Date.now() + 3600000), // 1 hour from now
      scope: 'https://graph.microsoft.com/mail.send https://graph.microsoft.com/mail.read',
      credentials: {
        type: 'oauth2' as const,
        outlook: {
          clientId: 'demo_client_id',
          scopes: ['mail.send', 'mail.read']
        }
      },
      isVerified: true
    };
    
    // Store the demo account
    await storage.createEmailAccount(demoAccount);
    
    res.json({ 
      success: true,
      message: 'Outlook account connected successfully (Demo mode)',
      accountId: demoAccount.id,
      email: demoAccount.email
    });
  } catch (error) {
    console.error('Outlook auth initiation error:', error);
    res.status(500).json({ error: 'Failed to initiate Outlook authentication' });
  }
});

// Handle Outlook OAuth callback
router.get('/outlook/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;
    
    if (error) {
      return res.redirect(`/campaigns?error=${encodeURIComponent(error as string)}`);
    }
    
    if (!code || !state) {
      return res.redirect('/campaigns?error=missing_parameters');
    }
    
    // Extract organization ID from state
    const [stateToken, organizationId] = (state as string).split(':');
    
    if (!organizationId) {
      return res.redirect('/campaigns?error=invalid_state');
    }
    
    const result = await oauthService.exchangeOutlookCode(code as string, organizationId);
    
    res.redirect(`/campaigns?outlook_connected=${result.accountId}&email=${encodeURIComponent(result.email)}`);
  } catch (error) {
    console.error('Outlook callback error:', error);
    res.redirect('/campaigns?error=outlook_auth_failed');
  }
});

/**
 * Account Management Routes
 */

// Test email account connection
router.post('/test-connection/:accountId', async (req, res) => {
  try {
    const { accountId } = req.params;
    const isConnected = await oauthService.testConnection(accountId);
    res.json({ connected: isConnected });
  } catch (error) {
    console.error('Connection test error:', error);
    res.status(500).json({ error: 'Failed to test connection' });
  }
});

// Revoke OAuth access
router.delete('/revoke/:accountId', async (req, res) => {
  try {
    const { accountId } = req.params;
    await oauthService.revokeAccess(accountId);
    res.json({ success: true });
  } catch (error) {
    console.error('Revoke access error:', error);
    res.status(500).json({ error: 'Failed to revoke access' });
  }
});

/**
 * Spreadsheet Import Routes
 */

// Import from Google Sheets
router.post('/import/googlesheets', async (req, res) => {
  try {
    const { accountId, spreadsheetId, range, organizationId } = req.body;
    
    if (!accountId || !spreadsheetId || !organizationId) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }
    
    const account = await storage.getEmailAccount(accountId);
    if (!account || account.provider !== 'gmail') {
      return res.status(400).json({ error: 'Invalid Gmail account' });
    }
    
    const accessToken = await oauthService.getValidAccessToken(account);
    const result = await spreadsheetImporter.importFromGoogleSheets(
      accessToken,
      spreadsheetId,
      range || 'A:Z',
      organizationId
    );
    
    res.json(result);
  } catch (error) {
    console.error('Google Sheets import error:', error);
    res.status(500).json({ error: 'Failed to import from Google Sheets' });
  }
});

// Import from Excel file
router.post('/import/excel', upload.single('file'), async (req, res) => {
  try {
    const { organizationId, sheetName } = req.body;
    
    if (!req.file || !organizationId) {
      return res.status(400).json({ error: 'Missing file or organization ID' });
    }
    
    const result = await spreadsheetImporter.importFromExcel(
      req.file.buffer,
      organizationId,
      sheetName
    );
    
    res.json(result);
  } catch (error) {
    console.error('Excel import error:', error);
    res.status(500).json({ error: 'Failed to import from Excel file' });
  }
});

// Import from CSV file
router.post('/import/csv', upload.single('file'), async (req, res) => {
  try {
    const { organizationId } = req.body;
    
    if (!req.file || !organizationId) {
      return res.status(400).json({ error: 'Missing file or organization ID' });
    }
    
    const result = await spreadsheetImporter.importFromCSV(
      req.file.buffer,
      organizationId
    );
    
    res.json(result);
  } catch (error) {
    console.error('CSV import error:', error);
    res.status(500).json({ error: 'Failed to import from CSV file' });
  }
});

// Get Google Sheets information
router.get('/googlesheets/:accountId/:spreadsheetId/info', async (req, res) => {
  try {
    const { accountId, spreadsheetId } = req.params;
    
    const account = await storage.getEmailAccount(accountId);
    if (!account || account.provider !== 'gmail') {
      return res.status(400).json({ error: 'Invalid Gmail account' });
    }
    
    const accessToken = await oauthService.getValidAccessToken(account);
    const info = await spreadsheetImporter.getGoogleSheetsInfo(accessToken, spreadsheetId);
    
    res.json(info);
  } catch (error) {
    console.error('Google Sheets info error:', error);
    res.status(500).json({ error: 'Failed to get spreadsheet information' });
  }
});

// Preview spreadsheet data
router.post('/preview', upload.single('file'), async (req, res) => {
  try {
    const { source, accountId, spreadsheetId, range } = req.body;
    
    let previewData;
    
    switch (source) {
      case 'googlesheets':
        if (!accountId || !spreadsheetId) {
          return res.status(400).json({ error: 'Missing account ID or spreadsheet ID' });
        }
        
        const account = await storage.getEmailAccount(accountId);
        if (!account) {
          return res.status(400).json({ error: 'Invalid account' });
        }
        
        const accessToken = await oauthService.getValidAccessToken(account);
        previewData = await spreadsheetImporter.previewSpreadsheetData(
          'googlesheets',
          { accessToken, spreadsheetId, range }
        );
        break;
        
      case 'excel':
      case 'csv':
        if (!req.file) {
          return res.status(400).json({ error: 'Missing file' });
        }
        
        previewData = await spreadsheetImporter.previewSpreadsheetData(
          source as 'excel' | 'csv',
          { fileBuffer: req.file.buffer }
        );
        break;
        
      default:
        return res.status(400).json({ error: 'Invalid source type' });
    }
    
    res.json(previewData);
  } catch (error) {
    console.error('Preview error:', error);
    res.status(500).json({ error: 'Failed to preview data' });
  }
});

export default router;