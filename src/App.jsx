import React, { useState, useEffect, useRef } from 'react';
import { Home, PlusCircle, Clock, Truck, Download, TrendingUp, Filter, ShoppingBag, Trash2, ArrowRightLeft, Eye, CalendarDays, BarChart3, HardDriveDownload, Mic, MicOff, Pencil, Settings, LogOut } from 'lucide-react';
import { format, differenceInDays, startOfMonth, subMonths, endOfMonth } from 'date-fns';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { useAuth } from './AuthContext';
import LoginPage from './LoginPage';
import CPanel from './CPanel';

// ── Toast Notification System ──
let _toastId = 0;
function ToastContainer({ toasts, onDismiss }) {
  if (!toasts.length) return null;
  const icons = { success: '✓', error: '✕', info: '●', warning: '⚠' };
  return (
    <div className="toast-container">
      {toasts.map(t => (
        <div key={t.id} className={`toast ${t.type}`} onClick={() => onDismiss(t.id)} style={{ cursor: 'pointer' }}>
          <span className="toast-icon">{icons[t.type] || '●'}</span>
          <span className="toast-msg">{t.message}</span>
        </div>
      ))}
    </div>
  );
}

// ── Indian Currency Formatter ──
// Formats numbers as ₹1,25,000 (Indian lakh/crore system)
const formatINR = (num) => {
  if (num === null || num === undefined || isNaN(num)) return '₹0';
  const n = Math.round(Number(num));
  const s = Math.abs(n).toString();
  if (s.length <= 3) return `₹${n < 0 ? '-' : ''}${s}`;
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3);
  const formatted = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3;
  return `₹${n < 0 ? '-' : ''}${formatted}`;
};

const SHOPS = ['20 Acre', 'Anachal', 'Kallar'];
const SPICES = [
  { id: 'cardamom', label: 'Cardamom', color: 'var(--cardamom-main)' },
  { id: 'pepper', label: 'Pepper', color: 'var(--pepper-main)' },
  { id: 'nutmeg', label: 'Nutmeg', color: 'var(--nutmeg-main)' },
  { id: 'nutmeg_mace', label: 'Nutmeg mace', color: 'var(--nutmeg-main)' },
  { id: 'coffee', label: 'Coffee', color: 'var(--coffee-main)' },
  { id: 'clove', label: 'Clove', color: 'var(--clove-main)' }
];

// Google Apps Script web-app endpoint
const GSHEET_URL = 'https://script.google.com/macros/s/AKfycbzWGVOetrbZMaN0XSKV94Yj_5HXKg2GwpFB8WPXwrtLZqt0HTAz9oBWs3TKxq7KtqypAQ/exec';

// Helper: Send data to Google Apps Script via GET with payload as URL param
// (Google Apps Script redirects POST to a URL that only accepts GET,
//  so we encode the payload in a query parameter instead)
// ── Offline Queue ──
const OFFLINE_QUEUE_KEY = 'spicesentry_offline_queue';

function getOfflineQueue() {
  try { return JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]'); }
  catch { return []; }
}

function saveOfflineQueue(queue) {
  localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
}

function postToSheet(payload) {
  if (!navigator.onLine) {
    const queue = getOfflineQueue();
    queue.push(payload);
    saveOfflineQueue(queue);
    console.log('Offline: queued payload', payload);
    return Promise.resolve();
  }
  const url = GSHEET_URL + '?data=' + encodeURIComponent(JSON.stringify(payload));
  return fetch(url, { redirect: 'follow' }).catch(err => {
    // Network error — queue for retry
    const queue = getOfflineQueue();
    queue.push(payload);
    saveOfflineQueue(queue);
    console.error('Sheet sync error, queued for retry:', err);
  });
}

async function flushOfflineQueue() {
  const queue = getOfflineQueue();
  if (queue.length === 0) return;
  console.log(`Flushing ${queue.length} offline queued items…`);
  const remaining = [];
  for (const payload of queue) {
    try {
      const url = GSHEET_URL + '?data=' + encodeURIComponent(JSON.stringify(payload));
      await fetch(url, { redirect: 'follow' });
    } catch {
      remaining.push(payload);
    }
  }
  saveOfflineQueue(remaining);
  if (remaining.length === 0) console.log('Offline queue flushed.');
  else console.log(`${remaining.length} items still queued.`);
}

function buildDefaultLoads() {
  const initial = {};
  SHOPS.forEach(shop => {
    SPICES.forEach(spice => {
      initial[`${shop}|${spice.id}`] = { id: Date.now().toString(), start: Date.now() };
    });
  });
  return initial;
}

