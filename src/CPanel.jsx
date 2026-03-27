import React, { useState, useEffect } from 'react';
import { useAuth } from './AuthContext';
import { db, collection, doc, getDocs, setDoc, updateDoc, deleteDoc } from './firebase';
import { Trash2, Pencil, Eye, EyeOff, ShieldCheck, ShoppingBag, Plus, ArrowLeft, Users, Store, Leaf, Settings, BarChart3 } from 'lucide-react';

const TABS = [
  { id: 'users', label: 'Users', icon: Users },
  { id: 'shops', label: 'Shops', icon: Store },
  { id: 'spices', label: 'Spices', icon: Leaf },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export default function CPanel({ onBack, shops, spices, onUpdateConfig }) {
  const { users, fetchUsers, addUser, updateUser, removeUser, resetPin, isOwner, user: currentUser } = useAuth();
  const [activeTab, setActiveTab] = useState('users');
  const [loaded, setLoaded] = useState(false);

  // Config from Firestore
  const [configShops, setConfigShops] = useState([]);
  const [configSpices, setConfigSpices] = useState([]);
  const [appSettings, setAppSettings] = useState({});

  useEffect(() => {
    fetchUsers().then(() => setLoaded(true));
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      const configDoc = await getDocs(collection(db, 'config'));
      const configMap = {};
      configDoc.docs.forEach(d => { configMap[d.id] = d.data(); });
      if (configMap.shops?.list) setConfigShops(configMap.shops.list);
      if (configMap.spices?.list) setConfigSpices(configMap.spices.list);
      if (configMap.settings) setAppSettings(configMap.settings);
    } catch (err) {
      console.error('Failed to load config:', err);
    }
  };

  if (!isOwner) return null;

  return (
    <div className="page-section cpanel">
      <div className="cpanel-header">
        <button onClick={onBack} className="cpanel-back-btn">
          <ArrowLeft size={18} />
          <span>Back to App</span>
        </button>
        <h1 className="page-title">Control Panel</h1>
        <p className="caption" style={{ marginTop: 4 }}>Manage users, shops, spices & settings</p>
      </div>

      <div className="cpanel-tabs">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`cpanel-tab ${activeTab === t.id ? 'active' : ''}`}
            onClick={() => setActiveTab(t.id)}
          >
            <t.icon size={16} />
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      <div className="cpanel-body">
        {activeTab === 'users' && <UsersPanel users={users} addUser={addUser} updateUser={updateUser} removeUser={removeUser} resetPin={resetPin} shops={shops} currentUser={currentUser} loaded={loaded} />}
        {activeTab === 'shops' && <ShopsPanel shops={shops} configShops={configShops} setConfigShops={setConfigShops} onUpdateConfig={onUpdateConfig} />}
        {activeTab === 'spices' && <SpicesPanel spices={spices} configSpices={configSpices} setConfigSpices={setConfigSpices} onUpdateConfig={onUpdateConfig} />}
        {activeTab === 'settings' && <SettingsPanel appSettings={appSettings} setAppSettings={setAppSettings} />}
      </div>
    </div>
  );
}

