const DB_NAME='financial-analysis-mobile';
const STORE_NAME='app';
const STORAGE_KEY='financial-ratio-inputs-v1';

const clean=v=>String(v??'').trim();
const keyText=v=>clean(v).toLowerCase().replace(/[\s_\-–—/\\]+/g,' ').replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').trim();
const num=v=>{const x=Number(v);return Number.isFinite(x)?x:NaN};
const sum=a=>a.reduce((s,v)=>s+(Number.isFinite(Number(v))?Number(v):0),0);
const safeDiv=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&b!==0?a/b:NaN;
const uniq=a=>[...new Set(a.filter(v=>clean(v)!==''))];
const esc=v=>clean(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const hasOwn=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);

function openDb(){return new Promise((resolve,reject)=>{const req=indexedDB.open(DB_NAME,1);req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(STORE_NAME))req.result.createObjectStore(STORE_NAME)};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
async function readAppState(){try{const db=await openDb();const value=await new Promise((resolve,reject)=>{const req=db.transaction(STORE_NAME).objectStore(STORE_NAME).get('state');req.onsuccess=()=>resolve(req.result||{});req.onerror=()=>reject(req.error)});db.close();return value}catch{try{return JSON.parse(localStorage.getItem('financial-state')||'{}')}catch{return {}}}}
function readInputs(){try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}')}catch{return {}}}
function writeInputs(data){localStorage.setItem(STORAGE_KEY,JSON.stringify(data))}

function money(value,currency='SAR'){
  if(!Number.isFinite(value))return '—';
  try{return new Intl.NumberFormat('ar',{style:'currency',currency,maximumFractionDigits:0}).format(value)}catch{return `${new Intl.NumberFormat('ar',{maximumFractionDigits:0}).format(value)} ${currency}`}
}
function number(value,digits=2){return Number.isFinite(value)?new Intl.NumberFormat('ar',{maximumFractionDigits:digits}).format(value):'—'}
function percent(value){return Number.isFinite(value)?`${number(value,1)}%`:'—'}

function baseRows(rows,period,statement){return rows.filter(r=>clean(r.period)===clean(period)&&(!statement||r.statement===statement))}
function details(rows){return rows.filter(r=>!r.generated&&!/^(اجمالي|المجموع|total)/.test(keyText(r.item)))}
function matchItem(rows,patterns){return rows.filter(r=>patterns.some(rx=>rx.test(keyText(r.item))))}
function exactItem(rows,patterns){const found=rows.find(r=>patterns.some(rx=>rx.test(keyText(r.item))));return found?Number(found.value):NaN}
function totalOrSum(rows,exactPatterns,fallback){const exact=exactItem(rows,exactPatterns);return Number.isFinite(exact)?exact:sum(fallback(rows).map(r=>r.value))}
function incomeKind(row){const t=keyText(`${row.category} ${row.item}`);if(/ايراد|مبيعات|دخل|revenue|sales/.test(t)&&!/مصروف|تكلف|expense|cost/.test(t))return'revenue';if(/مصروف|تكلف|رواتب|اجور|ايجار|ضريب|استهلاك|اطفاء|فوائد|عمولات|expense|cost|salary|rent|tax|interest/.test(t))return'expense';return'other'}
function cashType(row){const t=keyText(`${row.cashflowType} ${row.category} ${row.item}`);return/تشغيل|operat/.test(t)?'operating':/استثمار|invest/.test(t)?'investing':/تمويل|financ/.test(t)?'financing':'other'}

function derivePeriod(rows,period){
  const balance=baseRows(rows,period,'balance');
  const bDetails=details(balance);
  const income=details(baseRows(rows,period,'income'));
  const cashflow=details(baseRows(rows,period,'cashflow'));
  const assets=bDetails.filter(r=>keyText(r.category).includes('اصول'));
  const liabilities=bDetails.filter(r=>/خصوم|التزام|liabilit/.test(keyText(r.category)));
  const equityRows=bDetails.filter(r=>/حقوق|ملكي|equity/.test(keyText(r.category)));
  const currentAssetRows=assets.filter(r=>r.isCurrent||/متداول|نقد|بنك|ذمم.*مدين|عميل|مخزون|مقدم|current/.test(keyText(`${r.accountGroup} ${r.item}`))&&!/غير.*متداول|طويل.*اجل|ثابت|non current/.test(keyText(`${r.accountGroup} ${r.item}`)));
  const currentLiabilityRows=liabilities.filter(r=>r.isCurrent||/متداول|قصير.*اجل|مورد|ذمم.*دائن|مستحق|current/.test(keyText(`${r.accountGroup} ${r.item}`))&&!/غير.*متداول|طويل.*اجل|non current/.test(keyText(`${r.accountGroup} ${r.item}`)));
  const cash=sum(matchItem(assets,[/نقد/,/صندوق/,/بنك/,/cash/,/bank/]).map(r=>r.value));
  const receivables=sum(matchItem(assets,[/ذمم.*مدين/,/عملاء/,/receivable/]).map(r=>r.value));
  const inventory=sum(matchItem(assets,[/مخزون/,/بضاعه/,/inventory/]).map(r=>r.value));
  const payables=sum(matchItem(liabilities,[/ذمم.*دائن/,/مورد/,/payable/]).map(r=>r.value));
  const currentAssets=totalOrSum(balance,[/^اجمالي الاصول المتداوله$/,/^total current assets$/],()=>currentAssetRows);
  const totalAssets=totalOrSum(balance,[/^اجمالي الاصول$/,/^total assets$/],()=>assets);
  const currentLiabilities=totalOrSum(balance,[/^اجمالي الخصوم المتداوله$/,/^total current liabilit/],()=>currentLiabilityRows);
  const totalLiabilities=totalOrSum(balance,[/^اجمالي الخصوم$/,/^total liabilit/],()=>liabilities);
  const equity=totalOrSum(balance,[/^حقوق الملكيه$/,/^اجمالي حقوق الملكيه$/,/^total equity$/],()=>equityRows);
  const revenues=income.filter(r=>incomeKind(r)==='revenue');
  const expenses=income.filter(r=>incomeKind(r)==='expense');
  const revenue=sum(revenues.map(r=>Math.abs(Number(r.value)||0)));
  const totalExpenses=sum(expenses.map(r=>Math.abs(Number(r.value)||0)));
  const cogs=sum(matchItem(expenses,[/تكلف.*مبيعات/,/تكلف.*بضاع/,/تكلف.*خدم/,/cost of sales/,/cost of goods/]).map(r=>Math.abs(Number(r.value)||0)));
  const financeCost=sum(matchItem(expenses,[/فوائد/,/تكاليف.*تمويل/,/عمولات.*بنكي/,/finance cost/,/interest expense/]).map(r=>Math.abs(Number(r.value)||0)));
  const taxExpense=sum(matchItem(expenses,[/ضريب.*دخل/,/income tax/]).map(r=>Math.abs(Number(r.value)||0)));
  const depreciation=sum(matchItem(expenses,[/استهلاك/,/depreciation/]).map(r=>Math.abs(Number(r.value)||0)));
  const amortization=sum(matchItem(expenses,[/اطفاء/,/amortization/]).map(r=>Math.abs(Number(r.value)||0)));
  const netIncome=revenue-totalExpenses;
  const operatingProfit=revenue-(totalExpenses-financeCost-taxExpense);
  const ebitda=operatingProfit+depreciation+amortization;
  const loans=sum(matchItem(liabilities,[/قرض/,/تسهيلات/,/سحب.*مكشوف/,/borrow/,/loan/,/debt/]).map(r=>Math.abs(Number(r.value)||0)));
  const leaseLiabilities=sum(matchItem(liabilities,[/التزام.*ايجار/,/lease liabilit/]).map(r=>Math.abs(Number(r.value)||0)));
  const totalDebt=loans+leaseLiabilities;
  const operatingCash=sum(cashflow.filter(r=>cashType(r)==='operating').map(r=>Number(r.value)||0));
  const capex=Math.abs(sum(matchItem(cashflow,[/شراء.*(ممتلك|اصول|معدات|الات)/,/انفاق.*راس/,/capital expenditure/,/purchase.*property/,/purchase.*equipment/]).map(r=>Number(r.value)||0)));
  const interestPaid=Math.abs(sum(matchItem(cashflow,[/فوائد.*مدفوع/,/interest paid/]).map(r=>Number(r.value)||0)));
  const principalPayments=Math.abs(sum(matchItem(cashflow,[/سداد.*(قرض|اصل)/,/loan repayment/,/principal repayment/]).map(r=>Number(r.value)||0)));
  const dividendsPaid=Math.abs(sum(matchItem(cashflow,[/توزيعات.*ارباح/,/dividend/]).map(r=>Number(r.value)||0)));
  const currency=rows.find(r=>clean(r.period)===clean(period)&&r.currency)?.currency||rows.find(r=>r.currency)?.currency||'SAR';
  return {period,currency,cash,receivables,inventory,payables,currentAssets,totalAssets,currentLiabilities,totalLiabilities,equity,revenue,totalExpenses,cogs,financeCost,taxExpense,depreciation,amortization,netIncome,operatingProfit,ebitda,totalDebt,operatingCash,capex,interestPaid,principalPayments,dividendsPaid};
}

const FIELD_GROUPS=[
  {id:'efficiency',title:'الكفاءة ودورة رأس المال العامل',description:'تستخدم لحساب دوران المخزون والتحصيل والسداد ودورة التحويل النقدي.',fields:[
    {key:'creditSales',label:'المبيعات الآجلة',hint:'اتركه فارغًا لاستخدام إجمالي الإيرادات كتقدير.'},
    {key:'creditPurchases',label:'المشتريات الآجلة',hint:'يمكن تقديرها من تكلفة المبيعات وحركة المخزون.'},
    {key:'openingInventory',label:'مخزون أول الفترة',hint:'يُستخرج من الفترة السابقة عند توفرها.'},
    {key:'closingInventory',label:'مخزون آخر الفترة',hint:'يُستخرج من ميزان المراجعة الحالي.'},
    {key:'openingReceivables',label:'ذمم العملاء أول الفترة',hint:'يُستخرج من الفترة السابقة عند توفرها.'},
    {key:'closingReceivables',label:'ذمم العملاء آخر الفترة',hint:'يُستخرج من ميزان المراجعة الحالي.'},
    {key:'openingPayables',label:'ذمم الموردين أول الفترة',hint:'يُستخرج من الفترة السابقة عند توفرها.'},
    {key:'closingPayables',label:'ذمم الموردين آخر الفترة',hint:'يُستخرج من ميزان المراجعة الحالي.'},
    {key:'daysInPeriod',label:'عدد أيام الفترة',hint:'365 افتراضيًا، ويمكن استخدام 360.'}
  ]},
  {id:'cashDebt',title:'التدفقات وخدمة الدين',description:'تستخدم لحساب التدفق الحر وجودة الأرباح وتغطية خدمة الدين.',fields:[
    {key:'interestPaid',label:'الفوائد المدفوعة نقدًا',hint:'يُستخرج من التدفقات النقدية عندما يكون البند موجودًا.'},
    {key:'principalPayments',label:'أصل القروض المسدد',hint:'لا يشمل مصروف الفائدة.'},
    {key:'capex',label:'الإنفاق الرأسمالي',hint:'شراء الممتلكات والآلات والمعدات.'},
    {key:'dividendsPaid',label:'توزيعات الأرباح المدفوعة',hint:'تستخدم لحساب تغطية التوزيعات ونسبة التوزيع.'}
  ]},
  {id:'market',title:'بيانات الأسهم والسوق – اختيارية',description:'فعّل هذه البيانات فقط للشركات المساهمة أو عند الحاجة لنسب السوق.',fields:[
    {key:'sharesOutstanding',label:'المتوسط المرجح لعدد الأسهم',hint:'عدد الأسهم المستخدمة لحساب ربحية السهم.'},
    {key:'sharePrice',label:'سعر السهم',hint:'السعر في تاريخ التحليل.'},
    {key:'preferredDividends',label:'توزيعات الأسهم الممتازة',hint:'اتركه فارغًا أو صفرًا إذا لم توجد أسهم ممتازة.'}
  ]}
];

function autoValues(current,previous){
  const openingInventory=previous?.inventory;
  const openingReceivables=previous?.receivables;
  const openingPayables=previous?.payables;
  const estimatedPurchases=Number.isFinite(openingInventory)?current.cogs+current.inventory-openingInventory:NaN;
  return {
    creditSales:{value:current.revenue,source:'تقديري من إجمالي الإيرادات',quality:'estimated'},
    creditPurchases:{value:estimatedPurchases,source:'تقديري من تكلفة المبيعات وحركة المخزون',quality:'estimated'},
    openingInventory:{value:openingInventory,source:'ميزان مراجعة الفترة السابقة',quality:'auto'},
    closingInventory:{value:current.inventory,source:'ميزان المراجعة',quality:'auto'},
    openingReceivables:{value:openingReceivables,source:'ميزان مراجعة الفترة السابقة',quality:'auto'},
    closingReceivables:{value:current.receivables,source:'ميزان المراجعة',quality:'auto'},
    openingPayables:{value:openingPayables,source:'ميزان مراجعة الفترة السابقة',quality:'auto'},
    closingPayables:{value:current.payables,source:'ميزان المراجعة',quality:'auto'},
    daysInPeriod:{value:365,source:'قيمة افتراضية',quality:'default'},
    interestPaid:{value:current.interestPaid||NaN,source:'التدفقات النقدية',quality:'auto'},
    principalPayments:{value:current.principalPayments||NaN,source:'التدفقات النقدية',quality:'auto'},
    capex:{value:current.capex||NaN,source:'التدفقات النقدية',quality:'auto'},
    dividendsPaid:{value:current.dividendsPaid||NaN,source:'التدفقات النقدية',quality:'auto'},
    sharesOutstanding:{value:NaN,source:'إدخال يدوي',quality:'missing'},
    sharePrice:{value:NaN,source:'إدخال يدوي',quality:'missing'},
    preferredDividends:{value:0,source:'مفترض عدم وجودها',quality:'default'}
  };
}

function resolved(field,manual,autos){
  if(hasOwn(manual,field)&&clean(manual[field])!=='')return {value:Number(manual[field]),source:'أدخله المستخدم',quality:'manual'};
  return autos[field]||{value:NaN,source:'غير متوفر',quality:'missing'};
}

function metricData(current,previous,manual){
  const autos=autoValues(current,previous);
  const get=k=>resolved(k,manual,autos).value;
  const avg=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)?(a+b)/2:Number.isFinite(b)?b:NaN;
  const openingInventory=get('openingInventory'),closingInventory=get('closingInventory');
  const openingReceivables=get('openingReceivables'),closingReceivables=get('closingReceivables');
  const openingPayables=get('openingPayables'),closingPayables=get('closingPayables');
  const days=get('daysInPeriod');
  const creditSales=get('creditSales'),creditPurchases=get('creditPurchases');
  const interestPaid=get('interestPaid'),principalPayments=get('principalPayments'),capex=get('capex'),dividendsPaid=get('dividendsPaid');
  const shares=get('sharesOutstanding'),sharePrice=get('sharePrice'),preferredDividends=get('preferredDividends');
  const avgInventory=avg(openingInventory,closingInventory),avgReceivables=avg(openingReceivables,closingReceivables),avgPayables=avg(openingPayables,closingPayables);
  const avgAssets=avg(previous?.totalAssets,current.totalAssets),avgEquity=avg(previous?.equity,current.equity);
  const avgWorkingCapital=avg(previous?previous.currentAssets-previous.currentLiabilities:NaN,current.currentAssets-current.currentLiabilities);
  const inventoryTurnover=safeDiv(current.cogs,avgInventory),receivableTurnover=safeDiv(creditSales,avgReceivables),payableTurnover=safeDiv(creditPurchases,avgPayables);
  const dio=safeDiv(days,inventoryTurnover),dso=safeDiv(days,receivableTurnover),dpo=safeDiv(days,payableTurnover);
  const freeCashFlow=Number.isFinite(current.operatingCash)&&Number.isFinite(capex)?current.operatingCash-capex:NaN;
  const eps=safeDiv(current.netIncome-(preferredDividends||0),shares),bookValuePerShare=safeDiv(current.equity,shares),dividendPerShare=safeDiv(dividendsPaid,shares);
  const ratios=[
    ['السيولة','نسبة التداول',safeDiv(current.currentAssets,current.currentLiabilities),'x','الأصول المتداولة ÷ الخصوم المتداولة'],
    ['السيولة','النسبة السريعة',safeDiv(current.currentAssets-current.inventory,current.currentLiabilities),'x','(الأصول المتداولة − المخزون) ÷ الخصوم المتداولة'],
    ['السيولة','النسبة النقدية',safeDiv(current.cash,current.currentLiabilities),'x','النقدية ÷ الخصوم المتداولة'],
    ['السيولة','رأس المال العامل',current.currentAssets-current.currentLiabilities,'money','الأصول المتداولة − الخصوم المتداولة'],
    ['الربحية','هامش مجمل الربح',safeDiv(current.revenue-current.cogs,current.revenue)*100,'%','مجمل الربح ÷ الإيرادات'],
    ['الربحية','هامش الربح التشغيلي',safeDiv(current.operatingProfit,current.revenue)*100,'%','الربح التشغيلي ÷ الإيرادات'],
    ['الربحية','هامش EBITDA',safeDiv(current.ebitda,current.revenue)*100,'%','EBITDA ÷ الإيرادات'],
    ['الربحية','هامش صافي الربح',safeDiv(current.netIncome,current.revenue)*100,'%','صافي الربح ÷ الإيرادات'],
    ['الربحية','العائد على الأصول',safeDiv(current.netIncome,avgAssets)*100,'%','صافي الربح ÷ متوسط الأصول'],
    ['الربحية','العائد على حقوق الملكية',safeDiv(current.netIncome,avgEquity)*100,'%','صافي الربح ÷ متوسط حقوق الملكية'],
    ['المديونية','الخصوم إلى الأصول',safeDiv(current.totalLiabilities,current.totalAssets)*100,'%','إجمالي الخصوم ÷ إجمالي الأصول'],
    ['المديونية','الدين إلى حقوق الملكية',safeDiv(current.totalDebt,current.equity),'x','الدين المالي ÷ حقوق الملكية'],
    ['المديونية','تغطية الفوائد',safeDiv(current.operatingProfit,current.financeCost),'x','الربح التشغيلي ÷ تكلفة التمويل'],
    ['المديونية','صافي الدين إلى EBITDA',safeDiv(current.totalDebt-current.cash,current.ebitda),'x','(الدين − النقدية) ÷ EBITDA'],
    ['الكفاءة','دوران المخزون',inventoryTurnover,'x','تكلفة المبيعات ÷ متوسط المخزون'],
    ['الكفاءة','أيام الاحتفاظ بالمخزون',dio,'days','أيام الفترة ÷ دوران المخزون'],
    ['الكفاءة','دوران الذمم المدينة',receivableTurnover,'x','المبيعات الآجلة ÷ متوسط الذمم المدينة'],
    ['الكفاءة','متوسط فترة التحصيل',dso,'days','أيام الفترة ÷ دوران الذمم المدينة'],
    ['الكفاءة','دوران الذمم الدائنة',payableTurnover,'x','المشتريات الآجلة ÷ متوسط ذمم الموردين'],
    ['الكفاءة','متوسط فترة السداد',dpo,'days','أيام الفترة ÷ دوران الذمم الدائنة'],
    ['الكفاءة','دورة التحويل النقدي',Number.isFinite(dio)&&Number.isFinite(dso)&&Number.isFinite(dpo)?dio+dso-dpo:NaN,'days','أيام المخزون + أيام التحصيل − أيام السداد'],
    ['الكفاءة','دوران الأصول',safeDiv(current.revenue,avgAssets),'x','الإيرادات ÷ متوسط الأصول'],
    ['الكفاءة','دوران رأس المال العامل',safeDiv(current.revenue,avgWorkingCapital),'x','الإيرادات ÷ متوسط رأس المال العامل'],
    ['التدفقات','التدفق التشغيلي إلى الخصوم المتداولة',safeDiv(current.operatingCash,current.currentLiabilities),'x','التدفق التشغيلي ÷ الخصوم المتداولة'],
    ['التدفقات','التدفق التشغيلي إلى الدين',safeDiv(current.operatingCash,current.totalDebt),'x','التدفق التشغيلي ÷ الدين المالي'],
    ['التدفقات','التدفق النقدي الحر',freeCashFlow,'money','التدفق التشغيلي − الإنفاق الرأسمالي'],
    ['التدفقات','هامش التدفق النقدي الحر',safeDiv(freeCashFlow,current.revenue)*100,'%','التدفق الحر ÷ الإيرادات'],
    ['التدفقات','جودة الأرباح',safeDiv(current.operatingCash,current.netIncome),'x','التدفق التشغيلي ÷ صافي الربح'],
    ['التدفقات','تغطية خدمة الدين النقدية',safeDiv(current.operatingCash,(interestPaid||0)+(principalPayments||0)),'x','التدفق التشغيلي ÷ (الفوائد + أصل الدين)'],
    ['التدفقات','تغطية توزيعات الأرباح',safeDiv(freeCashFlow,dividendsPaid),'x','التدفق الحر ÷ التوزيعات'],
    ['السوق','ربحية السهم',eps,'money','(صافي الربح − توزيعات الممتازة) ÷ عدد الأسهم'],
    ['السوق','مكرر الربحية',safeDiv(sharePrice,eps),'x','سعر السهم ÷ ربحية السهم'],
    ['السوق','القيمة الدفترية للسهم',bookValuePerShare,'money','حقوق الملكية ÷ عدد الأسهم'],
    ['السوق','السعر إلى القيمة الدفترية',safeDiv(sharePrice,bookValuePerShare),'x','سعر السهم ÷ القيمة الدفترية للسهم'],
    ['السوق','نسبة توزيع الأرباح',safeDiv(dividendsPaid,current.netIncome)*100,'%','توزيعات الأرباح ÷ صافي الربح'],
    ['السوق','عائد التوزيعات',safeDiv(dividendPerShare,sharePrice)*100,'%','توزيع السهم ÷ سعر السهم']
  ].map(([group,name,value,unit,formula])=>({group,name,value,unit,formula}));
  return {autos,ratios,freeCashFlow};
}

