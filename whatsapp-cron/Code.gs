/**
 * WhatsApp Auto-Send — Daily Spice Summary at 10 PM IST
 * 
 * HOW TO SET UP:
 * 1. Open https://script.google.com → New project
 * 2. Paste this entire file into Code.gs
 * 3. Click Run → sendDailySummary (first time — grant permissions)
 * 4. Go to Triggers (clock icon) → Add Trigger:
 *    - Function: sendDailySummary
 *    - Event source: Time-driven
 *    - Type: Day timer
 *    - Time of day: 10pm to 11pm
 * 5. Save — done! It runs every day at 10 PM automatically.
 */

// ═══════════════════════════════════════════════════════════
// CONFIGURATION — fill these in
// ═══════════════════════════════════════════════════════════
const CONFIG = {
  // Your Google Sheet ID (already connected)
  SHEET_ID: '1H_4Br3r1RePxAahV4RixHzsmVjSHqhQuT4JG-mXhPe8',
  
  // WhatsApp Business API
  PHONE_NUMBER_ID: '1011310968737351',
  ACCESS_TOKEN: 'EAAR8U9VwhvYBRPZA1pD3pE2nzZCqNl5bjfFj3ZC4WSZA2UIyzIWEt5xoNiZAv8CJWA9MZCXbzXed1dPkKyPj30PJ3zZAZC8BxRDAi2o9uX4NMXlifFnoakOHpg2bIz9m3dLUcMSGgITK3UVjZCPvasS0Ujj1pvlRwhcbUxL4JZA7ZAOeyg4C4pOBD8yJK61cIvdh4XE7gZDZD',
  
  // Recipient phone number (with country code, no + or spaces)
  RECIPIENT: '919946182774',
  
  // Shop names
  SHOPS: ['20 Acre', 'Anachal', 'Kallar'],
  
  // Spice labels
  SPICE_LABELS: {
    'cardamom': 'Cardamom',
    'pepper': 'Pepper',
    'nutmeg': 'Nutmeg',
    'nutmeg_mace': 'Nutmeg Mace',
    'coffee': 'Coffee',
    'clove': 'Clove'
  }
};

// ═══════════════════════════════════════════════════════════
// MAIN FUNCTION — triggered daily at 10 PM
// ═══════════════════════════════════════════════════════════
function sendDailySummary() {
  const today = new Date();
  const dateStr = Utilities.formatDate(today, 'Asia/Kolkata', 'yyyy-MM-dd');
  const displayDate = Utilities.formatDate(today, 'Asia/Kolkata', 'dd MMM yyyy');
  
  // ── Read purchases ──
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const purchaseSheet = ss.getSheetByName('Sheet1');
  const salesSheet = ss.getSheetByName('Sales');
  
  const purchases = getTodayEntries(purchaseSheet, dateStr);
  const sales = getTodayEntries(salesSheet, dateStr);
  
  if (purchases.length === 0 && sales.length === 0) {
    Logger.log('No entries today — skipping WhatsApp send.');
    return;
  }
  
  // ── Build summary message ──
  const message = buildSummaryMessage(displayDate, purchases, sales);
  
  // ── Send via WhatsApp API ──
  sendWhatsAppMessage(message);
  
  Logger.log('✅ WhatsApp summary sent for ' + displayDate);
}

// ═══════════════════════════════════════════════════════════
// READ TODAY'S ENTRIES
// ═══════════════════════════════════════════════════════════
function getTodayEntries(sheet, dateStr) {
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  
  const headers = data[0];
  const entries = [];
  
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const rowDate = row[0]; // first column = date
    
    // Handle different date formats
    let rowDateStr = '';
    if (rowDate instanceof Date) {
      rowDateStr = Utilities.formatDate(rowDate, 'Asia/Kolkata', 'yyyy-MM-dd');
    } else if (typeof rowDate === 'string') {
      // Try to parse DD/MM/YYYY or YYYY-MM-DD
      if (rowDate.includes('/')) {
        const parts = rowDate.split('/');
        if (parts.length === 3) {
          rowDateStr = parts[2] + '-' + parts[1].padStart(2, '0') + '-' + parts[0].padStart(2, '0');
        }
      } else {
        rowDateStr = rowDate.substring(0, 10);
      }
    }
    
    if (rowDateStr === dateStr) {
      entries.push({
        date: rowDate,
        shop: normalizeShop(String(row[1] || '')),
        type: String(row[2] || '').toLowerCase(),
        qty: parseFloat(row[3]) || 0,
        price: parseFloat(row[4]) || 0
      });
    }
  }
  
  return entries;
}

function normalizeShop(shop) {
  if (shop === 'KVS Anachal') return 'Anachal';
  return shop;
}

