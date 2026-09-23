/* Permuta PG — launch hardening & UX layer */
(()=>{
const SITE='https://permutapg.com.br';
const qs=(s,r=document)=>r.querySelector(s), qsa=(s,r=document)=>[...r.querySelectorAll(s)];
function addMeta(name,content,property=false){let el=document.head.querySelector(`meta[${property?'property':'name'}="${name}"]`);if(!el){el=document.createElement('meta');el.setAttribute(property?'property':'name',name);document.head.appendChild(el)}el.content=content}
function seo(){
 document.title='Permuta PG | Troque produtos e serviços em Ponta Grossa';
 addMeta('description','Permuta PG conecta pessoas e empresas de Ponta Grossa para trocar produtos, serviços e oportunidades empresariais com propostas e reputação.');
 addMeta('robots','index,follow,max-image-preview:large');
 addMeta('og:title',document.title,true);addMeta('og:description','Trocas entre pessoas e empresas em Ponta Grossa.',true);addMeta('og:type','website',true);addMeta('og:url',SITE,true);
 let c=document.head.querySelector('link[rel=canonical]');if(!c){c=document.createElement('link');c.rel='canonical';document.head.appendChild(c)}c.href=SITE+'/';
 if(!document.head.querySelector('script[data-schema]')){const s=document.createElement('script');s.type='application/ld+json';s.dataset.schema='1';s.text=JSON.stringify({"@context":"https://schema.org","@type":"WebSite","name":"Permuta PG","url":SITE,"description":"Plataforma local de permutas entre pessoas e empresas em Ponta Grossa, Paraná.","inLanguage":"pt-BR"});document.head.appendChild(s)}
}
function injectCss(){if(document.querySelector('link[data-launch]'))return;const l=document.createElement('link');l.rel='stylesheet';l.href='launch.css?v=20260923-1';l.dataset.launch='1';document.head.appendChild(l)}
function businessStatus(){
 if(!window.me)return '';
 if(me.business_verified)return '<span class="launch-badge verified">✓ Empresa verificada</span>';
 if(me.cnpj)return '<span class="launch-badge registered">Empresa cadastrada</span>';
 return '';
}
function addBusinessNav(){
 const page=document.getElementById('empresario');if(!page||page.querySelector('.business-nav'))return;
 const nav=document.createElement('div');nav.className='business-nav';nav.innerHTML=`<strong>Área Empresarial</strong><div><button onclick="openBusinessArea('explore')">Explorar B2B</button><button onclick="openBusinessArea('publish')">Publicar oportunidade</button><button onclick="openBusinessArea('inbox')">Propostas</button><button onclick="openBusinessProfile()">Meu negócio</button></div><span id="businessStatus">${businessStatus()}</span>`;
 page.prepend(nav);
}
window.openBusinessProfile=async function(){
 if(!window.session)return go('auth');await hydrate();
 if(!me?.cnpj)return openBusinessArea('explore');
 const mask=c=>c?c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,'$1.$2.$3/$4-$5'):'—';
 const modal=ensureModal('businessProfileModal','Meu negócio');
 modal.querySelector('.launch-modal-body').innerHTML=`<div class="company-head"><div><h3>${esc(me.business_name||me.display_name||'Minha empresa')}</h3><p>CNPJ ${mask(me.cnpj)}</p></div>${businessStatus()}</div><div class="launch-grid"><label>Categoria<input id="bizCategory" value="${esc(me.business_category||'')}" placeholder="Ex.: Alimentação"></label><label>Site / Instagram<input id="bizWebsite" value="${esc(me.business_website||'')}" placeholder="https://..."></label></div><label>Sobre a empresa<textarea id="bizBio" rows="4" placeholder="Descreva sua empresa, produtos e serviços.">${esc(me.business_description||'')}</textarea></label><button class="p" onclick="saveBusinessProfile()">Salvar perfil empresarial</button><p id="bizSaveMsg" class="muted"></p>`;
 modal.classList.remove('hide');
}
window.saveBusinessProfile=async function(){
 const payload={business_category:qs('#bizCategory')?.value.trim()||null,business_website:qs('#bizWebsite')?.value.trim()||null,business_description:qs('#bizBio')?.value.trim()||null};
 const {error}=await sb.from('profiles').update(payload).eq('id',session.user.id);qs('#bizSaveMsg').textContent=error?error.message:'✓ Perfil empresarial atualizado.';if(!error)await hydrate();
}
function ensureModal(id,title){
 let m=document.getElementById(id);if(m)return m;m=document.createElement('div');m.id=id;m.className='modal hide';m.innerHTML=`<div class="modal-card launch-modal"><div class="launch-modal-head"><h2>${title}</h2><button onclick="document.getElementById('${id}').classList.add('hide')">×</button></div><div class="launch-modal-body"></div></div>`;document.body.appendChild(m);return m;
}
function addRecovery(){
 const pass=qs('#liPass');if(!pass||document.getElementById('forgotPassword'))return;
 const b=document.createElement('button');b.type='button';b.id='forgotPassword';b.className='launch-link';b.textContent='Esqueci minha senha';b.onclick=async()=>{const email=qs('#liEmail')?.value.trim();if(!email)return alert('Digite seu e-mail primeiro.');const {error}=await sb.auth.resetPasswordForEmail(email,{redirectTo:SITE+'/'});alert(error?error.message:'Enviamos o link de recuperação para seu e-mail.')};pass.parentElement?.appendChild(b);
}
function enhanceMode(){
 const sync=()=>{const emp=window.marketMode==='empresarial';qsa('.launch-context').forEach(e=>e.remove());if(!emp)return;const visible=['explore','publish','inbox'].map(id=>document.getElementById(id)).find(e=>e&&!e.classList.contains('hide'));if(!visible)return;const bar=document.createElement('div');bar.className='launch-context';bar.innerHTML='<b>🏢 Ambiente Empresarial</b><span>Somente oportunidades e propostas B2B.</span><button onclick="go(\'empresario\')">Painel Empresarial</button>';visible.prepend(bar)};new MutationObserver(sync).observe(document.body,{subtree:true,attributes:true,attributeFilter:['class']});sync();
}
function patchBusinessGate(){
 const old=window.activateBusiness;if(!old)return;window.activateBusiness=async function(){await old();setTimeout(()=>{const s=document.getElementById('businessStatus');if(s)s.innerHTML=businessStatus()},150)}
}
function patchPublishFlow(){
 const msg=document.getElementById('pubMsg');if(!msg)return;new MutationObserver(()=>{if(window.marketMode==='empresarial'&&msg.textContent.includes('Oferta publicada')){setTimeout(()=>{if(window.marketMode==='empresarial'){go('explore');const o=document.getElementById('offers');o?.insertAdjacentHTML('beforebegin','<div class="launch-success">✓ Oportunidade empresarial publicada. Ela já está disponível no ambiente B2B.</div>')}},900)}}).observe(msg,{childList:true,subtree:true,characterData:true});
}
function patchAdmin(){
 const old=window.renderAdminUsers;if(!old)return;window.renderAdminUsers=function(rows){old(rows);setTimeout(()=>{const table=qs('#adminUsers table');if(!table)return;const th=table.querySelector('thead tr');if(th&&!th.querySelector('.activity-col'))th.insertAdjacentHTML('beforeend','<th class="activity-col">Atividade</th>');const rendered=qsa('tbody tr',table);rendered.forEach(tr=>{if(tr.querySelector('.activity-btn'))return;const name=tr.querySelector('td b')?.textContent.trim();const u=(rows||[]).find(x=>(x.display_name||'Usuário')===name);const td=document.createElement('td');td.innerHTML=u?`<button class="admin-action neutral activity-btn" onclick="openAdminUserActivity('${u.id}')">Ver atividade</button>`:'—';tr.appendChild(td)})},0)}
}
window.openAdminUserActivity=function(id){
 const u=(window.__adminUsers||[]).find(x=>x.id===id);if(!u)return;
 const props=(window.__adminProposals||[]).filter(p=>p.from_user_id===id||p.offer_owner_id===id||p.user_id===id||p.from_user_email===u.email||p.offer_owner_email===u.email);
 const offers=(window.__adminOffers||[]).filter(o=>o.user_id===id||o.email===u.email);
 const m=ensureModal('adminActivityModal','Atividade do usuário');
 m.querySelector('.launch-modal-head h2').textContent='Atividade — '+(u.display_name||'Usuário');
 m.querySelector('.launch-modal-body').innerHTML=`<div class="activity-summary"><b>${offers.length}</b><span>ofertas</span><b>${props.length}</b><span>propostas relacionadas</span></div><h3>Ofertas publicadas</h3>${offers.length?offers.map(o=>`<div class="activity-item"><b>${esc(o.title||'Oferta')}</b><span>${esc(o.status||'')} · ${money(o.reference_value)}</span></div>`).join(''):'<p class="muted">Nenhuma oferta.</p>'}<h3>Propostas</h3>${props.length?props.map(p=>`<div class="activity-item"><b>${esc(p.offer_title||'Proposta')}</b><span>${esc(p.offered_description||p.message||'')} · ${esc(p.status||'')}</span></div>`).join(''):'<p class="muted">Nenhuma proposta relacionada.</p>'}`;
 m.classList.remove('hide');
}
function legalNotice(){
 const footer=qs('footer');if(footer&&!footer.querySelector('.launch-legal'))footer.insertAdjacentHTML('beforeend','<div class="launch-legal"><button onclick="openLegal(\'terms\')">Termos de Uso</button><button onclick="openLegal(\'privacy\')">Privacidade</button><span>Privacidade: contato pelo canal oficial da plataforma.</span></div>');
}
function boot(){seo();injectCss();addBusinessNav();addRecovery();enhanceMode();patchBusinessGate();patchPublishFlow();patchAdmin();legalNotice()}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(boot,50));else setTimeout(boot,50);
})();