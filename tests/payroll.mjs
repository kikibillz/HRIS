import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { csv } from '../lib/csv.ts';
import { parseSalary,calculatePayroll,money,defaultPolicy } from '../lib/payroll.ts';
assert.ok(csv([{name:'=HYPERLINK("https://example.test")'}]).includes("'=HYPERLINK"));
const cases=JSON.parse(readFileSync('public/payroll-reference-cases.json','utf8'));
for(const c of cases){const result=calculatePayroll(parseSalary(c.input));for(const [key,expected] of Object.entries(c.expected))assert.equal(result[key],expected,`${c.name}: ${key}`);assert.equal(result.net+result.total_deductions,result.gross);}
for(const invalid of ['-1','1.001','1e6','NaN','Infinity','1,000'])assert.throws(()=>money(invalid));
assert.equal(money('0.01'),1);assert.equal(money('123.45'),12345);
assert.throws(()=>parseSalary({basic:'0'}));
const s=parseSalary({basic:'200000',housing:'100000',transport:'50000',nhf:true});
assert.equal(calculatePayroll(s,{...defaultPolicy,nhf_base:'gross'}).nhf,875000);
assert.equal(calculatePayroll(s).nhf,500000);
assert.equal(calculatePayroll(s,{...defaultPolicy,employer_itf_bp:100}).employer_itf,350000);
assert.equal(calculatePayroll(parseSalary({basic:'200000',other:'50000'}),{...defaultPolicy,pension_base:'gross'}).pension,2000000);
for(let n=1;n<=300;n++){const s=parseSalary({basic:(n*1234.57).toFixed(2),other_deductions:'1.11',pension:n%2===0,nhf:n%3===0});const r=calculatePayroll(s);assert.equal(r.gross,r.net+r.total_deductions);assert.equal(r.employer_cost,r.gross+r.employer_pension+r.employer_ecs+r.employer_itf);assert.ok(Object.values(r).filter(v=>typeof v==='number').every(v=>Number.isSafeInteger(v)&&v>=0));}
console.log(`PASS: ${cases.length} independent payroll reference cases, NHF basis variants, precision validation, and 300 conservation checks. Accountant approval remains outstanding.`);

const {parseAdjustment,calculatePeriodPayroll,periodDays}=await import('../lib/payroll.ts');
const periodCases=JSON.parse(readFileSync('public/payroll-period-cases.json','utf8'));
for(const c of periodCases){const r=calculatePeriodPayroll(parseSalary(c.input),defaultPolicy,c.period,c.joined,parseAdjustment(c.adjustment));for(const [key,expected] of Object.entries(c.expected))assert.equal(r[key],expected,`${c.name}: ${key}`);assert.equal(r.proration.paid_days,c.paid_days);assert.equal(r.net+r.total_deductions,r.gross);}
assert.throws(()=>parseAdjustment({bonus:'10',pensionable_bonus:'11'}));
assert.throws(()=>parseAdjustment({reviewed_paye:'0'}));
assert.throws(()=>parseAdjustment({bonus:'-1'}));
for(const date of ['2026-02-30','bad','2026-13-01'])assert.throws(()=>periodDays('2026-10',date));
for(const period of ['2025-10','2026-13','bad'])assert.throws(()=>periodDays(period,'2026-01-01'));
assert.equal(periodDays('2026-02','2026-02-28').paid_days,1);
assert.throws(()=>calculatePeriodPayroll(s,defaultPolicy,'2026-10','2026-11-01'));
assert.throws(()=>calculatePeriodPayroll(s,defaultPolicy,'2026-10','2026-10-02'));
assert.throws(()=>calculatePeriodPayroll(s,defaultPolicy,'2026-10','2026-01-01',parseAdjustment({bonus:'100'})));
assert.throws(()=>calculatePeriodPayroll(s,defaultPolicy,'2026-10','2026-01-01',parseAdjustment({one_off_deduction:'9999999'})));
const standard=calculatePayroll(s),deducted=calculatePeriodPayroll(s,defaultPolicy,'2026-10','2026-01-01',parseAdjustment({one_off_deduction:'123.45'}));
assert.equal(deducted.net,standard.net-12345);assert.equal(deducted.paye,standard.paye);
const grossPolicy=calculatePeriodPayroll(parseSalary({basic:'200000',nhf:true}),{...defaultPolicy,pension_base:'gross',nhf_base:'gross'},'2026-10','2026-01-01',parseAdjustment({bonus:'100000',reviewed_paye:'25000',review_note:'fixture'}));assert.equal(grossPolicy.pension,2400000);assert.equal(grossPolicy.nhf,750000);
console.log(`PASS: ${periodCases.length} independent reviewed-period fixtures, calendar boundaries, override validation, bonus contribution bases, and unchanged standard PAYE. Supplied PAYE fixtures are not accountant approval.`);