function sourceClass(q){return q==='manual'?'manual':q==='auto'?'auto':q==='estimated'?'estimated':q==='default'?'default':'missing'}
function formatRatio(r,currency){return r.unit==='money'?money(r.value,currency):r.unit==='%'?percent(r.value):r.unit==='days'?`${number(r.value,1)} يوم`:r.unit==='x'?`${number(r.value,2)}×`:number(r.value)}

function groupCompletion(current,previous,manual,metric){
  const required={
    liquidity:[current.currentAssets,current.currentLiabilities,current.cash,current.inventory],
    profitability:[current.revenue,current.cogs,current.operatingProfit,current.netIncome,current.totalAssets,current.equity],
    leverage:[current.totalDebt,current.cash,current.ebitda,current.financeCost,current.operatingProfit],
    efficiency:['creditSales','creditPurchases','openingInventory','closingInventory','openingReceivables','closingReceivables','openingPayables','closingPayables','daysInPeriod'].map(k=>resolved(k,manual,metric.autos)),
    cashflow:[current.operatingCash,'capex','interestPaid','principalPayments','dividendsPaid'].map(v=>typeof v==='string'?resolved(v,manual,metric.autos):{value:v,quality:'auto'}),
    market:['sharesOutstanding','sharePrice'].map(k=>resolved(k,manual,metric.autos))
  };
  const score=list=>{let got=0;list.forEach(v=>{const obj=typeof v==='object'?v:{value:v,quality:'auto'};if(Number.isFinite(obj.value))got+=obj.quality==='estimated'||obj.quality==='default'?.6:1});return Math.round(got/list.length*100)};
  return Object.fromEntries(Object.entries(required).map(([k,v])=>[k,score(v)]));
}

