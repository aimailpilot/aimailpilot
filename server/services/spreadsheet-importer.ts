import { google } from 'googleapis';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import { storage } from '../storage';

interface ImportedContact {
  email: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  jobTitle?: string;
  phoneNumber?: string;
  customFields?: Record<string, any>;
}

interface ImportResult {
  success: boolean;
  totalRows: number;
  importedCount: number;
  skippedCount: number;
  errors: Array<{ row: number; error: string }>;
  contacts: ImportedContact[];
}

export class SpreadsheetImporter {
  /**
   * Import contacts from Google Sheets
   */
  async importFromGoogleSheets(
    accessToken: string,
    spreadsheetId: string,
    range: string = 'A:Z',
    organizationId: string
  ): Promise<ImportResult> {
    try {
      const auth = new google.auth.OAuth2();
      auth.setCredentials({ access_token: accessToken });
      
      const sheets = google.sheets({ version: 'v4', auth });
      
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range,
      });

      const values = response.data.values;
      if (!values || values.length === 0) {
        return {
          success: false,
          totalRows: 0,
          importedCount: 0,
          skippedCount: 0,
          errors: [{ row: 0, error: 'No data found in spreadsheet' }],
          contacts: []
        };
      }

      return this.processSpreadsheetData(values, organizationId);
    } catch (error) {
      console.error('Google Sheets import error:', error);
      throw new Error('Failed to import from Google Sheets');
    }
  }

  /**
   * Import contacts from Excel file
   */
  async importFromExcel(
    fileBuffer: Buffer,
    organizationId: string,
    sheetName?: string
  ): Promise<ImportResult> {
    try {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(fileBuffer);
      
      // Use specified sheet or first sheet
      const worksheet = sheetName 
        ? workbook.getWorksheet(sheetName)
        : workbook.getWorksheet(1);
      
      if (!worksheet) {
        return {
          success: false,
          totalRows: 0,
          importedCount: 0,
          skippedCount: 0,
          errors: [{ row: 0, error: 'Worksheet not found' }],
          contacts: []
        };
      }

      const values: any[][] = [];
      worksheet.eachRow((row, rowNumber) => {
        const rowValues: any[] = [];
        row.eachCell((cell, colNumber) => {
          rowValues[colNumber - 1] = cell.value;
        });
        values.push(rowValues);
      });

      return this.processSpreadsheetData(values, organizationId);
    } catch (error) {
      console.error('Excel import error:', error);
      throw new Error('Failed to import from Excel file');
    }
  }

  /**
   * Import from CSV file
   */
  async importFromCSV(
    fileBuffer: Buffer,
    organizationId: string
  ): Promise<ImportResult> {
    try {
      const csvText = fileBuffer.toString('utf8');
      const lines = csvText.split('\n').filter(line => line.trim());
      
      const values = lines.map(line => {
        // Simple CSV parsing (handles basic cases)
        const cells = [];
        let current = '';
        let inQuotes = false;
        
        for (let i = 0; i < line.length; i++) {
          const char = line[i];
          if (char === '"') {
            inQuotes = !inQuotes;
          } else if (char === ',' && !inQuotes) {
            cells.push(current.trim());
            current = '';
          } else {
            current += char;
          }
        }
        cells.push(current.trim());
        return cells;
      });

      return this.processSpreadsheetData(values, organizationId);
    } catch (error) {
      console.error('CSV import error:', error);
      throw new Error('Failed to import from CSV file');
    }
  }

  /**
   * Process spreadsheet data and extract contacts
   */
  private async processSpreadsheetData(
    values: any[][],
    organizationId: string
  ): Promise<ImportResult> {
    if (values.length === 0) {
      return {
        success: false,
        totalRows: 0,
        importedCount: 0,
        skippedCount: 0,
        errors: [],
        contacts: []
      };
    }

    // Assume first row contains headers
    const headers = values[0].map((h: any) => 
      h ? h.toString().toLowerCase().trim().replace(/\s+/g, '_') : ''
    );
    
    const contacts: ImportedContact[] = [];
    const errors: Array<{ row: number; error: string }> = [];
    let importedCount = 0;
    let skippedCount = 0;

    // Map common header variations
    const headerMappings: Record<string, string> = {
      'email_address': 'email',
      'e-mail': 'email',
      'email_addr': 'email',
      'first_name': 'firstName',
      'firstname': 'firstName',
      'fname': 'firstName',
      'last_name': 'lastName',
      'lastname': 'lastName',
      'lname': 'lastName',
      'full_name': 'fullName',
      'company_name': 'company',
      'organization': 'company',
      'org': 'company',
      'job_title': 'jobTitle',
      'title': 'jobTitle',
      'position': 'jobTitle',
      'phone_number': 'phoneNumber',
      'phone': 'phoneNumber',
      'tel': 'phoneNumber',
      'mobile': 'phoneNumber'
    };

    for (let i = 1; i < values.length; i++) {
      const row = values[i];
      const contact: ImportedContact = {
        email: '',
        customFields: {}
      };

      let hasEmail = false;

      headers.forEach((header, index) => {
        const value = row[index] ? row[index].toString().trim() : '';
        if (!value) return;

        // Map header to standard field name
        const mappedHeader = headerMappings[header] || header;

        switch (mappedHeader) {
          case 'email':
            if (this.isValidEmail(value)) {
              contact.email = value;
              hasEmail = true;
            }
            break;
          case 'firstName':
            contact.firstName = value;
            break;
          case 'lastName':
            contact.lastName = value;
            break;
          case 'fullName':
            // Split full name into first and last
            const nameParts = value.split(' ');
            contact.firstName = nameParts[0];
            if (nameParts.length > 1) {
              contact.lastName = nameParts.slice(1).join(' ');
            }
            break;
          case 'company':
            contact.company = value;
            break;
          case 'jobTitle':
            contact.jobTitle = value;
            break;
          case 'phoneNumber':
            contact.phoneNumber = value;
            break;
          default:
            // Store as custom field
            if (contact.customFields) {
              contact.customFields[mappedHeader] = value;
            }
            break;
        }
      });

      if (!hasEmail) {
        errors.push({ row: i + 1, error: 'No valid email address found' });
        skippedCount++;
        continue;
      }

      // Check if contact already exists
      const existingContact = await storage.getContactByEmail(organizationId, contact.email);
      if (existingContact) {
        errors.push({ row: i + 1, error: 'Contact already exists' });
        skippedCount++;
        continue;
      }

      contacts.push(contact);
      importedCount++;
    }

    // Save contacts to database
    const savedContacts = [];
    for (const contact of contacts) {
      try {
        const savedContact = await storage.createContact({
          organizationId,
          email: contact.email,
          firstName: contact.firstName,
          lastName: contact.lastName,
          company: contact.company,
          jobTitle: contact.jobTitle,
          phoneNumber: contact.phoneNumber,
          customFields: contact.customFields || {},
          source: 'import',
          status: 'cold'
        });
        savedContacts.push(savedContact);
      } catch (error) {
        console.error(`Failed to save contact ${contact.email}:`, error);
        errors.push({ row: 0, error: `Failed to save contact: ${contact.email}` });
        importedCount--;
        skippedCount++;
      }
    }

    return {
      success: true,
      totalRows: values.length - 1, // Exclude header row
      importedCount,
      skippedCount,
      errors,
      contacts: savedContacts.map(contact => ({
        email: contact.email,
        firstName: contact.firstName || undefined,
        lastName: contact.lastName || undefined,
        company: contact.company || undefined,
        jobTitle: contact.jobTitle || undefined,
        phoneNumber: contact.phoneNumber || undefined,
        customFields: contact.customFields as Record<string, any> || undefined
      }))
    };
  }

  /**
   * Validate email address
   */
  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Get available sheets from Google Sheets
   */
  async getGoogleSheetsInfo(
    accessToken: string,
    spreadsheetId: string
  ): Promise<{
    title: string;
    sheets: Array<{ name: string; id: number; gridProperties: any }>;
  }> {
    try {
      const auth = new google.auth.OAuth2();
      auth.setCredentials({ access_token: accessToken });
      
      const sheets = google.sheets({ version: 'v4', auth });
      
      const response = await sheets.spreadsheets.get({
        spreadsheetId,
        includeGridData: false
      });

      const spreadsheet = response.data;
      
      return {
        title: spreadsheet.properties?.title || 'Untitled Spreadsheet',
        sheets: (spreadsheet.sheets || []).map(sheet => ({
          name: sheet.properties?.title || 'Untitled Sheet',
          id: sheet.properties?.sheetId || 0,
          gridProperties: sheet.properties?.gridProperties || {}
        }))
      };
    } catch (error) {
      console.error('Error getting Google Sheets info:', error);
      throw new Error('Failed to get spreadsheet information');
    }
  }

  /**
   * Get preview of spreadsheet data
   */
  async previewSpreadsheetData(
    source: 'googlesheets' | 'excel' | 'csv',
    data: { accessToken?: string; spreadsheetId?: string; fileBuffer?: Buffer; range?: string },
    rows: number = 5
  ): Promise<{
    headers: string[];
    preview: any[][];
    totalRows: number;
  }> {
    let values: any[][] = [];

    switch (source) {
      case 'googlesheets':
        if (!data.accessToken || !data.spreadsheetId) {
          throw new Error('Missing access token or spreadsheet ID');
        }
        const sheetsResult = await this.importFromGoogleSheets(
          data.accessToken,
          data.spreadsheetId,
          data.range || 'A:Z',
          'preview' // dummy organization ID
        );
        // Convert contacts back to raw format for preview
        values = [
          ['email', 'firstName', 'lastName', 'company', 'jobTitle'],
          ...sheetsResult.contacts.map(c => [c.email, c.firstName, c.lastName, c.company, c.jobTitle])
        ];
        break;
      
      case 'excel':
        if (!data.fileBuffer) {
          throw new Error('Missing file buffer');
        }
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(data.fileBuffer);
        const worksheet = workbook.getWorksheet(1);
        if (worksheet) {
          worksheet.eachRow((row, rowNumber) => {
            if (rowNumber <= rows + 1) { // +1 for header
              const rowValues: any[] = [];
              row.eachCell((cell, colNumber) => {
                rowValues[colNumber - 1] = cell.value;
              });
              values.push(rowValues);
            }
          });
        }
        break;
      
      case 'csv':
        if (!data.fileBuffer) {
          throw new Error('Missing file buffer');
        }
        const csvText = data.fileBuffer.toString('utf8');
        const lines = csvText.split('\n').filter(line => line.trim()).slice(0, rows + 1);
        values = lines.map(line => line.split(',').map(cell => cell.trim()));
        break;
    }

    return {
      headers: values[0] || [],
      preview: values.slice(1, rows + 1),
      totalRows: values.length - 1
    };
  }
}

export default SpreadsheetImporter;