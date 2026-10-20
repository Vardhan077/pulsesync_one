import re

path = 'c:/Users/vardh/Desktop/pulsesync_react/pulsesync-dashboard/src/pages/Dashboard.jsx'

with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Hide Topbar in workspace
content = content.replace(
    '<Topbar\n          selectedMeeting={meetingDetails?.meeting}\n          onBack={handleClearSelection}\n          viewMode={viewMode}\n        />',
    '{!selectedMeetingId && (\n          <Topbar\n            selectedMeeting={meetingDetails?.meeting}\n            onBack={handleClearSelection}\n            viewMode={viewMode}\n          />\n        )}'
)

# 2. Empty the stepper title div
content = re.sub(
    r'<div className="w-48 text-left">\s*<h1 className="text-\[16px\] font-semibold text-\[#0F172A\] tracking-tight truncate">\s*\{meetingTitle \|\| "Create source"\}\s*</h1>\s*</div>',
    '<div className="w-48 text-left"></div>',
    content,
    flags=re.DOTALL
)

# 3. Empty the stepper exit button div
content = re.sub(
    r'<div className="w-48 flex items-center justify-end gap-3">\s*\{isSynced && \(\s*<button\s*onClick=\{handleResetCompilation\}\s*className="px-4 py-1\.5 text-\[13px\] font-semibold text-red-600 border border-red-200 bg-red-50 hover:bg-red-100 rounded-md transition"\s*>\s*Reopen\s*</button>\s*\)\}\s*<button\s*onClick=\{handleClearSelection\}\s*className="px-4 py-1\.5 text-\[12px\] font-medium text-\[#0F172A\] border border-\[#E2E8F0\] rounded bg-\[#F8FAFC\] hover:bg-\[#F1F5F9\] transition"\s*>\s*Exit\s*</button>\s*</div>',
    '<div className="w-48 flex items-center justify-end gap-3"></div>',
    content,
    flags=re.DOTALL
)

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
print("Updated Topbar and Stepper.")
