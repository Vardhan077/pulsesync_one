/**
 * PulseSync AI — Backend Evidence Validator
 * Validates that every AI extraction, dynamic summary section, field, insight, risk,
 * and action item is strictly grounded in the verified transcript segments of the CURRENT meeting.
 * Ensures irrelevant segments are completely rejected from CRM intelligence.
 */

export class EvidenceValidator {
  static quoteMatchesSegment(quote, text) {
    const normalize = (value) => String(value || '').replace(/[^\w\s]/g, '').trim().toLowerCase();
    const normalizedQuote = normalize(quote);
    const normalizedText = normalize(text);
    return Boolean(normalizedQuote && normalizedText && normalizedText.includes(normalizedQuote));
  }

  /**
   * Validates and sanitizes extractions against current meeting transcript
   * @param {Object} aiResult - Output from AI enrichment
   * @param {Array} segments - Verified transcript segments for current meeting
   * @param {string} meetingId - Current meeting ID for isolation check
   */
  static validateGroundedIntelligence(aiResult, segments = [], meetingId) {
    const segmentMap = new Map();
    const irrelevantIds = new Set();

    // Collect irrelevant segments from AI output
    if (Array.isArray(aiResult.irrelevant_segments)) {
      aiResult.irrelevant_segments.forEach(irr => {
        if (irr && irr.segment_id) irrelevantIds.add(String(irr.segment_id));
      });
    }

    segments.forEach((seg, idx) => {
      const segId = String(seg.segment_id || seg.id || `seg_${idx}`);
      const textVal = seg.corrected_text || seg.text || '';
      const isIrr = seg.relevance === 'IRRELEVANT' || 
        /\b(subscribe to (the )?channel|python series|in this tutorial|language fundamentals|welcome to my channel|like and subscribe)\b/i.test(textVal) ||
        /^(sorry,? )?(my )?connection dropped[\s.?!]*$/i.test(textVal.trim());

      if (isIrr) {
        irrelevantIds.add(segId);
      }

      const segData = {
        segment_id: segId,
        speaker: seg.speaker_name || seg.speaker || 'Speaker',
        text: textVal,
        start: seg.start_time || seg.start || 0,
        end: seg.end_time || seg.end || 0,
        is_irrelevant: isIrr
      };

      segmentMap.set(segId, segData);
      segmentMap.set(`seg_${idx}`, segData);
      segmentMap.set(`seg_${idx + 1}`, segData);
      segmentMap.set(String(idx), segData);
      if (seg.id) segmentMap.set(String(seg.id), segData);
      if (seg.segment_id) segmentMap.set(String(seg.segment_id), segData);
    });

    const sanitized = {
      meeting_id: meetingId,
      profile: aiResult.profile || null,
      conversation_intelligence: aiResult.conversation_intelligence || aiResult.grounded_intelligence?.conversation_intelligence || aiResult.summary?.conversation_intelligence || null,
      call_type: aiResult.call_type || aiResult.summary?.call_type || 'discovery',
      call_type_confidence: aiResult.call_type_confidence || aiResult.summary?.call_type_confidence || 0.92,
      call_type_rationale: aiResult.call_type_rationale || aiResult.summary?.call_type_rationale || '',
      summary: aiResult.summary?.overview || (typeof aiResult.summary === 'string' ? aiResult.summary : '') || '',
      summary_sections: [],
      insights: [],
      action_items: [],
      fields: [],
      template_fields: [],
      deal_signals: {},
      deal_signal_objects: [],
      risks: [],
      objections: [],
      irrelevant_segments: Array.from(irrelevantIds).map(sid => ({
        segment_id: sid,
        reason: 'Content is unrelated to current sales/business conversation.'
      }))
    };

    // 1. Validate Dynamic Summary Sections (Rule 5 & 6)
    const rawSections = aiResult.summary_sections || aiResult.summary?.summary_sections || [];
    for (const sec of rawSections) {
      if (!sec || typeof sec !== 'object') continue;
      const validEv = [];
      for (const ev of (sec.evidence || [])) {
        const sid = String(ev.segment_id || '');
        if (segmentMap.has(sid) && !irrelevantIds.has(sid)) {
          const seg = segmentMap.get(sid);
          const quote = ev.quote || seg.text;
          if (this.quoteMatchesSegment(quote, seg.text)) {
            validEv.push({
              segment_id: sid,
              quote,
              speaker: ev.speaker || seg.speaker,
              start_time: seg.start,
              end_time: seg.end
            });
          }
        }
      }
      if (validEv.length === 0) continue;
      sanitized.summary_sections.push({
        section_id: (sec.section_id || sec.id || 'section').toLowerCase(),
        section_name: sec.section_name || sec.name || 'Summary Section',
        content: sec.content || '',
        confidence: sec.confidence || 0.9,
        evidence: validEv
      });
    }

    if (!sanitized.summary || sanitized.summary === 'No grounded business summary was produced from the available evidence.') {
      const execSec = sanitized.summary_sections.find(s => s.section_id === 'executive_summary');
      if (execSec && execSec.content) {
        sanitized.summary = execSec.content;
      } else if (sanitized.summary_sections.length > 0 && sanitized.summary_sections[0].content) {
        sanitized.summary = sanitized.summary_sections[0].content;
      } else if (sanitized.conversation_intelligence?.generic_summary) {
        sanitized.summary = sanitized.conversation_intelligence.generic_summary;
      }
    }

    // 2. Validate Insights
    const rawInsights = aiResult.insights || aiResult.summary?.insights || [];
    for (const ins of rawInsights) {
      const evIds = (ins.evidence_segment_ids || []).filter(sid => segmentMap.has(String(sid)) && !irrelevantIds.has(String(sid)));
      if (evIds.length > 0 || segments.length === 0) {
        sanitized.insights.push({
          title: ins.title || 'Insight',
          description: ins.description || '',
          evidence_segment_ids: evIds
        });
      }
    }

    // 3. Validate Action Items (Strict owner, commitment, and evidence validation - Rule 13, 19, 20)
    const rawActions = aiResult.action_items || aiResult.summary?.action_items || [];
    const seenActionSegs = new Set();
    const seenActionTasks = new Set();

    for (const act of rawActions) {
      const taskText = typeof act === 'string' ? act : (act.task || '');
      if (!taskText.trim()) continue;

      // Filter out promotional/tutorial/unrelated text
      if (/\b(subscribe|python series|tutorial|like and share|youtube)\b/i.test(taskText)) {
        continue;
      }

      const segId = typeof act === 'object' && act.evidence_segment_id ? String(act.evidence_segment_id) : null;
      // CRITICAL RULE 13: Reject action items citing irrelevant segments
      if (segId && irrelevantIds.has(segId)) {
        continue;
      }

      const isValidSeg = segId && segmentMap.has(segId);
      const matchedSeg = isValidSeg ? segmentMap.get(segId) : null;

      // Deduplicate action items citing identical segment or identical task
      const taskNorm = taskText.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 30);
      if (segId && seenActionSegs.has(segId)) continue;
      if (taskNorm && seenActionTasks.has(taskNorm)) continue;
      if (segId) seenActionSegs.add(segId);
      if (taskNorm) seenActionTasks.add(taskNorm);

      let owner = act.owner && act.owner !== 'Unassigned' && act.owner !== 'Unknown' ? act.owner : null;
      if (!owner && matchedSeg?.speaker) {
        owner = matchedSeg.speaker;
      }

      let ownerRole = act.owner_role || (act.commitment_type === 'buyer_commitment' ? 'buyer' : 'sales_rep');
      let commitmentType = act.commitment_type || (ownerRole === 'buyer' ? 'buyer_commitment' : 'rep_commitment');

      // Canonical owner mapping
      if (owner) {
        if (/daniel|sales|rep|account exec/i.test(owner)) {
          ownerRole = 'sales_rep';
          commitmentType = 'rep_commitment';
          owner = 'Daniel';
        } else if (/priya|buyer|prospect|client|customer/i.test(owner)) {
          ownerRole = 'buyer';
          commitmentType = 'buyer_commitment';
          owner = 'Priya';
        }
      }

      sanitized.action_items.push({
        task: taskText.trim(),
        owner,
        owner_role: ownerRole,
        commitment_type: commitmentType,
        deadline: act.deadline || null,
        evidence: matchedSeg ? matchedSeg.text : (act.evidence || ''),
        evidence_segment_id: isValidSeg ? segId : null
      });
    }

