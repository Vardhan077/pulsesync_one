import React, { useState, useEffect } from "react";
import { 
  Plus, 
  Trash, 
  ArrowUp, 
  ArrowDown, 
  Save, 
  Sparkles, 
  HelpCircle, 
  X, 
  Layers, 
  Settings, 
  Database, 
  AlertCircle, 
  ArrowRight, 
  Check, 
  ChevronRight,
  Sparkle,
  Loader2,
  RefreshCw
} from "lucide-react";

// Large Selectable Starting Templates matching Enterprise SaaS playbooks
const TEMPLATES = [
  {
    id: "bant",
    name: "BANT Playbook",
    category: "Sales Qualification",
    fieldsCount: 4,
    description: "Budget, Authority, Need, and Timeline classic B2B qualification playbook.",
    fields: [
      { id: "sf-bant-b", label: "Project Budget", name: "project_budget", field_type: "currency", description: "Total budget discussed or allocated for purchase.", prompt_hint: "Look for monetary values, figures, pricing thresholds, or currency symbols.", is_required: true, crm_mapping: "HubSpot → budget", options: [] },
      { id: "sf-bant-a", label: "Decision Authority", name: "decision_authority", field_type: "string", description: "Identify key stakeholders holding signing authority.", prompt_hint: "Identify sign-off roles, designations like VP, CEO, or lead.", is_required: true, crm_mapping: "HubSpot → authority", options: [] },
      { id: "sf-bant-n", label: "Business Need", name: "business_need", field_type: "textarea", description: "Core technical/business pain points and client needs.", prompt_hint: "Summarize major issues and requirements client attempts to solve.", is_required: true, crm_mapping: "HubSpot → need", options: [] },
      { id: "sf-bant-t", label: "Implementation Timeline", name: "timeline", field_type: "string", description: "Target timeframe or rollout constraints for tasks.", prompt_hint: "Look for time intervals, dates, weeks, or Q3/Q4 quarters.", is_required: true, crm_mapping: "HubSpot → timeline", options: [] }
    ]
  },
  {
    id: "meddicc",
    name: "MEDDICC Playbook",
    category: "Enterprise Sales",
    fieldsCount: 7,
    description: "Metrics, Economic Buyer, Decision Criteria/Process, Pain points, Champion, and Competitors.",
    fields: [
      { id: "sf-med-m", label: "Metrics", name: "metrics", field_type: "textarea", description: "Quantifiable metrics and business outcomes client expects.", prompt_hint: "ROI parameters, percentages, currency increases, cost saves.", is_required: true, crm_mapping: "HubSpot → metrics", options: [] },
      { id: "sf-med-eb", label: "Economic Buyer", name: "economic_buyer", field_type: "string", description: "The ultimate decision maker holding budget ownership.", prompt_hint: "The person signing off on contracts or holding signing authority.", is_required: true, crm_mapping: "HubSpot → economic_buyer", options: [] },
      { id: "sf-med-dc", label: "Decision Criteria", name: "decision_criteria", field_type: "textarea", description: "Technical and commercial criteria used to evaluate products.", prompt_hint: "Product specifications, technical criteria, or vendor guidelines.", is_required: true, crm_mapping: "HubSpot → decision_criteria", options: [] },
      { id: "sf-med-dp", label: "Decision Process", name: "decision_process", field_type: "textarea", description: "Workflow process standard client follows to sign vendor.", prompt_hint: "Legal reviews, security checks, procurement steps.", is_required: true, crm_mapping: "HubSpot → decision_process", options: [] },
      { id: "sf-med-ip", label: "Identify Pain", name: "identify_pain", field_type: "textarea", description: "Core financial, technical, or operational blockers.", prompt_hint: "Client struggles, delays, or cost wastes.", is_required: true, crm_mapping: "HubSpot → identify_pain", options: [] },
      { id: "sf-med-c", label: "Champion", name: "champion", field_type: "string", description: "Internal advocate backing our product inside client firm.", prompt_hint: "Our main helper or contact person driving discussions.", is_required: true, crm_mapping: "HubSpot → champion", options: [] },
      { id: "sf-med-comp", label: "Competition", name: "competition", field_type: "textarea", description: "Competitors client is analyzing.", prompt_hint: "Named competitor brands and products.", is_required: false, crm_mapping: "None", options: [] }
    ]
  },
  {
    id: "qbr",
    name: "Customer QBR Review",
    category: "Customer Success",
    fieldsCount: 4,
    description: "Core achievements, customer roadblocks, feature feedback, and subsequent deliverables.",
    fields: [
      { id: "sf-qbr-m", label: "Core Milestones", name: "core_milestones", field_type: "textarea", description: "Key objectives achieved since last review.", prompt_hint: "Accomplishments, targets achieved, solved items.", is_required: true, crm_mapping: "HubSpot → milestones", options: [] },
      { id: "sf-qbr-pp", label: "Customer Pain Points", name: "customer_pain_points", field_type: "textarea", description: "Immediate product issues or friction points.", prompt_hint: "Complaints, delays, bugs, or UI friction.", is_required: true, crm_mapping: "HubSpot → pain_points", options: [] },
      { id: "sf-qbr-fb", label: "Product Feedback", name: "product_feedback", field_type: "textarea", description: "Feature requests or usability notes.", prompt_hint: "Requests, feedback comments, feature suggestions.", is_required: false, crm_mapping: "None", options: [] },
      { id: "sf-qbr-ap", label: "Action Plan", name: "action_plan", field_type: "textarea", description: "Next steps agreed upon during review.", prompt_hint: "Checklist items or owned deliverables.", is_required: true, crm_mapping: "HubSpot → action_plan", options: [] }
    ]
  },
  {
    id: "candidate",
    name: "Recruiting Interview",
    category: "Recruiting",
    fieldsCount: 4,
    description: "Technical proficiency, culture fit, and final verdict recommendation.",
    fields: [
      { id: "sf-cand-ts", label: "Technical Skills", name: "technical_skills", field_type: "textarea", description: "Coding, systems design, or domain expertise level.", prompt_hint: "Algorithmic thinking, system designs, coding expertise.", is_required: true, crm_mapping: "None", options: [] },
      { id: "sf-cand-cf", label: "Culture Fit", name: "culture_fit", field_type: "textarea", description: "Alignment with core company cultural values.", prompt_hint: "Behavioral remarks and team compatibility.", is_required: true, crm_mapping: "None", options: [] },
      { id: "sf-cand-gp", label: "Growth Potential", name: "growth_potential", field_type: "textarea", description: "Leadership capabilities and capacity to scale.", prompt_hint: "Ambition, feedback receptiveness, career goals.", is_required: true, crm_mapping: "None", options: [] },
      { id: "sf-cand-rec", label: "Verdict Recommendation", name: "verdict_recommendation", field_type: "enum", description: "Final hiring recommendation.", prompt_hint: "Hire, Strong Hire, No Hire decisions.", is_required: true, crm_mapping: "None", options: ["Strong Hire", "Hire", "No Hire"] }
    ]
  },
  {
    id: "discovery",
    name: "User Research",
    category: "Product Discovery",
    fieldsCount: 4,
    description: "Target user demographic, primary goals, usability issues, and feature desires.",
    fields: [
      { id: "sf-ur-persona", label: "User Persona", name: "user_persona", field_type: "string", description: "Target user demographic or persona segment.", prompt_hint: "Job title, cohort, company size, or role.", is_required: true, crm_mapping: "None", options: [] },
      { id: "sf-ur-goals", label: "Key Goals", name: "key_goals", field_type: "textarea", description: "Primary objectives user attempts to solve using our product.", prompt_hint: "Frustrations and target outcomes.", is_required: true, crm_mapping: "None", options: [] },
      { id: "sf-ur-ui", label: "Usability Issues", name: "usability_issues", field_type: "textarea", description: "Problems faced during product walkthrough.", prompt_hint: "Bugs, layout problems, or confusing directions.", is_required: true, crm_mapping: "None", options: [] },
      { id: "sf-ur-fd", label: "Feature Desirability", name: "feature_desirability", field_type: "textarea", description: "Highly requested or appreciated capabilities.", prompt_hint: "Desired features client expressed excitement about.", is_required: false, crm_mapping: "None", options: [] }
    ]
  }
];

