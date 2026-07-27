const DB='financial-analysis-mobile';
const STORE='app';
const KEY='financial-ratio-inputs-v1';

const clean=v=>String(v??'').trim();
const norm=v=>clean(v).toLowerCase().replace(/[\s_\-–—/\\]+/g,' ').replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').trim();
const finite=v=>Number.isFinite(Number(v));
const n=v=>finite(v)?Number(v):NaN;
const sum=values=>values.reduce((a,v)=>a+(finite(v)?Number(v):0),0);
const div=(a,b)=>finite(a)&&finite(b)&&Number(b)!==0?Number(a)/Number(b):NaN;
const unique=values=>[...new Set(values.filter(v=>clean(v)!==''))];
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const escapeHtml=v=>clean(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function openDb(){return new Promise((resolve,reject)=>{const req=indexedDB.open(DB,1);req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(STORE))req.result.createObjectStore(STORE)};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
async function readState(){try{const db=await openDb();const value=await new Promise((resolve,reject)=>{const req=db.transaction(STORE).objectStore(STORE).get('state');req.onsuccess=()=>resolve(req.result||{});req.onerror=()=>reject(req.error)});db.close();return value}catch{try{return JSON.parse(localStorage.getItem('financial-state')||'{}')}catch{return {}}}}
function readManual(){try{return JSON.parse(localStorage.getItem(KEY)||'{}')}catch{return {}}}
function saveManual(data){localStorage.setItem(KEY,JSON.stringify(data))}

function money(value,currency='SAR'){if(!finite(value))return '—';try{return new Intl.NumberFormat('ar',{style:'currency',currency,maximumFractionDigits:0}).format(Number(value))}catch{return `${new Intl.NumberFormat('ar',{maximumFractionDigits:0}).format(Number(value))} ${currency}`}}
function number(value,digits=2){return finite(value)?new Intl.NumberFormat('ar',{maximumFractionDigits:digits}).format(Number(value)):'—'}
function percent(value){return finite(value)?`${number(value,1)}%`:'—'}

const detailed=rows=>rows.filter(r=>!r.generated&&!/^(اجمالي|المجموع|total)/.test(norm(r.item)));
const matching=(rows,patterns)=>rows.filter(r=>patterns.some(rx=>rx.test(norm(r.item))));
const exact=(rows,patterns)=>{const row=rows.find(r=>patterns.some(rx=>rx.test(norm(r.item))));return row?n(row.value):NaN};
const totalOr=(rows,patterns,fallback)=>{const value=exact(rows,patterns);return finite(value)?value:sum(fallback().map(r=>r.value))};
function incomeType(row){const text=norm(`${row.category} ${row.item}`);if(/ايراد|مبيعات|دخل|revenue|sales/.test(text)&&!/مصروف|تكلف|expense|cost/.test(text))return'revenue';if(/مصروف|تكلف|رواتب|اجور|ايجار|ضريب|استهلاك|اطفاء|فوائد|عمولات|expense|cost|tax|interest/.test(text))return'expense';return'other'}
function flowType(row){const text=norm(`${row.cashflowType} ${row.category} ${row.item}`);return/تشغيل|operat/.test(text)?'operating':/استثمار|invest/.test(text)?'investing':/تمويل|financ/.test(text)?'financing':'other'}

function derive(rows,period){
  const periodRows=rows.filter(r=>clean(r.period)===clean(period));
  const balance=periodRows.filter(r=>r.statement==='balance');
  const balanceDetails=detailed(balance);
  const income=detailed(periodRows.filter(r=>r.statement==='income'));
  const cashflow=detailed(periodRows.filter(r=>r.statement==='cashflow'));
  const assets=balanceDetails.filter(r=>/اصول|asset/.test(norm(r.category)));
  const liabilities=balanceDetails.filter(r=>/خصوم|التزام|liabilit/.test(norm(r.category)));
  const equityRows=balanceDetails.filter(r=>/حقوق|ملكي|equity/.test(norm(r.category)));
  const isCurrent=(r,type)=>{const text=norm(`${r.accountGroup} ${r.item}`);if(/غير.*متداول|طويل.*اجل|ثابت|non current|long term/.test(text))return false;return r.isCurrent||new RegExp(type==='asset'?'متداول|نقد|بنك|ذمم.*مدين|عميل|مخزون|مقدم|current':'متداول|قصير.*اجل|مورد|ذمم.*دائن|مستحق|current').test(text)};
  const currentAssetRows=assets.filter(r=>isCurrent(r,'asset'));
  const currentLiabilityRows=liabilities.filter(r=>isCurrent(r,'liability'));
  const cash=sum(matching(assets,[/نقد/,/صندوق/,/بنك/,/cash/,/bank/]).map(r=>r.value));
  const receivables=sum(matching(assets,[/ذمم.*مدين/,/عملاء/,/receivable/]).map(r=>r.value));
  const inventory=sum(matching(assets,[/مخزون/,/بضاعه/,/inventory/]).map(r=>r.value));
  const payables=sum(matching(liabilities,[/ذمم.*دائن/,/مورد/,/payable/]).map(r=>r.value));
  const currentAssets=totalOr(balance,[/^اجمالي الاصول المتداوله$/,/^total current assets$/],()=>currentAssetRows);
  const totalAssets=totalOr(balance,[/^اجمالي الاصول$/,/^total assets$/],()=>assets);
  const currentLiabilities=totalOr(balance,[/^اجمالي الخصوم المتداوله$/,/^total current liabilit/],()=>currentLiabilityRows);
  const totalLiabilities=totalOr(balance,[/^اجمالي الخصوم$/,/^total liabilit/],()=>liabilities);
  const equity=totalOr(balance,[/^حقوق الملكيه$/,/^اجمالي حقوق الملكيه$/,/^total equity$/],()=>equityRows);
  const revenues=income.filter(r=>incomeType(r)==='revenue');
  const expenses=income.filter(r=>incomeType(r)==='expense');
  const revenue=sum(revenues.map(r=>Math.abs(Number(r.value)||0)));
  const totalExpenses=sum(expenses.map(r=>Math.abs(Number(r.value)||0)));
  const cogs=sum(matching(expenses,[/تكلف.*مبيعات/,/تكلف.*بضاع/,/تكلف.*خدم/,/cost of sales/,/cost of goods/]).map(r=>Math.abs(Number(r.value)||0)));
  const financeCost=sum(matching(expenses,[/فوائد/,/تكاليف.*تمويل/,/عمولات.*بنكي/,/finance cost/,/interest expense/]).map(r=>Math.abs(Number(r.value)||0)));
  const tax=sum(matching(expenses,[/ضريب.*دخل/,/income tax/]).map(r=>Math.abs(Number(r.value)||0)));
  const depreciation=sum(matching(expenses,[/استهلاك/,/depreciation/]).map(r=>Math.abs(Number(r.value)||0)));
  const amortization=sum(matching(expenses,[/اطفاء/,/amortization/]).map(r=>Math.abs(Number(r.value)||0)));
  const netIncome=revenue-totalExpenses;
  const operatingProfit=revenue-(totalExpenses-financeCost-tax);
  const ebitda=operatingProfit+depreciation+amortization;
  const loans=sum(matching(liabilities,[/قرض/,/تسهيلات/,/سحب.*مكشوف/,/borrow/,/loan/,/debt/]).map(r=>Math.abs(Number(r.value)||0)));
  const leases=sum(matching(liabilities,[/التزام.*ايجار/,/lease liabilit/]).map(r=>Math.abs(Number(r.value)||0)));
  const totalDebt=loans+leases;
  const operatingCash=sum(cashflow.filter(r=>flowType(r)==='operating').map(r=>r.value));
  const capex=Math.abs(sum(matching(cashflow,[/شراء.*(ممتلك|اصول|معدات|الات)/,/انفاق.*راس/,/capital expenditure/,/purchase.*property/,/purchase.*equipment/]).map(r=>r.value)));
  const interestPaid=Math.abs(sum(matching(cashflow,[/فوائد.*مدفوع/,/interest paid/]).map(r=>r.value)));
  const principalPaid=Math.abs(sum(matching(cashflow,[/سداد.*(قرض|اصل)/,/loan repayment/,/principal repayment/]).map(r=>r.value)));
  const dividendsPaid=Math.abs(sum(matching(cashflow,[/توزيعات.*ارباح/,/dividend/]).map(r=>r.value)));
  const currency=periodRows.find(r=>r.currency)?.currency||rows.find(r=>r.currency)?.currency||'SAR';
  return {period,currency,cash,receivables,inventory,payables,currentAssets,totalAssets,currentLiabilities,totalLiabilities,equity,revenue,totalExpenses,cogs,financeCost,netIncome,operatingProfit,ebitda,totalDebt,operatingCash,capex,interestPaid,principalPaid,dividendsPaid};
}

const groups=[
  {id:'efficiency',title:'الكفاءة ودورة رأس المال العامل',description:'لدوران المخزون والتحصيل والسداد ودورة التحويل النقدي.',fields:[
    ['creditSales','المبيعات الآجلة','يستخدم إجمالي الإيرادات كتقدير عند تركه فارغًا.'],['creditPurchases','المشتريات الآجلة','تُقدّر من تكلفة المبيعات وحركة المخزون عند الإمكان.'],['openingInventory','مخزون أول الفترة','يُستخرج من الفترة السابقة عند توفرها.'],['closingInventory','مخزون آخر الفترة','يُستخرج من ميزان المراجعة الحالي.'],['openingReceivables','ذمم العملاء أول الفترة','يُستخرج من الفترة السابقة.'],['closingReceivables','ذمم العملاء آخر الفترة','يُستخرج من الفترة الحالية.'],['openingPayables','ذمم الموردين أول الفترة','يُستخرج من الفترة السابقة.'],['closingPayables','ذمم الموردين آخر الفترة','يُستخرج من الفترة الحالية.'],['days','عدد أيام الفترة','365 افتراضيًا ويمكن تغييره إلى 360.']
  ]},
  {id:'cashflow',title:'التدفقات وخدمة الدين',description:'للتدفق الحر وجودة الأرباح وتغطية خدمة الدين.',fields:[
    ['interestPaid','الفوائد المدفوعة نقدًا','يُستخرج من التدفقات عند وجود بند صريح.'],['principalPaid','أصل القروض المسدد','لا يشمل مصروف الفائدة.'],['capex','الإنفاق الرأسمالي','شراء الممتلكات والآلات والمعدات.'],['dividendsPaid','توزيعات الأرباح المدفوعة','لتغطية التوزيعات ونسبة التوزيع.']
  ]},
  {id:'market',title:'بيانات الأسهم والسوق – اختيارية',description:'للشركات المساهمة ونسب السوق فقط.',fields:[
    ['shares','المتوسط المرجح لعدد الأسهم','لحساب ربحية السهم.'],['sharePrice','سعر السهم','السعر في تاريخ التحليل.'],['preferredDividends','توزيعات الأسهم الممتازة','صفر افتراضيًا إذا لم توجد.']
  ]}
];

function automatic(current,previous){
  const openingInventory=previous?.inventory;
  const openingReceivables=previous?.receivables;
  const openingPayables=previous?.payables;
  const purchases=finite(openingInventory)?current.cogs+current.inventory-openingInventory:NaN;
  return {
    creditSales:{value:current.revenue,source:'تقديري من إجمالي الإيرادات',quality:'estimated'},creditPurchases:{value:purchases,source:'تقديري من تكلفة المبيعات وحركة المخزون',quality:'estimated'},
    openingInventory:{value:openingInventory,source:'ميزان الفترة السابقة',quality:'auto'},closingInventory:{value:current.inventory,source:'ميزان المراجعة',quality:'auto'},
    openingReceivables:{value:openingReceivables,source:'ميزان الفترة السابقة',quality:'auto'},closingReceivables:{value:current.receivables,source:'ميزان المراجعة',quality:'auto'},
    openingPayables:{value:openingPayables,source:'ميزان الفترة السابقة',quality:'auto'},closingPayables:{value:current.payables,source:'ميزان المراجعة',quality:'auto'},
    days:{value:365,source:'قيمة افتراضية',quality:'default'},interestPaid:{value:current.interestPaid||NaN,source:'التدفقات النقدية',quality:'auto'},
    principalPaid:{value:current.principalPaid||NaN,source:'التدفقات النقدية',quality:'auto'},capex:{value:current.capex||NaN,source:'التدفقات النقدية',quality:'auto'},
    dividendsPaid:{value:current.dividendsPaid||NaN,source:'التدفقات النقدية',quality:'auto'},shares:{value:NaN,source:'إدخال يدوي',quality:'missing'},sharePrice:{value:NaN,source:'إدخال يدوي',quality:'missing'},preferredDividends:{value:0,source:'مفترض عدم وجودها',quality:'default'}
  };
}
function resolveValue(name,manual,auto){return own(manual,name)&&clean(manual[name])!==''?{value:Number(manual[name]),source:'أدخله المستخدم',quality:'manual'}:(auto[name]||{value:NaN,source:'غير متوفر',quality:'missing'})}
function average(a,b){return finite(a)&&finite(b)?(Number(a)+Number(b))/2:finite(b)?Number(b):NaN}

function calculate(current,previous,manual){
  const auto=automatic(current,previous),get=name=>resolveValue(name,manual,auto).value;
  const avgInventory=average(get('openingInventory'),get('closingInventory'));
  const avgReceivables=average(get('openingReceivables'),get('closingReceivables'));
  const avgPayables=average(get('openingPayables'),get('closingPayables'));
  const avgAssets=average(previous?.totalAssets,current.totalAssets);
  const avgEquity=average(previous?.equity,current.equity);
  const avgWorkingCapital=average(previous?previous.currentAssets-previous.currentLiabilities:NaN,current.currentAssets-current.currentLiabilities);
  const inventoryTurnover=div(current.cogs,avgInventory),receivableTurnover=div(get('creditSales'),avgReceivables),payableTurnover=div(get('creditPurchases'),avgPayables);
  const dio=div(get('days'),inventoryTurnover),dso=div(get('days'),receivableTurnover),dpo=div(get('days'),payableTurnover);
  const fcf=finite(current.operatingCash)&&finite(get('capex'))?current.operatingCash-get('capex'):NaN;
  const eps=div(current.netIncome-(get('preferredDividends')||0),get('shares'));
  const bvps=div(current.equity,get('shares'));
  const dps=div(get('dividendsPaid'),get('shares'));
  const ratios=[
    ['السيولة','نسبة التداول',div(current.currentAssets,current.currentLiabilities),'x','الأصول المتداولة ÷ الخصوم المتداولة'],['السيولة','النسبة السريعة',div(current.currentAssets-current.inventory,current.currentLiabilities),'x','(الأصول المتداولة − المخزون) ÷ الخصوم المتداولة'],['السيولة','النسبة النقدية',div(current.cash,current.currentLiabilities),'x','النقدية ÷ الخصوم المتداولة'],['السيولة','رأس المال العامل',current.currentAssets-current.currentLiabilities,'money','الأصول المتداولة − الخصوم المتداولة'],
    ['الربحية','هامش مجمل الربح',div(current.revenue-current.cogs,current.revenue)*100,'%','مجمل الربح ÷ الإيرادات'],['الربحية','هامش الربح التشغيلي',div(current.operatingProfit,current.revenue)*100,'%','الربح التشغيلي ÷ الإيرادات'],['الربحية','هامش EBITDA',div(current.ebitda,current.revenue)*100,'%','EBITDA ÷ الإيرادات'],['الربحية','هامش صافي الربح',div(current.netIncome,current.revenue)*100,'%','صافي الربح ÷ الإيرادات'],['الربحية','العائد على الأصول',div(current.netIncome,avgAssets)*100,'%','صافي الربح ÷ متوسط الأصول'],['الربحية','العائد على حقوق الملكية',div(current.netIncome,avgEquity)*100,'%','صافي الربح ÷ متوسط حقوق الملكية'],
    ['المديونية','الخصوم إلى الأصول',div(current.totalLiabilities,current.totalAssets)*100,'%','إجمالي الخصوم ÷ إجمالي الأصول'],['المديونية','الدين إلى حقوق الملكية',div(current.totalDebt,current.equity),'x','الدين المالي ÷ حقوق الملكية'],['المديونية','تغطية الفوائد',div(current.operatingProfit,current.financeCost),'x','الربح التشغيلي ÷ تكلفة التمويل'],['المديونية','صافي الدين إلى EBITDA',div(current.totalDebt-current.cash,current.ebitda),'x','(الدين − النقدية) ÷ EBITDA'],
    ['الكفاءة','دوران المخزون',inventoryTurnover,'x','تكلفة المبيعات ÷ متوسط المخزون'],['الكفاءة','أيام الاحتفاظ بالمخزون',dio,'days','أيام الفترة ÷ دوران المخزون'],['الكفاءة','دوران الذمم المدينة',receivableTurnover,'x','المبيعات الآجلة ÷ متوسط الذمم'],['الكفاءة','متوسط فترة التحصيل',dso,'days','أيام الفترة ÷ دوران الذمم'],['الكفاءة','دوران الذمم الدائنة',payableTurnover,'x','المشتريات الآجلة ÷ متوسط الموردين'],['الكفاءة','متوسط فترة السداد',dpo,'days','أيام الفترة ÷ دوران الموردين'],['الكفاءة','دورة التحويل النقدي',finite(dio)&&finite(dso)&&finite(dpo)?dio+dso-dpo:NaN,'days','المخزون + التحصيل − السداد'],['الكفاءة','دوران الأصول',div(current.revenue,avgAssets),'x','الإيرادات ÷ متوسط الأصول'],['الكفاءة','دوران رأس المال العامل',div(current.revenue,avgWorkingCapital),'x','الإيرادات ÷ متوسط رأس المال العامل'],
    ['التدفقات','التدفق التشغيلي إلى الخصوم المتداولة',div(current.operatingCash,current.currentLiabilities),'x','التدفق التشغيلي ÷ الخصوم المتداولة'],['التدفقات','التدفق التشغيلي إلى الدين',div(current.operatingCash,current.totalDebt),'x','التدفق التشغيلي ÷ الدين'],['التدفقات','التدفق النقدي الحر',fcf,'money','التدفق التشغيلي − الإنفاق الرأسمالي'],['التدفقات','هامش التدفق النقدي الحر',div(fcf,current.revenue)*100,'%','التدفق الحر ÷ الإيرادات'],['التدفقات','جودة الأرباح',div(current.operatingCash,current.netIncome),'x','التدفق التشغيلي ÷ صافي الربح'],['التدفقات','تغطية خدمة الدين النقدية',div(current.operatingCash,(get('interestPaid')||0)+(get('principalPaid')||0)),'x','التدفق التشغيلي ÷ خدمة الدين'],['التدفقات','تغطية توزيعات الأرباح',div(fcf,get('dividendsPaid')),'x','التدفق الحر ÷ التوزيعات'],
    ['السوق','ربحية السهم',eps,'money','الربح العائد للمساهمين ÷ عدد الأسهم'],['السوق','مكرر الربحية',div(get('sharePrice'),eps),'x','سعر السهم ÷ ربحية السهم'],['السوق','القيمة الدفترية للسهم',bvps,'money','حقوق الملكية ÷ عدد الأسهم'],['السوق','السعر إلى القيمة الدفترية',div(get('sharePrice'),bvps),'x','سعر السهم ÷ القيمة الدفترية'],['السوق','نسبة توزيع الأرباح',div(get('dividendsPaid'),current.netIncome)*100,'%','التوزيعات ÷ صافي الربح'],['السوق','عائد التوزيعات',div(dps,get('sharePrice'))*100,'%','توزيع السهم ÷ سعر السهم']
  ].map(([group,name,value,unit,formula])=>({group,name,value,unit,formula}));
  return {auto,ratios};
}

function completion(current,manual,calc){
  const sets={liquidity:[current.currentAssets,current.currentLiabilities,current.cash,current.inventory],profitability:[current.revenue,current.cogs,current.operatingProfit,current.netIncome,current.totalAssets,current.equity],leverage:[current.totalDebt,current.cash,current.ebitda,current.financeCost,current.operatingProfit],efficiency:['creditSales','creditPurchases','openingInventory','closingInventory','openingReceivables','closingReceivables','openingPayables','closingPayables','days'].map(k=>resolveValue(k,manual,calc.auto)),cashflow:[{value:current.operatingCash,quality:'auto'},...['capex','interestPaid','principalPaid','dividendsPaid'].map(k=>resolveValue(k,manual,calc.auto))],market:['shares','sharePrice'].map(k=>resolveValue(k,manual,calc.auto))};
  const score=list=>{let points=0;list.forEach(item=>{const obj=typeof item==='object'?item:{value:item,quality:'auto'};if(finite(obj.value))points+=(obj.quality==='estimated'||obj.quality==='default')?0.6:1});return Math.round(points/list.length*100)};
  return Object.fromEntries(Object.entries(sets).map(([name,list])=>[name,score(list)]));
}
function sourceClass(q){return ['manual','auto','estimated','default'].includes(q)?q:'missing'}
function ratioFormat(r,currency){return r.unit==='money'?money(r.value,currency):r.unit==='%'?percent(r.value):r.unit==='days'?`${number(r.value,1)} يوم`:r.unit==='x'?`${number(r.value,2)}×`:number(r.value)}

function addStyle(){if(document.getElementById('ratioDataStyle'))return;const style=document.createElement('style');style.id='ratioDataStyle';style.textContent=`.rd-auto,.rd-ratios{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.rd-card{border:1px solid #dce5ea;border-radius:14px;padding:14px;background:#fff}.rd-card span{display:block;color:#64748b;font-size:.8rem}.rd-card strong{display:block;margin:7px 0;color:#17324d}.rd-source{display:inline-flex!important;width:max-content;padding:4px 8px;border-radius:999px;font-size:.72rem!important;font-weight:700}.rd-source.auto{background:#dcfce7;color:#166534}.rd-source.manual{background:#dbeafe;color:#1d4ed8}.rd-source.estimated{background:#fef3c7;color:#92400e}.rd-source.default{background:#f1f5f9;color:#475569}.rd-source.missing{background:#fee2e2;color:#991b1b}.rd-groups{display:grid;gap:14px;margin:16px 0}.rd-group{border:1px solid #dce5ea;border-radius:17px;background:#fff;overflow:hidden}.rd-head{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:16px 18px;background:#f8fafc}.rd-head h3{margin:0 0 4px}.rd-head p{margin:0;color:#64748b}.rd-progress{font-weight:800;color:#0f766e}.rd-fields{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;padding:16px}.rd-field{border:1px solid #e5eaee;border-radius:12px;padding:12px}.rd-field label{display:block;font-weight:750;margin-bottom:7px}.rd-field input{width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:9px;font:inherit}.rd-field small{display:block;color:#64748b;margin-top:6px;min-height:34px}.rd-meta{display:flex;justify-content:space-between;align-items:center;gap:6px;margin-top:8px;font-size:.74rem}.rd-ratio.unavailable{background:#f8fafc;opacity:.7}.rd-ratio small{display:block;color:#64748b;line-height:1.5}.rd-group-name{font-size:.72rem!important;color:#0f766e!important;font-weight:800}.rd-note{grid-column:1/-1;padding:10px 12px;border-radius:10px;background:#fff7ed;color:#9a3412}@media(max-width:1100px){.rd-auto,.rd-ratios{grid-template-columns:repeat(2,minmax(0,1fr))}.rd-fields{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:680px){.rd-auto,.rd-ratios,.rd-fields{grid-template-columns:1fr}.rd-head{align-items:flex-start;flex-direction:column}}`;document.head.appendChild(style)}
function activate(){document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id==='view-ratio-data'));document.querySelectorAll('.nav-item,.bottom-item').forEach(v=>v.classList.toggle('active',v.dataset.view==='ratio-data'));document.getElementById('pageTitle').textContent='استكمال بيانات النسب';document.getElementById('pageSubtitle').textContent='القيم المستخرجة والبيانات الناقصة للنسب المتقدمة';document.getElementById('sidebar')?.classList.remove('open');document.getElementById('overlay')?.classList.add('hidden');render();window.scrollTo({top:0,behavior:'smooth'})}
function addView(){if(document.getElementById('view-ratio-data'))return;const ratioNav=document.querySelector('.nav-item[data-view="ratios"]');if(ratioNav){const button=document.createElement('button');button.className='nav-item';button.dataset.view='ratio-data';button.innerHTML='<span>＋</span> استكمال بيانات النسب';ratioNav.insertAdjacentElement('afterend',button);button.onclick=activate}const section=document.createElement('section');section.id='view-ratio-data';section.className='view';section.innerHTML=`<div class="section-intro"><div><span class="eyebrow">رفع دقة التحليل</span><h2>استكمال بيانات النسب المالية</h2><p>القيم الموجودة في القوائم تظهر تلقائيًا، ويُطلب منك فقط استكمال الناقص.</p></div><div class="filter-row"><select id="rdPeriod" class="control"></select><button id="rdSave" class="btn primary">حفظ</button><button id="rdReset" class="btn ghost">مسح إدخال الفترة</button></div></div><div id="rdSummary" class="kpi-grid compact-grid"></div><article class="panel"><div class="panel-head"><div><span class="eyebrow">المصدر</span><h3>البيانات المستخرجة تلقائيًا</h3></div></div><div id="rdAuto" class="rd-auto"></div></article><div id="rdGroups" class="rd-groups"></div><article class="panel"><div class="panel-head"><div><span class="eyebrow">النتيجة</span><h3>معاينة النسب المتاحة</h3></div></div><div id="rdPreview" class="rd-ratios"></div></article>`;const reports=document.getElementById('view-reports');reports?.parentNode.insertBefore(section,reports);const ratioView=document.getElementById('view-ratios'),intro=ratioView?.querySelector('.section-intro');if(intro){const button=document.createElement('button');button.className='btn ghost';button.textContent='استكمال البيانات الناقصة';button.onclick=activate;intro.appendChild(button)}if(ratioView){const panel=document.createElement('article');panel.className='panel';panel.innerHTML='<div class="panel-head"><div><span class="eyebrow">نسب إضافية</span><h3>الكفاءة والتدفقات ونسب السوق</h3></div><button class="btn ghost" id="rdEdit">إدخال البيانات</button></div><div id="rdAdvanced" class="rd-ratios"></div>';ratioView.appendChild(panel);panel.querySelector('#rdEdit').onclick=activate}}

