import React, { useState } from 'react';
import { X, AlertTriangle, Cloud, Database, Check } from 'lucide-react';

const DESTINATIONS = [
  { id: 'hubspot', name: 'HubSpot CRM', type: 'CRM', icon: Cloud },
  { id: 'salesforce', name: 'Salesforce CRM', type: 'CRM', icon: Cloud },
  { id: 'snowflake', name: 'Snowflake DW', type: 'Database', icon: Database },
  { id: 'postgres', name: 'PostgreSQL DB', type: 'Database', icon: Database }
];

export default function SyncConfirmationModal({ isOpen, onClose, onConfirm, meetingTitle, approvedItems = [] }) {
  const [selectedDestinations, setSelectedDestinations] = useState(['hubspot']);

  if (!isOpen) return null;

  const hasLowConfidence = approvedItems.some((item) => item.confidence < 80);

  const toggleDestination = (id) => {
    if (selectedDestinations.includes(id)) {
      if (selectedDestinations.length > 1) {
        setSelectedDestinations(selectedDestinations.filter((d) => d !== id));
      }
    } else {
      setSelectedDestinations([...selectedDestinations, id]);
    }
  };

  const handleConfirm = () => {
    onConfirm(selectedDestinations);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-xl max-w-xl w-full mx-4 shadow-2xl border border-[#E5E7EB] flex flex-col max-h-[85vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E5E7EB] flex-shrink-0">
          <div>
            <h2 className="text-[15px] font-bold text-[#0F172A]">Confirm Destination Sync</h2>
            <p className="text-[11px] text-[#64748B] mt-0.5">Select destinations and review values before syncing</p>
          </div>
          <button id="sync-modal-close" title="Close" onClick={onClose} className="text-[#94A3B8] hover:text-[#64748B] p-1.5 hover:bg-[#F8FAFC] rounded-lg transition">
            <X size={18} />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="px-6 py-5 space-y-5 overflow-y-auto scroll-thin flex-1">
          <div className="bg-[#F8FAFC] border border-[#E5E7EB] rounded-lg px-4 py-3">
            <span className="text-[10px] font-bold text-[#94A3B8] uppercase tracking-wider block">Active Meeting Session</span>
            <span className="text-[13px] font-semibold text-[#0F172A] mt-0.5 block">{meetingTitle}</span>
          </div>

          {/* Destination Selector */}
          <div className="space-y-2.5">
            <span className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider block">1. Select Target Destinations</span>
            <div className="grid grid-cols-2 gap-3">
              {DESTINATIONS.map((dest) => {
                const isChecked = selectedDestinations.includes(dest.id);
                const Icon = dest.icon;
                return (
                  <div
                    key={dest.id}
                    onClick={() => toggleDestination(dest.id)}
                    className={`border rounded-lg p-3 cursor-pointer select-none transition flex items-center justify-between ${
                      isChecked 
                        ? 'border-[#14B8A6] bg-[#E6F4F1]/20 text-[#0F172A]' 
                        : 'border-[#E5E7EB] bg-white text-[#64748B] hover:border-[#CBD5E1]'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <div className={`p-1.5 rounded ${isChecked ? 'bg-[#14B8A6] text-white' : 'bg-[#F1F5F9] text-[#64748B]'}`}>
                        <Icon size={14} />
                      </div>
                      <div>
                        <span className="text-[12px] font-bold block">{dest.name}</span>
                        <span className="text-[10px] text-[#94A3B8] block">{dest.type}</span>
                      </div>
                    </div>
                    <div className={`h-4.5 w-4.5 rounded-full border flex items-center justify-center transition ${
                      isChecked ? 'bg-[#14B8A6] border-[#14B8A6] text-white' : 'border-[#CBD5E1] bg-white'
                    }`}>
                      {isChecked && <Check size={10} strokeWidth={3} />}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Properties Summary */}
          <div className="space-y-2.5">
            <span className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider block">2. Payload Summary ({approvedItems.length} Fields)</span>
            <div className="overflow-hidden rounded-lg border border-[#E5E7EB]">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-[#F8FAFC] text-[11px] font-semibold uppercase tracking-wide text-[#64748B] border-b border-[#E5E7EB]">
                    <th className="py-2 px-3">Field</th>
                    <th className="py-2 px-3">Value</th>
                    <th className="py-2 px-3 text-right">Confidence</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F1F5F9] text-[12px]">
                  {approvedItems.map((item, idx) => (
                    <tr key={item.key || idx} className="hover:bg-[#F8FAFC]/50 transition">
                      <td className="py-2 px-3 font-semibold text-[#0F172A]">{item.field}</td>
                      <td className="py-2 px-3 text-[#64748B] font-medium truncate max-w-[180px]">{item.extractedValue}</td>
                      <td className="py-2 px-3 text-right font-mono font-semibold text-[#64748B]">
                        {item.confidence}%
                      </td>
                    </tr>
                  ))}
                  {approvedItems.length === 0 && (
                    <tr>
                      <td colSpan={3} className="py-4 text-center text-[12px] text-[#94A3B8] italic font-medium">
                        No fields are currently approved. Approve fields before syncing.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {hasLowConfidence && (
            <div className="flex items-center gap-2 text-[11px] font-semibold text-[#D97706] bg-[#FFFBEB] border border-[#FDE68A] p-2.5 rounded-lg">
              <AlertTriangle size={14} className="flex-shrink-0" />
              <span>Note: Some approved findings have confidence scores below 80%.</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[#E5E7EB] bg-[#F8FAFC] flex-shrink-0">
          <button
            id="sync-modal-cancel"
            title="Cancel"
            onClick={onClose}
            className="px-4 py-2 text-[12px] font-semibold text-[#64748B] border border-[#E5E7EB] bg-white rounded-lg hover:bg-[#F8FAFC] transition"
          >
            Cancel
          </button>
          <button
            id="sync-modal-confirm"
            title="Confirm and sync"
            disabled={approvedItems.length === 0}
            onClick={handleConfirm}
            className="px-5 py-2 text-[12px] font-bold text-white bg-[#14B8A6] rounded-lg hover:bg-[#0D9488] transition disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
          >
            Confirm & Sync
          </button>
        </div>
      </div>
    </div>
  );
}

