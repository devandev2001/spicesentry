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
// WEEKLY SUMMARY — triggered every Sunday at 10 PM
// Add a second trigger: Function: sendWeeklySummary
//   Event source: Time-driven → Week timer → Every Sunday → 10pm-11pm
// ═══════════════════════════════════════════════════════════
function sendWeeklySummary() {
  const today = new Date();
  const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
  const fromStr = Utilities.formatDate(weekAgo, 'Asia/Kolkata', 'yyyy-MM-dd');
  const toStr   = Utilities.formatDate(today, 'Asia/Kolkata', 'yyyy-MM-dd');
  const displayFrom = Utilities.formatDate(weekAgo, 'Asia/Kolkata', 'dd MMM');
  const displayTo   = Utilities.formatDate(today, 'Asia/Kolkata', 'dd MMM yyyy');

  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const purchaseSheet = ss.getSheetByName('Sheet1');
  const salesSheet    = ss.getSheetByName('Sales');

  const purchases = getEntriesInRange(purchaseSheet, fromStr, toStr);
  const sales     = getEntriesInRange(salesSheet, fromStr, toStr);

  if (purchases.length === 0 && sales.length === 0) {
    Logger.log('No entries this week — skipping weekly summary.');
    return;
  }

  const message = buildWeeklyMessage(displayFrom, displayTo, purchases, sales);
  sendWhatsAppMessage(message);
  Logger.log('✅ Weekly WhatsApp summary sent for ' + displayFrom + ' – ' + displayTo);
}

/**
 * Read entries within a date range [fromStr..toStr] inclusive (yyyy-MM-dd)
 */