function injectStructure(){
  if(document.getElementById('view-ratio-data'))return;
  const nav=document.querySelector('.nav-list');
  const ratiosButton=nav?.querySelector('[data-view="ratios"]');
  if(nav&&ratiosButton){const button=document.createElement('button');button.className='nav-item';button.dataset.view='ratio-data';button.innerHTML='<span>＋</span> استكمال بيانات النسب';ratiosButton.insertAdjacentElement('afterend',button);button.addEventListener('click',()=>activateView())}
  const main=document.querySelector('.main-area');
  const reports=document.getElementById('view-reports');
  const section=document.createElement('section');section.className='view';section.id='view-ratio-data';section.innerHTML=`
    <div class="section-intro"><div><span class="eyebrow">رفع دقة التحليل</span><h2>استكمال بيانات النسب المالية</h2><p>يعرض التطبيق ما استخرجه تلقائيًا، ويطلب فقط البيانات الناقصة أو التي تحتاج تأكيدًا.</p></div><div class="filter-row"><select id="ratioDataPeriod" class="control"></select><button id="saveRatioData" class="btn primary">حفظ البيانات</button><button id="resetRatioData" class="btn ghost">مسح إدخال الفترة</button></div></div>
    <div id="ratioDataSummary" class="kpi-grid compact-grid"></div>
    <article class="panel"><div class="panel-head"><div><span class="eyebrow">المصدر</span><h3>البيانات المستخرجة تلقائيًا</h3></div></div><div id="ratioAutoGrid" class="rd-auto-grid"></div></article>
    <div id="ratioInputGroups" class="rd-groups"></div>
    <article class="panel"><div class="panel-head"><div><span class="eyebrow">النتيجة</span><h3>معاينة النسب المتاحة</h3></div></div><div id="ratioPreviewGrid" class="rd-ratio-grid"></div></article>`;
  if(reports)main.insertBefore(section,reports);else main.appendChild(section);
  const ratioView=document.getElementById('view-ratios');
  const intro=ratioView?.querySelector('.section-intro');
  if(intro&&!document.getElementById('openRatioData')){const b=document.createElement('button');b.id='openRatioData';b.className='btn ghost';b.textContent='استكمال البيانات الناقصة';b.addEventListener('click',activateView);intro.appendChild(b)}
  if(ratioView&&!document.getElementById('advancedRatioPanel')){const panel=document.createElement('article');panel.className='panel';panel.id='advancedRatioPanel';panel.innerHTML='<div class="panel-head"><div><span class="eyebrow">نسب إضافية</span><h3>النسب المتقدمة بعد استكمال البيانات</h3></div><button class="btn ghost" id="advancedRatioEdit">إدخال البيانات</button></div><div id="advancedRatioGrid" class="rd-ratio-grid"></div>';ratioView.appendChild(panel);panel.querySelector('#advancedRatioEdit').addEventListener('click',activateView)}
}

