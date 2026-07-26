import './style.css';
import Chart from 'chart.js/auto';
import * as XLSX from 'xlsx';

const FIELD_ALIASES = {
  period: ['الفترة','السنة','الشهر','التاريخ','period','year','month','date'],
  statement: ['القائمة المالية','القائمة','نوع القائمة','statement','financial statement','statement type'],
  category: ['الفئة','التصنيف','المجموعة','category','classification','group'],
  item: ['البند','الحساب','اسم الحساب','الوصف','item','account','account name','description'],
  value: ['القيمة','المبلغ','الرصيد','فعلي','value','amount','balance','actual'],
  branch: ['الفرع','الموقع','branch','location'],
  costCenter: ['مركز التكلفة','مركز الكلفة','الإدارة','القسم','cost center','department'],
  customer: ['العميل','الجهة','customer','client'],
  cashflowType: ['نوع التدفق النقدي','نوع التدفق','التدفق','cash flow type','cashflow type'],
  budget: ['الموازنة','الميزانية التقديرية','المخطط','budget','plan','planned'],
  currency: ['العملة','currency','curr']
};

const VIEW_META = {
  dashboard: ['لوحة القيادة','ملخص تنفيذي للأداء المالي وأهم التنبيهات'],
  import: ['استيراد البيانات','تحميل Excel وCSV وتوحيد الحقول تلقائيًا'],
  quality: ['جودة البيانات','فحص الاتساق والتوازن والتكرار قبل التحليل'],
  statements: ['القوائم المالية','تحليل أفقي ورأسي وتفاصيل التغير'],
  ratios: ['النسب المالية','السيولة والربحية والمديونية والكفاءة والنمو'],
  comparisons: ['المقارنات','مقارنة الفروع والفترات والعملاء ومراكز التكلفة'],
  insights: ['التحليل الذكي','تفسير النتائج وتحديد الأسباب والإجراءات المقترحة'],
  reports: ['التقارير والتصدير','تقرير إداري ونسخ احتياطي بصيغ متعددة']
};

const state = {
  rows: [],
  period: '',
  charts: {},
  quality: null,
  sourceFiles: [],
  lastImportAt: null
};

