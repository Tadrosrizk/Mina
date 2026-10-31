// The Protestant/Orthodox-common 66-book canon: book names (Arabic), testament, section, chapter count, and a strict reference parser.
// This is the LOCAL, deterministic part of reference checking: the book must exist, the chapter must exist, the verse must be plausible.
// It is NOT a Bible text database: whether a given verse really says what the question claims is checked by the separate AI verification pass.
// deno-lint-ignore-file no-explicit-any
export type Testament = 'old' | 'new';
export type Book = { name: string; testament: Testament; section: string; chapters: number; maxVerse?: number; aliases?: string[] };

export const SECTIONS: { id: string; label: string; testament: Testament }[] = [
  { id: 'law', label: 'الشريعة (التوراة)', testament: 'old' },
  { id: 'history', label: 'الأسفار التاريخية', testament: 'old' },
  { id: 'wisdom', label: 'أسفار الحكمة والشعر', testament: 'old' },
  { id: 'prophets', label: 'الأنبياء', testament: 'old' },
  { id: 'gospels', label: 'الأناجيل', testament: 'new' },
  { id: 'acts', label: 'أعمال الرسل', testament: 'new' },
  { id: 'epistles', label: 'الرسائل', testament: 'new' },
  { id: 'revelation', label: 'الرؤيا', testament: 'new' },
];

const B = (name: string, testament: Testament, section: string, chapters: number, extra: Partial<Book> = {}): Book => ({ name, testament, section, chapters, ...extra });
export const BOOKS: Book[] = [
  B('تكوين', 'old', 'law', 50, { aliases: ['التكوين'] }), B('خروج', 'old', 'law', 40, { aliases: ['الخروج'] }), B('لاويين', 'old', 'law', 27, { aliases: ['اللاويين'] }),
  B('عدد', 'old', 'law', 36, { aliases: ['العدد'] }), B('تثنية', 'old', 'law', 34, { aliases: ['التثنية', 'تثنيه الاشتراع'] }),
  B('يشوع', 'old', 'history', 24), B('قضاة', 'old', 'history', 21, { aliases: ['القضاة'] }), B('راعوث', 'old', 'history', 4),
  B('1 صموئيل', 'old', 'history', 31, { aliases: ['صموئيل الاول'] }), B('2 صموئيل', 'old', 'history', 24, { aliases: ['صموئيل الثاني'] }),
  B('1 ملوك', 'old', 'history', 22, { aliases: ['الملوك الاول', 'ملوك الاول'] }), B('2 ملوك', 'old', 'history', 25, { aliases: ['الملوك الثاني', 'ملوك الثاني'] }),
  B('1 أخبار الأيام', 'old', 'history', 29, { aliases: ['اخبار الايام الاول'] }), B('2 أخبار الأيام', 'old', 'history', 36, { aliases: ['اخبار الايام الثاني'] }),
  B('عزرا', 'old', 'history', 10), B('نحميا', 'old', 'history', 13), B('أستير', 'old', 'history', 10, { aliases: ['استير'] }),
  B('أيوب', 'old', 'wisdom', 42), B('مزمور', 'old', 'wisdom', 150, { aliases: ['المزامير', 'مزامير', 'المزمور'] }), B('أمثال', 'old', 'wisdom', 31, { aliases: ['الامثال', 'سفر الامثال'] }),
  B('جامعة', 'old', 'wisdom', 12, { aliases: ['الجامعة'] }), B('نشيد الأنشاد', 'old', 'wisdom', 8, { aliases: ['نشيد الانشاد', 'نشيد'] }),
  B('إشعياء', 'old', 'prophets', 66, { aliases: ['اشعياء', 'اشعيا'] }), B('إرميا', 'old', 'prophets', 52, { aliases: ['ارميا'] }), B('مراثي إرميا', 'old', 'prophets', 5, { aliases: ['المراثي', 'مراثي'] }),
  B('حزقيال', 'old', 'prophets', 48), B('دانيال', 'old', 'prophets', 12), B('هوشع', 'old', 'prophets', 14), B('يوئيل', 'old', 'prophets', 3), B('عاموس', 'old', 'prophets', 9),
  B('عوبديا', 'old', 'prophets', 1, { maxVerse: 21 }), B('يونان', 'old', 'prophets', 4), B('ميخا', 'old', 'prophets', 7), B('ناحوم', 'old', 'prophets', 3), B('حبقوق', 'old', 'prophets', 3),
  B('صفنيا', 'old', 'prophets', 3), B('حجي', 'old', 'prophets', 2), B('زكريا', 'old', 'prophets', 14), B('ملاخي', 'old', 'prophets', 4),
  B('متى', 'new', 'gospels', 28, { aliases: ['انجيل متي'] }), B('مرقس', 'new', 'gospels', 16), B('لوقا', 'new', 'gospels', 24), B('يوحنا', 'new', 'gospels', 21),
  B('أعمال الرسل', 'new', 'acts', 28, { aliases: ['اعمال الرسل', 'اعمال'] }),
  B('رومية', 'new', 'epistles', 16), B('1 كورنثوس', 'new', 'epistles', 16, { aliases: ['كورنثوس الاولي'] }), B('2 كورنثوس', 'new', 'epistles', 13, { aliases: ['كورنثوس الثانيه'] }),
  B('غلاطية', 'new', 'epistles', 6), B('أفسس', 'new', 'epistles', 6, { aliases: ['افسس'] }), B('فيلبي', 'new', 'epistles', 4), B('كولوسي', 'new', 'epistles', 4),
  B('1 تسالونيكي', 'new', 'epistles', 5, { aliases: ['تسالونيكي الاولي'] }), B('2 تسالونيكي', 'new', 'epistles', 3, { aliases: ['تسالونيكي الثانيه'] }),
  B('1 تيموثاوس', 'new', 'epistles', 6, { aliases: ['تيموثاوس الاولي'] }), B('2 تيموثاوس', 'new', 'epistles', 4, { aliases: ['تيموثاوس الثانيه'] }),
  B('تيطس', 'new', 'epistles', 3), B('فليمون', 'new', 'epistles', 1, { maxVerse: 25 }), B('العبرانيين', 'new', 'epistles', 13, { aliases: ['عبرانيين'] }), B('يعقوب', 'new', 'epistles', 5),
  B('1 بطرس', 'new', 'epistles', 5, { aliases: ['بطرس الاولي'] }), B('2 بطرس', 'new', 'epistles', 3, { aliases: ['بطرس الثانيه'] }),
  B('1 يوحنا', 'new', 'epistles', 5, { aliases: ['يوحنا الاولي'] }), B('2 يوحنا', 'new', 'epistles', 1, { maxVerse: 13, aliases: ['يوحنا الثانيه'] }), B('3 يوحنا', 'new', 'epistles', 1, { maxVerse: 14, aliases: ['يوحنا الثالثه'] }),
  B('يهوذا', 'new', 'epistles', 1, { maxVerse: 25 }), B('رؤيا يوحنا', 'new', 'revelation', 22, { aliases: ['الرؤيا', 'رؤيا', 'سفر الرؤيا'] }),
];
export const MAX_VERSE = 176;          // Psalm 119 is the longest chapter: no verse number can be higher