function getEntriesInRange(sheet, fromStr, toStr) {
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];

  const entries = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const rowDate = row[0];

    let rowDateStr = '';
    if (rowDate instanceof Date) {
      rowDateStr = Utilities.formatDate(rowDate, 'Asia/Kolkata', 'yyyy-MM-dd');
    } else if (typeof rowDate === 'string') {
      if (rowDate.includes('/')) {
        const parts = rowDate.split('/');
        if (parts.length === 3) {
          rowDateStr = parts[2] + '-' + parts[1].padStart(2, '0') + '-' + parts[0].padStart(2, '0');
        }
      } else {
        rowDateStr = rowDate.substring(0, 10);
      }
    }

    if (rowDateStr >= fromStr && rowDateStr <= toStr) {
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

/**
 * Build a weekly summary message with per-shop, per-spice totals and P&L
 */
function buildWeeklyMessage(fromDisplay, toDisplay, purchases, sales) {
  let msg = '📊 *KVS Spices — Weekly Report*\n';
  msg += '📅 ' + fromDisplay + ' – ' + toDisplay + '\n';
  msg += '━━━━━━━━━━━━━━━━━━━━\n\n';

  let grandBuyQty = 0, grandBuyVal = 0, grandSellQty = 0, grandSellVal = 0;

  // ── PER-SHOP BREAKDOWN ──
  for (const shop of CONFIG.SHOPS) {
    const shopBuys  = purchases.filter(e => e.shop === shop);
    const shopSales = sales.filter(e => e.shop === shop);
    if (shopBuys.length === 0 && shopSales.length === 0) continue;

    msg += '🏪 *' + shop + '*\n';

    // Group by spice
    const spiceData = {};
    shopBuys.forEach(e => {
      if (!spiceData[e.type]) spiceData[e.type] = { buyQty: 0, buyVal: 0, sellQty: 0, sellVal: 0 };
      spiceData[e.type].buyQty += e.qty;
      spiceData[e.type].buyVal += e.qty * e.price;
    });
    shopSales.forEach(e => {
      if (!spiceData[e.type]) spiceData[e.type] = { buyQty: 0, buyVal: 0, sellQty: 0, sellVal: 0 };
      spiceData[e.type].sellQty += e.qty;
      spiceData[e.type].sellVal += e.qty * e.price;
    });

    for (const [type, d] of Object.entries(spiceData)) {
      const label = CONFIG.SPICE_LABELS[type] || type;
      let line = '  • ' + label + ': ';
      const parts = [];
      if (d.buyQty > 0) {
        const avg = Math.round(d.buyVal / d.buyQty);
        parts.push('↓' + d.buyQty.toFixed(1) + 'kg @₹' + avg);
        grandBuyQty += d.buyQty;
        grandBuyVal += d.buyVal;
      }
      if (d.sellQty > 0) {
        const avg = Math.round(d.sellVal / d.sellQty);
        parts.push('↑' + d.sellQty.toFixed(1) + 'kg @₹' + avg);
        grandSellQty += d.sellQty;
        grandSellVal += d.sellVal;
      }
      msg += line + parts.join(' | ') + '\n';
    }
    msg += '\n';
  }

  // ── OVERALL TOTALS ──
  msg += '━━━━━━━━━━━━━━━━━━━━\n';
  msg += '📦 *WEEKLY TOTALS*\n';
  if (grandBuyQty > 0) {
    msg += '  Purchased: ' + grandBuyQty.toFixed(1) + ' kg — ₹' + Math.round(grandBuyVal).toLocaleString('en-IN') + '\n';
    msg += '  Avg Buy: ₹' + Math.round(grandBuyVal / grandBuyQty) + '/kg\n';
  }
  if (grandSellQty > 0) {
    msg += '  Sold: ' + grandSellQty.toFixed(1) + ' kg — ₹' + Math.round(grandSellVal).toLocaleString('en-IN') + '\n';
    msg += '  Avg Sell: ₹' + Math.round(grandSellVal / grandSellQty) + '/kg\n';
  }
  if (grandSellQty > 0 && grandBuyQty > 0) {
    const costBasis = (grandBuyVal / grandBuyQty) * grandSellQty;
    const pnl = grandSellVal - costBasis;
    msg += '  ' + (pnl >= 0 ? '📈 Profit' : '📉 Loss') + ': ₹' + Math.abs(Math.round(pnl)).toLocaleString('en-IN') + '\n';
  }

  msg += '\n━━━━━━━━━━━━━━━━━━━━\n';
  msg += '🤖 _Auto-sent by KVS Spices (Weekly)_';

  return msg;
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
  
  // Try sending the text message directly first
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
  
  const textResult = JSON.parse(textRes.getContentText());
  Logger.log('Text message response: ' + textRes.getContentText());
  
  // If text message succeeded, we're done
  if (textResult.messages && textResult.messages[0]) {
    Logger.log('✅ Text message sent: ' + textResult.messages[0].id);
    return textResult;
  }
  
  // If text failed (outside 24h window), send template first then retry
  Logger.log('⚠️ Text failed, trying template first: ' + JSON.stringify(textResult.error));
  
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
  
  // Wait for template to open conversation, then retry text
  Utilities.sleep(3000);
  
  const retryRes = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + CONFIG.ACCESS_TOKEN },
    payload: JSON.stringify(textPayload),
    muteHttpExceptions: true
  });
  
  const retryResult = JSON.parse(retryRes.getContentText());
  Logger.log('Retry text response: ' + retryRes.getContentText());
  
  if (retryResult.error) {
    Logger.log('❌ WhatsApp send failed after retry: ' + JSON.stringify(retryResult.error));
    throw new Error('WhatsApp send failed: ' + retryResult.error.message);
  }
  
  Logger.log('✅ Message sent on retry: ' + retryResult.messages[0].id);
  return retryResult;
}

// ═══════════════════════════════════════════════════════════
// DIAGNOSTIC — run this to check what error the API returns
// ═══════════════════════════════════════════════════════════
function diagnoseSend() {
  const url = 'https://graph.facebook.com/v22.0/' + CONFIG.PHONE_NUMBER_ID + '/messages';
  
  // Try a plain text message (no template)
  const textPayload = {
    messaging_product: 'whatsapp',
    to: CONFIG.RECIPIENT,
    type: 'text',
    text: { body: '🧪 Diagnostic test from KVS Spices' }
  };
  
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + CONFIG.ACCESS_TOKEN },
    payload: JSON.stringify(textPayload),
    muteHttpExceptions: true
  });
  
  Logger.log('HTTP Status: ' + res.getResponseCode());
  Logger.log('Response: ' + res.getContentText());
  
  const body = JSON.parse(res.getContentText());
  if (body.error) {
    Logger.log('ERROR CODE: ' + body.error.code);
    Logger.log('ERROR TYPE: ' + body.error.type);
    Logger.log('ERROR MSG: ' + body.error.message);
    Logger.log('ERROR SUBCODE: ' + (body.error.error_subcode || 'none'));
  } else {
    Logger.log('SUCCESS — Message ID: ' + body.messages[0].id);
  }
}

// ═══════════════════════════════════════════════════════════
// TEST FUNCTION — run this manually to test
// ═══════════════════════════════════════════════════════════
function testSend() {
  sendWhatsAppMessage('🧪 Test message from KVS Spices auto-send!\n\nIf you see this, the WhatsApp API is working correctly. ✅');
}
