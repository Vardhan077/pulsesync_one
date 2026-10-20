import requests
import os

audio_path = os.path.abspath('backend/uploads/meeting_1788089519824_mcvdavl.mp3')
print('Audio exists:', os.path.exists(audio_path), audio_path)

res = requests.post('http://localhost:8000/process', json={
    'audio_path': audio_path,
    'meeting_id': '807a25e9-1f7f-487e-b877-f596520fe977',
    'schema_fields': [],
    'skip_enrichment': True
})
print('Status Code:', res.status_code)
if res.status_code == 200:
    data = res.json()
    print('Segments:', len(data.get('segments', [])))
    print('Speakers:', len(data.get('speakers', [])))
else:
    print('Error:', res.text)
