import * as vscode from 'vscode';
import {Project, ListedModel, listProjects, listDedicated, uuid, ReadError} from './provider';
import {browserLogin, UserSession} from './browserLogin';
interface Metadata {name:string; organizationId:string;}
export class Connection implements vscode.Disposable {
  metadata:Metadata|undefined;
  project:Project|undefined;
  serverless:ListedModel[]=[];dedicated:ListedModel[]=[];
  serverlessState='JWT Serverless non établi';dedicatedState='Non chargés';
  busy=false;
  private session:UserSession|undefined;
  private generation=0;
  private abort:AbortController|undefined;
  private expiry:ReturnType<typeof setTimeout>|undefined;
  constructor(private context:vscode.ExtensionContext,private changed:()=>void) {}
  private clear() {
    this.generation++;this.abort?.abort();this.abort=undefined;this.project=undefined;
    this.serverless=[];this.dedicated=[];this.dedicatedState='Non chargés';this.changed();
  }
  private dropSession(){clearTimeout(this.expiry);this.expiry=undefined;this.session=undefined;this.metadata=undefined;this.clear();}
  private token():string {
    if(!this.session||this.session.expiresAt<=Date.now()+30000){this.dropSession();throw new ReadError('session_expired');}
    return this.session.token;
  }
  get connected():boolean {return !!this.session && this.session.expiresAt>Date.now()+30000;}
  /** Command-level gate: login and project selection, then resume only if ready. */
  async ensureProject():Promise<boolean> {
    if(this.busy||!vscode.workspace.isTrusted)return false;
    if(!this.connected){this.dropSession();await this.login();}
    else if(!this.project)await this.switchProject();
    return this.connected && !!this.project && !this.busy && vscode.workspace.isTrusted;
  }
  private async report(error:unknown) {
    const code=error instanceof ReadError?error.code:'local_error';
    if(code==='access_denied')this.dropSession();
    if(code!=='cancelled')await vscode.window.showErrorMessage('Scaleway : '+code+'. Reconnectez-vous si nécessaire ; vérifiez organisation et permissions. Aucune inférence effectuée.');
  }
  async login():Promise<void> {
    if(this.busy)return;
    if(!vscode.workspace.isTrusted){await vscode.window.showWarningMessage('Connexion disponible uniquement dans un espace de travail approuvé.');return;}
    if(vscode.env.remoteName){await vscode.window.showWarningMessage('Connexion navigateur disponible uniquement dans VS Code local pour cette preview (callback loopback).');return;}
    this.busy=true;const operation=this.generation;
    try {
      const consent=await vscode.window.showInformationMessage('Ouvrir la connexion utilisateur Scaleway dans votre navigateur ? JWT en mémoire uniquement ; aucune clé API créée. Délai : 3 minutes.',{modal:true},'Se connecter');
      if(consent!=='Se connecter'||operation!==this.generation||!vscode.workspace.isTrusted)return;
      this.dropSession();const generation=this.generation;const abort=new AbortController();this.abort=abort;
      const session=await vscode.window.withProgress({location:vscode.ProgressLocation.Notification,title:'Scaleway : connexion dans le navigateur',cancellable:true},async(_,cancel)=>{
        const sub=cancel.onCancellationRequested(()=>abort.abort());
        try{return await browserLogin(async url=>await vscode.env.openExternal(vscode.Uri.parse(url)),abort.signal);}finally{sub.dispose();}
      });
      if(generation!==this.generation||abort.signal.aborted||!vscode.workspace.isTrusted)return;
      // Migration: remove old API-key storage; never read/import it as a fallback.
      await this.context.secrets.delete('scalewayAI.apiKey.v1');
      await this.context.globalState.update('scalewayAI.connection',undefined);
      if(generation!==this.generation||abort.signal.aborted||!vscode.workspace.isTrusted)return;
      this.session=session;
      this.metadata={name:'Utilisateur connecté',organizationId:''};
      const expire=()=>{
        if(this.session!==session)return;
        if(session.expiresAt<=Date.now()+30000){this.dropSession();void vscode.window.showInformationMessage('Session Scaleway expirée. Reconnectez-vous dans le navigateur.');}
        else this.expiry=setTimeout(expire,Math.min(session.expiresAt-Date.now()-30000,2147483647));
      };
      expire();this.changed();
    }catch(error){await this.report(error);}finally{this.busy=false;this.changed();}
    if(this.session&&!this.project)await this.switchProject();
  }
  private async pickProject(projects:Project[],generation:number) {
    if(!projects.length){await vscode.window.showInformationMessage('Aucun projet accessible dans cette organisation.');return;}
    const pick=await vscode.window.showQuickPick(projects.map(project=>({label:project.name,description:project.id,project})),{title:'Changer de projet Scaleway'});
    if(!pick||generation!==this.generation)return;
    this.token();this.project=pick.project;this.changed();
  }
  async switchProject():Promise<void> {
    if(!this.connected){this.dropSession();return this.login();}
    if(this.busy||!vscode.workspace.isTrusted)return;
    this.busy=true;
    try {
      const operation=this.generation;this.token();
      const org=await vscode.window.showInputBox({title:'Scaleway : organisation des projets',prompt:'UUID de l’organisation : valider charge ses projets en lecture seule. Aucun secret à saisir.',value:this.metadata?.organizationId,validateInput:v=>uuid(v.trim())?undefined:'UUID requis.'});
      if(org===undefined||operation!==this.generation||!vscode.workspace.isTrusted)return;
      if(!uuid(org.trim()))throw new ReadError('invalid_scope');
      // UUID submission explicitly requests this bounded scoped read; no redundant modal.
      const token=this.token();this.clear();const generation=this.generation;const abort=new AbortController();this.abort=abort;
      const projects=await listProjects(org.trim(),token,abort.signal);
      if(generation!==this.generation||abort.signal.aborted||!vscode.workspace.isTrusted)return;
      this.token();this.metadata={name:'Utilisateur connecté',organizationId:org.trim()};
      await this.pickProject(projects,generation);
    }catch(error){await this.report(error);}finally{this.busy=false;this.changed();}
  }
  async loadModels():Promise<void> {
    if(!this.session||!this.project)return this.switchProject();
    if(this.busy||!vscode.workspace.isTrusted)return;
    this.busy=true;
    try {
      const operation=this.generation;this.token();
      const consent=await vscode.window.showInformationMessage('Lister les déploiements dédiés du projet en fr-par ? Jusqu’à 5 GET, aucune inférence. Serverless non interrogé : acceptation JWT non établie.',{modal:true},'Charger les modèles');
      if(consent!=='Charger les modèles'||operation!==this.generation||!vscode.workspace.isTrusted)return;
      const token=this.token();const project=this.project;if(!project)return;
      const abort=new AbortController();this.abort=abort;this.dedicatedState='Chargement…';this.changed();
      const rows=await vscode.window.withProgress({location:vscode.ProgressLocation.Notification,title:'Scaleway : déploiements dédiés',cancellable:true},async(_,cancel)=>{
        const sub=cancel.onCancellationRequested(()=>abort.abort());
        try{return await listDedicated(project,token,abort.signal);}finally{sub.dispose();}
      });
      if(operation!==this.generation||abort.signal.aborted||!vscode.workspace.isTrusted)return;
      this.token();this.dedicated=rows;this.dedicatedState=rows.length?'fr-par · projet sélectionné':'Aucun déploiement';
    }catch(error){this.dedicatedState='Erreur · non vérifié';await this.report(error);}finally{this.busy=false;this.changed();}
  }
  async disconnect():Promise<void> {
    this.dropSession();
    await this.context.secrets.delete('scalewayAI.apiKey.v1');
    await this.context.globalState.update('scalewayAI.connection',undefined);
  }
  dispose(){this.dropSession();}
}
