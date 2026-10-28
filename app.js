/* 共用邏輯：開關、密碼解鎖、匯率、備註／標題／封面／照片編輯 */
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const T=window.TRIP;
const COLORS=['#d9534f','#e8883a','#c9a227','#4c9a5a','#2f7d8c','#3d6fb5','#7a57b5','#b5578f'];
const store={get(k,d){try{const v=sessionStorage.getItem(k);return v===null?d:v}catch(_){return d}},set(k,v){try{sessionStorage.setItem(k,v)}catch(_){}}};
const lstore={get(k,d){try{const v=localStorage.getItem(k);return v===null?d:v}catch(_){return d}},set(k,v){try{localStorage.setItem(k,v)}catch(_){}}};
let RATE=parseFloat(lstore.get('rate',T.rate))||T.rate;
const b64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const twd=e=>e.cur==='JPY'?e.amt*RATE:e.amt;
const nt=n=>'NT$'+Math.round(n).toLocaleString();
const money=e=>e.cur==='JPY'?`¥${e.amt.toLocaleString()} <small>≈ ${nt(e.amt*RATE)}</small>`:nt(e.amt);
const sumTWD=list=>list.reduce((a,e)=>a+twd(e),0);
const EXPBY=()=>Object.fromEntries((window.EXPENSES||[]).map(e=>[e.id,e]));

/* ---------- 開關 ---------- */
function bindExpToggle(onchange){
  const t=$('#tExp');if(!t)return;
  t.checked=store.get('showexp','0')==='1';document.body.classList.toggle('showexp',t.checked);
  t.onchange=()=>{store.set('showexp',t.checked?'1':'0');document.body.classList.toggle('showexp',t.checked);onchange&&onchange()};
}

