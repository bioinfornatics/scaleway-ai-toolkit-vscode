(() => {
  'use strict';
  const vscode=acquireVsCodeApi();
  const search=document.getElementById('search');
  let state={serverless:[],dedicated:[],publicStatus:'Chargement…',dedicatedStatus:'Sélectionnez un projet',scope:'Catalogue public'};
  function renderRows(id,rows,kind) {
    const root=document.getElementById(id);root.replaceChildren();
    const query=search.value.trim().toLocaleLowerCase();
    const shown=rows.filter(row=>(row.label+' '+(row.status||'')).toLocaleLowerCase().includes(query));
    for(const row of shown) {
      const card=document.createElement('article');
      const title=document.createElement('h3');title.textContent=row.label;card.append(title);
      const status=document.createElement('p');status.textContent=row.status||'Statut inconnu';card.append(status);
      const note=document.createElement('p');note.textContent=kind==='public'?'Offre publique · accès inférence non vérifié':'Modèle à déployer · aucun déploiement créé';card.append(note);
      root.append(card);
    }
    if(rows.length&&!shown.length){const empty=document.createElement('p');empty.textContent='Aucun résultat pour cette recherche.';root.append(empty);}
  }
  function render() {
    document.getElementById('public-status').textContent=state.publicStatus+' · '+state.serverless.length+' modèle(s)';
    document.getElementById('dedicated-status').textContent=state.dedicatedStatus+' · '+state.dedicated.length+' modèle(s)';
    document.getElementById('scope').textContent=state.scope;
    renderRows('public-list',state.serverless,'public');renderRows('dedicated-list',state.dedicated,'dedicated');
  }
  window.addEventListener('message',event=>{if(event.data?.type==='catalog-state'){state=event.data;render();}});
  search.addEventListener('input',render);
  document.getElementById('refresh').addEventListener('click',()=>vscode.postMessage({type:'refresh'}));
  document.getElementById('project').addEventListener('click',()=>vscode.postMessage({type:'project'}));
  vscode.postMessage({type:'ready'});
})();
