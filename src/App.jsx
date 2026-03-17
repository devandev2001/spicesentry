import React, { useState, useEffect } from 'react';
import { Home, PlusCircle, Clock, Truck, Download, TrendingUp, Filter, ShoppingBag, Trash2, ArrowRightLeft } from 'lucide-react';
import { format, differenceInDays } from 'date-fns';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const SHOPS = ['KVS Anachal', '20 Acre', 'Kallar'];
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

function buildDefaultLoads() {
  const initial = {};
  SHOPS.forEach(shop => {
    SPICES.forEach(spice => {
      initial[`${shop}|${spice.id}`] = { id: Date.now().toString(), start: Date.now() };
    });
  });
  return initial;
}

function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [selectedShop, setSelectedShop] = useState(SHOPS[0]);
  const [loading, setLoading] = useState(true);

  // Data State — start empty, will be filled from Google Sheets
  const [entries, setEntries] = useState([]);
  const [sales, setSales] = useState([]);
  const [shopLoads, setShopLoads] = useState(buildDefaultLoads);

  // Helper to get the load for a specific shop + spice
  const getLoad = (shop, spiceId) => shopLoads[`${shop}|${spiceId}`] || { id: '0', start: Date.now() };

  // ── Fetch ALL data from Google Sheets on mount ──
  useEffect(() => {
    let cancelled = false;
    async function fetchFromSheets() {
      try {
        const res = await fetch(GSHEET_URL, { redirect: 'follow' });
        if (!res.ok) throw new Error('Network error ' + res.status);
        const data = await res.json();
        if (cancelled) return;

        if (data.entries)   setEntries(data.entries);
        if (data.sales)     setSales(data.sales);
        if (data.loads && Object.keys(data.loads).length > 0) {
          setShopLoads(prev => ({ ...prev, ...data.loads }));
        }
        // Cache locally for offline fallback
        localStorage.setItem('spice_entries', JSON.stringify(data.entries || []));
        localStorage.setItem('spice_sales', JSON.stringify(data.sales || []));
        if (data.loads) localStorage.setItem('spice_shop_loads', JSON.stringify(data.loads));
      } catch (err) {
        console.warn('Could not fetch from Google Sheets, using local cache:', err);
        // Fallback to localStorage
        const cachedEntries = localStorage.getItem('spice_entries');
        const cachedSales   = localStorage.getItem('spice_sales');
        const cachedLoads   = localStorage.getItem('spice_shop_loads');
        if (cachedEntries) setEntries(JSON.parse(cachedEntries));
        if (cachedSales)   setSales(JSON.parse(cachedSales));
        if (cachedLoads)   setShopLoads(prev => ({ ...prev, ...JSON.parse(cachedLoads) }));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchFromSheets();
    return () => { cancelled = true; };
  }, []);

  // Save to local storage as cache when data changes
  useEffect(() => {
    if (!loading) localStorage.setItem('spice_entries', JSON.stringify(entries));
  }, [entries, loading]);

  useEffect(() => {
    if (!loading) localStorage.setItem('spice_sales', JSON.stringify(sales));
  }, [sales, loading]);

  useEffect(() => {
    if (!loading) localStorage.setItem('spice_shop_loads', JSON.stringify(shopLoads));
  }, [shopLoads, loading]);

  // Derived state: per-spice stats for the selected shop
  const stats = SPICES.map(spice => {
    const load = getLoad(selectedShop, spice.id);
    const spiceEntries = entries.filter(e => e.shop === selectedShop && e.loadId === load.id && e.type === spice.id);
    const totalQty = spiceEntries.reduce((sum, e) => sum + Number(e.qty), 0);
    const totalValue = spiceEntries.reduce((sum, e) => sum + (Number(e.qty) * Number(e.price)), 0);
    const originalAvgBuy = totalQty > 0 ? +(totalValue / totalQty).toFixed(2) : 0;

    // Sales for this shop + spice in the current load
    const spiceSales = sales.filter(s => s.shop === selectedShop && s.loadId === load.id && s.type === spice.id);
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
      const se = entries.filter(e => e.shop === shop && e.loadId === load.id && e.type === spice.id);
      const qty = se.reduce((s, e) => s + Number(e.qty), 0);
      const val = se.reduce((s, e) => s + Number(e.qty) * Number(e.price), 0);
      const shopSales = sales.filter(s => s.shop === shop && s.loadId === load.id && s.type === spice.id);
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
    
    setEntries([newEntry, ...entries]);
    setActiveTab('dashboard');
    setSelectedShop(entry.shop);

    try {
      await fetch(GSHEET_URL, {
        method: 'POST',
        body: JSON.stringify({ ...newEntry, kind: 'entry' }),
      });
    } catch (error) {
      console.error("Error sending to Google Sheets:", error);
    }
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

    setSales([newSale, ...sales]);
    setActiveTab('dashboard');
    setSelectedShop(sale.shop);

    try {
      await fetch(GSHEET_URL, {
        method: 'POST',
        body: JSON.stringify(newSale),
      });
    } catch (error) {
      console.error("Error sending sale to Google Sheets:", error);
    }
  };

  const handleDeleteEntry = (id) => {
    if (confirm('Delete this purchase entry?')) {
      setEntries(prev => prev.filter(e => e.id !== id));
    }
  };

  const handleDeleteSale = (id) => {
    if (confirm('Delete this sale entry?')) {
      setSales(prev => prev.filter(s => s.id !== id));
    }
  };

  // Dispatch modal state
  const [dispatchModal, setDispatchModal] = useState(null); // { spiceId, spiceLabel, remainingQty, loadId }
  const [dispatchPrice, setDispatchPrice] = useState('');

  const handleDispatchLoad = (spiceId) => {
    const spiceLabel = SPICES.find(s => s.id === spiceId)?.label || spiceId;
    const load = getLoad(selectedShop, spiceId);
    
    const spiceEntries = entries.filter(e => e.shop === selectedShop && e.loadId === load.id && e.type === spiceId);
    const spiceSales = sales.filter(s => s.shop === selectedShop && s.loadId === load.id && s.type === spiceId);
    const totalQty = spiceEntries.reduce((sum, e) => sum + Number(e.qty), 0);
    const soldQty = spiceSales.reduce((sum, s) => sum + Number(s.qty), 0);
    const remainingQty = Math.max(0, totalQty - soldQty);

    if (remainingQty <= 0) {
      if (confirm(`No remaining ${spiceLabel} stock. Reset load anyway?`)) {
        const newLoadId = Date.now().toString();
        const newLoadStart = Date.now();
        setShopLoads(prev => ({
          ...prev,
          [`${selectedShop}|${spiceId}`]: { id: newLoadId, start: newLoadStart }
        }));
        // Persist to Sheets
        fetch(GSHEET_URL, {
          method: 'POST',
          body: JSON.stringify({ kind: 'load', shop: selectedShop, spice: spiceId, loadId: newLoadId, start: newLoadStart }),
        }).catch(err => console.error("Error saving load reset:", err));
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

    try {
      await fetch(GSHEET_URL, {
        method: 'POST',
        body: JSON.stringify(dispatchSale),
      });
    } catch (error) {
      console.error("Error sending dispatch sale to Sheets:", error);
    }

    const newLoadId = Date.now().toString();
    const newLoadStart = Date.now();

    setShopLoads(prev => ({
      ...prev,
      [`${selectedShop}|${spiceId}`]: { id: newLoadId, start: newLoadStart }
    }));

    // Persist load reset to Google Sheets
    try {
      await fetch(GSHEET_URL, {
        method: 'POST',
        body: JSON.stringify({
          kind: 'load',
          shop: selectedShop,
          spice: spiceId,
          loadId: newLoadId,
          start: newLoadStart,
        }),
      });
    } catch (err) {
      console.error("Error saving load reset to Sheets:", err);
    }

    setDispatchModal(null);
    setDispatchPrice('');
    setActiveTab('dashboard');
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
    const se = entries.filter(e => e.shop === tfFrom && e.loadId === load.id && e.type === tfSpice);
    const ss = sales.filter(s => s.shop === tfFrom && s.loadId === load.id && s.type === tfSpice);
    const bought = se.reduce((s, e) => s + Number(e.qty), 0);
    const sold = ss.reduce((s, e) => s + Number(e.qty), 0);
    return Math.max(0, bought - sold);
  })();

  // Compute avg buy price at source for this spice (cost-relief)
  const tfAvgPrice = (() => {
    if (!transferModal) return 0;
    const load = getLoad(tfFrom, tfSpice);
    const se = entries.filter(e => e.shop === tfFrom && e.loadId === load.id && e.type === tfSpice);
    const ss = sales.filter(s => s.shop === tfFrom && s.loadId === load.id && s.type === tfSpice);
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
    if (!qty || qty <= 0 || qty > tfAvailableQty || tfFrom === tfTo) return;
    if (!price || price <= 0) return;

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

    // Sync to Google Sheets
    try {
      await Promise.all([
        fetch(GSHEET_URL, { method: 'POST', body: JSON.stringify(transferOut) }),
        fetch(GSHEET_URL, { method: 'POST', body: JSON.stringify({ ...transferIn, kind: 'entry' }) }),
      ]);
    } catch (err) {
      console.error("Error syncing transfer to Sheets:", err);
    }

    setTransferModal(false);
    setActiveTab('dashboard');
    setSelectedShop(tfTo);
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', flexDirection: 'column', gap: '12px' }}>
        <div style={{ width: 40, height: 40, border: '4px solid #e0e0e0', borderTop: '4px solid var(--cardamom-main, #4caf50)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <p style={{ color: '#888', fontSize: 14 }}>Loading from Google Sheets…</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <>
      <div className="content-area">
        {activeTab === 'dashboard' && (
          <Dashboard 
            stats={stats} 
            allBranchStats={allBranchStats}
            shops={SHOPS}
            selectedShop={selectedShop}
            onSelectShop={setSelectedShop}
            days={daysSinceLoadStart}
            onDispatch={handleDispatchLoad}
            onTransfer={openTransferModal}
          />
        )}
        {activeTab === 'add' && <AddEntry onAdd={handleAddEntry} shops={SHOPS} spices={SPICES} />}
        {activeTab === 'sell' && <AddSale onSell={handleAddSale} shops={SHOPS} spices={SPICES} entries={entries} sales={sales} shopLoads={shopLoads} selectedShop={selectedShop} />}
        {activeTab === 'history' && (
          <History 
            entries={entries}
            sales={sales}
            selectedShop={selectedShop}
            onSelectShop={setSelectedShop}
            shops={SHOPS}
            spices={SPICES}
            shopLoads={shopLoads}
            onDeleteEntry={handleDeleteEntry}
            onDeleteSale={handleDeleteSale}
          />
        )}
      </div>

      <nav className="bottom-nav">
        <div className="nav-brand">
          <img src="/kvs-logo.png" alt="KVS" style={{ width: 36, height: 36, borderRadius: 10, objectFit: 'contain' }} />
          <span>KVS Spices</span>
        </div>
        <button className={`nav-item ${activeTab === 'dashboard' ? 'active' : ''}`} onClick={() => setActiveTab('dashboard')}>
          <Home />
          <span>Dashboard</span>
        </button>
        <button className={`nav-item ${activeTab === 'add' ? 'active' : ''}`} onClick={() => setActiveTab('add')}>
          <PlusCircle />
          <span>Buy</span>
        </button>
        <button className={`nav-item ${activeTab === 'sell' ? 'active' : ''}`} onClick={() => setActiveTab('sell')}>
          <ShoppingBag />
          <span>Sell</span>
        </button>
        <button className={`nav-item ${activeTab === 'history' ? 'active' : ''}`} onClick={() => setActiveTab('history')}>
          <Clock />
          <span>History</span>
        </button>
      </nav>

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
                Total: ₹{(dispatchModal.remainingQty * parseFloat(dispatchPrice)).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
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
                <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>₹{tfAvgPrice}/Kg</div>
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
                <span style={{ fontWeight: 700 }}>₹{(parseFloat(tfQty) * parseFloat(tfPrice)).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
              </div>
            )}

            {/* Validation message */}
            {tfQty && parseFloat(tfQty) > tfAvailableQty && (
              <div style={{
                padding: '0.5rem 0.75rem', marginBottom: '0.75rem',
                background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.25)',
                borderRadius: 8, fontSize: '0.75rem', color: 'var(--danger)',
              }}>
                Exceeds available stock ({tfAvailableQty.toFixed(2)} Kg)
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
                disabled={!tfQty || parseFloat(tfQty) <= 0 || parseFloat(tfQty) > tfAvailableQty || tfFrom === tfTo || !tfPrice || parseFloat(tfPrice) <= 0}
                style={{
                  flex: 1, padding: '0.7rem',
                  borderRadius: 10, border: 'none',
                  background: (!tfQty || parseFloat(tfQty) <= 0 || parseFloat(tfQty) > tfAvailableQty || !tfPrice || parseFloat(tfPrice) <= 0) ? 'rgba(16,185,129,0.3)' : '#10b981',
                  color: '#fff',
                  fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer',
                  opacity: (!tfQty || parseFloat(tfQty) <= 0 || parseFloat(tfQty) > tfAvailableQty || !tfPrice || parseFloat(tfPrice) <= 0) ? 0.5 : 1,
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
function Dashboard({ stats, allBranchStats, shops, selectedShop, onSelectShop, days, onDispatch, onTransfer }) {
  const [showOverallAvg, setShowOverallAvg] = useState(false);

  return (
    <div style={{ animation: 'fadeIn 0.3s ease-in-out' }}>
      <div className="header-row">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <img src="/kvs-logo.png" alt="KVS" style={{ width: 52, height: 52, borderRadius: 12, objectFit: 'contain' }} />
          <div>
            <h1 className="title">KVS Spices</h1>
            <p className="subtitle">Current Load ({days} {days === 1 ? 'day' : 'days'})</p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            onClick={onTransfer}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 36, height: 36,
              background: 'rgba(16,185,129,0.12)',
              border: '1px solid rgba(16,185,129,0.3)',
              borderRadius: 12,
              color: '#10b981',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
            title="Transfer Stock"
          >
            <ArrowRightLeft size={18} />
          </button>
          <button
            onClick={() => setShowOverallAvg(v => !v)}
            style={{
              display: 'flex', alignItems: 'center', gap: '0.4rem',
              background: showOverallAvg ? 'var(--primary-accent)' : 'rgba(59,130,246,0.15)',
              border: '1px solid rgba(59,130,246,0.4)',
              borderRadius: '20px',
              padding: '0.4rem 0.85rem',
              color: showOverallAvg ? '#fff' : 'var(--primary-accent)',
              fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
          >
            <TrendingUp size={14} />
            Overall Avg
          </button>
        </div>
      </div>

      {/* ── Combined Average (All 3 Branches) — toggleable ── */}
      {showOverallAvg && (
        <div style={{ animation: 'fadeIn 0.2s ease-in-out', marginBottom: '1.5rem' }}>
          <div className="stat-grid">
            {allBranchStats.map(spice => (
              <div key={spice.id} className="glass-card" style={{
                padding: '0.85rem',
                borderTop: `3px solid ${spice.color}`,
                background: `linear-gradient(180deg, ${spice.color}11 0%, transparent 60%)`,
              }}>
                <p className="subtitle" style={{ fontSize: '0.7rem' }}>{spice.label}</p>
                <div className="stat-value" style={{ fontSize: '1.3rem', fontWeight: 700, color: spice.color }}>
                  ₹{spice.avgPrice} <span className="stat-unit" style={{ fontSize: '0.6rem' }}>/Kg</span>
                </div>
                <p style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-primary)', margin: '0.35rem 0 0.3rem' }}>
                  {spice.totalQty.toFixed(2)} Kg total
                </p>
                <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: '0.35rem', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                  {spice.perShop.map(ps => (
                    <div key={ps.shop} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.6rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '65%' }}>{ps.shop}</span>
                      <span style={{ fontSize: '0.65rem', fontWeight: 600, color: ps.qty > 0 ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                        {ps.qty > 0 ? `${ps.qty.toFixed(2)} Kg` : '—'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
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

      <h2 className="title" style={{ fontSize: '1.1rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <TrendingUp size={18} /> Average Prices
      </h2>
      <div className="stat-grid">
        {stats.map(spice => (
          <div key={spice.id} className="glass-card" style={{ borderLeft: `4px solid ${spice.color}`, padding: '0.75rem' }}>
            <p className="subtitle" style={{ fontSize: '0.7rem' }}>{spice.label}</p>

            {/* Buy avg (cost-relief adjusted) */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: '0.4rem' }}>
              <span style={{ fontSize: '0.6rem', color: 'var(--text-secondary)' }}>Buy Avg</span>
              <span style={{ fontSize: '1.1rem', fontWeight: 700, color: spice.color }}>
                ₹{spice.avgBuyPrice} <span style={{ fontSize: '0.55rem', fontWeight: 400 }}>/Kg</span>
              </span>
            </div>

            {/* Sell avg — only shown when there are sales */}
            {spice.avgSellPrice !== null && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: '0.25rem' }}>
                  <span style={{ fontSize: '0.6rem', color: 'var(--text-secondary)' }}>Sell Avg</span>
                  <span style={{ fontSize: '1.1rem', fontWeight: 700, color: '#10b981' }}>
                    ₹{spice.avgSellPrice} <span style={{ fontSize: '0.55rem', fontWeight: 400 }}>/Kg</span>
                  </span>
                </div>

                {/* Profit / Loss per kg */}
                <div style={{
                  marginTop: '0.4rem',
                  padding: '0.2rem 0.5rem',
                  borderRadius: 8,
                  background: spice.profitPerKg >= 0 ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                }}>
                  <span style={{ fontSize: '0.6rem', color: 'var(--text-secondary)' }}>
                    {spice.profitPerKg >= 0 ? '▲ Profit' : '▼ Loss'}/Kg
                  </span>
                  <span style={{ fontSize: '0.8rem', fontWeight: 700, color: spice.profitPerKg >= 0 ? '#10b981' : 'var(--danger)' }}>
                    ₹{Math.abs(spice.profitPerKg)}
                  </span>
                </div>
              </>
            )}

            {/* Remaining stock value */}
            {spice.remainingQty > 0 && spice.totalBuyValue > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: '0.35rem', paddingTop: '0.35rem', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <span style={{ fontSize: '0.6rem', color: 'var(--text-secondary)' }}>Stock Value</span>
                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                  ₹{spice.remainingValue.toLocaleString('en-IN')}
                </span>
              </div>
            )}
          </div>
        ))}
      </div>

      <h2 className="title" style={{ fontSize: '1.1rem', margin: '1.5rem 0 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <Filter size={18} /> Stock
      </h2>
      <div className="stat-grid">
        {stats.map(spice => (
          <div key={spice.id} className="glass-card" style={{ padding: '0.75rem' }}>
            <p className="subtitle" style={{ fontSize: '0.7rem' }}>{spice.label}</p>
            <div className="stat-value" style={{ fontSize: '1.2rem', color: spice.remainingQty > 0 ? 'var(--text-primary)' : 'var(--text-secondary)'}}>
              {spice.remainingQty.toFixed(2)} <span className="stat-unit" style={{ fontSize: '0.6rem' }}>Kg left</span>
            </div>
            {spice.soldQty > 0 && (
              <p style={{ fontSize: '0.62rem', color: 'var(--danger)', marginTop: '0.2rem' }}>
                sold {spice.soldQty.toFixed(2)} Kg
              </p>
            )}
            {spice.totalQty > 0 && (
              <button
                onClick={() => onDispatch(spice.id)}
                style={{
                  marginTop: '0.5rem',
                  width: '100%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem',
                  padding: '0.35rem 0.5rem',
                  borderRadius: 8,
                  border: '1px solid rgba(248,113,113,0.3)',
                  background: 'rgba(248,113,113,0.08)',
                  color: 'var(--danger)',
                  fontSize: '0.65rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                <Truck size={12} />
                Dispatch
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function AddEntry({ onAdd, shops, spices }) {
  const [shop, setShop] = useState(shops[0]);
  const [type, setType] = useState(spices[0].id);
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!qty || !price) return alert('Please enter quantity and price.');
    onAdd({
      shop,
      type,
      qty: parseFloat(qty),
      price: parseFloat(price),
      date: new Date().toISOString()
    });
  };

  const selectedSpice = spices.find(s => s.id === type);

  return (
    <div style={{ animation: 'fadeIn 0.3s ease-in-out' }}>
      <h1 className="title">Add Purchase</h1>
      <p className="subtitle" style={{marginBottom: '1.5rem'}}>Select branch and enter details</p>

      <div className="shop-selector">
        {shops.map(s => (
          <div 
            key={s}
            className={`shop-tab ${shop === s ? 'active' : ''}`}
            onClick={() => setShop(s)}
          >
            {s}
          </div>
        ))}
      </div>

      <div className="spice-scroll">
        {spices.map(spice => (
          <div 
            key={spice.id}
            className={`spice-tab ${type === spice.id ? 'active' : ''}`}
            style={type === spice.id ? { background: spice.color } : {}}
            onClick={() => setType(spice.id)}
          >
            {spice.label}
          </div>
        ))}
      </div>

      <form className="glass-card" onSubmit={handleSubmit}>
        <div className="input-group">
          <label className="input-label">Quantity (Kg)</label>
          <input 
            type="number" 
            step="0.01" 
            className="modern-input" 
            placeholder="0.00"
            value={qty}
            onChange={e => setQty(e.target.value)}
          />
        </div>
        
        <div className="input-group">
          <label className="input-label">Price per Kg (₹)</label>
          <input 
            type="number" 
            step="0.01" 
            className="modern-input" 
            placeholder="0.00"
            value={price}
            onChange={e => setPrice(e.target.value)}
          />
        </div>

        <div className="input-group" style={{ marginBottom: '2rem' }}>
          <label className="input-label">Total Value</label>
          <div className="stat-value" style={{ fontSize: '1.5rem', color: selectedSpice.color }}>
            ₹ {qty && price ? (parseFloat(qty) * parseFloat(price)).toFixed(2) : '0.00'}
          </div>
        </div>

        <button type="submit" className="btn btn-primary" style={{ background: selectedSpice.color }}>
          <PlusCircle size={20} />
          Save Entry
        </button>
      </form>
    </div>
  );
}

function AddSale({ onSell, shops, spices, entries, sales, shopLoads, selectedShop }) {
  const [shop, setShop] = useState(selectedShop || shops[0]);
  const [type, setType] = useState(spices[0].id);
  const [qty, setQty] = useState('');
  const [sellPrice, setSellPrice] = useState('');
  const [buyerName, setBuyerName] = useState('');

  const selectedSpice = spices.find(s => s.id === type);

  // Compute stock for the selected shop & spice dynamically
  const currentLoad = shopLoads[`${shop}|${type}`] || { id: '0' };
  const boughtQty = entries
    .filter(e => e.shop === shop && e.loadId === currentLoad.id && e.type === type)
    .reduce((sum, e) => sum + Number(e.qty), 0);
  const boughtValue = entries
    .filter(e => e.shop === shop && e.loadId === currentLoad.id && e.type === type)
    .reduce((sum, e) => sum + Number(e.qty) * Number(e.price), 0);
  const soldQty = sales
    .filter(s => s.shop === shop && s.loadId === currentLoad.id && s.type === type)
    .reduce((sum, s) => sum + Number(s.qty), 0);
  const soldValue = sales
    .filter(s => s.shop === shop && s.loadId === currentLoad.id && s.type === type)
    .reduce((sum, s) => sum + Number(s.qty) * Number(s.sellPrice), 0);
  const availableQty = Math.max(0, boughtQty - soldQty);

  // Cost-relief method: remaining value = buy value − sale proceeds
  const remainingValue = boughtValue - soldValue;
  const avgBuyPrice = availableQty > 0 ? +(remainingValue / availableQty).toFixed(2) : (boughtQty > 0 ? +(boughtValue / boughtQty).toFixed(2) : 0);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!qty || !sellPrice) return alert('Please enter quantity and sell price.');
    if (parseFloat(qty) > availableQty) return alert(`Only ${availableQty.toFixed(2)} Kg available in ${shop}.`);
    onSell({ shop, type, qty: parseFloat(qty), sellPrice: parseFloat(sellPrice), buyerName });
    setQty('');
    setSellPrice('');
    setBuyerName('');
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
      <h1 className="title">Record Sale</h1>
      <p className="subtitle" style={{ marginBottom: '1.5rem' }}>Select branch and enter sale details</p>

      <div className="shop-selector">
        {shops.map(s => (
          <div key={s} className={`shop-tab ${shop === s ? 'active' : ''}`} onClick={() => setShop(s)}>
            {s}
          </div>
        ))}
      </div>

      <div className="spice-scroll">
        {spices.map(spice => (
          <div
            key={spice.id}
            className={`spice-tab ${type === spice.id ? 'active' : ''}`}
            style={type === spice.id ? { background: spice.color } : {}}
            onClick={() => setType(spice.id)}
          >
            {spice.label}
          </div>
        ))}
      </div>

      {/* Available stock indicator */}
      <div className="glass-card" style={{ padding: '0.75rem 1rem', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="subtitle" style={{ fontSize: '0.8rem' }}>Available in {shop}</span>
          <span style={{ fontWeight: 700, fontSize: '1rem', color: availableQty > 0 ? selectedSpice.color : 'var(--danger)' }}>
            {availableQty.toFixed(2)} Kg
          </span>
        </div>
        {availableQty > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.35rem', paddingTop: '0.35rem', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <span className="subtitle" style={{ fontSize: '0.7rem' }}>Current Avg Buy</span>
            <span style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-primary)' }}>₹{avgBuyPrice}/Kg</span>
          </div>
        )}
        {availableQty > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.2rem' }}>
            <span className="subtitle" style={{ fontSize: '0.7rem' }}>Stock Value</span>
            <span style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-primary)' }}>₹{remainingValue > 0 ? remainingValue.toLocaleString('en-IN') : '0'}</span>
          </div>
        )}
      </div>

      <form className="glass-card" onSubmit={handleSubmit}>
        <div className="input-group">
          <label className="input-label">Buyer Name (optional)</label>
          <input
            type="text"
            className="modern-input"
            placeholder="e.g. Rajan"
            value={buyerName}
            onChange={e => setBuyerName(e.target.value)}
          />
        </div>

        <div className="input-group">
          <label className="input-label">Quantity to Sell (Kg)</label>
          <input
            type="number"
            step="0.01"
            className="modern-input"
            placeholder="0.00"
            value={qty}
            onChange={e => setQty(e.target.value)}
          />
        </div>

        <div className="input-group">
          <label className="input-label">Sell Price per Kg (₹)</label>
          <input
            type="number"
            step="0.01"
            className="modern-input"
            placeholder="0.00"
            value={sellPrice}
            onChange={e => setSellPrice(e.target.value)}
          />
        </div>

        <div className="input-group" style={{ marginBottom: '2rem' }}>
          <label className="input-label">Sale Summary</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginTop: '0.25rem' }}>
            <div className="stat-value" style={{ fontSize: '1.5rem', color: selectedSpice.color }}>
              ₹ {qty && sellPrice ? (parseFloat(qty) * parseFloat(sellPrice)).toFixed(2) : '0.00'}
            </div>
            {profit !== null && (
              <span style={{ fontSize: '0.78rem', fontWeight: 600, color: parseFloat(profit) >= 0 ? '#10b981' : 'var(--danger)' }}>
                {parseFloat(profit) >= 0 ? '▲' : '▼'} ₹{Math.abs(parseFloat(profit)).toLocaleString('en-IN')} {parseFloat(profit) >= 0 ? 'profit' : 'loss'} vs current avg
              </span>
            )}
            {previewAvg !== null && qty && sellPrice && parseFloat(qty) > 0 && (
              <div style={{ marginTop: '0.3rem', padding: '0.5rem 0.65rem', borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>After sale: {previewQty.toFixed(2)} Kg left</span>
                  <span style={{ fontWeight: 700, color: previewAvg < avgBuyPrice ? '#10b981' : previewAvg > avgBuyPrice ? 'var(--danger)' : 'var(--text-primary)' }}>
                    Avg ₹{previewAvg}/Kg
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', marginTop: '0.15rem' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Stock value</span>
                  <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>₹{previewValue > 0 ? Math.round(previewValue).toLocaleString('en-IN') : '0'}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        <button type="submit" className="btn btn-primary" style={{ background: 'var(--danger)' }}>
          <ShoppingBag size={20} />
          Confirm Sale
        </button>
      </form>
    </div>
  );
}

function History({ entries, sales, selectedShop, onSelectShop, shops, spices, shopLoads, onDeleteEntry, onDeleteSale }) {
  // Merge purchases + sales, sort newest first
  const allRecords = [
    ...entries.map(e => ({ ...e, kind: 'purchase' })),
    ...sales.map(s => ({ ...s, kind: 'sale' })),
  ].sort((a, b) => new Date(b.date) - new Date(a.date));

  const shopRecords = allRecords.filter(r => r.shop === selectedShop);

  const getLoad = (shop, spiceId) => shopLoads[`${shop}|${spiceId}`] || { id: '0' };

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
    const R = (val) => `Rs.${val}`;

    // ── Stock Summary ──
    y = sectionTitle('Stock Summary', y);

    const summaryData = spices.map(spice => {
      const spiceEntries = entries.filter(e => e.shop === selectedShop && e.type === spice.id);
      const spiceSales = sales.filter(s => s.shop === selectedShop && s.type === spice.id);
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
        remainingValue > 0 ? Math.round(remainingValue).toLocaleString('en-IN') : '0',
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
                data.cell.text = [`${num >= 0 ? '+' : ''}${R(Math.round(num).toLocaleString('en-IN'))}`];
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
      R(Math.round(totals.totalBuyValue).toLocaleString('en-IN')),
      R(Math.round(totals.totalSellValue).toLocaleString('en-IN')),
      R(Math.round(totalRemainingValue).toLocaleString('en-IN')),
      `${totalProfit >= 0 ? '+' : ''}${R(Math.round(totalProfit).toLocaleString('en-IN'))}`,
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
    const shopPurchases = entries.filter(e => e.shop === selectedShop).sort((a, b) => new Date(b.date) - new Date(a.date));

    if (shopPurchases.length > 0) {
      if (y > pageH - 50) { doc.addPage(); drawPageBg(); drawTopStripe(); y = 12; }
      y = sectionTitle('Purchase Records', y);

      const purchaseRows = shopPurchases.map(e => [
        format(new Date(e.date), 'dd MMM yy'),
        e.type.replace('_', ' '),
        `${Number(e.qty).toFixed(2)} Kg`,
        R(Number(e.price).toLocaleString('en-IN')),
        R(Math.round(Number(e.qty) * Number(e.price)).toLocaleString('en-IN')),
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
    const shopSales = sales.filter(s => s.shop === selectedShop).sort((a, b) => new Date(b.date) - new Date(a.date));

    if (shopSales.length > 0) {
      if (y > pageH - 50) { doc.addPage(); drawPageBg(); drawTopStripe(); y = 12; }
      y = sectionTitle('Sale Records', y, green);

      const saleRows = shopSales.map(s => [
        format(new Date(s.date), 'dd MMM yy'),
        s.type.replace('_', ' '),
        `${Number(s.qty).toFixed(2)} Kg`,
        R(Number(s.sellPrice).toLocaleString('en-IN')),
        R(Math.round(Number(s.qty) * Number(s.sellPrice)).toLocaleString('en-IN')),
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
    const R = (val) => `Rs.${val}`;

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
          remainingValue > 0 ? Math.round(remainingValue).toLocaleString('en-IN') : '0', profit];
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
              if (data.column.index === 7) { const v = data.cell.raw; if (v && v !== '-') { const num = parseFloat(v); data.cell.styles.textColor = num >= 0 ? green : red; data.cell.text = [`${num >= 0 ? '+' : ''}${R(Math.round(num).toLocaleString('en-IN'))}`]; } }
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
      R(Math.round(grandTotals.buyValue).toLocaleString('en-IN')),
      R(Math.round(grandTotals.sellValue).toLocaleString('en-IN')),
      R(Math.round(gRemVal).toLocaleString('en-IN')),
      `${gProfit >= 0 ? '+' : ''}${R(Math.round(gProfit).toLocaleString('en-IN'))}`,
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

  return (
    <div style={{ animation: 'fadeIn 0.3s ease-in-out' }}>
      <h1 className="title">History</h1>
      <p className="subtitle" style={{ marginBottom: '1.5rem' }}>Purchases & sales for each branch</p>

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

      <div className="glass-card history-buttons-row" style={{ marginBottom: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <button className="btn btn-primary" style={{ background: 'var(--primary-accent)' }} onClick={generatePDF}>
          <Download size={20} />
          Download {selectedShop} Report
        </button>
        <button className="btn btn-primary" style={{ background: 'rgba(76,175,80,0.9)' }} onClick={generateOverallPDF}>
          <Download size={20} />
          Download Overall Report (All Shops)
        </button>
      </div>

      <h2 className="title" style={{ fontSize: '1.2rem', marginBottom: '1rem' }}>All Records</h2>
      <div className="glass-card" style={{ padding: '0 1.25rem' }}>
        {shopRecords.length === 0 ? (
          <p style={{ padding: '1rem 0', textAlign: 'center', color: 'var(--text-secondary)' }}>No records yet.</p>
        ) : (
          shopRecords.map(r => (
            <div key={r.id} className="history-item" style={{ position: 'relative' }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                  <span style={{
                    fontSize: '0.65rem', fontWeight: 700, padding: '0.15rem 0.5rem',
                    borderRadius: 6,
                    background: r.kind === 'sale' ? 'rgba(239,68,68,0.15)' : 'rgba(59,130,246,0.15)',
                    color: r.kind === 'sale' ? 'var(--danger)' : 'var(--primary-accent)',
                    border: `1px solid ${r.kind === 'sale' ? 'rgba(239,68,68,0.3)' : 'rgba(59,130,246,0.3)'}`,
                  }}>
                    {r.kind === 'sale' ? '↑ SALE' : '↓ BUY'}
                  </span>
                  <span className={`badge badge-${r.type.replace('_', '-')}`}>
                    {r.type.replace('_', ' ')}
                  </span>
                  <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>{r.qty} Kg</span>
                  {r.kind === 'sale' && r.buyerName && (
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>→ {r.buyerName}</span>
                  )}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  {format(new Date(r.date), 'MMM d, yyyy - h:mm a')}
                  {' • '}₹{r.kind === 'sale' ? r.sellPrice : r.price}/kg
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div style={{ fontWeight: 700, fontSize: '1rem', color: r.kind === 'sale' ? '#10b981' : 'var(--text-primary)', textAlign: 'right' }}>
                  ₹{r.totalValue ? r.totalValue.toFixed(2) : (r.qty * (r.sellPrice || r.price)).toFixed(2)}
                </div>
                <button
                  onClick={() => r.kind === 'sale' ? onDeleteSale(r.id) : onDeleteEntry(r.id)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    width: 30, height: 30,
                    borderRadius: 8,
                    border: '1px solid rgba(248,113,113,0.25)',
                    background: 'rgba(248,113,113,0.08)',
                    color: 'var(--danger)',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    flexShrink: 0,
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default App;