/* ---------- 主角照片：AES-GCM 加密，輸入密碼後才在瀏覽器解開 ---------- */
let cryptoKey=null; const blobs={}; const LOCAL={};
async function deriveKey(pw){
  const base=await crypto.subtle.importKey('raw',new TextEncoder().encode(pw),'PBKDF2',false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2',salt:b64(T.salt),iterations:150000,hash:'SHA-256'},base,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
async function decBytes(raw,k){return crypto.subtle.decrypt({name:'AES-GCM',iv:raw.slice(0,12)},k||cryptoKey,raw.slice(12))}
async function decFile(id){
  if(blobs[id])return blobs[id];
  const raw=new Uint8Array(await (await fetch(`photos/${id}.bin`)).arrayBuffer());
  return blobs[id]=URL.createObjectURL(new Blob([await decBytes(raw)],{type:'image/jpeg'}));
}
async function tryUnlock(pw){
  const k=await deriveKey(pw);
  const first='_check'; // 建置時產生的固定驗證檔，不會被編輯功能刪除
  const raw=new Uint8Array(await (await fetch(`photos/${first}.bin`)).arrayBuffer());
  await decBytes(raw,k); // 密碼錯誤會丟錯
  cryptoKey=k;store.set('pw',pw);
}
function askPassword(){
  return new Promise(res=>{
    const m=$('#pw');m.style.display='flex';$('#pwi').value='';$('#pwe').textContent='';setTimeout(()=>$('#pwi').focus(),50);
    $('#pwc').onclick=()=>{m.style.display='none';res(false)};
    $('#pwf').onsubmit=async e=>{e.preventDefault();
      try{await tryUnlock($('#pwi').value);m.style.display='none';res(true)}
      catch(_){$('#pwe').textContent='密碼錯誤，請再試一次';$('#pwi').value=''}};
  });
}
async function ensureUnlocked(){
  if(cryptoKey)return true;
  const saved=store.get('pw','');
  if(saved){try{await tryUnlock(saved);return true}catch(_){}}
  return askPassword();
}
async function applyPeople(){
  const on=$('#tPp')&&$('#tPp').checked;
  $$('.lkicon').forEach(b=>b.firstChild.textContent=on?'🔓':'🔒');
  for(const i of $$('img.pp')){
    const w=i.closest('.ph')||i;
    if(!on){w.hidden=true;continue}
    if(!i.src||!i.src.startsWith('blob:'))i.src=await decFile(i.dataset.id);
    w.hidden=false;
  }
}
function bindPeopleToggle(){
  const t=$('#tPp');if(!t)return;
  t.onchange=async()=>{
    if(t.checked){if(!await ensureUnlocked()){t.checked=false;return}store.set('showpp','1')}else store.set('showpp','0');
    applyPeople();
  };
  if(store.get('showpp','0')==='1'){ensureUnlocked().then(ok=>{t.checked=ok;if(ok)applyPeople()})}
}

/* ---------- 燈箱 ---------- */
let lbList=[],lbI=0;
function openLB(list,i){lbList=list;lbI=i;$('#lb img').src=lbList[lbI];$('#lb').style.display='flex'}
function lbMove(d){lbI=(lbI+d+lbList.length)%lbList.length;$('#lb img').src=lbList[lbI]}
function bindLB(){
  const lb=$('#lb');if(!lb)return;
  lb.onclick=e=>{if(e.target.matches('button'))return;lb.style.display='none'};
  $('#lb .prev').onclick=()=>lbMove(-1);$('#lb .next').onclick=()=>lbMove(1);
  document.addEventListener('keydown',e=>{if(lb.style.display!=='flex')return;
    if(e.key==='Escape')lb.style.display='none';if(e.key==='ArrowLeft')lbMove(-1);if(e.key==='ArrowRight')lbMove(1)});
}

/* ---------- 備註／標題／封面／照片清單（notes.json）---------- */
let NOTES={},BASE_ITEMS={},BASE_NAME={},BASE_MOVE={};
async function loadNotes(){
  T.days.forEach(d=>d.spots.forEach(s=>{BASE_ITEMS[s.id]=JSON.stringify(s.items);BASE_NAME[s.id]=s.name;BASE_MOVE[s.id]=(window.MOVES||{})[s.id]||'';s.move=BASE_MOVE[s.id]}));
  try{const r=await fetch('notes.json?'+Date.now());if(r.ok)NOTES=await r.json()}catch(_){}
  T.covers=NOTES._covers||{};T.titles=NOTES._titles||{};
  const ph=NOTES._photos||{};
  const nm=NOTES._names||{},mv=NOTES._moves||{};
  T.days.forEach(d=>d.spots.forEach(s=>{if(s.id in NOTES)s.memo=NOTES[s.id];if(ph[s.id])s.items=ph[s.id];if(nm[s.id])s.name=nm[s.id];if(s.id in mv)s.move=mv[s.id]}));
}
function titleOf(k,def){return (T.titles&&T.titles[k])||def}
function applyTitles(){
  const edit=document.body.classList.contains('edit');
  const h=$('#h1'),sb=$('#hsub');if(!h)return;
  h.textContent=titleOf('site','115 東京 – 名古屋 ❤️');sb.textContent=titleOf('sub','2026/10/17 ~ 10/24 · 8 天旅遊紀錄');
  document.title=h.textContent.replace(/[❤️]/g,'').trim()||document.title;
  [[h,'site'],[sb,'sub']].forEach(([el,k])=>{
    el.contentEditable=edit?'true':'false';el.classList.toggle('editable',edit);
    el.oninput=()=>{T.titles=T.titles||{};T.titles[k]=el.textContent};
  });
  $$('[data-title]').forEach(el=>{
    el.contentEditable=edit?'true':'false';el.classList.toggle('editable',edit);
    el.oninput=()=>{T.titles=T.titles||{};T.titles[el.dataset.title]=el.textContent};
  });
}

/* ---------- 照片編輯：排序／鎖定／刪除／新增，檔案變更先排隊，儲存時一起上傳 ---------- */
const OPS={};
const opCount=()=>Object.keys(OPS).length;
function setOp(path,op){
  if(op.t==='del'&&OPS[path]&&OPS[path].t==='put'){delete OPS[path];return}
  OPS[path]=op;
}
const urlOf=b=>URL.createObjectURL(b);
const srcThumb=it=>(LOCAL[it.id]&&LOCAL[it.id].thumb)||`photos/${it.id}_t.jpg`;
const srcFull=it=>(LOCAL[it.id]&&LOCAL[it.id].full)||`photos/${it.id}.jpg`;
async function resizeBlob(blobOrFile,max,q){
  const bm=await createImageBitmap(blobOrFile,{imageOrientation:'from-image'});
  const sc=Math.min(1,max/Math.max(bm.width,bm.height));
  const c=document.createElement('canvas');c.width=Math.round(bm.width*sc);c.height=Math.round(bm.height*sc);
  c.getContext('2d').drawImage(bm,0,0,c.width,c.height);
  return new Promise(r=>c.toBlob(r,'image/jpeg',q));
}
async function encryptBlob(blob){
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const ct=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},cryptoKey,await blob.arrayBuffer()));
  const out=new Uint8Array(12+ct.length);out.set(iv);out.set(ct,12);return new Blob([out]);
}
async function plainBlobOf(it){
  const q=OPS[`photos/${it.id}.jpg`];if(q&&q.t==='put')return q.blob;
  if(it.locked){const u=await decFile(it.id);return (await fetch(u)).blob()}
  return (await fetch(`photos/${it.id}.jpg`)).blob();
}
async function toggleLock(s,i){
  const it=s.items[i];const blob=await plainBlobOf(it);
  if(!it.locked){
    setOp(`photos/${it.id}.bin`,{t:'put',blob:await encryptBlob(blob)});
    setOp(`photos/${it.id}.jpg`,{t:'del'});setOp(`photos/${it.id}_t.jpg`,{t:'del'});
    blobs[it.id]=urlOf(blob);it.locked=true;
  }else{
    setOp(`photos/${it.id}.jpg`,{t:'put',blob});
    const th=await resizeBlob(blob,480,.72);setOp(`photos/${it.id}_t.jpg`,{t:'put',blob:th});
    setOp(`photos/${it.id}.bin`,{t:'del'});
    LOCAL[it.id]={thumb:urlOf(th),full:urlOf(blob)};it.locked=false;
  }
}
function removeItem(s,i){
  const it=s.items[i];
  if(it.locked)setOp(`photos/${it.id}.bin`,{t:'del'});else{setOp(`photos/${it.id}.jpg`,{t:'del'});setOp(`photos/${it.id}_t.jpg`,{t:'del'})}
  s.items.splice(i,1);
}
function moveItem(s,i,d){const j=i+d;if(j<0||j>=s.items.length)return;[s.items[i],s.items[j]]=[s.items[j],s.items[i]]}
async function addPhotos(s,files,lock){
  let n=0;
  for(const f of files){
    if(!f.type.startsWith('image/'))continue;
    const id='u'+Date.now().toString(36)+(n++);
    const full=await resizeBlob(f,1280,.78);
    if(lock){setOp(`photos/${id}.bin`,{t:'put',blob:await encryptBlob(full)});blobs[id]=urlOf(full)}
    else{const th=await resizeBlob(f,480,.72);setOp(`photos/${id}.jpg`,{t:'put',blob:full});setOp(`photos/${id}_t.jpg`,{t:'put',blob:th});LOCAL[id]={thumb:urlOf(th),full:urlOf(full)}}
    s.items.push({id,locked:!!lock});
  }
}

