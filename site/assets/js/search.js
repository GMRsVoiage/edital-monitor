const api=(window.EDITAL_API_URL||"").replace(/\/$/,"");
const form=document.querySelector("#search-form");
const input=document.querySelector("#search-input");
const feedback=document.querySelector("#feedback");
const results=document.querySelector("#results");

function msg(text,isError=false){
  if(!feedback)return;
  feedback.textContent=text||"";
  feedback.classList.toggle("error",isError);
}

function formatDate(value){
  if(!value)return"Data não identificada";
  const d=new Date(value+"T12:00:00");
  return Number.isNaN(d.getTime())?value:new Intl.DateTimeFormat("pt-BR").format(d);
}

function safeExcerpt(html){
  const template=document.createElement("template");
  template.innerHTML=String(html||"");
  for(const el of [...template.content.querySelectorAll("*")]){
    if(el.tagName!=="MARK"){
      el.replaceWith(document.createTextNode(el.textContent||""));
    }else{
      for(const attr of [...el.attributes])el.removeAttribute(attr.name);
    }
  }
  return template.innerHTML;
}

function render(data){
  results.innerHTML="";
  if(!data.results?.length){
    msg("Nenhuma ocorrência encontrada nas publicações indexadas.");
    return;
  }

  msg(data.total+" resultado(s). Pesquisas restantes hoje: "+data.usage.remaining+"/"+data.usage.limit+".");

  for(const item of data.results){
    const article=document.createElement("article");
    article.className="result-card";

    const meta=document.createElement("div");
    meta.className="result-meta";

    if(item.edition){
      const edition=document.createElement("span");
      edition.textContent="Edição "+item.edition;
      meta.append(edition);
    }

    const published=document.createElement("span");
    published.textContent=formatDate(item.published_at);

    const page=document.createElement("span");
    page.textContent="Página "+item.page_number;
    meta.append(published,page);

    const title=document.createElement("h2");
    title.textContent=item.title||"Boletim Oficial";

    const excerpt=document.createElement("div");
    excerpt.className="excerpt";
    excerpt.innerHTML=safeExcerpt(item.excerpt);

    const link=document.createElement("a");
    link.className="button-link";
    link.href=item.pdf_url;
    link.target="_blank";
    link.rel="noopener noreferrer";
    link.textContent="Abrir PDF oficial ↗";

    article.append(meta,title,excerpt,link);
    results.append(article);
  }
}

async function search(query){
  if(!api||api.includes("SEU-WORKER")){
    msg("A API ainda não foi configurada em site/config.js.",true);
    return;
  }

  msg("Pesquisando…");
  results.innerHTML="";

  try{
    const response=await fetch(api+"/search?q="+encodeURIComponent(query),{
      headers:{accept:"application/json"}
    });
    const data=await response.json();
    if(!response.ok)throw new Error(data.error||"Falha na pesquisa.");
    render(data);
  }catch(error){
    msg(error.message||"Não foi possível pesquisar.",true);
  }
}

async function stats(){
  if(!api||api.includes("SEU-WORKER"))return;
  try{
    const response=await fetch(api+"/stats");
    if(!response.ok)return;
    const data=await response.json();
    document.querySelector("#stat-documents").textContent=Number(data.documents||0).toLocaleString("pt-BR");
    document.querySelector("#stat-pages").textContent=Number(data.pages||0).toLocaleString("pt-BR");
    document.querySelector("#stat-latest").textContent=data.latest?.published_at?formatDate(data.latest.published_at):"—";
  }catch{}
}

form?.addEventListener("submit",event=>{
  event.preventDefault();
  const query=input.value.trim();
  if(query.length>=3)search(query);
});

stats();