function injectStyle(){if(document.getElementById('ratioDataStyle'))return;const style=document.createElement('style');style.id='ratioDataStyle';style.textContent=`
.rd-auto-grid,.rd-ratio-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.rd-auto-card,.rd-ratio-card{border:1px solid #dce5ea;border-radius:14px;padding:14px;background:#fff}.rd-auto-card span,.rd-ratio-card span{display:block;color:#64748b;font-size:.8rem}.rd-auto-card strong,.rd-ratio-card strong{display:block;margin:7px 0;font-size:1.05rem;color:#17324d}.rd-source{display:inline-flex!important;width:max-content;padding:4px 8px;border-radius:999px;font-size:.72rem!important;font-weight:700}.rd-source.auto{background:#dcfce7;color:#166534}.rd-source.manual{background:#dbeafe;color:#1d4ed8}.rd-source.estimated{background:#fef3c7;color:#92400e}.rd-source.default{background:#f1f5f9;color:#475569}.rd-source.missing{background:#fee2e2;color:#991b1b}.rd-groups{display:grid;gap:14px;margin:16px 0}.rd-group{border:1px solid #dce5ea;border-radius:17px;background:#fff;overflow:hidden}.rd-group-head{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:16px 18px;background:#f8fafc}.rd-group-head h3{margin:0 0 4px}.rd-group-head p{margin:0;color:#64748b}.rd-progress{min-width:90px;text-align:center;font-weight:800;color:#0f766e}.rd-fields{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;padding:16px}.rd-field{border:1px solid #e5eaee;border-radius:12px;padding:12px}.rd-field label{display:block;font-weight:750;margin-bottom:7px}.rd-field input{width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:9px;font:inherit}.rd-field small{display:block;color:#64748b;margin-top:6px;min-height:34px}.rd-field-meta{display:flex;justify-content:space-between;align-items:center;gap:6px;margin-top:8px;font-size:.74rem}.rd-ratio-card.unavailable{background:#f8fafc;opacity:.72}.rd-ratio-card small{display:block;color:#64748b;line-height:1.5}.rd-ratio-group{font-size:.72rem!important;color:#0f766e!important;font-weight:800}.rd-note{padding:10px 12px;border-radius:10px;background:#fff7ed;color:#9a3412;margin-top:10px}@media(max-width:1100px){.rd-auto-grid,.rd-ratio-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.rd-fields{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:680px){.rd-auto-grid,.rd-ratio-grid,.rd-fields{grid-template-columns:1fr}.rd-group-head{align-items:flex-start;flex-direction:column}.section-intro .filter-row{width:100%;flex-wrap:wrap}}
`;document.head.appendChild(style)}

