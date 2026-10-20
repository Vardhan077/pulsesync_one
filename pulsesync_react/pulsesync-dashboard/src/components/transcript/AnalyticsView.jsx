import React from 'react';
import { 
  ResponsiveContainer, 
  PieChart, 
  Pie, 
  Cell, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip, 
  LineChart, 
  Line, 
  CartesianGrid 
} from 'recharts';
import { MessageSquare, Users, Award, Clock } from 'lucide-react';

export default function AnalyticsView({ analytics, summary }) {
  
  // Custom brand-aligned harmonic palette
  const COLORS = ['#14B8A6', '#4F46E5', '#D97706', '#E11D48', '#0284C7'];

  const formatDuration = (seconds) => {
    if (!seconds) return '0s';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  };

  const participationData = analytics.map(a => ({
    name: a.speaker_name || a.speaker,
    value: parseFloat(a.participation_percentage || a.participation || 0)
  }));

  const interruptionsData = analytics.map(a => ({
    name: a.speaker_name || a.speaker,
    interruptions: parseInt(a.interruption_count || a.interruptions || 0)
  }));

  const mapSentimentToScore = (sentiment) => {
    const scores = {
      'Collaborative': 80,
      'Problem Solving': 70,
      'Decisive': 90,
      'Enthusiastic': 95,
      'Positive': 85,
      'Neutral': 60,
      'Concerned': 40
    };
    return scores[sentiment] || 50;
  };

  const sentimentData = (summary?.sentiment_trend || []).map(s => ({
    time: s.timestamp,
    score: mapSentimentToScore(s.sentiment),
    sentiment: s.sentiment
  }));

  return (
    <div className="flex flex-col gap-6">
      
      {/* ── Top Metric Cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 select-none">
        {analytics.map((sp, idx) => (
          <div 
            key={idx} 
            className="rounded-xl border border-[#E5E7EB] bg-white p-5 shadow-sm transition hover:border-[#CBD5E1]"
            style={{ borderLeft: `4px solid ${COLORS[idx % COLORS.length]}` }}
          >
            <div className="flex items-center gap-1.5 text-[9px] uppercase font-extrabold tracking-widest text-[#64748B] mb-2">
              <Users size={12} className="text-[#94A3B8]" />
              Speaker Profile
            </div>
            
            <h4 className="text-sm font-bold text-[#0F172A] mb-3">
              {sp.speaker_name || sp.speaker}
            </h4>

            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-[#64748B] font-medium">Total Talk Time:</span>
                <span className="font-bold text-[#0F172A] font-mono">{formatDuration(sp.talk_time_seconds || sp.talk_time)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#64748B] font-medium">Participation Share:</span>
                <span className="font-bold font-mono" style={{ color: COLORS[idx % COLORS.length] }}>
                  {sp.participation_percentage || sp.participation}%
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#64748B] font-medium">Speech Pace:</span>
                <span className="font-bold text-[#0F172A] font-mono">{sp.words_per_minute} WPM</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#64748B] font-medium">Overlaps / Interruptions:</span>
                <span className={`font-bold font-mono ${sp.interruption_count > 2 ? 'text-[#D97706]' : 'text-[#0F172A]'}`}>
                  {sp.interruption_count || sp.interruptions || 0}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Chart Visualizations ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 select-none">
        
        {/* Participation Pie Chart */}
        <div className="rounded-xl border border-[#E5E7EB] bg-white p-6 shadow-sm h-[360px] flex flex-col">
          <h3 className="text-xs font-bold text-[#0F172A] mb-4 flex items-center gap-2 uppercase tracking-wider">
            <Award size={15} className="text-[#14B8A6]" />
            Speaker Voice Share
          </h3>
          <div className="flex-1 w-full h-[80%]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={participationData}
                  cx="50%"
                  cy="45%"
                  innerRadius={55}
                  outerRadius={80}
                  paddingAngle={4}
                  dataKey="value"
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                >
                  {participationData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip 
                  contentStyle={{ background: '#ffffff', border: '1px solid #E5E7EB', borderRadius: '8px', fontSize: '11px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}
                  itemStyle={{ color: '#0F172A', fontWeight: 'bold' }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Interruptions Bar Chart */}
        <div className="rounded-xl border border-[#E5E7EB] bg-white p-6 shadow-sm h-[360px] flex flex-col">
          <h3 className="text-xs font-bold text-[#0F172A] mb-4 flex items-center gap-2 uppercase tracking-wider">
            <MessageSquare size={15} className="text-[#4F46E5]" />
            Overlaps & Interruptions
          </h3>
          <div className="flex-1 w-full h-[80%]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={interruptionsData} margin={{ top: 10, right: 10, left: -25, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                <XAxis dataKey="name" stroke="#64748B" fontSize={10} fontWeight="bold" />
                <YAxis stroke="#64748B" fontSize={10} allowDecimals={false} fontWeight="bold" />
                <Tooltip 
                  contentStyle={{ background: '#ffffff', border: '1px solid #E5E7EB', borderRadius: '8px', fontSize: '11px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}
                  labelStyle={{ color: '#64748B', fontWeight: 'bold' }}
                  itemStyle={{ color: '#0F172A', fontWeight: 'bold' }}
                />
                <Bar dataKey="interruptions" radius={[4, 4, 0, 0]}>
                  {interruptionsData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* ── Sentiment progression Line Graph ── */}
      {sentimentData.length > 0 && (
        <div className="rounded-xl border border-[#E5E7EB] bg-white p-6 shadow-sm h-[320px] flex flex-col select-none">
          <h3 className="text-xs font-bold text-[#0F172A] mb-4 flex items-center gap-2 uppercase tracking-wider">
            <Clock size={15} className="text-[#D97706]" />
            Conversation Sentiment Progression
          </h3>
          <div className="flex-1 w-full h-[80%]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sentimentData} margin={{ top: 10, right: 20, left: -25, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                <XAxis dataKey="time" stroke="#64748B" fontSize={10} fontWeight="bold" />
                <YAxis domain={[0, 100]} hide />
                <Tooltip 
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const dataPoint = payload[0].payload;
                      return (
                        <div className="bg-white p-3 border border-[#E5E7EB] rounded-lg shadow-sm text-xs">
                          <p className="text-[#94A3B8] font-mono">Timestamp: {dataPoint.time}</p>
                          <p className="text-[#0F172A] font-bold mt-1">
                            Sentiment: <span className="text-[#14B8A6]">{dataPoint.sentiment}</span>
                          </p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Line 
                  type="monotone" 
                  dataKey="score" 
                  stroke="#4F46E5" 
                  strokeWidth={2.5} 
                  activeDot={{ r: 6 }} 
                  dot={{ stroke: '#ffffff', strokeWidth: 1.5, r: 4, fill: '#4F46E5' }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
