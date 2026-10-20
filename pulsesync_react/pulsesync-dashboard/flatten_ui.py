import re

with open('c:/Users/vardh/Desktop/pulsesync_react/pulsesync-dashboard/src/pages/Dashboard.jsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace the Transcript step wrapper
content = content.replace(
    'className="bg-white border border-[#E5E7EB] rounded-2xl shadow-sm p-5 space-y-5"',
    'className="space-y-6"'
)

# Flatten Audio Player container
content = content.replace(
    'className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-4 flex flex-col gap-3"',
    'className="bg-white border-b border-[#F1F5F9] pb-6 mb-6 flex flex-col gap-3"'
)

# Flatten Transcript Editor Container
content = content.replace(
    'className="h-[500px] border border-[#E5E7EB] rounded-xl overflow-hidden bg-white"',
    'className="h-[500px] bg-white"'
)

# Replace the Speakers step wrapper
content = content.replace(
    'className="bg-white border border-[#E5E7EB] rounded-2xl shadow-sm p-6 space-y-4"',
    'className="space-y-4"'
)
content = content.replace(
    'className="flex gap-4 p-4 border border-[#F1F5F9] rounded-xl bg-[#FAFAF9] hover:bg-white hover:border-[#E2E8F0] transition shadow-xs"',
    'className="flex gap-4 py-6 border-b border-[#F1F5F9] bg-white transition"'
)

# Replace the Company step wrapper
content = content.replace(
    'className="bg-white border border-[#E5E7EB] rounded-2xl shadow-sm overflow-hidden"',
    'className=""'
)

# Replace Playbook Template step wrapper
content = content.replace(
    'className={`flex items-start gap-4 p-4 border-2 rounded-xl cursor-pointer transition shadow-sm ${',
    'className={`flex items-start gap-4 p-6 border rounded-[8px] cursor-pointer transition ${'
)

# Replace Review step wrapper
content = content.replace(
    'className="bg-white border border-[#E5E7EB] rounded-2xl p-6 shadow-sm"',
    'className="bg-white border border-[#E2E8F0] rounded-[8px] p-6"'
)
content = content.replace(
    'className="bg-white border border-[#E5E7EB] rounded-2xl p-6 shadow-sm space-y-5"',
    'className="bg-white border border-[#E2E8F0] rounded-[8px] p-6 space-y-5"'
)

# Sync to Systems
content = content.replace(
    'className="bg-white border border-[#E5E7EB] rounded-2xl p-6 shadow-sm space-y-6"',
    'className="bg-white space-y-6"'
)
content = content.replace(
    'className={`flex items-center gap-3 p-4 border rounded-xl cursor-pointer transition',
    'className={`flex items-center gap-3 p-6 border rounded-[8px] cursor-pointer transition'
)

# Final header alignment and layout width fix (optional, just to be sure)
# Make the layout full-width but constrained to max-w-5xl
content = content.replace(
    'className="w-full max-w-[800px] flex flex-col px-6"',
    'className="w-full max-w-5xl flex flex-col px-8"'
)

with open('c:/Users/vardh/Desktop/pulsesync_react/pulsesync-dashboard/src/pages/Dashboard.jsx', 'w', encoding='utf-8') as f:
    f.write(content)
print('UI successfully flattened.')