function activateView(){document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id==='view-ratio-data'));document.querySelectorAll('.nav-item,.bottom-item').forEach(v=>v.classList.toggle('active',v.dataset.view==='ratio-data'));const title=document.getElementById('pageTitle'),sub=document.getElementById('pageSubtitle');if(title)title.textContent='استكمال بيانات النسب';if(sub)sub.textContent='مراجعة القيم المستخرجة وإدخال البيانات الناقصة للنسب المتقدمة';document.getElementById('sidebar')?.classList.remove('open');document.getElementById('overlay')?.classList.add('hidden');renderRatioData();window.scrollTo({top:0,behavior:'smooth'})}

function autoCards(current){return [
  ['الإيرادات',current.revenue,'قائمة الدخل'],['تكلفة المبيعات',current.cogs,'قائمة الدخل'],['صافي الربح',current.netIncome,'قائمة الدخل'],['الربح التشغيلي',current.operatingProfit,'محسوب'],
  ['النقدية',current.cash,'ميزان المراجعة'],['الذمم المدينة',current.receivables,'ميزان المراجعة'],['المخزون',current.inventory,'ميزان المراجعة'],['الذمم الدائنة',current.payables,'ميزان المراجعة'],
  ['الأصول المتداولة',current.currentAssets,'ميزان المراجعة'],['الخصوم المتداولة',current.currentLiabilities,'ميزان المراجعة'],['إجمالي الأصول',current.totalAssets,'ميزان المراجعة'],['حقوق الملكية',current.equity,'ميزان المراجعة'],
  ['إجمالي الدين',current.totalDebt,'ميزان المراجعة'],['EBITDA',current.ebitda,'محسوب'],['التدفق التشغيلي',current.operatingCash,'التدفقات النقدية'],['تكلفة التمويل',current.financeCost,'قائمة الدخل']
]}

