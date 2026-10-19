var response = http.post(
  RECORDER_URL +
    '/' +
    ACTION +
    '?token=' +
    RECORDER_TOKEN +
    '&ms=' +
    (typeof MS === 'undefined' ? 0 : MS),
  { body: '{}' },
)
if (!response.ok) throw new Error('Recorder: ' + response.body)