/* ---------- 儲存（GitHub API）---------- */
function ghToken(){
  let tok=lstore.get('ghtoken','');
  if(!tok){tok=prompt('要儲存到網站，請貼上 GitHub Personal Access Token（只會存在這個瀏覽器）。\n建立方式：GitHub → Settings → Developer settings → Fine-grained tokens，只授權這個 repo，Contents 選 Read and write。')||'';if(tok)lstore.set('ghtoken',tok.trim())}
  return lstore.get('ghtoken','');
}
const toB64=blob=>new Promise(r=>{const fr=new FileReader();fr.onload=()=>r(fr.result.split(',')[1]);fr.readAsDataURL(blob)});
async function saveNotes(){
  const bar=$('#savemsg');const say=t=>{if(bar)bar.textContent=t};
  const out={_covers:T.covers||{},_titles:T.titles||{},_photos:{},_names:{},_moves:{}};
  T.days.forEach(d=>d.spots.forEach(s=>{out[s.id]=s.memo;if(s.name!==BASE_NAME[s.id])out._names[s.id]=s.name;if((s.move||'')!==BASE_MOVE[s.id])out._moves[s.id]=s.move||'';if(JSON.stringify(s.items)!==BASE_ITEMS[s.id])out._photos[s.id]=s.items}));
  const json=JSON.stringify(out,null,1);
  const tok=T.repo?ghToken():'';
  if(!tok){
    if(opCount())alert('照片的新增／刪除／鎖定變更需要 GitHub 權杖才能存到網站，這次沒有儲存照片。');
    const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([json],{type:'application/json'}));a.download='notes.json';a.click();return;
  }
  const H={Authorization:'Bearer '+tok,Accept:'application/vnd.github+json'};
  const api=p=>`https://api.github.com/repos/${T.repo}/contents/${p}`;
  const shaOf=async p=>{const r=await fetch(api(p)+'?t='+Date.now(),{headers:H});return r.ok?(await r.json()).sha:undefined};
  try{
    const paths=Object.keys(OPS);let n=0;
    for(const p of paths){
      say(`上傳中 ${++n}/${paths.length+1}…`);const op=OPS[p];const sha=await shaOf(p);
      if(op.t==='put'){
        const r=await fetch(api(p),{method:'PUT',headers:H,body:JSON.stringify({message:'photo '+p,content:await toB64(op.blob),sha})});
        if(!r.ok)throw new Error(p+' '+r.status);
      }else if(sha){
        const r=await fetch(api(p),{method:'DELETE',headers:H,body:JSON.stringify({message:'remove '+p,sha})});
        if(!r.ok)throw new Error(p+' '+r.status);
      }
      delete OPS[p];
    }
    say('儲存備註…');
    const sha=await shaOf('notes.json');
    const r=await fetch(api('notes.json'),{method:'PUT',headers:H,body:JSON.stringify({message:'update notes',content:btoa(unescape(encodeURIComponent(json))),sha})});
    if(!r.ok)throw new Error('notes.json '+r.status);
    T.days.forEach(d=>d.spots.forEach(s=>{BASE_ITEMS[s.id]=JSON.stringify(s.items)}));
    say('已儲存');alert('已儲存！網站約 1 分鐘後更新。');
  }catch(e){
    say('儲存失敗');
    if(/40[13]/.test(e.message)){lstore.set('ghtoken','');alert('權杖無效或權限不足（'+e.message+'）。請重新建立權杖後再試。')}
    else alert('儲存失敗：'+e.message+'\n已完成的檔案不會重傳，可以再按一次儲存。');
  }
}
function bindEdit(rerender){
  const b=$('#btnEdit');if(!b)return;
  b.onclick=async()=>{
    if(document.body.classList.contains('edit')){document.body.classList.remove('edit');b.innerHTML='✏️<span class="lb"> 編輯</span>';rerender();return}
    if(!await ensureUnlocked())return;
    document.body.classList.add('edit');b.innerHTML='✅<span class="lb"> 結束編輯</span>';
    const t=$('#tPp');if(t&&!t.checked){t.checked=true;store.set('showpp','1')}
    rerender();
  };
  $('#btnSave').onclick=saveNotes;
}