function MainApp() {
  const { isOwner, logout } = useAuth();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [selectedShop, setSelectedShop] = useState(SHOPS[0]);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  // ── Toast system ──
  const [toasts, setToasts] = useState([]);
  const showToast = (message, type = 'info', duration = 3000) => {
    const id = ++_toastId;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), duration);
  };
  const dismissToast = (id) => setToasts(prev => prev.filter(t => t.id !== id));

  // Custom confirm modal (replaces native confirm() for beautiful UI)
  const [confirmModal, setConfirmModal] = useState(null); // { message, onConfirm }
  const showConfirm = (message) => new Promise(resolve => {
    setConfirmModal({ message, onConfirm: () => { setConfirmModal(null); resolve(true); }, onCancel: () => { setConfirmModal(null); resolve(false); } });
  });

  // Navigate to tab + scroll to top
  const goTo = (tab) => { setActiveTab(tab); window.scrollTo(0, 0); };

  // Data State — load from localStorage INSTANTLY, then refresh from Sheets
  const [entries, setEntries] = useState(() => {
    try { return JSON.parse(localStorage.getItem('spice_entries') || '[]'); } catch { return []; }
  });
  const [sales, setSales] = useState(() => {
    try { return JSON.parse(localStorage.getItem('spice_sales') || '[]'); } catch { return []; }
  });
  const [shopLoads, setShopLoads] = useState(() => {
    try {
      const cached = JSON.parse(localStorage.getItem('spice_shop_loads') || '{}');
      return Object.keys(cached).length > 0 ? { ...buildDefaultLoads(), ...cached } : buildDefaultLoads();
    } catch { return buildDefaultLoads(); }
  });

  // Helper to get the load for a specific shop + spice
  const getLoad = (shop, spiceId) => shopLoads[`${shop}|${spiceId}`] || { id: '0', start: Date.now() };

  // Whether a real load exists from the Sheets (not just a random default)
  const hasRealLoad = (shop, spiceId) => {
    const load = shopLoads[`${shop}|${spiceId}`];
    return load && load._fromSheet;
  };

  // ── Reusable: fetch data from Google Sheets ──
  // Normalize legacy shop names (e.g. "KVS Anachal" → "Anachal")
  const normalizeShop = (item) => {
    if (item.shop === 'KVS Anachal') item.shop = 'Anachal';
    return item;
  };

  const refreshFromSheets = async (silent = false) => {
    if (!silent) setSyncing(true);
    try {
      const res = await fetch(GSHEET_URL, { redirect: 'follow' });
      if (!res.ok) throw new Error('Network error ' + res.status);
      const data = await res.json();

      if (data.entries) setEntries(data.entries.map(normalizeShop));
      if (data.sales)  setSales(data.sales.map(normalizeShop));

      // Build loads: use sheet loads if available, otherwise derive from entries
      let resolvedLoads = {};
      if (data.loads && Object.keys(data.loads).length > 0) {
        // Mark loads from sheet so we know to filter by loadId
        Object.entries(data.loads).forEach(([key, val]) => {
          const normKey = key.replace('KVS Anachal', 'Anachal');
          resolvedLoads[normKey] = { ...val, _fromSheet: true };
        });
      } else {
        // No loads in sheet — derive from entries but mark as NOT from sheet
        const allItems = [...(data.entries || []).map(normalizeShop), ...(data.sales || []).map(normalizeShop)];
        allItems.forEach(item => {
          if (item.shop && item.type && item.loadId) {
            const key = `${item.shop}|${item.type}`;
            if (!resolvedLoads[key]) {
              resolvedLoads[key] = { id: item.loadId.toString(), start: new Date(item.date).getTime() || Date.now(), _fromSheet: false };
            }
          }
        });
      }
      if (Object.keys(resolvedLoads).length > 0) {
        setShopLoads(prev => ({ ...prev, ...resolvedLoads }));
      }

      setLastSync(new Date());
    } catch (err) {
      console.warn('Sheet sync failed:', err);
    } finally {
      setSyncing(false);
    }
  };

  // ── Fetch on mount + auto-poll every 500ms ──
  useEffect(() => {
    refreshFromSheets();
    const interval = setInterval(() => refreshFromSheets(true), 500);
    return () => clearInterval(interval);
  }, []);

  // ── Flush offline queue when connectivity is restored ──
  useEffect(() => {
    const handleOnline = () => {
      setIsOffline(false);
      flushOfflineQueue().then(() => refreshFromSheets(true));
    };
    const handleOffline = () => setIsOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    // Also flush on mount if online & queue exists
    if (navigator.onLine) flushOfflineQueue();
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Debounced localStorage cache — only writes once every 5 seconds max
  // Prevents lag from constant JSON serialization on every poll/update
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        localStorage.setItem('spice_entries', JSON.stringify(entries));
        localStorage.setItem('spice_sales', JSON.stringify(sales));
        localStorage.setItem('spice_shop_loads', JSON.stringify(shopLoads));
      } catch (e) {
        // localStorage full — clear old cache
        console.warn('localStorage full, clearing cache:', e);
        localStorage.removeItem('spice_entries');
        localStorage.removeItem('spice_sales');
      }
    }, 5000);
    return () => clearTimeout(timer);
  }, [entries, sales, shopLoads]);

  // Derived state: per-spice stats for the selected shop
  const stats = SPICES.map(spice => {
    const load = getLoad(selectedShop, spice.id);
    const useLoadFilter = hasRealLoad(selectedShop, spice.id);
    const spiceEntries = entries.filter(e => e.shop === selectedShop && e.type === spice.id && (!useLoadFilter || e.loadId === load.id));
    const totalQty = spiceEntries.reduce((sum, e) => sum + Number(e.qty), 0);
    const totalValue = spiceEntries.reduce((sum, e) => sum + (Number(e.qty) * Number(e.price)), 0);
    const originalAvgBuy = totalQty > 0 ? +(totalValue / totalQty).toFixed(2) : 0;

    // Sales for this shop + spice in the current load
    const spiceSales = sales.filter(s => s.shop === selectedShop && s.type === spice.id && (!useLoadFilter || s.loadId === load.id));
    const soldQty   = spiceSales.reduce((sum, s) => sum + Number(s.qty), 0);
    const soldValue = spiceSales.reduce((sum, s) => sum + Number(s.qty) * Number(s.sellPrice), 0);
    const avgSellPrice = soldQty > 0 ? +(soldValue / soldQty).toFixed(2) : null;

    const remainingQty = Math.max(0, totalQty - soldQty);

    // Cost-relief method: remaining value = total buy value − sale proceeds
    const remainingValue = totalValue - soldValue;
    const avgBuyPrice = remainingQty > 0 ? +(remainingValue / remainingQty).toFixed(2) : originalAvgBuy;

    const profitPerKg  = avgSellPrice !== null ? +(avgSellPrice - originalAvgBuy).toFixed(2) : null;

    return {
      ...spice,
      totalQty,
      soldQty,
      remainingQty,
      originalAvgBuy,                     // weighted avg of all purchases (never changes)
      avgPrice: avgBuyPrice.toFixed(2),   // keep string for display compat — now cost-relief adjusted
      avgBuyPrice,                        // cost-relief adjusted avg
      avgSellPrice,
      profitPerKg,
      remainingValue: remainingQty > 0 ? +remainingValue.toFixed(2) : 0,
      totalBuyValue: +totalValue.toFixed(2),
    };
  });

  // All-branch stats: weighted avg price per spice across every shop's current load
  const allBranchStats = SPICES.map(spice => {
    let grandQty = 0;
    let grandValue = 0;
    let grandSoldValue = 0;
    let grandSoldQty = 0;
    const perShop = SHOPS.map(shop => {
      const load = getLoad(shop, spice.id);
      const useLoadFilter = hasRealLoad(shop, spice.id);
      const se = entries.filter(e => e.shop === shop && e.type === spice.id && (!useLoadFilter || e.loadId === load.id));
      const qty = se.reduce((s, e) => s + Number(e.qty), 0);
      const val = se.reduce((s, e) => s + Number(e.qty) * Number(e.price), 0);
      const shopSales = sales.filter(s => s.shop === shop && s.type === spice.id && (!useLoadFilter || s.loadId === load.id));
      const soldQty = shopSales.reduce((sum, s) => sum + Number(s.qty), 0);
      const soldVal = shopSales.reduce((sum, s) => sum + Number(s.qty) * Number(s.sellPrice), 0);
      const remainingQty = Math.max(0, qty - soldQty);
      grandQty += qty;
      grandValue += val;
      grandSoldValue += soldVal;
      grandSoldQty += soldQty;
      // Cost-relief avg for this shop
      const remainingValue = val - soldVal;
      const costReliefAvg = remainingQty > 0 ? +(remainingValue / remainingQty).toFixed(2) : (qty > 0 ? +(val / qty).toFixed(2) : 0);
      return { shop, qty, soldQty, remainingQty, avgPrice: costReliefAvg };
    });
    const grandRemainingQty = Math.max(0, grandQty - grandSoldQty);
    const grandRemainingValue = grandValue - grandSoldValue;
    return {
      ...spice,
      totalQty: grandQty,
      remainingQty: grandRemainingQty,
      avgPrice: grandRemainingQty > 0 ? +(grandRemainingValue / grandRemainingQty).toFixed(2) : (grandQty > 0 ? +(grandValue / grandQty).toFixed(2) : 0),
      perShop,
    };
  });

  // Days since the oldest active spice load started for this shop
  const oldestLoadStart = SPICES.reduce((oldest, spice) => {
    const load = getLoad(selectedShop, spice.id);
    return load.start < oldest ? load.start : oldest;
  }, Date.now());
  const daysSinceLoadStart = Math.max(1, differenceInDays(new Date(), new Date(oldestLoadStart)) + 1);

  const handleAddEntry = async (entry) => {
    const load = getLoad(entry.shop, entry.type);
    const newEntry = { 
      ...entry, 
      id: Date.now(), 
      loadId: load.id, 
      totalValue: entry.qty * entry.price 
    };
    
    setEntries(prev => [newEntry, ...prev]);
    goTo('dashboard');
    setSelectedShop(entry.shop);

    setTimeout(() => {
      postToSheet({ ...newEntry, kind: 'entry' })
        .then(() => refreshFromSheets(true))
        .catch(err => console.error("Error sending to Google Sheets:", err));
    }, 0);
  };

  const handleAddSale = async (sale) => {
    const load = getLoad(sale.shop, sale.type);
    const newSale = {
      ...sale,
      id: Date.now(),
      loadId: load.id,
      totalValue: sale.qty * sale.sellPrice,
      kind: 'sale',
      date: new Date().toISOString(),
    };

    setSales(prev => [newSale, ...prev]);
    goTo('dashboard');
    setSelectedShop(sale.shop);

    setTimeout(() => {
      postToSheet(newSale)
        .then(() => refreshFromSheets(true))
        .catch(err => console.error("Error sending sale to Google Sheets:", err));
    }, 0);
  };

  const handleDeleteEntry = async (id) => {
    if (await showConfirm('Delete this purchase entry?')) {
      setEntries(prev => prev.filter(e => e.id !== id));
      postToSheet({ kind: 'delete_entry', id: id.toString() })
        .then(() => refreshFromSheets(true))
        .catch(err => console.error("Error deleting entry from Sheets:", err));
    }
  };

  const handleDeleteSale = async (id) => {
    if (await showConfirm('Delete this sale entry?')) {
      setSales(prev => prev.filter(s => s.id !== id));
      postToSheet({ kind: 'delete_sale', id: id.toString() })
        .then(() => refreshFromSheets(true))
        .catch(err => console.error("Error deleting sale from Sheets:", err));
    }
  };

  // ── Edit Entry / Sale ──
  const handleEditEntry = async (id, updates) => {
    // Update locally
    setEntries(prev => prev.map(e => e.id === id ? { ...e, ...updates } : e));
    // Delete old + insert new on Sheets
    await postToSheet({ kind: 'delete_entry', id: id.toString() });
    const entry = entries.find(e => e.id === id);
    if (entry) {
      const updated = { ...entry, ...updates, kind: 'entry' };
      await postToSheet(updated);
    }
    refreshFromSheets(true);
  };

  const handleEditSale = async (id, updates) => {
    setSales(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
    await postToSheet({ kind: 'delete_sale', id: id.toString() });
    const sale = sales.find(s => s.id === id);
    if (sale) {
      const updated = { ...sale, ...updates, kind: 'sale' };
      await postToSheet(updated);
    }
    refreshFromSheets(true);
  };

  // Dispatch modal state
  const [dispatchModal, setDispatchModal] = useState(null); // { spiceId, spiceLabel, remainingQty, loadId }
  const [dispatchPrice, setDispatchPrice] = useState('');

  const handleDispatchLoad = async (spiceId) => {
    const spiceLabel = SPICES.find(s => s.id === spiceId)?.label || spiceId;
    const load = getLoad(selectedShop, spiceId);
    
    const spiceEntries = entries.filter(e => e.shop === selectedShop && e.loadId === load.id && e.type === spiceId);
    const spiceSales = sales.filter(s => s.shop === selectedShop && s.loadId === load.id && s.type === spiceId);
    const totalQty = spiceEntries.reduce((sum, e) => sum + Number(e.qty), 0);
    const soldQty = spiceSales.reduce((sum, s) => sum + Number(s.qty), 0);
    const remainingQty = Math.max(0, totalQty - soldQty);

    if (remainingQty <= 0) {
      if (await showConfirm(`No remaining ${spiceLabel} stock. Reset load anyway?`)) {
        const newLoadId = Date.now().toString();
        const newLoadStart = Date.now();
        setShopLoads(prev => ({
          ...prev,
          [`${selectedShop}|${spiceId}`]: { id: newLoadId, start: newLoadStart }
        }));
        // Persist to Sheets
        postToSheet({ kind: 'load', shop: selectedShop, spice: spiceId, loadId: newLoadId, start: newLoadStart })
          .catch(err => console.error("Error saving load reset:", err));
      }
      return;
    }

    setDispatchPrice('');
    setDispatchModal({ spiceId, spiceLabel, remainingQty, loadId: load.id });
  };

  const confirmDispatch = async () => {
    if (!dispatchModal) return;
    const sellPrice = parseFloat(dispatchPrice);
    if (isNaN(sellPrice) || sellPrice <= 0) return;

    const { spiceId, remainingQty, loadId } = dispatchModal;

    const dispatchSale = {
      shop: selectedShop,
      type: spiceId,
      qty: remainingQty,
      sellPrice,
      buyerName: 'Dispatch',
      id: Date.now(),
      loadId,
      totalValue: remainingQty * sellPrice,
      kind: 'sale',
      date: new Date().toISOString(),
    };
    setSales(prev => [dispatchSale, ...prev]);

    const newLoadId = Date.now().toString();
    const newLoadStart = Date.now();

    setShopLoads(prev => ({
      ...prev,
      [`${selectedShop}|${spiceId}`]: { id: newLoadId, start: newLoadStart }
    }));

    // Navigate instantly (local state already updated)
    setDispatchModal(null);
    setDispatchPrice('');
    goTo('dashboard');

    // Defer network sync so React paints the navigation first
    setTimeout(() => {
      Promise.all([
        postToSheet(dispatchSale),
        postToSheet({ kind: 'load', shop: selectedShop, spice: spiceId, loadId: newLoadId, start: newLoadStart }),
      ])
        .then(() => refreshFromSheets(true))
        .catch(err => console.error("Error syncing dispatch to Sheets:", err));
    }, 0);
  };

  // ── Transfer Modal ──
  const [transferModal, setTransferModal] = useState(false);
  const [tfFrom, setTfFrom] = useState(SHOPS[0]);
  const [tfTo, setTfTo] = useState(SHOPS[1]);
  const [tfSpice, setTfSpice] = useState(SPICES[0].id);
  const [tfQty, setTfQty] = useState('');
  const [tfPrice, setTfPrice] = useState('');

  const openTransferModal = () => {
    setTfFrom(selectedShop);
    setTfTo(SHOPS.find(s => s !== selectedShop) || SHOPS[0]);
    setTfSpice(SPICES[0].id);
    setTfQty('');
    setTfPrice('');
    setTransferModal(true);
  };

  // Compute available qty for the selected source + spice
  const tfAvailableQty = (() => {
    if (!transferModal) return 0;
    const load = getLoad(tfFrom, tfSpice);
    const useLoadFilter = hasRealLoad(tfFrom, tfSpice);
    const se = entries.filter(e => e.shop === tfFrom && e.type === tfSpice && (!useLoadFilter || e.loadId === load.id));
    const ss = sales.filter(s => s.shop === tfFrom && s.type === tfSpice && (!useLoadFilter || s.loadId === load.id));
    const bought = se.reduce((s, e) => s + Number(e.qty), 0);
    const sold = ss.reduce((s, e) => s + Number(e.qty), 0);
    return Math.max(0, bought - sold);
  })();

  // Compute avg buy price at source for this spice (cost-relief)
  const tfAvgPrice = (() => {
    if (!transferModal) return 0;
    const load = getLoad(tfFrom, tfSpice);
    const useLoadFilter = hasRealLoad(tfFrom, tfSpice);
    const se = entries.filter(e => e.shop === tfFrom && e.type === tfSpice && (!useLoadFilter || e.loadId === load.id));
    const ss = sales.filter(s => s.shop === tfFrom && s.type === tfSpice && (!useLoadFilter || s.loadId === load.id));
    const totalVal = se.reduce((s, e) => s + Number(e.qty) * Number(e.price), 0);
    const soldVal = ss.reduce((s, e) => s + Number(e.qty) * Number(e.sellPrice), 0);
    const totalQty = se.reduce((s, e) => s + Number(e.qty), 0);
    const soldQty = ss.reduce((s, e) => s + Number(e.qty), 0);
    const remQty = Math.max(0, totalQty - soldQty);
    const remVal = totalVal - soldVal;
    return remQty > 0 ? +(remVal / remQty).toFixed(2) : (totalQty > 0 ? +(totalVal / totalQty).toFixed(2) : 0);
  })();

  const handleTransfer = async () => {
    const qty = parseFloat(tfQty);
    const price = parseFloat(tfPrice);
    if (!qty || qty <= 0 || tfFrom === tfTo) return;
    if (!price || price <= 0) return;
    if (qty > tfAvailableQty) {
      if (!(await showConfirm(`⚠️ Only ${tfAvailableQty.toFixed(2)} Kg available in ${tfFrom} but transferring ${qty.toFixed(2)} Kg.\n\nContinue anyway?`))) return;
    }

    const fromLoad = getLoad(tfFrom, tfSpice);
    const toLoad = getLoad(tfTo, tfSpice);
    const now = new Date().toISOString();
    const ts = Date.now();

    // Record as sale from source (buyerName = "Transfer → dest")
    const transferOut = {
      shop: tfFrom,
      type: tfSpice,
      qty,
      sellPrice: price,
      buyerName: `Transfer → ${tfTo}`,
      id: ts,
      loadId: fromLoad.id,
      totalValue: qty * price,
      kind: 'sale',
      date: now,
    };

    // Record as purchase at destination
    const transferIn = {
      shop: tfTo,
      type: tfSpice,
      qty,
      price,
      id: ts + 1,
      loadId: toLoad.id,
      totalValue: qty * price,
      date: now,
    };

    setSales(prev => [transferOut, ...prev]);
    setEntries(prev => [transferIn, ...prev]);

    // Navigate instantly (local state already updated)
    setTransferModal(false);
    goTo('dashboard');
    setSelectedShop(tfTo);

    // Defer network sync so React paints the navigation first
    setTimeout(() => {
      Promise.all([
        postToSheet(transferOut),
        postToSheet({ ...transferIn, kind: 'entry' }),
      ])
        .then(() => refreshFromSheets(true))
        .catch(err => console.error("Error syncing transfer to Sheets:", err));
    }, 0);
  };

  return (
    <>
      {/* Sync indicator bar */}
      {syncing && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
          height: 3, background: 'linear-gradient(90deg, var(--cardamom-main, #4caf50), var(--primary-accent, #58a6ff))',
          animation: 'syncPulse 1.2s ease-in-out infinite',
        }} />
      )}
      <style>{`@keyframes syncPulse { 0%,100% { opacity: 0.4; } 50% { opacity: 1; } }`}</style>

      {/* Offline banner */}
      {isOffline && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9998,
          padding: '0.4rem 1rem', textAlign: 'center',
          background: 'rgba(234,179,8,0.15)', borderBottom: '1px solid rgba(234,179,8,0.3)',
          color: '#eab308', fontSize: '0.75rem', fontWeight: 600,
        }}>
          📡 Offline — changes saved locally, will sync when back online
        </div>
      )}

      {/* ── Custom Confirm Modal ── */}
      {confirmModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          zIndex: 10000, background: 'rgba(0,0,0,0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '1.5rem', animation: 'fadeIn 0.15s ease-in-out',
        }}>
          <div style={{
            background: 'var(--card-bg)', borderRadius: 16, padding: '1.5rem',
            maxWidth: 340, width: '100%', border: '1px solid rgba(255,255,255,0.08)',
            boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          }}>
            <p style={{ color: 'var(--text-primary)', fontSize: '0.95rem', fontWeight: 600, marginBottom: '1.25rem', lineHeight: 1.5, whiteSpace: 'pre-line' }}>
              {confirmModal.message}
            </p>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                onClick={confirmModal.onCancel}
                style={{
                  flex: 1, padding: '0.7rem', borderRadius: 10, fontWeight: 700, fontSize: '0.9rem',
                  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                  color: 'var(--text-secondary)', cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={confirmModal.onConfirm}
                style={{
                  flex: 1, padding: '0.7rem', borderRadius: 10, fontWeight: 700, fontSize: '0.9rem',
                  background: 'var(--primary-accent)', border: 'none',
                  color: '#fff', cursor: 'pointer',
                }}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="content-area">
        {activeTab === 'cpanel' && isOwner ? (
          <CPanel onBack={() => goTo('dashboard')} shops={SHOPS} spices={SPICES} />
        ) : (
          <>
            {activeTab === 'dashboard' && (
              <Dashboard 
                stats={stats} 
                allBranchStats={allBranchStats}
                shops={SHOPS}
                selectedShop={selectedShop}
                onSelectShop={setSelectedShop}
                days={daysSinceLoadStart}
                onDispatch={isOwner ? handleDispatchLoad : undefined}
                onTransfer={isOwner ? openTransferModal : undefined}
                syncing={syncing}
                lastSync={lastSync}
                onRefresh={() => refreshFromSheets()}
                entries={entries}
                sales={sales}
                shopLoads={shopLoads}
                isOwner={isOwner}
              />
            )}
            {activeTab === 'add' && <AddEntry onAdd={handleAddEntry} shops={SHOPS} spices={SPICES} showToast={showToast} />}
            {activeTab === 'sell' && <AddSale onSell={handleAddSale} shops={SHOPS} spices={SPICES} entries={entries} sales={sales} shopLoads={shopLoads} selectedShop={selectedShop} showToast={showToast} />}
            {activeTab === 'daily' && (
              <DailyPurchases
                entries={entries}
                sales={sales}
                shops={SHOPS}
                spices={SPICES}
                selectedShop={selectedShop}
                onSelectShop={setSelectedShop}
              />
            )}
            {activeTab === 'history' && (
              <History 
                entries={entries}
                sales={sales}
                selectedShop={selectedShop}
                onSelectShop={setSelectedShop}
                shops={SHOPS}
                spices={SPICES}
                shopLoads={shopLoads}
                onDeleteEntry={isOwner ? handleDeleteEntry : undefined}
                onDeleteSale={isOwner ? handleDeleteSale : undefined}
                onEditEntry={isOwner ? handleEditEntry : undefined}
                onEditSale={isOwner ? handleEditSale : undefined}
              />
            )}
          </>
        )}
      </div>

      <nav className="bottom-nav">
        <div className="nav-brand">
          <img src="/kvs-logo.png" alt="KVS" style={{ width: 36, height: 36, borderRadius: 10, objectFit: 'contain' }} />
          <span>KVS Spices</span>
        </div>
        <button className={`nav-item ${activeTab === 'dashboard' ? 'active' : ''}`} onClick={() => goTo('dashboard')}>
          <Home />
          <span>Dashboard</span>
        </button>
        <button className={`nav-item ${activeTab === 'add' ? 'active' : ''}`} onClick={() => goTo('add')}>
          <PlusCircle />
          <span>Buy</span>
        </button>
        <button className={`nav-item ${activeTab === 'sell' ? 'active' : ''}`} onClick={() => goTo('sell')}>
          <ShoppingBag />
          <span>Sell</span>
        </button>
        {isOwner && (
          <button className={`nav-item ${activeTab === 'daily' ? 'active' : ''}`} onClick={() => goTo('daily')}>
            <CalendarDays />
            <span>Daily</span>
          </button>
        )}
        {isOwner && (
          <button className={`nav-item ${activeTab === 'history' ? 'active' : ''}`} onClick={() => goTo('history')}>
            <Clock />
            <span>History</span>
          </button>
        )}
        {isOwner && (
          <button className={`nav-item ${activeTab === 'cpanel' ? 'active' : ''}`} onClick={() => goTo('cpanel')}>
            <Settings />
            <span>CPanel</span>
          </button>
        )}
        <button className="nav-item nav-logout" onClick={logout}>
          <LogOut />
          <span>Logout</span>
        </button>
      </nav>

      {/* Toast Notifications */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      {/* Dispatch Price Modal */}
      {dispatchModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)',
          animation: 'fadeIn 0.2s ease',
        }} onClick={() => setDispatchModal(null)}>
          <div onClick={e => e.stopPropagation()} style={{
            width: '90%', maxWidth: 380,
            background: 'var(--card-bg)', border: '1px solid var(--border-color)',
            borderRadius: 16, padding: '1.5rem',
            boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1.25rem' }}>
              <div style={{
                width: 40, height: 40, borderRadius: 12,
                background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.25)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Truck size={20} style={{ color: 'var(--danger)' }} />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.05rem', color: 'var(--text-primary)' }}>
                  Dispatch {dispatchModal.spiceLabel}
                </h3>
                <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  {selectedShop}
                </p>
              </div>
            </div>

            <div style={{
              background: 'rgba(88,166,255,0.08)', border: '1px solid rgba(88,166,255,0.15)',
              borderRadius: 10, padding: '0.75rem 1rem', marginBottom: '1.25rem',
            }}>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Dispatching Quantity</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--primary-accent)' }}>
                {dispatchModal.remainingQty.toFixed(2)} <span style={{ fontSize: '0.75rem', fontWeight: 400 }}>Kg</span>
              </div>
            </div>

            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>
              Sell Price per Kg (₹)
            </label>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={dispatchPrice}
              onChange={e => setDispatchPrice(e.target.value)}
              autoFocus
              placeholder="Enter price..."
              style={{
                width: '100%', padding: '0.75rem 1rem',
                background: 'var(--bg-primary)', border: '1px solid var(--border-color)',
                borderRadius: 10, color: 'var(--text-primary)',
                fontSize: '1.1rem', fontWeight: 600,
                outline: 'none', boxSizing: 'border-box',
                transition: 'border-color 0.15s ease',
              }}
              onFocus={e => e.target.style.borderColor = 'var(--primary-accent)'}
              onBlur={e => e.target.style.borderColor = 'var(--border-color)'}
              onKeyDown={e => { if (e.key === 'Enter' && dispatchPrice) confirmDispatch(); }}
            />

            {dispatchPrice && parseFloat(dispatchPrice) > 0 && (
              <div style={{
                marginTop: '0.75rem', padding: '0.6rem 0.75rem',
                background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)',
                borderRadius: 8, fontSize: '0.8rem', color: '#10b981',
              }}>
                Total: {formatINR(dispatchModal.remainingQty * parseFloat(dispatchPrice))}
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem' }}>
              <button
                onClick={() => setDispatchModal(null)}
                style={{
                  flex: 1, padding: '0.7rem',
                  borderRadius: 10, border: '1px solid var(--border-color)',
                  background: 'transparent', color: 'var(--text-secondary)',
                  fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={confirmDispatch}
                disabled={!dispatchPrice || parseFloat(dispatchPrice) <= 0}
                style={{
                  flex: 1, padding: '0.7rem',
                  borderRadius: 10, border: 'none',
                  background: (!dispatchPrice || parseFloat(dispatchPrice) <= 0) ? 'rgba(248,113,113,0.3)' : 'var(--danger)',
                  color: '#fff',
                  fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer',
                  opacity: (!dispatchPrice || parseFloat(dispatchPrice) <= 0) ? 0.5 : 1,
                  transition: 'all 0.15s ease',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem',
                }}
              >
                <Truck size={16} />
                Dispatch
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Transfer Stock Modal */}
      {transferModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)',
          animation: 'fadeIn 0.2s ease',
        }} onClick={() => setTransferModal(false)}>
          <div onClick={e => e.stopPropagation()} style={{
            width: '92%', maxWidth: 400,
            background: 'var(--card-bg)', border: '1px solid var(--border-color)',
            borderRadius: 16, padding: '1.5rem',
            boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
            maxHeight: '90vh', overflowY: 'auto',
          }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1.25rem' }}>
              <div style={{
                width: 40, height: 40, borderRadius: 12,
                background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.25)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <ArrowRightLeft size={20} style={{ color: '#10b981' }} />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.05rem', color: 'var(--text-primary)' }}>Transfer Stock</h3>
                <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Move spices between shops</p>
              </div>
            </div>

            {/* From / To */}
            <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem' }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.3rem' }}>From</label>
                <select value={tfFrom} onChange={e => { setTfFrom(e.target.value); if (e.target.value === tfTo) setTfTo(SHOPS.find(s => s !== e.target.value) || SHOPS[0]); }} className="input-field" style={{ padding: '0.6rem 0.75rem', fontSize: '0.85rem' }}>
                  {SHOPS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: '0.6rem' }}>
                <ArrowRightLeft size={16} style={{ color: 'var(--text-secondary)' }} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.3rem' }}>To</label>
                <select value={tfTo} onChange={e => setTfTo(e.target.value)} className="input-field" style={{ padding: '0.6rem 0.75rem', fontSize: '0.85rem' }}>
                  {SHOPS.filter(s => s !== tfFrom).map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>

            {/* Spice */}
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.3rem' }}>Spice</label>
            <select value={tfSpice} onChange={e => { setTfSpice(e.target.value); setTfQty(''); }} className="input-field" style={{ marginBottom: '1rem', padding: '0.6rem 0.75rem', fontSize: '0.85rem' }}>
              {SPICES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>

            {/* Available stock info */}
            <div style={{
              background: 'rgba(88,166,255,0.08)', border: '1px solid rgba(88,166,255,0.15)',
              borderRadius: 10, padding: '0.65rem 0.9rem', marginBottom: '1rem',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <div>
                <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>Available at {tfFrom}</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--primary-accent)' }}>
                  {tfAvailableQty.toFixed(2)} <span style={{ fontSize: '0.7rem', fontWeight: 400 }}>Kg</span>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>Avg Buy Price</div>
                <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>{formatINR(tfAvgPrice)}/Kg</div>
              </div>
            </div>

            {/* Quantity */}
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.3rem' }}>Quantity (Kg)</label>
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                max={tfAvailableQty}
                value={tfQty}
                onChange={e => setTfQty(e.target.value)}
                placeholder="Enter quantity..."
                className="input-field"
                style={{ flex: 1, padding: '0.65rem 0.85rem', fontSize: '1rem', fontWeight: 600 }}
              />
              <button
                onClick={() => setTfQty(tfAvailableQty.toFixed(2))}
                style={{
                  padding: '0.5rem 0.75rem', borderRadius: 10,
                  border: '1px solid rgba(88,166,255,0.3)',
                  background: 'rgba(88,166,255,0.1)',
                  color: 'var(--primary-accent)',
                  fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                All
              </button>
            </div>

            {/* Transfer Price */}
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.3rem' }}>Price per Kg (₹)</label>
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={tfPrice}
                onChange={e => setTfPrice(e.target.value)}
                placeholder="Enter price..."
                className="input-field"
                style={{ flex: 1, padding: '0.65rem 0.85rem', fontSize: '1rem', fontWeight: 600 }}
              />
              <button
                onClick={() => setTfPrice(tfAvgPrice.toFixed(2))}
                style={{
                  padding: '0.5rem 0.75rem', borderRadius: 10,
                  border: '1px solid rgba(16,185,129,0.3)',
                  background: 'rgba(16,185,129,0.1)',
                  color: '#10b981',
                  fontSize: '0.65rem', fontWeight: 700, cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
                title="Use current avg buy price"
              >
                Avg
              </button>
            </div>

            {/* Transfer value preview */}
            {tfQty && parseFloat(tfQty) > 0 && tfPrice && parseFloat(tfPrice) > 0 && (
              <div style={{
                padding: '0.6rem 0.75rem', marginBottom: '0.75rem',
                background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)',
                borderRadius: 8, fontSize: '0.8rem', color: '#10b981',
                display: 'flex', justifyContent: 'space-between',
              }}>
                <span>Transfer Value</span>
                <span style={{ fontWeight: 700 }}>{formatINR(parseFloat(tfQty) * parseFloat(tfPrice))}</span>
              </div>
            )}

            {/* Validation message */}
            {tfQty && parseFloat(tfQty) > tfAvailableQty && (
              <div style={{
                padding: '0.5rem 0.75rem', marginBottom: '0.75rem',
                background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.25)',
                borderRadius: 8, fontSize: '0.75rem', color: 'var(--danger)',
              }}>
                ⚠️ Exceeds available stock ({tfAvailableQty.toFixed(2)} Kg)
              </div>
            )}

            {/* Buttons */}
            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
              <button
                onClick={() => setTransferModal(false)}
                style={{
                  flex: 1, padding: '0.7rem',
                  borderRadius: 10, border: '1px solid var(--border-color)',
                  background: 'transparent', color: 'var(--text-secondary)',
                  fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleTransfer}
                disabled={!tfQty || parseFloat(tfQty) <= 0 || tfFrom === tfTo || !tfPrice || parseFloat(tfPrice) <= 0}
                style={{
                  flex: 1, padding: '0.7rem',
                  borderRadius: 10, border: 'none',
                  background: (!tfQty || parseFloat(tfQty) <= 0 || !tfPrice || parseFloat(tfPrice) <= 0) ? 'rgba(16,185,129,0.3)' : '#10b981',
                  color: '#fff',
                  fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer',
                  opacity: (!tfQty || parseFloat(tfQty) <= 0 || !tfPrice || parseFloat(tfPrice) <= 0) ? 0.5 : 1,
                  transition: 'all 0.15s ease',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem',
                }}
              >
                <ArrowRightLeft size={16} />
                Transfer
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// COMPONENTS
function Dashboard({ stats, allBranchStats, shops, selectedShop, onSelectShop, days, onDispatch, onTransfer, syncing, lastSync, onRefresh, entries, sales, shopLoads }) {
  const [showOverallAvg, setShowOverallAvg] = useState(false);
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // ── Backup Snapshot — download all data as CSV ──
  const downloadBackup = () => {
    // Build Purchases CSV
    const purchaseHeaders = ['Date', 'Shop', 'Spice', 'Qty (Kg)', 'Price/Kg', 'Total Value', 'Load ID'];
    const purchaseRows = entries
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .map(e => [
        e.date ? format(new Date(e.date), 'yyyy-MM-dd HH:mm') : '',
        e.shop || '',
        e.type || '',
        Number(e.qty).toFixed(2),
        Number(e.price).toFixed(2),
        (Number(e.qty) * Number(e.price)).toFixed(2),
        e.loadId || '',
      ]);

    // Build Sales CSV
    const saleHeaders = ['Date', 'Shop', 'Spice', 'Qty (Kg)', 'Sell Price/Kg', 'Total Value', 'Buyer', 'Load ID'];
    const saleRows = sales
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .map(s => [
        s.date ? format(new Date(s.date), 'yyyy-MM-dd HH:mm') : '',
        s.shop || '',
        s.type || '',
        Number(s.qty).toFixed(2),
        Number(s.sellPrice).toFixed(2),
        (Number(s.qty) * Number(s.sellPrice)).toFixed(2),
        (s.buyerName || '').replace(/,/g, ' '),
        s.loadId || '',
      ]);

    const escapeCSV = (val) => `"${String(val).replace(/"/g, '""')}"`;
    let csv = '';
    csv += 'PURCHASES\n';
    csv += purchaseHeaders.map(escapeCSV).join(',') + '\n';
    purchaseRows.forEach(row => { csv += row.map(escapeCSV).join(',') + '\n'; });
    csv += '\nSALES\n';
    csv += saleHeaders.map(escapeCSV).join(',') + '\n';
    saleRows.forEach(row => { csv += row.map(escapeCSV).join(',') + '\n'; });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `KVS_Backup_${format(new Date(), 'yyyy-MM-dd_HHmm')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Compute hero totals
  const totalInventoryValue = stats.reduce((s, sp) => s + (sp.remainingValue || 0), 0);
  const totalPnL = stats.reduce((s, sp) => {
    if (sp.profitPerKg !== null && sp.soldQty > 0) return s + sp.profitPerKg * sp.soldQty;
    return s;
  }, 0);

  return (
    <div style={{ animation: 'fadeIn 0.3s ease-in-out' }}>
      {/* ── Sticky App Header ── */}
      <header className="app-header">
        <div className="app-header-brand">
          <img src="/kvs-logo.png" alt="KVS" />
          <div>
            <h1 style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em', margin: 0 }}>KVS Spices</h1>
            <p style={{ fontSize: '0.58rem', color: 'var(--text-secondary)', fontWeight: 600, margin: 0 }}>{format(now, 'dd MMM yyyy, hh:mm a')}</p>
          </div>
        </div>
        <div className="app-header-actions">
          <div className="pulse-dot" style={{ marginRight: 4 }} />
          <button className="icon-btn green" onClick={downloadBackup} title="Download backup (CSV)">
            <HardDriveDownload size={16} />
          </button>
          <button
            className="icon-btn blue"
            onClick={onRefresh}
            disabled={syncing}
            title={lastSync ? `Last synced: ${format(lastSync, 'h:mm:ss a')}` : 'Refresh'}
            style={{ animation: syncing ? 'spin 1s linear infinite' : 'none' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/>
            </svg>
          </button>
        </div>
      </header>

      <div className="page-section" style={{ paddingTop: '1rem' }}>
        {/* ── Shop Selector ── */}
        <div className="shop-selector" style={{ marginBottom: '1rem' }}>
          {shops.map(shop => (
            <div
              key={shop}
              className={`shop-tab ${selectedShop === shop ? 'active' : ''}`}
              onClick={() => onSelectShop(shop)}
            >
              {shop}
            </div>
          ))}
        </div>

        {/* ── Hero Summary Card ── */}
        <div className="hero-card" style={{ marginBottom: '1rem' }}>
          <p style={{ fontSize: '0.58rem', fontWeight: 700, color: 'var(--amber)', textTransform: 'uppercase', letterSpacing: '0.22em', marginBottom: '0.5rem' }}>
            Total Inventory Value
          </p>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '2.2rem', fontWeight: 700, color: 'var(--text-1)', letterSpacing: '-0.04em', lineHeight: 1, fontFamily: "'DM Mono', monospace" }}>
              {formatINR(totalInventoryValue)}
            </span>
            {totalPnL !== 0 && (
              <div className={`pnl-badge ${totalPnL >= 0 ? 'positive' : 'negative'}`}>
                {totalPnL >= 0 ? '↑' : '↓'} {formatINR(Math.abs(totalPnL))}
              </div>
            )}
          </div>
          <p style={{ fontSize: '0.65rem', color: 'var(--text-2)', marginTop: '0.6rem', fontWeight: 500 }}>
            {selectedShop} · {format(now, 'dd MMM, hh:mm a')}
          </p>
        </div>

        {/* ── Action Buttons ── */}
        <div className="action-row" style={{ marginBottom: '1rem' }}>
          <button className="action-btn-outline" onClick={onTransfer}>
            <ArrowRightLeft size={15} />
            Transfer
          </button>
          <button
            className={`action-btn-outline blue ${showOverallAvg ? 'active' : ''}`}
            onClick={() => setShowOverallAvg(v => !v)}
          >
            <TrendingUp size={15} />
            All Branches
          </button>
        </div>

        {/* ── Overall Avg (All Branches) ── */}
        {showOverallAvg && (
          <div style={{ animation: 'fadeIn 0.2s ease', marginBottom: '1rem' }}>
            <p className="section-header muted" style={{ marginBottom: '0.6rem' }}>All-Branch Average Prices</p>
            <div className="stat-grid">
              {allBranchStats.map(spice => (
                <div key={spice.id} className="glass-card" style={{
                  padding: '0.85rem',
                  borderTop: `3px solid ${spice.color}`,
                  background: 'var(--bg-card)',
                }}>
                  <p style={{ fontSize: '0.6rem', fontWeight: 700, color: 'var(--text-2)', marginBottom: '0.3rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{spice.label}</p>
                  <div style={{ fontSize: '1.1rem', fontWeight: 700, color: spice.color, letterSpacing: '-0.02em', fontFamily: "'DM Mono', monospace" }}>
                    {formatINR(spice.avgPrice)} <span style={{ fontSize: '0.6rem', fontWeight: 400, opacity: 0.6 }}>/Kg</span>
                  </div>
                  <p style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-1)', margin: '0.35rem 0 0.3rem', fontFamily: "'DM Mono', monospace" }}>
                    {spice.totalQty.toFixed(2)} kg
                  </p>
                  <div style={{ borderTop: '1px solid var(--rim-muted)', paddingTop: '0.3rem', display: 'flex', flexDirection: 'column', gap: '0.18rem' }}>
                    {spice.perShop.map(ps => (
                      <div key={ps.shop} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.6rem', color: 'var(--text-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '60%' }}>{ps.shop}</span>
                        <span style={{ fontSize: '0.65rem', fontWeight: 600, color: ps.qty > 0 ? 'var(--text-1)' : 'var(--text-3)', fontFamily: "'DM Mono', monospace" }}>
                          {ps.qty > 0 ? `${ps.qty.toFixed(2)} kg` : '—'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Spice Cards ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {stats.map(spice => (
            <div key={spice.id} className="spice-card">
              <div className="spice-card-accent" style={{ background: spice.color }} />
              <div className="spice-card-body">
                <div className="spice-card-header">
                  <div className="spice-card-title">
                    <div className="spice-dot" style={{ background: spice.color }} />
                    {spice.label}
                  </div>
                  {spice.avgSellPrice !== null && (
                    <div className={`pnl-badge ${spice.profitPerKg >= 0 ? 'positive' : 'negative'}`} style={{ fontSize: '0.62rem', padding: '0.15rem 0.55rem' }}>
                      {spice.profitPerKg >= 0 ? '▲' : '▼'} {formatINR(Math.abs(spice.profitPerKg))}/Kg
                    </div>
                  )}
                </div>

                <div className="spice-stats-grid">
                  <div className="spice-stat-item">
                    <span className="spice-stat-label">Bought</span>
                    <span className="spice-stat-value">{spice.totalQty.toFixed(2)} <span className="unit">kg</span></span>
                  </div>
                  <div className="spice-stat-item">
                    <span className="spice-stat-label">Sold</span>
                    <span className="spice-stat-value">{spice.soldQty.toFixed(2)} <span className="unit">kg</span></span>
                  </div>
                  <div className="spice-stat-item">
                    <span className="spice-stat-label">Rem.</span>
                    <span className="spice-stat-value accent">{spice.remainingQty.toFixed(2)} <span className="unit">kg</span></span>
                  </div>
                </div>

                <div className="spice-card-footer">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
                    <span className="spice-avg-price">Buy: {formatINR(spice.avgBuyPrice)}/kg</span>
                    {spice.avgSellPrice !== null && (
                      <span className="spice-avg-price" style={{ color: 'var(--primary-ctn)' }}>Sell: {formatINR(spice.avgSellPrice)}/kg</span>
                    )}
                  </div>
                  {spice.totalQty > 0 && (
                    <button className="dispatch-btn" onClick={() => onDispatch(spice.id)}>
                      Dispatch
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AddEntry({ onAdd, shops, spices, showToast }) {
  const [shop, setShop] = useState(shops[0]);
  const [type, setType] = useState(spices[0].id);
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState('');
  const [listening, setListening] = useState(false);
  const [voiceText, setVoiceText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const recognitionRef = useRef(null);

  // ── Voice Entry via Web Speech API ──
  const toggleVoice = () => {
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) { showToast('Voice input not supported in this browser.', 'warning'); return; }
    const recognition = new SpeechRecognition();
    recognition.lang = 'en-IN';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognitionRef.current = recognition;

    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript.toLowerCase();
      setVoiceText(transcript);
      parseVoiceInput(transcript);
      setListening(false);
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);
    recognition.start();
    setListening(true);
  };

  const parseVoiceInput = (text) => {
    // Match spice
    const spiceMap = { cardamom: 'cardamom', pepper: 'pepper', nutmeg: 'nutmeg', 'nutmeg mace': 'nutmeg_mace', coffee: 'coffee', clove: 'clove' };
    for (const [keyword, id] of Object.entries(spiceMap)) {
      if (text.includes(keyword)) { setType(id); break; }
    }
    // Match shop
    const shopMap = { '20 acre': '20 Acre', 'twenty acre': '20 Acre', anachal: 'Anachal', kallar: 'Kallar' };
    for (const [keyword, name] of Object.entries(shopMap)) {
      if (text.includes(keyword)) { setShop(name); break; }
    }
    // Extract numbers — pattern: first number = qty, second = price
    const nums = text.match(/[\d]+(?:\.[\d]+)?/g);
    if (nums && nums.length >= 1) setQty(nums[0]);
    if (nums && nums.length >= 2) setPrice(nums[1]);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!qty || !price) { showToast('Please enter quantity and price.', 'error'); return; }
    setSubmitting(true);
    try {
      await onAdd({ shop, type, qty: parseFloat(qty), price: parseFloat(price), date: new Date().toISOString() });
      showToast(`Purchase recorded — ${parseFloat(qty)} kg added to ${shop}`, 'success');
      setQty('');
      setPrice('');
      setVoiceText('');
    } finally {
      setSubmitting(false);
    }
  };

  const selectedSpice = spices.find(s => s.id === type);

  return (
    <div style={{ animation: 'fadeIn 0.3s ease-in-out' }}>
      {/* Header */}
      <header className="app-header">
        <div className="app-header-brand">
          <img src="/kvs-logo.png" alt="KVS" />
          <h1 style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em', margin: 0 }}>Record Purchase</h1>
        </div>
        <div className="app-header-actions">
          <button className={`mic-btn ${listening ? 'recording' : ''}`} type="button" onClick={toggleVoice}>
            {listening ? <MicOff size={20} /> : <Mic size={20} />}
          </button>
        </div>
      </header>

      <div className="page-section" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {voiceText && (
          <div style={{ padding: '0.5rem 0.85rem', borderRadius: 10, background: 'var(--amber-glow)', border: '1px solid var(--amber-rim)', fontSize: '0.75rem', color: 'var(--amber-lt)', fontStyle: 'italic' }}>
            🎙 &ldquo;{voiceText}&rdquo;
          </div>
        )}

        {/* SELECT SHOP */}
        <div className="form-section">
          <label className="form-label">Select Shop</label>
          <div className="pill-group">
            {shops.map(s => (
              <button key={s} type="button" className={`pill-btn ${shop === s ? 'active' : ''}`} onClick={() => setShop(s)}>
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* SELECT SPICE */}
        <div className="form-section">
          <label className="form-label muted">Select Spice</label>
          <div className="spice-pill-grid">
            {spices.map(spice => (
              <button
                key={spice.id}
                type="button"
                className={`spice-pill-btn ${type === spice.id ? 'active' : ''}`}
                onClick={() => setType(spice.id)}
              >
                <div className="spice-dot" style={{ background: spice.color, width: 10, height: 10 }} />
                {spice.label}
              </button>
            ))}
          </div>
        </div>

        {/* QUANTITY & PRICE */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="input-grid-2">
            <div className="input-group">
              <label className="form-label muted">Quantity</label>
              <div className="input-field-wrap">
                <input
                  type="number" step="0.01" inputMode="decimal" className="input-field has-suffix"
                  placeholder="0.00" value={qty} onChange={e => setQty(e.target.value)}
                  autoFocus
                />
                <span className="input-suffix">kg</span>
              </div>
              <div className="quick-fill-row">
                {[10, 25, 50, 100].map(v => (
                  <button key={v} type="button" className="quick-chip" onClick={() => setQty(String(v))}>{v}</button>
                ))}
              </div>
            </div>
            <div className="input-group">
              <label className="form-label muted">Price / kg</label>
              <div className="input-field-wrap">
                <span className="input-prefix">₹</span>
                <input
                  type="number" step="0.01" inputMode="decimal" className="input-field has-prefix"
                  placeholder="0" value={price} onChange={e => setPrice(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="total-row">
            <p className="total-label">Total Value</p>
            <span className="total-value">
              {qty && price ? formatINR(parseFloat(qty) * parseFloat(price)) : '₹ —'}
            </span>
          </div>

          <div className="submit-row">
            <button type="submit" className="submit-btn" disabled={submitting}>
              {submitting
                ? <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation: 'spin 0.8s linear infinite' }}><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Saving…</>
                : <><PlusCircle size={17} /> Record Purchase</>
              }
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AddSale({ onSell, shops, spices, entries, sales, shopLoads, selectedShop, showToast }) {
  const [shop, setShop] = useState(selectedShop || shops[0]);
  const [type, setType] = useState(spices[0].id);
  const [qty, setQty] = useState('');
  const [sellPrice, setSellPrice] = useState('');
  const [buyerName, setBuyerName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const selectedSpice = spices.find(s => s.id === type);

  // Compute stock for the selected shop & spice dynamically
  const currentLoad = shopLoads[`${shop}|${type}`] || { id: '0' };
  const useLoadFilter = currentLoad._fromSheet;
  const boughtQty = entries
    .filter(e => e.shop === shop && e.type === type && (!useLoadFilter || e.loadId === currentLoad.id))
    .reduce((sum, e) => sum + Number(e.qty), 0);
  const boughtValue = entries
    .filter(e => e.shop === shop && e.type === type && (!useLoadFilter || e.loadId === currentLoad.id))
    .reduce((sum, e) => sum + Number(e.qty) * Number(e.price), 0);
  const soldQty = sales
    .filter(s => s.shop === shop && s.type === type && (!useLoadFilter || s.loadId === currentLoad.id))
    .reduce((sum, s) => sum + Number(s.qty), 0);
  const soldValue = sales
    .filter(s => s.shop === shop && s.type === type && (!useLoadFilter || s.loadId === currentLoad.id))
    .reduce((sum, s) => sum + Number(s.qty) * Number(s.sellPrice), 0);
  const availableQty = Math.max(0, boughtQty - soldQty);

  // Cost-relief method: remaining value = buy value − sale proceeds
  const remainingValue = boughtValue - soldValue;
  const avgBuyPrice = availableQty > 0 ? +(remainingValue / availableQty).toFixed(2) : (boughtQty > 0 ? +(boughtValue / boughtQty).toFixed(2) : 0);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!qty || !sellPrice) { showToast('Please enter quantity and sell price.', 'error'); return; }
    if (parseFloat(qty) > availableQty) {
      if (!confirm(`⚠️ Only ${availableQty.toFixed(2)} Kg in stock. Sell ${parseFloat(qty).toFixed(2)} Kg anyway?`)) return;
    }
    setSubmitting(true);
    try {
      await onSell({ shop, type, qty: parseFloat(qty), sellPrice: parseFloat(sellPrice), buyerName });
      showToast(`Sale recorded — ${parseFloat(qty)} kg sold from ${shop}`, 'success');
      setQty('');
      setSellPrice('');
      setBuyerName('');
    } finally {
      setSubmitting(false);
    }
  };

  const profit = qty && sellPrice && avgBuyPrice > 0
    ? ((parseFloat(sellPrice) - avgBuyPrice) * parseFloat(qty)).toFixed(2)
    : null;

  // Preview: what will the new adjusted avg be after this sale?
  const previewQty = qty ? availableQty - parseFloat(qty || 0) : 0;
  const previewValue = qty && sellPrice ? remainingValue - (parseFloat(qty) * parseFloat(sellPrice)) : 0;
  const previewAvg = previewQty > 0 ? +(previewValue / previewQty).toFixed(2) : null;

  return (
    <div style={{ animation: 'fadeIn 0.3s ease-in-out' }}>
      {/* Header */}
      <header className="app-header">
        <div className="app-header-brand">
          <img src="/kvs-logo.png" alt="KVS" />
          <h1 style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em', margin: 0 }}>Record Sale</h1>
        </div>
      </header>

      <div className="page-section" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {/* SELECT SHOP */}
        <div className="form-section">
          <label className="form-label">Select Shop</label>
          <div className="pill-group">
            {shops.map(s => (
              <button key={s} type="button" className={`pill-btn ${shop === s ? 'active' : ''}`} onClick={() => setShop(s)}>
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* SELECT SPICE */}
        <div className="form-section">
          <label className="form-label muted">Select Spice</label>
          <div className="spice-pill-grid">
            {spices.map(spice => (
              <button
                key={spice.id}
                type="button"
                className={`spice-pill-btn ${type === spice.id ? 'active' : ''}`}
                onClick={() => setType(spice.id)}
              >
                <div className="spice-dot" style={{ background: spice.color, width: 10, height: 10 }} />
                {spice.label}
              </button>
            ))}
          </div>
        </div>

        {/* AVAILABLE STOCK */}
        <div className="stock-info-bar">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
          <span style={{ flex: 1 }}>
            <strong>{availableQty.toFixed(2)} kg</strong> available in {shop}
            {availableQty > 0 && <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}> · avg {formatINR(avgBuyPrice)}/kg</span>}
          </span>
          {availableQty > 0 && <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)' }}>{formatINR(remainingValue > 0 ? remainingValue : 0)}</span>}
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* INPUTS */}
          <div className="input-grid-2">
            <div className="input-group">
              <label className="form-label muted">Quantity</label>
              <div className="input-field-wrap">
                <input
                  type="number" step="0.01" inputMode="decimal" className="input-field has-suffix"
                  placeholder="0.00" value={qty} onChange={e => setQty(e.target.value)}
                  autoFocus
                />
                <span className="input-suffix">kg</span>
              </div>
              <div className="quick-fill-row">
                {[5, 10, 25, 50].map(v => (
                  <button key={v} type="button" className="quick-chip"
                    onClick={() => setQty(String(Math.min(v, availableQty || v)))}
                  >{v}</button>
                ))}
                {availableQty > 0 && (
                  <button type="button" className="quick-chip" onClick={() => setQty(availableQty.toFixed(2))}>All</button>
                )}
              </div>
            </div>
            <div className="input-group">
              <label className="form-label muted">Sell Price / kg</label>
              <div className="input-field-wrap">
                <span className="input-prefix">₹</span>
                <input
                  type="number" step="0.01" inputMode="decimal" className="input-field has-prefix"
                  placeholder="0" value={sellPrice} onChange={e => setSellPrice(e.target.value)}
                />
              </div>
              {avgBuyPrice > 0 && (
                <div className="quick-fill-row">
                  <button type="button" className="quick-chip" onClick={() => setSellPrice(String(avgBuyPrice))}>
                    Cost ₹{avgBuyPrice}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* BUYER NAME */}
          <div className="input-group">
            <label className="form-label muted">Buyer Name (optional)</label>
            <input
              type="text" className="input-field"
              placeholder="e.g. Rajan" value={buyerName} onChange={e => setBuyerName(e.target.value)}
              style={{ borderRadius: 12 }}
            />
          </div>

          {/* TOTAL + P&L preview */}
          <div className="total-row">
            <div>
              <p className="total-label">Total Value</p>
              {profit !== null && (
                <span style={{ fontSize: '0.72rem', fontWeight: 700, color: parseFloat(profit) >= 0 ? 'var(--lime-dk)' : 'var(--chili-lt)', fontFamily: "'DM Mono', monospace" }}>
                  {parseFloat(profit) >= 0 ? '▲' : '▼'} {formatINR(Math.abs(parseFloat(profit)))} {parseFloat(profit) >= 0 ? 'profit' : 'loss'}
                </span>
              )}
            </div>
            <span className="total-value">
              {qty && sellPrice ? formatINR(parseFloat(qty) * parseFloat(sellPrice)) : '₹ —'}
            </span>
          </div>

          {/* After-sale preview */}
          {previewAvg !== null && qty && sellPrice && parseFloat(qty) > 0 && (
            <div style={{ padding: '0.65rem 0.85rem', borderRadius: 10, background: 'var(--bg-raised)', border: '1px solid var(--rim)', display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', gap: '0.5rem', fontFamily: "'DM Mono', monospace" }}>
              <span style={{ color: 'var(--text-2)' }}>After: {previewQty.toFixed(2)} kg · {formatINR(previewValue > 0 ? Math.round(previewValue) : 0)}</span>
              <span style={{ fontWeight: 600, color: previewAvg < avgBuyPrice ? 'var(--lime-dk)' : previewAvg > avgBuyPrice ? 'var(--chili-lt)' : 'var(--text-1)' }}>
                avg {formatINR(previewAvg)}/kg
              </span>
            </div>
          )}

          <div className="submit-row">
            <button type="submit" className="submit-btn sell" disabled={submitting}>
              {submitting
                ? <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation: 'spin 0.8s linear infinite' }}><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Saving…</>
                : <><ShoppingBag size={17} /> Record Sale</>
              }
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Daily Purchase Summary Component ──
function DailyPurchases({ entries, sales, shops, spices, selectedShop, onSelectShop }) {
  const today = format(new Date(), 'yyyy-MM-dd');
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);
  const [viewMode, setViewMode] = useState('all'); // 'all' shops or specific shop
  const [expandedDate, setExpandedDate] = useState(null);

  // Quick presets
  const setPreset = (preset) => {
    const now = new Date();
    const fmt = (d) => format(d, 'yyyy-MM-dd');
    if (preset === 'today') { setDateFrom(fmt(now)); setDateTo(fmt(now)); }
    else if (preset === 'yesterday') {
      const y = new Date(now); y.setDate(y.getDate() - 1);
      setDateFrom(fmt(y)); setDateTo(fmt(y));
    }
    else if (preset === 'week') {
      const w = new Date(now); w.setDate(w.getDate() - 6);
      setDateFrom(fmt(w)); setDateTo(fmt(now));
    }
    else if (preset === 'month') {
      const m = new Date(now.getFullYear(), now.getMonth(), 1);
      setDateFrom(fmt(m)); setDateTo(fmt(now));
    }
  };

  // Filter entries by date range and shop
  const dateFilter = (item) => {
    if (!item.date) return false;
    const itemDate = new Date(item.date);
    if (dateFrom) { const from = new Date(dateFrom); from.setHours(0, 0, 0, 0); if (itemDate < from) return false; }
    if (dateTo) { const to = new Date(dateTo); to.setHours(23, 59, 59, 999); if (itemDate > to) return false; }
    return true;
  };

  const shopFilter = (item) => viewMode === 'all' || item.shop === selectedShop;

  const filteredEntries = entries.filter(e => dateFilter(e) && shopFilter(e));
  const filteredSales = sales.filter(s => dateFilter(s) && shopFilter(s));

  // Group entries by date
  const groupByDate = (items) => {
    const groups = {};
    items.forEach(item => {
      const dateKey = format(new Date(item.date), 'yyyy-MM-dd');
      if (!groups[dateKey]) groups[dateKey] = [];
      groups[dateKey].push(item);
    });
    return groups;
  };

  const purchasesByDate = groupByDate(filteredEntries);
  const salesByDate = groupByDate(filteredSales);

  // Get all unique dates, sorted newest first
  const allDates = [...new Set([
    ...Object.keys(purchasesByDate),
    ...Object.keys(salesByDate),
  ])].sort((a, b) => new Date(b) - new Date(a));

  // Build daily summary for each date
  const dailySummaries = allDates.map(dateKey => {
    const dayPurchases = purchasesByDate[dateKey] || [];
    const daySales = salesByDate[dateKey] || [];

    // Per-spice breakdown
    const spiceBreakdown = spices.map(spice => {
      const sp = dayPurchases.filter(e => e.type === spice.id);
      const ss = daySales.filter(s => s.type === spice.id);
      const buyQty = sp.reduce((sum, e) => sum + Number(e.qty), 0);
      const buyValue = sp.reduce((sum, e) => sum + Number(e.qty) * Number(e.price), 0);
      const avgBuyPrice = buyQty > 0 ? +(buyValue / buyQty).toFixed(2) : 0;
      const sellQty = ss.reduce((sum, s) => sum + Number(s.qty), 0);
      const sellValue = ss.reduce((sum, s) => sum + Number(s.qty) * Number(s.sellPrice), 0);
      const avgSellPrice = sellQty > 0 ? +(sellValue / sellQty).toFixed(2) : 0;
      return { ...spice, buyQty, buyValue, avgBuyPrice, sellQty, sellValue, avgSellPrice };
    }).filter(s => s.buyQty > 0 || s.sellQty > 0);

    // Per-shop breakdown (when viewing all shops)
    const shopBreakdown = viewMode === 'all' ? shops.map(shop => {
      const sp = dayPurchases.filter(e => e.shop === shop);
      const ss = daySales.filter(s => s.shop === shop);
      const buyQty = sp.reduce((sum, e) => sum + Number(e.qty), 0);
      const buyValue = sp.reduce((sum, e) => sum + Number(e.qty) * Number(e.price), 0);
      const sellQty = ss.reduce((sum, s) => sum + Number(s.qty), 0);
      const sellValue = ss.reduce((sum, s) => sum + Number(s.qty) * Number(s.sellPrice), 0);
      return { shop, buyQty, buyValue, sellQty, sellValue };
    }).filter(s => s.buyQty > 0 || s.sellQty > 0) : [];

    const totalBuyQty = dayPurchases.reduce((sum, e) => sum + Number(e.qty), 0);
    const totalBuyValue = dayPurchases.reduce((sum, e) => sum + Number(e.qty) * Number(e.price), 0);
    const totalSellQty = daySales.reduce((sum, s) => sum + Number(s.qty), 0);
    const totalSellValue = daySales.reduce((sum, s) => sum + Number(s.qty) * Number(s.sellPrice), 0);

    return {
      dateKey,
      dateLabel: format(new Date(dateKey), 'EEE, dd MMM yyyy'),
      spiceBreakdown,
      shopBreakdown,
      totalBuyQty,
      totalBuyValue,
      totalSellQty,
      totalSellValue,
      purchaseCount: dayPurchases.length,
      saleCount: daySales.length,
      purchases: dayPurchases,
      sales: daySales,
    };
  });

  // Grand totals across all filtered dates
  const grandTotalBuyQty = filteredEntries.reduce((sum, e) => sum + Number(e.qty), 0);
  const grandTotalBuyValue = filteredEntries.reduce((sum, e) => sum + Number(e.qty) * Number(e.price), 0);
  const grandTotalSellQty = filteredSales.reduce((sum, s) => sum + Number(s.qty), 0);
  const grandTotalSellValue = filteredSales.reduce((sum, s) => sum + Number(s.qty) * Number(s.sellPrice), 0);
  const grandAvgBuyPrice = grandTotalBuyQty > 0 ? +(grandTotalBuyValue / grandTotalBuyQty).toFixed(2) : 0;

  // ── Monthly Comparison — this month vs last month ──
  const [showMonthlyComparison, setShowMonthlyComparison] = useState(false);

  const buildMonthStats = (monthStart, monthEnd) => {
    const inRange = (item) => {
      if (!item.date) return false;
      const d = new Date(item.date);
      return d >= monthStart && d <= monthEnd;
    };
    const shopF = (item) => viewMode === 'all' || item.shop === selectedShop;
    const mEntries = entries.filter(e => inRange(e) && shopF(e));
    const mSales = sales.filter(s => inRange(s) && shopF(s));

    const totalBuyQty = mEntries.reduce((s, e) => s + Number(e.qty), 0);
    const totalBuyValue = mEntries.reduce((s, e) => s + Number(e.qty) * Number(e.price), 0);
    const avgBuyPrice = totalBuyQty > 0 ? +(totalBuyValue / totalBuyQty).toFixed(2) : 0;
    const totalSellQty = mSales.reduce((s, e) => s + Number(e.qty), 0);
    const totalSellValue = mSales.reduce((s, e) => s + Number(e.qty) * Number(e.sellPrice), 0);

    const perSpice = spices.map(spice => {
      const sp = mEntries.filter(e => e.type === spice.id);
      const sq = sp.reduce((s, e) => s + Number(e.qty), 0);
      const sv = sp.reduce((s, e) => s + Number(e.qty) * Number(e.price), 0);
      return { ...spice, qty: sq, value: sv, avg: sq > 0 ? +(sv / sq).toFixed(2) : 0 };
    }).filter(s => s.qty > 0);

    return { totalBuyQty, totalBuyValue, avgBuyPrice, totalSellQty, totalSellValue, perSpice, entryCount: mEntries.length };
  };

  const now = new Date();
  const thisMonthStart = startOfMonth(now);
  const thisMonthEnd = now;
  const lastMonthStart = startOfMonth(subMonths(now, 1));
  const lastMonthEnd = endOfMonth(subMonths(now, 1));

  const thisMonth = buildMonthStats(thisMonthStart, thisMonthEnd);
  const lastMonth = buildMonthStats(lastMonthStart, lastMonthEnd);

  return (
    <div style={{ animation: 'fadeIn 0.3s ease-in-out' }}>
      {/* Header */}
      <header className="app-header">
        <div className="app-header-brand">
          <img src="/kvs-logo.png" alt="KVS" />
          <h1 style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em', margin: 0 }}>Daily Summary</h1>
        </div>
      </header>

      <div className="page-section" style={{ paddingTop: '1rem' }}>
      {/* ── Shop Mode Toggle ── */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <button
          onClick={() => setViewMode('all')}
          style={{
            flex: 1, padding: '0.5rem', borderRadius: 10, fontSize: '0.78rem', fontWeight: 700,
            border: viewMode === 'all' ? '1px solid var(--primary-ctn)' : '1px solid rgba(60,74,66,0.3)',
            background: viewMode === 'all' ? 'rgba(52,211,153,0.1)' : 'var(--bg-high)',
            color: viewMode === 'all' ? 'var(--primary-ctn)' : 'var(--text-secondary)',
            cursor: 'pointer', transition: 'all 0.15s ease', fontFamily: 'Manrope, sans-serif',
          }}
        >
          All Shops
        </button>
        <button
          onClick={() => setViewMode('shop')}
          style={{
            flex: 1, padding: '0.5rem', borderRadius: 10, fontSize: '0.78rem', fontWeight: 700,
            border: viewMode === 'shop' ? '1px solid var(--primary-ctn)' : '1px solid rgba(60,74,66,0.3)',
            background: viewMode === 'shop' ? 'rgba(52,211,153,0.1)' : 'var(--bg-high)',
            color: viewMode === 'shop' ? 'var(--primary-ctn)' : 'var(--text-secondary)',
            cursor: 'pointer', transition: 'all 0.15s ease', fontFamily: 'Manrope, sans-serif',
          }}
        >
          Per Shop
        </button>
      </div>

      {/* Shop selector (when per-shop mode) */}
      {viewMode === 'shop' && (
        <div className="shop-selector" style={{ marginBottom: '0.5rem' }}>
          {shops.map(shop => (
            <div
              key={shop}
              className={`shop-tab ${selectedShop === shop ? 'active' : ''}`}
              onClick={() => onSelectShop(shop)}
            >
              {shop}
            </div>
          ))}
        </div>
      )}

      {/* ── Date Range Filter ── */}
      <div className="glass-card" style={{ marginBottom: '1rem', padding: '1rem 1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
          <Filter size={16} style={{ color: 'var(--primary-accent)' }} />
          <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>Date Range</span>
        </div>

        {/* Quick presets */}
        <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
          {[
            { key: 'today', label: 'Today' },
            { key: 'yesterday', label: 'Yesterday' },
            { key: 'week', label: 'Last 7 Days' },
            { key: 'month', label: 'This Month' },
          ].map(p => {
            const isActive = (() => {
              const now = new Date();
              const fmt = (d) => format(d, 'yyyy-MM-dd');
              if (p.key === 'today') return dateFrom === fmt(now) && dateTo === fmt(now);
              if (p.key === 'yesterday') { const y = new Date(now); y.setDate(y.getDate()-1); return dateFrom === fmt(y) && dateTo === fmt(y); }
              if (p.key === 'week') { const w = new Date(now); w.setDate(w.getDate()-6); return dateFrom === fmt(w) && dateTo === fmt(now); }
              if (p.key === 'month') { const m = new Date(now.getFullYear(), now.getMonth(), 1); return dateFrom === fmt(m) && dateTo === fmt(now); }
              return false;
            })();
            return (
              <button
                key={p.key}
                onClick={() => setPreset(p.key)}
                style={{
                  padding: '0.35rem 0.7rem', borderRadius: 8, fontSize: '0.72rem', fontWeight: 600,
                  border: isActive ? '1px solid var(--primary-accent)' : '1px solid rgba(255,255,255,0.1)',
                  background: isActive ? 'rgba(88,166,255,0.15)' : 'rgba(255,255,255,0.04)',
                  color: isActive ? 'var(--primary-accent)' : 'var(--text-secondary)',
                  cursor: 'pointer', transition: 'all 0.15s ease',
                }}
              >
                {p.label}
              </button>
            );
          })}
        </div>

        {/* Date inputs */}
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 130 }}>
            <label style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              style={{
                width: '100%', padding: '0.5rem', borderRadius: 8,
                border: '1px solid rgba(255,255,255,0.1)',
                background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)',
                fontSize: '0.85rem',
              }}
            />
          </div>
          <div style={{ flex: 1, minWidth: 130 }}>
            <label style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>To</label>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              style={{
                width: '100%', padding: '0.5rem', borderRadius: 8,
                border: '1px solid rgba(255,255,255,0.1)',
                background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)',
                fontSize: '0.85rem',
              }}
            />
          </div>
        </div>
      </div>

      {/* ── Grand Totals Card ── */}
      {(grandTotalBuyQty > 0 || grandTotalSellQty > 0) && (
        <div className="glass-card" style={{ marginBottom: '1.25rem', padding: '1rem 1.25rem' }}>
          <h3 style={{ fontSize: '0.8rem', fontWeight: 700, color: '#4caf50', marginBottom: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Period Totals — {allDates.length} day{allDates.length !== 1 ? 's' : ''}
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
            <div style={{ background: 'rgba(59,130,246,0.08)', borderRadius: 10, padding: '0.6rem 0.75rem', border: '1px solid rgba(59,130,246,0.15)' }}>
              <div style={{ fontSize: '0.6rem', color: 'var(--text-secondary)', marginBottom: '0.15rem' }}>Purchased</div>
              <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#58a6ff' }}>{grandTotalBuyQty.toFixed(2)} Kg</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>{formatINR(grandTotalBuyValue)}</div>
            </div>
            <div style={{ background: 'rgba(76,175,80,0.08)', borderRadius: 10, padding: '0.6rem 0.75rem', border: '1px solid rgba(76,175,80,0.15)' }}>
              <div style={{ fontSize: '0.6rem', color: 'var(--text-secondary)', marginBottom: '0.15rem' }}>Avg Buy Price</div>
              <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#4caf50' }}>{formatINR(grandAvgBuyPrice)}</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>per Kg</div>
            </div>
            {grandTotalSellQty > 0 && (
              <>
                <div style={{ background: 'rgba(16,185,129,0.08)', borderRadius: 10, padding: '0.6rem 0.75rem', border: '1px solid rgba(16,185,129,0.15)' }}>
                  <div style={{ fontSize: '0.6rem', color: 'var(--text-secondary)', marginBottom: '0.15rem' }}>Sold</div>
                  <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#10b981' }}>{grandTotalSellQty.toFixed(2)} Kg</div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>{formatINR(grandTotalSellValue)}</div>
                </div>
                <div style={{
                  background: grandTotalSellValue - grandTotalBuyValue >= 0 ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)',
                  borderRadius: 10, padding: '0.6rem 0.75rem',
                  border: `1px solid ${grandTotalSellValue - grandTotalBuyValue >= 0 ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)'}`,
                }}>
                  <div style={{ fontSize: '0.6rem', color: 'var(--text-secondary)', marginBottom: '0.15rem' }}>Net P&L</div>
                  <div style={{
                    fontSize: '1.05rem', fontWeight: 800,
                    color: grandTotalSellValue - grandTotalBuyValue >= 0 ? '#10b981' : '#f87171',
                  }}>
                    {grandTotalSellValue - grandTotalBuyValue >= 0 ? '+' : ''}{formatINR(grandTotalSellValue - grandTotalBuyValue)}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Grand per-spice avg breakdown */}
          <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', marginBottom: '0.4rem', fontWeight: 600 }}>SPICE-WISE AVG BUY PRICE</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
              {spices.map(spice => {
                const sp = filteredEntries.filter(e => e.type === spice.id);
                const qty = sp.reduce((s, e) => s + Number(e.qty), 0);
                const val = sp.reduce((s, e) => s + Number(e.qty) * Number(e.price), 0);
                if (qty <= 0) return null;
                return (
                  <div key={spice.id} style={{
                    background: `${spice.color}15`, border: `1px solid ${spice.color}30`,
                    borderRadius: 8, padding: '0.3rem 0.6rem',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 72,
                  }}>
                    <span style={{ fontSize: '0.6rem', color: spice.color, fontWeight: 700 }}>{spice.label}</span>
                    <span style={{ fontSize: '0.85rem', fontWeight: 800, color: 'var(--text-primary)' }}>{formatINR((val / qty).toFixed(2))}</span>
                    <span style={{ fontSize: '0.55rem', color: 'var(--text-secondary)' }}>{qty.toFixed(2)} Kg</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Compare Button ── */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <button
          onClick={() => setShowMonthlyComparison(v => !v)}
          style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
            padding: '0.65rem 0.75rem', borderRadius: 12,
            background: showMonthlyComparison ? 'rgba(168,85,247,0.2)' : 'rgba(168,85,247,0.08)',
            border: `1px solid ${showMonthlyComparison ? 'rgba(168,85,247,0.5)' : 'rgba(168,85,247,0.25)'}`,
            color: '#a855f7', fontSize: '0.82rem', fontWeight: 600,
            cursor: 'pointer', transition: 'all 0.15s ease',
          }}
        >
          <BarChart3 size={17} />
          Monthly Compare
        </button>
      </div>

      {/* ── Monthly Comparison Panel ── */}
      {showMonthlyComparison && (
        <div className="glass-card" style={{ marginBottom: '1.25rem', padding: '1rem 1.25rem', animation: 'fadeIn 0.2s ease-in-out' }}>
          <h3 style={{ fontSize: '0.8rem', fontWeight: 700, color: '#a855f7', marginBottom: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            <BarChart3 size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
            {format(thisMonthStart, 'MMMM yyyy')} vs {format(lastMonthStart, 'MMMM yyyy')}
          </h3>

          {/* Side-by-side totals */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '0.75rem' }}>
            {/* This month */}
            <div style={{ background: 'rgba(168,85,247,0.08)', borderRadius: 10, padding: '0.6rem 0.75rem', border: '1px solid rgba(168,85,247,0.15)' }}>
              <div style={{ fontSize: '0.6rem', color: '#a855f7', fontWeight: 700, marginBottom: '0.25rem' }}>
                {format(thisMonthStart, 'MMM yyyy')}
              </div>
              <div style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--text-primary)' }}>{thisMonth.totalBuyQty.toFixed(1)} Kg</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{formatINR(thisMonth.totalBuyValue)}</div>
              <div style={{ fontSize: '0.7rem', color: '#a855f7', fontWeight: 600, marginTop: '0.15rem' }}>Avg {formatINR(thisMonth.avgBuyPrice)}/Kg</div>
              <div style={{ fontSize: '0.6rem', color: 'var(--text-secondary)', marginTop: '0.1rem' }}>{thisMonth.entryCount} entries</div>
            </div>
            {/* Last month */}
            <div style={{ background: 'rgba(100,116,139,0.08)', borderRadius: 10, padding: '0.6rem 0.75rem', border: '1px solid rgba(100,116,139,0.15)' }}>
              <div style={{ fontSize: '0.6rem', color: '#94a3b8', fontWeight: 700, marginBottom: '0.25rem' }}>
                {format(lastMonthStart, 'MMM yyyy')}
              </div>
              <div style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--text-primary)' }}>{lastMonth.totalBuyQty.toFixed(1)} Kg</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{formatINR(lastMonth.totalBuyValue)}</div>
              <div style={{ fontSize: '0.7rem', color: '#94a3b8', fontWeight: 600, marginTop: '0.15rem' }}>Avg {formatINR(lastMonth.avgBuyPrice)}/Kg</div>
              <div style={{ fontSize: '0.6rem', color: 'var(--text-secondary)', marginTop: '0.1rem' }}>{lastMonth.entryCount} entries</div>
            </div>
          </div>

          {/* Change indicators */}
          {lastMonth.totalBuyQty > 0 && thisMonth.totalBuyQty > 0 && (
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
              {(() => {
                const qtyChange = ((thisMonth.totalBuyQty - lastMonth.totalBuyQty) / lastMonth.totalBuyQty * 100).toFixed(1);
                const priceChange = ((thisMonth.avgBuyPrice - lastMonth.avgBuyPrice) / lastMonth.avgBuyPrice * 100).toFixed(1);
                const spendChange = ((thisMonth.totalBuyValue - lastMonth.totalBuyValue) / lastMonth.totalBuyValue * 100).toFixed(1);
                return [
                  { label: 'Qty', change: qtyChange, up: Number(qtyChange) >= 0 },
                  { label: 'Avg Price', change: priceChange, up: Number(priceChange) >= 0 },
                  { label: 'Spend', change: spendChange, up: Number(spendChange) >= 0 },
                ].map(c => (
                  <div key={c.label} style={{
                    flex: 1, minWidth: 80, textAlign: 'center',
                    background: c.up ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)',
                    border: `1px solid ${c.up ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'}`,
                    borderRadius: 8, padding: '0.35rem 0.5rem',
                  }}>
                    <div style={{ fontSize: '0.6rem', color: 'var(--text-secondary)' }}>{c.label}</div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 800, color: c.up ? '#10b981' : '#f87171' }}>
                      {c.up ? '▲' : '▼'} {Math.abs(Number(c.change))}%
                    </div>
                  </div>
                ));
              })()}
            </div>
          )}

          {/* Per-spice comparison table */}
          {(thisMonth.perSpice.length > 0 || lastMonth.perSpice.length > 0) && (
            <div style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid rgba(255,255,255,0.06)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem' }}>
                <thead>
                  <tr style={{ background: 'rgba(30,38,50,0.8)' }}>
                    <th style={{ padding: '0.5rem 0.4rem', color: '#a855f7', fontWeight: 700, textAlign: 'left', fontSize: '0.65rem' }}>Spice</th>
                    <th style={{ padding: '0.5rem 0.4rem', color: '#a855f7', fontWeight: 700, textAlign: 'right', fontSize: '0.65rem' }}>This Month</th>
                    <th style={{ padding: '0.5rem 0.4rem', color: '#94a3b8', fontWeight: 700, textAlign: 'right', fontSize: '0.65rem' }}>Last Month</th>
                    <th style={{ padding: '0.5rem 0.4rem', color: '#a855f7', fontWeight: 700, textAlign: 'right', fontSize: '0.65rem' }}>Avg Now</th>
                    <th style={{ padding: '0.5rem 0.4rem', color: '#94a3b8', fontWeight: 700, textAlign: 'right', fontSize: '0.65rem' }}>Avg Then</th>
                    <th style={{ padding: '0.5rem 0.4rem', color: 'var(--text-secondary)', fontWeight: 700, textAlign: 'right', fontSize: '0.65rem' }}>Change</th>
                  </tr>
                </thead>
                <tbody>
                  {spices.map((spice, i) => {
                    const tm = thisMonth.perSpice.find(s => s.id === spice.id);
                    const lm = lastMonth.perSpice.find(s => s.id === spice.id);
                    if (!tm && !lm) return null;
                    const tmQty = tm ? tm.qty : 0;
                    const lmQty = lm ? lm.qty : 0;
                    const tmAvg = tm ? tm.avg : 0;
                    const lmAvg = lm ? lm.avg : 0;
                    const change = lmAvg > 0 ? ((tmAvg - lmAvg) / lmAvg * 100).toFixed(1) : null;
                    return (
                      <tr key={spice.id} style={{ background: i % 2 === 0 ? 'rgba(22,27,34,0.6)' : 'rgba(18,22,30,0.6)' }}>
                        <td style={{ padding: '0.45rem 0.4rem', fontWeight: 700, color: spice.color, whiteSpace: 'nowrap' }}>{spice.label}</td>
                        <td style={{ padding: '0.45rem 0.4rem', textAlign: 'right', color: 'var(--text-primary)' }}>{tmQty > 0 ? `${tmQty.toFixed(1)} Kg` : '-'}</td>
                        <td style={{ padding: '0.45rem 0.4rem', textAlign: 'right', color: 'var(--text-secondary)' }}>{lmQty > 0 ? `${lmQty.toFixed(1)} Kg` : '-'}</td>
                        <td style={{ padding: '0.45rem 0.4rem', textAlign: 'right', color: 'var(--text-primary)', fontWeight: 600 }}>{tmAvg > 0 ? formatINR(tmAvg) : '-'}</td>
                        <td style={{ padding: '0.45rem 0.4rem', textAlign: 'right', color: 'var(--text-secondary)' }}>{lmAvg > 0 ? formatINR(lmAvg) : '-'}</td>
                        <td style={{
                          padding: '0.45rem 0.4rem', textAlign: 'right', fontWeight: 700,
                          color: change === null ? 'var(--text-secondary)' : Number(change) <= 0 ? '#10b981' : '#f87171',
                        }}>
                          {change === null ? '-' : `${Number(change) > 0 ? '+' : ''}${change}%`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {thisMonth.totalBuyQty === 0 && lastMonth.totalBuyQty === 0 && (
            <p style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.8rem', padding: '0.5rem 0' }}>
              No purchase data for this or last month.
            </p>
          )}
        </div>
      )}

      {/* ── Daily Breakdown Cards ── */}
      {allDates.length === 0 ? (
        <div className="glass-card" style={{ padding: '2rem', textAlign: 'center' }}>
          <CalendarDays size={40} style={{ color: 'var(--text-secondary)', marginBottom: '0.75rem' }} />
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>No records found for this date range.</p>
        </div>
      ) : (
        dailySummaries.map(day => {
          const isExpanded = expandedDate === day.dateKey;
          return (
            <div
              key={day.dateKey}
              className="glass-card"
              style={{
                marginBottom: '0.75rem',
                padding: 0,
                overflow: 'hidden',
                border: isExpanded ? '1px solid rgba(88,166,255,0.25)' : '1px solid rgba(255,255,255,0.06)',
                transition: 'border-color 0.2s ease',
              }}
            >
              {/* Day header — clickable to expand */}
              <div
                onClick={() => setExpandedDate(isExpanded ? null : day.dateKey)}
                style={{
                  padding: '0.85rem 1.1rem',
                  cursor: 'pointer',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  background: isExpanded ? 'rgba(88,166,255,0.06)' : 'transparent',
                  transition: 'background 0.15s ease',
                }}
              >
                <div>
                  <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    {day.dateLabel}
                  </div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
                    {day.purchaseCount} purchase{day.purchaseCount !== 1 ? 's' : ''}
                    {day.saleCount > 0 && ` • ${day.saleCount} sale${day.saleCount !== 1 ? 's' : ''}`}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  {day.totalBuyQty > 0 && (
                    <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#58a6ff' }}>
                      {day.totalBuyQty.toFixed(2)} Kg
                    </div>
                  )}
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                    {formatINR(day.totalBuyValue)}
                  </div>
                  <span style={{
                    fontSize: '0.85rem', color: 'var(--text-secondary)',
                    transition: 'transform 0.2s ease',
                    display: 'inline-block',
                    transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                  }}>
                    ▼
                  </span>
                </div>
              </div>

              {/* Expanded details */}
              {isExpanded && (
                <div style={{ padding: '0 1.1rem 1rem', animation: 'fadeIn 0.2s ease-in-out' }}>
                  {/* Spice breakdown table */}
                  {day.spiceBreakdown.length > 0 && (
                    <div style={{ marginBottom: '0.75rem' }}>
                      <div style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid rgba(255,255,255,0.06)' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem' }}>
                          <thead>
                            <tr style={{ background: 'rgba(30,38,50,0.8)' }}>
                              <th style={{ padding: '0.5rem 0.4rem', color: '#4caf50', fontWeight: 700, textAlign: 'left', fontSize: '0.65rem' }}>Spice</th>
                              <th style={{ padding: '0.5rem 0.4rem', color: '#4caf50', fontWeight: 700, textAlign: 'right', fontSize: '0.65rem' }}>Buy Qty</th>
                              <th style={{ padding: '0.5rem 0.4rem', color: '#4caf50', fontWeight: 700, textAlign: 'right', fontSize: '0.65rem' }}>Avg ₹/Kg</th>
                              <th style={{ padding: '0.5rem 0.4rem', color: '#4caf50', fontWeight: 700, textAlign: 'right', fontSize: '0.65rem' }}>Total ₹</th>
                              {day.totalSellQty > 0 && (
                                <>
                                  <th style={{ padding: '0.5rem 0.4rem', color: '#10b981', fontWeight: 700, textAlign: 'right', fontSize: '0.65rem' }}>Sold</th>
                                  <th style={{ padding: '0.5rem 0.4rem', color: '#10b981', fontWeight: 700, textAlign: 'right', fontSize: '0.65rem' }}>Sell Avg</th>
                                </>
                              )}
                            </tr>
                          </thead>
                          <tbody>
                            {day.spiceBreakdown.map((s, i) => (
                              <tr key={s.id} style={{ background: i % 2 === 0 ? 'rgba(22,27,34,0.6)' : 'rgba(18,22,30,0.6)' }}>
                                <td style={{ padding: '0.45rem 0.4rem', fontWeight: 700, color: s.color, whiteSpace: 'nowrap' }}>{s.label}</td>
                                <td style={{ padding: '0.45rem 0.4rem', textAlign: 'right', color: s.buyQty > 0 ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                                  {s.buyQty > 0 ? s.buyQty.toFixed(2) : '-'}
                                </td>
                                <td style={{ padding: '0.45rem 0.4rem', textAlign: 'right', color: 'var(--text-secondary)' }}>
                                  {s.buyQty > 0 ? formatINR(s.avgBuyPrice) : '-'}
                                </td>
                                <td style={{ padding: '0.45rem 0.4rem', textAlign: 'right', fontWeight: 700, color: 'var(--text-primary)' }}>
                                  {s.buyValue > 0 ? formatINR(s.buyValue) : '-'}
                                </td>
                                {day.totalSellQty > 0 && (
                                  <>
                                    <td style={{ padding: '0.45rem 0.4rem', textAlign: 'right', color: s.sellQty > 0 ? '#10b981' : 'var(--text-secondary)' }}>
                                      {s.sellQty > 0 ? s.sellQty.toFixed(2) : '-'}
                                    </td>
                                    <td style={{ padding: '0.45rem 0.4rem', textAlign: 'right', color: 'var(--text-secondary)' }}>
                                      {s.sellQty > 0 ? formatINR(s.avgSellPrice) : '-'}
                                    </td>
                                  </>
                                )}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Shop breakdown (when viewing all shops) */}
                  {viewMode === 'all' && day.shopBreakdown.length > 1 && (
                    <div style={{ marginBottom: '0.75rem' }}>
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', marginBottom: '0.4rem', fontWeight: 600 }}>PER SHOP</div>
                      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                        {day.shopBreakdown.map(sb => (
                          <div key={sb.shop} style={{
                            flex: 1, minWidth: 90,
                            background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '0.45rem 0.6rem',
                            border: '1px solid rgba(255,255,255,0.06)',
                          }}>
                            <div style={{ fontSize: '0.65rem', color: 'var(--primary-accent)', fontWeight: 700, marginBottom: '0.15rem' }}>{sb.shop}</div>
                            {sb.buyQty > 0 && (
                              <div style={{ fontSize: '0.72rem', color: 'var(--text-primary)' }}>
                                ↓ {sb.buyQty.toFixed(2)} Kg • {formatINR(sb.buyValue)}
                              </div>
                            )}
                            {sb.sellQty > 0 && (
                              <div style={{ fontSize: '0.72rem', color: '#10b981' }}>
                                ↑ {sb.sellQty.toFixed(2)} Kg • {formatINR(sb.sellValue)}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Individual purchase records */}
                  {day.purchases.length > 0 && (
                    <div>
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', marginBottom: '0.35rem', fontWeight: 600 }}>PURCHASE RECORDS</div>
                      {day.purchases.sort((a, b) => new Date(b.date) - new Date(a.date)).map((e, i) => (
                        <div key={e.id || i} style={{
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                          padding: '0.4rem 0', borderBottom: i < day.purchases.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                        }}>
                          <div>
                            <span style={{
                              fontSize: '0.6rem', fontWeight: 700, padding: '0.1rem 0.35rem',
                              borderRadius: 5, background: 'rgba(59,130,246,0.12)', color: '#58a6ff',
                              marginRight: '0.4rem',
                            }}>
                              ↓ BUY
                            </span>
                            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                              {(spices.find(s => s.id === e.type)?.label || e.type)} — {Number(e.qty).toFixed(2)} Kg
                            </span>
                            {viewMode === 'all' && (
                              <span style={{ fontSize: '0.62rem', color: 'var(--text-secondary)', marginLeft: '0.3rem' }}>@ {e.shop}</span>
                            )}
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                              {formatINR(Number(e.price))}/Kg
                            </div>
                            <div style={{ fontSize: '0.62rem', color: 'var(--text-secondary)' }}>
                              {format(new Date(e.date), 'h:mm a')}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Individual sale records */}
                  {day.sales.length > 0 && (
                    <div style={{ marginTop: '0.5rem' }}>
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', marginBottom: '0.35rem', fontWeight: 600 }}>SALE RECORDS</div>
                      {day.sales.sort((a, b) => new Date(b.date) - new Date(a.date)).map((s, i) => (
                        <div key={s.id || i} style={{
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                          padding: '0.4rem 0', borderBottom: i < day.sales.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                        }}>
                          <div>
                            <span style={{
                              fontSize: '0.6rem', fontWeight: 700, padding: '0.1rem 0.35rem',
                              borderRadius: 5, background: 'rgba(16,185,129,0.12)', color: '#10b981',
                              marginRight: '0.4rem',
                            }}>
                              ↑ SALE
                            </span>
                            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                              {(spices.find(sp => sp.id === s.type)?.label || s.type)} — {Number(s.qty).toFixed(2)} Kg
                            </span>
                            {s.buyerName && <span style={{ fontSize: '0.62rem', color: 'var(--text-secondary)', marginLeft: '0.3rem' }}>→ {s.buyerName}</span>}
                            {viewMode === 'all' && (
                              <span style={{ fontSize: '0.62rem', color: 'var(--text-secondary)', marginLeft: '0.3rem' }}>@ {s.shop}</span>
                            )}
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#10b981' }}>
                              {formatINR(Number(s.sellPrice))}/Kg
                            </div>
                            <div style={{ fontSize: '0.62rem', color: 'var(--text-secondary)' }}>
                              {format(new Date(s.date), 'h:mm a')}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })
      )}
      </div>{/* end page-section */}
    </div>
  );
}

function History({ entries, sales, selectedShop, onSelectShop, shops, spices, shopLoads, onDeleteEntry, onDeleteSale, onEditEntry, onEditSale }) {
  // Date range filter state
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [filterType, setFilterType] = useState('all'); // 'all', 'purchase', 'sale'
  const [pdfPages, setPdfPages] = useState(null); // HTML report data for viewer
  const [editRecord, setEditRecord] = useState(null); // { ...record } being edited
  const [editQty, setEditQty] = useState('');
  const [editPrice, setEditPrice] = useState('');

  // Merge purchases + sales, sort newest first
  const allRecords = [
    ...entries.map(e => ({ ...e, kind: 'purchase' })),
    ...sales.map(s => ({ ...s, kind: 'sale' })),
  ].sort((a, b) => new Date(b.date) - new Date(a.date));

  const shopRecords = allRecords.filter(r => {
    if (r.shop !== selectedShop) return false;
    // Date filter
    if (dateFrom) {
      const from = new Date(dateFrom);
      from.setHours(0, 0, 0, 0);
      if (new Date(r.date) < from) return false;
    }
    if (dateTo) {
      const to = new Date(dateTo);
      to.setHours(23, 59, 59, 999);
      if (new Date(r.date) > to) return false;
    }
    // Type filter
    if (filterType !== 'all' && r.kind !== filterType) return false;
    return true;
  });

  const getLoad = (shop, spiceId) => shopLoads[`${shop}|${spiceId}`] || { id: '0' };

  // ── Build report data for HTML viewer ──
  const buildShopReportData = () => {
    const R = (val) => formatINR(val);
    const dateFilter = (item) => {
      if (dateFrom) { const from = new Date(dateFrom); from.setHours(0,0,0,0); if (new Date(item.date) < from) return false; }
      if (dateTo) { const to = new Date(dateTo); to.setHours(23,59,59,999); if (new Date(item.date) > to) return false; }
      return true;
    };
    const summary = spices.map(spice => {
      const se = entries.filter(e => e.shop === selectedShop && e.type === spice.id && dateFilter(e));
      const ss = sales.filter(s => s.shop === selectedShop && s.type === spice.id && dateFilter(s));
      const totalQty = se.reduce((s, e) => s + Number(e.qty), 0);
      const totalBuyValue = se.reduce((s, e) => s + Number(e.qty) * Number(e.price), 0);
      const soldQty = ss.reduce((s, e) => s + Number(e.qty), 0);
      const soldValue = ss.reduce((s, e) => s + Number(e.qty) * Number(e.sellPrice), 0);
      const remainingQty = Math.max(0, totalQty - soldQty);
      const remainingValue = totalBuyValue - soldValue;
      const avgBuy = remainingQty > 0 ? (remainingValue / remainingQty).toFixed(2) : (totalQty > 0 ? (totalBuyValue / totalQty).toFixed(2) : '0.00');
      const avgSell = soldQty > 0 ? (soldValue / soldQty).toFixed(2) : '-';
      const profit = soldQty > 0 ? (soldValue - (totalBuyValue / totalQty) * soldQty) : null;
      return { label: spice.label, color: spice.color, totalQty, avgBuy, soldQty, avgSell, remainingQty, remainingValue, profit };
    }).filter(r => r.totalQty > 0 || r.soldQty > 0);

    const totals = spices.reduce((acc, spice) => {
      const se = entries.filter(e => e.shop === selectedShop && e.type === spice.id);
      const ss = sales.filter(s => s.shop === selectedShop && s.type === spice.id);
      acc.totalBuyValue += se.reduce((s, e) => s + Number(e.qty) * Number(e.price), 0);
      acc.totalSellValue += ss.reduce((s, e) => s + Number(e.qty) * Number(e.sellPrice), 0);
      acc.totalBought += se.reduce((s, e) => s + Number(e.qty), 0);
      acc.totalSold += ss.reduce((s, e) => s + Number(e.qty), 0);
      return acc;
    }, { totalBought: 0, totalBuyValue: 0, totalSold: 0, totalSellValue: 0 });
    const totalProfit = totals.totalSellValue - (totals.totalBought > 0 ? (totals.totalBuyValue / totals.totalBought) * totals.totalSold : 0);

    const purchases = entries.filter(e => e.shop === selectedShop && dateFilter(e)).sort((a, b) => new Date(b.date) - new Date(a.date));
    const shopSales = sales.filter(s => s.shop === selectedShop && dateFilter(s)).sort((a, b) => new Date(b.date) - new Date(a.date));

    return { shop: selectedShop, summary, totals: { ...totals, totalProfit }, purchases, sales: shopSales, dateFrom, dateTo };
  };

  const buildOverallReportData = () => {
    const allShopData = shops.map(shop => {
      const shopSummary = spices.map(spice => {
        const se = entries.filter(e => e.shop === shop && e.type === spice.id);
        const ss = sales.filter(s => s.shop === shop && s.type === spice.id);
        const totalQty = se.reduce((s, e) => s + Number(e.qty), 0);
        const totalBuyValue = se.reduce((s, e) => s + Number(e.qty) * Number(e.price), 0);
        const soldQty = ss.reduce((s, e) => s + Number(e.qty), 0);
        const soldValue = ss.reduce((s, e) => s + Number(e.qty) * Number(e.sellPrice), 0);
        const remainingQty = Math.max(0, totalQty - soldQty);
        const remainingValue = totalBuyValue - soldValue;
        const avgBuy = totalQty > 0 ? (totalBuyValue / totalQty).toFixed(2) : '0.00';
        const avgSell = soldQty > 0 ? (soldValue / soldQty).toFixed(2) : '-';
        const profit = soldQty > 0 ? (soldValue - (totalBuyValue / totalQty) * soldQty) : null;
        return { label: spice.label, color: spice.color, totalQty, avgBuy, soldQty, avgSell, remainingQty, remainingValue, profit };
      }).filter(r => r.totalQty > 0 || r.soldQty > 0);

      const totals = spices.reduce((acc, spice) => {
        const se = entries.filter(e => e.shop === shop && e.type === spice.id);
        const ss = sales.filter(s => s.shop === shop && s.type === spice.id);
        acc.totalBuyValue += se.reduce((s, e) => s + Number(e.qty) * Number(e.price), 0);
        acc.totalSellValue += ss.reduce((s, e) => s + Number(e.qty) * Number(e.sellPrice), 0);
        acc.totalBought += se.reduce((s, e) => s + Number(e.qty), 0);
        acc.totalSold += ss.reduce((s, e) => s + Number(e.qty), 0);
        return acc;
      }, { totalBought: 0, totalBuyValue: 0, totalSold: 0, totalSellValue: 0 });
      const totalProfit = totals.totalSellValue - (totals.totalBought > 0 ? (totals.totalBuyValue / totals.totalBought) * totals.totalSold : 0);

      return { shop, summary: shopSummary, totals: { ...totals, totalProfit } };
    }).filter(d => d.summary.length > 0);
    return { shops: allShopData };
  };

  const viewReport = (type) => {
    if (type === 'shop') setPdfPages({ type: 'shop', ...buildShopReportData() });
    else setPdfPages({ type: 'overall', ...buildOverallReportData() });
  };

  const generatePDF = async () => {
    // ── Pre-load logo as base64 ──
    let logoBase64 = null;
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = '/kvs-logo.png';
      await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; });
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      logoBase64 = canvas.toDataURL('image/png');
    } catch (e) { /* logo not available, continue without it */ }

    const doc = new jsPDF('p', 'mm', 'a4');
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 14;
    let y = 12;
    let pageNum = 1; // track current page to avoid re-drawing bg on page 1

    // ── Colors ──
    const dark = [13, 17, 23];
    const cardBg = [22, 27, 34];
    const accent = [88, 166, 255];
    const brandGreen = [76, 175, 80];
    const green = [16, 185, 129];
    const red = [248, 113, 113];
    const grey = [140, 150, 165];
    const white = [255, 255, 255];
    const lightGrey = [210, 215, 225];

    // Helper: draw dark bg on current page
    const drawPageBg = () => {
      doc.setFillColor(...dark);
      doc.rect(0, 0, pageW, pageH, 'F');
    };

    // Helper: draw decorative top stripe
    const drawTopStripe = () => {
      doc.setFillColor(...brandGreen);
      doc.rect(0, 0, pageW, 3, 'F');
    };

    // Helper: new-page bg (only for pages AFTER the first)
    const drawNewPageBg = (data) => {
      if (data.pageNumber > 1) {
        drawPageBg();
        drawTopStripe();
      }
    };

    // Helper: section title with accent bar
    const sectionTitle = (title, startY, color = accent) => {
      doc.setFillColor(...color);
      doc.rect(margin, startY, 3, 10, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.setTextColor(...white);
      doc.text(title, margin + 7, startY + 7);
      return startY + 14;
    };

    // ── Page 1 background ──
    drawPageBg();
    drawTopStripe();

    // ── Header Card ──
    doc.setFillColor(...cardBg);
    doc.roundedRect(margin, y + 4, pageW - margin * 2, 30, 5, 5, 'F');

    // Add logo (pre-loaded base64)
    if (logoBase64) {
      try { doc.addImage(logoBase64, 'PNG', margin + 5, y + 7, 24, 24); } catch (e) { /* skip */ }
    }

    const logoOffset = logoBase64 ? 33 : 6;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.setTextColor(...brandGreen);
    doc.text('KVS Spices & Traders', margin + logoOffset, y + 17);
    doc.setFontSize(9);
    doc.setTextColor(...grey);
    doc.text(selectedShop, margin + logoOffset, y + 25);

    doc.setFontSize(8);
    doc.setTextColor(...grey);
    doc.text(format(new Date(), 'MMMM d, yyyy • h:mm a'), pageW - margin - 5, y + 17, { align: 'right' });
    doc.setFontSize(7);
    doc.text('Stock & Sales Report', pageW - margin - 5, y + 23, { align: 'right' });
    y += 40;

    // ── Divider line ──
    doc.setDrawColor(40, 50, 65);
    doc.setLineWidth(0.3);
    doc.line(margin, y, pageW - margin, y);
    y += 6;

    // ── Rupee helper (Helvetica doesn't have ₹) ──
    const R = (val) => formatINR(val).replace('₹', 'Rs.');

    // ── Date filter helper for PDF ──
    const dateFilter = (item) => {
      if (dateFrom) {
        const from = new Date(dateFrom); from.setHours(0,0,0,0);
        if (new Date(item.date) < from) return false;
      }
      if (dateTo) {
        const to = new Date(dateTo); to.setHours(23,59,59,999);
        if (new Date(item.date) > to) return false;
      }
      return true;
    };

    // ── Date range label for PDF title ──
    const dateRangeLabel = (dateFrom || dateTo)
      ? ` (${dateFrom ? format(new Date(dateFrom), 'dd MMM yyyy') : 'Start'} - ${dateTo ? format(new Date(dateTo), 'dd MMM yyyy') : 'Now'})`
      : '';

    // ── Stock Summary ──
    y = sectionTitle('Stock Summary' + dateRangeLabel, y);

    const summaryData = spices.map(spice => {
      const spiceEntries = entries.filter(e => e.shop === selectedShop && e.type === spice.id && dateFilter(e));
      const spiceSales = sales.filter(s => s.shop === selectedShop && s.type === spice.id && dateFilter(s));
      const totalQty = spiceEntries.reduce((s, e) => s + Number(e.qty), 0);
      const totalBuyValue = spiceEntries.reduce((s, e) => s + Number(e.qty) * Number(e.price), 0);
      const soldQty = spiceSales.reduce((s, e) => s + Number(e.qty), 0);
      const soldValue = spiceSales.reduce((s, e) => s + Number(e.qty) * Number(e.sellPrice), 0);
      const remainingQty = Math.max(0, totalQty - soldQty);
      const remainingValue = totalBuyValue - soldValue;
      const avgBuy = remainingQty > 0 ? (remainingValue / remainingQty).toFixed(2) : (totalQty > 0 ? (totalBuyValue / totalQty).toFixed(2) : '0.00');
      const avgSell = soldQty > 0 ? (soldValue / soldQty).toFixed(2) : '-';
      const profit = soldQty > 0 ? (soldValue - (totalBuyValue / totalQty) * soldQty).toFixed(2) : '-';
      return [
        spice.label,
        totalQty.toFixed(2),
        avgBuy,
        soldQty.toFixed(2),
        avgSell,
        remainingQty.toFixed(2),
        remainingValue > 0 ? Math.round(remainingValue) : 0,
        profit,
      ];
    }).filter(row => Number(row[1]) > 0 || Number(row[3]) > 0);

    if (summaryData.length > 0) {
      autoTable(doc, {
        startY: y,
        head: [['Spice', 'Bought', 'Buy Avg', 'Sold', 'Sell Avg', 'Balance', 'Value', 'P&L']],
        body: summaryData,
        theme: 'plain',
        styles: {
          font: 'helvetica', fontSize: 8, textColor: lightGrey,
          cellPadding: { top: 3.5, bottom: 3.5, left: 3, right: 3 }, lineWidth: 0,
        },
        headStyles: {
          fillColor: [30, 38, 50], textColor: brandGreen, fontStyle: 'bold', fontSize: 7.5,
          cellPadding: { top: 4, bottom: 4, left: 3, right: 3 },
        },
        alternateRowStyles: { fillColor: [18, 22, 30] },
        columnStyles: {
          0: { fontStyle: 'bold', textColor: white },
          2: { halign: 'right' }, 4: { halign: 'right' },
          6: { halign: 'right', fontStyle: 'bold' }, 7: { halign: 'right', fontStyle: 'bold' },
        },
        margin: { left: margin, right: margin },
        didDrawPage: drawNewPageBg,
        didParseCell: (data) => {
          if (data.section === 'body') {
            if (data.column.index === 2 || data.column.index === 4) {
              const v = data.cell.raw;
              if (v && v !== '-') data.cell.text = [R(v)];
            }
            if (data.column.index === 6) {
              data.cell.text = [R(data.cell.raw)];
            }
            if (data.column.index === 7) {
              const v = data.cell.raw;
              if (v && v !== '-') {
                const num = parseFloat(v);
                data.cell.styles.textColor = num >= 0 ? green : red;
                data.cell.text = [`${num >= 0 ? '+' : ''}${R(num)}`];
              }
            }
          }
        },
      });
      y = doc.lastAutoTable.finalY + 8;
    }

    // ── Grand Totals Card ──
    const totals = spices.reduce((acc, spice) => {
      const se = entries.filter(e => e.shop === selectedShop && e.type === spice.id);
      const ss = sales.filter(s => s.shop === selectedShop && s.type === spice.id);
      acc.totalBuyValue += se.reduce((s, e) => s + Number(e.qty) * Number(e.price), 0);
      acc.totalSellValue += ss.reduce((s, e) => s + Number(e.qty) * Number(e.sellPrice), 0);
      acc.totalBought += se.reduce((s, e) => s + Number(e.qty), 0);
      acc.totalSold += ss.reduce((s, e) => s + Number(e.qty), 0);
      return acc;
    }, { totalBought: 0, totalBuyValue: 0, totalSold: 0, totalSellValue: 0 });

    const totalRemainingValue = totals.totalBuyValue - totals.totalSellValue;
    const totalProfit = totals.totalSellValue - (totals.totalBought > 0 ? (totals.totalBuyValue / totals.totalBought) * totals.totalSold : 0);

    // Check if totals card fits on current page
    if (y > pageH - 40) { doc.addPage(); drawPageBg(); drawTopStripe(); y = 12; }

    // Totals card
    doc.setFillColor(18, 24, 33);
    doc.roundedRect(margin, y, pageW - margin * 2, 26, 4, 4, 'F');
    doc.setFillColor(...brandGreen);
    doc.rect(margin, y, pageW - margin * 2, 1.5, 'F');

    const colW = (pageW - margin * 2) / 4;
    const labels = ['Total Invested', 'Total Sold', 'Remaining Value', 'Net Profit'];
    const values = [
      R(totals.totalBuyValue),
      R(totals.totalSellValue),
      R(totalRemainingValue),
      `${totalProfit >= 0 ? '+' : ''}${R(totalProfit)}`,
    ];
    const valColors = [white, accent, white, totalProfit >= 0 ? green : red];

    labels.forEach((label, i) => {
      const x = margin + colW * i + 6;
      doc.setFontSize(7);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...grey);
      doc.text(label, x, y + 9);
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...valColors[i]);
      doc.text(values[i], x, y + 19);
    });
    y += 34;

    // ── Purchase Records ──
    const shopPurchases = entries.filter(e => e.shop === selectedShop && dateFilter(e)).sort((a, b) => new Date(b.date) - new Date(a.date));

    if (shopPurchases.length > 0) {
      if (y > pageH - 50) { doc.addPage(); drawPageBg(); drawTopStripe(); y = 12; }
      y = sectionTitle('Purchase Records', y);

      const purchaseRows = shopPurchases.map(e => [
        format(new Date(e.date), 'dd MMM yy'),
        e.type.replace('_', ' '),
        `${Number(e.qty).toFixed(2)} Kg`,
        R(Number(e.price)),
        R(Number(e.qty) * Number(e.price)),
      ]);

      autoTable(doc, {
        startY: y,
        head: [['Date', 'Spice', 'Qty', 'Price/Kg', 'Total']],
        body: purchaseRows,
        theme: 'plain',
        styles: { font: 'helvetica', fontSize: 8, textColor: lightGrey, cellPadding: { top: 2.5, bottom: 2.5, left: 4, right: 4 } },
        headStyles: { fillColor: [30, 38, 50], textColor: brandGreen, fontStyle: 'bold', fontSize: 7.5 },
        alternateRowStyles: { fillColor: [18, 22, 30] },
        columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right', fontStyle: 'bold', textColor: white } },
        margin: { left: margin, right: margin },
        didDrawPage: drawNewPageBg,
      });
      y = doc.lastAutoTable.finalY + 8;
    }

    // ── Sale Records ──
    const shopSales = sales.filter(s => s.shop === selectedShop && dateFilter(s)).sort((a, b) => new Date(b.date) - new Date(a.date));

    if (shopSales.length > 0) {
      if (y > pageH - 50) { doc.addPage(); drawPageBg(); drawTopStripe(); y = 12; }
      y = sectionTitle('Sale Records', y, green);

      const saleRows = shopSales.map(s => [
        format(new Date(s.date), 'dd MMM yy'),
        s.type.replace('_', ' '),
        `${Number(s.qty).toFixed(2)} Kg`,
        R(Number(s.sellPrice)),
        R(Number(s.qty) * Number(s.sellPrice)),
        s.buyerName || '-',
      ]);

      autoTable(doc, {
        startY: y,
        head: [['Date', 'Spice', 'Qty', 'Sell/Kg', 'Total', 'Buyer']],
        body: saleRows,
        theme: 'plain',
        styles: { font: 'helvetica', fontSize: 8, textColor: lightGrey, cellPadding: { top: 2.5, bottom: 2.5, left: 4, right: 4 } },
        headStyles: { fillColor: [30, 38, 50], textColor: green, fontStyle: 'bold', fontSize: 7.5 },
        alternateRowStyles: { fillColor: [18, 22, 30] },
        columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right', fontStyle: 'bold', textColor: green } },
        margin: { left: margin, right: margin },
        didDrawPage: drawNewPageBg,
      });
      y = doc.lastAutoTable.finalY + 8;
    }

    // ── Footer on every page ──
    const totalPages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      doc.setFillColor(18, 22, 28);
      doc.rect(0, pageH - 10, pageW, 10, 'F');
      doc.setFillColor(...brandGreen);
      doc.rect(0, pageH - 10, pageW, 0.5, 'F');
      doc.setFontSize(6.5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...grey);
      doc.text('KVS Spices & Traders  •  Generated by SpiceSentry', margin, pageH - 4);
      doc.text(`Page ${i} of ${totalPages}`, pageW - margin, pageH - 4, { align: 'right' });
    }

    doc.save(`KVS_${selectedShop.replace(/\s+/g, '_')}_${format(new Date(), 'yyyy-MM-dd')}.pdf`);
  };

  // ── Overall Report (all shops) ──
  const generateOverallPDF = async () => {
    let logoBase64 = null;
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = '/kvs-logo.png';
      await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; });
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      logoBase64 = canvas.toDataURL('image/png');
    } catch (e) { /* skip */ }

    const doc = new jsPDF('p', 'mm', 'a4');
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 14;
    let y = 12;

    const dark = [13, 17, 23];
    const cardBg = [22, 27, 34];
    const accent = [88, 166, 255];
    const brandGreen = [76, 175, 80];
    const green = [16, 185, 129];
    const red = [248, 113, 113];
    const grey = [140, 150, 165];
    const white = [255, 255, 255];
    const lightGrey = [210, 215, 225];
    const R = (val) => formatINR(val).replace('₹', 'Rs.');

    const drawPageBg = () => { doc.setFillColor(...dark); doc.rect(0, 0, pageW, pageH, 'F'); };
    const drawTopStripe = () => { doc.setFillColor(...brandGreen); doc.rect(0, 0, pageW, 3, 'F'); };
    const drawNewPageBg = (data) => { if (data.pageNumber > 1) { drawPageBg(); drawTopStripe(); } };
    const sectionTitle = (title, startY, color = accent) => {
      doc.setFillColor(...color);
      doc.rect(margin, startY, 3, 10, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.setTextColor(...white);
      doc.text(title, margin + 7, startY + 7);
      return startY + 14;
    };

    drawPageBg();
    drawTopStripe();

    // Header
    doc.setFillColor(...cardBg);
    doc.roundedRect(margin, y + 4, pageW - margin * 2, 30, 5, 5, 'F');
    if (logoBase64) { try { doc.addImage(logoBase64, 'PNG', margin + 5, y + 7, 24, 24); } catch (e) {} }
    const logoOffset = logoBase64 ? 33 : 6;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.setTextColor(...brandGreen);
    doc.text('KVS Spices & Traders', margin + logoOffset, y + 17);
    doc.setFontSize(9);
    doc.setTextColor(...grey);
    doc.text('All Branches - Overall Report', margin + logoOffset, y + 25);
    doc.setFontSize(8);
    doc.text(format(new Date(), 'MMMM d, yyyy \'at\' h:mm a'), pageW - margin - 5, y + 17, { align: 'right' });
    y += 40;

    doc.setDrawColor(40, 50, 65);
    doc.setLineWidth(0.3);
    doc.line(margin, y, pageW - margin, y);
    y += 6;

    // ── Per-shop sections ──
    for (const shop of shops) {
      if (y > pageH - 60) { doc.addPage(); drawPageBg(); drawTopStripe(); y = 12; }
      y = sectionTitle(shop, y, brandGreen);

      const shopSummary = spices.map(spice => {
        const se = entries.filter(e => e.shop === shop && e.type === spice.id);
        const ss = sales.filter(s => s.shop === shop && s.type === spice.id);
        const totalQty = se.reduce((s, e) => s + Number(e.qty), 0);
        const totalBuyValue = se.reduce((s, e) => s + Number(e.qty) * Number(e.price), 0);
        const soldQty = ss.reduce((s, e) => s + Number(e.qty), 0);
        const soldValue = ss.reduce((s, e) => s + Number(e.qty) * Number(e.sellPrice), 0);
        const remainingQty = Math.max(0, totalQty - soldQty);
        const remainingValue = totalBuyValue - soldValue;
        const avgBuy = remainingQty > 0 ? (remainingValue / remainingQty).toFixed(2) : (totalQty > 0 ? (totalBuyValue / totalQty).toFixed(2) : '0.00');
        const avgSell = soldQty > 0 ? (soldValue / soldQty).toFixed(2) : '-';
        const profit = soldQty > 0 ? (soldValue - (totalBuyValue / totalQty) * soldQty).toFixed(2) : '-';
        return [spice.label, totalQty.toFixed(2), avgBuy, soldQty.toFixed(2), avgSell, remainingQty.toFixed(2),
          remainingValue > 0 ? Math.round(remainingValue) : 0, profit];
      }).filter(row => Number(row[1]) > 0 || Number(row[3]) > 0);

      if (shopSummary.length > 0) {
        autoTable(doc, {
          startY: y,
          head: [['Spice', 'Bought', 'Buy Avg', 'Sold', 'Sell Avg', 'Balance', 'Value', 'P&L']],
          body: shopSummary,
          theme: 'plain',
          styles: { font: 'helvetica', fontSize: 7.5, textColor: lightGrey, cellPadding: { top: 2.5, bottom: 2.5, left: 3, right: 3 }, lineWidth: 0 },
          headStyles: { fillColor: [30, 38, 50], textColor: brandGreen, fontStyle: 'bold', fontSize: 7 },
          alternateRowStyles: { fillColor: [18, 22, 30] },
          columnStyles: {
            0: { fontStyle: 'bold', textColor: white },
            2: { halign: 'right' }, 4: { halign: 'right' },
            6: { halign: 'right', fontStyle: 'bold' }, 7: { halign: 'right', fontStyle: 'bold' },
          },
          margin: { left: margin, right: margin },
          didDrawPage: drawNewPageBg,
          didParseCell: (data) => {
            if (data.section === 'body') {
              if (data.column.index === 2 || data.column.index === 4) { const v = data.cell.raw; if (v && v !== '-') data.cell.text = [R(v)]; }
              if (data.column.index === 6) data.cell.text = [R(data.cell.raw)];
              if (data.column.index === 7) { const v = data.cell.raw; if (v && v !== '-') { const num = parseFloat(v); data.cell.styles.textColor = num >= 0 ? green : red; data.cell.text = [`${num >= 0 ? '+' : ''}${R(num)}`]; } }
            }
          },
        });
        y = doc.lastAutoTable.finalY + 6;
      } else {
        doc.setFontSize(8);
        doc.setTextColor(...grey);
        doc.text('No records', margin + 7, y);
        y += 8;
      }
    }

    // ── Grand Total across all shops ──
    if (y > pageH - 45) { doc.addPage(); drawPageBg(); drawTopStripe(); y = 12; }
    y += 4;
    const grandTotals = { bought: 0, buyValue: 0, sold: 0, sellValue: 0 };
    shops.forEach(shop => {
      spices.forEach(spice => {
        const se = entries.filter(e => e.shop === shop && e.type === spice.id);
        const ss = sales.filter(s => s.shop === shop && s.type === spice.id);
        grandTotals.buyValue += se.reduce((s, e) => s + Number(e.qty) * Number(e.price), 0);
        grandTotals.sellValue += ss.reduce((s, e) => s + Number(e.qty) * Number(e.sellPrice), 0);
        grandTotals.bought += se.reduce((s, e) => s + Number(e.qty), 0);
        grandTotals.sold += ss.reduce((s, e) => s + Number(e.qty), 0);
      });
    });
    const gRemVal = grandTotals.buyValue - grandTotals.sellValue;
    const gProfit = grandTotals.sellValue - (grandTotals.bought > 0 ? (grandTotals.buyValue / grandTotals.bought) * grandTotals.sold : 0);

    doc.setFillColor(18, 24, 33);
    doc.roundedRect(margin, y, pageW - margin * 2, 26, 4, 4, 'F');
    doc.setFillColor(...brandGreen);
    doc.rect(margin, y, pageW - margin * 2, 1.5, 'F');

    const colW = (pageW - margin * 2) / 4;
    const gLabels = ['Total Invested', 'Total Sold', 'Remaining Value', 'Net Profit'];
    const gValues = [
      R(grandTotals.buyValue),
      R(grandTotals.sellValue),
      R(gRemVal),
      `${gProfit >= 0 ? '+' : ''}${R(gProfit)}`,
    ];
    const gColors = [white, accent, white, gProfit >= 0 ? green : red];
    gLabels.forEach((label, i) => {
      const x = margin + colW * i + 6;
      doc.setFontSize(7); doc.setFont('helvetica', 'normal'); doc.setTextColor(...grey);
      doc.text(label, x, y + 9);
      doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.setTextColor(...gColors[i]);
      doc.text(gValues[i], x, y + 19);
    });

    // Footer
    const totalPages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      doc.setFillColor(18, 22, 28);
      doc.rect(0, pageH - 10, pageW, 10, 'F');
      doc.setFillColor(...brandGreen);
      doc.rect(0, pageH - 10, pageW, 0.5, 'F');
      doc.setFontSize(6.5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...grey);
      doc.text('KVS Spices & Traders  •  Overall Report  •  SpiceSentry', margin, pageH - 4);
      doc.text(`Page ${i} of ${totalPages}`, pageW - margin, pageH - 4, { align: 'right' });
    }

    doc.save(`KVS_Overall_Report_${format(new Date(), 'yyyy-MM-dd')}.pdf`);
  };

  // Group shopRecords by date for timeline view
  const groupedRecords = shopRecords.reduce((acc, r) => {
    const dk = format(new Date(r.date), 'yyyy-MM-dd');
    if (!acc[dk]) acc[dk] = [];
    acc[dk].push(r);
    return acc;
  }, {});
  const groupedDates = Object.keys(groupedRecords).sort((a, b) => new Date(b) - new Date(a));

  return (
    <div style={{ animation: 'fadeIn 0.3s ease-in-out' }}>
      {/* Header */}
      <header className="app-header">
        <div className="app-header-brand">
          <img src="/kvs-logo.png" alt="KVS" />
          <h1 style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em', margin: 0 }}>History</h1>
        </div>
        <div className="app-header-actions">
          <button className="icon-btn" onClick={() => viewReport('shop')} title={`View ${selectedShop} report`}>
            <Eye size={16} />
          </button>
          <button className="icon-btn green" onClick={generatePDF} title="Download PDF">
            <Download size={16} />
          </button>
        </div>
      </header>

      <div className="page-section" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {/* Shop Selector */}
        <div className="shop-selector">
          {shops.map(shop => (
            <div
              key={shop}
              className={`shop-tab ${selectedShop === shop ? 'active' : ''}`}
              onClick={() => onSelectShop(shop)}
            >
              {shop}
            </div>
          ))}
        </div>

        {/* Filter row */}
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <div className="filter-pill-group" style={{ flex: 1 }}>
            <button
              className={`filter-pill ${filterType === 'all' ? 'active-buy' : ''}`}
              onClick={() => setFilterType('all')}
            >All</button>
            <button
              className={`filter-pill ${filterType === 'purchase' ? 'active-buy' : ''}`}
              onClick={() => setFilterType('purchase')}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
              Buys
            </button>
            <button
              className={`filter-pill ${filterType === 'sale' ? 'active-sell' : ''}`}
              onClick={() => setFilterType('sale')}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
              Sales
            </button>
          </div>
          {(dateFrom || dateTo || filterType !== 'all') && (
            <button
              onClick={() => { setDateFrom(''); setDateTo(''); setFilterType('all'); }}
              style={{ padding: '0.4rem 0.75rem', borderRadius: 9, border: '1px solid rgba(248,113,113,0.3)', background: 'rgba(248,113,113,0.08)', color: 'var(--danger)', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'Manrope, sans-serif' }}
            >
              Clear
            </button>
          )}
        </div>

        {/* Date range */}
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <div style={{ flex: 1 }}>
            <label className="form-label muted" style={{ marginBottom: '0.3rem' }}>From</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="input-field" style={{ padding: '0.6rem 0.75rem', fontSize: '0.85rem', borderRadius: 10 }} />
          </div>
          <div style={{ flex: 1 }}>
            <label className="form-label muted" style={{ marginBottom: '0.3rem' }}>To</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="input-field" style={{ padding: '0.6rem 0.75rem', fontSize: '0.85rem', borderRadius: 10 }} />
          </div>
        </div>

        {/* Report buttons */}
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="action-btn-outline" onClick={() => viewReport('overall')}>
            <Eye size={14} />
            All Shops Report
          </button>
          <button className="action-btn-outline" onClick={generateOverallPDF} style={{ flex: 0, padding: '0.65rem 0.85rem' }}>
            <Download size={14} />
          </button>
        </div>

        {/* Timeline */}
        {shopRecords.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
            No records {filterType !== 'all' ? `(${filterType === 'purchase' ? 'purchases' : 'sales'})` : ''} yet.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {groupedDates.map(dk => {
              const dayDate = new Date(dk + 'T00:00:00');
              const todayStr = format(new Date(), 'yyyy-MM-dd');
              const yesterdayStr = format(new Date(Date.now() - 86400000), 'yyyy-MM-dd');
              const dayLabel = dk === todayStr ? 'Today' : dk === yesterdayStr ? 'Yesterday' : format(dayDate, 'MMM d, yyyy');

              return (
                <div key={dk}>
                  <div className="timeline-group-header">
                    <span className="timeline-group-label">{dayLabel}</span>
                    <div className="timeline-divider" />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                    {groupedRecords[dk].map(r => {
                      const spice = spices.find(s => s.id === r.type);
                      const txValue = r.totalValue ? r.totalValue : (r.qty * (r.sellPrice || r.price));
                      return (
                        <div key={r.id} className={`tx-card ${r.kind}`}>
                          <div className={`tx-icon ${r.kind}`}>
                            {r.kind === 'purchase'
                              ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
                              : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
                            }
                          </div>
                          <div className="tx-info">
                            <div className="tx-name" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                              {spice && <div className="spice-dot" style={{ background: spice.color }} />}
                              {r.type.replace('_', ' ')}
                            </div>
                            <div className="tx-meta">
                              {format(new Date(r.date), 'h:mm a')}
                              {' · '}{r.qty} kg @ {formatINR(r.kind === 'sale' ? r.sellPrice : r.price)}/kg
                              {r.kind === 'sale' && r.buyerName && ` → ${r.buyerName}`}
                            </div>
                          </div>
                          <div className="tx-values">
                            <div className="tx-total" style={{ color: r.kind === 'sale' ? 'var(--primary-ctn)' : 'var(--text-primary)' }}>
                              {formatINR(txValue)}
                            </div>
                          </div>
                          <div className="tx-actions">
                            <button
                              className="tx-action-btn"
                              onClick={() => { setEditRecord(r); setEditQty(String(r.qty)); setEditPrice(String(r.kind === 'sale' ? r.sellPrice : r.price)); }}
                              title="Edit"
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              className="tx-action-btn danger"
                              onClick={() => r.kind === 'sale' ? onDeleteSale(r.id) : onDeleteEntry(r.id)}
                              title="Delete"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Edit Record Modal ── */}
      {editRecord && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          zIndex: 10000, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          animation: 'fadeIn 0.2s ease-in-out',
        }} onClick={() => setEditRecord(null)}>
          <div style={{
            background: 'var(--card-bg)', borderRadius: 16, padding: '1.5rem',
            width: '90%', maxWidth: 380,
            border: '1px solid rgba(255,255,255,0.1)',
            boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 1rem', fontSize: '1rem', color: 'var(--text-primary)' }}>
              <Pencil size={16} style={{ marginRight: 6, verticalAlign: -2 }} />
              Edit {editRecord.kind === 'sale' ? 'Sale' : 'Purchase'}
            </h3>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
              {editRecord.type.replace('_', ' ')} • {editRecord.shop} • {format(new Date(editRecord.date), 'dd MMM yyyy')}
            </div>
            <div style={{ marginBottom: '0.75rem' }}>
              <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.3rem' }}>Quantity (Kg)</label>
              <input type="number" step="0.01" value={editQty} onChange={e => setEditQty(e.target.value)}
                className="modern-input" style={{ width: '100%' }} />
            </div>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.3rem' }}>
                {editRecord.kind === 'sale' ? 'Sell Price per Kg (₹)' : 'Buy Price per Kg (₹)'}
              </label>
              <input type="number" step="0.01" value={editPrice} onChange={e => setEditPrice(e.target.value)}
                className="modern-input" style={{ width: '100%' }} />
            </div>
            {editQty && editPrice && (
              <div style={{ marginBottom: '1rem', padding: '0.6rem 0.75rem', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>New Total</div>
                <div style={{ fontSize: '1.2rem', fontWeight: 800, color: editRecord.kind === 'sale' ? '#10b981' : 'var(--text-primary)' }}>
                  {formatINR(parseFloat(editQty) * parseFloat(editPrice))}
                </div>
              </div>
            )}
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button onClick={() => setEditRecord(null)}
                style={{
                  flex: 1, padding: '0.65rem', borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)',
                  background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem',
                }}>Cancel</button>
              <button onClick={() => {
                if (!editQty || !editPrice) return;
                const updates = editRecord.kind === 'sale'
                  ? { qty: parseFloat(editQty), sellPrice: parseFloat(editPrice) }
                  : { qty: parseFloat(editQty), price: parseFloat(editPrice) };
                if (editRecord.kind === 'sale') onEditSale(editRecord.id, updates);
                else onEditEntry(editRecord.id, updates);
                setEditRecord(null);
              }}
                style={{
                  flex: 1, padding: '0.65rem', borderRadius: 10, border: 'none',
                  background: '#58a6ff', color: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: '0.85rem',
                }}>Save Changes</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Full-screen HTML Report Viewer ── */}
      {pdfPages && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          zIndex: 9999, background: 'var(--bg-primary)',
          display: 'flex', flexDirection: 'column',
          animation: 'fadeIn 0.2s ease-in-out',
        }}>
          {/* Header bar */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '0.6rem 1rem',
            background: 'var(--card-bg)', borderBottom: '1px solid rgba(255,255,255,0.08)',
            flexShrink: 0,
          }}>
            <span style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-primary)' }}>
              📊 {pdfPages.type === 'overall' ? 'Overall Report' : `${pdfPages.shop} Report`}
            </span>
            <button
              onClick={() => setPdfPages(null)}
              style={{
                background: 'rgba(248,113,113,0.15)', border: '1px solid rgba(248,113,113,0.3)',
                color: '#f87171', borderRadius: 8, padding: '0.4rem 1rem',
                fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer',
              }}
            >
              ✕ Close
            </button>
          </div>

          {/* Scrollable report body */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '1rem', WebkitOverflowScrolling: 'touch' }}>
            {/* Report title */}
            <div style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
              <img src="/kvs-logo.png" alt="KVS" style={{ width: 56, height: 56, borderRadius: 12, marginBottom: '0.5rem' }} />
              <h2 style={{ color: '#4caf50', fontWeight: 800, fontSize: '1.3rem', margin: 0 }}>KVS Spices & Traders</h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', margin: '0.25rem 0' }}>
                {pdfPages.type === 'overall' ? 'All Shops — Overall Report' : `${pdfPages.shop} — Stock & Sales Report`}
              </p>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.7rem' }}>
                {format(new Date(), 'MMMM d, yyyy • h:mm a')}
                {pdfPages.dateFrom || pdfPages.dateTo ? ` • Filtered: ${pdfPages.dateFrom ? format(new Date(pdfPages.dateFrom), 'dd MMM yyyy') : 'Start'} – ${pdfPages.dateTo ? format(new Date(pdfPages.dateTo), 'dd MMM yyyy') : 'Now'}` : ''}
              </p>
            </div>

            {/* Render shop data — single shop or multiple */}
            {(pdfPages.type === 'overall' ? pdfPages.shops : [pdfPages]).map((shopData, si) => (
              <div key={si} style={{ marginBottom: '1.5rem' }}>
                {pdfPages.type === 'overall' && (
                  <h3 style={{ color: '#58a6ff', fontSize: '1.1rem', fontWeight: 700, borderLeft: '3px solid #58a6ff', paddingLeft: 10, marginBottom: '0.75rem' }}>
                    {shopData.shop}
                  </h3>
                )}

                {/* Stock Summary Table */}
                {shopData.summary.length > 0 && (
                  <div style={{ marginBottom: '1rem' }}>
                    <h4 style={{ color: '#4caf50', fontSize: '0.8rem', fontWeight: 700, marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Stock Summary
                    </h4>
                    <div style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid rgba(255,255,255,0.06)' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
                        <thead>
                          <tr style={{ background: 'rgba(30,38,50,0.8)' }}>
                            {['Spice', 'Bought', 'Avg', 'Sold', 'Sell Avg', 'Balance', 'P&L'].map(h => (
                              <th key={h} style={{ padding: '0.5rem 0.4rem', color: '#4caf50', fontWeight: 700, textAlign: h === 'Spice' ? 'left' : 'right', whiteSpace: 'nowrap', fontSize: '0.65rem' }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {shopData.summary.map((r, i) => (
                            <tr key={i} style={{ background: i % 2 === 0 ? 'rgba(22,27,34,0.6)' : 'rgba(18,22,30,0.6)' }}>
                              <td style={{ padding: '0.45rem 0.4rem', fontWeight: 700, color: r.color || '#fff', whiteSpace: 'nowrap' }}>{r.label}</td>
                              <td style={{ padding: '0.45rem 0.4rem', textAlign: 'right', color: 'var(--text-secondary)' }}>{r.totalQty.toFixed(1)}</td>
                              <td style={{ padding: '0.45rem 0.4rem', textAlign: 'right', color: 'var(--text-secondary)' }}>{formatINR(r.avgBuy)}</td>
                              <td style={{ padding: '0.45rem 0.4rem', textAlign: 'right', color: 'var(--text-secondary)' }}>{r.soldQty.toFixed(1)}</td>
                              <td style={{ padding: '0.45rem 0.4rem', textAlign: 'right', color: 'var(--text-secondary)' }}>{r.avgSell === '-' ? '-' : formatINR(r.avgSell)}</td>
                              <td style={{ padding: '0.45rem 0.4rem', textAlign: 'right', fontWeight: 700, color: '#fff' }}>{r.remainingQty.toFixed(1)}</td>
                              <td style={{
                                padding: '0.45rem 0.4rem', textAlign: 'right', fontWeight: 700,
                                color: r.profit === null ? 'var(--text-secondary)' : r.profit >= 0 ? '#10b981' : '#f87171',
                              }}>
                                {r.profit === null ? '-' : `${r.profit >= 0 ? '+' : ''}${formatINR(r.profit)}`}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Totals Card */}
                {shopData.totals && (
                  <div style={{
                    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '1rem',
                  }}>
                    {[
                      { label: 'Total Invested', value: formatINR(shopData.totals.totalBuyValue), color: '#fff' },
                      { label: 'Total Sold', value: formatINR(shopData.totals.totalSellValue), color: '#58a6ff' },
                      { label: 'Remaining', value: formatINR(shopData.totals.totalBuyValue - shopData.totals.totalSellValue), color: '#fff' },
                      { label: 'Net Profit', value: `${shopData.totals.totalProfit >= 0 ? '+' : ''}${formatINR(shopData.totals.totalProfit)}`, color: shopData.totals.totalProfit >= 0 ? '#10b981' : '#f87171' },
                    ].map((t, i) => (
                      <div key={i} style={{
                        background: 'rgba(22,27,34,0.8)', borderRadius: 10, padding: '0.6rem 0.75rem',
                        border: '1px solid rgba(255,255,255,0.04)',
                      }}>
                        <div style={{ fontSize: '0.6rem', color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>{t.label}</div>
                        <div style={{ fontSize: '1rem', fontWeight: 800, color: t.color }}>{t.value}</div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Purchase Records (only for single shop view) */}
                {pdfPages.type === 'shop' && shopData.purchases && shopData.purchases.length > 0 && (
                  <div style={{ marginBottom: '1rem' }}>
                    <h4 style={{ color: '#58a6ff', fontSize: '0.8rem', fontWeight: 700, marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Purchase Records ({shopData.purchases.length})
                    </h4>
                    <div style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid rgba(255,255,255,0.06)' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem' }}>
                        <thead>
                          <tr style={{ background: 'rgba(30,38,50,0.8)' }}>
                            {['Date', 'Spice', 'Qty', 'Price/Kg', 'Total'].map(h => (
                              <th key={h} style={{ padding: '0.5rem 0.4rem', color: '#58a6ff', fontWeight: 700, textAlign: h === 'Date' || h === 'Spice' ? 'left' : 'right', whiteSpace: 'nowrap', fontSize: '0.65rem' }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {shopData.purchases.map((e, i) => (
                            <tr key={i} style={{ background: i % 2 === 0 ? 'rgba(22,27,34,0.6)' : 'rgba(18,22,30,0.6)' }}>
                              <td style={{ padding: '0.4rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{format(new Date(e.date), 'dd MMM yy')}</td>
                              <td style={{ padding: '0.4rem', fontWeight: 600, color: '#fff' }}>{e.type.replace('_', ' ')}</td>
                              <td style={{ padding: '0.4rem', textAlign: 'right', color: 'var(--text-secondary)' }}>{Number(e.qty).toFixed(2)}</td>
                              <td style={{ padding: '0.4rem', textAlign: 'right', color: 'var(--text-secondary)' }}>{formatINR(Number(e.price))}</td>
                              <td style={{ padding: '0.4rem', textAlign: 'right', fontWeight: 700, color: '#fff' }}>{formatINR(Number(e.qty) * Number(e.price))}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Sale Records (only for single shop view) */}
                {pdfPages.type === 'shop' && shopData.sales && shopData.sales.length > 0 && (
                  <div style={{ marginBottom: '1rem' }}>
                    <h4 style={{ color: '#10b981', fontSize: '0.8rem', fontWeight: 700, marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Sale Records ({shopData.sales.length})
                    </h4>
                    <div style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid rgba(255,255,255,0.06)' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem' }}>
                        <thead>
                          <tr style={{ background: 'rgba(30,38,50,0.8)' }}>
                            {['Date', 'Spice', 'Qty', 'Sell/Kg', 'Total', 'Buyer'].map(h => (
                              <th key={h} style={{ padding: '0.5rem 0.4rem', color: '#10b981', fontWeight: 700, textAlign: h === 'Date' || h === 'Spice' || h === 'Buyer' ? 'left' : 'right', whiteSpace: 'nowrap', fontSize: '0.65rem' }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {shopData.sales.map((s, i) => (
                            <tr key={i} style={{ background: i % 2 === 0 ? 'rgba(22,27,34,0.6)' : 'rgba(18,22,30,0.6)' }}>
                              <td style={{ padding: '0.4rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{format(new Date(s.date), 'dd MMM yy')}</td>
                              <td style={{ padding: '0.4rem', fontWeight: 600, color: '#fff' }}>{s.type.replace('_', ' ')}</td>
                              <td style={{ padding: '0.4rem', textAlign: 'right', color: 'var(--text-secondary)' }}>{Number(s.qty).toFixed(2)}</td>
                              <td style={{ padding: '0.4rem', textAlign: 'right', color: 'var(--text-secondary)' }}>{formatINR(Number(s.sellPrice))}</td>
                              <td style={{ padding: '0.4rem', textAlign: 'right', fontWeight: 700, color: '#10b981' }}>{formatINR(Number(s.qty) * Number(s.sellPrice))}</td>
                              <td style={{ padding: '0.4rem', color: 'var(--text-secondary)' }}>{s.buyerName || '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {/* Footer */}
            <div style={{ textAlign: 'center', padding: '1rem 0 2rem', borderTop: '1px solid rgba(255,255,255,0.06)', marginTop: '0.5rem' }}>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.65rem' }}>KVS Spices & Traders • Generated by SpiceSentry</p>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

function App() {
  const { loading, user } = useAuth();
  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: 'var(--bg)' }}>
        <div className="spinner" />
      </div>
    );
  }
  if (!user) {
    return <LoginPage />;
  }
  return <MainApp />;
}

export default App;