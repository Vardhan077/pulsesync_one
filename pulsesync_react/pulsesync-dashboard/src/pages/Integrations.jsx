import React, { useState, useEffect } from 'react';
import { 
  Database, 
  ExternalLink, 
  RefreshCw, 
  CheckCircle2, 
  XCircle, 
  Sliders, 
  AlertCircle, 
  Terminal, 
  MessageSquare,
  Lock,
  ArrowRight,
  Shield,
  Layers,
  Settings,
  X,
  Plus,
  Loader2,
  Check
} from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || (typeof window !== "undefined" ? `${window.location.protocol}//${window.location.hostname}:3001` : "http://localhost:3001");

export default function Integrations() {
  const [integrations, setIntegrations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toastMsg, setToastMsg] = useState(null);
  
  // Drawer state for managing integration
  const [selectedIntegration, setSelectedIntegration] = useState(null);
  const [testingConnection, setTestingConnection] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [properties, setProperties] = useState({ company: [], contact: [], deal: [] });
  const [loadingProperties, setLoadingProperties] = useState(false);
  const [mappings, setMappings] = useState([]);
  const [savingMappings, setSavingMappings] = useState(false);
  const [activeDrawerTab, setActiveDrawerTab] = useState('overview'); // 'overview', 'properties', 'mappings'

  const triggerToast = (msg) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3500);
  };

  const fetchIntegrations = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/integrations`);
      if (!res.ok) throw new Error("Failed to fetch integrations");
      const data = await res.json();
      setIntegrations(data);
    } catch (err) {
      console.error(err);
      triggerToast("Failed to load CRM integrations.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchIntegrations();

    // Check URL query for connection callbacks
    const params = new URLSearchParams(window.location.search);
    if (params.get('connected') === 'hubspot') {
      triggerToast("HubSpot CRM successfully connected & verified!");
      window.history.replaceState(null, '', window.location.pathname);
    } else if (params.get('error')) {
      triggerToast(`Connection failed: ${params.get('error')}`);
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);

  // Initiate OAuth flow
  const handleConnectHubSpot = async () => {
    try {
      const res = await fetch(`${API_URL}/api/integrations/hubspot/auth-url`);
      if (!res.ok) throw new Error("Failed to generate OAuth URL");
      const data = await res.json();
      if (data.authUrl) {
        window.location.href = data.authUrl;
      }
    } catch (err) {
      console.error(err);
      triggerToast("Failed to initiate HubSpot OAuth.");
    }
  };

  // Open Manage Drawer
  const handleOpenManage = async (integration) => {
    setSelectedIntegration(integration);
    setTestResult(null);
    setActiveDrawerTab('overview');

    if (integration.connection_status === 'connected') {
      // Load properties & mappings
      setLoadingProperties(true);
      try {
        const [propsRes, mapsRes] = await Promise.all([
          fetch(`${API_URL}/api/integrations/${integration.id}/properties`),
          fetch(`${API_URL}/api/integrations/${integration.id}/mappings`)
        ]);
        if (propsRes.ok) {
          const propsData = await propsRes.json();
          setProperties(propsData);
        }
        if (mapsRes.ok) {
          const mapsData = await mapsRes.json();
          setMappings(mapsData);
        }
      } catch (e) {
        console.warn("Could not load properties/mappings:", e);
      } finally {
        setLoadingProperties(false);
      }
    }
  };

  // Test live connection against HubSpot API
  const handleTestConnection = async () => {
    if (!selectedIntegration) return;
    setTestingConnection(true);
    setTestResult(null);
    try {
      const res = await fetch(`${API_URL}/api/integrations/${selectedIntegration.id}/test`, {
        method: 'POST'
      });
      const data = await res.json();
      setTestResult(data);
      if (data.success) {
        triggerToast("HubSpot connection test passed successfully!");
        fetchIntegrations();
      } else {
        triggerToast(`Connection test failed: ${data.error || 'Authentication error'}`);
      }
    } catch (err) {
      console.error(err);
      setTestResult({ success: false, error: err.message });
    } finally {
      setTestingConnection(false);
    }
  };

  // Disconnect integration
  const handleDisconnect = async () => {
    if (!selectedIntegration) return;
    try {
      const res = await fetch(`${API_URL}/api/integrations/${selectedIntegration.id}/disconnect`, {
        method: 'POST'
      });
      if (res.ok) {
        triggerToast("Integration disconnected.");
        setSelectedIntegration(null);
        fetchIntegrations();
      }
    } catch (err) {
      console.error(err);
      triggerToast("Failed to disconnect integration.");
    }
  };

  // Save Mappings
  const handleSaveMappings = async () => {
    if (!selectedIntegration) return;
    setSavingMappings(true);
    try {
      const res = await fetch(`${API_URL}/api/integrations/${selectedIntegration.id}/mappings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mappings })
      });
      if (res.ok) {
        triggerToast("Field mappings saved successfully!");
      }
    } catch (e) {
      console.error(e);
      triggerToast("Failed to save field mappings.");
    } finally {
      setSavingMappings(false);
    }
  };

  // Split into Connected vs Available
  const connectedIntegrations = integrations.filter(i => i.connection_status === 'connected');
  const availableIntegrations = integrations.filter(i => i.connection_status !== 'connected');

  return (
    <div className="flex flex-col gap-6 bg-[#F8FAFC] pb-12 select-none text-left">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-3 border-b border-[#E5E7EB]">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-[#0F172A]">
            CRM & Destination Integrations
          </h1>
          <p className="text-xs text-[#64748B] mt-0.5 font-medium leading-relaxed">
            Connect production CRMs to securely synchronize verified call intelligence, playbook properties, and deal next steps.
          </p>
        </div>
      </div>

      {toastMsg && (
        <div className="fixed bottom-6 right-6 z-50 bg-[#0F172A] text-white rounded-lg px-4 py-2.5 shadow-xl flex items-center gap-2 text-xs font-semibold animate-in fade-in duration-150">
          <CheckCircle2 size={15} className="text-[#14B8A6]" />
          <span>{toastMsg}</span>
        </div>
      )}

      {loading ? (
        <div className="py-20 flex flex-col items-center justify-center space-y-3 text-xs text-[#64748B]">
          <Loader2 size={24} className="animate-spin text-[#14B8A6]" />
          <span>Loading CRM connections...</span>
        </div>
      ) : (
        <div className="space-y-8">
          
          {/* SECTION 1: Connected Destinations */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              <h2 className="text-xs font-extrabold uppercase tracking-wider text-[#0F172A]">Connected Destinations ({connectedIntegrations.length})</h2>
            </div>

            {connectedIntegrations.length === 0 ? (
              <div className="bg-white border border-[#E5E7EB] rounded-xl p-8 text-center text-xs text-[#94A3B8] italic">
                No active CRM connections. Authorize HubSpot below to begin syncing verified intelligence.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4">
                {connectedIntegrations.map((c) => (
                  <div key={c.id} className="bg-white border border-[#E5E7EB] rounded-xl p-5 shadow-3xs flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-start gap-3.5">
                      <div className="h-10 w-10 rounded-lg bg-orange-50 text-orange-600 flex items-center justify-center border border-orange-100 flex-shrink-0">
                        <Database size={18} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-extrabold text-[#0F172A]">{c.name}</h3>
                          <span className="px-2 py-0.2 bg-emerald-50 text-emerald-600 border border-emerald-200 rounded-full text-[9.5px] font-mono font-bold uppercase">
                            Connected ✓
                          </span>
                        </div>
                        <p className="text-xs text-[#64748B] mt-0.5">
                          Account: <strong>{c.auth_metadata?.account_name || 'HubSpot Workspace'}</strong> • Portal #{c.auth_metadata?.portal_id || 'Active'}
                        </p>
                        <span className="text-[10px] text-[#94A3B8] font-mono block mt-1">
                          Last sync: {c.last_sync_at ? new Date(c.last_sync_at).toLocaleString() : 'Ready to sync'}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2.5 self-end md:self-center">
                      <button
                        onClick={() => handleOpenManage(c)}
                        className="px-3.5 py-1.5 bg-[#F8FAFC] border border-[#E5E7EB] hover:bg-[#F1F5F9] text-[#0F172A] text-xs font-bold rounded-lg transition"
                      >
                        Manage & Mappings
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* SECTION 2: Available Destinations */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-slate-300" />
              <h2 className="text-xs font-extrabold uppercase tracking-wider text-[#64748B]">Available Destinations</h2>
            </div>

            <div className="grid grid-cols-1 gap-4">
              
              {/* HubSpot (If not connected) */}
              {!connectedIntegrations.some(i => i.provider === 'hubspot') && (
                <div className="bg-white border border-[#E5E7EB] rounded-xl p-5 shadow-3xs flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex items-start gap-3.5">
                    <div className="h-10 w-10 rounded-lg bg-orange-50 text-orange-600 flex items-center justify-center border border-orange-100 flex-shrink-0">
                      <Database size={18} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-extrabold text-[#0F172A]">HubSpot CRM</h3>
                        <span className="px-2 py-0.2 bg-slate-100 text-[#64748B] rounded-full text-[9.5px] font-mono font-bold uppercase">
                          Not Connected
                        </span>
                      </div>
                      <p className="text-xs text-[#64748B] mt-0.5 max-w-xl">
                        Sync budget, champion, decision maker, risks, and playbook properties directly into HubSpot Company, Contact, and Deal records.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-end md:self-center">
                    <button
                      onClick={() => {
                        const token = window.prompt("Enter HubSpot Private App Access Token (e.g. pat-na1-...):");
                        if (token) {
                          fetch(`${API_URL}/api/integrations/hubspot/connect-token`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ accessToken: token })
                          })
                          .then(r => r.json())
                          .then(data => {
                            if (data.ok) {
                              triggerToast(`Connected to HubSpot (${data.accountName})!`);
                              fetchIntegrations();
                            } else {
                              triggerToast(`Error: ${data.message || 'Token invalid'}`);
                            }
                          })
                          .catch(() => triggerToast("Failed to connect token"));
                        }
                      }}
                      className="px-3 py-2 bg-white border border-[#E5E7EB] hover:bg-[#F8FAFC] text-[#0F172A] text-xs font-bold rounded-lg transition"
                    >
                      Connect with Token
                    </button>
                    <button
                      onClick={handleConnectHubSpot}
                      className="px-4 py-2 bg-[#14B8A6] hover:bg-[#0D9488] text-white text-xs font-bold rounded-lg shadow-3xs flex items-center gap-1.5 transition"
                    >
                      <span>Connect with OAuth</span>
                      <ArrowRight size={13} />
                    </button>
                  </div>
                </div>
              )}

              {/* Salesforce (Available Extension) */}
              <div className="bg-white border border-[#E5E7EB] rounded-xl p-5 shadow-3xs flex flex-col md:flex-row md:items-center justify-between gap-4 opacity-80">
                <div className="flex items-start gap-3.5">
                  <div className="h-10 w-10 rounded-lg bg-sky-50 text-sky-600 flex items-center justify-center border border-sky-100 flex-shrink-0">
                    <Layers size={18} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-extrabold text-[#0F172A]">Salesforce CRM</h3>
                      <span className="px-2 py-0.2 bg-slate-100 text-[#64748B] rounded-full text-[9.5px] font-mono font-bold uppercase">
                        Ready to Add
                      </span>
                    </div>
                    <p className="text-xs text-[#64748B] mt-0.5 max-w-xl">
                      Map verified call insights into Salesforce Lead, Contact, and Opportunity object fields.
                    </p>
                  </div>
                </div>

                <button
                  disabled
                  className="px-3.5 py-1.5 bg-[#F8FAFC] border border-[#E5E7EB] text-[#94A3B8] text-xs font-bold rounded-lg cursor-not-allowed self-end md:self-center"
                >
                  Configure Adapter
                </button>
              </div>

              {/* Pipedrive (Available Extension) */}
              <div className="bg-white border border-[#E5E7EB] rounded-xl p-5 shadow-3xs flex flex-col md:flex-row md:items-center justify-between gap-4 opacity-80">
                <div className="flex items-start gap-3.5">
                  <div className="h-10 w-10 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-100 flex-shrink-0">
                    <Database size={18} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-extrabold text-[#0F172A]">Pipedrive CRM</h3>
                      <span className="px-2 py-0.2 bg-slate-100 text-[#64748B] rounded-full text-[9.5px] font-mono font-bold uppercase">
                        Ready to Add
                      </span>
                    </div>
                    <p className="text-xs text-[#64748B] mt-0.5 max-w-xl">
                      Map generic PulseSync organizations, persons, and deals into Pipedrive entities.
                    </p>
                  </div>
                </div>

                <button
                  disabled
                  className="px-3.5 py-1.5 bg-[#F8FAFC] border border-[#E5E7EB] text-[#94A3B8] text-xs font-bold rounded-lg cursor-not-allowed self-end md:self-center"
                >
                  Configure Adapter
                </button>
              </div>

            </div>
          </div>

        </div>
      )}

      {/* ── Slide-over Management Drawer ── */}
      {selectedIntegration && (
        <div className="fixed inset-0 z-50 overflow-hidden select-none text-left">
          <div className="absolute inset-0 bg-[#0F172A]/40 backdrop-blur-xs transition-opacity" onClick={() => setSelectedIntegration(null)} />
          <div className="absolute inset-y-0 right-0 max-w-full flex pl-10">
            <div className="w-screen max-w-xl bg-white border-l border-[#E5E7EB] shadow-2xl flex flex-col h-full animate-in slide-in-from-right duration-200">
              
              {/* Drawer Header */}
              <div className="px-6 py-4 border-b border-[#E5E7EB] bg-[#FAFBFB] flex items-center justify-between flex-shrink-0">
                <div>
                  <h3 className="text-sm font-extrabold text-[#0F172A] flex items-center gap-2">
                    <Database size={16} className="text-orange-600" />
                    <span>{selectedIntegration.name} Configuration</span>
                  </h3>
                  <p className="text-[10.5px] text-[#64748B] font-semibold mt-0.5">
                    Live connection status, discovered properties, and field mappings.
                  </p>
                </div>
                <button onClick={() => setSelectedIntegration(null)} className="p-1 hover:bg-[#E2E8F0] rounded text-[#64748B]">
                  <X size={16} />
                </button>
              </div>

              {/* Drawer Navigation Tabs */}
              <div className="flex items-center gap-2 px-6 border-b border-[#F1F5F9] bg-white text-xs font-bold">
                {[
                  { id: 'overview', label: 'Connection & Health' },
                  { id: 'properties', label: 'Discovered Properties' },
                  { id: 'mappings', label: 'Field Mappings' }
                ].map(t => (
                  <button
                    key={t.id}
                    onClick={() => setActiveDrawerTab(t.id)}
                    className={`py-3 border-b-2 transition ${
                      activeDrawerTab === t.id ? 'border-[#14B8A6] text-[#0F172A]' : 'border-transparent text-[#64748B] hover:text-[#0F172A]'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {/* Drawer Body */}
              <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-[#F8FAFC]">
                
                {/* TAB 1: OVERVIEW */}
                {activeDrawerTab === 'overview' && (
                  <div className="space-y-4">
                    <div className="bg-white border border-[#E5E7EB] rounded-xl p-4 shadow-3xs space-y-3">
                      <span className="text-[9.5px] font-bold text-[#94A3B8] uppercase block tracking-wider">Account Metadata</span>
                      <div className="grid grid-cols-2 gap-3 text-xs font-semibold">
                        <div>
                          <span className="text-[9px] text-[#64748B] block">Connected Account</span>
                          <span className="text-[#0F172A] font-bold">{selectedIntegration.auth_metadata?.account_name || 'HubSpot Account'}</span>
                        </div>
                        <div>
                          <span className="text-[9px] text-[#64748B] block">Portal ID</span>
                          <span className="text-[#0F172A] font-mono">{selectedIntegration.auth_metadata?.portal_id || 'Active'}</span>
                        </div>
                        <div>
                          <span className="text-[9px] text-[#64748B] block">Status</span>
                          <span className="text-emerald-600 font-bold uppercase font-mono text-[10px]">{selectedIntegration.connection_status}</span>
                        </div>
                        <div>
                          <span className="text-[9px] text-[#64748B] block">Last Connected</span>
                          <span className="text-[#64748B]">{selectedIntegration.last_connected_at ? new Date(selectedIntegration.last_connected_at).toLocaleDateString() : 'Active'}</span>
                        </div>
                      </div>
                    </div>

                    {/* Test Connection Box */}
                    <div className="bg-white border border-[#E5E7EB] rounded-xl p-4 shadow-3xs space-y-3">
                      <span className="text-[9.5px] font-bold text-[#94A3B8] uppercase block tracking-wider">Live Connectivity Diagnostic</span>
                      <p className="text-xs text-[#64748B] font-medium leading-relaxed">
                        Calls the live HubSpot REST API endpoint to verify token validity, permissions, and API responsiveness.
                      </p>

                      <div className="flex items-center gap-3 pt-1">
                        <button
                          onClick={handleTestConnection}
                          disabled={testingConnection}
                          className="px-4 py-2 bg-[#14B8A6] hover:bg-[#0D9488] text-white text-xs font-bold rounded-lg shadow-3xs flex items-center gap-1.5 transition disabled:opacity-50"
                        >
                          {testingConnection ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                          <span>Test Connection Now</span>
                        </button>
                      </div>

                      {testResult && (
                        <div className={`p-3 rounded-lg border text-xs font-semibold ${
                          testResult.success ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'
                        }`}>
                          {testResult.success ? (
                            <span className="flex items-center gap-1.5"><Check size={13} /> Connection verified: {testResult.accountName}</span>
                          ) : (
                            <span>✕ Diagnostic error: {testResult.error}</span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Danger Zone */}
                    <div className="bg-white border border-rose-100 rounded-xl p-4 shadow-3xs space-y-2">
                      <span className="text-[9.5px] font-bold text-rose-600 uppercase block tracking-wider">Danger Zone</span>
                      <p className="text-xs text-[#64748B] font-medium">
                        Revoke OAuth credentials and disconnect HubSpot from PulseSync AI.
                      </p>
                      <button
                        onClick={handleDisconnect}
                        className="px-3 py-1.5 bg-rose-50 border border-rose-200 hover:bg-rose-100 text-rose-700 text-xs font-bold rounded-lg transition mt-1"
                      >
                        Disconnect HubSpot
                      </button>
                    </div>
                  </div>
                )}

                {/* TAB 2: DISCOVERED PROPERTIES */}
                {activeDrawerTab === 'properties' && (
                  <div className="space-y-4">
                    {loadingProperties ? (
                      <div className="py-12 text-center text-xs text-[#64748B] flex flex-col items-center gap-2">
                        <Loader2 size={20} className="animate-spin text-[#14B8A6]" />
                        <span>Discovering properties from HubSpot schema...</span>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div className="bg-white border border-[#E5E7EB] rounded-xl p-4 shadow-3xs space-y-2">
                          <span className="text-[10px] font-bold text-[#0F172A] uppercase tracking-wider block">🏢 Deal Properties ({properties.deal?.length || 0})</span>
                          <div className="max-h-48 overflow-y-auto divide-y divide-[#F1F5F9] text-xs">
                            {(properties.deal || []).slice(0, 15).map(p => (
                              <div key={p.name} className="py-1.5 flex items-center justify-between">
                                <span className="font-semibold text-[#0F172A]">{p.label} <code className="text-[10px] text-[#94A3B8]">({p.name})</code></span>
                                <span className="text-[10px] text-[#64748B] font-mono">{p.type}</span>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="bg-white border border-[#E5E7EB] rounded-xl p-4 shadow-3xs space-y-2">
                          <span className="text-[10px] font-bold text-[#0F172A] uppercase tracking-wider block">🏢 Company Properties ({properties.company?.length || 0})</span>
                          <div className="max-h-48 overflow-y-auto divide-y divide-[#F1F5F9] text-xs">
                            {(properties.company || []).slice(0, 15).map(p => (
                              <div key={p.name} className="py-1.5 flex items-center justify-between">
                                <span className="font-semibold text-[#0F172A]">{p.label} <code className="text-[10px] text-[#94A3B8]">({p.name})</code></span>
                                <span className="text-[10px] text-[#64748B] font-mono">{p.type}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* TAB 3: FIELD MAPPINGS */}
                {activeDrawerTab === 'mappings' && (
                  <div className="space-y-4">
                    <div className="bg-white border border-[#E5E7EB] rounded-xl p-4 shadow-3xs space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-[9.5px] font-bold text-[#94A3B8] uppercase tracking-wider block">PulseSync to HubSpot Mappings</span>
                        <button
                          onClick={handleSaveMappings}
                          disabled={savingMappings}
                          className="px-3 py-1 bg-[#14B8A6] hover:bg-[#0D9488] text-white text-[11px] font-bold rounded-md shadow-3xs transition"
                        >
                          {savingMappings ? "Saving..." : "Save Mappings"}
                        </button>
                      </div>

                      <div className="overflow-x-auto">
                        <table className="w-full text-xs text-left border-collapse">
                          <thead>
                            <tr className="border-b border-[#E5E7EB] text-[9px] font-bold text-[#64748B] uppercase tracking-wider bg-[#F8FAFC]">
                              <th className="py-2 px-2.5">PulseSync Field</th>
                              <th className="py-2 px-2.5">Target Object</th>
                              <th className="py-2 px-2.5">HubSpot Property</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#F1F5F9] font-medium text-[#0F172A]">
                            {[
                              { pulse: 'budget', obj: 'deal', dest: 'amount' },
                              { pulse: 'timeline', obj: 'deal', dest: 'closedate' },
                              { pulse: 'champion', obj: 'deal', dest: 'pulsesync_champion' },
                              { pulse: 'decision_maker', obj: 'deal', dest: 'pulsesync_decision_maker' },
                              { pulse: 'competition', obj: 'deal', dest: 'pulsesync_competitors' },
                              { pulse: 'company_name', obj: 'company', dest: 'name' },
                              { pulse: 'website', obj: 'company', dest: 'domain' }
                            ].map((m, idx) => (
                              <tr key={idx} className="hover:bg-[#FAFBFB]">
                                <td className="py-2 px-2.5 font-bold text-[#0F172A]">{m.pulse}</td>
                                <td className="py-2 px-2.5 font-mono text-[10px] text-[#0284C7] uppercase">{m.obj}</td>
                                <td className="py-2 px-2.5 font-mono text-[#0F766E]">{m.dest}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}

              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
