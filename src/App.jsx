import React, { useState, useEffect } from 'react';
import { Home, PlusCircle, Clock, Truck, Download, TrendingUp, Filter, ShoppingBag } from 'lucide-react';
import { format, differenceInDays } from 'date-fns';

const SHOPS = ['KVS Anachal', '20 Acre', 'Kallar'];
const SPICES = [
  { id: 'cardamom', label: 'Cardamom', color: 'var(--cardamom-main)' },
  { id: 'pepper', label: 'Pepper', color: 'var(--pepper-main)' },
  { id: 'nutmeg', label: 'Nutmeg', color: 'var(--nutmeg-main)' },
  { id: 'nutmeg_mace', label: 'Nutmeg mace', color: 'var(--nutmeg-main)' },
  { id: 'coffee', label: 'Coffee', color: 'var(--coffee-main)' },
  { id: 'clove', label: 'Clove', color: 'var(--clove-main)' }
];

function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [selectedShop, setSelectedShop] = useState(SHOPS[0]);
  
  // Data State
  const [entries, setEntries] = useState(() => {
    const saved = localStorage.getItem('spice_entries');
    return saved ? JSON.parse(saved) : [];
  });

  const [sales, setSales] = useState(() => {
    const saved = localStorage.getItem('spice_sales');
    return saved ? JSON.parse(saved) : [];
  });
  
  const [shopLoads, setShopLoads] = useState(() => {
    const saved = localStorage.getItem('spice_shop_loads');
    if (saved) {
      const parsed = JSON.parse(saved);
      // Migrate old format (key = shop name) → new format (key = "shop|spice")
      const firstKey = Object.keys(parsed)[0] || '';
      if (firstKey && !firstKey.includes('|')) {
        const migrated = {};
        SHOPS.forEach(shop => {
          SPICES.forEach(spice => {
            migrated[`${shop}|${spice.id}`] = parsed[shop] || { id: Date.now().toString(), start: Date.now() };
          });
        });
        return migrated;
      }
      return parsed;
    }
    const initial = {};
    SHOPS.forEach(shop => {
      SPICES.forEach(spice => {
        initial[`${shop}|${spice.id}`] = { id: Date.now().toString(), start: Date.now() };
      });
    });
    return initial;
  });

  // Helper to get the load for a specific shop + spice
  const getLoad = (shop, spiceId) => shopLoads[`${shop}|${spiceId}`] || { id: '0', start: Date.now() };

  // Save to local storage when changed
  useEffect(() => {
    localStorage.setItem('spice_entries', JSON.stringify(entries));
  }, [entries]);

  useEffect(() => {
    localStorage.setItem('spice_sales', JSON.stringify(sales));
  }, [sales]);

  useEffect(() => {
    localStorage.setItem('spice_shop_loads', JSON.stringify(shopLoads));
  }, [shopLoads]);

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

  const LOCAL_BACKEND_URL = 'http://localhost:3001/api/add-entry';
  const LOCAL_SALE_URL    = 'http://localhost:3001/api/add-sale';

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
      await fetch(LOCAL_BACKEND_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newEntry)
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
      await fetch(LOCAL_SALE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSale)
      });
    } catch (error) {
      console.error("Error sending sale to Google Sheets:", error);
    }
  };

  const handleDispatchLoad = () => {
    if (confirm(`Dispatch all spices from ${selectedShop}? This will reset all data for this branch.`)) {
      const newLoads = { ...shopLoads };
      SPICES.forEach(spice => {
        newLoads[`${selectedShop}|${spice.id}`] = { id: Date.now().toString(), start: Date.now() };
      });
      setShopLoads(newLoads);
      setActiveTab('dashboard');
    }
  };

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
          />
        )}
      </div>

      <nav className="bottom-nav">
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
    </>
  );
}

// COMPONENTS
function Dashboard({ stats, allBranchStats, shops, selectedShop, onSelectShop, days, onDispatch }) {
  const [showOverallAvg, setShowOverallAvg] = useState(false);

  return (
    <div style={{ animation: 'fadeIn 0.3s ease-in-out' }}>
      <div className="header-row">
        <div>
          <h1 className="title">Dashboard</h1>
          <p className="subtitle">Current Load ({days} {days === 1 ? 'day' : 'days'})</p>
        </div>
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
          </div>
        ))}
      </div>

      <div className="glass-card" style={{ marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <button className="btn btn-danger" onClick={onDispatch}>
          <Truck size={20} />
          Dispatch {selectedShop} Load
        </button>
        <p className="subtitle" style={{ fontSize: '0.75rem', textAlign: 'center' }}>
          Dispatching resets all spice data for {selectedShop}.
        </p>
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

function History({ entries, sales, selectedShop, onSelectShop, shops }) {
  // Merge purchases + sales, sort newest first
  const allRecords = [
    ...entries.map(e => ({ ...e, kind: 'purchase' })),
    ...sales.map(s => ({ ...s, kind: 'sale' })),
  ].sort((a, b) => new Date(b.date) - new Date(a.date));

  const shopRecords = allRecords.filter(r => r.shop === selectedShop);

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

      <div className="glass-card" style={{ marginBottom: '1.5rem' }}>
        <button className="btn btn-primary" style={{ background: 'var(--primary-accent)' }}>
          <Download size={20} />
          Download {selectedShop} CSV
        </button>
      </div>

      <h2 className="title" style={{ fontSize: '1.2rem', marginBottom: '1rem' }}>All Records</h2>
      <div className="glass-card" style={{ padding: '0 1.25rem' }}>
        {shopRecords.length === 0 ? (
          <p style={{ padding: '1rem 0', textAlign: 'center', color: 'var(--text-secondary)' }}>No records yet.</p>
        ) : (
          shopRecords.map(r => (
            <div key={r.id} className="history-item">
              <div>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                  {/* SALE / PURCHASE badge */}
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
              <div style={{ fontWeight: 700, fontSize: '1rem', color: r.kind === 'sale' ? '#10b981' : 'var(--text-primary)' }}>
                ₹{r.totalValue ? r.totalValue.toFixed(2) : (r.qty * (r.sellPrice || r.price)).toFixed(2)}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default App;


