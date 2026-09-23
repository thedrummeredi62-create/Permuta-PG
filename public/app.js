const cfg=window.PERMUTA_CONFIG||{};const sb=supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY);let session=null,me=null,wallet=null,proposalTab='received',marketMode='comum',pendingBusinessTarget='explore',reportingOfferId=null,reportingUserId=null;const $=id=>document.getElementById(id),esc=v=>String(v||'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])),money=v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});

let publishImageFiles=[];
let editingOfferId=null;
let editingExistingImages=[];
let editingOriginalImages=[];
let editNewImageFiles=[];
window.__offerImageMap={};
window.__reputationMap={};
window.__reviewedProposalIds=new Set();
let reviewingProposalId=null;

const IMAGE_BUCKET='offer-images';
const MAX_OFFER_IMAGES=5;
const ACCEPTED_IMAGE_TYPES=['image/jpeg','image/png','image/webp'];

function publicImageUrl(path){
  if(!path)return '';
  return sb.storage.from(IMAGE_BUCKET).getPublicUrl(path).data.publicUrl||'';
}

function normalizeOfferImages(images){
  return (images||[]).slice().sort((a,b)=>(a.position??99)-(b.position??99));
}

function rememberOfferImages(rows){
  for(const o of (rows||[])){
    window.__offerImageMap[o.id]=normalizeOfferImages(o.offer_images||[]);
  }
}

function reputationLabel(userId){
  const rep=window.__reputationMap[userId];
  if(!rep||!rep.count)return '<span class="user-reputation new-user">☆ Sem avaliações</span>';
  return `<span class="user-reputation">⭐ ${rep.average.toFixed(1).replace('.',',')} · ${rep.count} ${rep.count===1?'avaliação':'avaliações'}</span>`;
}
async function loadReputations(userIds){
  const ids=[...new Set((userIds||[]).filter(Boolean))];
  if(!ids.length)return;
  const {data,error}=await sb.from('reviews').select('reviewed_user_id,rating').in('reviewed_user_id',ids);
  if(error){console.error('Erro ao carregar reputações:',error);return;}
  const grouped={};
  for(const r of (data||[])){
    if(!grouped[r.reviewed_user_id])grouped[r.reviewed_user_id]=[];
    grouped[r.reviewed_user_id].push(Number(r.rating));
  }
  for(const id of ids){
    const ratings=grouped[id]||[];
    window.__reputationMap[id]={count:ratings.length,average:ratings.length?ratings.reduce((a,b)=>a+b,0)/ratings.length:0};
  }
}
async function loadMyReviewedProposals(proposalIds){
  const ids=[...new Set((proposalIds||[]).filter(Boolean))];
  window.__reviewedProposalIds=new Set();
  if(!session||!ids.length)return;
  const {data,error}=await sb.from('reviews').select('proposal_id').eq('reviewer_id',session.user.id).in('proposal_id',ids);
  if(error){console.error('Erro ao carregar avaliações já feitas:',error);return;}
  window.__reviewedProposalIds=new Set((data||[]).map(r=>r.proposal_id));
}

async function compressOfferImage(file){
  if(!ACCEPTED_IMAGE_TYPES.includes(file.type)){
    throw new Error('Use apenas imagens JPG, PNG ou WebP.');
  }
  if(file.size>15*1024*1024){
    throw new Error('A imagem original é muito grande. Use uma imagem de até 15 MB.');
  }

  const bitmap=await createImageBitmap(file);
  const maxSide=1600;
  const scale=Math.min(1,maxSide/Math.max(bitmap.width,bitmap.height));
  const width=Math.max(1,Math.round(bitmap.width*scale));
  const height=Math.max(1,Math.round(bitmap.height*scale));
  const canvas=document.createElement('canvas');
  canvas.width=width;canvas.height=height;
  canvas.getContext('2d').drawImage(bitmap,0,0,width,height);
  bitmap.close?.();

  const blob=await new Promise((resolve,reject)=>
    canvas.toBlob(b=>b?resolve(b):reject(new Error('Não foi possível processar a imagem.')),'image/webp',0.82)
  );
  if(blob.size>5*1024*1024){
    throw new Error('A imagem continuou acima de 5 MB após otimização.');
  }
  return blob;
}

async function uploadOfferImages(offerId,files,positions=null){
  const uploaded=[];
  for(let i=0;i<files.length;i++){
    const file=files[i];
    const blob=await compressOfferImage(file);
    const position=positions?positions[i]:i;
    const path=`${session.user.id}/${offerId}/${crypto.randomUUID()}.webp`;
    const {error:uploadError}=await sb.storage.from(IMAGE_BUCKET).upload(path,blob,{contentType:'image/webp',upsert:false});
    if(uploadError)throw uploadError;

    const {error:rowError}=await sb.from('offer_images').insert({
      offer_id:offerId,
      user_id:session.user.id,
      storage_path:path,
      position
    });
    if(rowError){
      await sb.storage.from(IMAGE_BUCKET).remove([path]);
      throw rowError;
    }
    uploaded.push(path);
  }
  return uploaded;
}

function renderSelectedImages(files,targetId,mode){
  const el=$(targetId);if(!el)return;
  el.innerHTML=files.map((file,i)=>{
    const url=URL.createObjectURL(file);
    return `<div class="image-preview-item">
      <img src="${url}" alt="Prévia ${i+1}" onload="URL.revokeObjectURL(this.src)">
      <button type="button" class="image-remove" onclick="${mode==='publish'?`removePublishImage(${i})`:`removeEditNewImage(${i})`}" aria-label="Remover imagem">×</button>
      ${i===0&&mode==='publish'?'<span class="cover-pill">Capa</span>':''}
    </div>`;
  }).join('');
}

function handlePublishImages(input){
  const incoming=[...(input.files||[])];
  const remaining=MAX_OFFER_IMAGES-publishImageFiles.length;
  if(incoming.length>remaining)alert(`Você pode adicionar no máximo ${MAX_OFFER_IMAGES} fotos por oferta.`);
  publishImageFiles.push(...incoming.slice(0,remaining));
  input.value='';
  renderSelectedImages(publishImageFiles,'publishImagePreview','publish');
  if($('publishImageCount'))$('publishImageCount').textContent=`${publishImageFiles.length}/${MAX_OFFER_IMAGES} fotos`;
}

function removePublishImage(index){
  publishImageFiles.splice(index,1);
  renderSelectedImages(publishImageFiles,'publishImagePreview','publish');
  if($('publishImageCount'))$('publishImageCount').textContent=`${publishImageFiles.length}/${MAX_OFFER_IMAGES} fotos`;
}

function openOfferGallery(offerId,start=0){
  const images=window.__offerImageMap[offerId]||[];
  if(!images.length)return;
  const modal=$('imageGalleryModal');
  modal.dataset.offerId=offerId;
  modal.dataset.index=String(Math.max(0,Math.min(start,images.length-1)));
  renderOfferGallery();
  modal.classList.remove('hide');
}

function renderOfferGallery(){
  const modal=$('imageGalleryModal');
  const images=window.__offerImageMap[modal.dataset.offerId]||[];
  const index=Number(modal.dataset.index||0);
  if(!images.length)return closeOfferGallery();
  $('galleryMainImage').src=publicImageUrl(images[index].storage_path);
  $('galleryCounter').textContent=`${index+1} / ${images.length}`;
  $('galleryPrev').disabled=images.length<2;
  $('galleryNext').disabled=images.length<2;
  $('galleryThumbs').innerHTML=images.map((img,i)=>`<button type="button" class="gallery-thumb ${i===index?'active':''}" onclick="setGalleryImage(${i})"><img src="${publicImageUrl(img.storage_path)}" alt="Foto ${i+1}"></button>`).join('');
}

function setGalleryImage(index){$('imageGalleryModal').dataset.index=String(index);renderOfferGallery()}
function moveGallery(step){
  const modal=$('imageGalleryModal'),images=window.__offerImageMap[modal.dataset.offerId]||[];
  if(!images.length)return;
  const current=Number(modal.dataset.index||0);
  modal.dataset.index=String((current+step+images.length)%images.length);
  renderOfferGallery();
}
function closeOfferGallery(){$('imageGalleryModal')?.classList.add('hide')}

function go(id){setMarketMode(marketMode);['home','empresario','auth','explore','publish','inbox','account','admin'].forEach(x=>{const el=$(x);if(el)el.classList.toggle('hide',x!==id)});if(id==='explore')loadOffers();if(id==='inbox'&&session)loadInbox();if(id==='account'&&session)loadAccount();if(id==='admin'&&session)loadAdmin();scrollTo(0,0)}function need(id){session?go(id):go('auth')}
function setMarketMode(mode){
  marketMode=mode==='empresarial'?'empresarial':'comum';
  if($('exploreModeTag'))$('exploreModeTag').textContent=marketMode==='empresarial'?'PERMUTAS ENTRE EMPRESAS':'PERMUTAS EM PONTA GROSSA';
  if($('exploreModeTitle'))$('exploreModeTitle').textContent=marketMode==='empresarial'?'🏢 Explorar oportunidades B2B':'🔎 Encontre quem quer trocar';
  if($('publishModeTag'))$('publishModeTag').textContent=marketMode==='empresarial'?'PUBLICAR PARA EMPRESAS':'CRIAR OFERTA';
  if($('publishModeTitle'))$('publishModeTitle').textContent=marketMode==='empresarial'?'🏢 Publique uma oportunidade empresarial':'🔄 Publique o que você tem';
  if($('proposalModeTitle'))$('proposalModeTitle').textContent=marketMode==='empresarial'?'🤝 Propostas empresariais':'🤝 Propostas';
  if($('search'))$('search').placeholder=marketMode==='empresarial'?'Ex.: serviço de marketing, manutenção, insumos':'Ex.: PlayStation 5';
  if($('haveSearch'))$('haveSearch').placeholder=marketMode==='empresarial'?'Ex.: crédito em consumo, serviço contábil, produtos':'Ex.: iPhone 13';
  if($('title'))$('title').placeholder=marketMode==='empresarial'?'Ex.: Crédito de R$ 2.000 no meu estabelecimento':'Ex.: PlayStation 5';
  if($('want'))$('want').placeholder=marketMode==='empresarial'?'Ex.: Marketing digital para minha empresa':'Ex.: iPhone 13';
  if($('publishExample'))$('publishExample').innerHTML=marketMode==='empresarial'
    ?'💡 Exemplo empresarial: <b>Ofereço R$ 2.000 em crédito no meu estabelecimento</b> → <b>Procuro serviço de marketing digital</b>'
    :'💡 Exemplo: <b>Tenho PlayStation 5</b> → <b>Procuro iPhone 13</b>';
}
function cleanCnpj(v){return String(v||'').replace(/\D/g,'')}
function validCnpjDigits(v){
  const c=cleanCnpj(v); if(c.length!==14||/^(\d)\1{13}$/.test(c))return false;
  const calc=(base,factors)=>{let sum=0;for(let i=0;i<factors.length;i++)sum+=Number(base[i])*factors[i];const r=sum%11;return r<2?0:11-r};
  const d1=calc(c,[5,4,3,2,9,8,7,6,5,4,3,2]); const d2=calc(c,[6,5,4,3,2,9,8,7,6,5,4,3,2]);
  return Number(c[12])===d1&&Number(c[13])===d2;
}
async function openBusinessArea(target='explore'){
  pendingBusinessTarget=target;
  if(!session){go('auth');return}
  await hydrate();
  if(!me?.cnpj){
    $('businessGate')?.classList.remove('hide');
    return;
  }
  setMarketMode('empresarial');go(target);
}
function closeBusinessGate(){$('businessGate')?.classList.add('hide')}
async function activateBusiness(){
  if(!session)return go('auth');
  const cnpj=cleanCnpj($('businessCnpj')?.value);
  const name=$('businessName')?.value?.trim()||null;
  if(!validCnpjDigits(cnpj)){ $('businessGateMsg').textContent='Informe um CNPJ válido.'; return; }
  $('businessGateMsg').textContent='Validando cadastro...';
  const {error}=await sb.from('profiles').update({cnpj,business_name:name,account_type:'empresa'}).eq('id',session.user.id);
  if(error){$('businessGateMsg').textContent=error.code==='23505'?'Este CNPJ já está vinculado a outra conta.':error.message;return}
  await hydrate(); closeBusinessGate(); setMarketMode('empresarial'); go(pendingBusinessTarget||'explore');
}
async function init(){const {data}=await sb.auth.getSession();session=data.session;await hydrate();await loadOffers();sb.auth.onAuthStateChange(async(_,s)=>{session=s;await hydrate()})}
async function hydrate(){
  if(!session){
    me=null;wallet=null;
    $('badge').textContent='Visitante';
    $('headerLogin')?.classList.remove('hide');
    $('headerSignup')?.classList.remove('hide');
    $('headerAccount')?.classList.add('hide');
    $('adminNav')?.classList.add('hide');
    return;
  }
  const uid=session.user.id;
  const [{data:p},{data:w}]=await Promise.all([
    sb.from('profiles').select('*').eq('id',uid).maybeSingle(),
    sb.from('wallets').select('*').eq('user_id',uid).maybeSingle()
  ]);
  me=p;wallet=w;
  $('badge').textContent=w?.free_unlocks>0?`🎁 ${w.free_unlocks} grátis`:`🪙 ${w?.credits||0} créditos`;
  $('headerLogin')?.classList.add('hide');
  $('headerSignup')?.classList.add('hide');
  $('headerAccount')?.classList.remove('hide');
  $('adminNav')?.classList.toggle('hide',me?.role!=='admin');
}
async function signup(){if(!$('terms').checked)return $('suMsg').textContent='Aceite os Termos e a Política.';const {error}=await sb.auth.signUp({email:$('suEmail').value.trim(),password:$('suPass').value,options:{data:{display_name:$('suName').value.trim(),account_type:$('suType').value,whatsapp:$('suPhone').value.trim()}}});$('suMsg').textContent=error?error.message:'✅ Conta criada. Confirme seu e-mail.'}
async function login(){const {data,error}=await sb.auth.signInWithPassword({email:$('liEmail').value.trim(),password:$('liPass').value});$('liMsg').textContent=error?error.message:'✅ Login realizado';if(!error){session=data.session;await hydrate();go('account')}}async function logout(){await sb.auth.signOut();session=null;go('home')}

async function publishOffer(){
  if(!session)return go('auth');

  const payload={
    user_id:session.user.id,
    offer_type:$('type').value,
    title:$('title').value.trim(),
    reference_value:+$('value').value,
    looking_for:$('want').value.trim(),
    open_to_proposals:$('open').value==='true',
    accepts_cash_difference:$('cash').value==='true',
    description:$('desc').value.trim(),
    city:'Ponta Grossa',
    market_scope:marketMode
  };

  if(!payload.title)return $('pubMsg').textContent='Informe o que você tem para oferecer.';
  if(!payload.looking_for)return $('pubMsg').textContent='Informe o que você procura em troca.';
  if(!payload.reference_value||payload.reference_value<=0)return $('pubMsg').textContent='Informe um valor aproximado válido.';

  $('pubMsg').textContent='Publicando oferta...';
  $('publishSubmit')?.setAttribute('disabled','disabled');

  const {data:offer,error}=await sb.from('offers').insert(payload).select('id').single();

  if(error){
    $('publishSubmit')?.removeAttribute('disabled');
    $('pubMsg').textContent=error.message;
    return;
  }

  let imageWarning='';
  if(publishImageFiles.length){
    $('pubMsg').textContent=`Enviando ${publishImageFiles.length} foto(s)...`;
    try{
      await uploadOfferImages(offer.id,publishImageFiles);
    }catch(imageError){
      console.error('Erro ao enviar imagens:',imageError);
      imageWarning=' A oferta foi publicada, mas alguma foto não pôde ser enviada.';
    }
  }

  $('title').value='';
  $('value').value='';
  $('want').value='';
  $('desc').value='';
  publishImageFiles=[];
  renderSelectedImages([],'publishImagePreview','publish');
  if($('publishImageCount'))$('publishImageCount').textContent=`0/${MAX_OFFER_IMAGES} fotos`;
  $('publishSubmit')?.removeAttribute('disabled');
  $('pubMsg').textContent=`✅ Oferta publicada.${imageWarning}`;

  await loadOffers();
  setTimeout(()=>go('account'),650);
}

async function loadOffers(){
  let q=sb.from('offers')
    .select('id,user_id,offer_type,title,description,reference_value,looking_for,open_to_proposals,accepts_cash_difference,city,status,created_at,profiles!offers_profile_id_fkey(display_name),offer_images(storage_path,position)')
    .eq('status','ativo')
    .eq('market_scope',marketMode);

  const wanted=$('search')?.value?.trim();
  const have=$('haveSearch')?.value?.trim();
  const type=$('typeFilter')?.value||'';
  const cash=$('cashFilter')?.value||'';
  const sort=$('sortFilter')?.value||'recent';

  if(wanted)q=q.or(`title.ilike.%${wanted}%,description.ilike.%${wanted}%`);
  if(have)q=q.ilike('looking_for',`%${have}%`);
  if(type)q=q.eq('offer_type',type);
  if(cash!=='')q=q.eq('accepts_cash_difference',cash==='true');

  if(sort==='low')q=q.order('reference_value',{ascending:true});
  else if(sort==='high')q=q.order('reference_value',{ascending:false});
  else q=q.order('created_at',{ascending:false});

  const {data,error}=await q;

  if(error){
    $('offers').innerHTML=`<div class="panel error-panel">${esc(error.message)}</div>`;
    if($('resultsCount'))$('resultsCount').textContent='0 oportunidades';
    return;
  }

  const rows=data||[];
  rememberOfferImages(rows);
  await loadReputations(rows.map(o=>o.user_id));

  if($('resultsCount')){
    $('resultsCount').textContent=
      `${rows.length} ${rows.length===1?'oportunidade':'oportunidades'}`;
  }

  const empty=`<div class="panel explore-empty">
    <div class="empty-icon">🔄</div>
    <h3>Não encontrou a troca ideal?</h3>
    <p class="muted">
      Publique o que você tem e diga o que procura.
      Quem estiver interessado poderá enviar uma proposta.
    </p>
    <button class="p" onclick="need('publish')">
      + Publicar minha oferta
    </button>
  </div>`;

  $('offers').innerHTML=
    rows.length?rows.map(card).join(''):empty;

  const recent=$('recent');

  if(recent&&!wanted&&!have&&!type&&cash===''){
    recent.innerHTML=
      rows.slice(0,6).map(card).join('')||
      '<p class="muted">Nenhuma oportunidade ainda.</p>';
  }
}

function clearExploreFilters(){
  if($('search'))$('search').value='';
  if($('haveSearch'))$('haveSearch').value='';
  if($('typeFilter'))$('typeFilter').value='';
  if($('cashFilter'))$('cashFilter').value='';
  if($('sortFilter'))$('sortFilter').value='recent';
  loadOffers();
}

function card(o){
  const mine=session?.user?.id===o.user_id;

  const cash=o.accepts_cash_difference
    ?'<span class="mini-badge cash-yes">💰 Aceita diferença</span>'
    :'<span class="mini-badge">Troca direta</span>';

  const open=o.open_to_proposals
    ?'<span class="mini-badge">🤝 Aberto a propostas</span>'
    :'';

  const images=normalizeOfferImages(o.offer_images||[]);
  const cover=images[0];
  const media=cover?`<button type="button" class="offer-photo" onclick="openOfferGallery('${o.id}',0)" aria-label="Ver fotos da oferta"><img src="${publicImageUrl(cover.storage_path)}" alt="${esc(o.title)}" loading="lazy"><span class="photo-count">📷 ${images.length}</span></button>`:'';

  return `<article class="card exchange-card">
    ${media}
    <div class="exchange-top">
      <span class="tag">${esc(o.offer_type)}</span>
      <span class="muted">${esc(o.city||'Ponta Grossa')}</span>
    </div>

    <div class="exchange-label">OFERECE</div>

    <h3>${esc(o.title)}</h3>

    <div class="price">${money(o.reference_value)}</div>

    <p class="muted exchange-desc">
      ${esc(o.description||'Sem descrição.')}
    </p>

    <div class="exchange-target">
      <div class="exchange-label">PROCURA</div>
      <strong>
        🎯 ${esc(o.looking_for||'Aberto a propostas')}
      </strong>
    </div>

    <div class="exchange-badges">
      ${open}${cash}
    </div>

    <div class="exchange-footer">
      <div class="offer-owner">
        <span class="muted">Por: ${esc(o.profiles?.display_name||'Usuário')}</span>
        ${reputationLabel(o.user_id)}
      </div>

      ${
        mine
          ?'<span class="mine-label">Sua oferta</span>'
          :`<div class="offer-card-actions">
              <button class="p" onclick="proposal('${o.id}')">🤝 Fazer proposta</button>
              <button class="report-btn" onclick="openReportOffer('${o.id}','${o.user_id}')">⚑ Denunciar</button>
            </div>`
      }
    </div>
  </article>`;
}


function openReportOffer(offerId,userId){
  if(!session)return go('auth');
  if(session.user.id===userId)return alert('Você não pode denunciar sua própria oferta.');
  reportingOfferId=offerId;reportingUserId=userId;
  $('reportReason').value='';$('reportDetails').value='';$('reportMsg').textContent='';
  $('reportModal').classList.remove('hide');
}
function closeReport(){reportingOfferId=null;reportingUserId=null;$('reportModal').classList.add('hide')}
async function submitReport(){
  if(!reportingOfferId&&!reportingUserId)return;
  const reason=$('reportReason').value.trim(),details=$('reportDetails').value.trim();
  if(reason.length<3)return $('reportMsg').textContent='Selecione um motivo para a denúncia.';
  $('reportMsg').textContent='Enviando denúncia...';
  const {error}=await sb.rpc('create_report',{p_reported_offer_id:reportingOfferId,p_reason:reason,p_details:details||null});
  if(error)return $('reportMsg').textContent=error.message;
  closeReport();alert('✅ Denúncia enviada para análise administrativa.');
}

async function proposal(id){
  if(!session)return go('auth');

  const {data:existing}=await sb
    .from('proposals')
    .select('id,status')
    .eq('offer_id',id)
    .eq('from_user_id',session.user.id)
    .maybeSingle();

  if(existing){
    return alert('Você já enviou uma proposta para esta oferta.');
  }

  const msg=prompt('O que você oferece em troca?');

  if(!msg)return;

  const val=prompt(
    'Valor aproximado da sua proposta (opcional):'
  );

  const {error}=await sb.from('proposals').insert({
    offer_id:id,
    from_user_id:session.user.id,
    message:msg,
    offered_description:msg,
    offered_value:val?+val:null
  });

  if(error&&error.code==='23505'){
    return alert('Você já enviou uma proposta para esta oferta.');
  }

  alert(
    error
      ?error.message
      :'🤝 Proposta enviada. Seu WhatsApp continua protegido.'
  );
}

function setProposalTab(tab){
  proposalTab=tab;

  $('receivedTab').className=
    tab==='received'?'p':'s';

  $('sentTab').className=
    tab==='sent'?'p':'s';

  loadInbox();
}

async function loadInbox(){
  proposalTab==='received'
    ?await loadReceived()
    :await loadSent();
}
async function businessOfferIds(){
  const {data,error}=await sb.from('offers').select('id').eq('market_scope',marketMode);
  if(error){console.error(error);return []}
  return (data||[]).map(x=>x.id);
}

async function loadReceived(){
  const ids=await businessOfferIds();
  if(!ids.length){$('proposalList').innerHTML='<div class="panel"><p class="muted">Nenhuma proposta neste ambiente.</p></div>';return}
  const {data,error}=await sb
    .from('proposal_inbox')
    .select('*')
    .eq('offer_owner_id',session.user.id)
    .in('offer_id',ids)
    .order('created_at',{ascending:false});

  if(error){
    return $('proposalList').innerHTML=
      `<p>${esc(error.message)}</p>`;
  }

  $('proposalList').innerHTML=(data||[]).map(p=>{

    const pending=p.status==='pendente';
    const accepted=p.status==='aceita';

    const actions=[
      p.contact_unlocked
        ?`<button class="s"
             onclick="contact('${p.id}')">
             📱 Ver contato
           </button>`
        :'',

      pending
        ?`<button class="p"
             onclick="unlock('${p.id}',${+p.offer_reference_value||0})">
             Aceitar e liberar contato
           </button>`
        :'',

      pending
        ?`<button class="danger-btn"
             onclick="rejectProposal('${p.id}')">
             Recusar proposta
           </button>`
        :'',

      accepted
        ?`<button class="p"
             onclick="completePermuta('${p.id}')">
             ✅ Marcar permuta concluída
           </button>`
        :''
    ].join('');

    return `<div class="panel">

      <b>
        Para: ${esc(p.offer_title)}
      </b>

      <div class="proposal">

        <b>
          ${esc(p.sender_name||'Usuário')}
        </b>

        <p>
          ${esc(p.message)}
        </p>

        ${
          p.offered_value
            ?`<p>
                Valor informado:
                ${money(p.offered_value)}
              </p>`
            :''
        }

      </div>

      <p>
        Status:
        <b>${statusLabel(p.status)}</b>
      </p>

      ${
        actions
          ?`<div class="actions">
              ${actions}
            </div>`
          :''
      }

    </div>`;

  }).join('')||
  '<p class="muted">Nenhuma proposta recebida.</p>';
}

async function loadSent(){
  const ids=await businessOfferIds();
  if(!ids.length){$('proposalList').innerHTML='<div class="panel"><p class="muted">Nenhuma proposta neste ambiente.</p></div>';return}

  const {data,error}=await sb
    .from('proposal_inbox')
    .select('*')
    .eq('from_user_id',session.user.id)
    .in('offer_id',ids)
    .order('created_at',{ascending:false});

  if(error){
    return $('proposalList').innerHTML=
      `<p>${esc(error.message)}</p>`;
  }

  $('proposalList').innerHTML=(data||[]).map(p=>`

    <div class="panel">

      <b>
        Proposta enviada para:
        ${esc(p.offer_title)}
      </b>

      <div class="proposal">

        <p>
          ${esc(p.message)}
        </p>

        ${
          p.offered_value
            ?`<p>
                Valor informado:
                ${money(p.offered_value)}
              </p>`
            :''
        }

      </div>

      <p>
        Status:
        <b>${statusLabel(p.status)}</b>
      </p>

      ${
        p.status==='aceita'
          ?'<p class="muted">🎉 Sua proposta foi aceita.</p>'
          :''
      }

      ${
        p.status==='pendente'
          ?`<div class="actions">
              <button class="danger-btn"
                onclick="cancelProposal('${p.id}')">
                Cancelar proposta
              </button>
            </div>`
          :''
      }

    </div>

  `).join('')||
  '<p class="muted">Nenhuma proposta enviada.</p>';
}

const statusLabel=s=>({
  pendente:'Pendente',
  aceita:'Aceita',
  recusada:'Recusada',
  cancelada:'Cancelada',
  concluida:'Concluída'
})[s]||s;

async function rejectProposal(id){

  if(!confirm('Recusar esta proposta?')){
    return;
  }

  const {error}=await sb.rpc(
    'reject_proposal',
    {p_proposal_id:id}
  );

  if(error){
    return alert(error.message);
  }

  alert('Proposta recusada.');

  loadInbox();
}

async function cancelProposal(id){

  if(!confirm('Cancelar a proposta enviada?')){
    return;
  }

  const {error}=await sb.rpc(
    'cancel_proposal',
    {p_proposal_id:id}
  );

  if(error){
    return alert(error.message);
  }

  alert('Proposta cancelada.');

  loadInbox();
}

async function unlock(id,v){

  const cost=
    v<=500
      ?1
      :v<=3000
        ?2
        :v<=10000
          ?3
          :4;

  if(!confirm(
    `Liberar contato? Após os grátis, esta faixa usa ${cost} crédito(s).`
  )){
    return;
  }

  const {data,error}=await sb.rpc(
    'accept_proposal_and_unlock',
    {p_proposal_id:id}
  );

  if(error){
    return alert(error.message);
  }

  await hydrate();

  alert(
    `🎉 WhatsApp: ${data?.[0]?.whatsapp||'não informado'}`
  );

  loadInbox();
}

async function contact(id){

  const {data,error}=await sb.rpc(
    'get_unlocked_contact',
    {p_proposal_id:id}
  );

  alert(
    error
      ?error.message
      :`WhatsApp: ${data?.[0]?.whatsapp||'não informado'}`
  );
}

async function completePermuta(proposalId){

  if(!confirm(
    'Confirmar que esta permuta foi concluída? A oferta deixará de aparecer no Explorar.'
  )){
    return;
  }

  const {error}=await sb.rpc(
    'complete_permutation',
    {p_proposal_id:proposalId}
  );

  if(error){
    return alert(error.message);
  }

  alert('✅ Permuta marcada como concluída.');

  loadInbox();
}

function offerStatusLabel(status){

  return ({
    ativo:'Ativo',
    pausado:'Pausado',
    concluido:'Concluído',
    concluida:'Concluída'
  })[status]||status||'—';
}

function offerStatusClass(status){

  return [
    'ativo',
    'pausado',
    'concluido',
    'concluida'
  ].includes(status)
    ?`status-${status}`
    :'status-outro';
}

function accountOfferCard(o){

  const statusAction=
    o.status==='ativo'
      ?`<button class="s"
           onclick="setOfferStatus('${o.id}','pausado')">
           ⏸️ Pausar
         </button>`
      :o.status==='pausado'
        ?`<button class="p"
             onclick="setOfferStatus('${o.id}','ativo')">
             ▶️ Reativar
           </button>`
        :'';

  const editAction=
    (o.status==='ativo'||o.status==='pausado')
      ?`<button class="s"
           onclick="openEditOffer('${o.id}')">
           ✏️ Editar
         </button>`
      :'';

  const proposals=
    Number(o._proposal_count||0);

  const images=normalizeOfferImages(o.offer_images||[]);
  const cover=images[0];
  const media=cover?`<button type="button" class="offer-photo my-offer-photo" onclick="openOfferGallery('${o.id}',0)"><img src="${publicImageUrl(cover.storage_path)}" alt="${esc(o.title)}" loading="lazy"><span class="photo-count">📷 ${images.length}</span></button>`:'';

  return `<article class="card my-offer">
    ${media}

    <div class="my-offer-top">

      <div class="offer-meta-row">

        <span class="tag">
          ${esc(o.offer_type)}
        </span>

        <span class="proposal-count">
          🤝 ${proposals}
          ${proposals===1?'proposta':'propostas'}
        </span>

      </div>

      <span class="status-badge ${offerStatusClass(o.status)}">
        ${esc(offerStatusLabel(o.status))}
      </span>

    </div>

    <h3>
      ${esc(o.title)}
    </h3>

    <div class="price">
      ${money(o.reference_value)}
    </div>

    <p class="muted offer-desc">
      ${esc(o.description||'Sem descrição.')}
    </p>

    <div class="offer-want">
      🎯 <b>Procura:</b>
      ${esc(o.looking_for||'Aberto a propostas')}
    </div>

    ${
      (editAction||statusAction)
        ?`<div class="actions">
            ${editAction}
            ${statusAction}
          </div>`
        :''
    }

  </article>`;
}

async function openEditOffer(id){
  const {data,error}=await sb
    .from('offers')
    .select('id,title,reference_value,looking_for,description,status,offer_images(id,storage_path,position)')
    .eq('id',id)
    .eq('user_id',session.user.id)
    .maybeSingle();

  if(error||!data)return alert(error?.message||'Oferta não encontrada.');
  if(data.status==='concluido'||data.status==='concluida')return alert('Ofertas concluídas não podem ser editadas.');

  editingOfferId=id;
  editingOriginalImages=normalizeOfferImages(data.offer_images||[]);
  editingExistingImages=editingOriginalImages.slice();
  editNewImageFiles=[];

  $('editTitle').value=data.title||'';
  $('editValue').value=data.reference_value||'';
  $('editWant').value=data.looking_for||'';
  $('editDesc').value=data.description||'';
  $('editMsg').textContent='';
  renderEditImages();
  $('editModal').classList.remove('hide');
}

function renderEditImages(){
  const existing=$('editExistingImages');
  if(existing){
    existing.innerHTML=editingExistingImages.map((img,i)=>`<div class="image-preview-item">
      <img src="${publicImageUrl(img.storage_path)}" alt="Foto atual ${i+1}">
      <button type="button" class="image-remove" onclick="removeExistingEditImage('${img.id}')">×</button>
      ${i===0?'<span class="cover-pill">Capa</span>':''}
    </div>`).join('');
  }
  renderSelectedImages(editNewImageFiles,'editNewImagePreview','edit');
  const total=editingExistingImages.length+editNewImageFiles.length;
  if($('editImageCount'))$('editImageCount').textContent=`${total}/${MAX_OFFER_IMAGES} fotos`;
}

function handleEditImages(input){
  const incoming=[...(input.files||[])];
  const remaining=MAX_OFFER_IMAGES-editingExistingImages.length-editNewImageFiles.length;
  if(incoming.length>remaining)alert(`Você pode manter no máximo ${MAX_OFFER_IMAGES} fotos por oferta.`);
  editNewImageFiles.push(...incoming.slice(0,Math.max(0,remaining)));
  input.value='';
  renderEditImages();
}

function removeExistingEditImage(id){
  editingExistingImages=editingExistingImages.filter(img=>img.id!==id);
  renderEditImages();
}

function removeEditNewImage(index){
  editNewImageFiles.splice(index,1);
  renderEditImages();
}

function closeEditOffer(){
  editingOfferId=null;
  editingExistingImages=[];
  editingOriginalImages=[];
  editNewImageFiles=[];
  $('editModal').classList.add('hide');
}
async function saveEditOffer(){
  if(!editingOfferId)return;

  const payload={
    title:$('editTitle').value.trim(),
    reference_value:+$('editValue').value,
    looking_for:$('editWant').value.trim(),
    description:$('editDesc').value.trim()
  };

  if(!payload.title||!payload.reference_value||payload.reference_value<=0){
    $('editMsg').textContent='Informe a oferta e um valor válido.';
    return;
  }

  $('editMsg').textContent='Salvando...';
  const offerId=editingOfferId;

  const {error}=await sb.from('offers').update(payload).eq('id',offerId).eq('user_id',session.user.id);
  if(error){$('editMsg').textContent=error.message;return;}

  const retainedIds=new Set(editingExistingImages.map(img=>img.id));
  const removed=editingOriginalImages.filter(img=>!retainedIds.has(img.id));

  if(removed.length){
    const {error:storageError}=await sb.storage.from(IMAGE_BUCKET).remove(removed.map(img=>img.storage_path));
    if(storageError){$('editMsg').textContent=`Oferta salva, mas não foi possível remover uma foto: ${storageError.message}`;return;}
    const {error:dbDeleteError}=await sb.from('offer_images').delete().in('id',removed.map(img=>img.id));
    if(dbDeleteError){$('editMsg').textContent=`Oferta salva, mas houve erro ao atualizar as fotos: ${dbDeleteError.message}`;return;}
  }

  if(editNewImageFiles.length){
    const used=new Set(editingExistingImages.map(img=>img.position));
    const freePositions=[0,1,2,3,4].filter(p=>!used.has(p)).slice(0,editNewImageFiles.length);
    try{
      await uploadOfferImages(offerId,editNewImageFiles,freePositions);
    }catch(imageError){
      console.error(imageError);
      $('editMsg').textContent=`Oferta salva, mas alguma nova foto não pôde ser enviada: ${imageError.message||imageError}`;
      return;
    }
  }

  closeEditOffer();
  await loadAccount();
  await loadOffers();
  alert('✅ Oferta atualizada.');
}
async function setOfferStatus(id,status){

  const msg=
    status==='pausado'
      ?'Pausar esta oferta? Ela deixará de aparecer no Explorar até ser reativada.'
      :'Reativar esta oferta? Ela voltará a aparecer no Explorar.';

  if(!confirm(msg)){
    return;
  }

  const {error}=await sb
    .from('offers')
    .update({status})
    .eq('id',id)
    .eq('user_id',session.user.id);

  if(error){
    return alert(error.message);
  }

  alert(
    status==='pausado'
      ?'⏸️ Oferta pausada.'
      :'✅ Oferta reativada.'
  );

  await loadAccount();

  await loadOffers();
}

function historyCard(p){
  const iOwn=p.offer_owner_id===session.user.id;
  const other=iOwn?(p.sender_name||'Usuário'):'Outro participante';
  const role=iOwn?'Você recebeu a proposta':'Você enviou a proposta';
  const alreadyReviewed=window.__reviewedProposalIds.has(p.id);
  return `<div class="panel history-item">
    <div class="history-top">
      <div><span class="status-badge status-concluida">Concluída</span><h4>${esc(p.offer_title||'Oferta')}</h4></div>
      <div class="history-value">${money(p.offered_value||0)}</div>
    </div>
    <p class="muted">${role}</p>
    <div class="proposal"><b>${esc(other)}</b><p>${esc(p.message||'')}</p></div>
    <div class="history-review-action">
      ${alreadyReviewed?'<span class="review-done">⭐ Avaliação enviada</span>':`<button class="review-btn" onclick="openReview('${p.id}')">⭐ Avaliar usuário</button>`}
    </div>
  </div>`;
}
function openReview(proposalId){
  reviewingProposalId=proposalId;
  $('reviewRating').value='5';$('reviewComment').value='';$('reviewMsg').textContent='';
  updateReviewStars();$('reviewModal').classList.remove('hide');
}
function closeReview(){reviewingProposalId=null;$('reviewModal')?.classList.add('hide')}
function updateReviewStars(){
  const value=Number($('reviewRating')?.value||5);
  if($('reviewStars'))$('reviewStars').textContent='★'.repeat(value)+'☆'.repeat(5-value);
}
async function submitReview(){
  if(!reviewingProposalId)return;
  const rating=Number($('reviewRating').value),comment=$('reviewComment').value.trim();
  $('reviewMsg').textContent='Enviando avaliação...';$('reviewSubmit')?.setAttribute('disabled','disabled');
  const {error}=await sb.rpc('create_review',{p_proposal_id:reviewingProposalId,p_rating:rating,p_comment:comment||null});
  $('reviewSubmit')?.removeAttribute('disabled');
  if(error){$('reviewMsg').textContent=error.message;return;}
  closeReview();await loadAccount();await loadOffers();
  alert('⭐ Avaliação enviada. Obrigado por ajudar a construir uma comunidade mais confiável.');
}

async function loadAccount(){

  await hydrate();

  const displayName=
    me?.display_name||
    session.user.email||
    'Usuário';

  const accountType=
    me?.account_type==='empresa'
      ?'Empresa / Profissional'
      :'Pessoa';

  $('profile').textContent=
    `${displayName} · ${me?.account_type||''}`;

  $('accountName').textContent=
    displayName;

  $('accountEmail').textContent=
    session.user.email||'';

  $('accountType').textContent=
    accountType;

  $('credits').textContent=
    wallet?.credits||0;

  $('free').textContent=
    wallet?.free_unlocks||0;

  const [
    offersRes,
    receivedAllRes,
    receivedDoneRes,
    sentDoneRes
  ]=await Promise.all([

    sb.from('offers')
      .select('*,offer_images(id,storage_path,position)')
      .eq('user_id',session.user.id)
      .order('created_at',{ascending:false}),

    sb.from('proposal_inbox')
      .select('id,offer_id,status')
      .eq('offer_owner_id',session.user.id),

    sb.from('proposal_inbox')
      .select('*')
      .eq('offer_owner_id',session.user.id)
      .eq('status','concluida')
      .order('created_at',{ascending:false}),

    sb.from('proposal_inbox')
      .select('*')
      .eq('from_user_id',session.user.id)
      .eq('status','concluida')
      .order('created_at',{ascending:false})
  ]);

  if(offersRes.error){

    $('activeCount').textContent='—';

    $('completedCount').textContent='—';

    $('mine').innerHTML=
      `<div class="panel error-panel">
        Não foi possível carregar suas ofertas.
        <br>
        <small>
          ${esc(offersRes.error.message)}
        </small>
      </div>`;

    $('swapHistory').innerHTML=
      '<div class="panel"><p class="muted">Não foi possível carregar o histórico.</p></div>';

    return;
  }

  const proposalCounts={};

  for(const p of (receivedAllRes.data||[])){

    proposalCounts[p.offer_id]=
      (proposalCounts[p.offer_id]||0)+1;
  }

  const offers=
    (offersRes.data||[]).map(o=>({
      ...o,
      _proposal_count:
        proposalCounts[o.id]||0
    }));

  rememberOfferImages(offers);

  $('activeCount').textContent=
    offers.filter(o=>o.status==='ativo').length;

  $('mine').innerHTML=
    offers.length
      ?offers.map(accountOfferCard).join('')
      :`<div class="panel empty-state">

          <div class="empty-icon">
            📦
          </div>

          <h4>
            Nenhuma oferta publicada
          </h4>

          <p class="muted">
            Publique sua primeira oferta para começar a receber propostas.
          </p>

          <button class="p"
            onclick="go('publish')">
            + Publicar primeira oferta
          </button>

        </div>`;

  const allDone=[
    ...(receivedDoneRes.data||[]),
    ...(sentDoneRes.data||[])
  ];

  const uniqueDone=[
    ...new Map(
      allDone.map(p=>[p.id,p])
    ).values()
  ];

  await Promise.all([
    loadMyReviewedProposals(uniqueDone.map(p=>p.id)),
    loadReputations([session.user.id])
  ]);

  if($('accountReputation'))$('accountReputation').innerHTML=reputationLabel(session.user.id);

  $('completedCount').textContent=
    uniqueDone.length;

  if(
    receivedAllRes.error||
    receivedDoneRes.error||
    sentDoneRes.error
  ){

    $('swapHistory').innerHTML=
      '<div class="panel"><p class="muted">Não foi possível carregar todo o histórico de permutas.</p></div>';

  }else{

    $('swapHistory').innerHTML=
      uniqueDone.length
        ?uniqueDone.map(historyCard).join('')
        :`<div class="panel empty-state">

            <div class="empty-icon">
              🤝
            </div>

            <h4>
              Nenhuma permuta concluída ainda
            </h4>

            <p class="muted">
              Quando uma negociação for finalizada, ela aparecerá aqui.
            </p>

          </div>`;
  }
}

function homeSearch(){

  const wanted=
    $('homeWanted')?.value?.trim()||'';

  const have=
    $('homeHave')?.value?.trim()||'';

  const type=
    $('homeType')?.value||'';

  const cash=
    $('homeCash')?.value||'';

  const sort=
    $('homeSort')?.value||'recent';

  go('explore');

  if($('search')){
    $('search').value=wanted;
  }

  if($('haveSearch')){
    $('haveSearch').value=have;
  }

  if($('typeFilter')){
    $('typeFilter').value=type;
  }

  if($('cashFilter')){
    $('cashFilter').value=cash;
  }

  if($('sortFilter')){
    $('sortFilter').value=sort;
  }

  loadOffers();
}

const LEGAL_CONTENT={

  terms:`
  <p>
    <b>
      Última atualização: 28/08/2026.
    </b>
  </p>

  <h4>
    1. Sobre a plataforma
  </h4>

  <p>
    O Permuta PG é uma plataforma local que aproxima pessoas e empresas interessadas em permutar produtos, serviços, veículos, imóveis ou créditos de estabelecimentos. O Permuta PG não é parte da negociação e não garante a qualidade, propriedade, legalidade ou entrega do que é anunciado.
  </p>

  <h4>
    2. Responsabilidade do usuário
  </h4>

  <p>
    Você deve fornecer informações verdadeiras, anunciar somente itens ou serviços que possa legitimamente negociar e verificar pessoalmente as condições da permuta antes de concluí-la.
  </p>

  <h4>
    3. Propostas e contato
  </h4>

  <p>
    O contato permanece protegido até a aceitação da proposta conforme as regras da plataforma. A liberação de contato pode consumir liberações gratuitas ou créditos conforme informado antes da confirmação.
  </p>

  <h4>
    4. Conteúdo proibido
  </h4>

  <p>
    Não é permitido anunciar itens ilegais, ilícitos, fraudulentos, perigosos ou que violem direitos de terceiros. A plataforma poderá remover ofertas e restringir contas em caso de abuso.
  </p>

  <h4>
    5. Segurança
  </h4>

  <p>
    Recomendamos verificar identidade, propriedade, estado do item e documentos aplicáveis, além de escolher local seguro para encontros. Nunca faça pagamentos sem confirmar os detalhes da negociação.
  </p>

  <h4>
    6. Alterações
  </h4>

  <p>
    Estes termos podem ser atualizados conforme a plataforma evoluir. O uso continuado após uma atualização estará sujeito à versão vigente.
  </p>
  `,

  privacy:`
  <p>
    <b>
      Última atualização: 28/08/2026.
    </b>
  </p>

  <h4>
    1. Dados tratados
  </h4>

  <p>
    Podemos tratar dados fornecidos no cadastro, como nome, e-mail, tipo de perfil e WhatsApp, além de dados das ofertas, propostas, histórico de permutas e informações técnicas necessárias ao funcionamento e à segurança da plataforma.
  </p>

  <h4>
    2. Finalidades
  </h4>

  <p>
    Os dados são usados para criar e autenticar contas, publicar ofertas, permitir propostas, proteger e liberar contato quando autorizado, manter histórico, prevenir abuso e operar a plataforma.
  </p>

  <h4>
    3. Compartilhamento
  </h4>

  <p>
    O WhatsApp não é exibido publicamente e somente é liberado dentro do fluxo autorizado da proposta. Dados também podem ser processados por fornecedores técnicos necessários à operação, como serviços de autenticação e banco de dados.
  </p>

  <h4>
    4. Retenção e segurança
  </h4>

  <p>
    Os dados são mantidos pelo período necessário às finalidades da plataforma e às obrigações aplicáveis. São adotadas medidas técnicas para restringir o acesso, embora nenhum sistema seja totalmente isento de riscos.
  </p>

  <h4>
    5. Seus direitos
  </h4>

  <p>
    O titular pode solicitar informações, correção e demais direitos previstos na legislação aplicável. Antes do lançamento público, a plataforma deverá disponibilizar um canal oficial de privacidade para essas solicitações.
  </p>

  <h4>
    6. Contato
  </h4>

  <p>
    O canal oficial de privacidade será informado no site antes do lançamento público.
  </p>
  `
};

function openLegal(kind){

  $('legalTitle').textContent=
    kind==='privacy'
      ?'Política de Privacidade'
      :'Termos de Uso';

  $('legalBody').innerHTML=
    LEGAL_CONTENT[kind]||'';

  $('legalModal').classList.remove('hide');
}

function closeLegal(){

  $('legalModal').classList.add('hide');
}

async function loadAdmin(){
  if(!session)return go('auth');
  await hydrate();
  if(me?.role!=='admin'){alert('Acesso restrito ao administrador.');return go('account')}
  const loading='<div class="panel"><p class="muted">Carregando...</p></div>';
  ['adminUsers','adminOffers','adminProposals','adminReports'].forEach(id=>{if($(id))$(id).innerHTML=loading});
  const [summaryRes,usersRes,offersRes,proposalsRes,reportsRes]=await Promise.all([
    sb.rpc('admin_get_summary'),sb.rpc('admin_list_users'),sb.rpc('admin_list_offers'),
    sb.rpc('admin_list_proposals'),sb.rpc('admin_list_reports')
  ]);
  if(summaryRes.error){
    ['adminUserCount','adminBlockedCount','adminOfferCount','adminActiveOfferCount','adminProposalCount','adminPendingProposalCount','adminCompletedCount','adminOpenReportCount'].forEach(id=>{if($(id))$(id).textContent='—'})
  }else{
    const s=Array.isArray(summaryRes.data)?summaryRes.data[0]:summaryRes.data;
    if(s){
      $('adminUserCount').textContent=s.total_users??0;$('adminBlockedCount').textContent=s.blocked_users??0;
      $('adminOfferCount').textContent=s.total_offers??0;$('adminActiveOfferCount').textContent=s.active_offers??0;
      $('adminProposalCount').textContent=s.total_proposals??0;$('adminPendingProposalCount').textContent=s.pending_proposals??0;
      $('adminCompletedCount').textContent=s.completed_offers??0;$('adminOpenReportCount').textContent=s.open_reports??0;
    }
  }
  if(usersRes.error)$('adminUsers').innerHTML=`<div class="panel error-panel"><b>Não foi possível carregar os usuários.</b><br><small>${esc(usersRes.error.message)}</small></div>`;
  else renderAdminUsers(usersRes.data||[]);
  if(offersRes.error)$('adminOffers').innerHTML=`<div class="panel error-panel"><b>Não foi possível carregar as ofertas.</b><br><small>${esc(offersRes.error.message)}</small></div>`;
  else renderAdminOffers(offersRes.data||[]);
  if(proposalsRes.error)$('adminProposals').innerHTML=`<div class="panel error-panel"><b>Não foi possível carregar as propostas.</b><br><small>${esc(proposalsRes.error.message)}</small></div>`;
  else renderAdminProposals(proposalsRes.data||[]);
  if(reportsRes.error)$('adminReports').innerHTML=`<div class="panel error-panel"><b>Não foi possível carregar as denúncias.</b><br><small>${esc(reportsRes.error.message)}</small></div>`;
  else renderAdminReports(reportsRes.data||[]);
}

function renderAdminUsers(rows){

  const q=
    ($('adminSearch')?.value||'')
      .trim()
      .toLowerCase();

  const filtered=
    !q
      ?rows
      :rows.filter(u=>
        [
          u.display_name,
          u.email,
          u.whatsapp,
          u.account_type,
          u.city,
          u.role,
          u.verified
            ?'verificado'
            :'não verificado',
          u.blocked
            ?'bloqueado'
            :'ativo'
        ].some(v=>
          String(v||'')
            .toLowerCase()
            .includes(q)
        )
      );

  window.__adminUsers=rows;

  $('adminUsers').innerHTML=
    filtered.length
      ?`
        <div class="admin-table-wrap">

          <table class="admin-table">

            <thead>

              <tr>

                <th>
                  Usuário
                </th>

                <th>
                  E-mail
                </th>

                <th>
                  WhatsApp
                </th>

                <th>
                  Perfil
                </th>

                <th>
                  Cidade
                </th>

                <th>
                  Verificação
                </th>

                <th>
                  Acesso
                </th>

                <th>
                  Conta
                </th>

                <th>
                  Cadastro
                </th>

                <th>
                  Ações
                </th>

              </tr>

            </thead>

            <tbody>

              ${filtered.map(u=>{

                const isSelf=
                  session?.user?.id===u.id;

                const verifyButton=
                  u.verified
                    ?`
                      <button
                        class="admin-action pause"
                        onclick="adminSetUserVerified('${u.id}',false)"
                      >
                        Remover verificação
                      </button>
                    `
                    :`
                      <button
                        class="admin-action activate"
                        onclick="adminSetUserVerified('${u.id}',true)"
                      >
                        ✓ Verificar
                      </button>
                    `;

                const roleButton=
                  isSelf
                    ?`
                      <span class="muted">
                        Sua conta
                      </span>
                    `
                    :u.role==='admin'
                      ?`
                        <button
                          class="admin-action pause"
                          onclick="adminSetUserRole('${u.id}','user')"
                        >
                          Remover Admin
                        </button>
                      `
                      :`
                        <button
                          class="admin-action activate"
                          onclick="adminSetUserRole('${u.id}','admin')"
                        >
                          Tornar Admin
                        </button>
                      `;

                const blockButton=
                  isSelf
                    ?''
                    :u.blocked
                      ?`
                        <button
                          class="admin-action activate"
                          onclick="adminSetUserBlocked('${u.id}',false)"
                        >
                          Desbloquear
                        </button>
                      `
                      :`
                        <button
                          class="danger-btn"
                          onclick="adminSetUserBlocked('${u.id}',true)"
                        >
                          Bloquear
                        </button>
                      `;

                return `
                  <tr>

                    <td>

                      <b>
                        ${esc(u.display_name||'Usuário')}
                      </b>

                      ${
                        u.role==='admin'
                          ?'<span class="admin-pill">ADMIN</span>'
                          :''
                      }

                    </td>

                    <td>
                      ${esc(u.email||'—')}
                    </td>

                    <td>

                      ${
                        u.whatsapp
                          ?`
                            <a
                              class="wa-link"
                              href="https://wa.me/${String(u.whatsapp).replace(/\D/g,'')}"
                              target="_blank"
                              rel="noopener"
                            >
                              ${esc(u.whatsapp)}
                            </a>
                          `
                          :'—'
                      }

                    </td>

                    <td>
                      ${esc(u.account_type||'—')}
                    </td>

                    <td>
                      ${esc(u.city||'—')}
                    </td>

                    <td>

                      ${
                        u.verified
                          ?'<span class="status-badge status-ativo">Verificado</span>'
                          :'<span class="status-badge status-pausado">Não verificado</span>'
                      }

                    </td>

                    <td>

                      ${
                        u.role==='admin'
                          ?'<span class="status-badge status-concluido">Admin</span>'
                          :'<span class="status-badge">Usuário</span>'
                      }

                    </td>

                    <td>

                      ${
                        u.blocked
                          ?'<span class="status-badge status-pausado">Bloqueado</span>'
                          :'<span class="status-badge status-ativo">Ativo</span>'
                      }

                    </td>

                    <td>

                      ${
                        u.created_at
                          ?new Date(
                            u.created_at
                          ).toLocaleDateString(
                            'pt-BR'
                          )
                          :'—'
                      }

                    </td>

                    <td>

                      <div class="actions">

                        ${verifyButton}

                        ${roleButton}

                        ${blockButton}

                      </div>

                    </td>

                  </tr>
                `;

              }).join('')}

            </tbody>

          </table>

        </div>
      `
      :`
        <div class="panel empty-state">

          <h4>
            Nenhum usuário encontrado
          </h4>

          <p class="muted">
            Tente outro nome, e-mail ou WhatsApp.
          </p>

        </div>
      `;
}

function filterAdminUsers(){

  renderAdminUsers(
    window.__adminUsers||[]
  );
}

async function adminSetUserVerified(id,verified){

  const text=
    verified
      ?'Marcar este usuário como verificado?'
      :'Remover a verificação deste usuário?';

  if(!confirm(text)){
    return;
  }

  const {error}=await sb.rpc(
    'admin_set_user_verified',
    {
      p_user_id:id,
      p_verified:verified
    }
  );

  if(error){
    return alert(error.message);
  }

  alert(
    verified
      ?'✅ Usuário verificado.'
      :'Verificação removida.'
  );

  await loadAdmin();
}

async function adminSetUserRole(id,role){

  const text=
    role==='admin'
      ?'Dar acesso de administrador a este usuário?'
      :'Remover o acesso de administrador deste usuário?';

  if(!confirm(text)){
    return;
  }

  const {error}=await sb.rpc(
    'admin_set_user_role',
    {
      p_user_id:id,
      p_role:role
    }
  );

  if(error){
    return alert(error.message);
  }

  alert(
    role==='admin'
      ?'✅ Usuário promovido a Admin.'
      :'Acesso de Admin removido.'
  );

  await loadAdmin();
}

async function adminSetUserBlocked(id,blocked){

  const text=
    blocked
      ?'Bloquear este usuário?'
      :'Desbloquear este usuário?';

  if(!confirm(text)){
    return;
  }

  const {error}=await sb.rpc(
    'admin_set_user_blocked',
    {
      p_user_id:id,
      p_blocked:blocked
    }
  );

  if(error){
    return alert(error.message);
  }

  alert(
    blocked
      ?'⛔ Usuário bloqueado.'
      :'✅ Usuário desbloqueado.'
  );

  await loadAdmin();
}

function renderAdminOffers(rows){

  const q=
    ($('adminOfferSearch')?.value||'')
      .trim()
      .toLowerCase();

  const status=
    $('adminOfferStatus')?.value||'';

  const filtered=
    (rows||[]).filter(o=>{

      const matchesStatus=
        !status||
        o.status===status;

      const hay=[
        o.title,
        o.description,
        o.looking_for,
        o.offer_type,
        o.city,
        o.display_name,
        o.email
      ]
        .map(v=>
          String(v||'').toLowerCase()
        )
        .join(' ');

      return (
        matchesStatus&&
        (!q||hay.includes(q))
      );
    });

  window.__adminOffers=
    rows||[];

  $('adminOffers').innerHTML=
    filtered.length
      ?`
        <div class="admin-table-wrap">

          <table class="admin-table admin-offers-table">

            <thead>

              <tr>

                <th>
                  Oferta
                </th>

                <th>
                  Usuário
                </th>

                <th>
                  Procura
                </th>

                <th>
                  Valor
                </th>

                <th>
                  Cidade
                </th>

                <th>
                  Status
                </th>

                <th>
                  Cadastro
                </th>

                <th>
                  Ação
                </th>

              </tr>

            </thead>

            <tbody>

              ${filtered.map(o=>`
                <tr>

                  <td>

                    <b>
                      ${esc(o.title||'Oferta')}
                    </b>

                    <small class="admin-cell-sub">
                      ${esc(o.offer_type||'—')}
                    </small>

                  </td>

                  <td>

                    <b>
                      ${esc(o.display_name||'Usuário')}
                    </b>

                    <small class="admin-cell-sub">
                      ${esc(o.email||'')}
                    </small>

                  </td>

                  <td>
                    ${esc(o.looking_for||'—')}
                  </td>

                  <td>
                    ${money(o.reference_value)}
                  </td>

                  <td>
                    ${esc(o.city||'—')}
                  </td>

                  <td>

                    <span class="status-badge ${offerStatusClass(o.status)}">
                      ${esc(offerStatusLabel(o.status))}
                    </span>

                  </td>

                  <td>

                    ${
                      o.created_at
                        ?new Date(
                          o.created_at
                        ).toLocaleDateString(
                          'pt-BR'
                        )
                        :'—'
                    }

                  </td>

                  <td>
                    ${adminOfferAction(o)}
                  </td>

                </tr>
              `).join('')}

            </tbody>

          </table>

        </div>
      `
      :`
        <div class="panel empty-state">

          <h4>
            Nenhuma oferta encontrada
          </h4>

          <p class="muted">
            Ajuste a busca ou o filtro de status.
          </p>

        </div>
      `;
}

function adminOfferAction(o){

  if(o.status==='ativo'){

    return `
      <button
        class="admin-action pause"
        onclick="adminSetOfferStatus('${o.id}','pausado')"
      >
        ⏸ Pausar
      </button>
    `;
  }

  if(o.status==='pausado'){

    return `
      <button
        class="admin-action activate"
        onclick="adminSetOfferStatus('${o.id}','ativo')"
      >
        ▶ Reativar
      </button>
    `;
  }

  return `
    <span class="muted">
      Finalizada
    </span>
  `;
}

function filterAdminOffers(){

  renderAdminOffers(
    window.__adminOffers||[]
  );
}

async function adminSetOfferStatus(id,status){

  const text=
    status==='pausado'
      ?'Pausar esta oferta como administrador? Ela deixará de aparecer no Explorar.'
      :'Reativar esta oferta como administrador? Ela voltará a aparecer no Explorar.';

  if(!confirm(text)){
    return;
  }

  const {error}=await sb.rpc(
    'admin_set_offer_status',
    {
      p_offer_id:id,
      p_status:status
    }
  );

  if(error){
    return alert(error.message);
  }

  alert(
    status==='pausado'
      ?'⏸️ Oferta pausada pelo administrador.'
      :'✅ Oferta reativada pelo administrador.'
  );

  await loadAdmin();

  await loadOffers();
}


function adminProposalStatusClass(status){return ({pendente:'status-pausado',aceita:'status-ativo',recusada:'status-danger',cancelada:'status-muted',concluida:'status-concluida'})[status]||'status-muted'}
function renderAdminProposals(rows){
  window.__adminProposals=rows||[];
  const q=($('adminProposalSearch')?.value||'').trim().toLowerCase(),status=$('adminProposalStatus')?.value||'';
  const filtered=(rows||[]).filter(p=>{
    const hay=[p.offer_title,p.offer_owner_name,p.offer_owner_email,p.from_user_name,p.from_user_email,p.message,p.offered_description].map(v=>String(v||'').toLowerCase()).join(' ');
    return (!status||p.status===status)&&(!q||hay.includes(q));
  });
  $('adminProposals').innerHTML=filtered.length?`<div class="admin-table-wrap"><table class="admin-table admin-proposals-table"><thead><tr><th>Oferta</th><th>Dono da oferta</th><th>Proposta de</th><th>Proposta</th><th>Valor</th><th>Diferença</th><th>Status</th><th>Contato</th><th>Data</th></tr></thead><tbody>${filtered.map(p=>`<tr><td><b>${esc(p.offer_title||'Oferta')}</b></td><td><b>${esc(p.offer_owner_name||'Usuário')}</b><small class="admin-cell-sub">${esc(p.offer_owner_email||'')}</small></td><td><b>${esc(p.from_user_name||'Usuário')}</b><small class="admin-cell-sub">${esc(p.from_user_email||'')}</small></td><td>${esc(p.offered_description||p.message||'—')}</td><td>${p.offered_value!=null?money(p.offered_value):'—'}</td><td>${p.cash_difference!=null?money(p.cash_difference):'—'}</td><td><span class="status-badge ${adminProposalStatusClass(p.status)}">${esc(statusLabel(p.status))}</span></td><td>${p.contact_unlocked?'<span class="status-badge status-ativo">Liberado</span>':'<span class="status-badge status-muted">Protegido</span>'}</td><td>${p.created_at?new Date(p.created_at).toLocaleDateString('pt-BR'):'—'}</td></tr>`).join('')}</tbody></table></div>`:'<div class="panel empty-state"><h4>Nenhuma proposta encontrada</h4><p class="muted">Ajuste a busca ou o filtro.</p></div>';
}
function filterAdminProposals(){renderAdminProposals(window.__adminProposals||[])}
function reportStatusLabel(s){return ({aberto:'Aberto',analisando:'Analisando',resolvido:'Resolvido',arquivado:'Arquivado'})[s]||s||'—'}
function reportStatusClass(s){return ({aberto:'status-danger',analisando:'status-pausado',resolvido:'status-ativo',arquivado:'status-muted'})[s]||'status-muted'}
function renderAdminReports(rows){
  window.__adminReports=rows||[];
  const q=($('adminReportSearch')?.value||'').trim().toLowerCase(),status=$('adminReportStatus')?.value||'';
  const filtered=(rows||[]).filter(r=>{
    const hay=[r.reporter_name,r.reporter_email,r.reported_user_name,r.reported_user_email,r.offer_title,r.reason,r.details,r.status].map(v=>String(v||'').toLowerCase()).join(' ');
    return (!status||r.status===status)&&(!q||hay.includes(q));
  });
  $('adminReports').innerHTML=filtered.length?`<div class="admin-table-wrap"><table class="admin-table admin-reports-table"><thead><tr><th>Denunciante</th><th>Denunciado</th><th>Oferta</th><th>Motivo</th><th>Detalhes</th><th>Status</th><th>Data</th><th>Ações</th></tr></thead><tbody>${filtered.map(r=>`<tr><td><b>${esc(r.reporter_name||'Usuário')}</b><small class="admin-cell-sub">${esc(r.reporter_email||'')}</small></td><td><b>${esc(r.reported_user_name||'—')}</b><small class="admin-cell-sub">${esc(r.reported_user_email||'')}</small></td><td>${esc(r.offer_title||'—')}</td><td><b>${esc(r.reason||'—')}</b></td><td class="admin-details-cell">${esc(r.details||'—')}</td><td><span class="status-badge ${reportStatusClass(r.status)}">${esc(reportStatusLabel(r.status))}</span></td><td>${r.created_at?new Date(r.created_at).toLocaleDateString('pt-BR'):'—'}</td><td><div class="actions admin-report-actions">${r.status!=='analisando'?`<button class="admin-action pause" onclick="adminSetReportStatus('${r.id}','analisando')">Analisar</button>`:''}${r.status!=='resolvido'?`<button class="admin-action activate" onclick="adminSetReportStatus('${r.id}','resolvido')">Resolver</button>`:''}${r.status!=='arquivado'?`<button class="admin-action neutral" onclick="adminSetReportStatus('${r.id}','arquivado')">Arquivar</button>`:''}</div></td></tr>`).join('')}</tbody></table></div>`:'<div class="panel empty-state"><h4>Nenhuma denúncia encontrada</h4><p class="muted">Não há denúncias para os filtros selecionados.</p></div>';
}
function filterAdminReports(){renderAdminReports(window.__adminReports||[])}
async function adminSetReportStatus(id,status){
  const labels={analisando:'marcar como em análise',resolvido:'resolver',arquivado:'arquivar',aberto:'reabrir'};
  if(!confirm(`Deseja ${labels[status]||'alterar'} esta denúncia?`))return;
  const {error}=await sb.rpc('admin_set_report_status',{p_report_id:id,p_status:status});
  if(error)return alert(error.message);
  await loadAdmin();
}

document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&$('reviewModal')&&!$('reviewModal').classList.contains('hide'))closeReview();
});
window.addEventListener('click',e=>{if(e.target===$('reviewModal'))closeReview()});

init();