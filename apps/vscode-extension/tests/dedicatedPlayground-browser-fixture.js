// Nonce-scoped evidence hook only. No native UI replacement or transport override.
window.qaPost = (message) => vscode.postMessage(message);
window.qaSends = [];
const qaOriginalPost = vscode.postMessage.bind(vscode);
vscode.postMessage = (message) => {
  window.qaSends.push(message.type);
  return qaOriginalPost(message);
};