async function context(){const state=await readAppState();const rows=Array.isArray(state.rows)?state.rows:[];const periods=uniq(rows.map(r=>clean(r.period))).sort((a,b)=>a.localeCompare(b,'ar',{numeric:true}));const select=document.getElementById('ratioDataPeriod');let period=select?.value||state.period||periods.at(-1)||'';if(!periods.includes(period))period=periods.at(-1)||'';const index=periods.indexOf(period),previousPeriod=index>0?periods[index-1]:'';return {state,rows,period,periods,current:derivePeriod(rows,period),previous:previousPeriod?derivePeriod(rows,previousPeriod):null}}

async function renderRatioData(){
  const c=await context(),select=document.getElementById('ratioDataPeriod');if(!select)return;
  select.innerHTML=c.periods.length?c.periods.map(p=>`<option value="${esc(p)}">${esc(p)}</option>`).join(''):'<option value="">لا توجد فترات</option>';select.value=c.period;
  const allInputs=readInputs(),manual=allInputs[c.period]||{},metric=metricData(c.current,c.previous,manual),completion=groupCompletion(c.current,c.previous,manual,metric);
  const core=Math.round((completion.liquidity+completion.profitability+completion.leverage+completion.efficiency+completion.cashflow)/5);
  const estimated=Object.keys(metric.autos).filter(k=>resolved(k,manual,metric.autos).quality==='estimated').length;
  const missing=Object.keys(metric.autos).filter(k=>resolved(k,manual,metric.autos).quality==='missing').length;
  document.getElementById('ratioDataSummary').innerHTML=[['اكتمال البيانات الأساسية',`${core}%`],['الكفاءة',`${completion.efficiency}%`],['التدفقات وخدمة الدين',`${completion.cashflow}%`],['قيم تقديرية / ناقصة',`${estimated} / ${missing}`]].map(([l,v])=>`<article class="kpi-card"><div class="kpi-label">${l}</div><div class="kpi-value">${v}</div><div class="kpi-foot"><span>الفترة ${esc(c.period||'—')}</span></div></article>`).join('');
  document.getElementById('ratioAutoGrid').innerHTML=autoCards(c.current).map(([label,value,source])=>`<div class="rd-auto-card"><span>${label}</span><strong>${money(value,c.current.currency)}</strong><span class="rd-source auto">${source}</span></div>`).join('');
  document.getElementById('ratioInputGroups').innerHTML=FIELD_GROUPS.map(group=>`<section class="rd-group"><div class="rd-group-head"><div><h3>${group.title}</h3><p>${group.description}</p></div><div class="rd-progress">${completion[group.id]??0}% مكتمل</div></div><div class="rd-fields">${group.fields.map(field=>{const auto=metric.autos[field.key]||{},effective=resolved(field.key,manual,metric.autos),manualValue=hasOwn(manual,field.key)?manual[field.key]:'',placeholder=Number.isFinite(auto.value)?String(auto.value):'';return`<div class="rd-field"><label for="rd-${field.key}">${field.label}</label><input id="rd-${field.key}" data-ratio-field="${field.key}" type="number" step="any" value="${esc(manualValue)}" placeholder="${esc(placeholder)}"><small>${field.hint}</small><div class="rd-field-meta"><span class="rd-source ${sourceClass(effective.quality)}">${effective.source}</span><span>${Number.isFinite(effective.value)?number(effective.value,2):'مطلوب'}</span></div></div>`}).join('')}</div></section>`).join('');
  const available=metric.ratios.filter(r=>Number.isFinite(r.value)).length;
  document.getElementById('ratioPreviewGrid').innerHTML=metric.ratios.map(r=>`<div class="rd-ratio-card ${Number.isFinite(r.value)?'':'unavailable'}"><span class="rd-ratio-group">${r.group}</span><strong>${r.name}</strong><span>${formatRatio(r,c.current.currency)}</span><small>${r.formula}</small></div>`).join('')+`<div class="rd-note">أصبح ${available} من ${metric.ratios.length} نسبة قابلًا للحساب. القيم التقديرية مميزة حتى يمكن استبدالها بأرقام فعلية.</div>`;
  renderAdvanced(c,metric);
}