// Arabic-aware key for matching names: diacritics/tatweel off, alef/ya/ta-marbuta unified, Arabic-Indic digits -> ASCII, spaces and punctuation removed, leading "ال" removed.
export function nameKey(s: unknown): string {
  return String(s ?? '')
    .replace(/[\u064B-\u0652\u0670\u0640]/g, '').replace(/[\u0623\u0625\u0622]/g, '\u0627').replace(/\u0649/g, '\u064A').replace(/\u0629/g, '\u0647')
    .replace(/[\u0660-\u0669]/g, d => String(d.charCodeAt(0) - 0x660)).replace(/[\u06F0-\u06F9]/g, d => String(d.charCodeAt(0) - 0x6F0))
    .replace(/[\s\p{P}\p{S}\p{Z}]+/gu, '').toLowerCase().replace(/^\u0627\u0644/, '');
}
const ORD: Record<string, string[]> = { '1': ['اول', 'الاول', 'الاولي'], '2': ['ثاني', 'الثاني', 'الثانيه'], '3': ['ثالث', 'الثالث', 'الثالثه'] };
const INDEX = new Map<string, Book>();
(function build() {
  const add = (k: string, b: Book) => { if (k) INDEX.set(k, b); };
  for (const b of BOOKS) {
    add(nameKey(b.name), b); for (const a of b.aliases || []) add(nameKey(a), b);
    const m = /^([123]) (.+)$/.exec(b.name);
    if (m) for (const o of ORD[m[1]]) { add(nameKey(m[2] + ' ' + o), b); add(nameKey('رسالة ' + m[2] + ' ' + o), b); }
  }
})();
const PREFIX = /^(سفر|انجيل|إنجيل|رسالة|رساله|الرسالة|الرساله)\s+/;
export function findBook(raw: string): Book | null {
  const s = String(raw ?? '').trim().replace(PREFIX, '');
  return INDEX.get(nameKey(s)) || INDEX.get(nameKey(raw)) || null;
}
export const bookByName = (name: string): Book | null => BOOKS.find(b => b.name === name) || null;
export const booksInSection = (id: string): Book[] => BOOKS.filter(b => b.section === id);

export type Ref = { book: Book; chapter: number; verse: number; verseEnd?: number; text: string };
export type RefResult = { ok: true; ref: Ref } | { ok: false; code: 'ref_missing' | 'ref_format' | 'ref_unknown_book' | 'ref_chapter_range' | 'ref_verse_range' };

// "يوحنا 3:16", "١ كورنثوس ١٣:٤-٧", "أعمال الرسل 2:1" ... -> canonical form. A chapter AND a verse are mandatory (a bare book or chapter is not a verse reference).
export function parseReference(raw: unknown): RefResult {
  const s0 = String(raw ?? '').replace(/[\u064B-\u0652\u0640]/g, '').replace(/[\u0660-\u0669]/g, d => String(d.charCodeAt(0) - 0x660)).replace(/[\u06F0-\u06F9]/g, d => String(d.charCodeAt(0) - 0x6F0)).replace(/[()\[\]«»"]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s0) return { ok: false, code: 'ref_missing' };
  const m = /^(.*?)\s*(\d{1,3})\s*[:：.]\s*(\d{1,3})(?:\s*[-–—]\s*(\d{1,3}))?$/.exec(s0);
  if (!m || !m[1].trim()) return { ok: false, code: 'ref_format' };
  const book = findBook(m[1]); if (!book) return { ok: false, code: 'ref_unknown_book' };
  const ch = +m[2], v = +m[3], ve = m[4] ? +m[4] : undefined;
  if (ch < 1 || ch > book.chapters) return { ok: false, code: 'ref_chapter_range' };
  const cap = book.maxVerse && book.chapters === 1 ? book.maxVerse : MAX_VERSE;
  if (v < 1 || v > cap || (ve !== undefined && (ve <= v || ve > cap))) return { ok: false, code: 'ref_verse_range' };
  return { ok: true, ref: { book, chapter: ch, verse: v, verseEnd: ve, text: `${book.name} ${ch}:${v}${ve ? '-' + ve : ''}` } };
}