// ═══════════════════════════════════════════════════════════
// BUILD SUMMARY MESSAGE
// ═══════════════════════════════════════════════════════════
function buildSummaryMessage(displayDate, purchases, sales) {
  let msg = '📊 *KVS Spices — Daily Summary*\n';
  msg += '📅 ' + displayDate + '\n';
  msg += '━━━━━━━━━━━━━━━━━━━━\n\n';
  
  // ── PURCHASES ──
  if (purchases.length > 0) {
    msg += '🟢 *PURCHASES*\n\n';
    
    // Group by shop
    const byShop = {};
    let totalQty = 0;
    let totalValue = 0;
    
    purchases.forEach(e => {
      if (!byShop[e.shop]) byShop[e.shop] = {};
      if (!byShop[e.shop][e.type]) byShop[e.shop][e.type] = { qty: 0, value: 0 };
      byShop[e.shop][e.type].qty += e.qty;
      byShop[e.shop][e.type].value += e.qty * e.price;
      totalQty += e.qty;
      totalValue += e.qty * e.price;
    });
    
    for (const shop of CONFIG.SHOPS) {
      if (!byShop[shop]) continue;
      msg += '🏪 *' + shop + '*\n';
      for (const [type, data] of Object.entries(byShop[shop])) {
        const label = CONFIG.SPICE_LABELS[type] || type;
        const avgPrice = data.qty > 0 ? Math.round(data.value / data.qty) : 0;
        msg += '  • ' + label + ': ' + data.qty.toFixed(1) + ' kg @ ₹' + avgPrice + '/kg\n';
      }
      msg += '\n';
    }
    
    msg += '📦 *Total Purchase: ' + totalQty.toFixed(1) + ' kg — ₹' + Math.round(totalValue).toLocaleString('en-IN') + '*\n\n';
  }
  
  // ── SALES ──
  if (sales.length > 0) {
    msg += '🔴 *SALES*\n\n';
    
    const bySaleShop = {};
    let saleTotalQty = 0;
    let saleTotalValue = 0;
    
    sales.forEach(e => {
      if (!bySaleShop[e.shop]) bySaleShop[e.shop] = {};
      if (!bySaleShop[e.shop][e.type]) bySaleShop[e.shop][e.type] = { qty: 0, value: 0 };
      bySaleShop[e.shop][e.type].qty += e.qty;
      bySaleShop[e.shop][e.type].value += e.qty * e.price;
      saleTotalQty += e.qty;
      saleTotalValue += e.qty * e.price;
    });
    
    for (const shop of CONFIG.SHOPS) {
      if (!bySaleShop[shop]) continue;
      msg += '🏪 *' + shop + '*\n';
      for (const [type, data] of Object.entries(bySaleShop[shop])) {
        const label = CONFIG.SPICE_LABELS[type] || type;
        const avgPrice = data.qty > 0 ? Math.round(data.value / data.qty) : 0;
        msg += '  • ' + label + ': ' + data.qty.toFixed(1) + ' kg @ ₹' + avgPrice + '/kg\n';
      }
      msg += '\n';
    }
    
    msg += '💰 *Total Sales: ' + saleTotalQty.toFixed(1) + ' kg — ₹' + Math.round(saleTotalValue).toLocaleString('en-IN') + '*\n\n';
  }
  
  msg += '━━━━━━━━━━━━━━━━━━━━\n';
  msg += '🤖 _Auto-sent by KVS Spices_';
  
  return msg;
}

// ═══════════════════════════════════════════════════════════
// SEND WHATSAPP MESSAGE VIA CLOUD API
// ═══════════════════════════════════════════════════════════
function sendWhatsAppMessage(text) {
  const url = 'https://graph.facebook.com/v22.0/' + CONFIG.PHONE_NUMBER_ID + '/messages';
  
  // First, send the hello_world template to open the conversation
  // (required for business-initiated messages outside 24h window)
  const templatePayload = {
    messaging_product: 'whatsapp',
    to: CONFIG.RECIPIENT,
    type: 'template',
    template: {
      name: 'hello_world',
      language: { code: 'en_US' }
    }
  };
  
  const templateRes = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + CONFIG.ACCESS_TOKEN },
    payload: JSON.stringify(templatePayload),
    muteHttpExceptions: true
  });
  
  Logger.log('Template response: ' + templateRes.getContentText());
  
  // Wait a moment, then send the actual summary as a text message
  Utilities.sleep(2000);
  
  const textPayload = {
    messaging_product: 'whatsapp',
    to: CONFIG.RECIPIENT,
    type: 'text',
    text: { body: text }
  };
  
  const textRes = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + CONFIG.ACCESS_TOKEN },
    payload: JSON.stringify(textPayload),
    muteHttpExceptions: true
  });
  
  const result = JSON.parse(textRes.getContentText());
  
  if (result.error) {
    Logger.log('❌ WhatsApp send failed: ' + JSON.stringify(result.error));
    throw new Error('WhatsApp send failed: ' + result.error.message);
  }
  
  Logger.log('✅ Message sent: ' + result.messages[0].id);
  return result;
}

// ═══════════════════════════════════════════════════════════
// TEST FUNCTION — run this manually to test
// ═══════════════════════════════════════════════════════════
function testSend() {
  sendWhatsAppMessage('🧪 Test message from KVS Spices auto-send!\n\nIf you see this, the WhatsApp API is working correctly. ✅');
}