function renderAdvanced(c,metric){const host=document.getElementById('advancedRatioGrid');if(!host)return;const advanced=metric.ratios.filter(r=>['الكفاءة','التدفقات','السوق'].includes(r.group));host.innerHTML=advanced.map(r=>`<div class="rd-ratio-card ${Number.isFinite(r.value)?'':'unavailable'}"><span class="rd-ratio-group">${r.group}</span><strong>${r.name}</strong><span>${formatRatio(r,c.current.currency)}</span><small>${r.formula}</small></div>`).join('')}

async function saveCurrent(){const select=document.getElementById('ratioDataPeriod'),period=select?.value;if(!period)return;const data=readInputs(),values={};document.querySelectorAll('[data-ratio-field]').forEach(input=>{const raw=clean(input.value);if(raw!==''){const value=Number(raw);if(Number.isFinite(value))values[input.dataset.ratioField]=value}});data[period]=values;writeInputs(data);notify('تم حفظ بيانات النسب لهذه الفترة','success');await renderRatioData()}
async function resetCurrent(){const period=document.getElementById('ratioDataPeriod')?.value;if(!period||!confirm(`سيتم حذف القيم اليدوية للفترة ${period}. هل تريد المتابعة؟`))return;const data=readInputs();delete data[period];writeInputs(data);notify('تم حذف الإدخالات اليدوية للفترة','success');await renderRatioData()}
function notify(text,type='info'){const toast=document.getElementById('toast');if(!toast)return;toast.textContent=text;toast.dataset.type=type;toast.classList.remove('hidden');clearTimeout(notify.timer);notify.timer=setTimeout(()=>toast.classList.add('hidden'),2800)}

