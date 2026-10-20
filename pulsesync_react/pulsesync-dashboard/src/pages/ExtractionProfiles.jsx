import React, { useState, useEffect } from "react";
import {
  Sparkles,
  Layers,
  Plus,
  Trash,
  ArrowUp,
  ArrowDown,
  Save,
  Check,
  ChevronRight,
  Loader2,
  AlertCircle,
  Settings,
  Shield,
  DollarSign,
  Calendar,
  User,
  ListFilter,
  FileText,
  Copy,
  ToggleLeft,
  ToggleRight
} from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

const FIELD_TYPE_ICONS = {
  text: FileText,
  currency: DollarSign,
  date: Calendar,
  person: User,
  enum: ListFilter,
  number: Layers
};

export default function ExtractionProfiles() {
  const [profiles, setProfiles] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [selectedProfileId, setSelectedProfileId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState(null);
  const [activeTab, setActiveTab] = useState("sections"); // "sections" | "fields" | "settings"

  // Active form state for editing
  const [profileName, setProfileName] = useState("");
  const [profileDesc, setProfileDesc] = useState("");
  const [profilePurpose, setProfilePurpose] = useState("");
  const [profileInstructions, setProfileInstructions] = useState("");
  const [summarySections, setSummarySections] = useState([]);
  const [structuredFields, setStructuredFields] = useState([]);
  const [extractActionItems, setExtractActionItems] = useState(true);
  const [extractRisks, setExtractRisks] = useState(true);
  const [extractObjections, setExtractObjections] = useState(true);
  const [isActive, setIsActive] = useState(false);

  // New section dialog/inline state
  const [showAddSection, setShowAddSection] = useState(false);
  const [newSecName, setNewSecName] = useState("");
  const [newSecDesc, setNewSecDesc] = useState("");
  const [newSecWords, setNewSecWords] = useState(100);

  // New field dialog/inline state
  const [showAddField, setShowAddField] = useState(false);
  const [newFieldName, setNewFieldName] = useState("");
  const [newFieldType, setNewFieldType] = useState("text");
  const [newFieldDesc, setNewFieldDesc] = useState("");
  const [newFieldEvidence, setNewFieldEvidence] = useState(true);
  const [newFieldRequired, setNewFieldRequired] = useState(false);
  const [newFieldInstruction, setNewFieldInstruction] = useState("");
  const [newFieldSemanticContract, setNewFieldSemanticContract] = useState("");
  const [newFieldPositiveExamples, setNewFieldPositiveExamples] = useState("");
  const [newFieldNegativeExamples, setNewFieldNegativeExamples] = useState("");
  const [newFieldValidation, setNewFieldValidation] = useState("");
  const [newFieldCrmMapping, setNewFieldCrmMapping] = useState("");
  const [newFieldOptions, setNewFieldOptions] = useState("");

  const showToast = (type, text) => {
    setStatusMessage({ type, text });
    setTimeout(() => setStatusMessage(null), 4000);
  };

  // Load profiles and templates
  const loadData = async () => {
    try {
      setLoading(true);
      const [profilesRes, tmplRes] = await Promise.all([
        fetch(`${API_URL}/api/extraction-profiles`),
        fetch(`${API_URL}/api/extraction-profiles/templates`)
      ]);

      if (!profilesRes.ok) throw new Error("Failed to load extraction profiles");
      const profilesData = await profilesRes.json();
      setProfiles(profilesData);

      if (tmplRes.ok) {
        const tmplData = await tmplRes.json();
        setTemplates(Array.isArray(tmplData) ? tmplData : Object.values(tmplData));
      }

      // Default select active profile or first profile
      const activeP = profilesData.find(p => p.is_active) || profilesData[0];
      if (activeP) {
        selectProfile(activeP);
      }
    } catch (err) {
      console.error(err);
      showToast("error", "Failed to connect to extraction profile service");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const selectProfile = (p) => {
    setSelectedProfileId(p.id);
    setProfileName(p.name || "");
    setProfileDesc(p.description || "");
    const profileMetadata = p.profile_metadata && typeof p.profile_metadata === "object" ? p.profile_metadata : {};
    setProfilePurpose(p.purpose || profileMetadata.purpose || p.description || "");
    const instructions = p.extraction_instructions || profileMetadata.extraction_instructions || [];
    setProfileInstructions(Array.isArray(instructions) ? instructions.join("\n") : String(instructions || ""));
    setSummarySections(Array.isArray(p.summary_sections) ? p.summary_sections : []);
    setStructuredFields(Array.isArray(p.fields) ? p.fields : []);
    setExtractActionItems(p.extract_action_items !== false);
    setExtractRisks(p.extract_risks !== false);
    setExtractObjections(p.extract_objections !== false);
    setIsActive(Boolean(p.is_active));
  };

  const handleCreateFromTemplate = async (tmpl) => {
    try {
      setSaving(true);
      const payload = {
        name: `${tmpl.name} (Custom)`,
        description: tmpl.description,
        purpose: tmpl.purpose || tmpl.description || "",
        extraction_instructions: tmpl.extraction_instructions || [],
        profile_metadata: tmpl.profile_metadata || {},
        summary_sections: tmpl.summary_sections,
        fields: tmpl.fields,
        extract_action_items: tmpl.extract_action_items !== false,
        extract_risks: tmpl.extract_risks !== false,
        extract_objections: tmpl.extract_objections !== false,
        is_active: false
      };

      const res = await fetch(`${API_URL}/api/extraction-profiles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!res.ok) throw new Error("Failed to create profile from template");
      const created = await res.json();
      setProfiles(prev => [...prev, created]);
      selectProfile(created);
      showToast("success", `Created extraction profile "${created.name}"`);
    } catch (err) {
      showToast("error", err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSetActive = async (profileId) => {
    try {
      setSaving(true);
      const res = await fetch(`${API_URL}/api/extraction-profiles/${profileId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: true })
      });
      if (!res.ok) throw new Error("Failed to set active profile");
      const updated = await res.json();
      setProfiles(prev => prev.map(p => ({
        ...p,
        is_active: p.id === profileId
      })));
      setIsActive(true);
      showToast("success", `Profile "${updated.name}" is now the active extraction profile`);
    } catch (err) {
      showToast("error", err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveProfile = async () => {
    if (!selectedProfileId) return;
    try {
      setSaving(true);
      const payload = {
        name: profileName.trim(),
        description: profileDesc.trim(),
        purpose: profilePurpose.trim(),
        extraction_instructions: profileInstructions.split("\n").map(v => v.trim()).filter(Boolean),
        profile_metadata: {
          purpose: profilePurpose.trim(),
          extraction_instructions: profileInstructions.split("\n").map(v => v.trim()).filter(Boolean)
        },
        summary_sections: summarySections,
        fields: structuredFields,
        extract_action_items: extractActionItems,
        extract_risks: extractRisks,
        extract_objections: extractObjections,
        is_active: isActive
      };

      const res = await fetch(`${API_URL}/api/extraction-profiles/${selectedProfileId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!res.ok) throw new Error("Failed to update profile");
      const updated = await res.json();
      setProfiles(prev => prev.map(p => p.id === selectedProfileId ? updated : p));
      showToast("success", "Profile changes saved successfully");
    } catch (err) {
      showToast("error", err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteProfile = async () => {
    if (!selectedProfileId || selectedProfileId === "default_sales_intelligence") {
      showToast("error", "The default profile cannot be deleted.");
      return;
    }
    if (!window.confirm(`Delete profile "${profileName}"? This action cannot be undone.`)) return;

    try {
      setSaving(true);
      const res = await fetch(`${API_URL}/api/extraction-profiles/${selectedProfileId}`, {
        method: "DELETE"
      });
      if (!res.ok) throw new Error("Failed to delete profile");
      setProfiles(prev => prev.filter(p => p.id !== selectedProfileId));
      const remaining = profiles.filter(p => p.id !== selectedProfileId);
      if (remaining.length > 0) selectProfile(remaining[0]);
      showToast("success", "Profile deleted");
    } catch (err) {
      showToast("error", err.message);
    } finally {
      setSaving(false);
    }
  };

  // Section manipulation
  const addSummarySection = () => {
    if (!newSecName.trim()) return;
    const secId = newSecName.toLowerCase().replace(/[^a-z0-9_]/g, "_").trim();
    const newSec = {
      id: secId,
      name: newSecName.trim(),
      description: newSecDesc.trim(),
      max_words: parseInt(newSecWords, 10) || 100,
      enabled: true
    };
    setSummarySections(prev => [...prev, newSec]);
    setNewSecName("");
    setNewSecDesc("");
    setNewSecWords(100);
    setShowAddSection(false);
  };

  const removeSummarySection = (idx) => {
    setSummarySections(prev => prev.filter((_, i) => i !== idx));
  };

  const moveSummarySection = (idx, direction) => {
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= summarySections.length) return;
    setSummarySections(prev => {
      const copy = [...prev];
      const temp = copy[idx];
      copy[idx] = copy[targetIdx];
      copy[targetIdx] = temp;
      return copy;
    });
  };

  // Field manipulation
  const addStructuredField = () => {
    if (!newFieldName.trim()) return;
    const fId = newFieldName.toLowerCase().replace(/[^a-z0-9_]/g, "_").trim();
    const options = ["enum", "multi_select"].includes(newFieldType)
      ? newFieldOptions.split(",").map(o => o.trim()).filter(Boolean)
      : [];
    let validation = {};
    if (newFieldValidation.trim()) {
      try { validation = JSON.parse(newFieldValidation); }
      catch { validation = { rule: newFieldValidation.trim() }; }
    }
    const newField = {
      id: fId,
      name: newFieldName.trim(),
      type: newFieldType,
      description: newFieldDesc.trim(),
      ai_instruction: newFieldInstruction.trim(),
      semantic_contract: newFieldSemanticContract.trim() || newFieldDesc.trim(),
      positive_examples: newFieldPositiveExamples.split("\n").map(v => v.trim()).filter(Boolean),
      negative_examples: newFieldNegativeExamples.split("\n").map(v => v.trim()).filter(Boolean),
      evidence_policy: {
        require_direct_support: newFieldEvidence,
        reject_inference: true
      },
      evidence_required: newFieldEvidence,
      required_for_review: newFieldRequired,
      enabled: true,
      validation,
      crm_mapping: newFieldCrmMapping.trim() ? { destination_field: newFieldCrmMapping.trim() } : null,
      options
    };
    setStructuredFields(prev => [...prev, newField]);
    setNewFieldName("");
    setNewFieldDesc("");
    setNewFieldInstruction("");
    setNewFieldSemanticContract("");
    setNewFieldPositiveExamples("");
    setNewFieldNegativeExamples("");
    setNewFieldValidation("");
    setNewFieldCrmMapping("");
    setNewFieldEvidence(true);
    setNewFieldRequired(false);
    setNewFieldOptions("");
    setShowAddField(false);
  };

  const removeStructuredField = (idx) => {
    setStructuredFields(prev => prev.filter((_, i) => i !== idx));
  };

  const moveStructuredField = (idx, direction) => {
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= structuredFields.length) return;
    setStructuredFields(prev => {
      const copy = [...prev];
      const temp = copy[idx];
      copy[idx] = copy[targetIdx];
      copy[targetIdx] = temp;
      return copy;
    });
  };

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[#14B8A6]" />
      </div>
    );
  }

  const selectedProfile = profiles.find(p => p.id === selectedProfileId);

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Toast Notification */}
      {statusMessage && (
        <div className={`p-4 rounded-xl text-sm flex items-center justify-between border ${statusMessage.type === "success"
            ? "bg-teal-50 border-teal-200 text-teal-900"
            : "bg-red-50 border-red-200 text-red-900"
          }`}>
          <div className="flex items-center gap-2">
            <Check size={16} />
            <span>{statusMessage.text}</span>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#E5E7EB] pb-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-lg bg-teal-50 text-[#14B8A6]">
              <Sparkles size={20} />
            </span>
            <h1 className="text-xl font-bold text-[#0F172A]">AI Extraction Profiles</h1>
          </div>
          <p className="text-xs text-[#64748B] mt-1">
            Configure dynamic meeting summaries, structured field extractions, and grounding rules per workspace.
          </p>
        </div>

        {/* Global Action Buttons */}
        <div className="flex items-center gap-3">
          {selectedProfile && !selectedProfile.is_active && (
            <button
              onClick={() => handleSetActive(selectedProfileId)}
              disabled={saving}
              className="px-3.5 py-2 text-xs font-semibold text-[#0F172A] bg-white border border-[#E5E7EB] hover:bg-slate-50 rounded-lg shadow-3xs transition-all flex items-center gap-1.5"
            >
              <Check size={14} className="text-[#14B8A6]" />
              Set as Active Profile
            </button>
          )}

          <button
            onClick={handleSaveProfile}
            disabled={saving}
            className="px-4 py-2 text-xs font-semibold text-white bg-[#14B8A6] hover:bg-[#0D9488] rounded-lg shadow-3xs transition-all flex items-center gap-1.5"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Save Profile
          </button>
        </div>
      </div>

      {/* Layout Grid: Sidebar for Profile Selection + Main Canvas */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

        {/* Left Column: Profile Selector & Templates */}
        <div className="lg:col-span-4 space-y-6">
          <div className="rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-3xs">
            <h2 className="text-xs font-bold uppercase tracking-wider text-[#94A3B8] mb-3">
              Workspace Profiles
            </h2>
            <div className="space-y-1.5">
              {profiles.map(p => {
                const isSelected = p.id === selectedProfileId;
                return (
                  <button
                    key={p.id}
                    onClick={() => selectProfile(p)}
                    className={`w-full text-left p-3 rounded-lg border transition-all flex items-center justify-between ${isSelected
                        ? "border-[#14B8A6] bg-teal-50/50 shadow-3xs"
                        : "border-transparent hover:border-[#E5E7EB] hover:bg-slate-50"
                      }`}
                  >
                    <div className="min-w-0 pr-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-[#0F172A] truncate">
                          {p.name}
                        </span>
                        {p.is_active && (
                          <span className="px-1.5 py-0.5 text-[10px] font-bold text-teal-800 bg-teal-100 rounded">
                            Active
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-[#64748B] truncate mt-0.5">
                        {p.fields?.length || 0} fields • {p.summary_sections?.length || 0} sections
                      </p>
                    </div>
                    <ChevronRight size={14} className={isSelected ? "text-[#14B8A6]" : "text-[#94A3B8]"} />
                  </button>
                );
              })}
            </div>
          </div>

          {/* Preset Templates */}
          <div className="rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-3xs">
            <h2 className="text-xs font-bold uppercase tracking-wider text-[#94A3B8] mb-3">
              Create from Preconfigured Template
            </h2>
            <div className="space-y-2">
              {templates.map(tmpl => (
                <div
                  key={tmpl.id}
                  className="p-3 rounded-lg border border-[#E5E7EB] bg-slate-50/50 hover:bg-slate-50 transition-all flex items-center justify-between"
                >
                  <div className="min-w-0 pr-2">
                    <p className="text-xs font-bold text-[#0F172A] truncate">{tmpl.name}</p>
                    <p className="text-[11px] text-[#64748B] line-clamp-1 mt-0.5">{tmpl.description}</p>
                  </div>
                  <button
                    onClick={() => handleCreateFromTemplate(tmpl)}
                    disabled={saving}
                    className="p-1.5 rounded-md hover:bg-white text-[#14B8A6] hover:text-[#0D9488] border border-transparent hover:border-[#E5E7EB] transition-all"
                    title="Clone Template"
                  >
                    <Copy size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column: Profile Editor Canvas */}
        <div className="lg:col-span-8 space-y-6">
          {/* Profile Name & Settings Card */}
          <div className="rounded-xl border border-[#E5E7EB] bg-white p-5 shadow-3xs space-y-4">
            <div className="flex items-center justify-between">
              <input
                type="text"
                value={profileName}
                onChange={e => setProfileName(e.target.value)}
                placeholder="Profile Name"
                className="text-base font-bold text-[#0F172A] border-b border-transparent hover:border-[#CBD5E1] focus:border-[#14B8A6] focus:outline-none pb-0.5 w-full max-w-md"
              />
              {selectedProfileId !== "default_sales_intelligence" && (
                <button
                  onClick={handleDeleteProfile}
                  className="text-xs text-red-600 hover:text-red-700 flex items-center gap-1 font-semibold"
                >
                  <Trash size={13} />
                  Delete
                </button>
              )}
            </div>

            <textarea
              value={profileDesc}
              onChange={e => setProfileDesc(e.target.value)}
              placeholder="Profile description..."
              rows={2}
              className="w-full text-xs text-[#64748B] p-2.5 rounded-lg border border-[#E5E7EB] focus:border-[#14B8A6] focus:outline-none"
            />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <div>
                <label className="text-[9px] font-bold uppercase tracking-wider text-[#94A3B8]">Profile purpose</label>
                <textarea
                  value={profilePurpose}
                  onChange={e => setProfilePurpose(e.target.value)}
                  placeholder="What business intelligence is this profile intended to extract?"
                  rows={3}
                  className="w-full mt-1 text-xs text-[#334155] p-2.5 rounded-lg border border-[#E5E7EB] focus:border-[#14B8A6] focus:outline-none resize-none"
                />
              </div>
              <div>
                <label className="text-[9px] font-bold uppercase tracking-wider text-[#94A3B8]">LLM operating instructions</label>
                <textarea
                  value={profileInstructions}
                  onChange={e => setProfileInstructions(e.target.value)}
                  placeholder="One instruction per line. Example: use only explicit evidence; prefer not mentioned over inference."
                  rows={3}
                  className="w-full mt-1 text-xs text-[#334155] p-2.5 rounded-lg border border-[#E5E7EB] focus:border-[#14B8A6] focus:outline-none resize-none"
                />
              </div>
            </div>

            {/* Toggle Flags */}
            <div className="pt-2 border-t border-[#F1F5F9] grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={extractActionItems}
                  onChange={e => setExtractActionItems(e.target.checked)}
                  className="rounded border-[#CBD5E1] text-[#14B8A6] focus:ring-[#14B8A6]"
                />
                <span className="text-xs font-medium text-[#0F172A]">Action Items (Commitments)</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={extractRisks}
                  onChange={e => setExtractRisks(e.target.checked)}
                  className="rounded border-[#CBD5E1] text-[#14B8A6] focus:ring-[#14B8A6]"
                />
                <span className="text-xs font-medium text-[#0F172A]">Risk Detection</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={extractObjections}
                  onChange={e => setExtractObjections(e.target.checked)}
                  className="rounded border-[#CBD5E1] text-[#14B8A6] focus:ring-[#14B8A6]"
                />
                <span className="text-xs font-medium text-[#0F172A]">Objection Tracking</span>
              </label>
            </div>
          </div>

          {/* Navigation Tabs (Sections vs Fields) */}
          <div className="flex border-b border-[#E5E7EB] gap-6">
            <button
              onClick={() => setActiveTab("sections")}
              className={`pb-3 text-xs font-bold flex items-center gap-2 border-b-2 transition-all ${activeTab === "sections"
                  ? "border-[#14B8A6] text-[#0F172A]"
                  : "border-transparent text-[#64748B] hover:text-[#0F172A]"
                }`}
            >
              <FileText size={15} />
              Summary Sections ({summarySections.length})
            </button>

            <button
              onClick={() => setActiveTab("fields")}
              className={`pb-3 text-xs font-bold flex items-center gap-2 border-b-2 transition-all ${activeTab === "fields"
                  ? "border-[#14B8A6] text-[#0F172A]"
                  : "border-transparent text-[#64748B] hover:text-[#0F172A]"
                }`}
            >
              <Layers size={15} />
              Structured Fields ({structuredFields.length})
            </button>
          </div>

          {/* TAB 1: SUMMARY SECTIONS */}
          {activeTab === "sections" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-xs text-[#64748B]">
                  Configured sections generated for meetings. Multi-sentence grounded syntheses.
                </p>
                <button
                  onClick={() => setShowAddSection(true)}
                  className="px-3 py-1.5 text-xs font-semibold text-[#14B8A6] hover:bg-teal-50 border border-teal-200 rounded-lg flex items-center gap-1.5 transition-all"
                >
                  <Plus size={14} />
                  Add Section
                </button>
              </div>

              {/* Add Section Inline Form */}
              {showAddSection && (
                <div className="p-4 rounded-xl border border-teal-200 bg-teal-50/30 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <input
                      type="text"
                      placeholder="Section Name (e.g. Executive Summary)"
                      value={newSecName}
                      onChange={e => setNewSecName(e.target.value)}
                      className="text-xs p-2 rounded-lg border border-[#E5E7EB] bg-white focus:outline-none focus:border-[#14B8A6]"
                    />
                    <input
                      type="number"
                      placeholder="Max Words (default 100)"
                      value={newSecWords}
                      onChange={e => setNewSecWords(e.target.value)}
                      className="text-xs p-2 rounded-lg border border-[#E5E7EB] bg-white focus:outline-none focus:border-[#14B8A6]"
                    />
                  </div>
                  <input
                    type="text"
                    placeholder="Instructions / prompt hint for this section"
                    value={newSecDesc}
                    onChange={e => setNewSecDesc(e.target.value)}
                    className="w-full text-xs p-2 rounded-lg border border-[#E5E7EB] bg-white focus:outline-none focus:border-[#14B8A6]"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => setShowAddSection(false)}
                      className="px-3 py-1.5 text-xs text-[#64748B] hover:bg-slate-100 rounded-lg"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={addSummarySection}
                      className="px-3 py-1.5 text-xs font-semibold text-white bg-[#14B8A6] hover:bg-[#0D9488] rounded-lg"
                    >
                      Add Section
                    </button>
                  </div>
                </div>
              )}

              {/* Sections List */}
              <div className="space-y-2">
                {summarySections.map((sec, idx) => (
                  <div
                    key={sec.id || idx}
                    className="p-3.5 rounded-xl border border-[#E5E7EB] bg-white hover:border-[#CBD5E1] transition-all flex items-center justify-between shadow-3xs"
                  >
                    <div className="min-w-0 pr-3">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-[#0F172A]">{sec.name}</span>
                        <span className="px-2 py-0.5 text-[10px] font-mono text-[#64748B] bg-slate-100 rounded">
                          max {sec.max_words || 100} words
                        </span>
                      </div>
                      {sec.description && (
                        <p className="text-[11px] text-[#64748B] mt-0.5 line-clamp-1">{sec.description}</p>
                      )}
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => moveSummarySection(idx, -1)}
                        disabled={idx === 0}
                        className="p-1 text-[#94A3B8] hover:text-[#0F172A] disabled:opacity-30"
                      >
                        <ArrowUp size={14} />
                      </button>
                      <button
                        onClick={() => moveSummarySection(idx, 1)}
                        disabled={idx === summarySections.length - 1}
                        className="p-1 text-[#94A3B8] hover:text-[#0F172A] disabled:opacity-30"
                      >
                        <ArrowDown size={14} />
                      </button>
                      <button
                        onClick={() => removeSummarySection(idx)}
                        className="p-1 text-[#94A3B8] hover:text-red-600 ml-1"
                      >
                        <Trash size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 2: STRUCTURED FIELDS */}
          {activeTab === "fields" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-xs text-[#64748B]">
                  Structured CRM fields. Every extraction requires verifiable timestamped transcript quotes.
                </p>
                <button
                  onClick={() => setShowAddField(true)}
                  className="px-3 py-1.5 text-xs font-semibold text-[#14B8A6] hover:bg-teal-50 border border-teal-200 rounded-lg flex items-center gap-1.5 transition-all"
                >
                  <Plus size={14} />
                  Add Field
                </button>
              </div>

              {/* Add Field Inline Form */}
              {showAddField && (
                <div className="p-4 rounded-xl border border-teal-200 bg-teal-50/30 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <input
                      type="text"
                      placeholder="Field Name (e.g. Budget, Champion)"
                      value={newFieldName}
                      onChange={e => setNewFieldName(e.target.value)}
                      className="text-xs p-2 rounded-lg border border-[#E5E7EB] bg-white focus:outline-none focus:border-[#14B8A6]"
                    />
                    <select
                      value={newFieldType}
                      onChange={e => setNewFieldType(e.target.value)}
                      className="text-xs p-2 rounded-lg border border-[#E5E7EB] bg-white focus:outline-none focus:border-[#14B8A6]"
                    >
                      <option value="text">Text / String</option>
                      <option value="currency">Currency ($ USD)</option>
                      <option value="date">Date / Timeframe</option>
                      <option value="person">Person / Contact</option>
                      <option value="enum">Dropdown / Enum</option>
                      <option value="number">Numeric</option>
                      <option value="boolean">Boolean</option>
                      <option value="multi_select">Multi-select</option>
                      <option value="company">Company</option>
                      <option value="url">URL</option>
                      <option value="datetime">Date & Time</option>
                      <option value="array">Array</option>
                      <option value="object">Object</option>
                    </select>
                  </div>

                  <input
                    type="text"
                    placeholder="Field description and extraction prompt hint"
                    value={newFieldDesc}
                    onChange={e => setNewFieldDesc(e.target.value)}
                    className="w-full text-xs p-2 rounded-lg border border-[#E5E7EB] bg-white focus:outline-none focus:border-[#14B8A6]"
                  />

                  <textarea
                    placeholder="AI extraction instruction (what should the model look for, and what should it ignore?)"
                    value={newFieldInstruction}
                    onChange={e => setNewFieldInstruction(e.target.value)}
                    rows={2}
                    className="w-full text-xs p-2 rounded-lg border border-[#E5E7EB] bg-white focus:outline-none focus:border-[#14B8A6] resize-none"
                  />

                  <textarea
                    placeholder="Semantic contract: exactly what does this field mean? What counts and what does not?"
                    value={newFieldSemanticContract}
                    onChange={e => setNewFieldSemanticContract(e.target.value)}
                    rows={2}
                    className="w-full text-xs p-2 rounded-lg border border-[#E5E7EB] bg-white focus:outline-none focus:border-[#14B8A6] resize-none"
                  />

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <textarea
                      placeholder="Positive examples (one per line)"
                      value={newFieldPositiveExamples}
                      onChange={e => setNewFieldPositiveExamples(e.target.value)}
                      rows={2}
                      className="text-xs p-2 rounded-lg border border-[#E5E7EB] bg-white focus:outline-none focus:border-[#14B8A6] resize-none"
                    />
                    <textarea
                      placeholder="Negative examples / do not extract (one per line)"
                      value={newFieldNegativeExamples}
                      onChange={e => setNewFieldNegativeExamples(e.target.value)}
                      rows={2}
                      className="text-xs p-2 rounded-lg border border-[#E5E7EB] bg-white focus:outline-none focus:border-[#14B8A6] resize-none"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <input
                      type="text"
                      placeholder='Validation rule / JSON (e.g. {"min":0})'
                      value={newFieldValidation}
                      onChange={e => setNewFieldValidation(e.target.value)}
                      className="text-xs p-2 rounded-lg border border-[#E5E7EB] bg-white focus:outline-none focus:border-[#14B8A6]"
                    />
                    <input
                      type="text"
                      placeholder="CRM destination field (optional)"
                      value={newFieldCrmMapping}
                      onChange={e => setNewFieldCrmMapping(e.target.value)}
                      className="text-xs p-2 rounded-lg border border-[#E5E7EB] bg-white focus:outline-none focus:border-[#14B8A6]"
                    />
                  </div>

                  {newFieldType === "enum" || newFieldType === "multi_select" ? (
                    <input
                      type="text"
                      placeholder="Comma-separated options (e.g. Discovery, Demo, Negotiation)"
                      value={newFieldOptions}
                      onChange={e => setNewFieldOptions(e.target.value)}
                      className="w-full text-xs p-2 rounded-lg border border-[#E5E7EB] bg-white focus:outline-none focus:border-[#14B8A6]"
                    />
                  ) : null}

                  <div className="flex items-center justify-between pt-1">
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={newFieldEvidence}
                        onChange={e => setNewFieldEvidence(e.target.checked)}
                        className="rounded border-[#CBD5E1] text-[#14B8A6] focus:ring-[#14B8A6]"
                      />
                      <span className="text-xs text-[#0F172A] font-medium">Require Verifiable Evidence</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={newFieldRequired}
                        onChange={e => setNewFieldRequired(e.target.checked)}
                        className="rounded border-[#CBD5E1] text-[#14B8A6] focus:ring-[#14B8A6]"
                      />
                      <span className="text-xs text-[#0F172A] font-medium">Required for review</span>
                    </label>

                    <div className="flex gap-2">
                      <button
                        onClick={() => setShowAddField(false)}
                        className="px-3 py-1.5 text-xs text-[#64748B] hover:bg-slate-100 rounded-lg"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={addStructuredField}
                        className="px-3 py-1.5 text-xs font-semibold text-white bg-[#14B8A6] hover:bg-[#0D9488] rounded-lg"
                      >
                        Add Field
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Fields List */}
              <div className="space-y-2">
                {structuredFields.map((field, idx) => {
                  const Icon = FIELD_TYPE_ICONS[field.type] || FileText;
                  return (
                    <div
                      key={field.id || idx}
                      className="p-3.5 rounded-xl border border-[#E5E7EB] bg-white hover:border-[#CBD5E1] transition-all flex items-center justify-between shadow-3xs"
                    >
                      <div className="flex items-center gap-3 min-w-0 pr-3">
                        <span className="p-2 rounded-lg bg-slate-50 text-[#64748B]">
                          <Icon size={14} />
                        </span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-[#0F172A]">{field.name}</span>
                            <span className="px-2 py-0.5 text-[10px] font-mono text-teal-800 bg-teal-50 rounded">
                              {field.type}
                            </span>
                            {field.evidence_required && (
                              <span className="px-1.5 py-0.5 text-[10px] text-amber-800 bg-amber-50 rounded flex items-center gap-1">
                                <Shield size={10} />
                                Grounded
                              </span>
                            )}
                          </div>
                          {field.description && (
                            <p className="text-[11px] text-[#64748B] mt-0.5 line-clamp-1">{field.description}</p>
                          )}
                          <div className="flex items-center gap-2 mt-1.5 text-[10px] text-[#94A3B8]">
                            {field.required_for_review && <span className="font-semibold text-amber-700">Review required</span>}
                            {field.ai_instruction && <span className="truncate max-w-[420px]" title={field.ai_instruction}>AI instruction configured</span>}
                            {field.crm_mapping?.destination_field && <span className="font-mono">→ {field.crm_mapping.destination_field}</span>}
                          </div>
                          {field.options && field.options.length > 0 && (
                            <div className="flex items-center gap-1 mt-1 flex-wrap">
                              {field.options.map((opt, i) => (
                                <span key={i} className="text-[9px] px-1.5 py-0.5 bg-slate-100 text-[#475569] rounded font-medium">
                                  {opt}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => moveStructuredField(idx, -1)}
                          disabled={idx === 0}
                          className="p-1 text-[#94A3B8] hover:text-[#0F172A] disabled:opacity-30"
                        >
                          <ArrowUp size={14} />
                        </button>
                        <button
                          onClick={() => moveStructuredField(idx, 1)}
                          disabled={idx === structuredFields.length - 1}
                          className="p-1 text-[#94A3B8] hover:text-[#0F172A] disabled:opacity-30"
                        >
                          <ArrowDown size={14} />
                        </button>
                        <button
                          onClick={() => removeStructuredField(idx)}
                          className="p-1 text-[#94A3B8] hover:text-red-600 ml-1"
                        >
                          <Trash size={14} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
