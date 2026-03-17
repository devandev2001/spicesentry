import React, { useState, useEffect } from 'react';
import { Home, PlusCircle, Clock, Truck, Download, TrendingUp, Filter } from 'lucide-react';
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
  
  const [shopLoads, setShopLoads] = useState(() => {
    const saved = localStorage.getItem('spice_shop_loads');
    if (saved) return JSON.parse(saved);
    const initial = {};
    SHOPS.forEach(shop => {
      initial[shop] = { id: Date.now().toString(), start: Date.now() };
    });
    return initial;
  });

  // Save to local storage when changed
  useEffect(() => {
    localStorage.setItem('spice_entries', JSON.stringify(entries));
  }, [entries]);

  useEffect(() => {
    localStorage.setItem('spice_shop_loads', JSON.stringify(shopLoads));
  }, [shopLoads]);

  // Derived state for the CURRENT load and SELECTED shop
  const currentShopLoad = shopLoads[selectedShop] || { id: '0', start: Date.now() };
  
  // Filter entries that belong to the current load of the selected shop
  const shopEntries = entries.filter(e => 
    e.shop === selectedShop && e.loadId === currentShopLoad.id
  );

  const stats = SPICES.map(spice => {
    const spiceEntries = shopEntries.filter(e => e.type === spice.id);
    const totalQty = spiceEntries.reduce((sum, e) => sum + Number(e.qty), 0);
    const totalValue = spiceEntries.reduce((sum, e) => sum + (Number(e.qty) * Number(e.price)), 0);
    const avgPrice = totalQty > 0 ? (totalValue / totalQty).toFixed(2) : "0.00";
    
    return {
      ...spice,
      totalQty,
      avgPrice
    };
  });

  const daysSinceLoadStart = Math.max(1, differenceInDays(new Date(), new Date(currentShopLoad.start)) + 1);

  const LOCAL_BACKEND_URL = 'http://localhost:3001/api/add-entry';

  const handleAddEntry = async (entry) => {
    const shopLoad = shopLoads[entry.shop];
    const newEntry = { 
      ...entry, 
      id: Date.now(), 
      loadId: shopLoad.id, 
      totalValue: entry.qty * entry.price 
    };
    
    setEntries([newEntry, ...entries]);
    setActiveTab('dashboard');
    setSelectedShop(entry.shop);

    try {
      await fetch(LOCAL_BACKEND_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(newEntry)
      });
    } catch (error) {
      console.error("Error sending to Google Sheets:", error);
    }
  };

  const handleDispatchLoad = () => {
    if (confirm(`Are you sure you want to dispatch the current load for ${selectedShop}? This will reset its dashboard averages.`)) {
      setShopLoads(prev => ({
        ...prev,
        [selectedShop]: { id: Date.now().toString(), start: Date.now() }
      }));
      setActiveTab('dashboard');
    }
  };

  return (
    <>
      <div className="content-area">
        {activeTab === 'dashboard' && (
          <Dashboard 
            stats={stats} 
            shops={SHOPS}
            selectedShop={selectedShop}
            onSelectShop={setSelectedShop}
            days={daysSinceLoadStart}
          />
        )}
        {activeTab === 'add' && <AddEntry onAdd={handleAddEntry} shops={SHOPS} spices={SPICES} />}
        {activeTab === 'history' && (
          <History 
            entries={entries} 
            onDispatch={handleDispatchLoad} 
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
          <span>Add</span>
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
function Dashboard({ stats, shops, selectedShop, onSelectShop, days }) {
  return (
    <div style={{ animation: 'fadeIn 0.3s ease-in-out' }}>
      <div className="header-row">
        <div>
          <h1 className="title">Dashboard</h1>
          <p className="subtitle">Current Load ({days} {days === 1 ? 'day' : 'days'})</p>
        </div>
        <div style={{ background: 'rgba(255,255,255,0.1)', padding: '0.5rem', borderRadius: '50%' }}>
          <TrendingUp size={24} color="var(--primary-accent)" />
        </div>
      </div>

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
            <div className="stat-value" style={{ fontSize: '1.2rem', color: spice.color }}>
              ₹{spice.avgPrice} <span className="stat-unit" style={{ fontSize: '0.6rem' }}>/Kg</span>
            </div>
          </div>
        ))}
      </div>

      <h2 className="title" style={{ fontSize: '1.1rem', margin: '1.5rem 0 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <Filter size={18} /> Total Stock
      </h2>
      <div className="stat-grid">
        {stats.map(spice => (
          <div key={spice.id} className="glass-card" style={{ padding: '0.75rem' }}>
            <p className="subtitle" style={{ fontSize: '0.7rem' }}>{spice.label}</p>
            <div className="stat-value" style={{ fontSize: '1.2rem', color: 'var(--text-primary)'}}>
              {spice.totalQty.toFixed(2)} <span className="stat-unit" style={{ fontSize: '0.6rem' }}>Kg</span>
            </div>
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

function History({ entries, onDispatch, selectedShop, onSelectShop, shops }) {
  return (
    <div style={{ animation: 'fadeIn 0.3s ease-in-out' }}>
      <h1 className="title">History & Actions</h1>
      <p className="subtitle" style={{marginBottom: '1.5rem'}}>Manage loads and reports</p>

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

      <div className="glass-card" style={{ marginBottom: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <button className="btn btn-primary" style={{ background: 'var(--primary-accent)' }}>
          <Download size={20} />
          Download {selectedShop} CSV
        </button>
        <button className="btn btn-danger" onClick={onDispatch}>
          <Truck size={20} />
          Dispatch {selectedShop} Load
        </button>
        <p className="subtitle" style={{ fontSize: '0.75rem', textAlign: 'center' }}>
          Dispatching resets averages ONLY for the selected branch.
        </p>
      </div>

      <h2 className="title" style={{ fontSize: '1.2rem', marginBottom: '1rem' }}>All Entries</h2>
      <div className="glass-card" style={{ padding: '0 1.25rem' }}>
        {entries.length === 0 ? (
          <p style={{ padding: '1rem 0', textAlign: 'center', color: 'var(--text-secondary)' }}>No entries yet.</p>
        ) : (
          entries.map(e => (
            <div key={e.id} className="history-item">
              <div>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                  <span className={`badge badge-shop`}>{e.shop}</span>
                  <span className={`badge badge-${e.type.replace('_', '-')}`}>
                    {e.type.replace('_', ' ')}
                  </span>
                  <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>{e.qty} Kg</span>
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  {format(new Date(e.date), 'MMM d, yyyy - h:mm a')} • ₹{e.price}/kg
                </div>
              </div>
              <div style={{ fontWeight: 700, fontSize: '1rem' }}>
                ₹{(e.qty * e.price).toFixed(2)}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default App;


