import * as vscode from 'vscode';
import {Project, ListedModel, listProjects, listServerless, listDedicated, uuid, validateKey, ReadError} from './provider';
const SECRET = 'scalewayAI.apiKey.v1';
interface Metadata {name: string; organizationId: string;}
export class Connection implements vscode.Disposable {
  metadata: Metadata | undefined;
  project: Project | undefined;
  serverless: ListedModel[] = [];
  dedicated: ListedModel[] = [];
  serverlessState = 'Non chargés'; dedicatedState = 'Non chargés';
  busy = false;
  private generation = 0;
  private abort: AbortController | undefined;
  constructor(private context: vscode.ExtensionContext, private changed: () => void) {
    // No automatic network at startup; only nonsecret connection metadata restored.
    const saved = context.globalState.get<Metadata>('scalewayAI.connection');
    if (saved && typeof saved.name === 'string' && saved.name.length <= 80 && uuid(saved.organizationId)) this.metadata = saved;
  }
  private clear() {
    this.generation++; this.abort?.abort(); this.project = undefined;
    this.serverless = []; this.dedicated = []; this.serverlessState = 'Non chargés'; this.dedicatedState = 'Non chargés'; this.changed();
  }
  private async report(error: unknown) {
    const code = error instanceof ReadError ? error.code : 'local_error';
    if (code !== 'cancelled') await vscode.window.showErrorMessage('Scaleway : ' + code + '. Aucun appel d’inférence effectué. Vérifiez clé, organisation et permissions IAM.');
  }
  async login(): Promise<void> {
    if (this.busy) return;
    if (!vscode.workspace.isTrusted) {await vscode.window.showWarningMessage('Connexion disponible uniquement dans un espace de travail approuvé.');return;}
    this.busy = true;
    const operation=this.generation;
    try {
      const name = await vscode.window.showInputBox({title:'Configurer une clé API Scaleway — 1/3 : nom',value:this.metadata?.name ?? 'Scaleway',validateInput:v=>v.trim().length<1||v.length>80?'Nom de 1 à 80 caractères.':undefined});
      if (name === undefined) return;
      const org = await vscode.window.showInputBox({title:'Configurer une clé API Scaleway — 2/3 : organisation',prompt:'UUID de l’organisation autorisée. Nécessaire pour limiter la liste des projets.',value:this.metadata?.organizationId,validateInput:v=>uuid(v.trim())?undefined:'UUID requis.'});
      if (org === undefined) return;
      const key = await vscode.window.showInputBox({title:'Configurer une clé API Scaleway — 3/3 : secret',password:true,ignoreFocusOut:true,prompt:'Conservée dans SecretStorage VS Code, jamais dans les fichiers ou la webview.',validateInput:v=>validateKey(v.trim())?undefined:'Format de clé invalide.'});
      if (key === undefined) return;
      if (!vscode.workspace.isTrusted) return;
      const consent = await vscode.window.showInformationMessage('Autoriser jusqu’à 5 GET pour lister les projets de cette organisation ? Pas d’inférence, pas de modification de ressource.',{modal:true},'Lister les projets');
      if (consent !== 'Lister les projets'||operation!==this.generation||!vscode.workspace.isTrusted) return;
      this.clear(); const generation = this.generation;
      const abort = new AbortController(); this.abort = abort;
      const projects = await vscode.window.withProgress({location:vscode.ProgressLocation.Notification,title:'Scaleway : vérification et projets',cancellable:true},async (_,token)=> {
        const cancel=token.onCancellationRequested(()=>abort.abort());
        try{return await listProjects(org.trim(),key.trim(),abort.signal);}finally{cancel.dispose();}
      });
      if (generation !== this.generation || abort.signal.aborted) return;
      await this.context.secrets.store(SECRET,key.trim());
      if(generation !== this.generation) {await this.context.secrets.delete(SECRET);return;}
      this.metadata = {name:name.trim(),organizationId:org.trim()};
      await this.context.globalState.update('scalewayAI.connection',this.metadata);
      if(generation !== this.generation) {this.metadata=undefined;await this.context.globalState.update('scalewayAI.connection',undefined);return;}
      this.changed();
      await this.pickProject(projects,generation);
    } catch(error) {await this.report(error);}
    finally {this.busy=false;this.changed();}
  }
  private async pickProject(projects: Project[], generation: number) {
    if (!projects.length) {await vscode.window.showInformationMessage('Aucun projet accessible dans cette organisation.');return;}
    const pick=await vscode.window.showQuickPick(projects.map(p=>({label:p.name,description:p.id,project:p})),{title:'Changer de projet Scaleway',placeHolder:'Sélectionner un projet accessible'});
    if (!pick || generation !== this.generation) return;
    const region=await vscode.window.showQuickPick([{label:'fr-par',description:'Région vérifiée pour les déploiements dédiés'}],{title:'Région des ressources dédiées',placeHolder:'Le catalogue serverless est global, pas régional.'});
    if (!region || generation !== this.generation) return;
    this.project=pick.project;this.changed();
  }
  async switchProject():Promise<void> {
    if (!this.metadata) return this.login();
    if(this.busy || !vscode.workspace.isTrusted)return;
    this.busy=true;
    try {
      const operation=this.generation;
      const key=await this.context.secrets.get(SECRET);
      if(operation!==this.generation)return;
      if (!key) {await vscode.window.showInformationMessage('Clé absente : utilisez Configurer une clé API.');return;}
      const consent=await vscode.window.showInformationMessage('Lister les projets de l’organisation configurée (jusqu’à 5 GET, lecture seule) ?',{modal:true},'Lister les projets');
      if(consent!=='Lister les projets'||operation!==this.generation||!vscode.workspace.isTrusted)return;
      this.clear();const generation=this.generation;const abort=new AbortController();this.abort=abort;
      const projects=await listProjects(this.metadata.organizationId,key,abort.signal);
      if(generation===this.generation&&!abort.signal.aborted)await this.pickProject(projects,generation);
    }catch(error){await this.report(error);}finally{this.busy=false;this.changed();}
  }
  async loadModels():Promise<void> {
    if(!this.metadata||!this.project)return this.switchProject();
    if(this.busy||!vscode.workspace.isTrusted)return;
    this.busy=true;
    try {
      const operation=this.generation;
      const consent=await vscode.window.showInformationMessage('Charger le catalogue serverless global accessible à cette clé et les déploiements dédiés du projet en fr-par ? Jusqu’à 6 GET ; aucune inférence.',{modal:true},'Charger les modèles');
      if(consent!=='Charger les modèles'||operation!==this.generation||!vscode.workspace.isTrusted)return;
      const key=await this.context.secrets.get(SECRET);if(!key)throw new ReadError('missing_key');
      if(operation!==this.generation||!this.project)return;
      const generation=this.generation;const project=this.project;
      const abort=new AbortController();this.abort=abort;
      this.serverless=[];this.dedicated=[];this.serverlessState='Chargement…';this.dedicatedState='Chargement…';this.changed();
      await vscode.window.withProgress({location:vscode.ProgressLocation.Notification,title:'Scaleway : modèles (lecture seule)',cancellable:true},async(_,token)=>{
        const subscription=token.onCancellationRequested(()=>abort.abort());
        try {
          try {const rows=await listServerless(key,abort.signal);if(generation===this.generation&&!abort.signal.aborted){this.serverless=rows;this.serverlessState=rows.length?'Global · accès clé API':'Aucun modèle retourné';}}
          catch(error){if(generation===this.generation)this.serverlessState='Erreur · non vérifié';await this.report(error);}
          if(abort.signal.aborted||generation!==this.generation)return;
          try {const rows=await listDedicated(project,key,abort.signal);if(generation===this.generation&&!abort.signal.aborted){this.dedicated=rows;this.dedicatedState=rows.length?'fr-par · projet sélectionné':'Aucun déploiement';}}
          catch(error){if(generation===this.generation)this.dedicatedState='Erreur · non vérifié';await this.report(error);}
        } finally {subscription.dispose();}
      });
      if(abort.signal.aborted&&generation===this.generation){this.serverlessState='Annulé · recharger';this.dedicatedState='Annulé · recharger';}
    }catch(error){await this.report(error);}finally{this.busy=false;this.changed();}
  }
  async disconnect():Promise<void> {
    this.clear();this.metadata=undefined;this.changed();
    await this.context.secrets.delete(SECRET);
    await this.context.globalState.update('scalewayAI.connection',undefined);
  }
  dispose(){this.clear();}
}
