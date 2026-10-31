"""Builds the .xlsx fixtures used by bible-import.test.mjs / bible-import-ui.test.mjs.  Run: python3 tests/make_fixtures.py"""
import os
from openpyxl import Workbook
from openpyxl.styles import Font
OUT = os.path.join(os.path.dirname(__file__), 'fixtures')
H = ['Question','Choice A','Choice B','Choice C','Choice D','Correct Answer','Explanation','Bible Reference','Category','Difficulty']

def book(path, rows, header=H, sheet='Questions', extra_sheet=False):
    wb = Workbook(); ws = wb.active; ws.title = sheet
    if header is not None: ws.append(header)
    for r in rows: ws.append(r)
    if header is not None:
        for c in ws[1]: c.font = Font(bold=True)
    if extra_sheet:
        w2 = wb.create_sheet('Notes'); w2.append(['ignore me'])
    wb.save(os.path.join(OUT, path))

good = lambda q, a='A', **k: [q, 'يونان', 'إيليا', 'إرميا', 'إشعياء', a, k.get('ex','شرح مختصر'), k.get('ref','يونان 1:17'), k.get('cat','العهد القديم'), k.get('df','easy')]

# 1. all valid (English + Arabic cells), with a second sheet that must be ignored
book('valid.xlsx', [good('مين اللي اتبلع في بطن الحوت؟'), good('مين بنى الفلك؟', 'B'), good('كم يوم صام الرب يسوع في البرية؟', 'c', df='Medium'), good('مين أول ملك لإسرائيل؟', 4, df='hard')], extra_sheet=True)

# 2. the messy one: row numbers below are EXCEL rows (header = row 1)
long_q = 'س' * 401
rows = [
 good('مين اللي اتبلع في بطن الحوت؟', 'B'),                                           # 2  valid
 ['في أي مدينة وُلد الرب يسوع؟','الناصرة','بيت لحم','أورشليم','كفرناحوم',3,'','','العهد الجديد','medium'],  # 3  valid (numeric correct) + 2 warnings
 ['سؤال ناقص اختيار','أ','ب','','د','A','','متى 1:1','عام','easy'],                  # 4  opt_missing:C
 good('سؤال إجابتين','A,C'),                                                          # 5  correct_multiple
 good('سؤال إجابة غلط','E'),                                                          # 6  correct_invalid
 good('سؤال بدون إجابة',''),                                                          # 7  correct_missing
 good('مِين  اللي اتبلع في بطن الحوت'),                                                # 8  dup_file:2 (diacritics + double space + no question mark)
 ['اختيارات مكررة','نعم','no','NO','لعل','A','','','عام','easy'],                      # 9  opts_duplicate (case-insensitive: no / NO)
 ['سؤال بتصنيف وصعوبة غلط','1','2','3','4','A','','','','impossible'],                # 10 cat_missing + diff_invalid
 [None]*10,                                                                            # 11 blank row (skipped silently)
 ['', 'أ','ب','ج','د','A','','','عام','easy'],                                         # 12 q_missing
 [long_q,'أ','ب','ج','د','A','','','عام','easy'],                                      # 13 q_long
 ['سؤال بحروف عربية للإجابة','أ','ب','ج','د','ج','','لوقا 2:1','عام','صعب'],           # 14 valid (Arabic letter + Arabic difficulty)
 good('سؤال بشرح طويل', ex='ش'*501),                                                   # 15 expl_long
 good('سؤال بمرجع طويل', ref='م'*121),                                                 # 16 ref_long
 good('سؤال إجابة AB','AB'),                                                           # 17 correct_multiple
 ['سؤال بإجابة بين أقواس','1','2','3','4','(d)','','','عام','Easy'],                    # 18 valid, correct = (d) -> 4
]
book('messy.xlsx', rows)

# 3. Arabic headers, columns in a different order, plus an unknown column
book('arabic-headers.xlsx',
     [['مين كتب سفر التكوين؟','موسى','هارون','يشوع','صموئيل','أ','موسى هو كاتب الأسفار الخمسة','تكوين 1:1','العهد القديم','سهل','ملاحظة داخلية']],
     header=['السؤال','الاختيار أ','الاختيار ب','الاختيار ج','الاختيار د','الإجابة الصحيحة','الشرح','المرجع','التصنيف','الصعوبة','Notes'])

# 4. title row above the headers
wb = Workbook(); ws = wb.active; ws.title = 'Questions'
ws.append(['بنك أسئلة الكتاب المقدس — دفعة 1']); ws.append([]); ws.append(H); ws.append(good('سؤال بعد صف العنوان'))
wb.save(os.path.join(OUT, 'title-row.xlsx'))

# 5. missing required columns (no Correct Answer, no Category)
book('missing-columns.xlsx', [['سؤال','أ','ب','ج','د','x']], header=['Question','Choice A','Choice B','Choice C','Choice D','Explanation'])
# 6. header only
book('header-only.xlsx', [])
# 7. completely empty
Workbook().save(os.path.join(OUT, 'empty.xlsx'))
# 8. 501 rows
book('too-many.xlsx', [good('سؤال رقم %d' % i) for i in range(501)])
# 9. exactly 500 rows (must be accepted)
book('exactly-500.xlsx', [good('سؤال رقم %d' % i) for i in range(500)])
# 10. a fifth choice column
book('five-choices.xlsx', [good('سؤال عادي') + [''], good('سؤال بخمس اختيارات') + ['اختيار زيادة']], header=H + ['Choice E'])
# 11. same column twice
book('duplicate-columns.xlsx', [good('سؤال') + ['x']], header=H + ['Category'])
# 12. not an Excel file at all
open(os.path.join(OUT, 'not-excel.xlsx'), 'w').write('question,a,b\nhello,1,2\n')
from reportlab.pdfgen import canvas
c = canvas.Canvas(os.path.join(OUT, 'sample.pdf')); c.drawString(72, 760, 'Lesson: Jonah and the great fish. Jonah 1:17'); c.drawString(72, 740, 'God sent Jonah to Nineveh but he fled by ship.'); c.save()
print('fixtures written:', sorted(os.listdir(OUT)))