// ─── Users Panel ──────────────────────────────────────────────────────
function UsersPanel({ users, addUser, updateUser, removeUser, resetPin, shops, currentUser, loaded }) {
  const [showForm, setShowForm] = useState(false);
  const [editingUid, setEditingUid] = useState(null);
  const [form, setForm] = useState({ name: '', pin: '', role: 'staff', shop: shops[0] || '' });
  const [pinVisible, setPinVisible] = useState({});
  const [resetPinUid, setResetPinUid] = useState(null);
  const [newPin, setNewPin] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const openAdd = () => {
    setForm({ name: '', pin: '', role: 'staff', shop: shops[0] || '' });
    setEditingUid(null);
    setShowForm(true);
    setError('');
  };

  const openEdit = (u) => {
    setForm({ name: u.name, pin: '', role: u.role, shop: u.shop || '' });
    setEditingUid(u.uid);
    setShowForm(true);
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { setError('Name is required'); return; }
    if (!editingUid && (!form.pin || form.pin.length < 4)) { setError('PIN must be at least 4 digits'); return; }
    if (form.pin && !/^\d{4,6}$/.test(form.pin)) { setError('PIN must be 4–6 digits'); return; }

    setSaving(true);
    setError('');
    try {
      if (editingUid) {
        const updates = { name: form.name, role: form.role, shop: form.role === 'owner' ? null : form.shop };
        if (form.pin) updates.pin = form.pin;
        await updateUser(editingUid, updates);
      } else {
        await addUser({ name: form.name, pin: form.pin, role: form.role, shop: form.role === 'owner' ? null : form.shop });
      }
      setShowForm(false);
    } catch (err) {
      setError('Failed to save: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (u) => {
    await updateUser(u.uid, { active: !u.active });
  };

  const handleDelete = async (u) => {
    if (u.uid === currentUser.uid) return;
    if (!window.confirm(`Delete user "${u.name}"? This cannot be undone.`)) return;
    await removeUser(u.uid);
  };

  const handleResetPin = async () => {
    if (!newPin || !/^\d{4,6}$/.test(newPin)) return;
    await resetPin(resetPinUid, newPin);
    setResetPinUid(null);
    setNewPin('');
  };

  return (
    <div className="cpanel-section">
      <div className="cpanel-section-header">
        <h2 className="section-title">Users ({users.length})</h2>
        <button onClick={openAdd} className="cpanel-add-btn"><Plus size={16} /> Add User</button>
      </div>

      {!loaded && <div className="cpanel-loading"><div className="spinner" /> Loading users...</div>}

      {showForm && (
        <div className="cpanel-form-card">
          <h3 className="section-title">{editingUid ? 'Edit User' : 'Add New User'}</h3>
          <form onSubmit={handleSubmit}>
            <div className="cpanel-form-grid">
              <div className="input-group">
                <label className="form-label muted">Name</label>
                <input className="input-field" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Full name" />
              </div>
              <div className="input-group">
                <label className="form-label muted">{editingUid ? 'New PIN (leave blank to keep)' : 'PIN'}</label>
                <input className="input-field" type="password" inputMode="numeric" maxLength={6} value={form.pin} onChange={e => setForm(f => ({ ...f, pin: e.target.value.replace(/\D/g, '') }))} placeholder={editingUid ? '••••' : '4-6 digits'} />
              </div>
              <div className="input-group">
                <label className="form-label muted">Role</label>
                <div className="pill-group">
                  <button type="button" className={`pill-btn ${form.role === 'staff' ? 'active' : ''}`} onClick={() => setForm(f => ({ ...f, role: 'staff' }))}>Staff</button>
                  <button type="button" className={`pill-btn ${form.role === 'owner' ? 'active' : ''}`} onClick={() => setForm(f => ({ ...f, role: 'owner' }))}>Owner</button>
                </div>
              </div>
              {form.role === 'staff' && (
                <div className="input-group">
                  <label className="form-label muted">Assigned Shop</label>
                  <div className="pill-group">
                    {shops.map(s => (
                      <button type="button" key={s} className={`pill-btn ${form.shop === s ? 'active' : ''}`} onClick={() => setForm(f => ({ ...f, shop: s }))}>{s}</button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            {error && <div className="cpanel-error">{error}</div>}
            <div className="cpanel-form-actions">
              <button type="button" className="cpanel-cancel-btn" onClick={() => setShowForm(false)}>Cancel</button>
              <button type="submit" className="submit-btn" disabled={saving}>{saving ? 'Saving...' : (editingUid ? 'Update' : 'Add User')}</button>
            </div>
          </form>
        </div>
      )}

      <div className="cpanel-user-list">
        {users.map(u => (
          <div key={u.uid} className={`cpanel-user-card ${u.active === false ? 'inactive' : ''}`}>
            <div className="cpanel-user-info">
              <div className="cpanel-user-avatar" data-role={u.role}>
                {u.role === 'owner' ? <ShieldCheck size={18} /> : <ShoppingBag size={18} />}
              </div>
              <div>
                <div className="cpanel-user-name">
                  {u.name}
                  {u.uid === currentUser.uid && <span className="cpanel-you-badge">You</span>}
                </div>
                <div className="cpanel-user-meta">
                  <span className={`cpanel-role-badge ${u.role}`}>{u.role}</span>
                  {u.shop && <span className="cpanel-shop-badge">{u.shop}</span>}
                  {u.active === false && <span className="cpanel-inactive-badge">Inactive</span>}
                </div>
              </div>
            </div>
            <div className="cpanel-user-actions">
              <button onClick={() => setResetPinUid(u.uid)} className="tx-action-btn" title="Reset PIN">
                <Eye size={15} />
              </button>
              <button onClick={() => openEdit(u)} className="tx-action-btn" title="Edit">
                <Pencil size={15} />
              </button>
              <button onClick={() => handleToggleActive(u)} className="tx-action-btn" title={u.active === false ? 'Activate' : 'Deactivate'}>
                {u.active === false ? <Eye size={15} /> : <EyeOff size={15} />}
              </button>
              {u.uid !== currentUser.uid && (
                <button onClick={() => handleDelete(u)} className="tx-action-btn danger" title="Delete">
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Reset PIN Modal */}
      {resetPinUid && (
        <div className="modal-overlay" onClick={() => { setResetPinUid(null); setNewPin(''); }}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <h3 className="section-title" style={{ marginBottom: '1rem' }}>
              Reset PIN for {users.find(u => u.uid === resetPinUid)?.name}
            </h3>
            <div className="input-group">
              <label className="form-label muted">New PIN (4-6 digits)</label>
              <input className="input-field" type="password" inputMode="numeric" maxLength={6} value={newPin} onChange={e => setNewPin(e.target.value.replace(/\D/g, ''))} placeholder="Enter new PIN" />
            </div>
            <div className="cpanel-form-actions" style={{ marginTop: '1rem' }}>
              <button className="cpanel-cancel-btn" onClick={() => { setResetPinUid(null); setNewPin(''); }}>Cancel</button>
              <button className="submit-btn" onClick={handleResetPin} disabled={!newPin || newPin.length < 4}>Reset PIN</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Shops Panel ──────────────────────────────────────────────────────
function ShopsPanel({ shops, configShops, setConfigShops, onUpdateConfig }) {
  const [newShop, setNewShop] = useState('');
  const [editingIdx, setEditingIdx] = useState(null);
  const [editName, setEditName] = useState('');
  const [saving, setSaving] = useState(false);

  const effectiveShops = configShops.length > 0 ? configShops : shops.map(s => ({ name: s, active: true }));

  const saveShops = async (list) => {
    setSaving(true);
    try {
      await setDoc(doc(db, 'config', 'shops'), { list });
      setConfigShops(list);
      if (onUpdateConfig) onUpdateConfig('shops', list);
    } catch (err) {
      console.error('Failed to save shops:', err);
    }
    setSaving(false);
  };

  const handleAdd = () => {
    if (!newShop.trim()) return;
    const updated = [...effectiveShops, { name: newShop.trim(), active: true }];
    saveShops(updated);
    setNewShop('');
  };

  const handleToggle = (idx) => {
    const updated = effectiveShops.map((s, i) => i === idx ? { ...s, active: !s.active } : s);
    saveShops(updated);
  };

  const handleRename = (idx) => {
    if (!editName.trim()) return;
    const updated = effectiveShops.map((s, i) => i === idx ? { ...s, name: editName.trim() } : s);
    saveShops(updated);
    setEditingIdx(null);
    setEditName('');
  };

  const handleDelete = (idx) => {
    if (!window.confirm(`Delete shop "${effectiveShops[idx].name}"?`)) return;
    const updated = effectiveShops.filter((_, i) => i !== idx);
    saveShops(updated);
  };

  return (
    <div className="cpanel-section">
      <div className="cpanel-section-header">
        <h2 className="section-title">Shops ({effectiveShops.length})</h2>
      </div>

      <div className="cpanel-inline-form">
        <input className="input-field" value={newShop} onChange={e => setNewShop(e.target.value)} placeholder="New shop name..." onKeyDown={e => e.key === 'Enter' && handleAdd()} />
        <button className="cpanel-add-btn" onClick={handleAdd} disabled={!newShop.trim() || saving}><Plus size={16} /> Add</button>
      </div>

      <div className="cpanel-list">
        {effectiveShops.map((s, i) => (
          <div key={i} className={`cpanel-list-item ${!s.active ? 'inactive' : ''}`}>
            {editingIdx === i ? (
              <div className="cpanel-inline-form" style={{ flex: 1 }}>
                <input className="input-field" value={editName} onChange={e => setEditName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleRename(i)} />
                <button className="submit-btn" style={{ height: 40, fontSize: '0.75rem' }} onClick={() => handleRename(i)}>Save</button>
                <button className="cpanel-cancel-btn" onClick={() => setEditingIdx(null)}>Cancel</button>
              </div>
            ) : (
              <>
                <div className="cpanel-list-info">
                  <Store size={16} style={{ color: s.active ? 'var(--amber)' : 'var(--text-3)' }} />
                  <span className="cpanel-list-name">{s.name}</span>
                  {!s.active && <span className="cpanel-inactive-badge">Disabled</span>}
                </div>
                <div className="cpanel-list-actions">
                  <button className="tx-action-btn" onClick={() => { setEditingIdx(i); setEditName(s.name); }}><Pencil size={14} /></button>
                  <button className="tx-action-btn" onClick={() => handleToggle(i)}>{s.active ? <EyeOff size={14} /> : <Eye size={14} />}</button>
                  <button className="tx-action-btn danger" onClick={() => handleDelete(i)}><Trash2 size={14} /></button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Spices Panel ─────────────────────────────────────────────────────
function SpicesPanel({ spices, configSpices, setConfigSpices, onUpdateConfig }) {
  const [newSpice, setNewSpice] = useState('');
  const [newColor, setNewColor] = useState('#f59e0b');
  const [editingIdx, setEditingIdx] = useState(null);
  const [editLabel, setEditLabel] = useState('');
  const [saving, setSaving] = useState(false);

  const effectiveSpices = configSpices.length > 0 ? configSpices : spices.map(s => ({ id: s.id, label: s.label, color: s.color, active: true }));

  const saveSpices = async (list) => {
    setSaving(true);
    try {
      await setDoc(doc(db, 'config', 'spices'), { list });
      setConfigSpices(list);
      if (onUpdateConfig) onUpdateConfig('spices', list);
    } catch (err) {
      console.error('Failed to save spices:', err);
    }
    setSaving(false);
  };

  const handleAdd = () => {
    if (!newSpice.trim()) return;
    const id = newSpice.trim().toLowerCase().replace(/\s+/g, '_');
    const updated = [...effectiveSpices, { id, label: newSpice.trim(), color: newColor, active: true }];
    saveSpices(updated);
    setNewSpice('');
  };

  const handleToggle = (idx) => {
    const updated = effectiveSpices.map((s, i) => i === idx ? { ...s, active: !s.active } : s);
    saveSpices(updated);
  };

  const handleRename = (idx) => {
    if (!editLabel.trim()) return;
    const updated = effectiveSpices.map((s, i) => i === idx ? { ...s, label: editLabel.trim() } : s);
    saveSpices(updated);
    setEditingIdx(null);
  };

  const handleDelete = (idx) => {
    if (!window.confirm(`Delete spice "${effectiveSpices[idx].label}"?`)) return;
    const updated = effectiveSpices.filter((_, i) => i !== idx);
    saveSpices(updated);
  };

  return (
    <div className="cpanel-section">
      <div className="cpanel-section-header">
        <h2 className="section-title">Spices ({effectiveSpices.length})</h2>
      </div>

      <div className="cpanel-inline-form">
        <input className="input-field" style={{ flex: 2 }} value={newSpice} onChange={e => setNewSpice(e.target.value)} placeholder="New spice name..." onKeyDown={e => e.key === 'Enter' && handleAdd()} />
        <input type="color" value={newColor} onChange={e => setNewColor(e.target.value)} style={{ width: 44, height: 44, border: 'none', borderRadius: 8, cursor: 'pointer', background: 'transparent' }} />
        <button className="cpanel-add-btn" onClick={handleAdd} disabled={!newSpice.trim() || saving}><Plus size={16} /> Add</button>
      </div>

      <div className="cpanel-list">
        {effectiveSpices.map((s, i) => (
          <div key={i} className={`cpanel-list-item ${!s.active ? 'inactive' : ''}`}>
            {editingIdx === i ? (
              <div className="cpanel-inline-form" style={{ flex: 1 }}>
                <input className="input-field" value={editLabel} onChange={e => setEditLabel(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleRename(i)} />
                <button className="submit-btn" style={{ height: 40, fontSize: '0.75rem' }} onClick={() => handleRename(i)}>Save</button>
                <button className="cpanel-cancel-btn" onClick={() => setEditingIdx(null)}>Cancel</button>
              </div>
            ) : (
              <>
                <div className="cpanel-list-info">
                  <div style={{ width: 14, height: 14, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
                  <span className="cpanel-list-name">{s.label}</span>
                  {!s.active && <span className="cpanel-inactive-badge">Disabled</span>}
                </div>
                <div className="cpanel-list-actions">
                  <button className="tx-action-btn" onClick={() => { setEditingIdx(i); setEditLabel(s.label); }}><Pencil size={14} /></button>
                  <button className="tx-action-btn" onClick={() => handleToggle(i)}>{s.active ? <EyeOff size={14} /> : <Eye size={14} />}</button>
                  <button className="tx-action-btn danger" onClick={() => handleDelete(i)}><Trash2 size={14} /></button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Settings Panel ───────────────────────────────────────────────────
function SettingsPanel({ appSettings, setAppSettings }) {
  const [sheetUrl, setSheetUrl] = useState(appSettings.gsheetUrl || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setSheetUrl(appSettings.gsheetUrl || '');
  }, [appSettings]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const updates = { ...appSettings, gsheetUrl: sheetUrl };
      await setDoc(doc(db, 'config', 'settings'), updates);
      setAppSettings(updates);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error('Failed to save settings:', err);
    }
    setSaving(false);
  };

  return (
    <div className="cpanel-section">
      <div className="cpanel-section-header">
        <h2 className="section-title">App Settings</h2>
      </div>

      <div className="cpanel-form-card">
        <div className="input-group" style={{ marginBottom: '1rem' }}>
          <label className="form-label muted">Google Sheet Script URL</label>
          <input className="input-field" value={sheetUrl} onChange={e => setSheetUrl(e.target.value)} placeholder="https://script.google.com/macros/s/..." style={{ fontSize: '0.8rem' }} />
          <p className="caption" style={{ marginTop: 4 }}>The Apps Script web-app endpoint for data sync</p>
        </div>

        <div className="cpanel-form-actions">
          <button className="submit-btn" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Settings'}
          </button>
        </div>
      </div>

      <div className="cpanel-form-card" style={{ marginTop: '1rem' }}>
        <h3 className="section-title" style={{ marginBottom: '0.75rem' }}>About</h3>
        <div className="cpanel-about-grid">
          <div><span className="caption">App</span><span className="cpanel-about-value">KVS SpiceSentry</span></div>
          <div><span className="caption">Backend</span><span className="cpanel-about-value">Google Sheets + Firebase</span></div>
          <div><span className="caption">Auth</span><span className="cpanel-about-value">PIN-based (Firestore)</span></div>
        </div>
      </div>
    </div>
  );
}