/* ---------- 側邊欄（電腦版固定在左側，手機版從左滑出；群組與整個側邊欄都可以收合）---------- */
const IC_MAP='<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/></svg>',IC_COIN='<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9 8l3 4 3-4M8.5 12.5h7M8.5 15.5h7M12 12v6"/></svg>';
const EXP_SECTIONS=[['stats','📊 總覽數字'],['x-filter','🔎 篩選'],['x-pie','🥧 類別占比'],['x-line','📈 累計走勢'],['x-day','📅 依天數／時段'],['x-shop','🏪 幣別與商家'],['x-top','🏆 最大 10 筆'],['x-table','🧾 明細']];
const gOpen=g=>lstore.get('sideg_'+g,'1')==='1';
const isWide=()=>window.matchMedia('(min-width:1100px)').matches;
function toggleSide(){
  if(isWide()){const c=document.body.classList.toggle('sidecollapsed');lstore.set('sidecollapsed',c?'1':'0')}
  else document.body.classList.toggle('sideopen');
}
function initSide(){
  if($('#side'))return;
  document.body.classList.add('hasside');
  const nav=$('.bar nav');
  if(nav){const onExp=/expenses\.html/.test(location.pathname);
    nav.innerHTML=`<a href="index.html#/" id="nHome" class="${onExp?'':'on'}">${IC_MAP}行程總覽</a><a href="expenses.html" class="${onExp?'on':''}">${IC_COIN}花費分析</a>`}
  if(lstore.get('sidecollapsed','0')==='1')document.body.classList.add('sidecollapsed');
  const bar=$('.bar>div');
  if(bar){const b=document.createElement('button');b.className='btn';b.id='btnMenu';b.textContent='☰';b.title='選單';bar.prepend(b);b.onclick=toggleSide}
  const mask=document.createElement('div');mask.id='sidemask';mask.onclick=()=>document.body.classList.remove('sideopen');
  const side=document.createElement('aside');side.id='side';
  document.body.append(mask,side);
  side.addEventListener('click',e=>{
    const t=e.target.closest('.gtog');
    if(t){const g=t.dataset.g;lstore.set('sideg_'+g,gOpen(g)?'0':'1');updateSide();return}
    if(e.target.closest('a')&&!isWide())document.body.classList.remove('sideopen');
  });
  window.addEventListener('hashchange',updateSide);
  updateSide();
}
function updateSide(){
  const side=$('#side');if(!side)return;
  const onExp=/expenses\.html/.test(location.pathname);
  const m=location.hash.match(/#\/day\/(\d)/);const cur=m?+m[1]:0;
  const exp=window.EXPENSES||[];
  const grp=(g,head,body)=>`<div class="sgroup"><div class="sgh">${head}<button class="gtog" data-g="${g}" title="${gOpen(g)?'收合':'展開'}">${gOpen(g)?'▾':'▸'}</button></div>${gOpen(g)?`<div class="gbody">${body}</div>`:''}</div>`;
  side.innerHTML=`<div class="sidehd"><b>🧳 旅程選單</b><button class="btn" id="sideclose" title="收起側邊欄">«</button></div>`+
  grp('home',`<a class="sitem hd ${!onExp&&!cur?'on':''}" href="index.html#/">${IC_MAP}行程總覽</a>`,
    T.days.map(d=>`<a class="sitem day ${!onExp&&cur===d.day?'on':''}" href="index.html#/day/${d.day}" style="--c:${COLORS[d.day-1]}"><i>${d.day}</i><span><b>${d.date}</b><small>${esc(titleOf('d'+d.day,d.title))}</small></span><em class="only-exp">${nt(sumTWD(exp.filter(e=>e.day===d.day)))}</em></a>`).join(''))+
  grp('exp',`<a class="sitem hd ${onExp?'on':''}" href="expenses.html">${IC_COIN}花費分析</a>`,
    EXP_SECTIONS.map(([id,t])=>`<a class="sitem sub" href="expenses.html#${id}">${t}</a>`).join(''))+
  `<div class="sgrp">工具</div>
  <button class="sitem" id="sEdit">✏️ 編輯模式（備註／照片／標題／移動方式）</button>
  <div class="sitem static">日圓匯率 <input id="sRate" type="number" step="0.001" min="0.05" max="1" value="${RATE}"></div>
  <div class="sitem static small">主角照片、花費明細的開關在上方列。花費是依匯率換算成台幣統計。</div>`;
  $('#sideclose').onclick=()=>{if(isWide()){document.body.classList.add('sidecollapsed');lstore.set('sidecollapsed','1')}else document.body.classList.remove('sideopen')};
  $('#sEdit').onclick=()=>{document.body.classList.remove('sideopen');const b=$('#btnEdit');if(b)b.click();else location.href='index.html#/'};
  $('#sRate').onchange=e=>{const v=parseFloat(e.target.value);if(v>0){RATE=v;lstore.set('rate',v);window.dispatchEvent(new Event('ratechange'))}};
}

/* ---------- 消費明細排版：把記帳備註拆成「店家資訊／品項表格／金額結算／備註」---------- */
const TOT_KEY=/^([（(]|合計|小計|實收|找零|支付|總額|折扣|折抵|結帳|現金|未稅|含稅|免稅金額|免稅折|免稅原|免稅對象|免稅扣|消費稅|稅|\d+%|商品|優惠券折|優惠券 |原|折後|外加|內含|實付|多件|共|利用|應用程式優惠券|實收消費|訪日|消費稅額|金額)/;
const META_KEY=/^(購買店家|地點|消費時間|日期時間|桌號|服務類別|乘車區間|行駛距離|乘車時間|航班資訊|票券類別|購入日期|取票|乘車日期|乘車日|列車名|搭乘區間|引渡張數|品名|說明|價格|購買門市|電話|登錄編號|購買時間)/;
const HDR_ITEMS=/^(購買項目|購買品項明細|搭乘資訊與項目|交易明細|費用明細)/;
const UNIT_TAG=/(原含稅|原免稅|含稅|未稅|免稅)?單價/;
function parseItemLine(t){
  const s=t.replace(/^\d+\.\s*/,'');
  const i=s.indexOf('：');
  if(i<0)return null;
  const nameFull=s.slice(0,i),rest=s.slice(i+1).trim();
  const jpm=nameFull.match(/（([^（）]*)）/);
  const name=(nameFull.replace(/（[^（）]*）/g,'').replace(/^[\s①②③④⑤⑥⑦⑧⑨⑩◆*★※＊]+/,'').trim())||nameFull;
  const qm=rest.match(/數量\s*(\d+)/),um=rest.match(/單價\s*(¥[\d,]+)/),ut=rest.match(UNIT_TAG);
  let total='',ttag='';
  if(rest.includes('＝')){
    const last=rest.split('＝').pop();
    const tax=last.match(/（含稅總價[^¥]*(¥[\d,]+)）/);
    const tm=last.match(/總價\s*(¥[\d,]+)/)||last.match(/(¥[\d,]+)/);
    total=tax?tax[1]:(tm?tm[1]:'');
    ttag=tax?'含稅':((last.match(/(含稅|未稅|免稅)/)||[])[1]||'');
  }else{
    const m=rest.match(/¥[\d,]+/)||rest.match(/([\d,]+)\s*日圓/);
    if(m)total=m[0].startsWith('¥')?m[0]:'¥'+m[1];
  }
  const notes=[...rest.matchAll(/[^，＝（）]*?(?:折扣|優惠券|折價|折抵|半價)[^，＝（）]*(?:（-¥[\d,]+）)?/g)].map(x=>x[0].trim()).filter(Boolean);
  return {name,jp:jpm?jpm[1]:'',unit:um?um[1]:'',utag:ut&&ut[1]?ut[1].replace('原',''):'',qty:qm?qm[1]:'',total,ttag,note:notes.join('、'),hasNum:!!(um||qm||rest.includes('＝'))};
}
function parseDetail(desc){
  const meta=[],items=[],tots=[],notes=[],other=[];let pay='',state='start',pending=null,lastOther='';
  const lines=(desc||'').split('\n').map(l=>l.trim()).filter(Boolean);
  for(const t of lines){
    if(/^備註/.test(t)){notes.push(t.replace(/^備註[：:]?\s*/,''));state='notes';continue}
    if(state==='notes'){notes.push(t);continue}
    if(/^支付方式/.test(t)){pay=t.replace(/^支付方式[：:]?\s*/,'');state='after';continue}
    if(/^(總額|金額結算|金額計算|結算金額|稅額資訊|結帳)[：:]?$/.test(t)){state='tots';continue}
    if(HDR_ITEMS.test(t)){state='items';const v=t.split('：')[1];if(v&&v.trim()&&!/^[(（]/.test(v.trim()))other.push(t);continue}
    const ki=t.indexOf('：'),kv=ki>0?[t.slice(0,ki).trim(),t.slice(ki+1).trim()]:null;
    if(pending&&/^金額：/.test(t)){
      const parts=t.replace(/^金額：/,'').split('｜');
      pending.total=(parts[0].match(/¥[\d,]+/)||[parts[0]])[0];pending.note=parts.slice(1).join('、');items.push(pending);pending=null;continue}
    if(/^\d+\.\s/.test(t)&&!t.includes('：')){
      pending={name:t.replace(/^\d+\.\s*/,'').replace(/（[^（）]*）/g,'').trim(),jp:(t.match(/（([^（）]*)）/)||[])[1]||'',unit:'',utag:'',qty:'',total:'',ttag:'',note:''};state='items';continue}
    if(/^[（(]條碼/.test(t)&&lastOther){
      const m=t.match(/¥[\d,]+/);
      items.push({name:lastOther.replace(/（[^（）]*）/g,'').trim(),jp:(lastOther.match(/（([^（）]*)）/)||[])[1]||'',unit:'',utag:'',qty:'',total:m?m[0]:'',ttag:'',note:''});
      other.pop();lastOther='';state='items';continue}
    if(kv&&!kv[1]){notes.push(kv[0]);continue}
    const it=kv?parseItemLine(t):null;
    const looksItem=it&&(it.hasNum||/^\d+\.\s/.test(t))&&it.total;
    if(looksItem&&(state==='items'||state==='start'||state==='tots')){items.push(it);state='items';continue}
    if(kv&&META_KEY.test(kv[0])&&(state==='start'||state==='items')){meta.push(kv);continue}
    if(kv&&TOT_KEY.test(kv[0])){tots.push(kv);if(state!=='items'||/^(合計|小計|結帳|總額)/.test(kv[0]))state='tots';continue}
    if(kv&&(state==='start'||state==='items')&&it&&it.total){items.push(it);state='items';continue}
    if(kv&&state==='items'&&items.length){items[items.length-1].note=(items[items.length-1].note?items[items.length-1].note+'、':'')+t;continue}
    if(kv&&state==='tots'){tots.push(kv);continue}
    if(kv&&state==='start'){meta.push(kv);continue}
    other.push(t);lastOther=t;
  }
  return {meta,items,tots,notes,pay,other};
}
function detailHTML(e){
  const head=(e.addr?`<div class="dmeta"><span>📍</span><span>${esc(e.addr)}</span></div>`:'')+(e.flag?`<div class="dflag">⚠ ${esc(e.flag)}</div>`:'');
  if(!e.desc)return head+'<div class="dnote">（記帳時沒有留下明細）</div>';
  const p=parseDetail(e.desc);
  const ok=p.items.length||p.tots.length||p.meta.length;
  let o=head;
  if(p.meta.length)o+=`<div class="dgrid">${p.meta.map(([k,v])=>`<span class="k">${esc(k.replace('購買店家／發行單位','發行單位').replace('購買店家','店家'))}</span><span>${esc(v)}</span>`).join('')}</div>`;
  if(p.items.length){
    const has=f=>p.items.some(i=>i[f]);
    const tag=t=>t?` <small class="tg">${esc(t)}</small>`:'';
    o+=`<table class="dit"><thead><tr><th>品項</th>${has('unit')?'<th class="n">單價</th>':''}${has('qty')?'<th class="n">數量</th>':''}<th class="n">小計</th></tr></thead><tbody>${p.items.map(i=>`<tr><td>${esc(i.name)}${i.jp?`<div class="jp">${esc(i.jp)}</div>`:''}${i.note?`<div class="dn">${esc(i.note)}</div>`:''}</td>${has('unit')?`<td class="n">${esc(i.unit)}${tag(i.utag)}</td>`:''}${has('qty')?`<td class="n">${esc(i.qty)}</td>`:''}<td class="n">${esc(i.total)}${tag(i.ttag)}</td></tr>`).join('')}</tbody></table>`;
  }
  if(p.pay)o+=`<div class="dpay">💳 ${esc(p.pay)}</div>`;
  if(p.tots.length)o+=`<div class="dtot">${p.tots.map(([k,v])=>`<div class="${/^(結帳|合計|實付|總額|利用金額|免稅對象結帳)/.test(k)?'big':''}"><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join('')}</div>`;
  if(p.notes.length)o+=`<div class="dnote">📝 ${esc(p.notes.join('；'))}</div>`;
  if(p.other.length&&!ok)o+=`<div class="draw">${esc(p.other.join('\n'))}</div>`;
  else if(p.other.length)o+=`<div class="dnote small">${esc(p.other.join('；'))}</div>`;
  if(ok)o+=`<details class="rawd"><summary>原始文字</summary><div class="draw">${esc(e.desc)}</div></details>`;
  return o;
}
