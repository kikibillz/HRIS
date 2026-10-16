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
