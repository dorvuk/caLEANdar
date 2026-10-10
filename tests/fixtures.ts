export const wrap = (events: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Tests//EN\r\n${events}\r\nEND:VCALENDAR`;
export const event = (uid: string, start: string, recurrence = '', extra = '') => `BEGIN:VEVENT\r\nUID:${uid}\r\nDTSTART;TZID=Europe/Ljubljana:${start}T130000\r\nDTEND;TZID=Europe/Ljubljana:${start}T150000\r\nSUMMARY:Course 1\r\nLOCATION:P01\r\n${recurrence}${extra}END:VEVENT`;
export const recurring = wrap(event('fridays', '20261002', 'RRULE:FREQ=WEEKLY;COUNT=8\r\n'));
export const individual = wrap(['20261002', '20261009', '20261016', '20261023', '20261030', '20261106', '20261113', '20261120'].map((d, i) => event(`single-${i}`, d)).join('\r\n'));