const $ = (id) => document.getElementById(id);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const clean = (v) => String(v ?? '').trim();
const keyText = (v) => clean(v).toLowerCase().replace(/[\s_\-–—/\\]+/g,' ').replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').trim();
const n = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const s = clean(v).replace(/[,٬]/g,'').replace(/[()]/g, m => m === '(' ? '-' : '').replace(/[^0-9.\-]/g,'');
  const x = Number(s);
  return Number.isFinite(x) ? x : 0;
};
const pct = (v, digits = 1) => Number.isFinite(v) ? `${v.toFixed(digits)}%` : '—';
const ratioFmt = (v, digits = 2) => Number.isFinite(v) ? v.toFixed(digits) : '—';
const uniq = (arr) => [...new Set(arr.filter(v => clean(v) !== ''))];
const sum = (arr) => arr.reduce((a,b) => a + n(b), 0);
const safeDiv = (a,b) => b ? a / b : NaN;
const changePct = (current, previous) => previous ? ((current - previous) / Math.abs(previous)) * 100 : NaN;
const clamp = (v,min,max) => Math.max(min,Math.min(max,v));
const escapeHtml = (s) => clean(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

function currencyCode() {
  return state.rows.find(r => r.currency)?.currency || 'SAR';
}
function money(v, compact = false) {
  const code = currencyCode();
  try {
    return new Intl.NumberFormat('ar', { style:'currency', currency:code, maximumFractionDigits:0, notation: compact ? 'compact' : 'standard' }).format(n(v));
  } catch {
    return `${new Intl.NumberFormat('ar',{maximumFractionDigits:0}).format(n(v))} ${code}`;
  }
}
function number(v) { return new Intl.NumberFormat('ar',{maximumFractionDigits:0}).format(n(v)); }
function normalizePeriod(v) {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return String(v.getFullYear());
  if (typeof v === 'number' && v > 30000 && v < 70000) {
    const d = XLSX.SSF.parse_date_code(v); return d ? `${d.y}-${String(d.m).padStart(2,'0')}` : String(v);
  }
  return clean(v);
}
function normalizeStatement(v, category = '') {
  const t = keyText(`${v} ${category}`);
  if (/دخل|ارباح|خسائر|income|profit|loss/.test(t)) return 'income';
  if (/ميزاني|مركز مالي|balance|financial position/.test(t)) return 'balance';
  if (/تدفق|cash flow|cashflow/.test(t)) return 'cashflow';
  return clean(v) || 'غير مصنف';
}
function statementLabel(v) {
  return ({income:'قائمة الدخل',balance:'المركز المالي',cashflow:'التدفقات النقدية'})[v] || v || 'غير مصنف';
}
function categoryKind(row) {
  const t = keyText(`${row.category} ${row.item} ${row.statement}`);
  if (/ايراد|مبيعات|دخل تشغيلي|revenue|sales|income/.test(t) && !/مصروف|تكلف|expense|cost/.test(t)) return 'revenue';
  if (/مصروف|تكلف|رواتب|اجور|ايجار|expense|cost|salary|rent/.test(t)) return 'expense';
  if (/اصل|اصول|asset|نقد|مخزون|ذمم مدينه/.test(t)) return 'asset';
  if (/خصوم|التزام|liabilit|دائن/.test(t)) return 'liability';
  if (/حقوق ملك|equity|راس المال/.test(t)) return 'equity';
  return 'other';
}
function isRevenue(r){ return r.statement === 'income' && categoryKind(r) === 'revenue'; }
function isExpense(r){ return r.statement === 'income' && categoryKind(r) === 'expense'; }
function rowsFor(period = state.period){ return state.rows.filter(r => !period || r.period === period); }
function itemValue(rows, patterns, kinds = []) {
  const regs = patterns.map(p => p instanceof RegExp ? p : new RegExp(p,'i'));
  const exactMatches = rows.filter(r => regs.some(rx => rx.test(keyText(r.item))));
  if (exactMatches.length) return sum(exactMatches.map(r => r.value));
  if (kinds.length) return sum(rows.filter(r => kinds.includes(categoryKind(r))).map(r => r.value));
  return 0;
}
function periods() {
  return uniq(state.rows.map(r => r.period)).sort((a,b) => String(a).localeCompare(String(b),'ar',{numeric:true}));
}
function previousPeriod(period) {
  const ps = periods(); const i = ps.indexOf(period); return i > 0 ? ps[i-1] : '';
}
function metrics(period) {
  const rows = rowsFor(period);
  const income = rows.filter(r => r.statement === 'income');
  const balance = rows.filter(r => r.statement === 'balance');
  const cashflow = rows.filter(r => r.statement === 'cashflow');
  const revenue = sum(income.filter(isRevenue).map(r => r.value));
  const expenses = sum(income.filter(isExpense).map(r => Math.abs(r.value)));
  const profit = revenue - expenses;
  const totalAssets = itemValue(balance,[/^اجمالي الاصول$/,/total assets/],['asset']);
  const currentAssets = itemValue(balance,[/اجمالي الاصول المتداوله/,/current assets/]);
  const inventory = itemValue(balance,[/مخزون/,/inventory/]);
  const cash = itemValue(balance,[/نقديه|نقد وما في حكمه|cash/]);
  const currentLiabilities = itemValue(balance,[/اجمالي الخصوم المتداوله|current liabilit/]);
  const totalLiabilities = itemValue(balance,[/اجمالي الخصوم$|total liabilit/],['liability']);
  const equity = itemValue(balance,[/حقوق الملكيه|equity/],['equity']);
  const budgetRevenue = sum(income.filter(isRevenue).map(r => r.budget));
  const budgetExpenses = sum(income.filter(isExpense).map(r => Math.abs(r.budget)));
  const operatingCash = sum(cashflow.filter(r => /تشغيل|operat/.test(keyText(`${r.cashflowType} ${r.category}`))).map(r => r.value));
  const investingCash = sum(cashflow.filter(r => /استثمار|invest/.test(keyText(`${r.cashflowType} ${r.category}`))).map(r => r.value));
  const financingCash = sum(cashflow.filter(r => /تمويل|financ/.test(keyText(`${r.cashflowType} ${r.category}`))).map(r => r.value));
  const netCashFlow = operatingCash + investingCash + financingCash;
  return {period,revenue,expenses,profit,totalAssets,currentAssets,inventory,cash,currentLiabilities,totalLiabilities,equity,budgetRevenue,budgetExpenses,operatingCash,investingCash,financingCash,netCashFlow,rows};
}

function allRatios(period) {
  const m = metrics(period); const prev = metrics(previousPeriod(period));
  const margin = safeDiv(m.profit,m.revenue)*100;
  const previousMargin = safeDiv(prev.profit,prev.revenue)*100;
  const defs = [
    {group:'liquidity',name:'نسبة التداول',value:safeDiv(m.currentAssets,m.currentLiabilities),previous:safeDiv(prev.currentAssets,prev.currentLiabilities),unit:'x',good:v=>v>=1.5,warn:v=>v>=1,desc:'قدرة الأصول المتداولة على تغطية الالتزامات القصيرة.'},
    {group:'liquidity',name:'النسبة السريعة',value:safeDiv(m.currentAssets-m.inventory,m.currentLiabilities),previous:safeDiv(prev.currentAssets-prev.inventory,prev.currentLiabilities),unit:'x',good:v=>v>=1,warn:v=>v>=.7,desc:'السيولة المتاحة دون الاعتماد على بيع المخزون.'},
    {group:'liquidity',name:'النسبة النقدية',value:safeDiv(m.cash,m.currentLiabilities),previous:safeDiv(prev.cash,prev.currentLiabilities),unit:'x',good:v=>v>=.5,warn:v=>v>=.2,desc:'مدى تغطية الالتزامات المتداولة بالنقد المتاح.'},
    {group:'liquidity',name:'رأس المال العامل',value:m.currentAssets-m.currentLiabilities,previous:prev.currentAssets-prev.currentLiabilities,unit:'money',good:v=>v>0,warn:v=>v===0,desc:'الفائض المتاح لتمويل النشاط اليومي.'},
    {group:'profitability',name:'هامش صافي الربح',value:margin,previous:previousMargin,unit:'%',good:v=>v>=15,warn:v=>v>=5,desc:'الربح المتبقي من كل وحدة إيراد بعد المصروفات.'},
    {group:'profitability',name:'العائد على الأصول',value:safeDiv(m.profit,m.totalAssets)*100,previous:safeDiv(prev.profit,prev.totalAssets)*100,unit:'%',good:v=>v>=10,warn:v=>v>=3,desc:'كفاءة استخدام الأصول في توليد الأرباح.'},
    {group:'profitability',name:'العائد على حقوق الملكية',value:safeDiv(m.profit,m.equity)*100,previous:safeDiv(prev.profit,prev.equity)*100,unit:'%',good:v=>v>=15,warn:v=>v>=5,desc:'العائد المحقق على أموال الملاك.'},
    {group:'profitability',name:'نسبة المصروفات للإيرادات',value:safeDiv(m.expenses,m.revenue)*100,previous:safeDiv(prev.expenses,prev.revenue)*100,unit:'%',good:v=>v<=70,warn:v=>v<=90,desc:'مقدار الإيراد المستهلك في تغطية المصروفات.'},
    {group:'leverage',name:'نسبة المديونية',value:safeDiv(m.totalLiabilities,m.totalAssets)*100,previous:safeDiv(prev.totalLiabilities,prev.totalAssets)*100,unit:'%',good:v=>v<=45,warn:v=>v<=65,desc:'نسبة الأصول الممولة من الخصوم.'},
    {group:'leverage',name:'الدين إلى حقوق الملكية',value:safeDiv(m.totalLiabilities,m.equity),previous:safeDiv(prev.totalLiabilities,prev.equity),unit:'x',good:v=>v<=1,warn:v=>v<=2,desc:'مقارنة التزامات المنشأة بأموال الملاك.'},
    {group:'leverage',name:'نسبة حقوق الملكية',value:safeDiv(m.equity,m.totalAssets)*100,previous:safeDiv(prev.equity,prev.totalAssets)*100,unit:'%',good:v=>v>=50,warn:v=>v>=30,desc:'مقدار الأصول الممولة من حقوق الملكية.'},
    {group:'efficiency',name:'دوران الأصول',value:safeDiv(m.revenue,m.totalAssets),previous:safeDiv(prev.revenue,prev.totalAssets),unit:'x',good:v=>v>=1,warn:v=>v>=.5,desc:'قدرة الأصول على توليد الإيرادات.'},
    {group:'efficiency',name:'استهلاك موازنة المصروفات',value:safeDiv(m.expenses,m.budgetExpenses)*100,previous:safeDiv(prev.expenses,prev.budgetExpenses)*100,unit:'%',good:v=>v<=100,warn:v=>v<=110,desc:'نسبة المصروف الفعلي إلى الموازنة المخصصة.'},
    {group:'efficiency',name:'تحقق موازنة الإيرادات',value:safeDiv(m.revenue,m.budgetRevenue)*100,previous:safeDiv(prev.revenue,prev.budgetRevenue)*100,unit:'%',good:v=>v>=100,warn:v=>v>=90,desc:'نسبة الإيراد الفعلي إلى الإيراد المخطط.'},
    {group:'growth',name:'نمو الإيرادات',value:changePct(m.revenue,prev.revenue),previous:NaN,unit:'%',good:v=>v>=10,warn:v=>v>=0,desc:'نسبة تغير الإيرادات عن الفترة السابقة.'},
    {group:'growth',name:'نمو المصروفات',value:changePct(m.expenses,prev.expenses),previous:NaN,unit:'%',good:v=>v<=5,warn:v=>v<=15,desc:'نسبة تغير المصروفات عن الفترة السابقة.'},
    {group:'growth',name:'نمو الأرباح',value:changePct(m.profit,prev.profit),previous:NaN,unit:'%',good:v=>v>=10,warn:v=>v>=0,desc:'نسبة تغير صافي الربح عن الفترة السابقة.'},
    {group:'growth',name:'نمو النقدية',value:changePct(m.cash,prev.cash),previous:NaN,unit:'%',good:v=>v>=5,warn:v=>v>=0,desc:'تغير رصيد النقدية عن الفترة السابقة.'}
  ];
  return defs.map(d => ({...d,rating:!Number.isFinite(d.value)?'na':d.good(d.value)?'good':d.warn(d.value)?'warn':'bad'}));
}

function qualityCheck() {
  const rows = state.rows; const issues = [];
  let missing = 0, duplicates = 0, invalid = 0, unclassified = 0;
  const seen = new Set();
  rows.forEach((r) => {
    if (!r.period || !r.item) missing++;
    if (!Number.isFinite(r.value)) invalid++;
    if (!['income','balance','cashflow'].includes(r.statement)) unclassified++;
    const k = [r.period,r.statement,r.category,r.item,r.branch,r.costCenter,r.customer,r.value].map(keyText).join('|');
    if (seen.has(k)) duplicates++; else seen.add(k);
  });
  if (missing) issues.push({level:'error',title:`${missing} سجلًا يفتقد الفترة أو البند`,text:'هذه الحقول أساسية للتجميع الصحيح.',action:'استكمل الحقول أو احذف الصفوف غير الصالحة'});
  if (invalid) issues.push({level:'error',title:`${invalid} قيمة مالية غير صالحة`,text:'تعذر تحويل بعض القيم إلى أرقام.',action:'راجع تنسيق الأرقام والفواصل'});
  if (duplicates) issues.push({level:'warn',title:`${duplicates} سجلًا مكررًا محتملًا`,text:'قد يؤدي التكرار إلى تضخيم الإيرادات أو المصروفات.',action:'راجع المصدر قبل اعتماد التقرير'});
  if (unclassified) issues.push({level:'warn',title:`${unclassified} سجلًا بقائمة غير مصنفة`,text:'لم يتعرف التطبيق على نوع القائمة المالية.',action:'استخدم قائمة الدخل أو الميزانية أو التدفقات النقدية'});
  const currencies = uniq(rows.map(r => r.currency));
  if (currencies.length > 1) issues.push({level:'warn',title:`تم العثور على ${currencies.length} عملات`,text:`العملات: ${currencies.join('، ')}`,action:'وحّد العملة أو حلّل كل عملة بصورة منفصلة'});
  periods().forEach(p => {
    const m = metrics(p);
    if (m.totalAssets && (m.totalLiabilities || m.equity)) {
      const diff = Math.abs(m.totalAssets - (m.totalLiabilities + m.equity));
      const threshold = Math.max(1,Math.abs(m.totalAssets)*.01);
      if (diff > threshold) issues.push({level:'error',title:`الميزانية غير متوازنة في ${p}`,text:`الفارق ${money(diff)} بين الأصول ومجموع الخصوم وحقوق الملكية.`,action:'راجع الإجماليات أو إشارات القيم'});
    }
    const types = new Set(rowsFor(p).map(r => r.statement));
    if (!types.has('income')) issues.push({level:'warn',title:`قائمة الدخل غير موجودة للفترة ${p}`,text:'لن يمكن حساب الربحية والنمو بدقة.',action:'استورد بيانات قائمة الدخل'});
    if (!types.has('balance')) issues.push({level:'warn',title:`المركز المالي غير موجود للفترة ${p}`,text:'لن يمكن حساب السيولة والمديونية.',action:'استورد بيانات المركز المالي'});
  });
  if (!issues.length && rows.length) issues.push({level:'ok',title:'البيانات اجتازت الفحوص الأساسية',text:'لم يتم اكتشاف أخطاء مؤثرة في التحليل.',action:'يمكن متابعة إعداد التقرير'});
  const penalty = missing*3 + invalid*3 + duplicates*.8 + unclassified*1.5 + issues.filter(i=>i.level==='error').length*7 + issues.filter(i=>i.level==='warn').length*3;
  const score = rows.length ? clamp(Math.round(100 - penalty),0,100) : 0;
  return {score,issues,missing,duplicates,invalid,unclassified,rows:rows.length,periods:periods().length};
}

function generateInsights(period) {
  const m = metrics(period); const prevP = previousPeriod(period); const prev = metrics(prevP); const insights = [];
  const revGrowth = changePct(m.revenue,prev.revenue), expGrowth = changePct(m.expenses,prev.expenses), profitGrowth = changePct(m.profit,prev.profit), margin = safeDiv(m.profit,m.revenue)*100;
  if (prevP && Number.isFinite(revGrowth)) insights.push({severity:revGrowth>=0?'low':'high',title:`الإيرادات ${revGrowth>=0?'نمت':'انخفضت'} ${pct(Math.abs(revGrowth))}`,text:`انتقلت الإيرادات من ${money(prev.revenue)} في ${prevP} إلى ${money(m.revenue)} في ${period}.`,action:revGrowth>=0?'حافظ على مصادر النمو وراجع مدى استدامتها.':'حلل العملاء والفروع التي ساهمت في الانخفاض.'});
  if (prevP && Number.isFinite(expGrowth) && Number.isFinite(revGrowth) && expGrowth > revGrowth + 5) insights.push({severity:'high',title:'المصروفات تنمو أسرع من الإيرادات',text:`نمت المصروفات ${pct(expGrowth)} مقابل نمو الإيرادات ${pct(revGrowth)}، ما يضغط على هامش الربح.`,action:'راجع البنود الأعلى نموًا وحدد سقوف إنفاق وملاك إجراءات.'});
  if (Number.isFinite(margin)) insights.push({severity:margin<5?'high':margin<15?'medium':'low',title:`هامش صافي الربح ${pct(margin)}`,text:`تحقق المنشأة ${money(m.profit)} ربحًا من إيرادات قدرها ${money(m.revenue)}.`,action:margin<15?'ركز على التسعير وكفاءة المصروفات وتحسين المزيج البيعي.':'الهامش جيد؛ راقب استدامة النمو وجودة التدفق النقدي.'});
  if (m.budgetExpenses) {
    const use = safeDiv(m.expenses,m.budgetExpenses)*100;
    insights.push({severity:use>110?'high':use>100?'medium':'low',title:`استهلاك موازنة المصروفات ${pct(use)}`,text:`المصروف الفعلي ${money(m.expenses)} مقابل موازنة ${money(m.budgetExpenses)}.`,action:use>100?'جمّد المصروفات غير الضرورية وفسّر الانحرافات الأكبر.':'الإنفاق ضمن الموازنة؛ راقب البنود القريبة من الحد.'});
  }
  if (m.currentLiabilities) {
    const current = safeDiv(m.currentAssets,m.currentLiabilities);
    insights.push({severity:current<1?'high':current<1.5?'medium':'low',title:`نسبة التداول ${ratioFmt(current)} مرة`,text:`الأصول المتداولة ${money(m.currentAssets)} مقابل خصوم متداولة ${money(m.currentLiabilities)}.`,action:current<1.5?'حسّن التحصيل وجدولة المدفوعات وراجع الاحتياج للسيولة.':'السيولة القصيرة مقبولة؛ استمر بمتابعة دورة النقد.'});
  }
  if (m.totalAssets) {
    const debt = safeDiv(m.totalLiabilities,m.totalAssets)*100;
    insights.push({severity:debt>65?'high':debt>45?'medium':'low',title:`نسبة المديونية ${pct(debt)}`,text:`الخصوم تمثل ${pct(debt)} من إجمالي الأصول.`,action:debt>45?'وازن بين التمويل والقدرة على السداد وتكلفة الدين.':'هيكل التمويل متوازن نسبيًا.'});
  }
  const customers = aggregate(rowsFor(period).filter(isRevenue),'customer','value').filter(x=>x.label && x.label!=='غير محدد');
  if (customers.length && m.revenue) {
    const top = customers[0], concentration = top.value/m.revenue*100;
    if (concentration >= 35) insights.push({severity:concentration>=60?'high':'medium',title:`تركيز الإيرادات لدى ${top.label}`,text:`يسهم العميل بنسبة ${pct(concentration)} من إيرادات الفترة.`,action:'وسّع قاعدة العملاء وضع خطة لتقليل مخاطر الاعتماد.'});
  }
  const expenses = aggregate(rowsFor(period).filter(isExpense),'item','absValue');
  if (expenses[0] && m.expenses) insights.push({severity:'medium',title:`أكبر مصروف: ${expenses[0].label}`,text:`بلغ ${money(expenses[0].value)} ويمثل ${pct(expenses[0].value/m.expenses*100)} من إجمالي المصروفات.`,action:'قارن البند بالموازنة والفترة السابقة وحدد محركات التكلفة.'});
  if (prevP && Number.isFinite(profitGrowth) && profitGrowth < 0) insights.push({severity:'high',title:`الربح تراجع ${pct(Math.abs(profitGrowth))}`,text:`انخفض الربح من ${money(prev.profit)} إلى ${money(m.profit)}.`,action:'استخدم تحليل المساهمة لتحديد أثر الإيرادات والمصروفات على التراجع.'});
  return insights;
}

function aggregate(rows, field, mode='value') {
  const map = new Map();
  rows.forEach(r => {
    const label = clean(r[field]) || 'غير محدد';
    const value = mode === 'absValue' ? Math.abs(r.value) : mode === 'budgetVariance' ? r.value-r.budget : r.value;
    map.set(label,(map.get(label)||0)+value);
  });
  return [...map.entries()].map(([label,value])=>({label,value})).sort((a,b)=>Math.abs(b.value)-Math.abs(a.value));
}

function healthScore(period) {
  if (!state.rows.length) return 0;
  const ratios = allRatios(period).filter(r=>r.rating!=='na');
  const ratioScore = ratios.length ? sum(ratios.map(r=>r.rating==='good'?100:r.rating==='warn'?60:25))/ratios.length : 50;
  const quality = state.quality?.score ?? qualityCheck().score;
  return Math.round(ratioScore*.65 + quality*.35);
}

function normalizeRows(rawRows) {
  if (!rawRows.length) return [];
  const headers = Object.keys(rawRows[0] || {});
  const map = {};
  for (const [field,aliases] of Object.entries(FIELD_ALIASES)) {
    const found = headers.find(h => aliases.some(a => keyText(h) === keyText(a))) || headers.find(h => aliases.some(a => keyText(h).includes(keyText(a)) || keyText(a).includes(keyText(h))));
    map[field] = found;
  }
  return rawRows.map((raw,index) => {
    const category = clean(raw[map.category]);
    return {
      id: `${Date.now()}-${index}-${Math.random().toString(36).slice(2,8)}`,
      period: normalizePeriod(raw[map.period]),
      statement: normalizeStatement(raw[map.statement],category),
      category,
      item: clean(raw[map.item]),
      value: n(raw[map.value]),
      branch: clean(raw[map.branch]),
      costCenter: clean(raw[map.costCenter]),
      customer: clean(raw[map.customer]),
      cashflowType: clean(raw[map.cashflowType]),
      budget: n(raw[map.budget]),
      currency: clean(raw[map.currency]) || 'SAR'
    };
  }).filter(r => r.period || r.item || r.value);
}

function chart(name, canvasId, config) {
  if (state.charts[name]) state.charts[name].destroy();
  const canvas = $(canvasId); if (!canvas) return;
  state.charts[name] = new Chart(canvas, {
    ...config,
    options: {
      responsive:true, maintainAspectRatio:false,
      interaction:{mode:'index',intersect:false},
      plugins:{legend:{display:false},tooltip:{rtl:true,textDirection:'rtl'},...(config.options?.plugins||{})},
      scales: config.type === 'doughnut' ? undefined : {x:{grid:{display:false},ticks:{font:{size:10}}},y:{grid:{color:'#edf2f5'},ticks:{font:{size:10}}},...(config.options?.scales||{})},
      ...(config.options||{})
    }
  });
}

function renderAll() {
  populatePeriods();
  state.quality = qualityCheck();
  renderDashboard(); renderImport(); renderQuality(); renderStatements(); renderRatios(); renderComparisons(); renderInsights(); renderReport();
}

function populatePeriods() {
  const ps = periods();
  if (!state.period || !ps.includes(state.period)) state.period = ps.at(-1) || '';
  ['globalPeriod','statementPeriod','ratioPeriod','insightPeriod'].forEach(id => {
    const el=$(id); if(!el)return; const current=id==='globalPeriod'?state.period:(el.value||state.period);
    el.innerHTML = ps.length ? ps.map(p=>`<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('') : '<option value="">لا توجد فترات</option>';
    el.value = ps.includes(current)?current:(ps.at(-1)||'');
  });
}

function kpiCard(label,value,delta,foot='',tone='') {
  const deltaClass = Number.isFinite(delta) ? (delta>=0?'up':'down') : '';
  return `<article class="kpi-card ${tone}"><div class="kpi-label">${escapeHtml(label)}</div><div class="kpi-value">${value}</div><div class="kpi-foot"><span>${escapeHtml(foot)}</span><span class="delta ${deltaClass}">${Number.isFinite(delta)?`${delta>=0?'▲':'▼'} ${pct(Math.abs(delta))}`:'—'}</span></div></article>`;
}

function renderDashboard() {
  const period=state.period,m=metrics(period),prev=metrics(previousPeriod(period));
  const score=healthScore(period); $('healthScore').textContent=state.rows.length?score:'—'; $('scoreRingValue').textContent=score; $('scoreRing').style.background=`conic-gradient(var(--teal-2) ${score*3.6}deg,#ffffff24 0deg)`;
  $('healthLabel').textContent=!state.rows.length?'حمّل بيانات لبدء التحليل':score>=80?'وضع مالي قوي':score>=65?'وضع جيد مع فرص تحسين':score>=45?'يحتاج متابعة': 'مخاطر مرتفعة';
  const revG=changePct(m.revenue,prev.revenue),expG=changePct(m.expenses,prev.expenses),profitG=changePct(m.profit,prev.profit),margin=safeDiv(m.profit,m.revenue)*100;
  $('kpiGrid').innerHTML = state.rows.length ? [
    kpiCard('الإيرادات',money(m.revenue),revG,`الفترة ${period}`,'success'),
    kpiCard('المصروفات',money(m.expenses),expG,'مقابل الفترة السابقة',expG>revG?'warning':''),
    kpiCard('صافي الربح',money(m.profit),profitG,`هامش ${pct(margin)}`,m.profit<0?'danger':'success'),
    kpiCard('النقدية',money(m.cash),changePct(m.cash,prev.cash),'الرصيد الختامي',m.cash<0?'danger':'')
  ].join('') : '<div class="empty-state">لا توجد بيانات لعرض المؤشرات.</div>';
  const insights=generateInsights(period); const headline=insights[0]?.title || 'لا توجد بيانات بعد';
  $('executiveHeadline').textContent=headline;
  $('executiveSummary').textContent=state.rows.length ? buildExecutiveSummary(period) : 'استورد ملف Excel أو CSV، أو استخدم البيانات التجريبية لرؤية التحليل الكامل.';
  $('alertsList').classList.toggle('empty-state',!insights.length); $('alertsList').innerHTML=insights.slice(0,4).map(i=>`<div class="alert-item"><div class="alert-icon ${i.severity==='high'?'danger':i.severity==='medium'?'warning':'info'}">${i.severity==='high'?'!':i.severity==='medium'?'△':'i'}</div><div><strong>${escapeHtml(i.title)}</strong><p>${escapeHtml(i.text)}</p></div></div>`).join('') || 'لا توجد تنبيهات بعد.';
  const trend=periods().map(metrics);
  chart('trend','trendChart',{type:'line',data:{labels:trend.map(x=>x.period),datasets:[{label:'الإيرادات',data:trend.map(x=>x.revenue),borderColor:'#0e9384',backgroundColor:'#0e938422',fill:false,tension:.35},{label:'المصروفات',data:trend.map(x=>x.expenses),borderColor:'#e27d60',backgroundColor:'#e27d6022',fill:false,tension:.35},{label:'الربح',data:trend.map(x=>x.profit),borderColor:'#2765b0',backgroundColor:'#2765b022',fill:false,tension:.35}]}});
  const exp=aggregate(rowsFor(period).filter(isExpense),'item','absValue').slice(0,6);
  chart('expense','expenseChart',{type:'doughnut',data:{labels:exp.map(x=>x.label),datasets:[{data:exp.map(x=>x.value),backgroundColor:['#0e9384','#2765b0','#e27d60','#c77816','#775da6','#6b7f90'],borderWidth:0}]},options:{cutout:'65%',plugins:{legend:{display:true,position:'bottom',rtl:true,labels:{boxWidth:10,font:{size:10}}}}}});
  renderBudget(m);
}
function buildExecutiveSummary(period) {
  const m=metrics(period),prev=metrics(previousPeriod(period)),rg=changePct(m.revenue,prev.revenue),eg=changePct(m.expenses,prev.expenses),margin=safeDiv(m.profit,m.revenue)*100;
  const parts=[];
  if (Number.isFinite(rg)) parts.push(`${rg>=0?'ارتفعت':'انخفضت'} الإيرادات بنسبة ${pct(Math.abs(rg))}`);
  if (Number.isFinite(eg)) parts.push(`${eg>=0?'وارتفعت':'وانخفضت'} المصروفات بنسبة ${pct(Math.abs(eg))}`);
  parts.push(`وسجل صافي الربح ${money(m.profit)} بهامش ${pct(margin)}`);
  if (m.budgetExpenses) parts.push(`مع استهلاك ${pct(safeDiv(m.expenses,m.budgetExpenses)*100)} من موازنة المصروفات`);
  return parts.join('، ') + '.';
}
function renderBudget(m) {
  const target=$('budgetSummary');
  if (!m.budgetExpenses && !m.budgetRevenue){target.className='budget-summary empty-state';target.innerHTML='لا توجد بيانات موازنة.';return;}
  target.className='budget-summary'; const rows=[];
  if(m.budgetRevenue){const x=safeDiv(m.revenue,m.budgetRevenue)*100;rows.push(['تحقق الإيرادات',x,m.revenue,m.budgetRevenue]);}
  if(m.budgetExpenses){const x=safeDiv(m.expenses,m.budgetExpenses)*100;rows.push(['استهلاك المصروفات',x,m.expenses,m.budgetExpenses]);}
  target.innerHTML=rows.map(([label,x,actual,budget])=>`<div class="budget-row"><strong>${label}</strong><span>${pct(x)} · ${money(actual)} / ${money(budget)}</span><div class="budget-bar"><i class="${x>100?'over':''}" style="width:${clamp(x,0,140)/1.4}%"></i></div></div>`).join('');
}

function renderImport() {
  const q=state.quality||qualityCheck();
  $('importStats').innerHTML=[['السجلات',number(state.rows.length)],['الفترات',number(periods().length)],['جودة البيانات',`${q.score}%`]].map(([l,v])=>`<div class="mini-stat"><strong>${v}</strong><span>${l}</span></div>`).join('');
  const sample=state.rows.slice(-12); const fields=[['period','الفترة'],['statement','القائمة'],['category','الفئة'],['item','البند'],['value','القيمة'],['branch','الفرع'],['budget','الموازنة']];
  $('previewHead').innerHTML=`<tr>${fields.map(f=>`<th>${f[1]}</th>`).join('')}</tr>`;
  $('previewBody').innerHTML=sample.length?sample.map(r=>`<tr>${fields.map(([k])=>`<td>${k==='value'||k==='budget'?money(r[k]):escapeHtml(k==='statement'?statementLabel(r[k]):r[k])}</td>`).join('')}</tr>`).join(''):'<tr><td colspan="7" class="empty-state">لا توجد بيانات.</td></tr>';
}
function renderQuality() {
  const q=state.quality||qualityCheck();
  $('qualityScoreCards').innerHTML=[
    kpiCard('درجة الجودة',`${q.score}%`,NaN,'بعد الفحوص','success'),
    kpiCard('السجلات الناقصة',number(q.missing),NaN,'حقول أساسية',q.missing?'danger':'success'),
    kpiCard('التكرارات المحتملة',number(q.duplicates),NaN,'تحتاج مراجعة',q.duplicates?'warning':'success'),
    kpiCard('غير المصنف',number(q.unclassified),NaN,'قائمة مالية',q.unclassified?'warning':'success')
  ].join('');
  $('qualityIssues').classList.toggle('empty-state',!q.issues.length); $('qualityIssues').innerHTML=q.issues.map(i=>`<div class="quality-item"><span class="quality-badge ${i.level}">${i.level==='error'?'خطأ':i.level==='warn'?'تنبيه':'سليم'}</span><div><strong>${escapeHtml(i.title)}</strong><p>${escapeHtml(i.text)}</p></div><span class="quality-action">${escapeHtml(i.action)}</span></div>`).join('')||'لا توجد بيانات لفحصها.';
}

function selectedStatementRows() {
  const p=$('statementPeriod').value||state.period,t=$('statementType').value;
  return rowsFor(p).filter(r=>r.statement===t);
}
function renderStatements() {
  const p=$('statementPeriod').value||state.period,t=$('statementType').value,rows=selectedStatementRows(),prevP=previousPeriod(p),prevRows=state.rows.filter(r=>r.period===prevP&&r.statement===t);
  const grouped=aggregate(rows,'item',t==='income'?'absValue':'value');
  const prevMap=new Map(aggregate(prevRows,'item',t==='income'?'absValue':'value').map(x=>[x.label,x.value]));
  const total=sum(grouped.map(x=>Math.abs(x.value)));
  $('statementCards').innerHTML=[
    kpiCard('إجمالي البنود',money(sum(grouped.map(x=>x.value))),NaN,statementLabel(t)),
    kpiCard('عدد الحسابات',number(grouped.length),NaN,`الفترة ${p}`),
    kpiCard('أكبر بند',grouped[0]?money(grouped[0].value):'—',NaN,grouped[0]?.label||'—'),
    kpiCard('الفترة السابقة',prevP||'—',NaN,prevP?'متاحة للمقارنة':'غير متاحة')
  ].join('');
  const top=grouped.slice(0,10);
  chart('vertical','verticalChart',{type:'bar',data:{labels:top.map(x=>x.label),datasets:[{data:top.map(x=>Math.abs(x.value)),backgroundColor:'#0e9384',borderRadius:8}]},options:{indexAxis:'y'}});
  const horiz=top.map(x=>({label:x.label,value:changePct(x.value,prevMap.get(x.label)||0)}));
  chart('horizontal','horizontalChart',{type:'bar',data:{labels:horiz.map(x=>x.label),datasets:[{data:horiz.map(x=>Number.isFinite(x.value)?x.value:0),backgroundColor:horiz.map(x=>x.value>=0?'#168a5b':'#c33d3d'),borderRadius:8}]},options:{indexAxis:'y'}});
  $('statementHead').innerHTML='<tr><th>البند</th><th>الفترة الحالية</th><th>الفترة السابقة</th><th>التغير</th><th>نسبة التغير</th><th>النسبة من الإجمالي</th></tr>';
  $('statementBody').innerHTML=grouped.length?grouped.map(x=>{const pv=prevMap.get(x.label)||0,d=x.value-pv,c=changePct(x.value,pv),share=total?Math.abs(x.value)/total*100:0;return `<tr><td>${escapeHtml(x.label)}</td><td>${money(x.value)}</td><td>${money(pv)}</td><td class="${d>=0?'good':'bad'}">${money(d)}</td><td>${pct(c)}</td><td>${pct(share)}</td></tr>`}).join(''):'<tr><td colspan="6" class="empty-state">لا توجد بيانات لهذه القائمة.</td></tr>';
}

function groupLabel(group){return ({liquidity:'السيولة',profitability:'الربحية',leverage:'المديونية',efficiency:'الكفاءة',growth:'النمو'})[group]||group;}
function ratioDisplay(r){return r.unit==='money'?money(r.value):r.unit==='%'?pct(r.value):`${ratioFmt(r.value)}×`;}
function renderRatios() {
  const p=$('ratioPeriod').value||state.period,g=$('ratioGroup').value||'all';
  const ratios=allRatios(p).filter(r=>g==='all'||r.group===g);
  $('ratioGrid').innerHTML=ratios.map(r=>{const ch=changePct(r.value,r.previous);const width=!Number.isFinite(r.value)?0:clamp(Math.abs(r.value),0,r.unit==='%'?100:3)/(r.unit==='%'?1:3)*100;return `<article class="ratio-card"><div class="ratio-top"><span class="ratio-group">${groupLabel(r.group)}</span><span class="ratio-rating ${r.rating}">${r.rating==='good'?'جيد':r.rating==='warn'?'متابعة':r.rating==='bad'?'خطر':'غير متاح'}</span></div><h3>${r.name}</h3><div class="ratio-number">${ratioDisplay(r)}</div><div class="ratio-meta"><span>السابق: ${Number.isFinite(r.previous)?ratioDisplay({...r,value:r.previous}):'—'}</span><span class="delta ${ch>=0?'up':'down'}">${Number.isFinite(ch)?pct(ch):'—'}</span></div><div class="ratio-track"><i style="width:${width}%"></i></div><p>${r.desc}</p></article>`}).join('')||'<div class="empty-state">لا توجد بيانات كافية لحساب النسب.</div>';
}

function comparisonData() {
  const dim=$('compareDimension').value,metric=$('compareMetric').value;
  let source=state.rows,mode='value';
  if(metric==='revenue') source=source.filter(isRevenue);
  else if(metric==='expenses'){source=source.filter(isExpense);mode='absValue';}
  else if(metric==='profit') {
    const labels=uniq(source.map(r=>clean(r[dim])||'غير محدد'));
    return labels.map(label=>{const subset=source.filter(r=>(clean(r[dim])||'غير محدد')===label);return {label,value:sum(subset.filter(isRevenue).map(r=>r.value))-sum(subset.filter(isExpense).map(r=>Math.abs(r.value)))}}).sort((a,b)=>b.value-a.value);
  } else if(metric==='budgetVariance') mode='budgetVariance';
  return aggregate(source,dim,mode);
}
function renderComparisons() {
  const data=comparisonData(),metricLabel=$('compareMetric').selectedOptions[0]?.text||'',dimLabel=$('compareDimension').selectedOptions[0]?.text||'';
  $('comparisonTitle').textContent=`${metricLabel} حسب ${dimLabel}`;
  chart('comparison','comparisonChart',{type:'bar',data:{labels:data.slice(0,12).map(x=>x.label),datasets:[{data:data.slice(0,12).map(x=>x.value),backgroundColor:data.slice(0,12).map(x=>x.value>=0?'#0e9384':'#c33d3d'),borderRadius:9}]}});
  const total=sum(data.map(x=>Math.abs(x.value)));
  $('rankingList').classList.toggle('empty-state',!data.length); $('rankingList').innerHTML=data.slice(0,8).map((x,i)=>`<div class="rank-item"><span class="rank-index">${i+1}</span><div><strong>${escapeHtml(x.label)}</strong><small>${pct(total?Math.abs(x.value)/total*100:0)} من الإجمالي</small></div><span class="rank-value">${money(x.value)}</span></div>`).join('')||'لا توجد بيانات.';
  $('comparisonHead').innerHTML='<tr><th>الترتيب</th><th>العنصر</th><th>القيمة</th><th>الحصة</th><th>مقارنة بالمتوسط</th></tr>';
  const avg=data.length?sum(data.map(x=>x.value))/data.length:0;
  $('comparisonBody').innerHTML=data.length?data.map((x,i)=>`<tr><td>${i+1}</td><td>${escapeHtml(x.label)}</td><td>${money(x.value)}</td><td>${pct(total?Math.abs(x.value)/total*100:0)}</td><td>${pct(changePct(x.value,avg))}</td></tr>`).join(''):'<tr><td colspan="5" class="empty-state">لا توجد بيانات.</td></tr>';
}

function renderInsights() {
  const p=$('insightPeriod').value||state.period,items=generateInsights(p),high=items.filter(i=>i.severity==='high').length,medium=items.filter(i=>i.severity==='medium').length;
  $('insightSummaryCards').innerHTML=[kpiCard('إجمالي الملاحظات',number(items.length),NaN,`الفترة ${p}`),kpiCard('عالية الأهمية',number(high),NaN,'تحتاج إجراء',high?'danger':'success'),kpiCard('متوسطة',number(medium),NaN,'تحتاج متابعة',medium?'warning':'success'),kpiCard('درجة الصحة',`${healthScore(p)}%`,NaN,'تقييم مركب','success')].join('');
  $('insightFeed').classList.toggle('empty-state',!items.length); $('insightFeed').innerHTML=items.map(i=>`<article class="insight-card ${i.severity}"><div class="insight-head"><strong>${escapeHtml(i.title)}</strong><span class="severity">${i.severity==='high'?'عالية':i.severity==='medium'?'متوسطة':'معلومة'}</span></div><p>${escapeHtml(i.text)}</p><div class="insight-action"><b>الإجراء المقترح:</b> ${escapeHtml(i.action)}</div></article>`).join('')||'حمّل البيانات لعرض التحليل الذكي.';
}

function renderReport() {
  $('reportDate').textContent=new Intl.DateTimeFormat('ar',{dateStyle:'long',timeStyle:'short'}).format(new Date());
  if(!state.rows.length){$('reportContent').className='empty-state';$('reportContent').innerHTML='لا توجد بيانات لإعداد التقرير.';return;}
  const p=state.period,m=metrics(p),ins=generateInsights(p),rat=allRatios(p).filter(r=>r.rating!=='na').slice(0,8);
  $('reportContent').className=''; $('reportContent').innerHTML=`<section class="report-section"><h3>الملخص التنفيذي</h3><p>${escapeHtml(buildExecutiveSummary(p))}</p><div class="report-kpis">${[['الإيرادات',money(m.revenue)],['المصروفات',money(m.expenses)],['صافي الربح',money(m.profit)],['درجة الصحة',healthScore(p)+'%']].map(x=>`<div class="report-kpi"><strong>${x[1]}</strong><span>${x[0]}</span></div>`).join('')}</div></section><section class="report-section"><h3>أهم الملاحظات</h3><ol>${ins.slice(0,6).map(i=>`<li><b>${escapeHtml(i.title)}:</b> ${escapeHtml(i.text)}</li>`).join('')}</ol></section><section class="report-section"><h3>النسب الرئيسية</h3><div class="table-wrap"><table><thead><tr><th>النسبة</th><th>النتيجة</th><th>التقييم</th></tr></thead><tbody>${rat.map(r=>`<tr><td>${r.name}</td><td>${ratioDisplay(r)}</td><td>${r.rating==='good'?'جيد':r.rating==='warn'?'متابعة':'خطر'}</td></tr>`).join('')}</tbody></table></div></section>`;
}

async function importFiles(files) {
  if (!files?.length) return;
  $('importProgress').classList.remove('hidden'); $('progressBar').style.width='12%'; $('progressText').textContent='جاري قراءة الملفات…';
  const imported=[]; const names=[];
  try {
    for (let i=0;i<files.length;i++) {
      const f=files[i],buf=await f.arrayBuffer(); names.push(f.name);
      $('progressBar').style.width=`${20+Math.round((i/files.length)*55)}%`; $('progressText').textContent=`تحليل ${f.name}…`;
      const wb=XLSX.read(buf,{type:'array',cellDates:true});
      wb.SheetNames.forEach(name=>{const raw=XLSX.utils.sheet_to_json(wb.Sheets[name],{defval:'',raw:true}); imported.push(...normalizeRows(raw));});
    }
    state.rows=[...state.rows,...imported]; state.sourceFiles=[...state.sourceFiles,...names]; state.lastImportAt=new Date().toISOString();
    state.quality=qualityCheck(); await saveState();
    $('progressBar').style.width='100%'; $('progressText').textContent=`تم استيراد ${number(imported.length)} سجل بنجاح.`; showToast(`تم استيراد ${number(imported.length)} سجل`); renderAll(); switchView('dashboard');
  } catch(err) { console.error(err); $('progressText').textContent='تعذر قراءة الملف. تأكد من تنسيق الأعمدة.'; showToast('حدث خطأ أثناء الاستيراد'); }
  setTimeout(()=>$('importProgress').classList.add('hidden'),1800);
}
async function loadSample() {
  try { const text=await fetch('./sample_financial_data.csv').then(r=>r.text()); const wb=XLSX.read(text,{type:'string'}); const raw=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:''}); state.rows=normalizeRows(raw);state.sourceFiles=['sample_financial_data.csv'];state.lastImportAt=new Date().toISOString();await saveState();renderAll();showToast('تم تحميل البيانات التجريبية');switchView('dashboard'); } catch(e){console.error(e);showToast('تعذر تحميل البيانات التجريبية');}
}

function download(name,content,type='text/plain;charset=utf-8') { const blob=new Blob([content],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000); }
function exportCsv() {
  const data=state.rows.map(r=>({'الفترة':r.period,'القائمة المالية':statementLabel(r.statement),'الفئة':r.category,'البند':r.item,'القيمة':r.value,'الفرع':r.branch,'مركز التكلفة':r.costCenter,'العميل':r.customer,'نوع التدفق النقدي':r.cashflowType,'الموازنة':r.budget,'العملة':r.currency}));
  const ws=XLSX.utils.json_to_sheet(data),csv='\ufeff'+XLSX.utils.sheet_to_csv(ws);download(`financial-data-${Date.now()}.csv`,csv,'text/csv;charset=utf-8');
}
function exportJson(){download(`financial-backup-${Date.now()}.json`,JSON.stringify({version:2,exportedAt:new Date().toISOString(),...state,charts:undefined,quality:state.quality},null,2),'application/json');}
function exportSummary(){const p=state.period,lines=[`تقرير التحليل المالي - ${p}`,buildExecutiveSummary(p),'',...generateInsights(p).map((i,idx)=>`${idx+1}. ${i.title}\n${i.text}\nالإجراء: ${i.action}`)];download(`financial-summary-${p}.txt`,lines.join('\n\n'));}
function downloadTemplate(){const csv='\ufeffالفترة,القائمة المالية,الفئة,البند,القيمة,الفرع,مركز التكلفة,العميل,نوع التدفق النقدي,الموازنة,العملة\n2026,قائمة الدخل,الإيرادات,إيرادات الخدمات,0,الرئيسي,الإدارة,عميل أ,تشغيلي,0,SAR';download('financial-analysis-template.csv',csv,'text/csv;charset=utf-8');}

function switchView(view) {
  $$('.view').forEach(el=>el.classList.toggle('active',el.id===`view-${view}`));
  $$('.nav-item,.bottom-item').forEach(el=>el.classList.toggle('active',el.dataset.view===view));
  const [title,sub]=VIEW_META[view]||VIEW_META.dashboard;$('pageTitle').textContent=title;$('pageSubtitle').textContent=sub;
  $('sidebar').classList.remove('open');$('overlay').classList.add('hidden');
  if(view==='statements')renderStatements();if(view==='ratios')renderRatios();if(view==='comparisons')renderComparisons();if(view==='insights')renderInsights();if(view==='reports')renderReport();
  window.scrollTo({top:0,behavior:'smooth'});
}
function showToast(text){const el=$('toast');el.textContent=text;el.classList.remove('hidden');clearTimeout(showToast.t);showToast.t=setTimeout(()=>el.classList.add('hidden'),2600);}

const DB_NAME='financial-analysis-mobile',STORE='app';
function openDb(){return new Promise((resolve,reject)=>{const req=indexedDB.open(DB_NAME,1);req.onupgradeneeded=()=>req.result.createObjectStore(STORE);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
async function saveState(){try{const db=await openDb();await new Promise((res,rej)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put({rows:state.rows,period:state.period,sourceFiles:state.sourceFiles,lastImportAt:state.lastImportAt},'state');tx.oncomplete=res;tx.onerror=()=>rej(tx.error);});db.close();}catch(e){localStorage.setItem('financial-state',JSON.stringify({rows:state.rows,period:state.period,sourceFiles:state.sourceFiles,lastImportAt:state.lastImportAt}));}}
async function loadState(){try{const db=await openDb();const saved=await new Promise((res,rej)=>{const tx=db.transaction(STORE);const req=tx.objectStore(STORE).get('state');req.onsuccess=()=>res(req.result);req.onerror=()=>rej(req.error);});db.close();if(saved)Object.assign(state,saved);}catch{const s=localStorage.getItem('financial-state');if(s)Object.assign(state,JSON.parse(s));}}

function bindEvents() {
  $$('.nav-item,.bottom-item').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.view)));
  $('menuBtn').addEventListener('click',()=>{$('sidebar').classList.add('open');$('overlay').classList.remove('hidden');});
  $('overlay').addEventListener('click',()=>{$('sidebar').classList.remove('open');$('overlay').classList.add('hidden');});
  ['quickImportBtn','chooseFilesBtn'].forEach(id=>$(id).addEventListener('click',e=>{e.stopPropagation();$('fileInput').click();}));
  $('dropZone').addEventListener('click',e=>{if(e.target.id!=='chooseFilesBtn')$('fileInput').click();});
  $('dropZone').addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' ')$('fileInput').click();});
  $('fileInput').addEventListener('change',e=>importFiles([...e.target.files]));
  ['dragenter','dragover'].forEach(ev=>$('dropZone').addEventListener(ev,e=>{e.preventDefault();$('dropZone').classList.add('dragging');}));
  ['dragleave','drop'].forEach(ev=>$('dropZone').addEventListener(ev,e=>{e.preventDefault();$('dropZone').classList.remove('dragging');}));
  $('dropZone').addEventListener('drop',e=>importFiles([...e.dataTransfer.files]));
  $('loadSampleBtn').addEventListener('click',loadSample);
  $('clearDataBtn').addEventListener('click',async()=>{if(!confirm('سيتم حذف جميع البيانات المحفوظة داخل التطبيق. هل تريد المتابعة؟'))return;state.rows=[];state.period='';state.sourceFiles=[];await saveState();renderAll();showToast('تم حذف البيانات');});
  $('globalPeriod').addEventListener('change',e=>{state.period=e.target.value;['statementPeriod','ratioPeriod','insightPeriod'].forEach(id=>$(id).value=state.period);saveState();renderAll();});
  $('statementPeriod').addEventListener('change',renderStatements);$('statementType').addEventListener('change',renderStatements);
  $('ratioPeriod').addEventListener('change',renderRatios);$('ratioGroup').addEventListener('change',renderRatios);
  $('compareDimension').addEventListener('change',renderComparisons);$('compareMetric').addEventListener('change',renderComparisons);
  $('insightPeriod').addEventListener('change',renderInsights);$('runQualityBtn').addEventListener('click',()=>{state.quality=qualityCheck();renderQuality();showToast('اكتمل فحص جودة البيانات');});
  $('exportJsonBtn').addEventListener('click',exportJson);$('exportCsvBtn').addEventListener('click',exportCsv);$('exportSummaryBtn').addEventListener('click',exportSummary);$('printReportBtn').addEventListener('click',()=>window.print());$('downloadTemplateBtn').addEventListener('click',downloadTemplate);
}

await loadState();
bindEvents();
renderAll();
