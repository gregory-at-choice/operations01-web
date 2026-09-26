// Clic sur l'icône de l'extension : on demande à la page LinkedIn ouverte d'importer le profil.
chrome.action.onClicked.addListener((tab) => {
  if (!tab || !tab.id || !/^https:\/\/www\.linkedin\.com\/in\//.test(tab.url || "")) return;
  chrome.tabs.sendMessage(tab.id, { type: "choice-import" }, () => void chrome.runtime.lastError);
});