const autoCards=current=>[['الإيرادات',current.revenue,'قائمة الدخل'],['تكلفة المبيعات',current.cogs,'قائمة الدخل'],['صافي الربح',current.netIncome,'قائمة الدخل'],['الربح التشغيلي',current.operatingProfit,'محسوب'],['النقدية',current.cash,'ميزان المراجعة'],['الذمم المدينة',current.receivables,'ميزان المراجعة'],['المخزون',current.inventory,'ميزان المراجعة'],['الذمم الدائنة',current.payables,'ميزان المراجعة'],['الأصول المتداولة',current.currentAssets,'ميزان المراجعة'],['الخصوم المتداولة',current.currentLiabilities,'ميزان المراجعة'],['إجمالي الأصول',current.totalAssets,'ميزان المراجعة'],['حقوق الملكية',current.equity,'ميزان المراجعة'],['إجمالي الدين',current.totalDebt,'ميزان المراجعة'],['EBITDA',current.ebitda,'محسوب'],['التدفق التشغيلي',current.operatingCash,'التدفقات النقدية'],['تكلفة التمويل',current.financeCost,'قائمة الدخل']];
async function getContext(selected=''){const state=await readState(),rows=Array.isArray(state.rows)?state.rows:[],periods=unique(rows.map(r=>clean(r.period))).sort((a,b)=>a.localeCompare(b,'ar',{numeric:true})),period=periods.includes(selected)?selected:(periods.includes(state.period)?state.period:periods.at(-1)||''),index=periods.indexOf(period);return{state,rows,period,periods,current:derive(rows,period),previous:index>0?derive(rows,periods[index-1]):null}}
function ratioCards(ratios,currency){return ratios.map(r=>`<div class="rd-card rd-ratio ${finite(r.value)?'':'unavailable'}"><span class="rd-group-name">${r.group}</span><strong>${r.name}</strong><span>${ratioFormat(r,currency)}</span><small>${r.formula}</small></div>`).join('')}
async function render(){const select=document.getElementById('rdPeriod');if(!select)return;const ctx=await getContext(select.value),manual=readManual()[ctx.period]||{},calc=calculate(ctx.current,ctx.previous,manual),scores=completion(ctx.current,manual,calc);select.innerHTML=ctx.periods.length?ctx.periods.map(p=>`<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join(''):'<option value="">لا توجد فترات</option>';select.value=ctx.period;const core=Math.round((scores.liquidity+scores.profitability+scores.leverage+scores.efficiency+scores.cashflow)/5),estimated=Object.keys(calc.auto).filter(k=>resolveValue(k,manual,calc.auto).quality==='estimated').length,missing=Object.keys(calc.auto).filter(k=>resolveValue(k,manual,calc.auto).quality==='missing').length;document.getElementById('rdSummary').innerHTML=[['اكتمال البيانات الأساسية',`${core}%`],['الكفاءة',`${scores.efficiency}%`],['التدفقات وخدمة الدين',`${scores.cashflow}%`],['تقديري / ناقص',`${estimated} / ${missing}`]].map(([label,value])=>`<article class="kpi-card"><div class="kpi-label">${label}</div><div class="kpi-value">${value}</div><div class="kpi-foot"><span>الفترة ${escapeHtml(ctx.period||'—')}</span></div></article>`).join('');document.getElementById('rdAuto').innerHTML=autoCards(ctx.current).map(([label,value,source])=>`<div class="rd-card"><span>${label}</span><strong>${money(value,ctx.current.currency)}</strong><span class="rd-source auto">${source}</span></div>`).join('');document.getElementById('rdGroups').innerHTML=groups.map(group=>`<section class="rd-group"><div class="rd-head"><div><h3>${group.title}</h3><p>${group.description}</p></div><div class="rd-progress">${scores[group.id]}% مكتمل</div></div><div class="rd-fields">${group.fields.map(([name,label,hint])=>{const automaticValue=calc.auto[name]||{},effective=resolveValue(name,manual,calc.auto),value=own(manual,name)?manual[name]:'',placeholder=finite(automaticValue.value)?automaticValue.value:'';return`<div class="rd-field"><label>${label}</label><input data-rd-field="${name}" type="number" step="any" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}"><small>${hint}</small><div class="rd-meta"><span class="rd-source ${sourceClass(effective.quality)}">${effective.source}</span><span>${finite(effective.value)?number(effective.value):'مطلوب'}</span></div></div>`}).join('')}</div></section>`).join('');const available=calc.ratios.filter(r=>finite(r.value)).length;document.getElementById('rdPreview').innerHTML=ratioCards(calc.ratios,ctx.current.currency)+`<div class="rd-note">يمكن حساب ${available} من ${calc.ratios.length} نسبة. القيم التقديرية مميزة ويمكن استبدالها بأرقام فعلية.</div>`;renderAdvanced(calc,ctx.current.currency)}
function renderAdvanced(calc,currency){const host=document.getElementById('rdAdvanced');if(host)host.innerHTML=ratioCards(calc.ratios.filter(r=>['الكفاءة','التدفقات','السوق'].includes(r.group)),currency)}
async function renderAdvancedPeriod(){const state=await readState(),period=document.getElementById('ratioPeriod')?.value||state.period||'',ctx=await getContext(period),manual=readManual()[ctx.period]||{},calc=calculate(ctx.current,ctx.previous,manual);renderAdvanced(calc,ctx.current.currency)}
function notify(text){const toast=document.getElementById('toast');if(!toast)return;toast.textContent=text;toast.dataset.type='success';toast.classList.remove('hidden');clearTimeout(notify.timer);notify.timer=setTimeout(()=>toast.classList.add('hidden'),2600)}
async function save(){const period=document.getElementById('rdPeriod')?.value;if(!period)return;const all=readManual(),values={};document.querySelectorAll('[data-rd-field]').forEach(input=>{if(clean(input.value)!==''&&finite(input.value))values[input.dataset.rdField]=Number(input.value)});all[period]=values;saveManual(all);notify('تم حفظ بيانات النسب');await render()}
async function reset(){const period=document.getElementById('rdPeriod')?.value;if(!period||!confirm(`سيتم حذف الإدخالات اليدوية للفترة ${period}. هل تريد المتابعة؟`))return;const all=readManual();delete all[period];saveManual(all);notify('تم حذف إدخالات الفترة');await render()}
function bind(){document.getElementById('rdPeriod')?.addEventListener('change',render);document.getElementById('rdSave')?.addEventListener('click',save);document.getElementById('rdReset')?.addEventListener('click',reset);document.getElementById('ratioPeriod')?.addEventListener('change',renderAdvancedPeriod);document.getElementById('globalPeriod')?.addEventListener('change',()=>{renderAdvancedPeriod();if(document.getElementById('view-ratio-data')?.classList.contains('active'))render()})}
async function init(){for(let i=0;i<30&&!document.querySelector('.nav-list');i++)await new Promise(resolve=>setTimeout(resolve,100));addStyle();addView();bind();await render();await renderAdvancedPeriod()}
init();
