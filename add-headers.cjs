const { google } = require('googleapis');
const path = require('path');

async function setHeaders() {
  const auth = new google.auth.GoogleAuth({
    keyFile: path.join(__dirname, 'service-account.json'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const sheets = google.sheets({ version: 'v4', auth });
  const SPREADSHEET_ID = '1H_4Br3r1RePxAahV4RixHzsmVjSHqhQuT4JG-mXhPe8'; 

  try {
    const response = await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Sheet1!A1:H1', // Set headers on the very first row
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [
          ['Date', 'Type', 'Quantity (Kg)', 'Price (₹/Kg)', 'Total Value (₹)', 'Load ID', 'Record ID', 'Shop']
        ],
      },
    });
    
    // Also make the header row bold and optionally set background
    const boldRequest = {
      requests: [
        {
          repeatCell: {
            range: {
              sheetId: 0, // Assuming Sheet1 is the first sheet (ID 0)
              startRowIndex: 0,
              endRowIndex: 1,
              startColumnIndex: 0,
              endColumnIndex: 8
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.2, green: 0.2, blue: 0.2 },
                textFormat: { bold: true, foregroundColor: { red: 1.0, green: 1.0, blue: 1.0 } }
              }
            },
            fields: 'userEnteredFormat(backgroundColor,textFormat)'
          }
        }
      ]
    };
    
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: boldRequest
    });

    console.log('Successfully added formatted headers to the sheet!');
  } catch (error) {
    console.error('Error setting headers:', error);
  }
}

setHeaders();
