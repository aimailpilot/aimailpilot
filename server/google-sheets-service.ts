import { google } from 'googleapis';

export class GoogleSheetsService {
  private sheets;

  constructor(accessToken?: string) {
    const auth = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    
    if (accessToken) {
      auth.setCredentials({ access_token: accessToken });
    }
    
    this.sheets = google.sheets({ version: 'v4', auth });
  }

  async getSpreadsheetInfo(spreadsheetId: string) {
    try {
      const response = await this.sheets.spreadsheets.get({
        spreadsheetId,
        fields: 'spreadsheetId,properties.title,sheets.properties'
      });

      return {
        id: response.data.spreadsheetId,
        title: response.data.properties?.title,
        sheets: response.data.sheets?.map(sheet => ({
          id: sheet.properties?.sheetId,
          name: sheet.properties?.title,
          index: sheet.properties?.index
        })) || []
      };
    } catch (error) {
      console.error('Error fetching spreadsheet info:', error);
      throw new Error('Failed to fetch spreadsheet information');
    }
  }

  async getSheetData(spreadsheetId: string, sheetName: string) {
    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId,
        range: sheetName,
        valueRenderOption: 'UNFORMATTED_VALUE',
        dateTimeRenderOption: 'FORMATTED_STRING'
      });

      return {
        range: response.data.range,
        values: response.data.values || [],
        headers: response.data.values?.[0] || []
      };
    } catch (error) {
      console.error('Error fetching sheet data:', error);
      throw new Error('Failed to fetch sheet data');
    }
  }

  // For demo/testing purposes - returns sample sheets that look real
  static getSampleSheetsData() {
    return {
      id: 'demo-spreadsheet',
      title: 'Demo Email List',
      sheets: [
        { id: 0, name: 'Contacts', index: 0 },
        { id: 1, name: 'Mailing List', index: 1 },
        { id: 2, name: 'Customers', index: 2 }
      ]
    };
  }

  static getSampleSheetData(sheetName: string) {
    const sampleData = {
      'Contacts': {
        range: 'Contacts!A1:D10',
        values: [
          ['Name', 'Email', 'Company', 'Status'],
          ['John Smith', 'john@example.com', 'Tech Corp', 'Active'],
          ['Jane Doe', 'jane@company.com', 'Business Inc', 'Active'],
          ['Mike Johnson', 'mike@startup.io', 'Startup LLC', 'Pending'],
          ['Sarah Wilson', 'sarah@enterprise.com', 'Enterprise Ltd', 'Active']
        ],
        headers: ['Name', 'Email', 'Company', 'Status']
      },
      'Mailing List': {
        range: 'Mailing List!A1:C15',
        values: [
          ['First Name', 'Last Name', 'Email'],
          ['John', 'Smith', 'john@example.com'],
          ['Jane', 'Doe', 'jane@company.com'],
          ['Mike', 'Johnson', 'mike@startup.io']
        ],
        headers: ['First Name', 'Last Name', 'Email']
      },
      'Customers': {
        range: 'Customers!A1:E8',
        values: [
          ['Customer ID', 'Name', 'Email', 'Plan', 'Last Active'],
          ['001', 'John Smith', 'john@example.com', 'Premium', '2024-01-15'],
          ['002', 'Jane Doe', 'jane@company.com', 'Basic', '2024-01-20'],
          ['003', 'Mike Johnson', 'mike@startup.io', 'Premium', '2024-01-18']
        ],
        headers: ['Customer ID', 'Name', 'Email', 'Plan', 'Last Active']
      }
    };

    return sampleData[sheetName as keyof typeof sampleData] || {
      range: `${sheetName}!A1:A1`,
      values: [['No data']],
      headers: ['No data']
    };
  }
}