for(let n=1;n<=100;n++){const salary=parseSalary({basic:(n*5432.17).toFixed(2),housing:'123.45',other:'456.78',nhf:n%2===0,pension:n%3!==0});const fixed=calculatePayroll(salary);const period=calculatePeriodPayroll(salary,defaultPolicy,'2026-10','2026-01-01');for(const key of ['gross','pension','paye','nhf','nhis','net','total_deductions','employer_pension','employer_ecs','employer_itf'])assert.equal(period[key],fixed[key],`Unchanged recurring calculation: ${key}`);}
console.log('PASS: 100 unchanged full-month payroll comparisons.');

const {calculateCumulativePayroll,previewCumulativePayroll}=await import('../lib/payroll-cumulative.ts');
const cumulativeCases=JSON.parse(readFileSync('public/payroll-cumulative-cases.json','utf8'));
for(const c of cumulativeCases){const salary=parseSalary(c.input),a=parseAdjustment(c.adjustment);const result=calculateCumulativePayroll(salary,defaultPolicy,c.period,c.joined,a,c.prior);for(const [key,expected] of Object.entries(c.expected))assert.equal(result[key],expected,`${c.name}: ${key}`);assert.equal(result.cumulative.cumulative_tax,c.expected_cumulative_tax);assert.equal(result.cumulative.previous_paye+result.paye,result.cumulative.cumulative_tax);assert.equal(result.net+result.total_deductions,result.gross);}
const template=cumulativeCases[1];
const ca=parseAdjustment(template.adjustment),cs=parseSalary(template.input);
assert.throws(()=>parseAdjustment({...template.adjustment,reviewed_paye:'1'}));
assert.throws(()=>parseAdjustment({...template.adjustment,history_confirmed:false}));
assert.throws(()=>calculatePeriodPayroll(cs,defaultPolicy,template.period,template.joined,ca));
assert.throws(()=>calculateCumulativePayroll(cs,defaultPolicy,template.period,template.joined,ca,{...template.prior,unrecorded_periods:['2026-01']}));
assert.throws(()=>calculateCumulativePayroll(cs,defaultPolicy,template.period,template.joined,ca,{...template.prior,through_period:'2026-08'}));
const refundPrior={...template.prior,totals:{...template.prior.totals,paye:21000000}};
const refund=previewCumulativePayroll(cs,defaultPolicy,template.period,template.joined,ca,refundPrior);assert.equal(refund.ready_for_draft,false);assert.equal(refund.working.refund_due,1000000);assert.throws(()=>calculateCumulativePayroll(cs,defaultPolicy,template.period,template.joined,ca,refundPrior));
const underpaid={...template.prior,totals:{...template.prior.totals,gross:1000000000,paye:0}};
assert.ok(previewCumulativePayroll(cs,defaultPolicy,template.period,template.joined,ca,underpaid).net<0);assert.throws(()=>calculateCumulativePayroll(cs,defaultPolicy,template.period,template.joined,ca,underpaid));
assert.throws(()=>calculateCumulativePayroll(cs,defaultPolicy,template.period,template.joined,{...ca,minimum_wage_exempt:true},template.prior));
let prior={through_period:'2025-12',totals:{gross:0,paye:0,pension:0,nhf:0,nhis:0},unrecorded_periods:[]};
const regular=parseSalary({basic:'123456.78',housing:'1234.56',nhf:true});
for(let month=1;month<=12;month++){const period=`2026-${String(month).padStart(2,'0')}`;const r=calculateCumulativePayroll(regular,defaultPolicy,period,'2026-01-01',ca,prior);prior={through_period:period,totals:Object.fromEntries(['gross','paye','pension','nhf','nhis'].map(k=>[k,prior.totals[k]+r[k]])),unrecorded_periods:[]};if(month===12)assert.equal(prior.totals.paye,calculatePayroll(regular).annual_paye);}
console.log(`PASS: ${cumulativeCases.length} independent cumulative cases, 12-month exact annual reconciliation, history validation, mutually exclusive methods, exemption checks, refund and negative-net blockers. Accountant method approval pending.`);

assert.throws(()=>parseAdjustment({paye_method:['cumulative']}));

assert.ok(csv([{name:'  =HYPERLINK("x")'}]).includes("'  =HYPERLINK"));
