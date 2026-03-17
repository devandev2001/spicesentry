const express = require('express');
const { google } = require('googleapis');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const port = 3001;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Google Sheets Auth Setup
const auth = new google.auth.GoogleAuth({
  keyFile: path.join(__dirname, 'service-account.json'), // Path to your downloaded JSON key
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });

// The ID of your Google Sheet
const SPREADSHEET_ID = '1H_4Br3r1RePxAahV4RixHzsmVjSHqhQuT4JG-mXhPe8'; 

app.post('/api/add-entry', async (req, res) => {
  try {
    const { date, type, qty, price, totalValue, loadId, id, shop } = req.body;
    
    // Format the incoming date string to match sheets
    const formattedDate = new Date(date).toLocaleString('en-IN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false // 24 hour format for consistency
    }).replace(',', '');


    const response = await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Sheet1!A:H', // Appends to the first empty row in columns A through H
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [
          [formattedDate, type, qty, price, totalValue, loadId, id, shop]
        ],
      },
    });

    console.log(`Row inserted successfully. Updated Range: ${response.data.updates.updatedRange}`);
    res.status(200).json({ success: true, message: 'Row added!', data: response.data });
  } catch (error) {
    console.error('Error adding to Google Sheets:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.listen(port, () => {
  console.log(`Backend server running at http://localhost:${port}`);
});