export default function Playbooks() {
  const [schema, setSchema] = useState(null);
  const [fields, setFields] = useState([]);
  const [dbTemplates, setDbTemplates] = useState([]);
  const [activeTemplateId, setActiveTemplateId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState(null);

  // AI Prompt Schema Generator States
  const [aiUseCase, setAiUseCase] = useState("");
  const [generatingAI, setGeneratingAI] = useState(false);

  // Right-Side Edit Drawer Modal States
  const [editingFieldId, setEditingFieldId] = useState(null);
  
  // Local Drawer Form States
  const [dLabel, setDLabel] = useState("");
  const [dName, setDName] = useState("");
  const [dType, setDType] = useState("string");
  const [dDesc, setDDesc] = useState("");
  const [dHint, setDHint] = useState("");
  const [dRequired, setDRequired] = useState(false);
  const [dCrmMapping, setDCrmMapping] = useState("None");
  const [dOptions, setDOptions] = useState([]);
  const [newEnumOption, setNewEnumOption] = useState("");

  const API_URL = import.meta.env.VITE_API_URL || (typeof window !== "undefined" ? `${window.location.protocol}//${window.location.hostname}:3001` : "http://localhost:3001");

  const getMockCrmMapping = (name) => {
    const maps = {
      budget: "HubSpot → budget",
      project_budget: "HubSpot → budget",
      timeline: "HubSpot → timeline",
      decision_maker: "HubSpot → decision_maker",
      metrics: "HubSpot → metrics",
      economic_buyer: "HubSpot → economic_buyer",
      decision_criteria: "HubSpot → decision_criteria",
      decision_process: "HubSpot → decision_process",
      identify_pain: "HubSpot → identify_pain",
      champion: "HubSpot → champion",
      core_milestones: "HubSpot → milestones",
      customer_pain_points: "HubSpot → pain_points",
      action_plan: "HubSpot → action_plan"
    };
    return maps[name] || "None";
  };

  // 1. Fetch Active Schema, Custom Fields, and Database Playbook Templates
  useEffect(() => {
    const fetchSchemaAndFields = async () => {
      try {
        setLoading(true);
        // Fetch active schema container
        const schemaRes = await fetch(`${API_URL}/api/schemas`);
        if (!schemaRes.ok) throw new Error("Failed to load active schema container");
        const schemaData = await schemaRes.json();
        setSchema(schemaData);

        // Fetch corresponding fields
        const fieldsRes = await fetch(`${API_URL}/api/schemas/${schemaData.id}/fields`);
        if (!fieldsRes.ok) throw new Error("Failed to load schema fields");
        const fieldsData = await fieldsRes.json();
        
        // Map crm_mappings
        const sanitizedFields = fieldsData.map(f => ({
          ...f,
          crm_mapping: f.crm_mapping || getMockCrmMapping(f.name)
        }));
        setFields(sanitizedFields);

        // Fetch database-backed playbook templates (Single Source of Truth)
        try {
          const profilesRes = await fetch(`${API_URL}/api/extraction-profiles`);
          if (profilesRes.ok) {
            const profilesData = await profilesRes.json();
            if (Array.isArray(profilesData) && profilesData.length > 0) {
              const mapped = profilesData.map(p => ({
                id: p.id,
                name: p.name,
                category: p.name.toLowerCase().includes("sales") ? "Sales Qualification" : p.name.toLowerCase().includes("discovery") ? "Discovery" : "Playbook",
                fieldsCount: Array.isArray(p.fields) ? p.fields.length : 0,
                description: p.description || "Database-backed playbook framework.",
                fields: (p.fields || []).map(f => ({
                  id: f.id || `sf-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                  label: f.name || f.label || f.id,
                  name: f.id || (f.name || '').toLowerCase().replace(/[^a-z0-9_]/g, '_'),
                  field_type: f.type || f.field_type || 'string',
                  description: f.description || '',
                  prompt_hint: f.prompt_hint || f.ai_instruction || '',
                  is_required: Boolean(f.evidence_required || f.is_required || f.required_for_review),
                  crm_mapping: f.crm_mapping || getMockCrmMapping(f.id || f.name),
                  options: Array.isArray(f.options) ? f.options : []
                }))
              }));
              setDbTemplates(mapped);
            }
          }
        } catch (profileErr) {
          console.warn("Could not load database playbook profiles:", profileErr);
        }
      } catch (err) {
        console.error(err);
        setStatusMessage({ type: "error", text: "Unable to connect to PulseSync Schema API." });
      } finally {
        setLoading(false);
      }
    };
    fetchSchemaAndFields();
  }, []);

  // 2. Choose template and load it
  const handleSelectTemplate = (tpl) => {
    setActiveTemplateId(tpl.id);
    const newFields = tpl.fields.map(f => ({
      ...f,
      id: `sf-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    }));
    setFields(newFields);
    setStatusMessage({ 
      type: "success", 
      text: `Loaded Playbook template "${tpl.name}" successfully! Click "Save Schema changes" to publish.` 
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => setStatusMessage(null), 5000);
  };

  // 3. AI Schema Recommendation Generator
  const handleAIGenerate = () => {
    if (!aiUseCase.trim()) return;
    setGeneratingAI(true);
    setStatusMessage(null);
    
    setTimeout(() => {
      const promptLower = aiUseCase.toLowerCase();
      let generatedFields = [];

      if (promptLower.includes("onboarding") || promptLower.includes("customer setup") || promptLower.includes("implementation")) {
        generatedFields = [
          { id: `ai-1-${Date.now()}`, label: "Onboarding Goals", name: "onboarding_goals", field_type: "textarea", description: "Primary setup objectives customer expects to accomplish.", prompt_hint: "Integration scopes, targeted features, or metrics.", is_required: true, crm_mapping: "None", options: [] },
          { id: `ai-2-${Date.now()}`, label: "Technical Roadblocks", name: "technical_roadblocks", field_type: "textarea", description: "Security, API, or data roadblocks preventing Client setup.", prompt_hint: "Credential failures, code delays, or blocker notes.", is_required: true, crm_mapping: "None", options: [] },
          { id: `ai-3-${Date.now()}`, label: "Agreed Launch Date", name: "launch_date", field_type: "date", description: "Agreed target launch or account setup deadline.", prompt_hint: "Look for dates or time ranges.", is_required: true, crm_mapping: "None", options: [] },
          { id: `ai-4-${Date.now()}`, label: "Client Admin Owner", name: "client_admin", field_type: "string", description: "Customer resource driving task setups.", prompt_hint: "Name or role of client onboarding admin.", is_required: false, crm_mapping: "None", options: [] }
        ];
      } else if (promptLower.includes("interview") || promptLower.includes("hiring") || promptLower.includes("eval") || promptLower.includes("recruiting")) {
        generatedFields = [
          { id: `ai-1-${Date.now()}`, label: "Coding Performance", name: "coding_performance", field_type: "textarea", description: "Review of candidate algorithmic design and cleanliness.", prompt_hint: "Algorithms, design patterns, testing, performance.", is_required: true, crm_mapping: "None", options: [] },
          { id: `ai-2-${Date.now()}`, label: "System Architecture Skills", name: "architecture_skills", field_type: "textarea", description: "Capacity to design distributed, scalable backends.", prompt_hint: "Databases, caching, microservices, scaling concepts.", is_required: true, crm_mapping: "None", options: [] },
          { id: `ai-3-${Date.now()}`, label: "Verbal Articulation", name: "verbal_articulation", field_type: "textarea", description: "Clarity of solutions explanations.", prompt_hint: "Communication skill, explanation flow, confidence.", is_required: true, crm_mapping: "None", options: [] },
          { id: `ai-4-${Date.now()}`, label: "Hiring Consensus", name: "hiring_consensus", field_type: "enum", description: "Final hiring decision recommendation.", options: ["Strong Hire", "Hire", "No Hire"], is_required: true, crm_mapping: "None" }
        ];
      } else {
        generatedFields = [
          { id: `ai-1-${Date.now()}`, label: "Playbook Objectives", name: "playbook_objectives", field_type: "textarea", description: `Primary objectives identified for: ${aiUseCase}.`, prompt_hint: "Key targets, needs, or milestones discussed.", is_required: true, crm_mapping: "None", options: [] },
          { id: `ai-2-${Date.now()}`, label: "Action Obstacles", name: "action_obstacles", field_type: "textarea", description: "Core delays or objections voiced by the customer.", prompt_hint: "Pricing complaints, competitor evaluations, or tech friction.", is_required: true, crm_mapping: "None", options: [] },
          { id: `ai-3-${Date.now()}`, label: "Agreed Followup Date", name: "followup_date", field_type: "date", description: "Deadline agreed upon for subsequent action.", prompt_hint: "Look for dates or quarters.", is_required: false, crm_mapping: "None", options: [] }
        ];
      }

      setFields(generatedFields);
      setGeneratingAI(false);
      setStatusMessage({ 
        type: "success", 
        text: `AI generated schema recommended for "${aiUseCase}" loaded! Click "Save Schema changes" to save.` 
      });
      setAiUseCase("");
      setTimeout(() => setStatusMessage(null), 5000);
    }, 1500);
  };

  // 4. Open Right-Side Edit Drawer
  const openEditDrawer = (field) => {
    setEditingFieldId(field.id);
    setDLabel(field.label);
    setDName(field.name);
    setDType(field.field_type);
    setDDesc(field.description || "");
    setDHint(field.prompt_hint || "");
    setDRequired(field.is_required || false);
    setDCrmMapping(field.crm_mapping || "None");
    setDOptions(field.options || []);
    setNewEnumOption("");
  };

  const handleAddNewField = () => {
    const tempId = `temp-${Date.now()}`;
    const newField = {
      id: tempId,
      label: "",
      name: "",
      field_type: "string",
      description: "",
      prompt_hint: "",
      is_required: false,
      crm_mapping: "None",
      options: []
    };
    openEditDrawer(newField);
  };

  const handleSaveDrawerField = () => {
    if (!dLabel.trim() || !dName.trim()) {
      alert("Field display label and machine key key are required.");
      return;
    }

    const updatedField = {
      id: editingFieldId,
      label: dLabel.trim(),
      name: dName.toLowerCase().replace(/[^a-z0-9_]/g, "_").trim(),
      field_type: dType,
      description: dDesc.trim(),
      prompt_hint: dHint.trim(),
      is_required: dRequired,
      crm_mapping: dCrmMapping,
      options: dOptions
    };

    const exists = fields.some(f => f.id === editingFieldId);
    if (exists) {
      setFields(fields.map(f => f.id === editingFieldId ? updatedField : f));
    } else {
      setFields([...fields, updatedField]);
    }
    
    setEditingFieldId(null);
  };

  const handleRemoveField = (id) => {
    setFields(fields.filter((f) => f.id !== id));
  };

  const handleMove = (index, direction) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= fields.length) return;
    
    const result = Array.from(fields);
    const [moved] = result.splice(index, 1);
    result.splice(nextIndex, 0, moved);
    setFields(result);
  };

  const handleAddEnumOption = () => {
    if (!newEnumOption.trim()) return;
    const cleanOpt = newEnumOption.trim();
    if (dOptions.includes(cleanOpt)) return;
    setDOptions([...dOptions, cleanOpt]);
    setNewEnumOption("");
  };

  const handleRemoveEnumOption = (optIdx) => {
    setDOptions(dOptions.filter((_, idx) => idx !== optIdx));
  };

  const handleLabelChangeInDrawer = (value) => {
    setDLabel(value);
    const oldSlug = dLabel.toLowerCase().replace(/[^a-z0-9_]/g, "_");
    if (!dName || dName === oldSlug) {
      setDName(value.toLowerCase().replace(/[^a-z0-9_]/g, "_"));
    }
  };

  const handleSaveSchema = async () => {
    if (!schema) return;
    
    const invalidFields = fields.filter((f) => !f.label.trim() || !f.name.trim());
    if (invalidFields.length > 0) {
      setStatusMessage({ type: "error", text: "All fields must contain a valid Display Label and Key." });
      return;
    }

    setSaving(true);
    setStatusMessage(null);
    try {
      const response = await fetch(`${API_URL}/api/schemas/${schema.id}/fields`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          fields,
          templateId: activeTemplateId || (fields.some(f => f.name === 'decision_process' || f.name === 'identify_pain') ? 'meddicc' : undefined)
        })
      });

      if (!response.ok) throw new Error("Server failed to save dynamic fields");
      
      setStatusMessage({ type: "success", text: "Workspace Playbook published successfully!" });
      setTimeout(() => setStatusMessage(null), 5000);
      
      // Re-fetch fields
      const fieldsRes = await fetch(`${API_URL}/api/schemas/${schema.id}/fields`);
      if (fieldsRes.ok) {
        const fieldsData = await fieldsRes.json();
        const sanitizedFields = fieldsData.map(f => ({
          ...f,
          crm_mapping: f.crm_mapping || getMockCrmMapping(f.name)
        }));
        setFields(sanitizedFields);
      }
    } catch (err) {
      console.error(err);
      setStatusMessage({ type: "error", text: "Failed to publish workspace playbook." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-8 select-none bg-[#F8FAFC]">
      
      {/* ── Title Bar ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-[#E5E7EB]">
        <div>
          <h1 className="text-[32px] font-bold tracking-tight text-[#0F172A]">
            Playbooks Manager
          </h1>
          <p className="text-sm text-[#64748B] mt-1 font-normal leading-relaxed">
            Configure framework rules, target CRM parameters, and prompt cues for PulseSync AI to capture exactly what you need.
          </p>
        </div>
        <button
          onClick={handleSaveSchema}
          disabled={saving || loading}
          className="flex items-center gap-2 bg-[#14B8A6] hover:bg-[#0D9488] text-white text-xs font-bold px-4 py-2.5 rounded-lg shadow-sm transition disabled:opacity-40 disabled:pointer-events-none"
        >
          <Save size={14} />
          {saving ? "Publishing Playbook..." : "Save Schema changes"}
        </button>
      </div>

      {/* Alert Messaging */}
      {statusMessage && (
        <div
          className={`p-4 rounded-lg border text-xs font-bold flex-shrink-0 animate-in fade-in duration-200 ${
            statusMessage.type === "success"
              ? "bg-[#E2F8F0] border-[#A7F3D0] text-[#0D9488]"
              : "bg-[#FFF1F2] border-[#FECDD3] text-[#E11D48]"
          }`}
        >
          {statusMessage.text}
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center text-[#64748B] py-24 text-xs font-medium">
          <Loader2 className="animate-spin text-[#14B8A6] mb-3" size={20} />
          Synchronizing playbooks...
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          
          {/* ── Section 1: Template Gallery ── */}
          <div className="flex flex-col gap-4">
            <div>
              <h2 className="text-xl font-semibold text-[#0F172A] tracking-tight flex items-center gap-2">
                <Layers size={18} className="text-[#0284C7]" />
                Choose a Starting Playbook Template
              </h2>
              <p className="text-xs text-[#64748B] mt-0.5 font-normal leading-relaxed">
                Load B2B playbooks and framework schemas instantly. Select a framework card to override active configuration.
              </p>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
              {(dbTemplates.length > 0 ? dbTemplates : TEMPLATES).map((tpl) => (
                <div
                  key={tpl.id}
                  onClick={() => handleSelectTemplate(tpl)}
                  className="bg-white border border-[#E5E7EB] hover:border-[#14B8A6] hover:shadow-sm rounded-xl p-5 cursor-pointer flex flex-col justify-between transition duration-150 relative group"
                >
                  <div className="flex flex-col gap-2">
                    <span className="text-[9px] font-extrabold uppercase tracking-wider bg-[#EEF2FF] text-[#4F46E5] px-2 py-0.5 rounded-full w-fit">
                      {tpl.category}
                    </span>
                    <h3 className="text-xs font-bold text-[#0F172A] group-hover:text-[#14B8A6] transition">
                      {tpl.name}
                    </h3>
                    <p className="text-[11px] text-[#64748B] leading-relaxed mt-0.5 font-normal">
                      {tpl.description}
                    </p>
                  </div>
                  <div className="mt-4 pt-3 border-t border-[#F1F5F9] flex items-center justify-between text-[10px] text-[#94A3B8] font-semibold">
                    <span>{tpl.fieldsCount} attributes</span>
                    <span className="text-[#14B8A6] flex items-center gap-0.5 group-hover:translate-x-0.5 transition-transform">
                      Load Playbook <ArrowRight size={10} />
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Section 2: AI Playbook prompt Generator ── */}
          <div className="rounded-xl border border-[#E5E7EB] bg-white p-6 shadow-sm flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <Sparkles size={18} className="text-[#14B8A6]" />
              <h2 className="text-xs font-bold text-[#0F172A] uppercase tracking-wider">
                Generate Custom Playbook with PulseSync AI
              </h2>
            </div>
            <p className="text-[11px] text-[#64748B] leading-relaxed max-w-2xl font-normal mt-0.5">
              Describe your specific call playbook (e.g. "We conduct customer onboarding and setup reviews") and let AI configure mapping properties and cues instantly.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 w-full max-w-3xl mt-1">
              <input
                type="text"
                placeholder="E.g., Customer renewal reviews playbook..."
                value={aiUseCase}
                onChange={(e) => setAiUseCase(e.target.value)}
                className="flex-1 bg-[#F8FAFC] border border-[#E5E7EB] rounded-lg px-3.5 py-2 text-xs text-[#0F172A] outline-none placeholder-[#94A3B8] focus:border-[#14B8A6] focus:bg-white transition"
              />
              <button
                onClick={handleAIGenerate}
                disabled={generatingAI || !aiUseCase.trim()}
                className="bg-[#0F172A] hover:bg-[#1E293B] text-white text-xs font-bold px-4 py-2 rounded-lg transition disabled:opacity-40 disabled:pointer-events-none select-none flex items-center gap-1.5"
              >
                {generatingAI ? (
                  <>
                    <Loader2 className="animate-spin text-white" size={13} />
                    Compiling...
                  </>
                ) : (
                  <>
                    <Sparkle size={13} className="text-[#14B8A6]" />
                    Generate Playbook
                  </>
                )}
              </button>
            </div>
          </div>

          {/* ── Section 3: Schema Overview ── */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <div className="bg-white border border-[#E5E7EB] rounded-xl p-5 shadow-sm flex items-center justify-between">
              <div>
                <p className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider">Extracted Attributes</p>
                <h3 className="text-xl font-bold text-[#0F172A] mt-1 font-mono tracking-tight">
                  {fields.length} Fields Configured
                </h3>
              </div>
              <div className="h-8 w-8 rounded bg-[#E6F4F1] text-[#0D9488] flex items-center justify-center font-bold text-xs">
                {fields.length}
              </div>
            </div>

            <div className="bg-white border border-[#E5E7EB] rounded-xl p-5 shadow-sm flex items-center justify-between">
              <div>
                <p className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider">CRM Target sync</p>
                <h3 className="text-xl font-bold text-[#0F172A] mt-1 tracking-tight">
                  HubSpot CRM Connected
                </h3>
              </div>
              <div className="h-8 w-8 rounded bg-[#E0F2FE] text-[#0284C7] flex items-center justify-center font-bold text-xs">
                <Database size={15} />
              </div>
            </div>

            <div className="bg-white border border-[#E5E7EB] rounded-xl p-5 shadow-sm flex items-center justify-between">
              <div>
                <p className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider">Sync Version Status</p>
                <h3 className="text-xl font-bold text-[#0F172A] mt-1 tracking-tight">
                  Active published version
                </h3>
              </div>
              <div className="h-8 w-8 rounded bg-[#EEF2FF] text-[#4F46E5] flex items-center justify-center font-bold text-xs">
                <Check size={15} />
              </div>
            </div>
          </div>

          {/* ── Section 4: Compact Rows Fields Directory ── */}
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-[#0F172A] tracking-tight flex items-center gap-2">
                  <Settings size={18} className="text-[#14B8A6]" />
                  Active Custom Fields Configuration
                </h2>
                <p className="text-xs text-[#64748B] mt-0.5 font-normal leading-relaxed">
                  Reorder and configure prompts for each parameter.
                </p>
              </div>
              
              <button
                onClick={handleAddNewField}
                className="flex items-center gap-1 bg-white border border-[#E5E7EB] hover:bg-[#F1F5F9] text-[#0F172A] text-xs font-bold px-3 py-1.5 rounded-lg shadow-sm transition"
              >
                <Plus size={14} className="text-[#14B8A6]" />
                Add Custom Field
              </button>
            </div>

            {fields.length === 0 ? (
              <div className="text-center py-20 border border-dashed border-[#E5E7EB] bg-white rounded-xl shadow-sm">
                <p className="text-xs text-[#64748B] font-bold">No playbook fields configured.</p>
                <p className="text-[11px] text-[#94A3B8] mt-1 max-w-xs mx-auto leading-relaxed">
                  Click 'Add Custom Field' or load a framework card to seed attributes.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {fields.map((field, index) => (
                  <div
                    key={field.id}
                    className="bg-white border border-[#E5E7EB] hover:border-[#CBD5E1] rounded-xl px-5 py-4 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4 transition duration-150 group"
                  >
                    
                    <div className="flex items-center gap-4">
                      {/* Drag / sort controls */}
                      <div className="flex items-center gap-0.5">
                        <button
                          onClick={() => handleMove(index, -1)}
                          disabled={index === 0}
                          className="p-1 hover:bg-[#F1F5F9] rounded text-[#64748B] hover:text-[#0F172A] disabled:opacity-25"
                          title="Move Up"
                        >
                          <ArrowUp size={13} />
                        </button>
                        <button
                          onClick={() => handleMove(index, 1)}
                          disabled={index === fields.length - 1}
                          className="p-1 hover:bg-[#F1F5F9] rounded text-[#64748B] hover:text-[#0F172A] disabled:opacity-25"
                          title="Move Down"
                        >
                          <ArrowDown size={13} />
                        </button>
                      </div>

                      {/* Display Label and Key */}
                      <div className="flex flex-col">
                        <h4 className="text-sm font-bold text-[#0F172A] flex items-center gap-2">
                          {field.label || (
                            <span className="text-[#94A3B8] italic font-normal">New attribute configuring...</span>
                          )}
                          {field.is_required && (
                            <span className="text-[9px] text-[#0284C7] font-bold bg-[#E0F2FE] border border-[#0284C7]/20 px-1.5 py-0.2 rounded">
                              Required
                            </span>
                          )}
                        </h4>
                        <span className="text-[10px] text-[#94A3B8] font-mono mt-0.5">
                          Key: {field.name || "not_generated"}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      {/* Data Type Badge */}
                      <span className="text-[10px] bg-[#F1F5F9] text-[#64748B] border border-[#E5E7EB] px-2.5 py-0.5 rounded-full font-bold uppercase">
                        Type: {field.field_type}
                      </span>

                      {/* CRM Mapping badge */}
                      {field.crm_mapping && field.crm_mapping !== "None" ? (
                        <span className="text-[10px] bg-[#FEF3C7] text-[#D97706] border border-[#FDE68A] px-2.5 py-0.5 rounded-full font-bold flex items-center gap-1">
                          <RefreshCw size={10} />
                          {field.crm_mapping}
                        </span>
                      ) : (
                        <span className="text-[10px] bg-[#F1F5F9] text-[#94A3B8] border border-[#E5E7EB] px-2.5 py-0.5 rounded-full font-semibold">
                          No CRM Link
                        </span>
                      )}

                      {/* Actions */}
                      <div className="flex items-center gap-1.5 md:ml-4">
                        <button
                          onClick={() => openEditDrawer(field)}
                          className="flex items-center gap-1 border border-[#E5E7EB] hover:bg-[#F1F5F9] text-[#14B8A6] hover:text-[#0D9488] text-xs font-bold px-3 py-1.5 rounded-lg shadow-sm transition"
                        >
                          Configure Field
                          <ChevronRight size={12} />
                        </button>
                        
                        <button
                          onClick={() => handleRemoveField(field.id)}
                          className="p-2 hover:bg-[#FFF1F2] rounded-lg text-[#94A3B8] hover:text-[#E11D48] transition"
                          title="Remove Field"
                        >
                          <Trash size={14} />
                        </button>
                      </div>
                    </div>

                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      )}

      {/* ── Slide-Out Right-Side Edit Drawer Modal ── */}
      {editingFieldId !== null && (
        <div className="fixed inset-0 bg-[#0F172A]/35 backdrop-blur-xs z-50 flex justify-end animate-in fade-in duration-200">
          <div className="bg-white border-l border-[#E5E7EB] w-full max-w-md h-full flex flex-col p-6 animate-in slide-in-from-right duration-250 z-50 shadow-2xl overflow-y-auto">
            
            {/* Drawer Header */}
            <div className="flex items-center justify-between pb-4 border-b border-[#E5E7EB] mb-5">
              <div className="flex items-center gap-2">
                <Settings className="text-[#14B8A6]" size={16} />
                <h3 className="text-xs font-bold text-[#0F172A] uppercase tracking-wide">
                  Configure Field Attributes
                </h3>
              </div>
              <button
                onClick={() => setEditingFieldId(null)}
                className="p-1 hover:bg-[#F1F5F9] rounded-lg text-[#64748B] hover:text-[#0F172A] transition"
              >
                <X size={16} />
              </button>
            </div>

            {/* Drawer Body Scroll */}
            <div className="flex-1 space-y-4 pr-1 pb-16">
              
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-bold text-[#64748B] uppercase tracking-wide">Display Label</label>
                <input
                  type="text"
                  placeholder="e.g. Project Budget"
                  value={dLabel}
                  onChange={(e) => handleLabelChangeInDrawer(e.target.value)}
                  className="w-full border border-[#E5E7EB] rounded-lg px-3 py-2 text-xs text-[#0F172A] outline-none focus:border-[#14B8A6] bg-white font-semibold shadow-sm"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-bold text-[#64748B] uppercase tracking-wide flex items-center gap-1">
                  Machine Slug Key
                  <HelpCircle size={11} className="text-[#94A3B8]" title="Unique alphanumeric key slug saved in DB." />
                </label>
                <input
                  type="text"
                  placeholder="e.g. project_budget"
                  value={dName}
                  onChange={(e) => setDName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))}
                  className="w-full border border-[#E5E7EB] rounded-lg px-3 py-2 text-xs text-[#64748B] outline-none focus:border-[#14B8A6] bg-[#F8FAFC] font-mono shadow-sm"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-bold text-[#64748B] uppercase tracking-wide">Field Data Type</label>
                <select
                  value={dType}
                  onChange={(e) => setDType(e.target.value)}
                  className="w-full border border-[#E5E7EB] rounded-lg px-3 py-2 text-xs text-[#0F172A] outline-none focus:border-[#14B8A6] bg-white font-semibold shadow-sm cursor-pointer"
                >
                  <option value="string">String (Short Text)</option>
                  <option value="number">Number</option>
                  <option value="currency">Currency ($)</option>
                  <option value="boolean">Boolean (Yes/No)</option>
                  <option value="date">Date</option>
                  <option value="enum">Enum Choices</option>
                  <option value="textarea">Textarea (Long text)</option>
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-bold text-[#64748B] uppercase tracking-wide">Connected CRM Mapping</label>
                <select
                  value={dCrmMapping}
                  onChange={(e) => setDCrmMapping(e.target.value)}
                  className="w-full border border-[#E5E7EB] rounded-lg px-3 py-2 text-xs text-[#0F172A] outline-none focus:border-[#14B8A6] bg-white font-semibold shadow-sm cursor-pointer"
                >
                  <option value="None">No Sync Mapping (Local only)</option>
                  <option value="HubSpot → budget">HubSpot CRM → Project Budget (budget)</option>
                  <option value="HubSpot → timeline">HubSpot CRM → Customer Timeline (timeline)</option>
                  <option value="HubSpot → decision_maker">HubSpot CRM → Decision Maker (decision_maker)</option>
                  <option value="HubSpot → milestones">HubSpot CRM → Review Milestones (milestones)</option>
                  <option value="HubSpot → pain_points">HubSpot CRM → Account Pain Points (pain_points)</option>
                  <option value="HubSpot → action_plan">HubSpot CRM → Renewal Action Plan (action_plan)</option>
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-bold text-[#64748B] uppercase tracking-wide">Attribute Description</label>
                <textarea
                  rows="2"
                  placeholder="Summarize what this dynamic attribute represents to guide the parsing models..."
                  value={dDesc}
                  onChange={(e) => setDDesc(e.target.value)}
                  className="w-full border border-[#E5E7EB] bg-white rounded-lg px-3 py-2 text-xs text-[#64748B] outline-none focus:border-[#14B8A6] resize-none leading-relaxed shadow-sm font-sans"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-bold text-[#64748B] uppercase tracking-wide flex items-center gap-1.5">
                  AI Prompt guidelines / Cues
                  <span className="text-[9px] text-[#14B8A6] font-bold bg-[#E6F4F1] border border-[#14B8A6]/20 px-1.5 py-0.2 rounded font-sans">Prompt Booster</span>
                </label>
                <textarea
                  rows="2"
                  placeholder="E.g. Look for monetary phrases or specific percentage rates..."
                  value={dHint}
                  onChange={(e) => setDHint(e.target.value)}
                  className="w-full border border-[#E5E7EB] bg-white rounded-lg px-3 py-2 text-xs text-[#64748B] outline-none focus:border-[#14B8A6] resize-none leading-relaxed shadow-sm font-sans"
                />
              </div>

              <div className="flex items-center gap-2 py-1">
                <input
                  type="checkbox"
                  id="drawer-req"
                  checked={dRequired}
                  onChange={(e) => setDRequired(e.target.checked)}
                  className="h-4 w-4 accent-[#14B8A6] border-[#E5E7EB] rounded cursor-pointer"
                />
                <label htmlFor="drawer-req" className="text-xs text-[#64748B] cursor-pointer font-bold">
                  Mark as Required for Analysis
                </label>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-bold text-[#64748B] uppercase tracking-wide">Validation Rules</label>
                <select
                  className="w-full border border-[#E5E7EB] rounded-lg px-3 py-2 text-xs text-[#64748B] outline-none focus:border-[#14B8A6] bg-white shadow-sm cursor-pointer font-semibold"
                  defaultValue="None"
                >
                  <option value="None">None (Accept any format)</option>
                  <option value="Must be non-empty">Must be a non-empty value</option>
                  <option value="Must be positive number">Must be a positive numeric value</option>
                  <option value="Timeline format">Must match standard timeline string patterns</option>
                </select>
              </div>

              {dType === "enum" && (
                <div className="border-t border-[#F1F5F9] pt-4 flex flex-col gap-2">
                  <label className="text-[11px] font-bold text-[#64748B] uppercase tracking-wide select-none">Enum Choices Options</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      placeholder="Add option tag (Press Enter)"
                      value={newEnumOption}
                      onChange={(e) => setNewEnumOption(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleAddEnumOption();
                        }
                      }}
                      className="flex-1 border border-[#E5E7EB] rounded-lg bg-white px-3 py-1.5 text-xs text-[#0F172A] outline-none focus:border-[#14B8A6] shadow-sm font-semibold"
                    />
                  </div>
                  
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {dOptions.length === 0 ? (
                      <span className="text-[10px] text-[#94A3B8] italic font-sans font-medium">No choice options defined.</span>
                    ) : (
                      dOptions.map((opt, oIdx) => (
                        <span
                          key={oIdx}
                          className="inline-flex items-center gap-1 text-[9px] font-extrabold bg-[#EEF2FF] border border-[#4F46E5]/15 text-[#4F46E5] px-2 py-0.5 rounded-full"
                        >
                          {opt}
                          <button
                            type="button"
                            onClick={() => handleRemoveEnumOption(oIdx)}
                            className="hover:text-rose-500 text-[10px] focus:outline-none ml-1 font-extrabold"
                          >
                            ×
                          </button>
                        </span>
                      ))
                    )}
                  </div>
                </div>
              )}

            </div>

            {/* Drawer Footer */}
            <div className="border-t border-[#E5E7EB] pt-4 flex justify-end gap-2 bg-white select-none">
              <button
                onClick={() => setEditingFieldId(null)}
                className="border border-[#E5E7EB] bg-white hover:bg-[#F1F5F9] rounded-lg px-4 py-2 text-xs font-semibold text-[#64748B] transition"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveDrawerField}
                className="bg-[#14B8A6] hover:bg-[#0D9488] text-white rounded-lg px-5 py-2 text-xs font-bold shadow-sm transition"
              >
                Save Attribute
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