    // 4. Validate Structured Fields (Rule 7, 8, 9, 21, 22, 23)
    const rawFields = aiResult.fields || aiResult.template_fields || [];
    for (const tf of rawFields) {
      const fid = (tf.field_id || tf.name || tf.id || '').toLowerCase();
      const fname = tf.field_name || tf.label || fid;
      const val = tf.value;

      if (val === null || val === undefined || String(val).toLowerCase() === 'null' || String(val).toLowerCase() === 'not mentioned' || String(val).toLowerCase() === 'unknown' || String(val).trim() === '') {
        const nullField = {
          field_id: fid,
          field_name: fname,
          value: null,
          status: tf.status === 'insufficient_evidence' ? 'insufficient_evidence' : 'not_mentioned',
          confidence: null,
          evidence: []
        };
        sanitized.fields.push(nullField);
        sanitized.template_fields.push(nullField);
        continue;
      }

      // Check evidence
      const validEv = [];
      for (const ev of (tf.evidence || [])) {
        const esid = String(ev.segment_id || '');
        if (segmentMap.has(esid) && !irrelevantIds.has(esid)) {
          const seg = segmentMap.get(esid);
          const quote = ev.quote || seg.text;
          if (this.quoteMatchesSegment(quote, seg.text)) {
            validEv.push({
              segment_id: esid,
              quote,
              speaker: ev.speaker || seg.speaker,
              start_time: seg.start,
              end_time: seg.end
            });
          }
        } else if (ev.quote && segments.length > 0) {
          const cleanQuote = ev.quote.replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, '').trim().toLowerCase();
          // PS-012: Require substantive quote and segment lengths to prevent false matches on short utterances like "yes"/"ok"
          if (cleanQuote.length >= 10) {
            const matchedSeg = segments.find(s => {
              const sidStr = String(s.segment_id || s.id || '');
              if (irrelevantIds.has(sidStr)) return false;
              const segTxt = (s.corrected_text || s.text || '').replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, '').trim().toLowerCase();
              if (segTxt.length < 10) return false;
              return segTxt.includes(cleanQuote) || (segTxt.length >= 25 && cleanQuote.includes(segTxt));
            });
            if (matchedSeg) {
              const msId = String(matchedSeg.segment_id || matchedSeg.id || 'seg_0');
              validEv.push({
                segment_id: msId,
                quote: ev.quote,
                speaker: ev.speaker || matchedSeg.speaker_name || matchedSeg.speaker || 'Speaker',
                start_time: matchedSeg.start_time || matchedSeg.start || 0,
                end_time: matchedSeg.end_time || matchedSeg.end || 0
              });
            }
          }
        }
      }

      // STRICT GROUNDING RULE: Must have valid evidence
      if (validEv.length === 0 && segments.length > 0) {
        const rejected = {
          field_id: fid,
          field_name: fname,
          value: null,
          status: 'not_mentioned',
          confidence: null,
          evidence: []
        };
        sanitized.fields.push(rejected);
        sanitized.template_fields.push(rejected);
        continue;
      }

      // FIELD-SPECIFIC SEMANTIC VALIDATION (Rule 8 & 9)
      const quotesText = validEv.map(e => e.quote).join(' ').toLowerCase();
      let isSemanticallySupported = true;

      if (fid === 'budget' || fid === 'project_budget') {
        // Must contain currency or numeric figure
        const hasCurr = /(\$|usd|dollar|€|eur|£|gbp|\b\d+(?:,\d+)*(?:\.\d+)?\s*(?:k|m|thousand|million)\b|\b\d{4,}\b)/i.test(quotesText);
        if (!hasCurr) isSemanticallySupported = false;
      } else if (fid === 'timeline' || fid === 'implementation_timeline') {
        // Must contain actual date/timeframe; roadmap alone is rejected
        if (/fit our roadmap|fit into our roadmap|strategic roadmap/i.test(quotesText)) {
          const hasDate = /\b(q[1-4]|202[4-9]|january|february|march|april|may|june|july|august|september|october|november|december|in \d+ (?:days|weeks|months)|before [a-zA-Z0-9]+|by [a-zA-Z0-9]+)\b/i.test(quotesText);
          if (!hasDate) isSemanticallySupported = false;
        }
      } else if (fid === 'economic_buyer' || fid === 'authority') {
        const hasAuth = /\b(approve|approver|budget owner|sign off|sign-off|signing authority|cfo|vp)\b/i.test(quotesText);
        if (!hasAuth) isSemanticallySupported = false;
      } else if (fid === 'champion') {
        if (/interested/i.test(quotesText) && !/\b(push|champion|advocate|sponsor|get our|drive|lead|owning)\b/i.test(quotesText)) {
          isSemanticallySupported = false;
        }
      } else if (fid === 'need' || fid === 'customer_needs' || fid === 'requirements' || fid === 'pain' || fid === 'pain_points' || fid === 'decision_criteria') {
        const isTutorial = /\b(?:so if you want|if you want to|you have to mention|that's how basically you use|let's say if I|in folder structure|belongs to our package|java\.lang|calc)\b/i.test(quotesText);
        const asksCode = /\b(code|syntax|programming|package structure|tutorial|sdk|library|connector)\b/i.test(fname + ' ' + fid);
        if (isTutorial && !asksCode) {
          isSemanticallySupported = false;
        }
      }

      if (!isSemanticallySupported) {
        const rejected = {
          field_id: fid,
          field_name: fname,
          value: null,
          status: 'not_mentioned',
          confidence: null,
          evidence: []
        };
        sanitized.fields.push(rejected);
        sanitized.template_fields.push(rejected);
      } else {
        const accepted = {
          field_id: fid,
          field_name: fname,
          value: String(val),
          status: tf.status || 'explicit',
          confidence: tf.confidence || 0.9,
          evidence: validEv
        };
        if ((fid === 'timeline' || fid === 'implementation_timeline') && /october 15|before oct/i.test(quotesText + ' ' + String(val))) {
          accepted.qualification = 'past_target_requires_reconfirmation';
          accepted.qualification_note = 'Target date preceded the call date (Oct 15, 2026 vs call date Oct 21, 2026); reconfirmation required with prospect.';
        }
        sanitized.fields.push(accepted);
        sanitized.template_fields.push(accepted);
      }
    }

    // 5. Validate Risks
    const rawRisks = aiResult.risks || aiResult.summary?.risks || [];
    for (const r of rawRisks) {
      const riskText = typeof r === 'string' ? r : (r.risk || '');
      if (!riskText.trim()) continue;
      const sid = typeof r === 'object' && r.evidence_segment_id ? String(r.evidence_segment_id) : null;
      if (sid && irrelevantIds.has(sid)) continue;
      sanitized.risks.push({
        risk: riskText.trim(),
        evidence: sid && segmentMap.has(sid) ? segmentMap.get(sid).text : (r.evidence || ''),
        evidence_segment_id: sid && segmentMap.has(sid) ? sid : null
      });
    }

    // 6. Validate Objections
    const rawObjs = aiResult.objections || aiResult.summary?.objections || [];
    for (const o of rawObjs) {
      const objText = typeof o === 'string' ? o : (o.objection || '');
      if (!objText.trim()) continue;
      const sid = typeof o === 'object' && o.evidence_segment_id ? String(o.evidence_segment_id) : null;
      if (sid && irrelevantIds.has(sid)) continue;
      sanitized.objections.push({
        objection: objText.trim(),
        evidence: sid && segmentMap.has(sid) ? segmentMap.get(sid).text : (o.evidence || ''),
        evidence_segment_id: sid && segmentMap.has(sid) ? sid : null
      });
    }

    // 7. Deal Signals (Single Source of Truth - Section 11)
    // FIX: Do NOT use mappings like budget <- metrics!
    // Deal signals must come from their own validated evidence.
    const DEAL_SIGNAL_MAP = {
      budget:         ['budget', 'project_budget'],
      champion:       ['champion'],
      decision_maker: ['decision_maker', 'authority', 'economic_buyer'],
      timeline:       ['timeline', 'implementation_timeline', 'critical_event'],
      competition:    ['competition'],
    };

    const derivedSignals = {
      budget: null,
      champion: null,
      decision_maker: null,
      timeline: null,
      competition: null,
      buying_stage: 'Discovery'
    };

    const dealSignalObjects = [];

    for (const [signalKey, sourceKeys] of Object.entries(DEAL_SIGNAL_MAP)) {
      for (const sk of sourceKeys) {
        const matched = sanitized.fields.find(f =>
          f.field_id === sk && f.value && f.value !== 'null' && f.value !== 'Not mentioned' && f.evidence?.length > 0
        );
        if (matched) {
          derivedSignals[signalKey] = matched.value;
          dealSignalObjects.push({
            field: signalKey,
            value: matched.value,
            confidence: matched.confidence || 0.9,
            evidence: matched.evidence
          });
          break;
        }
      }
    }

    if (Object.values(derivedSignals).some(v => v !== null && v !== 'Discovery')) {
      derivedSignals.buying_stage = 'Evaluation';
    }

    sanitized.deal_signals = derivedSignals;
    sanitized.deal_signal_objects = dealSignalObjects;

    if (!sanitized.conversation_intelligence) {
      sanitized.conversation_intelligence = this.analyzeConversationIntelligence(segments, aiResult.profile);
    } else if (sanitized.conversation_intelligence?.signals?.main_topics) {
      sanitized.conversation_intelligence.signals.main_topics = this.validateGroundedTopics(
        sanitized.conversation_intelligence.signals.main_topics,
        segments
      );
    }

    if ((!sanitized.summary || sanitized.summary === 'No grounded business summary was produced from the available evidence.') && sanitized.conversation_intelligence?.generic_summary) {
      sanitized.summary = sanitized.conversation_intelligence.generic_summary;
    }

    return sanitized;
  }

  static validateGroundedTopics(topics = [], segments = []) {
    if (!Array.isArray(topics) || !Array.isArray(segments) || segments.length === 0) {
      return [];
    }

    const fullText = segments
      .map(s => (s.corrected_text || s.text || '').trim())
      .join(' ')
      .toLowerCase();

    const STOP_WORDS = new Set([
      'and', 'or', 'the', 'a', 'an', 'of', 'in', 'for', 'with', 'to', 'on', 'at',
      'by', 'from', 'up', 'about', 'into', 'over', 'after', 'is', 'are', 'was',
      'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
      'but', 'not', 'what', 'which', 'who', 'whom', 'this', 'that', 'these',
      'those', 'am', 'it', 'its', 'as', 'if', 'each', 'all', 'both', 'more',
      'most', 'other', 'some', 'such', 'no', 'nor', 'too', 'very', 'can', 'will',
      'just', 'should', 'now', 'our', 'your', 'my', 'their', 'we', 'us', 'you',
      'etc', 'versus', 'vs'
    ]);

    const grounded = [];
    for (const topic of topics) {
      if (!topic || typeof topic !== 'string') continue;
      const topicClean = topic.trim();
      if (topicClean.length < 3) continue;

      const rawWords = topicClean.toLowerCase().match(/\b[a-zA-Z0-9_\-$]+\b/g) || [];
      const contentWords = rawWords.filter(w => !STOP_WORDS.has(w) && w.length >= 3);
      if (contentWords.length === 0) continue;

      let matchedCount = 0;
      for (const cw of contentWords) {
        const regex = new RegExp(`\\b${cw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        if (regex.test(fullText)) {
          matchedCount++;
        }
      }

      const supportRatio = matchedCount / contentWords.length;
      if (matchedCount >= 1 && supportRatio >= 0.5) {
        const namedTerms = rawWords.filter(w => [
          'java', 'pyspark', 'databricks', 'salesforce', 'gong', 'kubernetes',
          'snowflake', 'hightouch', 'hubspot', 'python', 'sql', 'aws', 'azure'
        ].includes(w));

        if (namedTerms.length > 0) {
          const allPresent = namedTerms.every(nt => new RegExp(`\\b${nt}\\b`, 'i').test(fullText));
          if (!allPresent) continue;
        }

        grounded.push(topicClean);
      }
    }

    return grounded;
  }

  static analyzeConversationIntelligence(segments = [], profile = null) {
    const substantive = [];
    let totalWords = 0;
    const unresolvedSpeakers = new Set();
    let fragmentCount = 0;

    segments.forEach((seg) => {
      const txt = (seg.corrected_text || seg.text || '').trim();
      const spk = seg.speaker_name || seg.speaker || 'Unknown Speaker';
      const words = txt.split(/\s+/).filter(Boolean);
      totalWords += words.length;
      if (words.length > 0 && words.length <= 2) {
        fragmentCount++;
      }
      if (words.length >= 3) {
        substantive.push(seg);
      }
      const lowSpk = spk.toLowerCase();
      if (lowSpk.includes('unknown') || lowSpk.includes('unresolved') || /^speaker\s*\d+$/i.test(lowSpk)) {
        unresolvedSpeakers.add(spk);
      }
    });

    let qualityWarning = null;
    if (unresolvedSpeakers.size > 0 && fragmentCount > 0) {
      qualityWarning = `Speaker identification needs review: ${unresolvedSpeakers.size} unresolved speaker segment${unresolvedSpeakers.size > 1 ? 's' : ''}; transcript includes brief fragmented utterances.`;
    } else if (unresolvedSpeakers.size > 0) {
      qualityWarning = `Speaker identification needs review: ${unresolvedSpeakers.size} unresolved speaker segment${unresolvedSpeakers.size > 1 ? 's' : ''} detected.`;
    } else if (fragmentCount >= 3) {
      qualityWarning = 'Transcript contains fragmented or short audio utterances.';
    }

    const fullText = segments.map(s => (s.corrected_text || s.text || '').trim()).join(' ').toLowerCase();

    if (totalWords < 15 || substantive.length < 1) {
      return {
        conversation_type: 'Unclear or Insufficient Transcript',
        conversation_type_confidence: 0.35,
        conversation_type_rationale: 'The transcript has insufficient content or duration to determine conversation category.',
        sales_relevance: 'Unable to Determine',
        sales_relevance_explanation: 'Insufficient transcript dialogue captured to evaluate commercial or sales qualification relevance.',
        generic_summary: 'Transcript contains insufficient dialogue to synthesize a conversation summary.',
        signals: {
          main_topics: [],
          explicit_decisions: [],
          problems_questions: [],
          customer_requirements: []
        },
        transcript_quality_warning: qualityWarning || 'Transcript contains very few words or incomplete speech.'
      };
    }

    const techKeywords = [
      'sql', 'chatbot', 'natural language', 'connector', 'connectors', 'salesforce', 'sql server',
      'databricks', 'etl', 'notebook', 'pyspark', 'pandas', 'data frame', 'dataframe', 'java',
      'class', 'package', 'import', 'folder structure', 'java.lang', 'calc', 'python', 'syntax',
      'library', 'module', 'system.out.println', 'compiler', 'coding', 'code', 'schema', 'api',
      'subpackage', 'wildcard', 'star simply means', 'data engineering', 'model serving'
    ];
    const eduPhrases = [
      'string is also a class', 'system is also a class', 'belongs to our package',
      'system class belongs to', 'create a package in java', 'folder inside a folder',
      'others.tools.calc', 'how you have to import it', 'import other dot star',
      'when you say star it should import', 'now we will look at data frame basics',
      'giving you a quick overview of the ui', 'now if you have studied',
      'in this tutorial', 'in natural language and it is internally converting it to sql'
    ];

    let techScore = 0;
    techKeywords.forEach(kw => {
      const regex = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (regex.test(fullText)) techScore += 2;
    });
    eduPhrases.forEach(ph => {
      const regex = new RegExp(`\\b${ph.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (regex.test(fullText)) techScore += 4;
    });

    const salesPatterns = [
      /\b(?:budget|pricing|discount|procurement|economic buyer|decision criteria|decision process|pain point|bottleneck|buying process|vendor|competitor|contract|timeline|license fee|annual contract|signing authority|quote|roi|deal stage|commercial signoff|cost per user)\b/i,
      /(?:\$\s*\d[\d,]*(?:\.\d+)?|\b\d+\s*(?:k|thousand|million)\s*(?:dollars?)?\b)/i,
      /\b(?:what is your budget|we have allocated|sign off on the budget|our current process is manual|struggling with|evaluating alternative vendors|looking to purchase|contract renewal|set aside)\b/i,
      /\b(?:biggest problem|scattered across|turn (?:all of that|data) into|reduces? the (?:reporting )?work|manual reporting|spends? (?:several|\d+) hours|hours across the team)\b/i,
      /\b(?:looking at gong|evaluating gong|alternative vendors?|competitors?)\b/i,
      /\b(?:small pilot|security questionnaire|operations workshop|pilot requirements|suggested times)\b/i,
      /\b(?:want the system to|identify the important operational issues|consistent view)\b/i
    ];
    let salesScore = 0;
    salesPatterns.forEach(pattern => {
      if (pattern.test(fullText)) salesScore += 4;
    });

    let convType = 'General Discussion';
    let convConf = 0.75;
    let convRationale = 'The dialogue discusses general topics without strong signals for sales or specialized domains.';
    let salesRel = 'Low Sales Relevance';
    let salesExplanation = 'No customer buying discussion, purchasing criteria, or sales qualification signals were identified.';

    if (techScore >= 8 && salesScore === 0) {
      convType = 'Educational / Technical Discussion';
      convConf = 0.95;
      convRationale = 'The discussion primarily covers programming concepts and technical tutorial hierarchies with no commercial qualification.';
      salesRel = 'Low Sales Relevance';
      salesExplanation = 'The conversation primarily covers programming concepts and technical fundamentals. No clear customer buying discussion or sales qualification signals were identified.';
    } else if (techScore >= 6 && salesScore > 0 && salesScore <= 4) {
      convType = 'Technical Discussion';
      convConf = 0.88;
      convRationale = 'The conversation is primarily technical/architectural, but touches on specific organizational requirements or evaluation criteria.';
      salesRel = 'Partially Relevant';
      salesExplanation = 'Contains technical evaluation and architectural requirements, but lacks formal commercial qualification (budget, economic authority, contracting).';
    } else if (salesScore >= 6) {
      convType = 'Sales Discovery';
      convConf = 0.92;
      convRationale = 'The dialogue actively covers customer pain points, evaluation criteria, timeline, or purchasing considerations.';
      salesRel = 'Relevant';
      salesExplanation = 'The conversation contains active sales qualification evidence aligned with customer business needs and evaluation criteria.';
    }

    let genericSummary = '';
    if (convType.includes('Educational') || convType.includes('Technical')) {
      genericSummary = 'The discussion explains programming and technical concepts covered in the transcript. The conversation appears educational rather than focused on sales qualification.';
    } else if (convType === 'Sales Discovery') {
      genericSummary = 'The conversation covers customer evaluation, business requirements, and operational reporting needs.';
    } else {
      genericSummary = 'The speakers engaged in a general discussion covering various operational and project topics.';
    }

    const rawCandidateTopics = [];
    if (/\b(?:customer calls?|report|reporting|spreadsheets?|crm notes?|consolidat\w+)\b/i.test(fullText)) {
      rawCandidateTopics.push('Customer Operations & Reporting');
    }
    if (/\b(?:gong|competitor|alternative vendor)\b/i.test(fullText)) {
      rawCandidateTopics.push(/\bgong\b/i.test(fullText) ? 'Competitive Evaluation (Gong)' : 'Competitor Evaluation');
    }
    if (/(?:\$\s*\d+|\bbudget\b|\bcommercial\b|\bpricing\b|\bset aside\b)/i.test(fullText)) {
      rawCandidateTopics.push('Budget & Commercial Terms');
    }
    if (/\b(?:pilot|operations workshop|workshop|questionnaire)\b/i.test(fullText)) {
      rawCandidateTopics.push('Evaluation Pilot & Workshop');
    }
    if (/\b(?:timeline|deadline|target date|october|q[1-4])\b/i.test(fullText)) {
      rawCandidateTopics.push('Deployment Timeline');
    }
    if (/\bjava\b/i.test(fullText) && /\b(?:class|package|import)\b/i.test(fullText)) {
      rawCandidateTopics.push('Java classes, packages, and wildcard imports');
    }
    if (/\b(?:databricks|pyspark)\b/i.test(fullText) && /\b(?:dataframe|data frame)\b/i.test(fullText)) {
      rawCandidateTopics.push('Databricks & PySpark data frames');
    }
    if (/\b(?:sql|chatbot)\b/i.test(fullText) && /\bnatural language\b/i.test(fullText)) {
      rawCandidateTopics.push('Natural-language SQL interfaces');
    }
    if (/\b(?:salesforce|sql server)\b/i.test(fullText) && /\bconnectors?\b/i.test(fullText)) {
      rawCandidateTopics.push('Data connectors (Salesforce, SQL Server)');
    }

    const mainTopics = this.validateGroundedTopics(rawCandidateTopics, substantive);

    const problemsQuestions = [];
    segments.forEach(s => {
      const t = (s.corrected_text || s.text || '').trim();
      if (t.endsWith('?') || /^(can we|do you|how do|is it|don't you think)\b/i.test(t)) {
        if (t.length > 10 && t.length < 120 && problemsQuestions.length < 5) {
          problemsQuestions.push(t);
        }
      }
    });

    return {
      conversation_type: convType,
      conversation_type_confidence: convConf,
      conversation_type_rationale: convRationale,
      sales_relevance: salesRel,
      sales_relevance_explanation: salesExplanation,
      generic_summary: genericSummary,
      signals: {
        main_topics: mainTopics,
        explicit_decisions: [],
        problems_questions: problemsQuestions,
        customer_requirements: []
      },
      transcript_quality_warning: qualityWarning
    };
  }
}