async function renderAdvancedForSelected(){const state=await readAppState(),rows=Array.isArray(state.rows)?state.rows:[],period=document.getElementById('ratioPeriod')?.value||state.period||uniq(rows.map(r=>r.period)).sort().at(-1)||'',periods=uniq(rows.map(r=>clean(r.period))).sort((a,b)=>a.localeCompare(b,'ar',{numeric:true})),i=periods.indexOf(period),current=derivePeriod(rows,period),previous=i>0?derivePeriod(rows,periods[i-1]):null,manual=(readInputs()[period]||{}),metric=metricData(current,previous,manual);renderAdvanced({current},metric)}

function bind(){document.getElementById('ratioDataPeriod')?.addEventListener('change',renderRatioData);document.getElementById('saveRatioData')?.addEventListener('click',saveCurrent);document.getElementById('resetRatioData')?.addEventListener('click',resetCurrent);document.getElementById('ratioPeriod')?.addEventListener('change',renderAdvancedForSelected);document.getElementById('globalPeriod')?.addEventListener('change',()=>{renderAdvancedForSelected();if(document.getElementById('view-ratio-data')?.classList.contains('active'))renderRatioData()})}

async function init(){for(let i=0;i<30&&!document.querySelector('.nav-list');i++)await new Promise(r=>setTimeout(r,100));injectStyle();injectStructure();bind();await renderRatioData();await renderAdvancedForSelected()}
init();
