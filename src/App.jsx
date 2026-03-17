import React, { useState, useEffect } from 'react';
import { Home, PlusCircle, Clock, Truck, Download, TrendingUp } from 'lucide-react';
import { format, differenceInDays } from 'date-fns';

function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  
  // Data State
  const [entries, setEntries] = useState(() => {
    const saved = localStorage.getItem('spice_entries');
    return saved ? JSON.parse(saved) : [];
  });
  
  const [currentLoadId, setCurrentLoadId] = useState(() => {
    const saved = localStorage.getItem('spice_current_load');
    return saved ? saved : Date.now().toString();
  });

  const [loadStartDate, setLoadStartDate] = useState(() => {
    const saved = localStorage.getItem('spice_load_start');
    return saved ? parseInt(saved, 10) : Date.now();
  });

  // Save to local storage when changed
  useEffect(() => {
    localStorage.setItem('spice_entries', JSON.stringify(entries));
  }, [entries]);

  useEffect(() => {
    localStorage.setItem('spice_current_load', currentLoadId);
    localStorage.setItem('spice_load_start', loadStartDate.toString());
  }, [currentLoadId, loadStartDate]);

  // Derived state for the CURRENT load
  const currentEntries = entries.filter(e => e.loadId === currentLoadId);
  const cardamomEntries = currentEntries.filter(e => e.type === 'cardamom');
  const pepperEntries = currentEntries.filter(e => e.type === 'pepper');

  const totalCardamomQty = cardamomEntries.reduce((sum, e) => sum + Number(e.qty), 0);
  const totalPepperQty = pepperEntries.reduce((sum, e) => sum + Number(e.qty), 0);

  const totalCardamomValue = cardamomEntries.reduce((sum, e) => sum + (Number(e.qty) * Number(e.price)), 0);
  const totalPepperValue = pepperEntries.reduce((sum, e) => sum + (Number(e.qty) * Number(e.price)), 0);

  // Calculate Average Price per Kg for the current load
  const daysSinceLoadStart = Math.max(1, differenceInDays(new Date(), new Date(loadStartDate)) + 1);
  const avgCardamom = totalCardamomQty > 0 ? (totalCardamomValue / totalCardamomQty).toFixed(2) : "0.00";
  const avgPepper = totalPepperQty > 0 ? (totalPepperValue / totalPepperQty).toFixed(2) : "0.00";

  // Use our local Node.js backend
  const LOCAL_BACKEND_URL = 'http://localhost:3001/api/add-entry';

  const handleAddEntry = async (entry) => {
    const newEntry = { ...entry, id: Date.now(), loadId: currentLoadId, totalValue: entry.qty * entry.price };
    
    // Update local state instantly (Optimistic UI)
    setEntries([newEntry, ...entries]);
    setActiveTab('dashboard'); // Redirect to dashboard after adding

    try {
      await fetch(LOCAL_BACKEND_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
          body: JSON.stringify(newEntry)
        });
        console.log("Successfully sent to Google Sheets (in background router)!");
      } catch (error) {
        console.error("Error sending to Google Sheets:", error);
      }
    }
  };

  const handleDispatchLoad = () => {
    if (confirm('Are you sure you want to dispatch the current load? This will reset the dashboard averages.')) {
      setCurrentLoadId(Date.now().toString());
      setLoadStartDate(Date.now());
      setActiveTab('dashboard');
    }
  };

  return (
    <>
      <div className="content-area">
        {activeTab === 'dashboard' && (
          <Dashboard 
            totalCardamom={totalCardamomQty} 
            totalPepper={totalPepperQty}
            avgCardamom={avgCardamom}
            avgPepper={avgPepper}
            days={daysSinceLoadStart}
          />
        )}
        {activeTab === 'add' && <AddEntry onAdd={handleAddEntry} />}
        {activeTab === 'history' && (
          <History 
            entries={entries} 
            onDispatch={handleDispatchLoad} 
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
function Dashboard({ totalCardamom, totalPepper, avgCardamom, avgPepper, days }) {
  return (
    <div style={{ animation: 'fadeIn 0.3s ease-in-out' }}>
      <div className="header-row">
        <div>
          <h1 className="title">Dashboard</h1>
          <p className="subtitle">Current Load Overview ({days} {days === 1 ? 'day' : 'days'})</p>
        </div>
        <div style={{ background: 'rgba(255,255,255,0.1)', padding: '0.5rem', borderRadius: '50%' }}>
          <TrendingUp size={24} color="var(--primary-accent)" />
        </div>
      </div>

      <h2 className="title" style={{ fontSize: '1.2rem', marginBottom: '1rem' }}>Average Price</h2>
      <div className="stat-grid">
        <div className="glass-card" style={{ borderLeft: '4px solid var(--cardamom-main)' }}>
          <p className="subtitle">Cardamom</p>
          <div className="stat-value stat-cardamom">
            ₹{avgCardamom} <span className="stat-unit">/Kg</span>
          </div>
        </div>
        <div className="glass-card" style={{ borderLeft: '4px solid var(--pepper-main)' }}>
          <p className="subtitle">Pepper</p>
          <div className="stat-value stat-pepper">
            ₹{avgPepper} <span className="stat-unit">/Kg</span>
          </div>
        </div>
      </div>

      <h2 className="title" style={{ fontSize: '1.2rem', margin: '1.5rem 0 1rem' }}>Total in Stock</h2>
      <div className="stat-grid">
        <div className="glass-card">
          <p className="subtitle">Cardamom</p>
          <div className="stat-value" style={{ color: 'var(--text-primary)'}}>
            {totalCardamom.toFixed(2)} <span className="stat-unit">Kg</span>
          </div>
        </div>
        <div className="glass-card">
          <p className="subtitle">Pepper</p>
          <div className="stat-value" style={{ color: 'var(--text-primary)'}}>
            {totalPepper.toFixed(2)} <span className="stat-unit">Kg</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function AddEntry({ onAdd }) {
  const [type, setType] = useState('cardamom');
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!qty || !price) return alert('Please enter quantity and price.');
    onAdd({
      type,
      qty: parseFloat(qty),
      price: parseFloat(price),
      date: new Date().toISOString()
    });
  };

  return (
    <div style={{ animation: 'fadeIn 0.3s ease-in-out' }}>
      <h1 className="title">Add Purchase</h1>
      <p className="subtitle" style={{marginBottom: '1.5rem'}}>Enter today's load</p>

      <div className="spice-selector">
        <div 
          className={`spice-tab cardamom ${type === 'cardamom' ? 'active' : ''}`}
          onClick={() => setType('cardamom')}
        >
          Cardamom
        </div>
        <div 
          className={`spice-tab pepper ${type === 'pepper' ? 'active' : ''}`}
          onClick={() => setType('pepper')}
        >
          Pepper
        </div>
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
          <div className="stat-value" style={{ fontSize: '1.5rem', color: type === 'cardamom' ? 'var(--cardamom-main)' : 'var(--pepper-main)' }}>
            ₹ {qty && price ? (parseFloat(qty) * parseFloat(price)).toFixed(2) : '0.00'}
          </div>
        </div>

        <button type="submit" className="btn btn-primary" style={{ background: type === 'cardamom' ? 'var(--cardamom-main)' : 'var(--pepper-main)' }}>
          <PlusCircle size={20} />
          Save Entry
        </button>
      </form>
    </div>
  );
}

function History({ entries, onDispatch }) {
  return (
    <div style={{ animation: 'fadeIn 0.3s ease-in-out' }}>
      <h1 className="title">History & Actions</h1>
      <p className="subtitle" style={{marginBottom: '1.5rem'}}>Manage loads and reports</p>

      <div className="glass-card" style={{ marginBottom: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <button className="btn btn-primary" style={{ background: 'var(--primary-accent)' }}>
          <Download size={20} />
          Download CSV Report
        </button>
        <button className="btn btn-danger" onClick={onDispatch}>
          <Truck size={20} />
          Dispatch Current Load
        </button>
        <p className="subtitle" style={{ fontSize: '0.75rem', textAlign: 'center' }}>
          Dispatching resets the dashboard average calculations for the next load.
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
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                  <span className={`badge ${e.type === 'cardamom' ? 'badge-cardamom' : 'badge-pepper'}`}>
                    {e.type}
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
