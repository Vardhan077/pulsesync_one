import React, { useState } from 'react';
import { ListChecks, CheckCircle2, Circle } from 'lucide-react';

const priorityColors = {
  high: 'bg-[#DC2626]',
  medium: 'bg-[#D97706]',
  low: 'bg-[#14B8A6]',
};

function formatDate(dateStr) {
  if (!dateStr) return 'No date';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function ActionTracker({ actionItems = [] }) {
  const [completedTasks, setCompletedTasks] = useState({});

  const toggleTask = (index) => {
    setCompletedTasks((prev) => ({ ...prev, [index]: !prev[index] }));
  };

  return (
    <div className="rounded-xl border border-[#E5E7EB] bg-white p-6">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <ListChecks size={14} className="text-[#64748B]" />
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[#64748B]">
          Action Items
        </h3>
      </div>

      {actionItems.length === 0 ? (
        <p className="text-[11px] font-medium text-[#94A3B8] py-4">No action items recorded.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-[#E5E7EB] text-[11px] font-semibold uppercase tracking-wide text-[#64748B]">
                <th className="py-2.5 pr-3 w-8" />
                <th className="py-2.5 px-3">Description</th>
                <th className="py-2.5 px-3 w-36">Assignee</th>
                <th className="py-2.5 px-3 w-28">Due Date</th>
                <th className="py-2.5 pl-3 w-20 text-center">Priority</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F5F9]">
              {actionItems.map((item, idx) => {
                const isDone = !!completedTasks[idx];
                const priority = (item.priority || 'medium').toLowerCase();

                return (
                  <tr key={idx} className="text-[13px]">
                    <td className="py-3 pr-3">
                      <button
                        id={`action-toggle-${idx}`}
                        title={isDone ? 'Mark incomplete' : 'Mark complete'}
                        onClick={() => toggleTask(idx)}
                        className="text-[#94A3B8] hover:text-[#14B8A6]"
                      >
                        {isDone ? (
                          <CheckCircle2 size={16} className="text-[#14B8A6]" />
                        ) : (
                          <Circle size={16} />
                        )}
                      </button>
                    </td>
                    <td className="py-3 px-3">
                      <span className={`font-medium ${isDone ? 'line-through text-[#94A3B8]' : 'text-[#0F172A]'}`}>
                        {item.task}
                      </span>
                    </td>
                    <td className={`py-3 px-3 font-medium ${isDone ? 'text-[#94A3B8]' : 'text-[#64748B]'}`}>
                      {item.assignee || 'Unassigned'}
                    </td>
                    <td className={`py-3 px-3 font-mono text-[11px] font-semibold ${isDone ? 'text-[#94A3B8]' : 'text-[#64748B]'}`}>
                      {formatDate(item.deadline)}
                    </td>
                    <td className="py-3 pl-3 text-center">
                      <span
                        className={`inline-block w-2 h-2 rounded-full ${priorityColors[priority] || priorityColors.medium}`}
                        title={priority}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
