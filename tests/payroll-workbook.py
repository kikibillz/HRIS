"""Check LibreOffice-recalculated review outputs against independent Decimal fixtures.
Run after regenerating and recalculating public/payroll-review.xlsx; needs openpyxl.
"""
import json
from decimal import Decimal,ROUND_HALF_UP
from openpyxl import load_workbook
w=load_workbook('public/payroll-review.xlsx',data_only=True)
kobo=lambda v:int((Decimal(str(v))*100).quantize(Decimal(1),rounding=ROUND_HALF_UP))
fixed=json.load(open('public/payroll-reference-cases.json'))
periods=json.load(open('public/payroll-period-cases.json'))
fields={'gross':'L','pension':'M','employer_pension':'N','nhf':'O','paye':'S','total_deductions':'T','net':'U','employer_ecs':'V','employer_itf':'W'}
for i,c in enumerate(fixed,2):
 for key,col in fields.items():assert kobo(w['Calculation'][f'{col}{i}'].value)==c['expected'][key],(c['name'],key,w['Calculation'][f'{col}{i}'].value,c['expected'][key])
 for col in ['Z','AA']:assert w['Calculation'][f'{col}{i}'].value==0
fields={'gross':'P','pension':'Q','employer_pension':'R','nhf':'S','paye':'J','nhis':'K','total_deductions':'T','net':'U','employer_ecs':'V','employer_itf':'W'}
for i,c in enumerate(periods,2):
 for key,col in fields.items():assert kobo(w['Period review'][f'{col}{i}'].value)==c['expected'][key],(c['name'],key,w['Period review'][f'{col}{i}'].value,c['expected'][key])
 assert w['Period review'][f'Y{i}'].value==0
for i,(gross,net) in enumerate([(180000000,156600000),(200000000,173240000),(200000000,173240000),(220000000,189880000)],2):
 assert kobo(w['YTD reconciliation'][f'K{i}'].value)==gross
 assert kobo(w['YTD reconciliation'][f'N{i}'].value)==net
 assert w['YTD reconciliation'][f'Q{i}'].value==0 and w['YTD reconciliation'][f'R{i}'].value==0
cumulative=json.load(open('public/payroll-cumulative-cases.json'))
for i,c in enumerate(cumulative,2):
 for key,col in {'gross':'H','paye':'T','pension':'I','nhf':'J','nhis':'K','total_deductions':'U','net':'V'}.items():assert kobo(w['Cumulative PAYE'][f'{col}{i}'].value)==c['expected'][key],(c['name'],key)
 assert kobo(w['Cumulative PAYE'][f'S{i}'].value)==c['expected_cumulative_tax']
 assert w['Cumulative PAYE'][f'Y{i}'].value==0 and w['Cumulative PAYE'][f'Z{i}'].value==0
for sheet in w:
 for row in sheet:
  for cell in row:assert cell.data_type!='e',(sheet.title,cell.coordinate,cell.value)
print(f'PASS: cached Excel formulas match {len(fixed)} fixed-month and {len(periods)} reviewed-period fixtures; four YTD reconciliation fixtures and 11 cumulative PAYE fixtures; no formula errors. Supplied PAYE is not accountant approval.')
