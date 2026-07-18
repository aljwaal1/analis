const CACHE="financial-analysis-suite-v1.0.1";
const ASSETS=["./","index.html","manifest.webmanifest","assets/css/app.css","assets/js/app.js","assets/js/utils.js","assets/js/storage.js","assets/js/analytics.js","assets/js/charts.js","assets/js/importer.js","assets/js/report.js","assets/icons/icon.svg","templates/financial_analysis_template.csv","samples/sample_financial_data.csv"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));self.skipWaiting()});
self.addEventListener("activate",e=>e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k))))));
self.addEventListener("fetch",e=>{if(e.request.method!=="GET")return;e.respondWith(caches.match(e.request).then(c=>c||fetch(e.request).then(r=>{const x=r.clone();caches.open(CACHE).then(k=>k.put(e.request,x));return r}).catch(()=>caches.match("index.html"))))});
