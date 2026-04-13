"use client";

import { useState, useEffect } from "react";
import { X, Loader2, CheckCircle, ClipboardCheck } from "lucide-react";

interface FormModalProps {
  formTemplateId?: string; // specific form to show
  taskCategoryId?: string; // auto-find form by task category
  conversationId: string;
  taskId?: string;
  submittedBy?: string;
  onClose: () => void;
  onSubmitted?: (result: { noteId?: string; completedTask?: boolean }) => void;
}

export default function FormModal({
  formTemplateId,
  taskCategoryId,
  conversationId,
  taskId,
  submittedBy,
  onClose,
  onSubmitted,
}: FormModalProps) {
  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState<any[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<any>(null);
  const [responses, setResponses] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [askComplete, setAskComplete] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/forms");
        const data = await res.json();
        const allForms = (data.forms || []).filter((f: any) => f.is_active);

        if (formTemplateId) {
          const match = allForms.find((f: any) => f.id === formTemplateId);
          if (match) { setSelectedTemplate(match); initResponses(match); }
          setTemplates(allForms);
        } else if (taskCategoryId) {
          // Find form linked to this task category
          const match = allForms.find((f: any) => f.task_category_id === taskCategoryId);
          if (match) { setSelectedTemplate(match); initResponses(match); }
          setTemplates(allForms);
        } else {
          setTemplates(allForms);
        }
      } catch { setError("Failed to load forms"); }
      setLoading(false);
    })();
  }, [formTemplateId, taskCategoryId]);

  const initResponses = (template: any) => {
    const initial: Record<string, any> = {};
    for (const field of (template.fields || [])) {
      if (field.field_type === "checkbox") initial[field.id] = false;
      else if (field.field_type === "multi_select") initial[field.id] = [];
      else initial[field.id] = field.default_value || "";
    }
    setResponses(initial);
  };

  const selectTemplate = (t: any) => {
    setSelectedTemplate(t);
    initResponses(t);
    setError("");
  };

  const handleSubmit = async (completeTask: boolean) => {
    if (!selectedTemplate) return;

    // Validate required fields
    for (const field of (selectedTemplate.fields || [])) {
      if (field.is_required) {
        const val = responses[field.id];
        if (val === undefined || val === "" || val === null || (Array.isArray(val) && val.length === 0)) {
          setError(`"${field.label}" is required`);
          return;
        }
      }
    }

    setSaving(true); setError("");
    try {
      const res = await fetch("/api/forms/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          form_template_id: selectedTemplate.id,
          conversation_id: conversationId,
          task_id: taskId || null,
          submitted_by: submittedBy || null,
          responses,
          complete_task: completeTask,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setSubmitted(true);
        onSubmitted?.({ noteId: data.note?.id, completedTask: completeTask });
        setTimeout(() => onClose(), 1500);
      } else {
        setError(data.error || "Failed to submit");
      }
    } catch { setError("Network error"); }
    setSaving(false);
  };

  const renderField = (field: any) => {
    const value = responses[field.id] ?? "";
    const cls = "w-full px-3 py-2 rounded-lg bg-[#0B0E11] border border-[#1E242C] text-sm text-[#E6EDF3] outline-none focus:border-[#4ADE80] placeholder:text-[#484F58]";

    switch (field.field_type) {
      case "text":
      case "email":
      case "phone":
        return <input type={field.field_type === "phone" ? "tel" : field.field_type} value={value}
          onChange={(e) => setResponses((p) => ({ ...p, [field.id]: e.target.value }))}
          placeholder={field.placeholder || ""} className={cls} />;

      case "number":
        return <input type="number" value={value}
          onChange={(e) => setResponses((p) => ({ ...p, [field.id]: e.target.value }))}
          placeholder={field.placeholder || ""} className={cls} />;

      case "textarea":
        return <textarea value={value} rows={3}
          onChange={(e) => setResponses((p) => ({ ...p, [field.id]: e.target.value }))}
          placeholder={field.placeholder || ""} className={cls + " resize-y"} />;

      case "date":
        return <input type="date" value={value}
          onChange={(e) => setResponses((p) => ({ ...p, [field.id]: e.target.value }))} className={cls} />;

      case "time":
        return <input type="time" value={value}
          onChange={(e) => setResponses((p) => ({ ...p, [field.id]: e.target.value }))} className={cls} />;

      case "checkbox":
        return (
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={!!value}
              onChange={(e) => setResponses((p) => ({ ...p, [field.id]: e.target.checked }))}
              className="w-4 h-4 rounded border-[#1E242C] bg-[#0B0E11] accent-[#4ADE80]" />
            <span className="text-sm text-[#E6EDF3]">{field.placeholder || "Yes"}</span>
          </label>
        );

      case "select": {
        const options = Array.isArray(field.options) ? field.options : [];
        return (
          <select value={value}
            onChange={(e) => setResponses((p) => ({ ...p, [field.id]: e.target.value }))} className={cls}>
            <option value="">Select...</option>
            {options.map((o: string) => <option key={o} value={o}>{o}</option>)}
          </select>
        );
      }

      case "multi_select": {
        const options = Array.isArray(field.options) ? field.options : [];
        const selected = Array.isArray(value) ? value : [];
        return (
          <div className="flex flex-wrap gap-1.5">
            {options.map((o: string) => (
              <button key={o} onClick={() => {
                setResponses((p) => ({
                  ...p, [field.id]: selected.includes(o) ? selected.filter((s: string) => s !== o) : [...selected, o],
                }));
              }}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                  selected.includes(o)
                    ? "bg-[#4ADE80]/12 text-[#4ADE80] border border-[#4ADE80]/30"
                    : "text-[#7D8590] border border-[#1E242C] hover:text-[#E6EDF3]"
                }`}>{o}</button>
            ))}
          </div>
        );
      }

      default:
        return <input value={value}
          onChange={(e) => setResponses((p) => ({ ...p, [field.id]: e.target.value }))}
          placeholder={field.placeholder || ""} className={cls} />;
    }
  };

  // ── Render ──
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-[#12161B] border border-[#1E242C] rounded-2xl w-full max-w-lg max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#1E242C]">
          <div className="flex items-center gap-2">
            <ClipboardCheck size={18} className="text-[#4ADE80]" />
            <span className="text-sm font-semibold text-[#E6EDF3]">
              {submitted ? "Form Submitted" : selectedTemplate ? selectedTemplate.name : "Select Form"}
            </span>
          </div>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-[#1E242C] text-[#7D8590]"><X size={18} /></button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading && <div className="flex justify-center py-12"><Loader2 className="animate-spin text-[#4ADE80]" size={24} /></div>}

          {/* Success state */}
          {submitted && (
            <div className="flex flex-col items-center py-12">
              <CheckCircle size={48} className="text-[#4ADE80] mb-3" />
              <div className="text-sm font-semibold text-[#E6EDF3]">Form submitted successfully!</div>
              <div className="text-xs text-[#7D8590] mt-1">Saved to conversation notes</div>
            </div>
          )}

          {/* Ask complete task */}
          {askComplete && !submitted && (
            <div className="flex flex-col items-center py-8">
              <div className="text-sm font-semibold text-[#E6EDF3] mb-4">Would you like to complete the task?</div>
              <div className="flex gap-3">
                <button onClick={() => handleSubmit(true)} disabled={saving}
                  className="px-4 py-2.5 rounded-lg bg-[#4ADE80] text-[#0B0E11] font-semibold text-sm hover:bg-[#3BC96E] disabled:opacity-50">
                  {saving ? "Saving..." : "Yes, complete task"}
                </button>
                <button onClick={() => handleSubmit(false)} disabled={saving}
                  className="px-4 py-2.5 rounded-lg border border-[#1E242C] text-sm text-[#7D8590] hover:text-[#E6EDF3] disabled:opacity-50">
                  {saving ? "Saving..." : "No, keep it open"}
                </button>
              </div>
            </div>
          )}

          {/* Template selector (if no template pre-selected) */}
          {!loading && !submitted && !askComplete && !selectedTemplate && (
            <div className="space-y-2">
              {templates.length === 0 ? (
                <div className="text-center py-8 text-[#484F58]">
                  <div className="text-sm">No form templates available</div>
                  <div className="text-xs mt-1">Create one in Settings → Forms</div>
                </div>
              ) : (
                templates.map((t) => (
                  <button key={t.id} onClick={() => selectTemplate(t)}
                    className="w-full text-left p-3 rounded-lg border border-[#1E242C] hover:border-[#4ADE80]/30 hover:bg-[#0B0E11] transition-all">
                    <div className="text-sm font-medium text-[#E6EDF3]">{t.name}</div>
                    {t.description && <div className="text-[11px] text-[#7D8590] mt-0.5">{t.description}</div>}
                    <div className="text-[10px] text-[#484F58] mt-1">{t.fields?.length || 0} fields</div>
                  </button>
                ))
              )}
            </div>
          )}

          {/* Form fields */}
          {!loading && !submitted && !askComplete && selectedTemplate && (
            <div className="space-y-4">
              {selectedTemplate.description && (
                <div className="text-xs text-[#7D8590] mb-2">{selectedTemplate.description}</div>
              )}
              {(selectedTemplate.fields || []).map((field: any) => (
                <div key={field.id}>
                  <label className="block text-xs font-semibold text-[#7D8590] mb-1.5">
                    {field.label}
                    {field.is_required && <span className="text-[#F85149] ml-0.5">*</span>}
                  </label>
                  {renderField(field)}
                </div>
              ))}
              {error && <div className="text-xs text-[#F85149]">{error}</div>}
            </div>
          )}
        </div>

        {/* Footer */}
        {!loading && !submitted && !askComplete && selectedTemplate && (
          <div className="px-5 py-3.5 border-t border-[#1E242C] flex items-center gap-2">
            {templates.length > 1 && (
              <button onClick={() => { setSelectedTemplate(null); setError(""); }}
                className="text-xs text-[#7D8590] hover:text-[#E6EDF3]">← Change form</button>
            )}
            <div className="flex-1" />
            <button onClick={onClose} className="px-3 py-2 rounded-lg border border-[#1E242C] text-xs text-[#7D8590]">Cancel</button>
            <button onClick={() => { taskId ? setAskComplete(true) : handleSubmit(false); }} disabled={saving}
              className="px-4 py-2 rounded-lg bg-[#4ADE80] text-[#0B0E11] text-xs font-bold hover:bg-[#3BC96E] disabled:opacity-50">
              {saving ? "Submitting..." : "Submit"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
